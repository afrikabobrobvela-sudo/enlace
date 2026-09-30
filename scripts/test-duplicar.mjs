// Pruebas de la 12.30: duplicar una evaluación (mismo curso u otro, con imágenes) y el bloqueo por salidas cortas
// repetidas en el modo examen.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'docente@example.test', SESSION_SECRET: 'u'.repeat(40) };
let checks = 0;
const cookies = {};
async function call(user, path, data, status = 200) {
  cookies[user] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user }),
    env,
  );
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
  checks++;
  return JSON.parse(text);
}

await call('docente', '/api/me');
await call('docente', '/api/teachers', { email: 'colega@example.test', name: 'Colega', role: 'teacher' });
const a = (await call('docente', '/api/courses', { name: 'Física I', group: 'A' }, 201)).id;
const b = (await call('docente', '/api/courses', { name: 'Física I', group: 'B' }, 201)).id;
const ajeno = (await call('colega', '/api/courses', { name: 'Química', group: 'C' }, 201)).id;
await call('docente', '/api/members/bulk', { course: a, students: [{ name: 'Ana', email: 'ana@example.test' }] });
await call('ana', '/api/me');

// Una evaluación con imagen, secciones, categoría y modo examen.
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(1)]);
const up = await api(
  new Request(`https://t.local/api/upload?course=${a}&scope=material`, {
    method: 'POST',
    headers: { cookie: cookies.docente, Origin: 'https://t.local', 'X-Aula-Request': '1', 'x-file-name': 'diagrama.png', 'content-type': 'image/png' },
    body: png,
  }),
  env,
);
const image = (await up.json()).id;
assert(image);
const seccion = (await call('docente', '/api/sections', { course: a, name: 'Matutino' }, 201)).id;
const original = await call(
  'docente',
  '/api/record',
  {
    course: a,
    kind: 'quiz',
    data: {
      title: 'Parcial 1',
      visible: true,
      sections: [seccion],
      questions: [
        { type: 'truefalse', text: 'Uno', correct: true, image },
        { type: 'choice', text: 'Dos', options: ['a', 'b'], correct: 1 },
      ],
      settings: { attempts: 2, timeLimit: 20, exam: { enabled: true, password: 'CLAVE1', lockOnLeave: true, lockGrace: 5 } },
    },
  },
  201,
);

// Mismo curso: copia oculta con todo.
await call('ana', '/api/quiz/duplicate', { course: a, quiz: original.id }, 403);
const copia = await call('docente', '/api/quiz/duplicate', { course: a, quiz: original.id }, 201);
let curso = (await call('docente', '/api/course?id=' + a)).records;
const c1 = curso.find((r) => r.id === copia.id);
assert.deepEqual([c1.data.title, c1.data.visible, c1.data.sections, c1.data.questions.length, c1.data.questions[0].image, c1.data.settings.exam.password], ['Copia de Parcial 1', false, [seccion], 2, image, 'CLAVE1']);
assert.equal(curso.filter((r) => r.kind === 'attempt' && r.data.quiz === copia.id).length, 0);
checks++;

// Otro curso propio: sin secciones y con la imagen enlazada en el curso nuevo.
const otra = await call('docente', '/api/quiz/duplicate', { course: a, quiz: original.id, target: b, title: 'Parcial 1 (grupo B)' }, 201);
const c2 = (await call('docente', '/api/course?id=' + b)).records.find((r) => r.id === otra.id);
assert.equal(c2.data.title, 'Parcial 1 (grupo B)');
assert.equal('sections' in c2.data, false);
const nueva = c2.data.questions[0].image;
assert(nueva && nueva !== image);
const fila = store.raw().prepare('SELECT course, r2_key FROM aula_files WHERE id=?').get(nueva);
assert.deepEqual([fila.course, fila.r2_key], [b, image], 'La imagen del curso B apunta al mismo archivo');
checks += 2;
// Quien no enseña en el curso de origen, o en el de destino, no puede.
await call('colega', '/api/quiz/duplicate', { course: a, quiz: original.id, target: ajeno }, 403);
const suya = await call('colega', '/api/record', { course: ajeno, kind: 'quiz', data: { title: 'Q', visible: true, questions: [{ type: 'truefalse', text: 'x', correct: true }] } }, 201);
await call('colega', '/api/quiz/duplicate', { course: ajeno, quiz: suya.id, target: a }, 403);

// ---- Salidas cortas repetidas ----
const anaMember = (await call('docente', '/api/course?id=' + a)).members.find((m) => m.email === 'ana@example.test');
await call('docente', '/api/member/update', { course: a, id: anaMember.id, name: 'Ana', email: 'ana@example.test', section: seccion });
const start = await call('ana', '/api/attempt/start', { course: a, quiz: original.id, password: 'CLAVE1' });
const exit = async (seconds) => {
  await call('ana', '/api/attempt/away', { course: a, quiz: original.id, attempt: start.attempt });
  const back = await call('ana', '/api/attempt/back', { course: a, quiz: original.id, attempt: start.attempt, seconds });
  if (!back.locked) await call('ana', '/api/attempt/progress', { course: a, quiz: original.id, attempt: start.attempt, events: [{ kind: 'left', seconds }] });
  return back;
};
assert.equal((await exit(2)).locked, false, '1.ª salida corta: solo se registra');
assert.equal((await exit(3)).locked, false, '2.ª salida corta: solo se registra');
const third = await exit(2);
assert.deepEqual([third.locked, third.repeated], [true, true], '3.ª salida corta: se bloquea');
await call('ana', '/api/attempt/progress', { course: a, quiz: original.id, attempt: start.attempt, answers: {} }, 423);
// El docente desbloquea: la cuenta vuelve a empezar desde ahí.
const monitor = await call('docente', `/api/exam/monitor?course=${a}&quiz=${original.id}`);
const code = JSON.stringify(monitor).match(/"unlockCode":"(\d{6})"/)?.[1];
assert(code, 'El monitor muestra el código');
await call('ana', '/api/attempt/unlock', { course: a, quiz: original.id, attempt: start.attempt, code });
assert.equal((await exit(1)).locked, false, 'Después de desbloquear, una salida corta vuelve a solo registrarse');
checks += 5;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones de la 12.30 — duplicar evaluaciones (mismo curso u otro, con imágenes, oculta y sin intentos) y bloqueo por salidas cortas repetidas.`);
