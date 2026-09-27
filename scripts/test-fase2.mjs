// Pruebas de la fase 2A: registro de asistencia con código QR (firma rotativa, PIN, un teléfono por alumno).
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'docente@example.test', SESSION_SECRET: 'q'.repeat(40) };
let checks = 0;
const cookies = {};
async function call(user, path, data, status = 200, method = data === undefined ? 'GET' : 'POST') {
  cookies[user] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user }),
    env,
  );
  const res = await api(
    new Request('https://t.local' + path, {
      method,
      headers: { cookie: cookies[user], Origin: 'https://t.local', 'X-Aula-Request': '1' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  const text = await res.text();
  assert.equal(res.status, status, `${method} ${path} → ${text}`);
  checks++;
  return JSON.parse(text);
}

// Firma independiente (misma definición que el cliente: HMAC-SHA256 de "código.ventana", base64url, 16 caracteres).
const WINDOW = 10_000;
const token = (open, offset = 0) => {
  const w = Math.floor(Date.now() / WINDOW) + offset;
  const sig = createHmac('sha256', Buffer.from(open.secret, 'base64url')).update(`${open.code}.${w}`).digest('base64url').slice(0, 16);
  return `${open.code}.${w.toString(36)}.${sig}`;
};

const c = (await call('docente', '/api/courses', { name: 'Física I', group: '101' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: ['ana', 'luis', 'sofia', 'rosa'].map((n) => ({ name: n, email: n + '@example.test' })) });
for (const n of ['ana', 'luis', 'sofia', 'rosa', 'intruso']) await call(n, '/api/me');
const roster = (await call('docente', '/api/course?id=' + c)).members;
const id = (n) => roster.find((m) => m.email === n + '@example.test').id;
const session = (await call('docente', '/api/attendance/session', { course: c, date: '2026-09-28', start_time: '07:00' }, 201)).id;

// ---- Apertura ----
await call('ana', '/api/attendance/checkin/open', { course: c, session }, 403);
await call('docente', '/api/attendance/checkin/open', { course: c, session, minutes: 0 }, 400);
let open = await call('docente', '/api/attendance/checkin/open', { course: c, session, minutes: 15 });
assert.match(open.code, /^[A-Za-z0-9_-]{8}$/);
assert.match(open.pin, /^\d{4}$/);
assert.equal(open.windowMs, WINDOW);
const status = await call('docente', `/api/attendance/session?course=${c}&id=${session}`);
assert.equal(status.checkin.code, open.code, 'El docente puede retomar la pantalla del QR tras recargar');
await call('ana', `/api/attendance/session?course=${c}&id=${session}`, undefined, 403);

// ---- Escaneo con PIN ----
const scan = (who, device, t = token(open), code = 200) => call(who, '/api/attendance/checkin', { token: t, device }, code);
const first = await scan('ana', 'telefono-de-ana');
assert.equal(first.needPin, true);
assert.equal(first.course, 'Física I');
const wrong = await call('ana', '/api/attendance/checkin/pin', { claim: first.claim, pin: open.pin === '0000' ? '1111' : '0000' }, 400);
assert.match(wrong.error, /Te quedan 4 intentos/);
const ok = await call('ana', '/api/attendance/checkin/pin', { claim: first.claim, pin: open.pin });
assert.deepEqual(ok, { course: 'Física I', date: '2026-09-28', start_time: '07:00', status: 'present' });
assert.equal((await scan('ana', 'telefono-de-ana')).already, true, 'Escanear de nuevo no duplica ni cambia nada');

// Permiso robado: el claim de Ana no sirve para otra cuenta.
await call('luis', '/api/attendance/checkin/pin', { claim: first.claim, pin: open.pin }, 410);

// Un teléfono, un alumno: Luis intenta registrarse con el teléfono de Ana.
const luisOnAnasPhone = await scan('luis', 'telefono-de-ana');
const reuse = await call('luis', '/api/attendance/checkin/pin', { claim: luisOnAnasPhone.claim, pin: open.pin }, 409);
assert.match(reuse.error, /propio teléfono/);
const luis = await scan('luis', 'telefono-de-luis');
assert.equal((await call('luis', '/api/attendance/checkin/pin', { claim: luis.claim, pin: open.pin })).status, 'present');

// ---- Códigos inválidos ----
await scan('rosa', 'telefono-de-rosa', token(open, -3), 410); // hace ~30 s: foto reenviada
await scan('rosa', 'telefono-de-rosa', token(open, 5), 410); // del futuro
const t = token(open);
await scan('rosa', 'telefono-de-rosa', t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'), 400); // firma alterada
await scan('rosa', 'telefono-de-rosa', 'basura', 400);
await scan('rosa', 'x', token(open), 400); // dispositivo no válido
await scan('intruso', 'telefono-intruso', token(open), 403);
await scan('docente', 'telefono-docente', token(open), 403);
assert(open.pin !== '', 'El PIN viene activado por omisión');

// ---- PIN por fuerza bruta: 5 intentos y queda bloqueado ----
let sofia = await scan('sofia', 'telefono-de-sofia');
const badPin = open.pin === '9999' ? '8888' : '9999';
for (let i = 0; i < 4; i++) await call('sofia', '/api/attendance/checkin/pin', { claim: sofia.claim, pin: badPin }, 400);
await call('sofia', '/api/attendance/checkin/pin', { claim: sofia.claim, pin: badPin }, 429);
await call('sofia', '/api/attendance/checkin/pin', { claim: sofia.claim, pin: open.pin }, 429);
await scan('sofia', 'telefono-de-sofia', token(open), 429);

// ---- Retardo: registro abierto hace 12 minutos con retardo a partir de 10 ----
open = await call('docente', '/api/attendance/checkin/open', { course: c, session, minutes: 30, pin: false, late_minutes: 10 });
assert.equal(open.pin, '');
store.raw().prepare('UPDATE aula_sessions SET checkin_started=? WHERE id=?').run(new Date(Date.now() - 12 * 60_000).toISOString(), session);
assert.equal((await scan('rosa', 'telefono-de-rosa', token(open))).status, 'late', 'Sin PIN se registra al escanear, con retardo');
const oldToken = token(open);

// ---- Cierre ----
await call('docente', '/api/attendance/checkin/close', { course: c, session });
await scan('sofia', 'telefono-de-sofia', oldToken, 410);
const after = await call('docente', `/api/attendance/session?course=${c}&id=${session}`);
assert.equal(after.checkin, null);
assert.deepEqual(
  after.records.map((r) => [r.member, r.status, r.note]).sort(),
  [[id('ana'), 'present', 'Registro con QR'], [id('luis'), 'present', 'Registro con QR'], [id('rosa'), 'late', 'Registro con QR']].sort(),
);
// Un código reabierto es otro: el QR anterior ya no sirve.
const reopened = await call('docente', '/api/attendance/checkin/open', { course: c, session, minutes: 5 });
assert.notEqual(reopened.code, open.code);
await scan('sofia', 'telefono-de-sofia', oldToken, 410);

// Borrar la sesión limpia también los registros de dispositivo.
await call('docente', '/api/attendance/session', { course: c, id: session }, 200, 'DELETE');
assert.equal(store.raw().prepare('SELECT count(*) AS n FROM aula_checkins').get().n, 0);
assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
checks += 4;
store.close();
console.log(`PASS: ${checks} verificaciones del registro con QR — firma que caduca, PIN con intentos limitados, un teléfono por alumno, retardos y cierre.`);
