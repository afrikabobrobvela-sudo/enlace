// Pruebas del inicio de sesión: Google (OpenID Connect) y enlace por correo, con respuestas externas simuladas.
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const baseEnv = {
  DB: store.DB,
  BUCKET: memoryBucket(),
  AULA_OWNER_EMAIL: 'coordinacion@example.test',
  SESSION_SECRET: 'k'.repeat(48),
  GOOGLE_CLIENT_ID: 'enlace.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secreto-google',
};
const ORIGIN = 'https://enlace.example.workers.dev';
let checks = 0;
const realFetch = globalThis.fetch;

const cookiesFrom = (res) => (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]);
const cookieHeader = (list) => list.filter((c) => !c.endsWith('=')).join('; ');
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const fetchWorker = (path, init = {}, env = baseEnv) => worker.fetch(new Request(ORIGIN + path, init), env);

/** Recorre el flujo de Google con un id_token simulado y devuelve la respuesta final del callback. */
async function googleLogin(claims, { env = baseEnv, returnTo = '/', tamperState = false } = {}) {
  const start = await fetchWorker('/auth/google/start?return_to=' + encodeURIComponent(returnTo), {}, env);
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get('location'));
  assert.equal(location.origin + location.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(location.searchParams.get('redirect_uri'), ORIGIN + '/auth/google/callback');
  const state = location.searchParams.get('state');
  const nonce = location.searchParams.get('nonce');
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://oauth2.googleapis.com/token');
    assert.equal(new URLSearchParams(init.body).get('client_secret'), env.GOOGLE_CLIENT_SECRET);
    const payload = { iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, exp: Date.now() / 1000 + 300, nonce, email_verified: true, ...claims };
    return new Response(JSON.stringify({ id_token: `${b64({ alg: 'RS256' })}.${b64(payload)}.firma` }), { status: 200 });
  };
  const callback = await fetchWorker(
    `/auth/google/callback?code=abc&state=${tamperState ? 'otro' : state}`,
    { headers: { cookie: cookieHeader(cookiesFrom(start)) } },
    env,
  );
  globalThis.fetch = realFetch;
  checks++;
  return callback;
}

async function me(sessionCookies) {
  return fetchWorker('/api/me', { headers: { cookie: cookieHeader(sessionCookies) } });
}

// ---- Google ----
const disabled = await fetchWorker('/auth/google/start', {}, { ...baseEnv, GOOGLE_CLIENT_ID: '' });
assert.equal(disabled.headers.get('location'), '/?login_error=google_disabled');
checks++;

// Usuario creado en la versión alojada en Sites (id de ChatGPT) con cursos propios: debe conservarlos.
store.raw().prepare("INSERT INTO aula_users (id,email,name,role) VALUES ('user-chatgpt-1','coordinacion@example.test','Dr. Rodrigo Vela','admin')").run();
store.raw().prepare("INSERT INTO aula_courses (id,owner,name,group_name,intro,created) VALUES ('c1','user-chatgpt-1','Física I','601','', '2026-09-01')").run();

const ok = await googleLogin({ sub: 'g-111', email: 'Coordinacion@example.test', name: 'Rodrigo Vela' }, { returnTo: '/?curso=c1' });
assert.equal(ok.status, 302);
assert.equal(ok.headers.get('location'), '/?curso=c1');
const setCookies = ok.headers.getSetCookie();
const sessionSetCookie = setCookies.find((c) => c.startsWith('__Host-enlace_session='));
assert.match(sessionSetCookie, /HttpOnly/);
assert.match(sessionSetCookie, /Secure/);
assert.match(sessionSetCookie, /SameSite=Lax/);
assert(setCookies.some((c) => c.startsWith('__Host-enlace_oauth=;')), 'La cookie temporal de OAuth se borra');
const adminSession = cookiesFrom(ok);
const profile = await (await me(adminSession)).json();
assert.equal(profile.id, 'user-chatgpt-1', 'Se vinculó con la cuenta existente por correo verificado');
assert.equal(profile.role, 'admin');
assert.equal(profile.name, 'Dr. Rodrigo Vela', 'No sobrescribe el nombre que ya tenía');
const courses = await (await fetchWorker('/api/courses', { headers: { cookie: cookieHeader(adminSession) } })).json();
assert.equal(courses[0].id, 'c1');
checks += 4;

// Segundo inicio de sesión: misma identidad de Google, mismo usuario.
const again = await googleLogin({ sub: 'g-111', email: 'coordinacion@example.test' });
assert.equal((await (await me(cookiesFrom(again))).json()).id, 'user-chatgpt-1');

assert.equal((await googleLogin({ sub: 'g-2', email: 'a@example.test' }, { tamperState: true })).headers.get('location'), '/?login_error=expired');
assert.equal((await googleLogin({ sub: 'g-2', email: 'a@example.test', email_verified: false })).headers.get('location'), '/?login_error=unverified');
assert.equal((await googleLogin({ sub: 'g-2', email: 'a@example.test', aud: 'otra-app' })).headers.get('location'), '/?login_error=google');
assert.equal((await googleLogin({ sub: 'g-2', email: 'a@example.test', nonce: 'repetido' })).headers.get('location'), '/?login_error=google');
assert.equal((await googleLogin({ sub: 'g-2', email: 'a@example.test' }, { returnTo: '//evil.test/robar' })).headers.get('location'), '/', 'Sin redirección abierta');

const restricted = { ...baseEnv, ALLOWED_EMAIL_DOMAINS: 'alumno.buap.mx, correo.buap.mx' };
assert.equal((await googleLogin({ sub: 'g-3', email: 'x@gmail.com' }, { env: restricted })).headers.get('location'), '/?login_error=domain');
assert.equal((await googleLogin({ sub: 'g-4', email: 'ana@alumno.buap.mx' }, { env: restricted })).headers.get('location'), '/');

// Alumno nuevo inscrito por correo antes de su primer acceso: queda vinculado a su inscripción.
store.raw().prepare("INSERT INTO aula_members (id,course,email,name,role) VALUES ('m1','c1','luis@example.test','Luis','student')").run();
const student = cookiesFrom(await googleLogin({ sub: 'g-5', email: 'luis@example.test', name: 'Luis Gómez' }));
const studentProfile = await (await me(student)).json();
assert.equal(studentProfile.role, 'student');
assert.equal(studentProfile.name, 'Luis Gómez');
assert.equal((await (await fetchWorker('/api/courses', { headers: { cookie: cookieHeader(student) } })).json()).length, 1);
checks += 3;

// Revocación: subir session_version invalida las cookies emitidas antes.
store.raw().prepare("UPDATE aula_users SET session_version=2 WHERE email='luis@example.test'").run();
assert.equal((await me(student)).status, 401);
checks++;

// Cerrar sesión: exige mismo origen, borra la cookie y la revoca en el servidor
// (una copia de la cookie ya no sirve), sin cerrar la sesión de otros dispositivos.
const adminPhone = cookiesFrom(await googleLogin({ sub: 'g-1', email: 'Coordinacion@Example.test', name: 'Coordinación' }));
assert.equal((await me(adminPhone)).status, 200);
assert.equal((await fetchWorker('/auth/logout', { method: 'POST', headers: { Origin: 'https://evil.test', 'X-Aula-Request': '1' } })).status, 403);
const logout = await fetchWorker('/auth/logout', { method: 'POST', headers: { Origin: ORIGIN, 'X-Aula-Request': '1', cookie: cookieHeader(adminSession) } });
assert.equal(logout.status, 200);
assert.match(logout.headers.getSetCookie()[0], /^__Host-enlace_session=; Max-Age=0/);
assert.equal((await me(adminSession)).status, 401, 'La cookie copiada deja de servir tras cerrar sesión');
assert.equal((await me(adminPhone)).status, 200, 'El otro dispositivo sigue con su sesión');
checks += 4;

// Cerrar sesión en todos los dispositivos.
const adminTablet = cookiesFrom(await googleLogin({ sub: 'g-1', email: 'coordinacion@example.test' }));
const all = await fetchWorker('/api/logout-all', { method: 'POST', headers: { Origin: ORIGIN, 'X-Aula-Request': '1', cookie: cookieHeader(adminPhone) } });
assert.equal(all.status, 200);
assert.match(all.headers.getSetCookie()[0], /^__Host-enlace_session=; Max-Age=0/);
assert.equal((await me(adminPhone)).status, 401);
assert.equal((await me(adminTablet)).status, 401);
assert.equal((await me(cookiesFrom(await googleLogin({ sub: 'g-1', email: 'coordinacion@example.test' })))).status, 200, 'Puede volver a entrar');
checks += 4;

// Una cookie firmada con un id de sesión inventado no sirve.
const forgedToken = await (await import('../src/server/http.js')).signToken(
  { uid: profile.id, sid: 'inventada', ver: 2, exp: Date.now() / 1000 + 600 },
  baseEnv.SESSION_SECRET,
);
assert.equal((await me(['__Host-enlace_session=' + forgedToken])).status, 401);
checks++;

// Sin SESSION_SECRET el servidor lo dice con claridad en lugar de fallar en silencio.
const noSecret = await fetchWorker('/api/me', { headers: { cookie: cookieHeader(adminSession) } }, { ...baseEnv, SESSION_SECRET: '' });
assert.equal(noSecret.status, 503);
assert.match((await noSecret.json()).error, /SESSION_SECRET/);
checks++;

// Un error inesperado de la base en el regreso de Google lleva a la pantalla de acceso con aviso, no a un JSON.
const rota = { ...baseEnv, DB: { prepare: () => { throw new Error('no such table: aula_identities'); } } };
const fallo = await googleLogin({ sub: 'g-rota', email: 'rota@example.test' }, { env: rota });
assert.equal(fallo.status, 302);
assert.equal(fallo.headers.get('location'), '/?login_error=server');
checks++;

// ---- Vigilancia ----
const salud = await fetchWorker('/salud');
assert.equal(salud.status, 200);
assert.deepEqual(await salud.json(), { ok: true, migracion: null }); // el adaptador de pruebas no tiene d1_migrations
const caida = await fetchWorker('/salud', {}, { ...baseEnv, DB: { prepare: () => ({ first: async () => { throw new Error('D1 caída'); } }) } });
assert.equal(caida.status, 503);
// Publicado con el correo de ejemplo de wrangler.toml: la vigilancia debe avisar.
const ejemplo = await fetchWorker('/salud', {}, { ...baseEnv, AULA_OWNER_EMAIL: 'tu-correo@gmail.com' });
assert.equal(ejemplo.status, 503);
assert.match((await ejemplo.json()).problema, /correo de ejemplo/);
checks += 3;

// ---- App instalable (PWA) ----
const manifest = await fetchWorker('/manifest.webmanifest');
assert.match(manifest.headers.get('content-type'), /application\/manifest\+json/);
const m = await manifest.json();
assert.deepEqual([m.display, m.start_url, m.icons.map((i) => i.sizes)], ['standalone', '/?origen=app', ['192x192', '512x512', '512x512']]);
for (const icon of m.icons) {
  const res = await fetchWorker(icon.src);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer()).slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
}
const sw = await fetchWorker('/sw.js');
assert.match(sw.headers.get('content-type'), /javascript/);
assert.match(await sw.text(), /api\|auth/, 'El service worker excluye la API');
checks += 5;

// ---- Aviso de privacidad ----
const page = await fetchWorker('/privacidad');
assert.equal(page.status, 200);
assert.match(await page.text(), /Aviso de privacidad/);
const nuevo = cookiesFrom(await googleLogin({ sub: 'g-priv', email: 'priv@example.test' }));
assert.equal((await (await me(nuevo)).json()).privacyAccepted, false);
const accept = await fetchWorker('/api/privacy/accept', { method: 'POST', headers: { Origin: ORIGIN, 'X-Aula-Request': '1', cookie: cookieHeader(nuevo) }, body: '{}' });
assert.equal(accept.status, 200);
assert.equal((await (await me(nuevo)).json()).privacyAccepted, true);
assert(store.raw().prepare("SELECT privacy_accepted_at FROM aula_users WHERE email='priv@example.test'").get().privacy_accepted_at, 'Se guarda cuándo se aceptó');
checks += 4;

// ---- Microsoft (correo institucional) ----
const TENANT = '11111111-2222-3333-4444-555555555555';
const msEnv = { ...baseEnv, MICROSOFT_CLIENT_ID: 'ms-app', MICROSOFT_CLIENT_SECRET: 'ms-secreto', MICROSOFT_TENANT_ID: TENANT };
async function microsoftLogin(claims, { env = msEnv, tamperState = false } = {}) {
  const start = await fetchWorker('/auth/microsoft/start?return_to=/curso', {}, env);
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get('location'));
  assert.equal(location.origin + location.pathname, `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
  assert.equal(location.searchParams.get('redirect_uri'), ORIGIN + '/auth/microsoft/callback');
  const nonce = location.searchParams.get('nonce');
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
    assert.equal(new URLSearchParams(init.body).get('client_secret'), 'ms-secreto');
    const payload = { iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, tid: TENANT, aud: 'ms-app', exp: Date.now() / 1000 + 300, nonce, oid: 'oid-1', ...claims };
    return new Response(JSON.stringify({ id_token: `${b64({ alg: 'RS256' })}.${b64(payload)}.firma` }), { status: 200 });
  };
  const callback = await fetchWorker(
    `/auth/microsoft/callback?code=abc&state=${tamperState ? 'otro' : location.searchParams.get('state')}`,
    { headers: { cookie: cookieHeader(cookiesFrom(start)) } },
    env,
  );
  globalThis.fetch = realFetch;
  checks++;
  return callback;
}
for (const tenant of ['', 'common', 'organizations']) {
  const off = await fetchWorker('/auth/microsoft/start', {}, { ...msEnv, MICROSOFT_TENANT_ID: tenant });
  assert.equal(off.headers.get('location'), '/?login_error=microsoft_disabled', 'Sin inquilino fijo no se activa: ' + tenant);
  checks++;
}
const msOnly = await fetchWorker('/api/me', {}, msEnv);
assert.deepEqual((await msOnly.json()).login, { google: true, microsoft: true, email: false });
const upn = 'luis@correo.buap.mx';
assert.equal((await microsoftLogin({ preferred_username: upn }, { tamperState: true })).headers.get('location'), '/?login_error=expired');
assert.equal((await microsoftLogin({ preferred_username: upn, nonce: 'otro' })).headers.get('location'), '/?login_error=microsoft');
assert.equal((await microsoftLogin({ preferred_username: upn, aud: 'otra-app' })).headers.get('location'), '/?login_error=microsoft');
assert.equal((await microsoftLogin({ preferred_username: upn, tid: '99999999-2222-3333-4444-555555555555', iss: 'https://login.microsoftonline.com/99999999-2222-3333-4444-555555555555/v2.0' })).headers.get('location'), '/?login_error=microsoft', 'Otro inquilino');
assert.equal((await microsoftLogin({ preferred_username: 'alguien@gmail.com' })).headers.get('location'), '/?login_error=domain');
const msOk = await microsoftLogin({ preferred_username: 'Luis@Correo.Buap.mx', name: 'Luis Gómez' });
assert.equal(msOk.headers.get('location'), '/curso');
const luisMs = await (await me(cookiesFrom(msOk))).json();
assert.equal(luisMs.email, upn);
// La misma persona que ya entraba con Google (mismo correo) conserva su cuenta.
store.raw().prepare("INSERT INTO aula_users (id,email,name,role) VALUES ('u-previo','ana@correo.buap.mx','Ana','student')").run();
const anaMs = await microsoftLogin({ preferred_username: 'ana@correo.buap.mx', oid: 'oid-ana' });
assert.equal((await (await me(cookiesFrom(anaMs))).json()).id, 'u-previo');
checks += 3;

// ---- Enlace por correo (solo con dominio verificado en Resend) ----
const post = (path, body, env) =>
  fetchWorker(path, { method: 'POST', headers: { Origin: ORIGIN, 'X-Aula-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
assert.equal((await post('/auth/email/start', { email: 'x@example.test' })).status, 404, 'Apagado si no está configurado');
checks++;

const emailEnv = { ...baseEnv, RESEND_API_KEY: 're_prueba', EMAIL_FROM: 'Enlace <aula@fisica.example>' };
assert.deepEqual((await (await fetchWorker('/api/me', {}, emailEnv)).json()).login, { google: true, microsoft: false, email: true });
const sent = [];
globalThis.fetch = async (url, init) => {
  sent.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.Authorization });
  return new Response('{"id":"1"}', { status: 200 });
};
assert.equal((await post('/auth/email/start', { email: 'Maria@example.test', return_to: '/?x=1' }, emailEnv)).status, 200);
globalThis.fetch = realFetch;
assert.equal(sent[0].url, 'https://api.resend.com/emails');
assert.equal(sent[0].auth, 'Bearer re_prueba');
assert.deepEqual(sent[0].body.to, ['maria@example.test']);
const link = new URL(sent[0].body.text.match(/https:\S+/)[0]);
const token = link.searchParams.get('token');
checks += 2;

// El GET solo muestra un botón (los filtros de correo abren los enlaces por su cuenta).
const confirmPage = await fetchWorker(link.pathname + link.search, {}, emailEnv);
assert.match(await confirmPage.text(), /<form method="post" action="\/auth\/email\/verify">/);
assert.match(confirmPage.headers.get('content-security-policy'), /frame-ancestors 'none'/);
const verify = (t, origin = ORIGIN) =>
  fetchWorker('/auth/email/verify', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=' + t }, emailEnv);
assert.equal((await verify(token, 'https://evil.test')).status, 403);
const viaEmail = await verify(token);
assert.equal(viaEmail.headers.get('location'), '/?x=1');
assert.equal((await (await fetchWorker('/api/me', { headers: { cookie: cookieHeader(cookiesFrom(viaEmail)) } }, emailEnv)).json()).email, 'maria@example.test');
assert.equal((await verify(token)).headers.get('location'), '/?login_error=link', 'Cada enlace sirve una sola vez');
checks += 4;

// Dos clics simultáneos en el mismo enlace: ambas solicitudes leen el token antes de que la otra lo marque.
// Se simula de forma determinista entregando a la segunda lectura la fila tal como estaba en la primera.
globalThis.fetch = async (url, init) => {
  sent.push({ body: JSON.parse(init.body) });
  return new Response('{"id":"2"}', { status: 200 });
};
await post('/auth/email/start', { email: 'rosa@example.test' }, emailEnv);
globalThis.fetch = realFetch;
const raceToken = new URL(sent.at(-1).body.text.match(/https:\S+/)[0]).searchParams.get('token');
const snapshots = new Map();
const staleDB = {
  ...store.DB,
  prepare(sql) {
    const statement = store.DB.prepare(sql);
    if (!sql.startsWith('SELECT * FROM aula_login_tokens')) return statement;
    let key;
    return {
      bind(...params) {
        key = params.join('|');
        statement.bind(...params);
        return this;
      },
      async first() {
        if (!snapshots.has(key)) snapshots.set(key, await statement.first());
        return snapshots.get(key);
      },
    };
  },
};
const staleEnv = { ...emailEnv, DB: staleDB };
const verifyStale = () =>
  fetchWorker('/auth/email/verify', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=' + raceToken }, staleEnv);
assert.equal((await verifyStale()).headers.get('location'), '/');
assert.equal((await verifyStale()).headers.get('location'), '/?login_error=link', 'El reclamo atómico impide usar el enlace dos veces');
checks++;

globalThis.fetch = async () => new Response('{}', { status: 200 });
for (let i = 0; i < 2; i++) assert.equal((await post('/auth/email/start', { email: 'maria@example.test' }, emailEnv)).status, 200);
assert.equal((await post('/auth/email/start', { email: 'maria@example.test' }, emailEnv)).status, 429, 'Límite de envíos');
globalThis.fetch = realFetch;
checks++;

// ---- La interfaz se sirve con CSP y sin la antigua ruta de ChatGPT ----
const home = await fetchWorker('/');
assert.equal(home.status, 200);
assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
const html = await home.text();
assert(!html.includes('signout-with-chatgpt'), 'Ya no hay rutas de ChatGPT Sites');
assert.match(html, /data-action="logout"/);
checks += 2;

store.close();
console.log(`PASS: ${checks} verificaciones de acceso — Google (estado, nonce, audiencia, correo verificado, dominios), vinculación con cuentas previas, Microsoft (inquilino fijo, dominios), enlace por correo de un solo uso, aviso de privacidad, revocación y cierre de sesión.`);
