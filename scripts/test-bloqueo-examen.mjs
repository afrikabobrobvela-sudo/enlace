// Pruebas del bloqueo al salir en el modo examen: si el alumno sale de la página más que la tolerancia, el intento
// queda bloqueado en el servidor (no guarda ni se envía) hasta escribir el código que solo ve su docente, o hasta que
// el docente lo deje continuar. También al retomar tras cerrar el navegador. Sin la opción, nada cambia.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
let checks = 0;
const cookies = {};
async function call(who, path, data, status = 200) {
  cookies[who] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who }), env);
  const before = store.counter.queries;
  const res = await api(
    new Request('https://t.local' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { cookie: cookies[who], Origin: 'https://t.local', 'X-Aula-Request': '1' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${who}) → ${text}`);
  assert(store.counter.queries - before <= 50);
  checks++;
  return JSON.parse(text);
}

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '501' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: ['ana', 'beto', 'carla'].map((n) => ({ name: n, email: n + '@example.test' })) });
const preguntas = [
  { type: 'choice', text: 'Unidad de fuerza', options: ['J', 'N'], correct: 1 },
  { type: 'choice', text: 'Unidad de energía', options: ['J', 'N'], correct: 0 },
];
const examen = (exam) => call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Parcial', visible: true, questions: preguntas, settings: { attempts: 1, timeLimit: 60, exam: { enabled: true, ...exam } } } }, 201);
const q = await examen({ lockOnLeave: true, lockGrace: 5 });
assert.deepEqual([q.data.settings.exam.lockOnLeave, q.data.settings.exam.lockGrace], [true, 5]);
// Una tolerancia que no está en la lista vuelve a 5 s.
assert.equal((await examen({ lockOnLeave: true, lockGrace: 99 })).data.settings.exam.lockGrace, 5);
checks += 2;

const ctx = (quiz, extra = {}) => ({ course: c, quiz: quiz.id, attempt: 1, ...extra });
const monitor = async () => (await call('docente', `/api/exam/monitor?course=${c}&quiz=${q.id}`)).running;
const startsRow = (who) => store.raw().prepare('SELECT * FROM aula_attempt_starts WHERE quiz=? AND user_id=(SELECT id FROM aula_users WHERE email=?)').get(q.id, who + '@example.test');

// ---- Al empezar: el alumno sabe que hay bloqueo, pero no ve ningún código ----
const inicio = await call('ana', '/api/attempt/start', ctx(q));
assert.deepEqual([inicio.exam.lockOnLeave, inicio.exam.lockGrace, inicio.exam.locked], [true, 5, false]);
checks++;

// ---- Salida corta (dentro de la tolerancia): no se bloquea ----
await call('ana', '/api/attempt/away', ctx(q));
assert(startsRow('ana').away_since);
assert.equal((await call('ana', '/api/attempt/back', ctx(q, { seconds: 2 }))).locked, false);
assert.equal(startsRow('ana').away_since, null);
await call('ana', '/api/attempt/progress', ctx(q, { answers: { 0: 1 }, position: 0 }));
checks += 2;

// ---- Salida larga: se bloquea; no guarda ni se envía ----
await call('ana', '/api/attempt/away', ctx(q));
assert.equal((await call('ana', '/api/attempt/back', ctx(q, { seconds: 40 }))).locked, true);
let enMonitor = (await monitor()).find((r) => r.name === 'ana');
assert.equal(enMonitor.locked, true);
assert.match(enMonitor.unlockCode, /^\d{6}$/);
assert.equal(enMonitor.locks, 1);
const codigo1 = enMonitor.unlockCode;
let bloqueado = await call('ana', '/api/attempt/progress', ctx(q, { answers: { 0: 0 } }), 423);
assert.equal(bloqueado.locked, true);
assert.match(bloqueado.error, /código/);
await call('ana', '/api/attempt', { course: c, quiz: q.id, answers: { 0: 1, 1: 0 } }, 423);
assert.equal(JSON.parse(startsRow('ana').progress)[0], 1, 'Lo guardado antes del bloqueo se conserva');
// Recargar la página no lo desbloquea, y el alumno nunca recibe el código.
const retomado = await call('ana', '/api/attempt/start', ctx(q));
assert.equal(retomado.exam.locked, true);
assert(!JSON.stringify(retomado).includes(codigo1));
assert(!JSON.stringify(await call('ana', '/api/course?id=' + c)).includes(codigo1));
await call('ana', `/api/exam/monitor?course=${c}&quiz=${q.id}`, undefined, 403);
await call('ana', '/api/exam/resume', { course: c, quiz: q.id, user: startsRow('ana').user_id }, 403);
checks += 9;

// ---- Código: con espacios se acepta; equivocado cuenta; a los 5 errores solo el docente ----
const mal = await call('ana', '/api/attempt/unlock', ctx(q, { code: '000000' === codigo1 ? '111111' : '000000' }), 400);
assert.match(mal.error, /quedan 4 intentos/);
await call('ana', '/api/attempt/unlock', ctx(q, { code: `${codigo1.slice(0, 3)} ${codigo1.slice(3)}` }));
assert.equal(startsRow('ana').locked_at, null);
await call('ana', '/api/attempt/progress', ctx(q, { answers: { 0: 1 } }));
checks += 2;

// Segundo bloqueo: el servidor midió la salida aunque el navegador diga 0 s (el aviso de salida llegó).
await call('ana', '/api/attempt/away', ctx(q));
store.raw().prepare("UPDATE aula_attempt_starts SET away_since=? WHERE user_id=(SELECT id FROM aula_users WHERE email='ana@example.test')").run(new Date(Date.now() - 60_000).toISOString());
assert.equal((await call('ana', '/api/attempt/back', ctx(q, { seconds: 0 }))).locked, true);
enMonitor = (await monitor()).find((r) => r.name === 'ana');
assert.notEqual(enMonitor.unlockCode, codigo1, 'Un código nuevo en cada bloqueo');
for (let i = 0; i < 4; i++) await call('ana', '/api/attempt/unlock', ctx(q, { code: 'x' + i }), 400);
await call('ana', '/api/attempt/unlock', ctx(q, { code: 'zz' }), 429);
await call('ana', '/api/attempt/unlock', ctx(q, { code: enMonitor.unlockCode }), 429); // ya ni con el correcto
assert.equal((await monitor()).find((r) => r.name === 'ana').unlockFailures, 5);
await call('docente', '/api/exam/resume', { course: c, quiz: q.id, user: startsRow('ana').user_id });
await call('docente', '/api/exam/resume', { course: c, quiz: q.id, user: startsRow('ana').user_id }, 409);
// Ahora sí envía; el resumen de integridad cuenta los bloqueos.
const enviado = await call('ana', '/api/attempt', { course: c, quiz: q.id, answers: { 0: 1, 1: 0 } }, 201);
assert.equal(enviado.data.integrity.locks, 2);
assert.deepEqual(
  enviado.data.integrity.events.filter((e) => ['locked', 'unlocked'].includes(e.kind)).map((e) => e.kind + (e.by ? ':' + e.by : '')),
  ['locked', 'unlocked:code', 'locked', 'unlocked:teacher'],
);
checks += 5;

// ---- Cerró el navegador fuera del examen y volvió a entrar: al retomar queda bloqueado ----
await call('beto', '/api/attempt/start', ctx(q));
await call('beto', '/api/attempt/away', ctx(q));
store.raw().prepare("UPDATE aula_attempt_starts SET away_since=? WHERE user_id=(SELECT id FROM aula_users WHERE email='beto@example.test')").run(new Date(Date.now() - 30_000).toISOString());
assert.equal((await call('beto', '/api/attempt/start', ctx(q))).exam.locked, true);
// Si volvió dentro de la tolerancia, no.
await call('carla', '/api/attempt/start', ctx(q));
await call('carla', '/api/attempt/away', ctx(q));
assert.equal((await call('carla', '/api/attempt/start', ctx(q))).exam.locked, false);
checks += 2;

// ---- Tolerancia cero: cualquier salida bloquea ----
const estricto = await examen({ lockOnLeave: true, lockGrace: 0 });
await call('beto', '/api/attempt/start', ctx(estricto));
await call('beto', '/api/attempt/away', ctx(estricto));
assert.equal((await call('beto', '/api/attempt/back', ctx(estricto, { seconds: 1 }))).locked, true);
checks++;

// ---- Sin la opción: salir solo se registra, como antes ----
const libre = await examen({ lockOnLeave: false });
assert.equal(libre.data.settings.exam.lockGrace, 0);
await call('carla', '/api/attempt/start', ctx(libre));
await call('carla', '/api/attempt/away', ctx(libre));
assert.equal((await call('carla', '/api/attempt/back', ctx(libre, { seconds: 300 }))).locked, false);
await call('carla', '/api/attempt/progress', { course: c, quiz: libre.id, attempt: 1, events: [{ kind: 'left', seconds: 300 }] });
await call('carla', '/api/attempt', { course: c, quiz: libre.id, answers: { 0: 1, 1: 0 } }, 201);
checks += 2;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones del bloqueo al salir — tolerancia, bloqueo en el servidor (sin guardar ni enviar), código solo para el docente, 5 intentos, desbloqueo del docente, al retomar y sin la opción.`);
