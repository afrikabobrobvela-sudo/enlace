// Pruebas de la versión 12.14: publicación programada (lo que aún no se publica no llega al alumno por ninguna vía),
// evaluaciones que cuentan en la calificación (validación en el servidor y cálculo real de grading.js con las reglas
// mejor/último/promedio) y seguimiento del contenido (abierto/completado por alumno, visible solo a quien corresponde).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
let checks = 0;
const cookies = {};
async function raw(who, path, { method, body, headers = {} } = {}) {
  cookies[who] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who }), env);
  const before = store.counter.queries;
  const res = await api(
    new Request('https://t.local' + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { cookie: cookies[who], Origin: 'https://t.local', 'X-Aula-Request': '1', ...headers }, body }),
    env,
  );
  assert(store.counter.queries - before <= 50, `${path}: ${store.counter.queries - before} consultas`);
  return res;
}
async function call(who, path, data, status = 200, method) {
  const res = await raw(who, path, { method, body: data === undefined ? undefined : JSON.stringify(data) });
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${who}) → ${text}`);
  checks++;
  return JSON.parse(text);
}
const DAY = 86_400_000;
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();
const setData = (id, path, value) => store.raw().prepare(`UPDATE aula_records SET data=json_set(data,'${path}',?) WHERE id=?`).run(value, id);

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '501' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: ['ana', 'beto'].map((n) => ({ name: n, email: n + '@example.test' })) });
for (const who of ['ana', 'beto']) await call(who, '/api/me');
const members = Object.fromEntries((await call('docente', '/api/course?id=' + c)).members.map((m) => [m.name, m.id]));
const rec = (kind, data, status = 201) => call('docente', '/api/record', { course: c, kind, data }, status);
const upload = async () => {
  const res = await raw('docente', `/api/upload?course=${c}&scope=material`, { body: '%PDF-1.4 guía', headers: { 'x-file-name': 'guia.pdf', 'content-type': 'application/pdf' } });
  assert.equal(res.status, 201);
  return (await res.json()).id;
};

// ================= Publicación programada =================
const futuro = inDays(3);
const unidad = await rec('module', { title: 'Unidad 2', body: '', visible: true, publishAt: futuro });
const archivo = await upload();
const material = await rec('material', { title: 'Guía', body: '', visible: true, module: unidad.id, fileIds: [archivo] });
const aviso = await rec('notice', { title: 'Parcial 2', body: 'Viernes', visible: true, publishAt: futuro });
const foro = await rec('forum', { title: 'Dudas U2', body: '', visible: true, publishAt: futuro });
const quiz = await rec('quiz', { title: 'Q U2', visible: true, publishAt: futuro, questions: [{ type: 'choice', text: '¿1+1?', options: ['2', '3'], correct: 0 }] });
const inmediato = await rec('notice', { title: 'Ya publicado', body: '', visible: true, publishAt: '' });
assert.equal(unidad.data.publishAt, futuro);
assert.equal(inmediato.data.publishAt, undefined, 'Sin fecha = inmediato');
await rec('notice', { title: 'x', body: '', visible: true, publishAt: 'mañana' }, 400);
checks += 2;

const ids = (r) => new Set(r.records.map((x) => x.id));
let deAna = await call('ana', '/api/course?id=' + c);
for (const r of [unidad, material, aviso, foro, quiz]) assert(!ids(deAna).has(r.id), 'Programado: el alumno no lo recibe');
assert(ids(deAna).has(inmediato.id));
const vistaAlumno = await call('docente', `/api/course?id=${c}&as=student`);
assert(!ids(vistaAlumno).has(aviso.id) && !ids(vistaAlumno).has(material.id), 'Tampoco en la vista de alumno');
assert(ids(await call('docente', '/api/course?id=' + c)).has(aviso.id), 'El docente sí lo ve');
checks += 4;
// Por ninguna otra vía: descarga, foro, evaluación, avisos.
assert.equal((await raw('ana', '/api/file/' + archivo)).status, 403);
await call('ana', '/api/record', { course: c, kind: 'post', data: { forum: foro.id, title: 'Hola', body: 'x' } }, 403);
await call('ana', '/api/attempt/start', { course: c, quiz: quiz.id }, 403);
let feed = await call('ana', '/api/notifications');
assert(!feed.items.some((i) => [aviso.id, material.id, quiz.id].includes(i.id)));
checks += 2;
// Mostrar/ocultar con un toque conserva la fecha.
await call('docente', '/api/record/visibility', { course: c, kind: 'notice', id: aviso.id, visible: false });
await call('docente', '/api/record/visibility', { course: c, kind: 'notice', id: aviso.id, visible: true });
assert.equal((await call('docente', '/api/course?id=' + c)).records.find((r) => r.id === aviso.id).data.publishAt, futuro);
checks++;

// Llega la fecha: aparece todo, y el aviso lleva la fecha de publicación (nuevo aunque se escribió antes).
const antes = inDays(-0.01);
for (const r of [unidad, aviso, foro, quiz]) setData(r.id, '$.publishAt', antes);
store.raw().prepare('UPDATE aula_records SET updated=? WHERE id=?').run(inDays(-5), aviso.id);
await call('ana', '/api/notifications/seen', {});
store.raw().prepare("UPDATE aula_users SET notices_seen_at=? WHERE email='ana@example.test'").run(inDays(-1));
deAna = await call('ana', '/api/course?id=' + c);
for (const r of [unidad, material, aviso, foro, quiz]) assert(ids(deAna).has(r.id), 'Publicado');
assert.equal((await raw('ana', '/api/file/' + archivo)).status, 200);
await call('ana', '/api/record', { course: c, kind: 'post', data: { forum: foro.id, title: 'Hola', body: 'x' } }, 201);
feed = await call('ana', '/api/notifications');
const nuevo = feed.items.find((i) => i.id === aviso.id);
assert(nuevo && nuevo.fresh && nuevo.at === antes, 'El aviso aparece como nuevo con su fecha de publicación');
checks += 3;

// ================= Evaluaciones en la calificación =================
await call('docente', '/api/grades/scheme', {
  course: c,
  revision: 0,
  scheme: 'categories',
  categories: [
    { key: 't', name: 'Tareas', weight: 50 },
    { key: 'e', name: 'Exámenes', weight: 40 },
    { key: 'a', name: 'Asistencia', weight: 10, source: 'attendance' },
  ],
  tasks: {},
});
let curso = await call('docente', '/api/course?id=' + c);
const cats = Object.fromEntries(curso.records.find((r) => r.kind === 'grading').data.categories.map((x) => [x.name, x.id]));
const preguntas = [
  { type: 'choice', text: 'A', options: ['sí', 'no'], correct: 0 },
  { type: 'choice', text: 'B', options: ['sí', 'no'], correct: 0 },
];
const q = (grade, status = 201) => rec('quiz', { title: 'Parcial en línea', visible: true, questions: preguntas, settings: { attempts: 3 }, grade }, status);
await q({ category: cats.Asistencia, points: 10 }, 400); // la asistencia no admite evaluaciones
await q({ category: 'no-existe', points: 10 }, 400);
await q({ category: cats.Exámenes, points: 0 }, 400);
await q({ category: cats.Exámenes, points: 2000 }, 400);
const otro = (await call('docente', '/api/courses', { name: 'Otro', group: 'B' }, 201)).id;
await call('docente', '/api/grades/scheme', { course: otro, revision: 0, scheme: 'categories', categories: [{ key: 'x', name: 'X', weight: 100 }], tasks: {} });
const ajena = (await call('docente', '/api/course?id=' + otro)).records.find((r) => r.kind === 'grading').data.categories[0].id;
await q({ category: ajena, points: 10 }, 400);
const parcial = await q({ category: cats.Exámenes, points: 20, policy: 'rara' });
assert.deepEqual(parcial.data.grade, { category: cats.Exámenes, points: 20, policy: 'best' });
const sinCalificar = await call('docente', '/api/record', { course: c, kind: 'quiz', id: parcial.id, revision: parcial.revision, data: { ...parcial.data, grade: null } });
assert.equal(sinCalificar.data.grade, undefined, 'Quitar la categoría: ya no cuenta');
const cuenta = await call('docente', '/api/record', { course: c, kind: 'quiz', id: parcial.id, revision: sinCalificar.revision, data: { ...parcial.data, grade: { category: cats.Exámenes, points: 20, policy: 'last' } } });
checks += 3;
// Tres intentos de Ana: 10, 5, 0 → mejor 10, último 0, promedio 5. Una tarea de Exámenes con 8 (10 puntos).
await call('ana', '/api/attempt', { course: c, quiz: parcial.id, answers: { 0: 0, 1: 0 } }, 201);
await call('ana', '/api/attempt', { course: c, quiz: parcial.id, answers: { 0: 0, 1: 1 } }, 201);
await call('ana', '/api/attempt', { course: c, quiz: parcial.id, answers: { 0: 1, 1: 1 } }, 201);
const examen = await rec('task', { title: 'Examen escrito', body: '', visible: true, submissionMode: 'text', category: cats.Exámenes, points: 10 });
// La categoría de una actividad se asigna desde «Administrar calificaciones»; aquí, directo.
store.raw().prepare('UPDATE aula_tasks SET category=?, points=10 WHERE id=?').run(cats.Exámenes, examen.id);
await call('docente', '/api/grade', { course: c, task: examen.id, member: members.ana, grade: 8, feedback: '' });

// Cálculo real de la interfaz (grading.js) con los datos que recibe el docente.
curso = await call('docente', '/api/course?id=' + c);
const context = vm.createContext({ document: { addEventListener() {} }, Date, Math, Number, Map, Set });
vm.runInContext(readFileSync('src/public/secciones.js', 'utf8'), context);
vm.runInContext(readFileSync('src/public/grading.js', 'utf8'), context);
vm.runInContext('var current, attendanceData = null; var records = (k) => current.records.filter((r) => r.kind === k); var dueFor = (t) => t.data.due; var gradeOf = (m, t) => records("submission").find((s) => s.data.member === m && s.data.task === t);', context);
context.courseData = curso;
vm.runInContext('current = courseData;', context);
const examenes = (policy) => {
  vm.runInContext(`records('quiz').find((x) => x.id === '${parcial.id}').data.grade.policy = '${policy}'`, context);
  const r = vm.runInContext(`studentGrade('${members.ana}')`, context);
  return r.categories.find((x) => x.name === 'Exámenes').value;
};
const cerca = (a, b) => Math.abs(a - b) < 1e-9;
assert.equal(cuenta.data.grade.policy, 'last');
assert(cerca(examenes('last'), (8 * 10 + 0 * 20) / 30), 'Último intento: 0');
assert(cerca(examenes('best'), (8 * 10 + 10 * 20) / 30), 'Mejor intento: 10');
assert(cerca(examenes('average'), (8 * 10 + 5 * 20) / 30), 'Promedio: 5');
// Beto no la contestó: no cuenta (no es cero).
assert.equal(vm.runInContext(`studentGrade('${members.beto}')`, context).categories.find((x) => x.name === 'Exámenes').value, null);
// Con pesos por actividad (sin categorías) las evaluaciones no se suman.
vm.runInContext("current.records.find((r) => r.kind === 'grading').data.scheme = 'tasks'", context);
assert.equal(vm.runInContext('countedQuizzes().length', context), 0);
checks += 5;

// ================= Seguimiento del contenido =================
const prog = (who, record, action, status = 200) => call(who, '/api/progress', { course: c, record, action }, status);
await prog('docente', material.id, 'complete', 403);
await prog('ana', material.id, 'volar', 400);
await prog('ana', aviso.id, 'open', 404); // solo materiales
await prog('ana', material.id, 'open');
let mine = (await call('ana', '/api/course?id=' + c)).progress;
assert.equal(mine.length, 1);
assert(mine[0].opened_at && !mine[0].completed_at);
const abierto = mine[0].opened_at;
await prog('ana', material.id, 'complete');
await prog('ana', material.id, 'open'); // abrirlo otra vez no lo desmarca
mine = (await call('ana', '/api/course?id=' + c)).progress;
assert(mine[0].completed_at);
assert.equal(mine[0].opened_at, abierto, 'Se conserva la primera vez que lo abrió');
await prog('ana', material.id, 'undo');
mine = (await call('ana', '/api/course?id=' + c)).progress;
assert.deepEqual([mine[0].opened_at, mine[0].completed_at], [abierto, null]);
await prog('ana', material.id, 'complete');
await prog('beto', material.id, 'open');
checks += 4;
// Quién ve qué: cada alumno lo suyo; el docente todo; la vista de un alumno, lo de ese alumno.
assert.deepEqual((await call('beto', '/api/course?id=' + c)).progress.map((p) => p.member), [members.beto]);
assert.equal((await call('docente', '/api/course?id=' + c)).progress.length, 2);
assert.deepEqual((await call('docente', `/api/course?id=${c}&as=m:${members.ana}`)).progress.map((p) => p.member), [members.ana]);
assert.deepEqual((await call('docente', `/api/course?id=${c}&as=student`)).progress, []);
checks += 4;
// Material oculto, programado o eliminado: no se registra.
setData(material.id, '$.visible', 'false');
store.raw().prepare("UPDATE aula_records SET data=json_set(data,'$.visible',json('false')) WHERE id=?").run(material.id);
await prog('ana', material.id, 'open', 403);
store.raw().prepare("UPDATE aula_records SET data=json_set(data,'$.visible',json('true')) WHERE id=?").run(material.id);
setData(unidad.id, '$.publishAt', inDays(2));
await prog('ana', material.id, 'open', 403);
setData(unidad.id, '$.publishAt', antes);
await call('docente', '/api/record', { course: c, kind: 'material', id: material.id }, 200, 'DELETE');
await prog('ana', material.id, 'open', 404);
// Alumno de otro curso.
await call('docente', '/api/members/bulk', { course: otro, students: [{ name: 'carla', email: 'carla@example.test' }] });
await call('carla', '/api/progress', { course: c, record: material.id, action: 'open' }, 403);

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones de la 12.14 — publicación programada por todas las vías, evaluaciones en la calificación (mejor, último, promedio) y seguimiento del contenido por alumno.`);
