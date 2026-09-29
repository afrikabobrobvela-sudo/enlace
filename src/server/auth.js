// Autenticación propia de Enlace.
//
// - La sesión es una cookie firmada por este mismo Worker (HMAC con SESSION_SECRET).
//   Ninguna cabecera enviada por el visitante se toma como identidad.
// - "Iniciar sesión con Google" funciona en *.workers.dev sin dominio propio.
// - El enlace por correo queda listo, pero solo se activa con RESEND_API_KEY y EMAIL_FROM:
//   Resend no entrega a terceros sin un dominio verificado.

import {
  CONTENT_SECURITY_POLICY,
  SECURITY_HEADERS,
  all,
  cookie,
  email as validEmail,
  fail,
  fromBase64url,
  json,
  nowIso,
  one,
  parseJson,
  randomToken,
  readCookie,
  readJson,
  requireSameOrigin,
  safeReturnPath,
  sha256,
  signToken,
  verifyToken,
} from './http.js';

const SESSION_COOKIE = '__Host-enlace_session';
const OAUTH_COOKIE = '__Host-enlace_oauth';
const SESSION_DAYS = 14;
const EMAIL_LINK_MINUTES = 20;
const EMAIL_LINKS_PER_15_MIN = 3;

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export function providers(env) {
  return {
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    microsoft: Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET && microsoftTenant(env)),
    email: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM),
  };
}

/**
 * Inquilino (tenant) de Microsoft Entra de la institución. Debe ser un id o dominio concreto:
 * con "common" u "organizations" cualquiera podría crear su propio inquilino y poner el correo que quisiera.
 */
function microsoftTenant(env) {
  const tenant = String(env.MICROSOFT_TENANT_ID || '').trim();
  return tenant && !['common', 'organizations', 'consumers'].includes(tenant.toLowerCase()) ? tenant : '';
}

/** Usuario de la sesión actual. Lanza 401 (con los métodos de acceso disponibles) si no hay sesión válida. */
export const SUSPENDED_MESSAGE = 'Tu acceso a Enlace está suspendido. Si crees que es un error, comunícate con la administración de tu academia.';

export async function identity(request, env) {
  const db = env.DB;
  if (!db) fail('El servicio de datos no está disponible.', 503);
  const session = await verifyToken(readCookie(request, SESSION_COOKIE), env.SESSION_SECRET);
  // Una sola consulta: la sesión debe existir en aula_logins, no estar revocada ni vencida. De paso se averigua si
  // la persona tiene un examen abierto que bloquea el resto de Enlace (opción «lockPlatform»): intento empezado, sin
  // enviar y dentro de su tiempo (sin tiempo límite, 12 horas como máximo). Usa el índice aula_attempt_starts_user.
  const now = nowIso();
  const user =
    session?.sid &&
    (await one(
      db,
      `SELECT u.*, (
         SELECT s.quiz || '|' || r.course FROM aula_attempt_starts s
           JOIN aula_records r ON r.id=s.quiz AND r.kind='quiz' AND r.deleted_at IS NULL
           -- Fechas de la sección del alumno (cada grupo presenta a su hora); si no tiene, las de la evaluación.
           LEFT JOIN aula_members m ON m.course=r.course AND m.user_id=s.user_id AND m.role='student' AND m.section<>''
           LEFT JOIN aula_section_dates d ON d.item=r.id AND d.section=m.section
         WHERE s.user_id=u.id AND s.started>?4 AND json_extract(r.data,'$.settings.exam.lockPlatform')=1
           AND NOT EXISTS (SELECT 1 FROM aula_attempts a WHERE a.quiz=s.quiz AND a.user_id=s.user_id AND a.attempt=s.attempt)
           AND CASE WHEN coalesce(json_extract(r.data,'$.settings.timeLimit'),0)=0 THEN 1
                    WHEN json_extract(r.data,'$.settings.timerMode')='fixed' AND coalesce(nullif(d.start_at,''), json_extract(r.data,'$.settings.opensAt')) IS NOT NULL
                      THEN datetime(coalesce(nullif(d.start_at,''), json_extract(r.data,'$.settings.opensAt')), '+' || (json_extract(r.data,'$.settings.timeLimit') + 1) || ' minutes') > datetime(?3)
                    ELSE datetime(s.started, '+' || (json_extract(r.data,'$.settings.timeLimit') + 1) || ' minutes') > datetime(?3) END
           AND (coalesce(nullif(d.end_at,''), json_extract(r.data,'$.settings.closesAt')) IS NULL
                OR datetime(coalesce(nullif(d.end_at,''), json_extract(r.data,'$.settings.closesAt')), '+1 minutes') > datetime(?3))
         ORDER BY s.started DESC LIMIT 1) AS active_exam
       FROM aula_logins l JOIN aula_users u ON u.id=l.user_id
       WHERE l.id=?1 AND l.user_id=?2 AND l.revoked_at IS NULL AND l.expires>?3`,
      session.sid,
      session.uid,
      now,
      new Date(Date.parse(now) - 12 * 3_600_000).toISOString(),
    ));
  if (!user || user.session_version !== session.ver) {
    fail('Inicia sesión para continuar.', 401, { login: providers(env) });
  }
  // Suspender también cierra sus sesiones; esto cubre una sesión que siguiera abierta.
  if (user.suspended_at) fail(SUSPENDED_MESSAGE, 403, { suspended: true });
  // `sid`: la sesión (el dispositivo) de esta solicitud; el examen se contesta en una sola.
  const [quiz, course] = user.active_exam ? user.active_exam.split('|') : [];
  return { ...user, sid: session.sid, activeExam: quiz ? { quiz, course } : null };
}

/** Enrutador de /auth/*. Estas rutas no exigen sesión. */
export async function auth(request, env) {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  try {
    switch (route) {
      case 'GET /auth/google/start':
        return await googleStart(request, env);
      case 'GET /auth/google/callback':
        return await googleCallback(request, env);
      case 'GET /auth/microsoft/start':
        return await microsoftStart(request, env);
      case 'GET /auth/microsoft/callback':
        return await microsoftCallback(request, env);
      case 'POST /auth/email/start':
        return await emailStart(request, env);
      case 'GET /auth/email/verify':
        return emailConfirmPage(url);
      case 'POST /auth/email/verify':
        return await emailVerify(request, env);
      case 'POST /auth/logout':
        requireSameOrigin(request);
        await revokeCurrent(request, env);
        return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
      default:
        return json({ error: 'Ruta no encontrada.' }, 404);
    }
  } catch (error) {
    if (!error.status) console.error('aula-auth', route, error?.message, error?.stack);
    // En el regreso de Google o Microsoft la persona está navegando: se le muestra la pantalla de acceso con un aviso
    // (y se borra la cookie temporal) en lugar de un JSON. El detalle queda en los registros (npx wrangler tail).
    if (request.method === 'GET' && route.endsWith('/callback') && !error.status) return loginError('server', [cookie(OAUTH_COOKIE, '', 0)]);
    return json({ error: error.status ? error.message : 'No se pudo completar el acceso.' }, error.status || 500);
  }
}

// ---- Google ------------------------------------------------------------------------------------

async function googleStart(request, env) {
  if (!providers(env).google) return loginError('google_disabled');
  const url = new URL(request.url);
  const state = randomToken();
  const nonce = randomToken();
  const returnTo = safeReturnPath(url.searchParams.get('return_to'));
  const oauth = await signToken({ state, nonce, returnTo, exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: url.origin + '/auth/google/callback',
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
  });
  return redirect(`${GOOGLE_AUTHORIZE}?${params}`, [cookie(OAUTH_COOKIE, oauth, 600)]);
}

async function googleCallback(request, env) {
  const url = new URL(request.url);
  const clearOauth = cookie(OAUTH_COOKIE, '', 0);
  const pending = await verifyToken(readCookie(request, OAUTH_COOKIE), env.SESSION_SECRET);
  if (url.searchParams.get('error')) return loginError('cancelled', [clearOauth]);
  if (!pending || pending.state !== url.searchParams.get('state')) return loginError('expired', [clearOauth]);

  const response = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code') || '',
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: url.origin + '/auth/google/callback',
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) {
    console.error('aula-auth google token', response.status);
    return loginError('google', [clearOauth]);
  }
  // El id_token llega directo del endpoint de Google por TLS (OpenID Connect Core §3.1.3.7),
  // así que basta validar sus afirmaciones; aun así se revisan emisor, audiencia, vigencia y nonce.
  const claims = decodeJwtPayload((await response.json()).id_token);
  const valid =
    claims &&
    GOOGLE_ISSUERS.includes(claims.iss) &&
    claims.aud === env.GOOGLE_CLIENT_ID &&
    claims.exp > Date.now() / 1000 &&
    claims.nonce === pending.nonce &&
    typeof claims.sub === 'string' &&
    typeof claims.email === 'string';
  if (!valid) return loginError('google', [clearOauth]);
  if (claims.email_verified !== true) return loginError('unverified', [clearOauth]);

  const address = claims.email.toLowerCase();
  if (!emailAllowed(env, address)) return loginError('domain', [clearOauth]);
  const user = await completeLogin(env, { provider: 'google', subject: claims.sub, email: address, name: claims.name });
  if (user.suspended_at) return loginError('suspended', [clearOauth]);
  return redirect(pending.returnTo, [clearOauth, await sessionCookie(user, env)]);
}

// ---- Microsoft (correo institucional en Microsoft 365 / Entra ID) -----------------------------

const microsoftBase = (env) => `https://login.microsoftonline.com/${encodeURIComponent(microsoftTenant(env))}/oauth2/v2.0`;

async function microsoftStart(request, env) {
  if (!providers(env).microsoft) return loginError('microsoft_disabled');
  const url = new URL(request.url);
  const state = randomToken();
  const nonce = randomToken();
  const returnTo = safeReturnPath(url.searchParams.get('return_to'));
  const oauth = await signToken({ p: 'microsoft', state, nonce, returnTo, exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);
  const params = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    redirect_uri: url.origin + '/auth/microsoft/callback',
    response_type: 'code',
    response_mode: 'query',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
  });
  return redirect(`${microsoftBase(env)}/authorize?${params}`, [cookie(OAUTH_COOKIE, oauth, 600)]);
}

async function microsoftCallback(request, env) {
  const url = new URL(request.url);
  const clearOauth = cookie(OAUTH_COOKIE, '', 0);
  const pending = await verifyToken(readCookie(request, OAUTH_COOKIE), env.SESSION_SECRET);
  if (url.searchParams.get('error')) return loginError('cancelled', [clearOauth]);
  if (!providers(env).microsoft) return loginError('microsoft_disabled', [clearOauth]);
  if (!pending || pending.p !== 'microsoft' || pending.state !== url.searchParams.get('state')) return loginError('expired', [clearOauth]);

  const response = await fetch(`${microsoftBase(env)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code') || '',
      client_id: env.MICROSOFT_CLIENT_ID,
      client_secret: env.MICROSOFT_CLIENT_SECRET,
      redirect_uri: url.origin + '/auth/microsoft/callback',
      grant_type: 'authorization_code',
      scope: 'openid email profile',
    }),
  });
  if (!response.ok) {
    console.error('aula-auth microsoft token', response.status);
    return loginError('microsoft', [clearOauth]);
  }
  // Igual que con Google, el id_token llega directo del endpoint de Microsoft por TLS; se validan sus afirmaciones.
  // Solo se acepta el inquilino de la institución (tid): así el correo (UPN) lo administra la propia institución.
  const claims = decodeJwtPayload((await response.json()).id_token);
  const tenantId = claims?.tid;
  const address = String(claims?.preferred_username || claims?.email || '').toLowerCase();
  const valid =
    claims &&
    typeof tenantId === 'string' &&
    claims.iss === `https://login.microsoftonline.com/${tenantId}/v2.0` &&
    (!/^[0-9a-f-]{36}$/i.test(microsoftTenant(env)) || tenantId.toLowerCase() === microsoftTenant(env).toLowerCase()) &&
    claims.aud === env.MICROSOFT_CLIENT_ID &&
    claims.exp > Date.now() / 1000 &&
    claims.nonce === pending.nonce &&
    typeof claims.oid === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
  if (!valid) return loginError('microsoft', [clearOauth]);
  if (!microsoftDomainAllowed(env, address)) return loginError('domain', [clearOauth]);
  if (!emailAllowed(env, address)) return loginError('domain', [clearOauth]);
  const user = await completeLogin(env, { provider: 'microsoft', subject: `${tenantId}:${claims.oid}`, email: address, name: claims.name });
  if (user.suspended_at) return loginError('suspended', [clearOauth]);
  return redirect(pending.returnTo, [clearOauth, await sessionCookie(user, env)]);
}

/** Dominios que se aceptan por Microsoft (MICROSOFT_EMAIL_DOMAINS; por omisión los de la BUAP). */
function microsoftDomainAllowed(env, address) {
  const domains = String(env.MICROSOFT_EMAIL_DOMAINS ?? 'correo.buap.mx,alumno.buap.mx,buap.mx')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return domains.includes(address.split('@')[1]);
}

function decodeJwtPayload(token) {
  if (typeof token !== 'string' || token.split('.').length !== 3) return null;
  return parseJson(new TextDecoder().decode(fromBase64url(token.split('.')[1])), null);
}

// ---- Enlace por correo (requiere dominio verificado en Resend) --------------------------------

async function emailStart(request, env) {
  requireSameOrigin(request);
  if (!providers(env).email) fail('El acceso por correo no está configurado.', 404);
  const body = await readJson(request, 4000);
  const address = validEmail(body.email);
  if (!emailAllowed(env, address)) fail('Usa tu correo institucional para entrar.', 403);

  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const recent = await one(env.DB, 'SELECT count(*) AS n FROM aula_login_tokens WHERE email=? AND created>?', address, since);
  if (recent.n >= EMAIL_LINKS_PER_15_MIN) fail('Ya enviamos varios enlaces. Revisa tu correo o espera 15 minutos.', 429);

  const token = randomToken();
  const now = new Date();
  await env.DB.prepare(
    'INSERT INTO aula_login_tokens (token_hash,email,return_to,created,expires) VALUES (?,?,?,?,?)',
  )
    .bind(
      await sha256(token),
      address,
      safeReturnPath(body.return_to),
      now.toISOString(),
      new Date(now.getTime() + EMAIL_LINK_MINUTES * 60_000).toISOString(),
    )
    .run();

  const link = `${new URL(request.url).origin}/auth/email/verify?token=${token}`;
  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': await sha256(token),
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [address],
      subject: 'Tu enlace para entrar a Enlace',
      text: `Para entrar a tu aula abre este enlace (vence en ${EMAIL_LINK_MINUTES} minutos):\n\n${link}\n\nSi no lo pediste, ignora este correo.`,
      html: `<p>Para entrar a tu aula abre este enlace (vence en ${EMAIL_LINK_MINUTES} minutos):</p><p><a href="${link}">Entrar a Enlace</a></p><p>Si no lo pediste, ignora este correo.</p>`,
    }),
  });
  if (!sent.ok) {
    console.error('aula-auth resend', sent.status);
    fail('No se pudo enviar el correo. Intenta de nuevo en unos minutos.', 502);
  }
  return json({ ok: true });
}

/**
 * Los filtros de correo institucionales (p. ej. Safe Links de Outlook) abren los enlaces antes que la persona.
 * Por eso el GET solo muestra un botón; el enlace se consume con el POST que envía ese botón.
 */
function emailConfirmPage(url) {
  const token = (url.searchParams.get('token') || '').replace(/[^A-Za-z0-9_-]/g, '');
  return htmlPage(
    'Entrar a Enlace',
    `<h1>Entrar a Enlace</h1><p>Confirma que quieres abrir tu aula en este navegador.</p>
     <form method="post" action="/auth/email/verify"><input type="hidden" name="token" value="${token}">
     <button type="submit">Entrar a mi aula</button></form>`,
  );
}

async function emailVerify(request, env) {
  requireSameOrigin(request, { customHeader: false }); // formulario HTML: no puede enviar cabeceras propias
  const token = String((await request.formData()).get('token') || '');
  const hash = await sha256(token);
  const row = await one(env.DB, 'SELECT * FROM aula_login_tokens WHERE token_hash=?', hash);
  if (!row || row.used_at || row.expires < nowIso()) return loginError('link');
  const claimed = await env.DB.prepare('UPDATE aula_login_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL')
    .bind(nowIso(), hash)
    .run();
  if (!claimed.meta.changes) return loginError('link');
  const user = await completeLogin(env, { provider: 'email', subject: row.email, email: row.email, name: '' });
  if (user.suspended_at) return loginError('suspended');
  return redirect(row.return_to, [await sessionCookie(user, env)]);
}

// ---- Alta de sesión ----------------------------------------------------------------------------

/** Restringe el acceso a dominios institucionales si ALLOWED_EMAIL_DOMAINS está configurado. */
export function emailAllowed(env, address) {
  const domains = String(env.ALLOWED_EMAIL_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return !domains.length || domains.includes(address.split('@')[1]);
}

/** Rol que corresponde a un correo: la lista de docentes (aula_teachers) es la fuente de verdad. */
export async function roleFor(db, env, address) {
  if (address === String(env.AULA_OWNER_EMAIL || '').toLowerCase()) return 'admin';
  const grant = await one(db, 'SELECT role FROM aula_teachers WHERE email=?', address);
  return grant ? grant.role : 'student';
}

/**
 * Vincula la identidad externa con un usuario de Enlace y lo devuelve.
 * Si ya existía un usuario con ese correo (por ejemplo, de la versión alojada en ChatGPT Sites),
 * se reutiliza para que conserve sus cursos, entregas y calificaciones.
 */
export async function completeLogin(env, { provider, subject, email, name }) {
  const db = env.DB;
  const now = nowIso();
  const linked = await one(
    db,
    'SELECT u.* FROM aula_identities i JOIN aula_users u ON u.id=i.user_id WHERE i.provider=? AND i.subject=?',
    provider,
    subject,
  );
  let user = linked || (await one(db, 'SELECT * FROM aula_users WHERE email=?', email));
  const role = await roleFor(db, env, user?.email || email);
  const statements = [];

  if (!user) {
    const grant = await one(db, 'SELECT name FROM aula_teachers WHERE email=?', email);
    user = { id: crypto.randomUUID(), email, name: grant?.name || String(name || '').trim().slice(0, 150) || email, role, session_version: 1 };
    statements.push(
      db
        .prepare('INSERT INTO aula_users (id,email,name,role,session_version) VALUES (?,?,?,?,1)')
        .bind(user.id, user.email, user.name, role),
    );
  } else if (user.role !== role) {
    user = { ...user, role };
    statements.push(db.prepare('UPDATE aula_users SET role=? WHERE id=?').bind(role, user.id));
  }
  statements.push(
    db
      .prepare(
        'INSERT INTO aula_identities (provider,subject,user_id,email,created,last_login) VALUES (?,?,?,?,?,?) ' +
          'ON CONFLICT(provider,subject) DO UPDATE SET email=excluded.email,last_login=excluded.last_login',
      )
      .bind(provider, subject, user.id, email, now, now),
    // Una inscripción hecha por correo se vincula a la cuenta la primera vez que la persona entra.
    db.prepare('UPDATE aula_members SET user_id=? WHERE email=? AND user_id IS NULL').bind(user.id, user.email),
  );
  await db.batch(statements);
  return user;
}

async function sessionCookie(user, env) {
  const db = env.DB;
  const sid = randomToken(18);
  const now = new Date();
  const exp = Math.floor(now.getTime() / 1000) + SESSION_DAYS * 86400;
  await db.batch([
    // De paso se borran las sesiones vencidas de esa persona, para que la tabla no crezca sin límite.
    db.prepare('DELETE FROM aula_logins WHERE user_id=? AND expires<?').bind(user.id, now.toISOString()),
    db
      .prepare('INSERT INTO aula_logins (id,user_id,created,expires) VALUES (?,?,?,?)')
      .bind(sid, user.id, now.toISOString(), new Date(exp * 1000).toISOString()),
    // Historial permanente (aula_logins solo conserva las sesiones vigentes): cuenta los inicios de sesión.
    db.prepare('INSERT INTO aula_login_log (id,user_id,at) VALUES (?,?,?)').bind(sid, user.id, now.toISOString()),
  ]);
  const token = await signToken({ uid: user.id, sid, ver: user.session_version ?? 1, exp }, env.SESSION_SECRET);
  return cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400);
}

export const clearSessionCookie = () => cookie(SESSION_COOKIE, '', 0);

/** Revoca la sesión de esta cookie (si es válida). Cerrar sesión en un dispositivo no afecta a los demás. */
async function revokeCurrent(request, env) {
  const session = await verifyToken(readCookie(request, SESSION_COOKIE), env.SESSION_SECRET);
  if (!session?.sid || !env.DB) return;
  await env.DB.prepare('UPDATE aula_logins SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(nowIso(), session.sid).run();
}

/**
 * Invalida todas las sesiones de una persona: las cookies emitidas antes dejan de servir en todos sus dispositivos.
 * Devuelve las sentencias para incluirlas en el mismo lote que el cambio que la motiva.
 */
export function revokeAllStatements(db, userId) {
  return [
    db.prepare('UPDATE aula_users SET session_version=session_version+1 WHERE id=?').bind(userId),
    db.prepare('UPDATE aula_logins SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(nowIso(), userId),
  ];
}

/** Solo para pruebas automatizadas: genera la misma cookie que produce un inicio de sesión real. */
export async function sessionCookieForTests(user, env) {
  return (await sessionCookie(user, env)).split(';')[0];
}

// ---- Respuestas ------------------------------------------------------------------------------

function redirect(location, cookies = []) {
  const headers = new Headers({ Location: location, ...SECURITY_HEADERS });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

function loginError(code, cookies = []) {
  return redirect('/?login_error=' + code, cookies);
}

function htmlPage(title, body) {
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/auth.css"></head>
<body class="auth-standalone"><main class="auth-card">${body}</main></body></html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        ...SECURITY_HEADERS,
      },
    },
  );
}

// Exportado para el panel de administración (último acceso de cada docente).
export async function lastLogins(db, userIds) {
  if (!userIds.length) return {};
  const rows = await all(
    db,
    'SELECT user_id, max(last_login) AS last_login FROM aula_identities WHERE user_id IN (SELECT value FROM json_each(?)) GROUP BY user_id',
    JSON.stringify(userIds),
  );
  return Object.fromEntries(rows.map((r) => [r.user_id, r.last_login]));
}
