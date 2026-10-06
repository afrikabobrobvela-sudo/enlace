// Pruebas de la 12.26: parciales con peso en la final, categorías por parcial (Laboratorio para toda la materia),
// distribución y calificaciones que no cuentan, evaluaciones y foros enlazados desde «Cómo se calcula» y la categoría
// elegida en el editor de la actividad.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'docente@example.test', SESSION_SECRET: 'q'.repeat(40) };
let checks = 0;
const cookies = {};
async function call(user, path, data, status = 200) {
  cookies[user] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user }),
    env,
  );
  const method = data === undefined ? 'GET' : 'POST';
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
const c = (await call('docente', '/api/courses', { name: 'Química', group: '30296' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: [{ name: 'Ana', email: 'ana@example.test' }] });
await call('ana', '/api/me');
const record = (kind, data) => call('docente', '/api/record', { course: c, kind, data: { visible: true, ...data } }, 201);
const t1 = await record('task', { title: 'Infografía isótopos' });
const t2 = await record('task', { title: 'Balanceo de ecuaciones' });
const lab = await record('task', { title: 'Práctica 1' });
const quiz = await record('quiz', { title: 'Examen escrito 1', questions: [{ type: 'truefalse', text: 'El agua es un compuesto.', correct: true }] });
const forum = await record('forum', { title: 'Debate: energía nuclear', body: '' });
const course = () => call('docente', '/api/course?id=' + c);
const grading = async () => (await course()).records.find((r) => r.kind === 'grading');

const P1 = { key: 'p1', name: 'Parcial 1', weight: 40 };
const P2 = { key: 'p2', name: 'Parcial 2', weight: 40 };
const cat = (key, name, weight, term = '', extra = {}) => ({ key, name, weight, term, source: 'tasks', ...extra });
const base = (over = {}) => ({
  course: c,
  scheme: 'categories',
  terms: [P1, P2],
  categories: [
    cat('e1', 'Exámenes', 60, 'p1'),
    cat('t1', 'Tareas', 40, 'p1', { distribution: 'equal', dropLow: 1 }),
    cat('e2', 'Exámenes', 60, 'p2'),
    cat('t2', 'Tareas', 40, 'p2'),
    cat('lab', 'Laboratorio', 20),
  ],
  ...over,
});
let revision = 0;
const scheme = async (body, status = 200) => {
  const r = await call('docente', '/api/grades/scheme', { revision, ...body }, status);
  if (status === 200) revision = (await grading()).revision;
  return r;
};

// ---- Validación ----
await scheme(base({ terms: [P1, { ...P2, weight: 50 }] }), 400); // 40 + 50 + 20 ≠ 100
await scheme(base({ categories: base().categories.map((x) => (x.key === 't1' ? { ...x, weight: 30 } : x)) }), 400); // Parcial 1 suma 90
await scheme(base({ categories: base().categories.filter((x) => x.term !== 'p2').concat(cat('x', 'Proyecto', 0)) }), 400); // Parcial 2 sin categorías (las sumas sí dan 100)
await scheme(base({ categories: [...base().categories, cat('e1b', 'exámenes', 0, 'p1')] }), 400); // repetida en el mismo parcial
await scheme(base({ categories: [...base().categories, { key: 'as', name: 'Asistencia', weight: 0, source: 'attendance', term: 'p1' }] }), 400); // asistencia dentro de un parcial
await scheme(base({ categories: base().categories.map((x) => (x.key === 't1' ? { ...x, dropLow: 21 } : x)) }), 400);
await scheme(base({ categories: base().categories.map((x) => (x.key === 'lab' ? { ...x, term: 'nada' } : x)) }), 400);
await call('ana', '/api/grades/scheme', base(), 403);

// ---- Guardar con evaluaciones y foros enlazados ----
const r0 = await call('docente', '/api/grades/scheme', {
  ...base(),
  revision,
  assignments: [
    { task: t1.id, category: 't1', points: 1 },
    { task: t2.id, category: 't1', points: 3 },
    { task: lab.id, category: 'lab', points: 1 },
  ],
  quizzes: [{ quiz: quiz.id, category: 'e1', points: 10, policy: 'last' }],
  forums: [{ forum: forum.id, category: 't2', points: 2 }],
});
assert.deepEqual([r0.quizzes, r0.forums], [1, 1]);
let data = await course();
let g = data.records.find((r) => r.kind === 'grading').data;
revision = data.records.find((r) => r.kind === 'grading').revision;
assert.deepEqual(g.terms.map((t) => [t.name, t.weight]), [['Parcial 1', 40], ['Parcial 2', 40]]);
const idOf = (name, termName) => g.categories.find((x) => x.name === name && (termName ? g.terms.find((t) => t.id === x.term)?.name === termName : !x.term)).id;
const tareas1 = g.categories.find((x) => x.id === idOf('Tareas', 'Parcial 1'));
assert.deepEqual([tareas1.distribution, tareas1.dropLow, tareas1.dropHigh], ['equal', 1, 0]);
assert.equal(g.categories.find((x) => x.name === 'Laboratorio').term, '');
const q = data.records.find((r) => r.id === quiz.id);
assert.deepEqual(q.data.grade, { category: idOf('Exámenes', 'Parcial 1'), points: 10, policy: 'last' });
assert.equal(q.revision, quiz.revision + 1, 'La evaluación sube de revisión (el editor abierto no pisa el cambio)');
const participation = data.records.find((r) => r.kind === 'task' && r.data.forum === forum.id);
assert.deepEqual([participation.data.category, participation.data.points, participation.data.title], [idOf('Tareas', 'Parcial 2'), 2, 'Participación: Debate: energía nuclear']);
assert.equal(data.records.find((r) => r.id === t2.id).data.points, 3);
checks += 7;
// Otra vez: el foro ya tiene su actividad (no se duplica) y la evaluación sin cambios no se toca.
const r1 = await call('docente', '/api/grades/scheme', {
  ...base({ terms: g.terms.map((t) => ({ key: t.id, name: t.name, weight: t.weight })), categories: g.categories.map((x) => ({ ...x, key: x.id })) }),
  revision,
  quizzes: [{ quiz: quiz.id, category: idOf('Exámenes', 'Parcial 1'), points: 10, policy: 'last' }],
  forums: [{ forum: forum.id, category: idOf('Tareas', 'Parcial 2'), points: 2 }],
});
assert.deepEqual([r1.quizzes, r1.forums], [0, 0]);
data = await course();
assert.equal(data.records.filter((r) => r.kind === 'task' && r.data.forum === forum.id).length, 1);
assert.equal(data.records.find((r) => r.id === quiz.id).revision, quiz.revision + 1);
// Los ids de los parciales se conservan al volver a guardar.
assert.deepEqual(data.records.find((r) => r.kind === 'grading').data.terms.map((t) => t.id), g.terms.map((t) => t.id));
checks += 3;
revision = data.records.find((r) => r.kind === 'grading').revision;
// Quitar la evaluación de la calificación.
await call('docente', '/api/grades/scheme', {
  ...base({ terms: g.terms.map((t) => ({ key: t.id, name: t.name, weight: t.weight })), categories: g.categories.map((x) => ({ ...x, key: x.id })) }),
  revision,
  quizzes: [{ quiz: quiz.id, category: null }],
});
assert.equal('grade' in (await course()).records.find((r) => r.id === quiz.id).data, false);
checks++;

// ---- La categoría desde el editor de la actividad ----
const labId = idOf('Laboratorio');
const nueva = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Práctica 2', visible: true, gradebook: { category: labId, points: 2 } } }, 201);
assert.deepEqual([nueva.data.category, nueva.data.points], [labId, 2]);
await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'X', visible: true, gradebook: { category: 'ajena' } } }, 400);
await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'X', visible: true, gradebook: { category: labId, points: 0 } } }, 400);
// Editar sin la llave «gradebook» (por ejemplo, el material del docente) conserva la categoría.
const editada = await call('docente', '/api/record', { course: c, kind: 'task', id: nueva.id, revision: nueva.revision, data: { title: 'Práctica 2 (corregida)', visible: true } });
assert.deepEqual([editada.data.category, editada.data.points], [labId, 2]);
const sinCategoria = await call('docente', '/api/record', { course: c, kind: 'task', id: nueva.id, revision: editada.revision, data: { title: 'Práctica 2', visible: true, gradebook: { category: null } } });
assert.equal(sinCategoria.data.category, null);
checks += 3;

// ---- Copiar el curso conserva parciales y opciones ----
const copia = await call('docente', '/api/course/copy', { course: c, name: 'Química', group: 'B' }, 201);
const gc = (await call('docente', '/api/course?id=' + copia.id)).records.find((r) => r.kind === 'grading').data;
assert.deepEqual(gc.terms.map((t) => t.name), ['Parcial 1', 'Parcial 2']);
assert.equal(gc.categories.filter((x) => x.term === gc.terms[0].id).length, 2);
assert.equal(gc.categories.find((x) => x.name === 'Tareas' && x.term === gc.terms[0].id).dropLow, 1);
checks += 3;
// Volver a pesos por actividad (y sin parciales) sigue funcionando.
await call('docente', '/api/grades/scheme', { course: copia.id, revision: (await call('docente', '/api/course?id=' + copia.id)).records.find((r) => r.kind === 'grading').revision, scheme: 'tasks', categories: [] });
assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);

// ---- Cálculo en el navegador ----
const noop = () => {};
const el = () => ({ innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop }, addEventListener: noop, querySelector: () => null, focus: noop });
const context = vm.createContext({
  document: { querySelector: el, querySelectorAll: () => [], getElementById: el, addEventListener: noop, head: { append: noop }, body: { classList: { add: noop, remove: noop, toggle: noop } } },
  window: { addEventListener: noop },
  localStorage: { getItem: () => null, setItem: noop },
  crypto: globalThis.crypto,
  structuredClone,
  console,
  setTimeout,
  clearTimeout,
});
vm.runInContext(readFileSync('src/public/grading.js', 'utf8'), context);
const run = (code) => vm.runInContext(code, context);
const close = (a, b) => Math.abs(a - b) < 1e-9;
run(`
  var T = (id, category, points = 1) => ({ id, data: { title: id, category, points, visible: true } });
  var settings = {
    scheme: 'categories',
    terms: [{ id: 'p1', name: 'Parcial 1', weight: 40 }, { id: 'p2', name: 'Parcial 2', weight: 40 }],
    categories: [
      { id: 'e1', name: 'Exámenes', weight: 60, source: 'tasks', term: 'p1' },
      { id: 't1', name: 'Tareas', weight: 40, source: 'tasks', term: 'p1', distribution: 'equal', dropLow: 1 },
      { id: 'e2', name: 'Exámenes', weight: 60, source: 'tasks', term: 'p2' },
      { id: 't2', name: 'Tareas', weight: 40, source: 'tasks', term: 'p2' },
      { id: 'lab', name: 'Laboratorio', weight: 20, source: 'tasks', term: '' },
    ],
    final: { decimals: 0, rounding: 'down', passing: 6, failingAs: null, missingAsZero: false },
  };
  var tasks = [T('a', 't1', 1), T('b', 't1', 5), T('c', 't1', 1), T('d', 't2', 1), T('e', 't2', 3), T('l', 'lab')];
  var grades = new Map([['a', 4], ['b', 8], ['c', 10], ['d', 10], ['e', 6], ['l', 9]]);
  var quizzes = [{ id: 'q', data: { grade: { category: 'e1', points: 10 } } }];
`);
let r = run(`computeGrade({ tasks, grades, settings, quizzes, quizGrades: new Map([['q', 7]]) })`);
// Tareas P1: sin la más baja (4) y todas iguales → (8 + 10) / 2 = 9. Exámenes P1 = 7 (la evaluación).
assert(close(r.categories[1].value, 9), 'Tareas del parcial 1: se descarta la más baja y pesan igual');
assert(close(r.terms[0].value, 7 * 0.6 + 9 * 0.4), 'Parcial 1 = 7×60 % + 9×40 %');
// Parcial 2: las tareas valen 40 %; Exámenes vacío conserva su 60 % y aporta 0.
// 12.44: sin su examen, el parcial 2 está en curso: no cuenta en el promedio parcial; lleva 2.8 (el rubro vacío no
// redistribuye su peso) y en la calificación final sí conserva su peso completo.
assert(r.terms[1].value === null && !r.terms[1].complete && r.terms[0].complete, 'Parcial 2 en curso (falta Exámenes)');
assert(close(r.terms[1].partial, 2.8), 'Lo que lleva el parcial 2: 7×40 % (Exámenes vacío conserva su peso)');
assert(close(r.value, ((7 * 0.6 + 9 * 0.4) * 40 + 9 * 20) / 60), 'Promedio parcial = parcial 1 completo y Laboratorio');
let rf = run(`computeGrade({ tasks, grades, settings, quizzes, quizGrades: new Map([['q', 7]]), final: true })`);
assert(close(rf.terms[1].value, 2.8), 'En la final, el parcial 2 vale 7×40 % = 2.8');
assert(close(rf.value, ((7 * 0.6 + 9 * 0.4) * 40 + 2.8 * 40 + 9 * 20) / 100), 'Final = parciales y Laboratorio con sus pesos completos');
// Sin nada calificado en el parcial 2, la final se normaliza entre el parcial 1 y Laboratorio.
r = run(`computeGrade({ tasks: tasks.filter((t) => !['d', 'e'].includes(t.id)), grades, settings, quizzes, quizGrades: new Map([['q', 7]]) })`);
assert(r.terms[1].value === null && close(r.value, ((7 * 0.6 + 9 * 0.4) * 40 + 9 * 20) / 60));
// Quitar la más alta y la más baja con una sola calificación: no deja la categoría vacía.
assert.equal(JSON.stringify(run(`dropExtremes([{ grade: 5, points: 1 }], 1, 1)`)), '[{"grade":5,"points":1}]');
assert.deepEqual(JSON.parse(JSON.stringify(run(`dropExtremes([1, 9, 5, 7].map((grade) => ({ grade, points: 1 })), 1, 1)`))).map((x) => x.grade), [5, 7]);
assert.equal(run(`categoryLabel(settings.categories[3], settings)`), 'Parcial 2 · Tareas');
assert.equal(run(`categoryLabel(settings.categories[4], settings)`), 'Laboratorio');
// Sin parciales se calcula como antes: un solo nivel de categorías.
r = run(`computeGrade({ tasks: [T('l', 'lab'), T('d', 't2')], grades, settings: { ...settings, terms: [], categories: [{ id: 'lab', name: 'Lab', weight: 50, source: 'tasks' }, { id: 't2', name: 'Tareas', weight: 50, source: 'tasks' }] } })`);
assert(close(r.value, 9.5) && r.terms.length === 0);
// Caso real: Exámenes (40 %) vacío, Tareas 6.29 (40 %) y otro rubro 9.5 (20 %).
// El parcial es 4.416, no se reescala el 60 % capturado a 100 %. Con el segundo parcial vacío,
// el promedio parcial sigue en 4.416, pero la final 50/50 conserva ambos parciales y queda en 2.208.
run(`
  var incomplete = {
    scheme: 'categories',
    terms: [{ id: 'p1', name: 'Parcial 1', weight: 50 }, { id: 'p2', name: 'Parcial 2', weight: 50 }],
    categories: [
      { id: 'exam', name: 'Exámenes', weight: 40, source: 'tasks', term: 'p1' },
      { id: 'tasks', name: 'Tareas', weight: 40, source: 'tasks', term: 'p1' },
      { id: 'other', name: 'Otro rubro', weight: 20, source: 'tasks', term: 'p1' },
      { id: 'p2all', name: 'Parcial 2', weight: 100, source: 'tasks', term: 'p2' },
    ],
    final: { decimals: 0, rounding: 'down', passing: 6, failingAs: null, missingAsZero: false },
  };
  var incompleteTasks = [T('task-grade', 'tasks'), T('other-grade', 'other')];
  var incompleteGrades = new Map([['task-grade', 6.29], ['other-grade', 9.5]]);
`);
const incompletePartial = run('computeGrade({ tasks: incompleteTasks, grades: incompleteGrades, settings: incomplete })');
const incompleteFinal = run('computeGrade({ tasks: incompleteTasks, grades: incompleteGrades, settings: incomplete, final: true })');
assert(close(incompletePartial.terms[0].partial, 4.416) && incompletePartial.terms[0].value === null && close(incompletePartial.value, 4.416), '6.29×40 % + 9.5×20 % = 4.416 (en curso: sin parcial completo, el promedio usa lo que lleva)');
assert(incompletePartial.terms[1].value === null && close(incompleteFinal.value, 2.208), 'La final conserva los dos parciales de 50 %');
assert.equal(run(`courseFinalGrade(${JSON.stringify(incompleteFinal)}, incomplete.final).value`), 2, 'Final: promedio de Parcial 1 asentado en 4 y Parcial 2 vacío en 0');
assert.equal(
  run("courseFinalGrade({ value: 7.9, terms: [{ id: 'p1', weight: 50, value: 5.9 }, { id: 'p2', weight: 50, value: 9.9 }], categories: [{ term: 'p1' }, { term: 'p2' }] }, incomplete.final).value"),
  7,
  'La final promedia las calificaciones asentadas de los parciales: (5 + 10) / 2 = 7.5 → 7',
);
// «Dividir por parciales»: las categorías se copian a cada parcial y la asistencia queda para toda la materia.
run(`
  var draft = { terms: [], categories: [
    { key: 'ex', name: 'Exámenes', weight: 60, source: 'tasks', term: '' },
    { key: 'ta', name: 'Tareas', weight: 30, source: 'tasks', term: '' },
    { key: 'as', name: 'Asistencia', weight: 10, source: 'attendance', term: '' },
  ] };
  splitDraftInTerms(draft, 3);
`);
const draft = JSON.parse(run('JSON.stringify(draft)'));
assert.deepEqual(draft.terms.map((t) => t.weight), [30, 30, 30]);
assert.equal(draft.categories.filter((x) => x.term === draft.terms[0].key).map((x) => x.key).join(), 'ex,ta', 'El parcial 1 conserva las categorías originales');
assert(draft.terms.every((t) => close(draft.categories.filter((x) => x.term === t.key).reduce((n, x) => n + x.weight, 0), 100)));
assert.equal(draft.categories.find((x) => x.source === 'attendance').term, '');
assert(JSON.parse(run('JSON.stringify(draftTotals(draft))')).every((t) => t.ok), 'Las sumas quedan en 100 %');
run('removeDraftTerm(draft, 2)');
assert(JSON.parse(run('JSON.stringify(draft.categories)')).some((x) => x.name === 'Tareas (Parcial 3)' && !x.term));
checks += 15;

console.log(`PASS: ${checks} verificaciones de la 12.26 — parciales con peso en la final, categorías por parcial y de toda la materia, distribución y calificaciones que no cuentan, evaluaciones y foros enlazados desde el libro, y la categoría en el editor de la actividad.`);
