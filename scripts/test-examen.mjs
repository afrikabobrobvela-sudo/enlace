// Pruebas del modo examen: contraseña con intentos limitados, ubicación del salón, respuestas guardadas mientras se
// contesta, "sin regresar" respetado por el servidor, registro de salidas y monitor del docente.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
let checks = 0;
const cookies = {};
async function call(user, path, data, status = 200) {
  cookies[user] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user }),
    env,
  );
  const before = store.counter.queries;
  const res = await api(
    new Request('https://t.local' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { cookie: cookies[user], Origin: 'https://t.local', 'X-Aula-Request': '1' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${user}) → ${text}`);
  assert(store.counter.queries - before <= 50);
  checks++;
  return JSON.parse(text);
}

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '501' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: ['ana', 'beto', 'carla'].map((n) => ({ name: n, email: n + '@example.test' })) });

const salon = { lat: 19.0006, lng: -98.2016, accuracy: 20 };
const cerca = { lat: 19.0008, lng: -98.2015, accuracy: 30 };
const lejos = { lat: 19.05, lng: -98.23, accuracy: 15 };
const preguntas = [
  { type: 'choice', text: 'Unidad de fuerza', options: ['J', 'N'], correct: 1 },
  { type: 'choice', text: 'Unidad de energía', options: ['J', 'N'], correct: 0 },
  { type: 'numeric', text: '¿2 + 2?', answer: '4', tolerance: 0 },
];
const examen = (exam, extra = {}) => ({ course: c, kind: 'quiz', data: { title: 'Parcial', visible: true, questions: preguntas, settings: { attempts: 1, timeLimit: 30, exam }, ...extra } });

// ---- Validación de la configuración ----
await call('docente', '/api/record', examen({ enabled: true, password: 'abc' }), 400);
await call('docente', '/api/record', examen({ enabled: true, place: { ...salon, radius: 77 } }), 400);
await call('docente', '/api/record', examen({ enabled: true, place: { lat: 200, lng: 0, radius: 150 } }), 400);
const q = await call('docente', '/api/record', examen({ enabled: true, password: 'gauss', oneByOne: true, noBack: true, place: { ...salon, radius: 150 } }), 201);
assert.deepEqual(q.data.settings.exam, { enabled: true, password: 'gauss', oneByOne: true, noBack: true, place: { ...salon, radius: 150 }, lockOnLeave: false, lockGrace: 0 });
// "Sin regresar" sin "una pregunta a la vez" no tiene sentido: se desactiva.
const suelto = await call('docente', '/api/record', examen({ enabled: true, noBack: true }), 201);
assert.equal(suelto.data.settings.exam.noBack, false);
checks += 2;

// ---- El alumno no recibe la contraseña ni la ubicación del salón ----
const visto = (await call('ana', '/api/course?id=' + c)).records.find((r) => r.id === q.id);
assert.deepEqual(visto.data.settings.exam, { enabled: true, oneByOne: true, noBack: true, needsPassword: true, checksLocation: true, lockOnLeave: false, lockGrace: 0 });
assert(!JSON.stringify(visto).includes('gauss') && !JSON.stringify(visto).includes('98.2016'));
const vistaPrevia = (await call('docente', `/api/course?id=${c}&as=student`)).records.find((r) => r.id === q.id);
assert(!JSON.stringify(vistaPrevia).includes('gauss'));
checks += 3;

// ---- Contraseña ----
await call('ana', '/api/attempt/start', { course: c, quiz: q.id }, 400);
const mal = await call('ana', '/api/attempt/start', { course: c, quiz: q.id, password: 'newton' }, 400);
assert.match(mal.error, /quedan 8 intentos/);
for (let i = 0; i < 7; i++) await call('ana', '/api/attempt/start', { course: c, quiz: q.id, password: 'x' + i }, 400);
await call('ana', '/api/attempt/start', { course: c, quiz: q.id, password: 'otra' }, 429);
await call('ana', '/api/attempt/start', { course: c, quiz: q.id, password: 'gauss' }, 429); // bloqueada aunque ya la sepa
let monitor = await call('docente', `/api/exam/monitor?course=${c}&quiz=${q.id}`);
assert.deepEqual(monitor.blocked.map((b) => b.name), ['ana']);
await call('ana', `/api/exam/monitor?course=${c}&quiz=${q.id}`, undefined, 403);
await call('ana', '/api/exam/unlock', { course: c, quiz: q.id, user: monitor.blocked[0].user }, 403);
await call('docente', '/api/exam/unlock', { course: c, quiz: q.id, user: monitor.blocked[0].user });
checks += 2;

// ---- Empezar: con la contraseña (sin importar espacios) y la ubicación ----
const inicio = await call('ana', '/api/attempt/start', { course: c, quiz: q.id, password: ' gauss ', location: cerca });
assert.deepEqual([inicio.exam.oneByOne, inicio.exam.noBack, inicio.exam.position, inicio.exam.flagged], [true, true, 0, false]);
assert(!JSON.stringify(inicio).includes('gauss'));
// Retomar tras recargar no pide la contraseña.
const retomado = await call('ana', '/api/attempt/start', { course: c, quiz: q.id });
assert.equal(retomado.started, inicio.started);
const beto = await call('beto', '/api/attempt/start', { course: c, quiz: q.id, password: 'gauss', location: lejos });
assert.equal(beto.exam.flagged, true);
const carla = await call('carla', '/api/attempt/start', { course: c, quiz: q.id, password: 'gauss', locationError: 'denied' });
assert.equal(carla.exam.flagged, true);
checks += 5;

// ---- Guardado mientras contesta y "sin regresar" ----
const orden = inicio.questions.map((x) => x.index); // una sola pregunta por pantalla, en este orden
const correcta = { 0: 1, 1: 0, 2: '4' };
const progreso = (quien, cuerpo, status = 200) => call(quien, '/api/attempt/progress', { course: c, quiz: q.id, attempt: 1, ...cuerpo }, status);
await progreso('ana', { answers: { [orden[0]]: correcta[orden[0]] }, position: 0 });
// Avanza a la segunda pregunta (con la primera bien contestada) y sale dos veces de la página.
await progreso('ana', { answers: { [orden[0]]: correcta[orden[0]] }, position: 1, events: [{ kind: 'left', seconds: 12 }, { kind: 'fullscreen' }] });
await progreso('ana', { events: [{ kind: 'left', seconds: 30 }, { kind: 'copy' }] });
await progreso('ana', { events: [{ kind: 'hack' }] }, 400);
// Intenta regresar a la primera y cambiar su respuesta: el servidor no lo acepta.
await progreso('ana', { answers: { [orden[0]]: correcta[orden[0]] === 1 ? 0 : '99' }, position: 0 });
const fila = store.raw().prepare('SELECT * FROM aula_attempt_starts WHERE quiz=? AND user_id=(SELECT id FROM aula_users WHERE email=?)').get(q.id, 'ana@example.test');
assert.equal(fila.position, 1, 'La posición no retrocede');
assert.equal(JSON.parse(fila.progress)[orden[0]], correcta[orden[0]], 'Lo contestado atrás queda fijo');
assert.equal(JSON.parse(fila.events).length, 4);
assert(!('lat' in fila) && fila.distance < 100);
checks += 4;

// El monitor del docente ve quién está contestando y sus salidas.
monitor = await call('docente', `/api/exam/monitor?course=${c}&quiz=${q.id}`);
const enCurso = Object.fromEntries(monitor.running.map((r) => [r.name, r]));
assert.deepEqual([enCurso.ana.exits, enCurso.ana.awaySeconds, enCurso.ana.fullscreenExits, enCurso.ana.copyAttempts, enCurso.ana.answered], [2, 42, 1, 1, 1]);
assert.match(enCurso.beto.flag, /km del salón/);
assert.equal(enCurso.carla.flag, 'no permitió ver su ubicación');
assert.deepEqual(monitor.blocked, []);
checks += 4;

// ---- Enviar: al final intenta cambiar también la primera respuesta; cuenta la guardada ----
const trampa = { ...correcta, [orden[0]]: correcta[orden[0]] === 1 ? 0 : '99' };
const r = await call('ana', '/api/attempt', { course: c, quiz: q.id, answers: trampa }, 201);
assert.deepEqual([r.data.correct, r.data.total], [3, 3], 'La primera respuesta es la que quedó fija al avanzar');
assert.deepEqual([r.data.integrity.exits, r.data.integrity.awaySeconds, r.data.integrity.flag], [2, 42, '']);
await progreso('ana', { events: [{ kind: 'left', seconds: 5 }] }, 409); // ya se envió
// El docente ve la integridad en los resultados; el alumno ve la suya.
const intento = (await call('docente', '/api/course?id=' + c)).records.find((x) => x.kind === 'attempt' && x.data.quiz === q.id);
assert.equal(intento.data.integrity.events.length, 4);
checks += 3;

// ---- Sin modo examen no hay guardado progresivo ni contraseña ----
const normal = await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Tarea', visible: true, questions: preguntas } }, 201);
await call('ana', '/api/attempt/start', { course: c, quiz: normal.id });
await call('ana', '/api/attempt/progress', { course: c, quiz: normal.id, attempt: 1, answers: {} }, 400);
const libre = await call('ana', '/api/attempt', { course: c, quiz: normal.id, answers: correcta }, 201);
assert.equal(libre.data.integrity, null);
checks++;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones del modo examen — contraseña con bloqueo, ubicación del salón, respuestas guardadas, sin regresar, salidas registradas y monitor del docente.`);
