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
    email: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM),
  };
}

/** Usuario de la sesión actual. Lanza 401 (con los métodos de acceso disponibles) si no hay sesión válida. */
export async function identity(request, env) {
  const db = env.DB;
  if (!db) fail('El servicio de datos no está disponible.', 503);
  const session = await verifyToken(readCookie(request, SESSION_COOKIE), env.SESSION_SECRET);
  const user = session && (await one(db, 'SELECT * FROM aula_users WHERE id=?', session.uid));
  if (!user || user.session_version !== session.ver) {
    fail('Inicia sesión para continuar.', 401, { login: providers(env) });
  }
  return user;
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
      case 'POST /auth/email/start':
        return await emailStart(request, env);
      case 'GET /auth/email/verify':
        return emailConfirmPage(url);
      case 'POST /auth/email/verify':
        return await emailVerify(request, env);
      case 'POST /auth/logout':
        requireSameOrigin(request);
        return json({ ok: true }, 200, { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0) });
      default:
        return json({ error: 'Ruta no encontrada.' }, 404);
    }
  } catch (error) {
    if (!error.status) console.error('aula-auth', error);
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
  return redirect(pending.returnTo, [clearOauth, await sessionCookie(user, env)]);
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
  const token = await signToken(
    { uid: user.id, ver: user.session_version ?? 1, exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400 },
    env.SESSION_SECRET,
  );
  return cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400);
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
