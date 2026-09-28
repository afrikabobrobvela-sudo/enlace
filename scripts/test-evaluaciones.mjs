// Pruebas de evaluaciones: fórmulas seguras, preguntas numéricas con datos aleatorios por alumno y tolerancia,
// varios intentos, tiempo límite, orden aleatorio y confidencialidad de las respuestas.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { evaluate } from '../src/server/quizzes.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

let checks = 0;
const near = (a, b, msg) => {
  assert(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);
  checks++;
};

// ---- Evaluador de fórmulas ----
near(evaluate('2 + 3 * 4'), 14, 'precedencia');
near(evaluate('(2 + 3) * 4'), 20, 'paréntesis');
near(evaluate('2^3^2'), 512, 'potencia a la derecha');
near(evaluate('-2^2'), -4, 'menos unario');
near(evaluate('v0*t + 0.5*g*t^2', { v0: 3, t: 2 }), 6 + 0.5 * 9.81 * 4, 'variables y constante g');
near(evaluate('sqrt(2*h/g)', { h: 20 }), Math.sqrt(40 / 9.81), 'funciones');
near(evaluate('sin(pi/2) + ln(e)'), 2, 'pi, e, sin, ln');
near(evaluate('1,5 * 2'), 3, 'coma decimal');
near(evaluate('6.02e23 / 1e23'), 6.02, 'notación científica');
for (const bad of ['2 +', '(1', 'x + 1', 'constructor', 'foo(2)', '1/0', 'alert(1)', 'this', '2 ; 3', '[1]', '"a"', '__proto__']) {
  assert.throws(() => evaluate(bad), Error, bad);
  checks++;
}

// ---- Plataforma ----
const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'docente@example.test', SESSION_SECRET: 'e'.repeat(40) };
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
  assert.equal(res.status, status, `${method} ${path} (${user}) → ${text}`);
  checks++;
  return JSON.parse(text);
}
await call('docente', '/api/me');
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '501' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: ['ana', 'luis'].map((n) => ({ name: n, email: n + '@example.test' })) });
const quiz = (data) => call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Q', visible: true, ...data } }, 201);

// Validación al guardar.
const numeric = (extra = {}) => ({ type: 'numeric', text: 'Un objeto cae desde {h} m. ¿Cuánto tarda?', answer: 'sqrt(2*h/g)', tolerance: 2, unit: 's', variables: [{ name: 'h', min: 5, max: 45, decimals: 0 }], ...extra });
await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'x', questions: [numeric({ answer: 'sqrt(2*h/q)' })] } }, 400); // variable desconocida
await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'x', questions: [numeric({ variables: [{ name: 'h', min: 9, max: 1 }] })] } }, 400);
await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'x', questions: [numeric({ variables: [{ name: 'g', min: 1, max: 2 }] })] } }, 400); // g es constante
await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'x', questions: [{ type: 'choice', text: '¿?', options: ['a'], correct: 0 }] } }, 400);
await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'x', settings: { attempts: 20 }, questions: [numeric()] } }, 400);

const q = await quiz({
  settings: { attempts: 2, timeLimit: 10, shuffle: true },
  questions: [
    numeric(),
    { type: 'choice', text: 'Unidad de fuerza', options: ['J', 'N', 'W', 'Pa'], correct: 1 },
    { type: 'numeric', text: '¿Cuánto es 2 + 2?', answer: '4', tolerance: 0 },
  ],
});

// El alumno no recibe respuestas, fórmulas ni rangos; antes de empezar, ni siquiera las preguntas (solo cuántas son).
const publico = (await call('ana', '/api/course?id=' + c)).records.find((r) => r.id === q.id);
assert.deepEqual([publico.data.questions, publico.data.questionCount], [[null, null, null], 3]);
assert.equal(JSON.stringify(publico).includes('sqrt'), false);
checks += 2;

// Empezar: variables propias, texto con valores, sin fórmulas.
await call('docente', '/api/attempt/start', { course: c, quiz: q.id }, 400); // el docente usa Ver como alumno
const inicio = await call('ana', '/api/attempt/start', { course: c, quiz: q.id });
assert.deepEqual([inicio.attempt, inicio.attemptsLeft, Boolean(inicio.deadline)], [1, 2, true]);
const caida = inicio.questions.find((x) => x.index === 0);
const h = Number(/desde (\d+) m/.exec(caida.text)[1]);
assert(h >= 5 && h <= 45, 'Valor dentro del rango');
assert(!('values' in caida) && !JSON.stringify(inicio).includes('sqrt'));
const again = await call('ana', '/api/attempt/start', { course: c, quiz: q.id });
assert.deepEqual(again.questions, inicio.questions, 'Recargar no cambia valores, orden ni reinicia el tiempo');
assert.equal(again.started, inicio.started);
const luis = await call('luis', '/api/attempt/start', { course: c, quiz: q.id });
checks += 5;

// Respuestas: tolerancia 2 %, coma decimal.
const t = Math.sqrt((2 * h) / 9.81);
await call('ana', '/api/attempt', { course: c, quiz: q.id, answers: { 0: 'abc', 1: 1, 2: '4' } }, 400);
const r1 = await call('ana', '/api/attempt', { course: c, quiz: q.id, answers: { 0: (t * 1.015).toFixed(4).replace('.', ','), 1: 1, 2: '4' } }, 201);
assert.deepEqual([r1.data.correct, r1.data.total, r1.data.score, r1.data.attempt], [3, 3, 10, 1]);
assert.deepEqual(r1.data.details.map((d) => d.correct), [true, true, true].slice(0, 3));
// Segundo intento: otros valores; respuesta fuera de tolerancia.
const inicio2 = await call('ana', '/api/attempt/start', { course: c, quiz: q.id });
assert.equal(inicio2.attempt, 2);
const h2 = Number(/desde (\d+) m/.exec(inicio2.questions.find((x) => x.index === 0).text)[1]);
const r2 = await call('ana', '/api/attempt', { course: c, quiz: q.id, answers: { 0: String(Math.sqrt((2 * h2) / 9.81) * 1.1), 1: 0, 2: 4 } }, 201);
assert.deepEqual([r2.data.correct, r2.data.attempt], [1, 2]);
await call('ana', '/api/attempt/start', { course: c, quiz: q.id }, 409); // sin intentos
await call('ana', '/api/attempt', { course: c, quiz: q.id, answers: { 0: 1, 1: 1, 2: 4 } }, 409);
const vistos = (await call('ana', '/api/course?id=' + c)).records.filter((r) => r.kind === 'attempt');
assert.deepEqual(vistos.map((a) => a.data.attempt).sort(), [1, 2]);
assert.equal((await call('docente', '/api/course?id=' + c)).records.filter((r) => r.kind === 'attempt' && r.data.quiz === q.id).length, 2);
checks += 4;

// Tiempo límite: si se acaba sin enviar, no se acepta; al volver a empezar cuenta como intento con 0.
store.raw().prepare("UPDATE aula_attempt_starts SET started='2026-01-01T00:00:00.000Z' WHERE user_id=(SELECT id FROM aula_users WHERE email='luis@example.test')").run();
await call('luis', '/api/attempt', { course: c, quiz: q.id, answers: { 0: 1, 1: 1, 2: 4 } }, 409);
const luis2 = await call('luis', '/api/attempt/start', { course: c, quiz: q.id });
assert.equal(luis2.attempt, 2, 'El intento vencido cuenta');
const perdidos = store.raw().prepare("SELECT score, attempt FROM aula_attempts WHERE user_id=(SELECT id FROM aula_users WHERE email='luis@example.test')").all();
assert.deepEqual(perdidos.map((x) => [x.score, x.attempt]), [[0, 1]]);
checks += 2;

// Evaluación de versiones anteriores (un intento, sin tiempo, respuestas como arreglo) sigue funcionando.
const vieja = await quiz({ questions: [{ text: '¿1+1?', options: ['1', '2'], correct: 1 }] });
const rv = await call('ana', '/api/attempt', { course: c, quiz: vieja.id, answers: [1] }, 201);
assert.equal(rv.data.score, 10);
await call('ana', '/api/attempt', { course: c, quiz: vieja.id, answers: [1] }, 409);
// Con intentos, cambiar solo el título sí se permite; cambiar preguntas no.
await call('docente', '/api/record', { course: c, kind: 'quiz', id: vieja.id, revision: vieja.revision, data: { title: 'Nuevo título', questions: [{ text: '¿1+1?', options: ['1', '2'], correct: 1 }] } });
await call('docente', '/api/record', { course: c, kind: 'quiz', id: vieja.id, revision: vieja.revision + 1, data: { title: 'x', questions: [{ text: '¿1+1?', options: ['1', '2'], correct: 0 }] } }, 400);
checks += 1;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones de evaluaciones — fórmulas seguras, preguntas numéricas con datos por alumno y tolerancia, varios intentos, tiempo límite y orden aleatorio.`);
