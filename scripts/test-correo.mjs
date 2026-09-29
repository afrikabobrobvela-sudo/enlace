// Pruebas de los avisos por correo (12.19): resumen diario por persona (respeta secciones, publicación programada,
// prórrogas y lo ya entregado), preferencia en «Mi perfil», cupo diario (quien no alcanzó cupo recibe su resumen al día
// siguiente sin perder avisos), noticia urgente enviada una sola vez a su sección, rutas de administración y mensaje MIME.
// El envío real (Gmail/Resend) se sustituye por un «cartero» en memoria (env.MAILER).
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { digestMessages, runDigest } from '../src/server/digest.js';
import { mailBody, mailProvider, mimeMessage, sendMails } from '../src/server/mail.js';
import { one } from '../src/server/http.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
let outbox = [];
let accept = () => true;
const env = {
  DB: store.DB,
  BUCKET: memoryBucket(),
  AULA_OWNER_EMAIL: 'admin@example.test',
  SESSION_SECRET: 'x'.repeat(40),
  ENLACE_URL: 'https://enlace.example.test/',
  MAILER: async (m) => {
    if (!accept(m)) return false;
    outbox.push(m);
    return true;
  },
};
let checks = 0;
const cookies = {};
async function call(who, path, data, status = 200, method, useEnv = env) {
  cookies[who] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who }), env);
  const before = store.counter.queries;
  const res = await api(
    new Request('https://t.local' + path, {
      method: method || (data === undefined ? 'GET' : 'POST'),
      headers: { cookie: cookies[who], Origin: 'https://t.local', 'X-Aula-Request': '1' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    useEnv,
  );
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${who}) → ${text}`);
  assert(store.counter.queries - before <= 50, `${path}: ${store.counter.queries - before} consultas`);
  checks++;
  return JSON.parse(text);
}
const HOUR = 3_600_000;
const at = (ms) => new Date(Date.now() + ms).toISOString();
const sql = store.raw();
const mailFor = (who) => outbox.filter((m) => m.to === who + '@example.test');
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const digest = async () => {
  outbox = [];
  await tick(); // lo creado antes queda antes de la corrida, y lo creado después, después
  const before = store.counter.queries;
  const result = await runDigest(env.DB, env, new Date());
  await tick();
  assert(store.counter.queries - before <= 50, `resumen: ${store.counter.queries - before} consultas`);
  return result;
};

// ---- Curso con dos secciones ----
await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '5.º semestre' }, 201)).id;
const av = (await call('docente', '/api/sections', { course: c, name: '5AV' }, 201)).id;
const bv = (await call('docente', '/api/sections', { course: c, name: '5BV' }, 201)).id;
await call('docente', '/api/members/bulk', {
  course: c,
  students: [
    { name: 'Ana López', email: 'ana@example.test', section: '5AV' },
    { name: 'Beto Ruiz', email: 'beto@example.test', section: '5BV' },
  ],
});
const me = await call('ana', '/api/me');
assert.equal(me.mailEnabled, true);
assert.equal(me.emailDigest, true);
await call('beto', '/api/me');
checks += 2;
const members = Object.fromEntries((await call('docente', '/api/course?id=' + c)).members.map((m) => [m.email.split('@')[0], m.id]));
const rec = (kind, data) => call('docente', '/api/record', { course: c, kind, data }, 201);

const todos = await rec('notice', { title: 'Parcial el viernes', body: 'Traigan **calculadora**.', visible: true });
const soloBv = await rec('notice', { title: 'Cambio de salón 5BV', body: 'Salón 204', visible: true, sections: [bv] });
await rec('notice', { title: 'Borrador oculto', body: '', visible: false });
await rec('notice', { title: 'Programada', body: '', visible: true, publishAt: at(5 * 24 * HOUR) });
await rec('material', { title: 'Guía 1', body: '', visible: true });
const tareaAv = await rec('task', { title: 'Práctica 5AV', visible: true, due: at(12 * HOUR), sections: [av] });
const entregable = await rec('task', { title: 'Reporte', visible: true, due: at(10 * HOUR) });

// Ana entrega el reporte: ya no le aparece «vence pronto» y el docente tiene una entrega por calificar.
await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: entregable.id, body: 'Mi reporte' } }, 201);

// ---- Primer resumen ----
let result = await digest();
assert.equal(result.error, null);
const [ana] = mailFor('ana');
const [beto] = mailFor('beto');
const [docente] = mailFor('docente');
assert(ana && beto && docente, 'Cada quien con algo nuevo recibe un solo correo');
assert.equal(mailFor('admin').length, 0, 'Sin nada nuevo no hay correo');
assert.equal(result.sent, 3);
checks += 3;
assert.match(ana.text, /Hola, ana/);
assert.doesNotMatch(ana.text, /Actividad nueva: «Práctica 5AV»/, 'Nueva y por vencer: una sola línea');
assert.match(ana.text, /Física I/);
assert.match(ana.text, /Noticia: «Parcial el viernes»/);
assert.match(ana.text, /Material nuevo: «Guía 1»/);
assert.match(ana.text, /Vence pronto: «Práctica 5AV»/);
assert.match(ana.text, /Actividad nueva: «Reporte»/);
assert.doesNotMatch(ana.text, /Vence pronto: «Reporte»/, 'Lo ya entregado no se recuerda');
assert.doesNotMatch(ana.text, /Cambio de salón/, 'Ana no es de 5BV');
assert.doesNotMatch(ana.text, /Borrador oculto|Programada/, 'Solo lo publicado');
assert.match(ana.text, /https:\/\/enlace\.example\.test\//);
assert.match(ana.html, /Entrar a Enlace/);
checks += 12;
assert.match(beto.text, /Cambio de salón 5BV/);
assert.match(beto.text, /Vence pronto: «Reporte»/);
assert.doesNotMatch(beto.text, /Práctica 5AV/, 'La actividad es solo de 5AV');
assert.match(docente.text, /1 entrega nueva por calificar/);
assert.match(ana.subject, /^Enlace: \d+ avisos nuevos$/);
checks += 5;

// ---- Nada nuevo: nadie recibe correo ----
result = await digest();
assert.equal(outbox.length, 0);
checks++;

// ---- Calificación publicada (también al publicar en bloque un borrador) ----
const entrega = (await call('docente', '/api/course?id=' + c)).records.find((r) => r.kind === 'submission' && r.data.task === entregable.id);
await call('docente', '/api/grade', { course: c, task: entregable.id, member: members.ana, revision: entrega.revision, grade: 9, feedback: 'Bien', publish: false });
await digest();
assert.equal(mailFor('ana').length, 0, 'El borrador no se avisa');
await call('docente', '/api/grades/publish', { course: c, task: entregable.id });
await digest();
assert.match(mailFor('ana')[0]?.text || '', /Calificación publicada en «Reporte»: 9/);
checks += 2;

// ---- Prórroga: la fecha de Beto se mueve y deja de «vencer pronto» ----
const tarea2 = await rec('task', { title: 'Tarea 2', visible: true, due: at(20 * HOUR) });
await call('docente', '/api/extension', { course: c, task: tarea2.id, member: members.beto, due: at(4 * 24 * HOUR) });
await digest();
assert.match(mailFor('ana')[0].text, /Vence pronto: «Tarea 2»/);
assert.match(mailFor('beto')[0].text, /Actividad nueva: «Tarea 2»/);
assert.doesNotMatch(mailFor('beto')[0].text, /Vence pronto: «Tarea 2»/);
checks += 3;

// ---- Preferencia en «Mi perfil» ----
await call('beto', '/api/profile/notifications', { digest: 'no' }, 400);
await call('beto', '/api/profile/notifications', { digest: false });
assert.equal((await call('beto', '/api/me')).emailDigest, false);
await rec('notice', { title: 'Aviso 3', body: '', visible: true });
await digest();
assert.equal(mailFor('beto').length, 0, 'Quien apagó los correos no recibe');
assert.equal(mailFor('ana').length, 1);
await call('beto', '/api/profile/notifications', { digest: true });
checks += 3;

// ---- Cupo diario: quien no alcanza cupo lo recibe en la siguiente corrida, con sus avisos ----
sql.prepare('DELETE FROM aula_mail_log').run();
env.MAIL_DAILY_LIMIT = '1';
await rec('notice', { title: 'Aviso 4', body: '', visible: true });
result = await digest();
assert.equal(result.sent, 1);
assert.equal(result.skipped, 1);
assert.match(result.error, /límite de 1 correos/);
const first = outbox[0].to;
const second = ['ana@example.test', 'beto@example.test'].find((e) => e !== first);
result = await digest();
assert.equal(outbox.length, 0, 'Sin cupo hoy, nadie más');
sql.prepare('DELETE FROM aula_mail_log').run(); // «mañana»
result = await digest();
assert.deepEqual(outbox.map((m) => m.to), [second]);
assert.match(outbox[0].text, /Aviso 4/, 'No se pierde lo que ya estaba');
delete env.MAIL_DAILY_LIMIT;
checks += 6;

// ---- Un correo que falla no avanza la ventana de esa persona ----
accept = (m) => m.to !== 'ana@example.test';
await rec('notice', { title: 'Aviso 5', body: '', visible: true });
result = await digest();
assert.deepEqual(outbox.map((m) => m.to), ['beto@example.test']);
accept = () => true;
await digest();
assert.deepEqual(outbox.map((m) => m.to), ['ana@example.test']);
assert.match(outbox[0].text, /Aviso 5/);
checks += 3;

// ---- Noticia urgente por correo (solo su sección, una sola vez) ----
outbox = [];
await call('ana', '/api/notice/email', { course: c, id: soloBv.id }, 403);
await call('docente', '/api/notice/email', { course: c, id: tareaAv.id }, 404);
const oculta = await rec('notice', { title: 'Oculta', body: '', visible: false });
await call('docente', '/api/notice/email', { course: c, id: oculta.id }, 409);
let sent = await call('docente', '/api/notice/email', { course: c, id: soloBv.id });
assert.equal(sent.sent, 1);
assert.deepEqual(outbox.map((m) => m.to), ['beto@example.test']);
assert.equal(outbox[0].subject, 'Física I: Cambio de salón 5BV');
assert.match(outbox[0].text, /Salón 204/);
const again = await call('docente', '/api/notice/email', { course: c, id: soloBv.id }, 409);
assert.match(again.error, /ya se envió/);
const course = await call('docente', '/api/course?id=' + c);
const enviada = course.records.find((r) => r.id === soloBv.id);
assert(enviada.data.emailedAt, 'La noticia queda marcada como enviada');
// Editarla no permite volver a enviarla.
await call('docente', '/api/record', { course: c, kind: 'notice', id: soloBv.id, revision: enviada.revision, data: { ...enviada.data, title: 'Cambio de salón 5BV (corregido)' } });
await call('docente', '/api/notice/email', { course: c, id: soloBv.id }, 409);
outbox = [];
sent = await call('docente', '/api/notice/email', { course: c, id: todos.id });
assert.equal(sent.sent, 2);
assert.match(outbox[0].text, /Traigan calculadora\./, 'Sin marcas de formato');
checks += 7;
// Sin correo configurado.
const sinCorreo = { ...env, MAILER: undefined };
const otra = await rec('notice', { title: 'Otra', body: '', visible: true });
await call('docente', '/api/notice/email', { course: c, id: otra.id }, 409, undefined, sinCorreo);
assert.equal((await call('ana', '/api/me', undefined, 200, undefined, sinCorreo)).mailEnabled, false);
checks++;

// ---- Administración ----
await call('docente', '/api/mail/status', undefined, 403);
await call('docente', '/api/mail/test', {}, 403);
const status = await call('admin', '/api/mail/status');
assert.equal(status.configured, true);
assert.equal(status.limit, 450);
assert(status.sentToday >= 3);
assert.equal(status.url, 'https://enlace.example.test/');
outbox = [];
assert.equal((await call('admin', '/api/mail/test', {})).to, 'admin@example.test');
assert.equal(outbox[0].subject, 'Enlace: correo de prueba');
await call('admin', '/api/mail/test', {}, 409, undefined, sinCorreo);
accept = () => false;
assert.match((await call('admin', '/api/mail/test', {}, 502)).error, /rechazó el mensaje/);
accept = () => true;
assert.equal(typeof (await call('admin', '/api/mail/digest', {})).sent, 'number');
checks += 6;

// ---- Envío sin configurar y proveedor ----
const none = await sendMails(env.DB, { DB: env.DB }, [{ to: 'x@example.test', subject: 's', text: 't', html: 'h' }]);
assert.deepEqual(none.sent, []);
assert.match(none.error, /no está configurado/);
assert.equal(mailProvider({ CORREO_AVISOS: 'a@gmail.com', GMAIL_APP_PASSWORD: 'abcd' }), 'gmail');
assert.equal(mailProvider({ CORREO_AVISOS: 'a@gmail.com', GMAIL_APP_PASSWORD: 'abcd', RESEND_API_KEY: 'k', EMAIL_FROM: 'Enlace <a@b.mx>' }), 'resend');
assert.equal(mailProvider({ CORREO_AVISOS: 'a@gmail.com' }), null);
assert.equal(await runDigest(env.DB, { DB: env.DB }).then((r) => r.sent), 0);
checks += 5;

// ---- Mensaje MIME: encabezados codificados, sin inyección de encabezados, cuerpo en base64 ----
const body = mailBody({ title: 'Física <b>ñ</b>', groups: [{ heading: 'Curso & "x"', lines: ['<script>alert(1)</script>'] }], url: 'https://e.test/?a=1&b="2"' });
assert.doesNotMatch(body.html, /<script>|<b>ñ/);
assert.match(body.html, /&lt;script&gt;/);
assert.match(body.html, /href="https:\/\/e\.test\/\?a=1&amp;b=&quot;2&quot;"/);
const mime = mimeMessage({ from: 'avisos.ejemplo@gmail.com', to: 'ana@example.test\r\nBcc: x@evil.test', subject: 'Acción\r\nBcc: y@evil.test', ...body });
const headers = mime.split('\r\n\r\n')[0];
assert.doesNotMatch(headers, /^Bcc:/m, 'Un salto de línea no agrega encabezados');
const subject = headers.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m)[1];
assert.equal(Buffer.from(subject, 'base64').toString('utf8'), 'Acción Bcc: y@evil.test');
assert(mime.split('\r\n').every((line) => line.length <= 998 && !line.startsWith('.')), 'Líneas SMTP válidas');
const htmlPart = mime.split('Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0];
assert.equal(Buffer.from(htmlPart.replace(/\r\n/g, ''), 'base64').toString('utf8'), body.html);
checks += 7;

// ---- Conversación SMTP con un Gmail simulado ----
function fakeGmail({ password = 'abcdefghijklmnop', reject = [], quotaAfter = Infinity } = {}) {
  const log = [];
  const connections = [];
  const connect = (address, options) => {
    connections.push({ address, options });
    let push;
    let delivered = 0;
    let inData = false;
    let data = '';
    let pendingAuth = null;
    const readable = new ReadableStream({ start: (c) => (push = (line) => c.enqueue(new TextEncoder().encode(line + '\r\n'))) });
    push('220 smtp.gmail.com ESMTP listo');
    const handle = (line) => {
      log.push(line);
      if (inData) {
        data += line + '\n';
        if (line === '.') {
          inData = false;
          delivered++;
          push('250 2.0.0 OK');
        }
        return;
      }
      if (pendingAuth === 'user') {
        pendingAuth = 'pass';
        return push('334 UGFzc3dvcmQ6');
      }
      if (pendingAuth === 'pass') {
        pendingAuth = null;
        return push(atob(line) === password ? '235 2.7.0 Accepted' : '535-5.7.8 Username and Password not accepted.\r\n535 5.7.8 Learn more');
      }
      if (line.startsWith('EHLO')) return push('250-smtp.gmail.com at your service\r\n250-SIZE 35882577\r\n250-AUTH LOGIN PLAIN\r\n250 SMTPUTF8');
      if (line === 'AUTH LOGIN') {
        pendingAuth = 'user';
        return push('334 VXNlcm5hbWU6');
      }
      if (line.startsWith('MAIL FROM')) return push(delivered >= quotaAfter ? '550 5.4.5 Daily user sending limit exceeded.' : '250 2.1.0 OK');
      if (line.startsWith('RCPT TO')) return push(reject.some((r) => line.includes(r)) ? '550 5.1.1 The email account does not exist.' : '250 2.1.5 OK');
      if (line === 'DATA') {
        inData = true;
        return push('354 Go ahead');
      }
      if (line === 'RSET') return push('250 2.1.5 Flushed');
      if (line === 'QUIT') return push('221 2.0.0 closing connection');
      push('502 5.5.1 Unrecognized command.');
    };
    let partial = '';
    const writable = new WritableStream({
      write(chunk) {
        partial += new TextDecoder().decode(chunk);
        const lines = partial.split('\r\n');
        partial = lines.pop();
        for (const line of lines) handle(line);
      },
    });
    return { readable, writable, close: () => {}, data: () => data };
  };
  return { connect, log, connections };
}
const smtpEnv = (gmail) => ({ DB: env.DB, CORREO_AVISOS: 'avisos.ejemplo@gmail.com', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop', SMTP_CONNECT: gmail.connect });
const msg = (to) => ({ to, subject: 'Prueba ñ', ...mailBody({ title: 'Hola', groups: [{ heading: 'Física I', lines: ['Uno'] }] }) });
sql.prepare('DELETE FROM aula_mail_log').run();
let gmail = fakeGmail({ reject: ['nadie@'] });
let r = await sendMails(env.DB, smtpEnv(gmail), [msg('a@example.test'), msg('nadie@example.test'), msg('b@example.test')]);
assert.deepEqual(r.sent, ['a@example.test', 'b@example.test'], 'Un destinatario inválido no detiene a los demás');
assert.deepEqual(r.skipped, ['nadie@example.test']);
assert.deepEqual(gmail.connections[0].address, { hostname: 'smtp.gmail.com', port: 465 });
assert.equal(gmail.connections[0].options.secureTransport, 'on');
assert.equal(atob(gmail.log[2]), 'avisos.ejemplo@gmail.com');
assert.equal(atob(gmail.log[3]), 'abcdefghijklmnop', 'Los espacios de la contraseña de aplicación no cuentan');
assert(gmail.log.includes('RSET') && gmail.log.at(-1) === 'QUIT');
assert.equal(gmail.connections.length, 1, 'Una sola conexión para todos');
assert.equal((await one(env.DB, 'SELECT sent FROM aula_mail_log')).sent, 2);
checks += 9;
gmail = fakeGmail({ password: 'otra' });
r = await sendMails(env.DB, smtpEnv(gmail), [msg('a@example.test')]);
assert.deepEqual(r.skipped, ['a@example.test']);
assert.match(r.error, /rechazó la cuenta o la contraseña/);
gmail = fakeGmail({ quotaAfter: 1 });
r = await sendMails(env.DB, smtpEnv(gmail), [msg('a@example.test'), msg('b@example.test'), msg('c@example.test')]);
assert.deepEqual(r.sent, ['a@example.test']);
assert.deepEqual(r.skipped, ['b@example.test', 'c@example.test'], 'Al acabarse el cupo de Gmail se detiene');
assert.match(r.error, /5\.4\.5/);
checks += 5;

// ---- El resumen usa pocas consultas aunque haya muchos alumnos ----
await call('docente', '/api/members/bulk', { course: c, students: Array.from({ length: 150 }, (_, i) => ({ name: 'Alumno ' + i, email: `a${i}@example.test` })) });
const before = store.counter.queries;
await digestMessages(env.DB, env, new Date());
assert(store.counter.queries - before <= 6);
checks++;

console.log(`PASS: ${checks} verificaciones de avisos por correo — resumen diario por sección y persona, preferencia en el perfil, cupo diario sin perder avisos, noticia urgente una sola vez, administración y mensaje MIME seguro.`);
