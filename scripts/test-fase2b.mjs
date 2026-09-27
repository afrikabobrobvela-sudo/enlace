// Pruebas de la fase 2B: categorías con pesos, calificación final, rúbricas y entregas por equipo.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'docente@example.test', SESSION_SECRET: 'b'.repeat(40) };
let checks = 0;
const cookies = {};
async function send(user, path, { method = 'GET', data, headers = {}, raw } = {}) {
  cookies[user] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user }),
    env,
  );
  return api(
    new Request('https://t.local' + path, {
      method,
      headers: { cookie: cookies[user], Origin: 'https://t.local', 'X-Aula-Request': '1', ...headers },
      body: raw ?? (data === undefined ? undefined : JSON.stringify(data)),
    }),
    env,
  );
}
async function call(user, path, data, status = 200, method = data === undefined ? 'GET' : 'POST') {
  const res = await send(user, path, { method, data });
  const text = await res.text();
  assert.equal(res.status, status, `${method} ${path} → ${text}`);
  checks++;
  return JSON.parse(text);
}

// Dos docentes: la cuenta principal y una colega dada de alta en "Docentes".
await call('docente', '/api/me');
await call('docente', '/api/teachers', { email: 'colega@example.test', name: 'Colega', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '101' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: ['ana', 'luis', 'sofia', 'rosa'].map((n) => ({ name: n, email: n + '@example.test' })) });
for (const n of ['ana', 'luis', 'sofia', 'rosa', 'colega']) await call(n, '/api/me');
const course = () => call('docente', '/api/course?id=' + c);
const roster = (await course()).members;
const id = (n) => roster.find((m) => m.email === n + '@example.test').id;
const task = async (data) => (await call('docente', '/api/record', { course: c, kind: 'task', data: { visible: true, ...data } }, 201));
const grading = async () => (await course()).records.find((r) => r.kind === 'grading');

// ---- Categorías con pesos ----
const examen = await task({ title: 'Examen 1' });
const tarea = await task({ title: 'Tarea 1' });
let g = await grading();
assert.deepEqual([g.revision, g.data.scheme], [0, 'tasks']);
const scheme = (over = {}) => ({
  course: c,
  revision: g.revision,
  scheme: 'categories',
  categories: [
    { key: 'e', name: 'Exámenes', weight: 60 },
    { key: 't', name: 'Tareas', weight: 30 },
    { key: 'a', name: 'Asistencia', weight: 10, source: 'attendance' },
  ],
  assignments: [{ task: examen.id, category: 'e', points: 2 }, { task: tarea.id, category: 't', points: 1 }],
  ...over,
});
await call('ana', '/api/grades/scheme', scheme(), 403);
await call('docente', '/api/grades/scheme', scheme({ categories: [{ key: 'e', name: 'Exámenes', weight: 60 }] }), 400); // suman 60
await call('docente', '/api/grades/scheme', scheme({ categories: [{ key: 'e', name: 'Exámenes', weight: 50 }, { key: 'x', name: 'exámenes', weight: 50 }] }), 400);
await call('docente', '/api/grades/scheme', scheme({ categories: [{ key: 'a', name: 'A1', weight: 50, source: 'attendance' }, { key: 'b', name: 'A2', weight: 50, source: 'attendance' }] }), 400);
await call('docente', '/api/grades/scheme', scheme({ assignments: [{ task: examen.id, category: 'a' }] }), 400); // asistencia sin actividades
await call('docente', '/api/grades/scheme', scheme({ assignments: [{ task: 'otra', category: 'e' }] }), 400);
await call('docente', '/api/grades/scheme', scheme({ assignments: [{ task: examen.id, category: 'e', points: 0 }] }), 400);
await call('docente', '/api/grades/scheme', scheme());
await call('docente', '/api/grades/scheme', scheme(), 409); // revisión vieja
g = await grading();
assert.equal(g.data.scheme, 'categories');
assert.deepEqual(g.data.categories.map((x) => [x.name, x.weight, x.source]), [['Exámenes', 60, 'tasks'], ['Tareas', 30, 'tasks'], ['Asistencia', 10, 'attendance']]);
let tasks = (await course()).records.filter((r) => r.kind === 'task');
const exams = g.data.categories[0].id;
assert.deepEqual(tasks.map((t) => [t.data.title, t.data.category, t.data.points]), [['Examen 1', exams, 2], ['Tarea 1', g.data.categories[1].id, 1]]);
// Quitar "Tareas": su actividad queda sin categoría; los ids de las que siguen se conservan.
await call('docente', '/api/grades/scheme', {
  course: c,
  revision: g.revision,
  scheme: 'categories',
  categories: [{ key: exams, name: 'Exámenes', weight: 90 }, { key: g.data.categories[2].id, name: 'Asistencia', weight: 10, source: 'attendance' }],
});
tasks = (await course()).records.filter((r) => r.kind === 'task');
assert.deepEqual(tasks.map((t) => t.data.category), [exams, null]);
g = await grading();
assert.equal(g.data.categories[0].id, exams);

// ---- Reglas de la calificación final ----
const rules = { course: c, decimals: 0, rounding: 'half_up', passing: 6, failingAs: 5, missingAsZero: true };
await call('docente', '/api/grades/final-rules', { ...rules, revision: g.revision, failingAs: 6 }, 400);
await call('docente', '/api/grades/final-rules', { ...rules, revision: g.revision, decimals: 3 }, 400);
await call('docente', '/api/grades/final-rules', { ...rules, revision: g.revision });
g = await grading();
assert.deepEqual(g.data.final, { decimals: 0, rounding: 'half_up', passing: 6, failingAs: 5, missingAsZero: true });
assert.equal((await call('ana', '/api/course?id=' + c)).records.find((r) => r.kind === 'grading').data.scheme, 'categories', 'El alumno calcula con las mismas reglas');

// ---- Rúbricas ----
const lab = {
  title: 'Reporte de laboratorio',
  levels: [{ name: 'Excelente', points: 4 }, { name: 'Bien', points: 3 }, { name: 'Suficiente', points: 2 }, { name: 'Insuficiente', points: 0 }],
  criteria: [
    { name: 'Planteamiento', descriptors: ['Claro y completo', '', '', 'Ausente'] },
    { name: 'Análisis de datos', descriptors: [] },
    { name: 'Conclusiones', descriptors: [] },
  ],
};
await call('ana', '/api/rubrics', undefined, 403);
await call('docente', '/api/rubric', { ...lab, levels: [{ name: 'Único', points: 1 }] }, 400);
await call('docente', '/api/rubric', { ...lab, criteria: [] }, 400);
const mine = (await call('docente', '/api/rubric', lab, 201)).id;
const hers = (await call('colega', '/api/rubric', { ...lab, title: 'Privada de la colega' }, 201)).id;
const shared = (await call('colega', '/api/rubric', { ...lab, title: 'Compartida por la colega', shared: true }, 201)).id;
const visible = (await call('docente', '/api/rubrics')).rubrics;
assert.deepEqual(visible.map((r) => [r.data.title, r.mine]), [['Compartida por la colega', false], ['Reporte de laboratorio', true]]);
assert.equal(visible[0].data.ownerName, 'Colega');
await call('docente', '/api/rubric', { ...lab, id: shared, revision: 1, title: 'Cambio ajeno' }, 403);
await call('colega', '/api/rubric', { ...lab, id: shared, revision: 7, shared: true }, 409);
await call('docente', '/api/rubric', { ...lab, id: mine, revision: 1, title: 'Reporte de laboratorio' });

const practica = await task({ title: 'Práctica 1', rubric: mine });
await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'X', visible: true, rubric: hers } }, 400); // privada ajena
const conCompartida = await task({ title: 'Práctica 2', rubric: shared });
assert.equal(conCompartida.data.rubric, shared);
assert(((await course()).records.filter((r) => r.kind === 'rubric').map((r) => r.id)).includes(shared), 'El curso trae las rúbricas que usa');

const sub = await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: practica.id, body: 'Mi reporte' } }, 201);
const gradeWith = (scores, extra = {}) => ({ course: c, task: practica.id, member: id('ana'), revision: sub.revision, grade: 7.5, feedback: 'Bien', rubric: { scores, comments: ['', 'Faltan unidades', ''] }, ...extra });
await call('docente', '/api/grade', gradeWith([0, 1]), 400); // falta un criterio
await call('docente', '/api/grade', gradeWith([0, 9, 2]), 400); // nivel inexistente
const graded = await call('docente', '/api/grade', gradeWith([0, 1, 2], { publish: false }));
assert.deepEqual(
  { total: graded.data.rubricScores.total, max: graded.data.rubricScores.max, second: graded.data.rubricScores.items[1] },
  { total: 9, max: 12, second: { criterion: 'Análisis de datos', level: 'Bien', points: 3, max: 4, comment: 'Faltan unidades' } },
);
let anaView = (await call('ana', '/api/course?id=' + c)).records.find((r) => r.id === sub.id);
assert.equal(anaView.data.rubricScores, null, 'En borrador el alumno no ve la rúbrica');
await call('docente', '/api/grades/publish', { course: c, task: practica.id });
anaView = (await call('ana', '/api/course?id=' + c)).records.find((r) => r.id === sub.id);
assert.equal(anaView.data.rubricScores.items[0].level, 'Excelente');
// Borrar la rúbrica no borra lo ya calificado.
await call('colega', '/api/rubric', { id: mine }, 403, 'DELETE');
await call('docente', '/api/rubric', { id: mine }, 200, 'DELETE');
anaView = (await call('ana', '/api/course?id=' + c)).records.find((r) => r.id === sub.id);
assert.equal(anaView.data.rubricScores.total, 9);
assert.equal((await course()).records.find((r) => r.id === practica.id).data.rubric, null);

// ---- Entregas por equipo ----
await call('docente', '/api/groups/bulk', { course: c, category: 'Laboratorio', groups: [{ title: 'Equipo 1', members: [id('ana'), id('luis')] }, { title: 'Equipo 2', members: [id('sofia')] }] }, 201);
const equipo = await task({ title: 'Reporte en equipo', groupCategory: 'Laboratorio', allowResubmit: true });
const up = await send('ana', `/api/upload?course=${c}&scope=submission&task=${equipo.id}`, { method: 'POST', headers: { 'X-File-Name': 'reporte.pdf' }, raw: new TextEncoder().encode('%PDF-1.7 equipo') });
const fileId = (await up.json()).id;
await call('rosa', '/api/record', { course: c, kind: 'submission', data: { task: equipo.id, body: 'sola' } }, 403); // sin equipo
const teamSub = await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: equipo.id, body: 'Entrega del equipo 1', fileIds: [fileId] } }, 201);
const luisView = (await call('luis', '/api/course?id=' + c)).records.find((r) => r.kind === 'submission' && r.data.task === equipo.id);
assert.deepEqual([luisView.data.body, luisView.data.fileIds, luisView.author], ['Entrega del equipo 1', [fileId], teamSub.author], 'Luis ve la entrega de su equipo');
assert.equal((await send('luis', `/api/file/${fileId}`)).status, 200, 'Luis descarga el archivo que subió Ana');
assert.equal((await send('luis', `/api/file/${fileId}?preview=1`)).status, 200);
assert.equal((await send('sofia', `/api/file/${fileId}`)).status, 403, 'Otro equipo no lo ve');
// Luis actualiza la entrega: cambia para los dos y se reinicia la calificación.
await call('luis', '/api/record', { course: c, kind: 'submission', id: luisView.id, revision: luisView.revision, data: { task: equipo.id, body: 'Versión final', fileIds: [] } });
const records = (await course()).records.filter((r) => r.kind === 'submission' && r.data.task === equipo.id);
assert.deepEqual(records.map((r) => r.data.body).sort(), ['Versión final', 'Versión final']);
// Calificar a todo el equipo desde la entrega de Ana, y luego ajustar solo a Luis.
const anaTeam = records.find((r) => r.data.member === id('ana'));
await call('docente', '/api/grade', { course: c, task: examen.id, member: id('ana'), grade: 9, team: true }, 400); // no es por equipo
await call('docente', '/api/grade', { course: c, task: equipo.id, member: id('ana'), revision: anaTeam.revision, grade: 8, feedback: 'Buen trabajo', team: true });
let teamGrades = (await course()).records.filter((r) => r.kind === 'submission' && r.data.task === equipo.id);
assert.deepEqual(teamGrades.map((r) => [r.data.member === id('ana') ? 'ana' : 'luis', r.data.grade, r.data.feedback]).sort(), [['ana', 8, 'Buen trabajo'], ['luis', 8, 'Buen trabajo']]);
const luisRow = teamGrades.find((r) => r.data.member === id('luis'));
await call('docente', '/api/grade', { course: c, task: equipo.id, member: id('luis'), revision: luisRow.revision, grade: 6, feedback: 'Participó poco' });
teamGrades = (await course()).records.filter((r) => r.kind === 'submission' && r.data.task === equipo.id);
assert.deepEqual(teamGrades.map((r) => r.data.grade).sort(), [6, 8], 'El ajuste individual no toca al resto del equipo');
await call('docente', '/api/grade', { course: c, task: equipo.id, member: id('luis'), revision: luisRow.revision, grade: 7 }, 409);
// Un integrante sin entrega (Sofía, sola en su equipo) recibe su calificación como registro manual.
await call('docente', '/api/grade', { course: c, task: equipo.id, member: id('sofia'), grade: 5, team: true });
assert.equal((await course()).records.find((r) => r.kind === 'submission' && r.data.member === id('sofia') && r.data.task === equipo.id).data.manual, true);
// Una sola entrega permitida: el compañero ya no puede reemplazarla.
const unica = await task({ title: 'Una sola entrega', groupCategory: 'Laboratorio', allowResubmit: false });
await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: unica.id, body: 'Hecho' } }, 201);
assert.match((await call('luis', '/api/record', { course: c, kind: 'submission', data: { task: unica.id, body: 'Otra' } }, 403)).error, /una sola entrega/);

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
store.close();
console.log(`PASS: ${checks} verificaciones de la fase 2B — categorías y reglas finales, banco de rúbricas con permisos, evaluación con rúbrica y entregas por equipo.`);
