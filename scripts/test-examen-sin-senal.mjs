// Pruebas de la 12.91: el modo avión ya no esconde las salidas del examen. Con el teléfono sin conexión, el aviso de
// salida (/api/attempt/away) y el de regreso (/api/attempt/back) no llegan; el navegador guarda la salida y la manda
// con el siguiente guardado (/api/attempt/progress), y el servidor decide el bloqueo con las mismas reglas. Además:
// la última señal (`last_seen`), el silencio que mide el servidor, el bloqueo al retomar tras un silencio largo, el
// estado en vivo del monitor y la opción «preparar el teléfono».
import assert from 'node:assert/strict';
import { api, SHORT_EXITS_LOCK, SILENCE_SECONDS } from '../src/server/api.js';
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
const alumnos = ['ana', 'beto', 'carla', 'dani', 'eva', 'fer'];
await call('docente', '/api/members/bulk', { course: c, students: alumnos.map((n) => ({ name: n, email: n + '@example.test' })) });
const preguntas = [
  { type: 'choice', text: 'Unidad de fuerza', options: ['J', 'N'], correct: 1 },
  { type: 'choice', text: 'Unidad de energía', options: ['J', 'N'], correct: 0 },
];
const examen = (title, exam) => call('docente', '/api/record', { course: c, kind: 'quiz', data: { title, visible: true, questions: preguntas, settings: { attempts: 1, timeLimit: 60, exam: { enabled: true, ...exam } } } }, 201);
const q = await examen('Parcial', { lockOnLeave: true, lockGrace: 5 });
const libre = await examen('Práctica', { lockOnLeave: false });

const ctx = (quiz, extra = {}) => ({ course: c, quiz: quiz.id, attempt: 1, ...extra });
const row = (quiz, who) => store.raw().prepare('SELECT * FROM aula_attempt_starts WHERE quiz=? AND user_id=(SELECT id FROM aula_users WHERE email=?)').get(quiz.id, who + '@example.test');
const events = (quiz, who) => JSON.parse(row(quiz, who).events);
const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
const setSeen = (quiz, who, seconds) =>
  store.raw().prepare('UPDATE aula_attempt_starts SET last_seen=? WHERE quiz=? AND user_id=(SELECT id FROM aula_users WHERE email=?)').run(ago(seconds), quiz.id, who + '@example.test');
const monitor = async (quiz) => (await call('docente', `/api/exam/monitor?course=${c}&quiz=${quiz.id}`)).running;

// ---- Preparar el teléfono: activo por omisión; se puede apagar ----
const visto = (await call('ana', '/api/course?id=' + c)).records.find((r) => r.id === q.id);
assert.equal(visto.data.settings.exam.prepareDevice, true, 'Por omisión se pide preparar el teléfono');
const sinPreparar = await examen('Sin preparar', { prepareDevice: false });
assert.equal(sinPreparar.data.settings.exam.prepareDevice, false);
checks += 2;

// ---- La última señal: al empezar y en cada guardado ----
await call('ana', '/api/attempt/start', ctx(q));
assert(row(q, 'ana').last_seen, 'Empezar anota la señal');
setSeen(q, 'ana', 10);
await call('ana', '/api/attempt/progress', ctx(q, { answers: { 0: 1 }, position: 0 }));
assert(Date.now() - Date.parse(row(q, 'ana').last_seen) < 5000, 'El latido (un guardado) renueva la señal');
checks += 2;

// ---- Modo avión: salió 40 s sin conexión; ni /away ni /back llegaron. Llega con el siguiente guardado y bloquea ----
store.raw().prepare("UPDATE aula_attempt_starts SET started=? WHERE quiz=? AND user_id=(SELECT id FROM aula_users WHERE email='ana@example.test')").run(ago(300), q.id);
setSeen(q, 'ana', 50);
const salida = ago(48);
const r1 = await call('ana', '/api/attempt/progress', ctx(q, { answers: { 0: 1, 1: 0 }, position: 0, events: [{ kind: 'offline', seconds: 47, at: ago(49) }, { kind: 'left', seconds: 40, at: salida }] }), 423);
assert.equal(r1.locked, true);
const ana = row(q, 'ana');
assert(ana.locked_at && ana.unlock_code, 'Quedó bloqueado con su código');
assert.deepEqual(JSON.parse(ana.progress), { 0: 1, 1: 0 }, 'Las respuestas de ese guardado sí se guardaron');
const anaEvents = events(q, 'ana');
assert.equal(anaEvents.find((e) => e.kind === 'left').at, salida, 'La salida conserva la hora en que ocurrió');
assert.equal(anaEvents.at(-1).kind, 'locked');
assert.equal(anaEvents.at(-1).reason, 'salida sin conexión');
assert(!anaEvents.some((e) => e.kind === 'silence'), 'Con la salida y la desconexión avisadas, no se agrega un «silencio»');
checks += 6;

// Lo que llega mientras está bloqueado se guarda ya «juzgado»: no vuelve a bloquear después del desbloqueo.
await call('ana', '/api/attempt/progress', ctx(q, { events: [{ kind: 'left', seconds: 30 }] }), 423);
assert.equal(events(q, 'ana').at(-1).judged, true);
const codigo = (await monitor(q)).find((r) => r.name === 'ana').unlockCode;
assert.equal((await call('ana', '/api/attempt/unlock', ctx(q, { code: codigo }))).locked, false);
await call('ana', '/api/attempt/progress', ctx(q, { answers: { 0: 1, 1: 0 }, position: 0 }));
assert.equal(row(q, 'ana').locked_at, null, 'Después del desbloqueo no se vuelve a bloquear por lo mismo');
checks += 2;

// ---- Una salida que /back ya juzgó (judged) no vuelve a decidirse ----
await call('beto', '/api/attempt/start', ctx(q));
await call('beto', '/api/attempt/progress', ctx(q, { events: [{ kind: 'left', seconds: 3, judged: true }] }));
assert.equal(row(q, 'beto').locked_at, null);
checks++;

// ---- Salidas cortas sin conexión: a la SHORT_EXITS_LOCK.ª se bloquea, como con /back ----
await call('carla', '/api/attempt/start', ctx(q));
for (let n = 1; n < SHORT_EXITS_LOCK; n++) await call('carla', '/api/attempt/progress', ctx(q, { events: [{ kind: 'left', seconds: 2 }] }));
assert.equal(row(q, 'carla').locked_at, null);
const r2 = await call('carla', '/api/attempt/progress', ctx(q, { events: [{ kind: 'left', seconds: 2 }] }), 423);
assert.equal(r2.locked, true);
assert.equal(events(q, 'carla').at(-1).reason, 'salidas repetidas');
checks += 2;

// ---- Silencio: el teléfono no avisó nada, pero el servidor no supo del examen 2 min. Queda registrado y se ve ----
await call('dani', '/api/attempt/start', ctx(q));
setSeen(q, 'dani', 120);
const enVivo = (await monitor(q)).find((r) => r.name === 'dani');
assert(enVivo.silentFor >= 119, 'El monitor muestra cuánto lleva sin señal');
assert.equal(enVivo.away, false);
await call('dani', '/api/attempt/progress', ctx(q, { answers: { 0: 1 } }));
const silencio = events(q, 'dani').find((e) => e.kind === 'silence');
assert(silencio && silencio.seconds >= 119, 'Se registra el silencio medido por el servidor');
assert.equal(row(q, 'dani').locked_at, null, 'Con la página abierta, un silencio solo se registra (puede ser la red)');
const resumen = (await monitor(q)).find((r) => r.name === 'dani');
assert.equal(resumen.offline, 1);
assert(resumen.offlineSeconds >= 119 && resumen.silentFor < 5);
checks += 5;

// Un silencio corto (un latido de 20 s) no es nada.
setSeen(q, 'dani', SILENCE_SECONDS - 10);
await call('dani', '/api/attempt/progress', ctx(q, { answers: { 0: 1 } }));
assert.equal(events(q, 'dani').filter((e) => e.kind === 'silence').length, 1);
checks++;

// ---- Retomar tras un silencio largo (cerró el navegador sin conexión): con bloqueo al salir, se bloquea ----
await call('eva', '/api/attempt/start', ctx(q));
setSeen(q, 'eva', 90);
const retoma = await call('eva', '/api/attempt/start', ctx(q));
assert.equal(retoma.exam.locked, true);
assert.equal(events(q, 'eva').at(-1).reason, 'retomó tras perder la conexión');
// Recargar enseguida no bloquea.
await call('fer', '/api/attempt/start', ctx(q));
setSeen(q, 'fer', 15);
assert.equal((await call('fer', '/api/attempt/start', ctx(q))).exam.locked, false);
checks += 3;

// Sin bloqueo al salir, el silencio al retomar solo queda registrado.
await call('eva', '/api/attempt/start', ctx(libre));
setSeen(libre, 'eva', 90);
assert.equal((await call('eva', '/api/attempt/start', ctx(libre))).exam.locked, false);
assert.equal(events(libre, 'eva').at(-1).kind, 'silence');
// Y una salida sin conexión se registra sin bloquear.
await call('eva', '/api/attempt/progress', ctx(libre, { events: [{ kind: 'left', seconds: 60 }] }));
assert.equal(row(libre, 'eva').locked_at, null);
checks += 3;

// ---- Horas de los eventos: una hora fuera del intento (antes de empezar o en el futuro) se cambia por la actual ----
await call('fer', '/api/attempt/progress', ctx(q, { events: [{ kind: 'offline', seconds: 5, at: '2000-01-01T00:00:00Z' }, { kind: 'offline', seconds: 5, at: new Date(Date.now() + 3_600_000).toISOString() }] }));
const horas = events(q, 'fer').filter((e) => e.kind === 'offline').map((e) => Date.parse(e.at));
assert(horas.every((t) => Math.abs(Date.now() - t) < 5000));
// Un tipo de evento desconocido (o uno que solo pone el servidor) se rechaza.
await call('fer', '/api/attempt/progress', ctx(q, { events: [{ kind: 'silence', seconds: 5 }] }), 400);
checks += 2;

// ---- Fuera de la página ahora: el monitor lo distingue ----
await call('fer', '/api/attempt/away', ctx(q));
assert.equal((await monitor(q)).find((r) => r.name === 'fer').away, true);
checks++;

// ---- La migración solo agrega la columna ----
const sql = (await import('node:fs')).readFileSync('drizzle/0049_examen_sin_senal.sql', 'utf8');
assert(/ALTER TABLE `aula_attempt_starts` ADD `last_seen` text;/.test(sql) && !/DROP|DELETE|UPDATE /i.test(sql.replace(/^--.*$/gm, '')));
checks++;

// ---- 12.106: al N.º bloqueo el examen se envía con lo guardado ----
await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Mal', visible: true, questions: preguntas, settings: { attempts: 1, exam: { enabled: true, lockOnLeave: true, submitAfterLocks: 11 } } } }, 400);
const corte = await examen('Con corte', { lockOnLeave: true, lockGrace: 0, submitAfterLocks: 2 });
assert.equal(corte.data.settings.exam.submitAfterLocks, 2);
assert.equal((await examen('Sin bloqueo', { lockOnLeave: false, submitAfterLocks: 3 })).data.settings.exam.submitAfterLocks, 0, 'Sin bloquear al salir no hay envío por bloqueos');
await call('fer', '/api/attempt/start', ctx(corte));
await call('fer', '/api/attempt/progress', ctx(corte, { answers: { 0: 1, 1: 0 }, position: 0 }));
await call('fer', '/api/attempt/away', ctx(corte));
assert.equal((await call('fer', '/api/attempt/back', ctx(corte, { seconds: 3 }))).locked, true, '1.er bloqueo: solo se bloquea');
const ferId = store.raw().prepare("SELECT id FROM aula_users WHERE email='fer@example.test'").get().id;
await call('docente', '/api/exam/resume', { course: c, quiz: corte.id, user: ferId });
await call('fer', '/api/attempt/away', ctx(corte));
const cerrado = await call('fer', '/api/attempt/back', ctx(corte, { seconds: 3 }));
assert.equal(cerrado.closed, true, '2.º bloqueo: se envía');
assert.match(cerrado.message, /2\.ª vez/);
const enviado = store.raw().prepare('SELECT * FROM aula_attempts WHERE quiz=? AND user_id=?').get(corte.id, ferId);
assert(enviado, 'Quedó el intento enviado');
assert.equal(enviado.score, 10, 'Se calificó con las respuestas guardadas');
const integridad = JSON.parse(enviado.integrity);
assert.equal(integridad.endedByLocks, true);
assert.equal(integridad.locks, 2);
await call('fer', '/api/attempt/progress', ctx(corte, { answers: { 0: 0 }, position: 0 }), 409);
await call('fer', '/api/attempt', ctx(corte, { answers: { 0: 0, 1: 1 } }), 409);
checks += 7;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones del examen sin señal — salidas en modo avión que llegan tarde y bloquean, sin doble bloqueo, salidas cortas repetidas, silencio medido por el servidor, retomar tras perder la conexión, monitor en vivo y preparar el teléfono.`);
