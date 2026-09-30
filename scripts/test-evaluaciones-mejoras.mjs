// Pruebas de las mejoras de evaluaciones (12.23): puntos por pregunta, retroalimentación por pregunta y por opción
// (solo al revisar el intento), recalificar todos los intentos al corregir la clave, importar preguntas (texto,
// Excel, Word, CSV) y exportar resultados a Excel.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { quizInstance, regradeAttempt, scoreOf } from '../src/server/quizzes.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

let checks = 0;
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
const alumnos = ['ana', 'luis', 'eva', 'raul'];
await call('docente', '/api/members/bulk', { course: c, students: alumnos.map((n) => ({ name: n, email: n + '@example.test' })) });
const save = (data, status = 201, old) =>
  call('docente', '/api/record', { course: c, kind: 'quiz', ...(old ? { id: old.id, revision: old.revision } : {}), data: { title: 'Parcial', visible: true, ...data } }, status);

// ---- Validación: puntos, retroalimentación y comentarios por opción ----
const base = [
  { type: 'choice', text: '¿Unidad de fuerza?', options: ['Joule', 'Newton', 'Watt'], correct: 1, points: 3, explanation: 'F = m a se mide en newtons.', optionFeedback: ['El joule es energía.', '', 'El watt es potencia.'] },
  { type: 'truefalse', text: 'El sonido viaja en el vacío.', correct: false, explanation: 'Necesita un medio.' },
  { type: 'multi', text: '¿Cuáles son vectores?', options: ['Velocidad', 'Masa', 'Fuerza'], correct: [0, 2], scoring: 'all', points: 2, optionFeedback: ['', 'La masa es escalar.', ''] },
  { type: 'essay', text: 'Explica la inercia.', points: 4 },
];
for (const bad of [{ points: 0 }, { points: 101 }, { points: 'x' }]) await save({ questions: [{ ...base[0], ...bad }] }, 400);
const q = await save({ questions: base, settings: { attempts: 2, results: { score: true, review: 'marks' } } });
assert.deepEqual(
  q.data.questions.map((x) => [x.points ?? 1, Boolean(x.explanation), x.optionFeedback?.length ?? 0]),
  [[3, true, 3], [1, true, 0], [2, false, 3], [4, false, 0]],
);
// 1 punto no se guarda; comentarios vacíos tampoco.
const simple = await save({ questions: [{ ...base[1], points: 1, optionFeedback: ['', ''] }] });
assert.equal('points' in simple.data.questions[0], false);
assert.equal('optionFeedback' in simple.data.questions[0], false);
checks += 3;

// ---- El alumno no recibe la retroalimentación antes de contestar ----
const delAlumno = (await call('ana', '/api/course?id=' + c)).records.find((r) => r.id === q.id);
assert(JSON.stringify(delAlumno).includes('"points"') === false || delAlumno.data.questions.every((x) => x === null || !('explanation' in x)));
assert(!JSON.stringify(delAlumno).includes('Necesita un medio'));
const inicio = await call('ana', '/api/attempt/start', { course: c, quiz: q.id });
assert(!JSON.stringify(inicio).includes('newtons') && !JSON.stringify(inicio).includes('La masa es escalar'));
assert.deepEqual(inicio.questions.map((x) => x.points ?? 1).sort(), [1, 2, 3, 4]);
checks += 3;

// ---- Calificación ponderada por puntos ----
const pos = (item, original) => (item.perm ? item.perm.indexOf(original) : original);
async function answer(user, pick) {
  const start = await call(user, '/api/attempt/start', { course: c, quiz: q.id });
  const answers = {};
  for (const item of start.questions) answers[item.index] = pick(item);
  return call(user, '/api/attempt', { course: c, quiz: q.id, answers }, 201);
}
// Ana: elige Joule (mal, 3 pts), falso (bien, 1), velocidad y fuerza (bien, 2), escribe algo (por revisar, 4).
const tf = (item) => (item.type === 'truefalse' ? 1 : undefined);
const ana = await answer('ana', (item) =>
  item.index === 0 ? pos(item, 0) : item.index === 1 ? tf(item) : item.index === 2 ? item.options.map((o, j) => j).filter((j) => ['Velocidad', 'Fuerza'].includes(item.options[j])) : 'Resistencia al cambio',
);
// (0·3 + 1·1 + 1·2 + 0·4) / 10 puntos → 3.0
assert.equal(Math.round(ana.data.score * 100) / 100, 3);
assert.equal(ana.data.pending, 1);
// Revisión: la explicación y el comentario de la opción elegida llegan solo al terminar.
const d0 = ana.data.details.find((d) => d.index === 0);
assert.equal(d0.explanation, 'F = m a se mide en newtons.');
assert.deepEqual(d0.optionNotes, ['El joule es energía.']);
assert.equal(ana.data.details.find((d) => d.index === 2).optionNotes, undefined);
checks += 4;
// El docente califica la respuesta escrita: 50 % de 4 puntos → (1 + 2 + 2) / 10 = 5.
const intentoAna = (await call('docente', '/api/course?id=' + c)).records.find((r) => r.kind === 'attempt' && r.data.name === 'ana');
const revisado = await call('docente', '/api/attempt/review', { course: c, id: intentoAna.id, reviews: [{ index: 3, credit: 0.5, feedback: 'Falta un ejemplo.' }] });
assert.equal(Math.round(revisado.data.score * 100) / 100, 5);
checks++;
// Luis: todo bien menos la escrita.
await answer('luis', (item) => (item.index === 0 ? pos(item, 1) : item.index === 1 ? tf(item) : item.index === 2 ? item.options.map((o, j) => j).filter((j) => ['Velocidad', 'Fuerza'].includes(item.options[j])) : 'No sé'));
// Eva: todo mal.
await answer('eva', (item) => (item.index === 0 ? pos(item, 2) : item.index === 1 ? 0 : item.index === 2 ? item.options.map((o, j) => j).filter((j) => item.options[j] === 'Masa') : ''));

// Con «qué preguntas acertó» desactivado, la retroalimentación no llega (solo los comentarios del docente).
const oculto = await save({ questions: base, settings: { attempts: 1, results: { score: true, review: 'none' } } });
const raul = await (async () => {
  const start = await call('raul', '/api/attempt/start', { course: c, quiz: oculto.id });
  const answers = Object.fromEntries(start.questions.map((item) => [item.index, item.type === 'essay' ? 'x' : item.type === 'multi' ? [0] : 0]));
  return call('raul', '/api/attempt', { course: c, quiz: oculto.id, answers }, 201);
})();
assert.equal(raul.data.details, null);
assert(!JSON.stringify(raul).includes('newtons'));
checks += 2;

// ---- Con intentos: solo se corrige la clave, los puntos y la retroalimentación ----
const actual = (await call('docente', '/api/course?id=' + c)).records.find((r) => r.id === q.id);
const cambiar = (questions, status = 200, extra = {}) => save({ questions, settings: actual.data.settings, ...extra }, status, actual);
let r = await cambiar(base.map((x, i) => (i === 0 ? { ...x, text: '¿Unidad de la fuerza?' } : x)), 400);
assert.match(r.error, /corregir las respuestas correctas/);
r = await cambiar(base.map((x, i) => (i === 0 ? { ...x, options: ['Joule', 'Newton', 'Vatio'] } : x)), 400);
r = await save({ questions: base, settings: { ...actual.data.settings, shuffleOptions: true } }, 400, actual);
assert.match(r.error, /orden aleatorio/);
checks += 2;
// Cambiar solo la retroalimentación no recalifica.
r = await cambiar(base.map((x, i) => (i === 1 ? { ...x, explanation: 'Otra explicación.' } : x)));
assert.equal(r.regraded, undefined);
const antes = store.raw().prepare('SELECT user_id, score, details FROM aula_attempts WHERE quiz=? ORDER BY name').all(q.id);
// Corregir la clave (la correcta era «Joule», por error) y los puntos: se recalifican todos los intentos.
actual.revision = r.revision;
const corregidas = base.map((x, i) => (i === 0 ? { ...x, correct: 0, points: 1 } : i === 1 ? { ...x, explanation: 'Otra explicación.' } : x));
r = await cambiar(corregidas);
assert.deepEqual(r.regraded, { checked: 3, changed: 2 }); // Eva sigue con 0
const despues = Object.fromEntries(store.raw().prepare('SELECT name, score, correct, details FROM aula_attempts WHERE quiz=?').all(q.id).map((x) => [x.name, x]));
// Ana: Joule ahora es correcta (1 pt) + 1 + 2 + 0.5·4 = 6 de 8 → 7.5; la revisión manual y su comentario se conservan.
assert.equal(Math.round(despues.ana.score * 100) / 100, 7.5);
const anaEscrita = JSON.parse(despues.ana.details).find((d) => d.index === 3);
assert.deepEqual([anaEscrita.credit, anaEscrita.reviewed, anaEscrita.feedback], [0.5, true, 'Falta un ejemplo.']);
// Luis eligió Newton: ahora falla esa (1 pt): (0 + 1 + 2 + 0) / 8 → 3.75.
assert.equal(Math.round(despues.luis.score * 100) / 100, 3.75);
assert.equal(Math.round(despues.eva.score * 100) / 100, 0);
checks += 5;
// Recalificar de nuevo con la misma clave no cambia nada (idempotente) y las respuestas se reconstruyen igual.
const quizRow = { id: q.id, data: { ...actual.data, questions: r.data.questions } };
for (const row of store.raw().prepare('SELECT * FROM aula_attempts WHERE quiz=?').all(q.id)) {
  const again = regradeAttempt(quizRow, row);
  assert.equal(JSON.stringify(again.details), row.details);
}
checks++;
assert.equal(antes.length, 3);

// Recalificar respeta el orden de opciones de cada alumno (opciones mezcladas desde el principio).
const mezcla = await save({ questions: [base[0], base[2]], settings: { attempts: 1, shuffleOptions: true, results: { score: true, review: 'marks' } } });
for (const user of alumnos) {
  const start = await call(user, '/api/attempt/start', { course: c, quiz: mezcla.id });
  const answers = {};
  for (const item of start.questions) answers[item.index] = item.index === 0 ? item.options.indexOf('Joule') : [item.options.indexOf('Velocidad')];
  await call(user, '/api/attempt', { course: c, quiz: mezcla.id, answers }, 201);
}
const mezclaActual = (await call('docente', '/api/course?id=' + c)).records.find((x) => x.id === mezcla.id);
r = await call('docente', '/api/record', { course: c, kind: 'quiz', id: mezcla.id, revision: mezclaActual.revision, data: { ...mezclaActual.data, questions: [{ ...base[0], correct: 0 }, { ...base[2], correct: [0], scoring: 'all' }] } });
assert.deepEqual(r.regraded, { checked: 4, changed: 4 });
assert.deepEqual(
  store.raw().prepare('SELECT score FROM aula_attempts WHERE quiz=?').all(mezcla.id).map((x) => Math.round(x.score * 100) / 100),
  [10, 10, 10, 10],
);
checks += 2;

// ---- Funciones puras ----
assert.deepEqual(scoreOf([{ index: 0, credit: 1 }, { index: 1, credit: 0 }], [{ points: 3 }, {}]).score, 7.5);
assert.equal(scoreOf([], []).score, 0);
const inst = quizInstance({ id: 'x', data: { questions: [{ type: 'choice', text: 't', options: ['a', 'b'], correct: 0, points: 2, explanation: 'secreta' }], settings: {} } }, 'u', 1);
assert.equal(inst[0].points, 2);
assert.equal('explanation' in inst[0], false);
checks += 4;

// Consultas por solicitud: recalificar es una lectura y un batch.
store.counter.queries = 0;
const ultima = (await call('docente', '/api/course?id=' + c)).records.find((x) => x.id === mezcla.id);
store.counter.queries = 0;
await call('docente', '/api/record', { course: c, kind: 'quiz', id: mezcla.id, revision: ultima.revision, data: { ...ultima.data, questions: [{ ...base[0], correct: 1 }, { ...base[2], correct: [0, 2], scoring: 'all' }] } });
assert(store.counter.queries <= 15, `consultas: ${store.counter.queries}`);
checks++;

// ---- Navegador: importar preguntas y Excel ----
const ctx = vm.createContext({ console, TextEncoder, TextDecoder, Blob, Response, DecompressionStream, structuredClone, URL });
for (const file of ['reactivos.js', 'zip.js', 'oficina.js', 'd2l.js', 'importar.js']) {
  vm.runInContext(readFileSync('src/public/' + file, 'utf8').replace(/\ndocument\.addEventListener\([\s\S]*$/, ''), ctx);
}
const g = (name) => vm.runInContext(name, ctx);
const texto = `Examen parcial (se ignora el título)

1. ¿Cuál es la unidad de fuerza?
a) Joule
*b) Newton
c) Watt
Comentario: el watt es potencia
Retroalimentación: F = m a
Puntos: 2

2. La luz es una onda electromagnética.
Respuesta: Verdadero

3) ¿Cuántos segundos hay en una hora?
Respuesta: 3600

4. La unidad de carga es el [[coulomb|C]].

5. Explica la primera ley de Newton.

6. ¿Cuáles son vectores?
a) Velocidad *
b) Masa
c) Fuerza (correcta)

7. Relaciona
a) Fuerza -> N
b) Energía -> J
Tipo: Coincidencia

8. g vale aproximadamente
Respuesta: 9.8 m/s^2

9. Capital de Francia
Respuesta: París | Paris

10. Sin correcta
a) uno
b) dos

11. V o F
a) Verdadero
b) Falso
Respuesta: b

12. Ordena de menor a mayor
Tipo: Ordenamiento
a) átomo
b) célula
c) órgano
`;
const imp = JSON.parse(JSON.stringify(g('importFromText')(texto)));
assert.deepEqual(
  imp.map((x) => x.question?.type ?? 'error'),
  ['choice', 'truefalse', 'numeric', 'fill', 'essay', 'multi', 'matching', 'numeric', 'short', 'error', 'truefalse', 'ordering'],
);
assert.deepEqual(imp[0].question, { type: 'choice', text: '¿Cuál es la unidad de fuerza?', options: ['Joule', 'Newton', 'Watt'], correct: 1, points: 2, explanation: 'F = m a', optionFeedback: ['', '', 'el watt es potencia'] });
assert.deepEqual([imp[2].question.answer, imp[2].question.tolerance], ['3600', 0]);
assert.deepEqual([imp[7].question.answer, imp[7].question.unit, imp[7].question.tolerance], ['9.8', 'm/s^2', 1]);
assert.deepEqual(imp[5].question.correct, [0, 2]);
assert.deepEqual(imp[8].question.answers, ['París', 'Paris']);
assert.equal(imp[10].question.correct, false);
assert.match(imp[9].error, /Marca la opción correcta/);
assert.deepEqual(imp[11].question.items, ['átomo', 'célula', 'órgano']);
checks += 9;
// Las preguntas importadas pasan la validación del servidor.
const importadas = await save({ questions: imp.filter((x) => x.question).map((x) => x.question) });
assert.equal(importadas.data.questions.length, 11);
checks++;
// Pegado desde Excel (tabuladores, sin encabezados) y CSV con encabezados.
const pegado = JSON.parse(JSON.stringify(g('importFromText')('¿Cuánto es 2+2?\t3\t4\t5\tb\n¿Capital de Italia?\tRoma')));
assert.deepEqual(pegado.map((x) => [x.question.type, x.question.correct ?? x.question.answers]), [['choice', 1], ['short', ['Roma']]]);
const csv = JSON.parse(JSON.stringify(g('importFromBlocks')(g('importRowBlocks')(g('parseDelimited')('Tipo;Pregunta;A;B;Respuesta;Puntos\n;"¿Unidad; de energía?";Joule;Newton;A;2\nVerdadero o falso;El sol es una estrella;;;V;')))));
assert.deepEqual(csv.map((x) => x.question), [
  { type: 'choice', text: '¿Unidad; de energía?', options: ['Joule', 'Newton'], correct: 0, points: 2 },
  { type: 'truefalse', text: 'El sol es una estrella', correct: true },
]);
checks += 2;
// Word real (listas automáticas por estilo, la correcta en negritas) y Excel real (hecho con otra aplicación).
const bytes = (path) => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const word = JSON.parse(JSON.stringify(g('importFromBlocks')(g('importBlocks')(await g('readDocxParagraphs')(bytes('scripts/fixtures/preguntas.docx'))))));
assert.deepEqual(
  word.map((x) => [x.question.type, x.question.text, x.question.correct]),
  [
    ['choice', '¿Cuál es la unidad de fuerza?', 1],
    ['choice', '¿Qué magnitud es escalar?', 0],
    ['essay', 'Explica la segunda ley de Newton.', undefined],
  ],
);
const libro = JSON.parse(JSON.stringify(g('importFromBlocks')(g('importRowBlocks')(await g('readXlsxRows')(bytes('scripts/fixtures/preguntas.xlsx'))))));
assert.deepEqual(libro.map((x) => x.question), [
  { type: 'choice', text: '¿Unidad de energía?', options: ['Joule', 'Newton', 'Watt'], correct: 0, points: 2 },
  { type: 'truefalse', text: 'El sonido viaja en el vacío.', correct: false },
]);
checks += 2;
// Un .xlsx escrito aquí se vuelve a leer igual (números, acentos y caracteres especiales).
const hoja = [['Tipo', 'Pregunta', 'A', 'B', 'Respuesta', 'Puntos'], ['', '¿2 < 3 & 4 > 1? "sí"', 'Sí', 'No', 'A', 1.5]];
const escrito = await g('xlsxBlob')([{ name: 'Preguntas [1]', rows: hoja }, { name: 'Otra', rows: [['x']] }]).arrayBuffer();
assert.deepEqual(JSON.parse(JSON.stringify(await g('readXlsxRows')(escrito))), [hoja[0], ['', '¿2 < 3 & 4 > 1? "sí"', 'Sí', 'No', 'A', '1.5']]);
assert.equal(new TextDecoder().decode(new Uint8Array(escrito).slice(0, 2)), 'PK');
checks += 2;
// Un archivo que no es de Office se rechaza con un mensaje claro.
await assert.rejects(g('readDocxParagraphs')(new TextEncoder().encode('hola').buffer), /no es un documento/);
checks++;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones de evaluaciones 12.23 — puntos por pregunta, retroalimentación solo al revisar, recalificar al corregir la clave (conservando lo calificado a mano), importar de texto, Word, Excel y CSV, y Excel de ida y vuelta.`);
