// Envío de correos de avisos. Dos formas, según los secretos configurados:
// - Gmail (CORREO_AVISOS + GMAIL_APP_PASSWORD): una cuenta de Gmail solo para Enlace, con contraseña de aplicación,
//   por SMTP cifrado (smtp.gmail.com:465). Límite de Gmail: unos 500 destinatarios al día.
// - Resend (RESEND_API_KEY + EMAIL_FROM), si algún día hay dominio propio. Tiene prioridad sobre Gmail.
// Se lleva la cuenta de lo enviado por día en aula_mail_log para no pasar el límite (MAIL_DAILY_LIMIT, 450 por omisión).
import { one, run } from './http.js';

const DEFAULT_DAILY_LIMIT = 450;
const SMTP_TIMEOUT = 20_000;

export const mailProvider = (env) => (env.RESEND_API_KEY && env.EMAIL_FROM ? 'resend' : env.CORREO_AVISOS && env.GMAIL_APP_PASSWORD ? 'gmail' : null);
export const mailConfigured = (env) => Boolean(env.MAILER || mailProvider(env));
export const dailyLimit = (env) => Math.max(1, Number(env.MAIL_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT);
const today = () => new Date().toISOString().slice(0, 10);

/** Cuántos correos quedan hoy. */
export async function mailQuota(db, env) {
  const row = await one(db, 'SELECT sent FROM aula_mail_log WHERE day=?', today());
  return Math.max(0, dailyLimit(env) - (row?.sent || 0));
}

async function recordSent(db, count, error = null) {
  await run(
    db,
    `INSERT INTO aula_mail_log (day,sent,last_run,last_error) VALUES (?1,?2,?3,?4)
     ON CONFLICT(day) DO UPDATE SET sent=sent+?2, last_run=?3, last_error=?4`,
    today(),
    count,
    new Date().toISOString(),
    error,
  );
}

// ---- Mensaje MIME (texto y HTML, en UTF-8) ---------------------------------------------------------------

function base64Utf8(textValue) {
  const bytes = new TextEncoder().encode(textValue);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
const wrap76 = (value) => value.replace(/.{1,76}/g, '$&\r\n').trimEnd();
const encodedWord = (value) => `=?UTF-8?B?${base64Utf8(value)}?=`;
const cleanHeader = (value) => String(value).replace(/[\r\n]+/g, ' ').trim();

export function mimeMessage({ from, fromName, to, subject, text, html }, date = new Date()) {
  const boundary = 'enlace-' + crypto.randomUUID();
  const domain = from.split('@')[1] || 'enlace.local';
  return [
    `From: ${encodedWord(cleanHeader(fromName || 'Enlace'))} <${from}>`,
    `To: <${cleanHeader(to)}>`,
    `Subject: ${encodedWord(cleanHeader(subject))}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(base64Utf8(text)),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(base64Utf8(html)),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

// ---- Gmail por SMTP ---------------------------------------------------------------------------------------

/** Sesión SMTP con Gmail (una conexión para todos los mensajes de una corrida). */
async function gmailSession(env) {
  // env.SMTP_CONNECT solo existe en las pruebas (un Gmail simulado).
  const connect = env.SMTP_CONNECT || (await import('cloudflare:sockets')).connect;
  const socket = connect({ hostname: 'smtp.gmail.com', port: 465 }, { secureTransport: 'on', allowHalfOpen: false });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';
  // Sin respuesta de Gmail en 20 s (red caída o puerto bloqueado): se corta en vez de dejar la solicitud colgada.
  let broken = false;
  const timed = (promise) => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        broken = true;
        reject(new Error('Gmail no respondió a tiempo.'));
      }, SMTP_TIMEOUT);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  };
  const drop = () => Promise.resolve(socket.close()).catch(() => {});
  const reply = async () => {
    for (;;) {
      const lines = buffer.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          buffer = lines.slice(i + 1).join('\r\n');
          return { code: Number(lines[i].slice(0, 3)), text: lines.slice(0, i + 1).join(' ') };
        }
      }
      const { value, done } = await timed(reader.read());
      if (done) throw new Error('Gmail cerró la conexión.');
      buffer += decoder.decode(value, { stream: true });
    }
  };
  const command = async (line, expected) => {
    if (line !== null) await timed(writer.write(encoder.encode(line + '\r\n')));
    const r = await reply();
    if (!expected.includes(r.code)) throw Object.assign(new Error(`Gmail respondió ${r.text.slice(0, 180)}`), { smtpCode: r.code });
    return r;
  };
  try {
    await command(null, [220]);
    await command('EHLO enlace', [250]);
    await command('AUTH LOGIN', [334]);
    await command(btoa(env.CORREO_AVISOS), [334]);
    await command(btoa(String(env.GMAIL_APP_PASSWORD).replace(/\s+/g, '')), [235]).catch((e) => {
      throw e.smtpCode === 535 ? new Error('Gmail rechazó la cuenta o la contraseña de aplicación. Vuelve a ejecutar npm run correo.') : e;
    });
  } catch (e) {
    drop();
    throw e;
  }
  return {
    async send(message) {
      await command(`MAIL FROM:<${env.CORREO_AVISOS}>`, [250]);
      await command(`RCPT TO:<${message.to}>`, [250, 251]);
      await command('DATA', [354]);
      // El cuerpo va en base64: ninguna línea empieza con punto, así que no hace falta "dot-stuffing".
      await timed(writer.write(encoder.encode(mimeMessage({ ...message, from: env.CORREO_AVISOS }) + '\r\n.\r\n')));
      await command(null, [250]);
    },
    async reset() {
      await command('RSET', [250]).catch(() => {});
    },
    async close() {
      if (!broken) await command('QUIT', [221]).catch(() => {});
      drop();
    },
  };
}

// ---- Resend (dominio propio) ------------------------------------------------------------------------------

async function sendResend(env, messages) {
  let sent = 0;
  const failed = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const r = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk.map((m) => ({ from: env.EMAIL_FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html }))),
    });
    if (!r.ok) {
      failed.push(...chunk.map((m) => m.to));
      return { sent, failed, error: `Resend respondió ${r.status}` };
    }
    sent += chunk.length;
  }
  return { sent, failed };
}

/**
 * Envía una lista de mensajes ({ to, subject, text, html, fromName }) respetando el límite diario. Devuelve
 * { sent: [correos enviados], skipped: [sin cupo o con error], error }. Nunca lanza: un correo que no sale no debe
 * romper lo que lo pidió.
 */
export async function sendMails(db, env, messages) {
  if (!messages.length) return { sent: [], skipped: [], error: null };
  if (!mailConfigured(env)) return { sent: [], skipped: messages.map((m) => m.to), error: 'El correo de avisos no está configurado.' };
  const quota = await mailQuota(db, env);
  const now = messages.slice(0, quota);
  const later = messages.slice(quota).map((m) => m.to);
  const sent = [];
  const skipped = [...later];
  let error = later.length ? `Se llegó al límite de ${dailyLimit(env)} correos de hoy.` : null;
  try {
    if (env.MAILER) {
      // Pruebas: un "cartero" en memoria.
      for (const m of now) {
        if (await env.MAILER(m)) sent.push(m.to);
        else {
          skipped.push(m.to);
          error ||= 'El servidor de correo rechazó el mensaje.';
        }
      }
    } else if (mailProvider(env) === 'resend') {
      const r = await sendResend(env, now);
      sent.push(...now.slice(0, r.sent).map((m) => m.to));
      skipped.push(...r.failed);
      error = r.error || error;
    } else {
      const session = await gmailSession(env);
      try {
        for (const m of now) {
          try {
            await session.send(m);
            sent.push(m.to);
          } catch (e) {
            skipped.push(m.to);
            // 5.4.5 / 4xx: se acabó el cupo de Gmail o hay un problema temporal; se deja para la siguiente corrida.
            if (!e.smtpCode || e.smtpCode === 421 || e.smtpCode === 454 || /5\.4\.5|quota|limit/i.test(e.message)) {
              error = e.message;
              skipped.push(...now.slice(now.indexOf(m) + 1).map((x) => x.to));
              break;
            }
            await session.reset(); // un destinatario inválido no detiene a los demás
          }
        }
      } finally {
        await session.close();
      }
    }
  } catch (e) {
    error = e.message || 'No se pudo enviar el correo.';
    for (const m of now) if (!sent.includes(m.to) && !skipped.includes(m.to)) skipped.push(m.to);
  }
  await recordSent(db, sent.length, error);
  if (error) console.error('aula-mail', error);
  return { sent, skipped, error };
}

// ---- Plantilla ------------------------------------------------------------------------------------------

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Correo con el estilo de Enlace: título, bloques por curso y botón para entrar. */
export function mailBody({ title, intro = '', groups = [], url = '', footer = '' }) {
  const text = [
    title,
    intro,
    ...groups.map((g) => `\n${g.heading}\n${g.lines.map((l) => `  • ${l}`).join('\n')}`),
    url ? `\nEntra a Enlace: ${url}` : '',
    footer ? `\n${footer}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f3f6f9;font-family:Arial,Helvetica,sans-serif;color:#152536">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="font-size:20px;font-weight:bold;color:#0b3a5b;margin-bottom:12px">Enlace</div>
  <div style="background:#ffffff;border:1px solid #e2e8ee;border-radius:12px;padding:20px">
    <h1 style="font-size:19px;margin:0 0 8px">${escapeHtml(title)}</h1>
    ${intro ? `<p style="margin:0 0 12px;color:#4a5d6e">${escapeHtml(intro)}</p>` : ''}
    ${groups
      .map(
        (g) => `<h2 style="font-size:15px;margin:16px 0 6px;color:#0b3a5b">${escapeHtml(g.heading)}</h2>
    <ul style="margin:0;padding-left:20px">${g.lines.map((l) => `<li style="margin:4px 0">${escapeHtml(l)}</li>`).join('')}</ul>`,
      )
      .join('')}
    ${url ? `<p style="margin:20px 0 0"><a href="${escapeHtml(url)}" style="background:#0b3a5b;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">Entrar a Enlace</a></p>` : ''}
  </div>
  ${footer ? `<p style="font-size:12px;color:#7a8a98;margin:12px 4px">${escapeHtml(footer)}</p>` : ''}
</div></body></html>`;
  return { text, html };
}
