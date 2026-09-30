// Pruebas de los tipos de reactivos (12.21): verdadero o falso, selección múltiple (todo o nada y parcial), para
// completar, coincidencia con distractores, ordenamiento, respuesta escrita calificada por el docente, respuesta corta,
// varias respuestas cortas y cifras significativas. Nada que delate la respuesta llega al alumno antes de enviar.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { quizFields, quizInstance, gradeAttempt, studentAttemptView } from '../src/server/quizzes.js';
import { normalizeAnswer, significantFigures } from '../src/server/reactivos.js';
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
  assert(store.counter.queries - before <= 50, `${path}: ${store.counter.queries - before} consultas`);
  checks++;
  return JSON.parse(text);
}
const expectFail = (fn, pattern) => {
  assert.throws(fn, (e) => pattern.test(e.message), String(pattern));
  checks++;
};

// ---- Utilidades ----
assert.deepEqual(['0.0450', '1.20e3', '1200', '1200.', '9.81', '-3.00', '0', '6.02E23', 'abc'].map(significantFigures), [3, 3, 2, 4, 3, 3, 1, 3, 0]);
assert.equal(normalizeAnswer('  Aceleración   Media '), 'aceleracion media');
assert.equal(normalizeAnswer('  Aceleración ', true), 'Aceleración');
checks += 3;

// ---- Validación al guardar ----
const quiz = (questions, settings = {}) => quizFields({ questions, settings: { attempts: 1, ...settings } });
expectFail(() => quiz([{ type: 'truefalse', text: '¿?' }]), /verdadero o falso/);
expectFail(() => quiz([{ type: 'multi', text: '¿?', options: ['a', 'b'], correct: [] }]), /al menos una opción correcta/);
expectFail(() => quiz([{ type: 'fill', text: 'Sin espacios' }]), /dobles corchetes/);
expectFail(() => quiz([{ type: 'matching', text: '¿?', pairs: [{ left: 'a', right: '1' }] }]), /de 2 a 10 parejas/);
expectFail(() => quiz([{ type: 'ordering', text: '¿?', items: ['uno'] }]), /de 2 a 10 elementos/);
expectFail(() => quiz([{ type: 'short', text: '¿?', answers: [] }]), /respuestas aceptadas/);
expectFail(() => quiz([{ type: 'multishort', text: '¿?', answers: ['a'], boxes: 2 }]), /2 espacios pero solo 1/);
expectFail(() => quiz([{ type: 'sigfig', text: '¿?', answer: '2*x', variables: [{ name: 'x', min: 1, max: 2 }], figures: 0 }]), /cifras significativas van de 1 a 10/);
expectFail(() => quiz([{ type: 'sigfig', text: '¿?', answer: 'sqrt(-1-x)', variables: [{ name: 'x', min: 1, max: 2 }], figures: 3 }]), /no se puede calcular/);
const multi = quiz([{ type: 'multi', text: '¿?', options: ['a', '', 'b', 'c'], correct: [0, 2, 7] }]).questions[0];
assert.deepEqual([multi.options, multi.correct, multi.scoring], [['a', 'b', 'c'], [0, 2], 'all'], 'Opciones vacías fuera; correctas válidas');
checks++;

// ---- Una evaluación con todos los tipos, por la API ----
await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '5AV' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: ['ana', 'beto'].map((n) => ({ name: n, email: n + '@example.test' })) });
const questions = [
  { type: 'truefalse', text: 'La masa se mide en newtons.', correct: false },
  { type: 'multi', text: '¿Cuáles son vectores?', options: ['Velocidad', 'Masa', 'Fuerza', 'Tiempo'], correct: [0, 2], scoring: 'partial' },
  { type: 'fill', text: 'La unidad de fuerza es el [[newton|N]] y la de energía el [[joule|julio|J]].' },
  { type: 'matching', text: 'Relaciona cada magnitud con su unidad', pairs: [{ left: 'Fuerza', right: 'N' }, { left: 'Energía', right: 'J' }, { left: 'Potencia', right: 'W' }], extra: ['Pa'] },
  { type: 'ordering', text: 'Ordena de menor a mayor', items: ['mm', 'cm', 'm', 'km'] },
  { type: 'essay', text: 'Explica la primera ley de Newton.', guide: 'Inercia; sin fuerza neta, velocidad constante.' },
  { type: 'short', text: '¿Cómo se llama la aceleración de caída libre?', answers: ['gravedad', 'aceleración de la gravedad'] },
  { type: 'multishort', text: 'Escribe dos unidades base del SI', answers: ['metro|m', 'kilogramo|kg', 'segundo|s', 'ampere|A'], boxes: 2 },
  { type: 'sigfig', text: 'Un objeto recorre {d} m en 2 s. ¿Su rapidez?', answer: 'd/2', variables: [{ name: 'd', min: 10, max: 20, decimals: 1 }], tolerance: 1, unit: 'm/s', figures: 3, penalty: 50 },
  { type: 'choice', text: '¿Unidad de carga?', options: ['C', 'V'], correct: 0 },
];
const created = await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Todos los tipos', visible: true, questions, settings: { attempts: 2, shuffleOptions: true } } }, 201);
assert.equal(created.data.questions.length, 10);
checks++;

// Antes de empezar, el alumno no recibe respuestas (ni las de los espacios para completar).
const antes = await call('ana', '/api/course?id=' + c);
const texto = JSON.stringify(antes.records.find((r) => r.id === created.id));
for (const secret of ['julio', 'Pa', 'gravedad', 'kilogramo', 'd/2', 'Inercia', '"correct"']) assert(!texto.includes(secret), `No llega «${secret}»`);
checks++;

const inicio = await call('ana', '/api/attempt/start', { course: c, quiz: created.id });
assert(!JSON.stringify(inicio.questions).includes('"key"') && !JSON.stringify(inicio.questions).includes('perm'), 'La clave de cada pregunta no llega');
assert(!JSON.stringify(inicio.questions).includes('julio') && !JSON.stringify(inicio.questions).includes('Inercia'));
const byType = Object.fromEntries(inicio.questions.map((x) => [x.type, x]));
assert.deepEqual(byType.fill.parts, ['La unidad de fuerza es el ', ' y la de energía el ', '.']);
assert.equal(byType.matching.lefts.length, 3);
assert.equal(byType.matching.rights.length, 4, 'Con el distractor');
assert.notDeepEqual(byType.ordering.items, ['mm', 'cm', 'm', 'km'], 'Nunca llega ya ordenado');
assert.equal(byType.sigfig.figures, 3);
checks += 7;

// Respuestas perfectas (calculadas con la instancia del servidor), salvo la escrita que califica el docente.
const record = store.raw().prepare('SELECT * FROM aula_records WHERE id=?').get(created.id);
const quizRecord = { ...record, data: JSON.parse(record.data) };
const anaId = store.raw().prepare("SELECT id FROM aula_users WHERE email='ana@example.test'").get().id;
const instance = quizInstance(quizRecord, anaId, 1);
const item = (type) => instance.find((x) => x.type === type);
const perfect = {};
const at = (type) => instance.find((x) => x.type === type).index;
perfect[at('truefalse')] = 1; // Falso
perfect[at('multi')] = item('multi').options.map((o, j) => (['Velocidad', 'Fuerza'].includes(o) ? j : null)).filter((j) => j !== null);
perfect[at('fill')] = ['N', 'Julio'];
perfect[at('matching')] = ['N', 'J', 'W'].map((u) => item('matching').rights.indexOf(u));
perfect[at('ordering')] = item('ordering').items.map((u) => ['mm', 'cm', 'm', 'km'].indexOf(u));
perfect[at('essay')] = 'Un cuerpo conserva su estado de reposo o movimiento rectilíneo uniforme si no actúa una fuerza neta.';
perfect[at('short')] = '  ACELERACION de la Gravedad ';
perfect[at('multishort')] = ['kg', 'Segundo'];
const speed = item('sigfig').values.d / 2;
perfect[at('sigfig')] = speed.toPrecision(3);
perfect[at('choice')] = item('choice').options.indexOf('C');
const graded = gradeAttempt(quizRecord, instance, perfect);
assert.deepEqual(graded.details.filter((d) => d.credit !== 1).map((d) => quizRecord.data.questions[d.index].type), ['essay']);
assert.equal(graded.pending, 1);
assert.equal(graded.score, 9, 'La escrita cuenta 0 mientras no se revisa');
checks += 3;

// Crédito parcial y respuestas equivocadas (con la función directamente).
const one = (type, answer) => gradeAttempt(quizRecord, instance, { [at(type)]: answer }).details.find((d) => d.index === at(type));
const opt = (name) => item('multi').options.indexOf(name);
assert.equal(one('multi', [opt('Velocidad')]).credit, 0.5, 'Una de dos correctas');
assert.equal(one('multi', [opt('Velocidad'), opt('Fuerza'), opt('Masa')]).credit, 0.5, 'Correctas menos incorrectas');
assert.equal(one('multi', [opt('Masa'), opt('Tiempo')]).credit, 0, 'Nunca negativo');
assert.equal(one('fill', ['newton', 'watt']).credit, 0.5);
assert.deepEqual(one('fill', ['newton', 'watt']).marks, [true, false]);
assert.equal(one('matching', [item('matching').rights.indexOf('N'), item('matching').rights.indexOf('Pa'), null]).credit, 1 / 3, 'El distractor no cuenta');
assert.equal(one('short', 'gravedad terrestre').credit, 0);
assert.equal(one('multishort', ['metro', 'm']).credit, 0.5, 'La misma respuesta dos veces cuenta una vez');
assert.equal(one('sigfig', String(speed.toPrecision(5))).credit, 0.5, 'Valor bien, cifras mal: descuento');
assert.equal(one('sigfig', String((speed * 1.5).toPrecision(3))).credit, 0);
assert.equal(one('truefalse', 0).credit, 0);
expectFail(() => one('matching', [9]), /no válida/);
expectFail(() => one('multi', 'a'), /no válida/);
checks += 11;
const ordering = [...item('ordering').items.map((u) => ['mm', 'cm', 'm', 'km'].indexOf(u))];
const swapped = ordering.map((p) => (p === 0 ? 1 : p === 1 ? 0 : p));
assert.equal(one('ordering', swapped).credit, 0.5, 'Dos de cuatro en su lugar');
checks++;

// Todo o nada
const strict = { ...quizRecord, data: { ...quizRecord.data, questions: quizRecord.data.questions.map((q) => (q.type === 'multi' || q.type === 'matching' || q.type === 'ordering' ? { ...q, scoring: 'all' } : q)) } };
const strictOne = (type, answer) => gradeAttempt(strict, instance, { [at(type)]: answer }).details[0].credit;
assert.deepEqual([strictOne('multi', [opt('Velocidad')]), strictOne('ordering', swapped)], [0, 0]);
checks++;

// ---- Envío por la API y calificación de la respuesta escrita ----
const enviado = await call('ana', '/api/attempt', { course: c, quiz: created.id, answers: perfect }, 201);
assert.equal(enviado.data.score, 9);
assert.equal(enviado.data.pending, 1);
checks += 2;
await call('ana', '/api/attempt/review', { course: c, id: enviado.id, reviews: [{ index: at('essay'), credit: 1 }] }, 403);
await call('docente', '/api/attempt/review', { course: c, id: enviado.id, reviews: [{ index: at('essay'), credit: 1.5 }] }, 400);
await call('docente', '/api/attempt/review', { course: c, id: 'otro', reviews: [{ index: 0, credit: 1 }] }, 404);
const revisado = await call('docente', '/api/attempt/review', { course: c, id: enviado.id, reviews: [{ index: at('essay'), credit: 0.8, feedback: 'Falta mencionar el marco inercial.' }] });
assert.equal(revisado.data.score, 9.8);
assert.equal(revisado.data.pending, undefined);
const essay = revisado.data.details.find((d) => d.index === at('essay'));
assert.deepEqual([essay.credit, essay.reviewed, essay.feedback], [0.8, true, 'Falta mencionar el marco inercial.']);
// También puede ajustar otra pregunta (por ejemplo, aceptar una respuesta corta con otra redacción).
const ajuste = await call('docente', '/api/attempt/review', { course: c, id: enviado.id, reviews: [{ index: at('choice'), credit: 0 }] });
assert.equal(ajuste.data.score, 8.8);
assert(ajuste.data.details.find((d) => d.index === at('choice')).overridden);
// El alumno ve su calificación actualizada y la retroalimentación.
const deAna = await call('ana', '/api/course?id=' + c);
const suyo = deAna.records.find((r) => r.kind === 'attempt');
assert.equal(suyo.data.score, 8.8);
assert.equal(suyo.data.details.find((d) => d.index === at('essay')).feedback, 'Falta mencionar el marco inercial.');
// Sin «qué preguntas acertó» solo llegan los comentarios; con la calificación oculta, tampoco.
const intento = { data: { score: 8.8, details: ajuste.data.details } };
const sinAciertos = studentAttemptView(intento, { data: { settings: { results: { score: true, review: 'none' } } } });
assert.equal(sinAciertos.data.details, null);
assert.deepEqual(sinAciertos.data.feedback, [{ index: at('essay'), credit: 0.8, feedback: 'Falta mencionar el marco inercial.' }]);
assert.equal(studentAttemptView(intento, { data: { settings: { results: { score: false, review: 'none' } } } }).data.feedback, undefined);
checks += 8;

// ---- Modo examen: se guardan a medio camino respuestas de todos los tipos ----
const examen = await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Examen', visible: true, questions, settings: { attempts: 1, exam: { enabled: true } } } }, 201);
await call('beto', '/api/attempt/start', { course: c, quiz: examen.id });
const parcial = { 1: [0], 2: ['newton'], 3: [1, null, 0], 4: [3, 2, 1, 0], 5: 'Borrador de mi respuesta', 7: ['m', ''] };
await call('beto', '/api/attempt/progress', { course: c, quiz: examen.id, attempt: 1, answers: parcial, position: 0, events: [] });
const retomado = await call('beto', '/api/attempt/start', { course: c, quiz: examen.id });
assert.deepEqual(retomado.saved, parcial, 'Al retomar recupera listas y textos');
const final = await call('beto', '/api/attempt', { course: c, quiz: examen.id, answers: parcial }, 201);
assert.equal(final.data.pending, 1);
checks += 2;

// ---- Banco de preguntas: los tipos nuevos se guardan y se usan igual ----
const banco = await call('docente', '/api/bank', { course: c, topic: 'Unidades', questions: questions.slice(0, 9) }, 201);
assert.equal(banco.saved, 9);
checks++;

console.log(`PASS: ${checks} verificaciones de tipos de reactivos — validación, instancias sin respuestas, crédito parcial y todo o nada, respuesta escrita calificada por el docente, examen a medio camino y banco.`);
