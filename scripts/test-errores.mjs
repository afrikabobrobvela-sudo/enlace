// Registro de errores (12.88): un error inesperado se guarda con el número que ve la persona, el navegador reporta los
// suyos, solo la administración los lee, hay tope, la alerta llega por correo una vez y /salud la refleja.
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { checkErrorAlert, errorId, recordError } from '../src/server/errores.js';
import { PUSH_CRON } from '../src/server/push.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

let checks = 0;
const store = openD1(':memory:');
// Base que puede fallar a propósito: si `breakOn` aparece en la consulta, D1 «se cae».
let breakOn = null;
const db = new Proxy(store.DB, {
  get(target, prop) {
    if (prop === 'prepare') return (sql) => (breakOn && sql.includes(breakOn) ? { bind: () => ({ all: fail, first: fail, run: fail }), all: fail, first: fail, run: fail } : target.prepare(sql));
    const value = target[prop];
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
const fail = async () => {
  throw new Error('D1_ERROR: fallo simulado');
};
const mails = [];
const env = { DB: db, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40), MAILER: async (m) => (mails.push(m), true), ENLACE_URL: 'https://t.local' };
const cookies = {};
async function call(who, path, data, status = 200) {
  if (who) cookies[who] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who[0].toUpperCase() + who.slice(1) }), env);
  const res = await api(
    new Request('https://t.local' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { ...(who ? { cookie: cookies[who] } : {}), Origin: 'https://t.local', 'X-Aula-Request': '1' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${who}) → ${text}`);
  checks++;
  return JSON.parse(text);
}
const rows = (kind) => store.DB.prepare('SELECT * FROM aula_errors WHERE kind=? ORDER BY at').bind(kind).all().then((r) => r.results);

assert.match(errorId(), /^E-[2-9A-HJKMNP-Z]{6}$/, 'Número corto sin letras confusas');
await call('admin', '/api/me');
await call('ana', '/api/me');

// Un error inesperado: la persona recibe un número y el error queda guardado con ese número, la ruta y quién fue.
breakOn = 'FROM aula_courses';
const roto = await call('ana', '/api/courses', undefined, 500);
breakOn = null;
assert.match(roto.error, /\(error E-[2-9A-Z]{6}\)/);
assert.match(roto.error, /comparte este código/);
const [api500] = await rows('api');
assert.equal(api500.id, roto.errorId);
assert.equal(api500.route, 'GET /api/courses');
assert.match(api500.message, /fallo simulado/);
assert.ok(api500.user_id && api500.detail.includes('Error'), 'Lleva quién y la pila');
// Un aviso normal (403, 404) no es un error del sistema: no se guarda.
await call('ana', '/api/errors', undefined, 403);
await call('ana', '/api/no-existe', undefined, 404);
assert.equal((await rows('api')).length, 1);
checks += 6;

// El navegador reporta sus errores (con sesión); sin sesión no se acepta.
const cliente = await call('ana', '/api/client-error', { message: 'TypeError: x is undefined', source: 'https://t.local/app.js', line: 12, column: 4, stack: 'at render (app.js:12)', page: '/#c=1&s=tasks' });
assert.match(cliente.id, /^E-/);
await call(null, '/api/client-error', { message: 'sin sesión' }, 401);
const [js] = await rows('cliente');
assert.equal(js.message, 'TypeError: x is undefined');
assert.equal(JSON.parse(js.detail).line, 12);
// Textos enormes o con caracteres de control se recortan.
await call('ana', '/api/client-error', { message: 'x'.repeat(5000) + '\u0000' });
assert.equal((await rows('cliente'))[1].message.length, 500);
checks += 3;

// Solo la administración los lee, con el nombre de la persona.
const lista = await call('admin', '/api/errors?days=7');
assert.equal(lista.errors.length, 3);
assert.equal(lista.errors.find((e) => e.id === roto.errorId).email, 'ana@example.test');
assert.deepEqual(lista.last24h, { api: 1, cliente: 2 });
checks += 3;

// Tope de errores del navegador por hora para todo Enlace.
await store.DB.prepare(`INSERT INTO aula_errors (id, at, kind) SELECT 'T-' || value, ?, 'cliente' FROM json_each(?)`).bind(new Date().toISOString(), JSON.stringify(Array.from({ length: 300 }, (_, i) => i))).run();
assert.equal((await call('ana', '/api/client-error', { message: 'otro más' })).ok, false, 'Pasado el tope ya no se guarda');
checks++;

// recordError nunca lanza, aunque la base esté caída.
breakOn = 'INSERT INTO aula_errors';
const brokenBatch = { ...env, DB: { prepare: () => ({ bind: () => ({}) }), batch: fail } };
assert.match(await recordError(brokenBatch.DB, { kind: 'api', message: 'x' }), /^E-/);
breakOn = null;
checks++;

// Alerta: con muchos errores en la hora llega un correo a la cuenta principal, y no se repite en 6 horas.
await store.DB.prepare('DELETE FROM aula_errors').run();
for (let i = 0; i < 10; i++) await recordError(store.DB, { kind: 'api', route: 'POST /api/record', message: 'D1_ERROR: lento' });
const salud = async () => (await worker.fetch(new Request('https://t.local/salud'), env, { waitUntil() {} })).json();
assert.equal((await salud()).alerta, true, '/salud avisa (la vigilancia de GitHub falla y manda correo)');
const alerta = await checkErrorAlert(store.DB, env);
assert.deepEqual([alerta.alerted, alerta.sent], [true, true]);
assert.equal(mails.length, 1);
assert.equal(mails[0].to, 'admin@example.test');
assert.match(mails[0].subject, /10 errores del servidor/);
assert.match(mails[0].text, /10 × D1_ERROR: lento/);
assert.equal((await checkErrorAlert(store.DB, env)).alerted, false, 'Un aviso cada 6 horas');
assert.equal(mails.length, 1);
checks += 7;
// Pocos errores: ni correo ni alerta.
await store.DB.prepare('DELETE FROM aula_errors').run();
await recordError(store.DB, { kind: 'api', message: 'uno' });
assert.equal((await checkErrorAlert(store.DB, env)).alerted, false);
assert.equal((await salud()).alerta, false);
checks += 2;

// Una tarea programada que falla queda registrada como 'tarea'.
breakOn = 'checkin_secret IS NOT NULL';
const pending = [];
await worker.scheduled({ cron: PUSH_CRON }, env, { waitUntil: (p) => pending.push(p) });
await Promise.all(pending);
breakOn = null;
const [tarea] = await rows('tarea');
assert.equal(tarea.route, 'aula-asistencia programada');
assert.match(tarea.message, /fallo simulado/);
checks += 2;

console.log(`PASS: ${checks} verificaciones del registro de errores — número de error para la persona, errores del navegador con sesión y tope, solo la administración los lee, alerta por correo una vez cada 6 h, /salud y tareas programadas.`);
