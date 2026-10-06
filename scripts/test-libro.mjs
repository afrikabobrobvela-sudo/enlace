// Pruebas de la 12.30: libro de calificaciones — eliminar una actividad desde su columna y cambiar las columnas de
// lugar (orden guardado por curso, que respeta la papelera y la copia del curso), e importar calificaciones de una
// sección sin tocar las de otra (mismas actividades aunque el nombre traiga la sección; las nuevas, solo para ella).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'z'.repeat(40) };
let checks = 0;
const cookies = {};
async function call(who, path, data, status = 200, method = data === undefined ? 'GET' : 'POST') {
  cookies[who] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who }), env);
  const before = store.counter.queries;
  const res = await api(
    new Request('https://t.local' + path, {
      method,
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

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '5.º semestre' }, 201)).id;
const course = (who = 'docente', id = c) => call(who, '/api/course?id=' + id);
await call('docente', '/api/members/bulk', {
  course: c,
  students: [
    { name: 'Ana', email: 'ana@example.test', section: '5AV' },
    { name: 'Beto', email: 'beto@example.test', section: '5AV' },
    { name: 'Carla', email: 'carla@example.test', section: '5BV' },
    { name: 'Dani', email: 'dani@example.test', section: '5BV' },
  ],
});
let data = await course();
const av = data.sections.find((s) => s.name === '5AV').id;
const bv = data.sections.find((s) => s.name === '5BV').id;
const id = (n) => data.members.find((m) => m.email === n + '@example.test').id;
const tarea = async (title, extra = {}) => (await call('docente', '/api/record', { course: c, kind: 'task', data: { title, visible: true, ...extra } }, 201)).id;
const t1 = await tarea('Tarea 1');
const t2 = await tarea('Tarea 2');
const t3 = await tarea('Examen', { sections: [bv] });
const grading = (d) => d.records.find((r) => r.kind === 'grading').data;
const titles = (d, order) => order.map((x) => d.records.find((r) => r.id === x)?.data.title);

// ---- Orden de las columnas ----
await call('ana', '/api/grades/order', { course: c, order: [t1] }, 403);
await call('docente', '/api/grades/order', { course: c, order: 't1' }, 400);
let r = await call('docente', '/api/grades/order', { course: c, order: [t3, t1, 'no-existe', t3] });
assert.deepEqual(r.order, [t3, t1], 'Sin ids ajenos ni repetidos');
r = await call('docente', '/api/grades/order', { course: c, order: [t3, t1] });
assert.equal(r.created, false, 'La segunda vez la configuración ya existe');
data = await course();
assert.deepEqual(grading(data).columnOrder, [t3, t1]);
// Mover columnas no invalida la revisión de los pesos: se guardan sin «recarga».
const pesos = data.records.find((x) => x.kind === 'weights');
await call('docente', '/api/record', { course: c, kind: 'weights', id: pesos.id, revision: pesos.revision, data: { weights: { [t1]: 50, [t2]: 25, [t3]: 25 } } });
// El alumno solo recibe el orden de sus actividades (Ana es de 5AV: no recibe el examen de 5BV).
assert.deepEqual(grading(await course('ana')).columnOrder, [t1]);
checks += 4;

// ---- Eliminar una actividad (a la papelera) y restaurarla: vuelve a su lugar ----
await call('docente', '/api/grade', { course: c, task: t2, member: id('ana'), grade: 8, publish: true });
await call('docente', '/api/record', { course: c, kind: 'task', id: t1 }, 200, 'DELETE');
data = await course();
assert(!data.records.some((x) => x.id === t1), 'La actividad eliminada ya no está en el libro');
// Con la actividad en la papelera, el orden la conserva (la interfaz la ignora mientras no exista).
r = await call('docente', '/api/grades/order', { course: c, order: [t1, t3, t2] });
assert.deepEqual(r.order, [t1, t3, t2]);
await call('docente', '/api/trash/restore', { course: c, kind: 'task', id: t1 });
data = await course();
assert.deepEqual(titles(data, grading(data).columnOrder), ['Tarea 1', 'Examen', 'Tarea 2']);
checks += 3;

// ---- Copiar el curso conserva el orden con las actividades nuevas ----
const copia = (await call('docente', '/api/course/copy', { course: c, name: 'Física I', group: '5.º', period: '2027A' }, 201)).id;
const copiado = await course('docente', copia);
assert.deepEqual(titles(copiado, grading(copiado).columnOrder), ['Tarea 1', 'Examen', 'Tarea 2']);
assert(!grading(copiado).columnOrder.includes(t1), 'Con los ids del curso copiado');
checks += 2;

// ---- Importar calificaciones de una sección ----
const imp = (body, status = 200) => call('docente', '/api/grades/import', { course: c, ...body }, status);
await imp({ section: 'otra', activities: [{ task: t2, grades: [{ member: id('carla'), grade: 9 }] }] }, 404);
await imp({ section: bv, activities: [{ task: t2, grades: [{ member: id('ana'), grade: 2 }] }] }, 400);
r = await imp({
  section: bv,
  activities: [
    { task: t2, grades: [{ member: id('carla'), grade: 9 }, { member: id('dani'), grade: 7 }] },
    { title: 'Proyecto', grades: [{ member: id('carla'), grade: 10 }] },
  ],
});
assert.deepEqual(r, { created: 1, grades: 3, widened: 0 });
data = await course();
const nota = (task, n) => data.records.find((x) => x.kind === 'submission' && x.data.task === task && x.data.member === id(n))?.data.grade;
const proyecto = data.records.find((x) => x.kind === 'task' && x.data.title === 'Proyecto');
assert.deepEqual([nota(t2, 'ana'), nota(t2, 'carla'), nota(t2, 'dani')], [8, 9, 7], 'La calificación de 5AV no se tocó');
assert.deepEqual(proyecto.data.sections, [bv], 'La actividad nueva es solo para 5BV');
assert(!(await course('ana')).records.some((x) => x.id === proyecto.id), 'Ana (5AV) no ve la actividad de 5BV');
// La otra sección importa a la misma actividad: ahora es para las dos y Ana ve su calificación.
r = await imp({ section: av, activities: [{ task: proyecto.id, grades: [{ member: id('ana'), grade: 6 }] }, { task: t3, grades: [{ member: id('beto'), grade: 5 }] }] });
assert.deepEqual(r, { created: 0, grades: 2, widened: 2 });
data = await course();
assert.deepEqual(data.records.find((x) => x.id === proyecto.id).data.sections, [av, bv].sort());
assert.deepEqual([nota(proyecto.id, 'ana'), nota(proyecto.id, 'carla'), nota(t3, 'beto')], [6, 10, 5]);
const deAna = await course('ana');
assert.equal(deAna.records.find((x) => x.kind === 'submission' && x.data.task === proyecto.id)?.data.grade, 6);
// Sin sección (todo el curso) funciona como antes y no cambia las secciones de la actividad.
r = await imp({ activities: [{ task: t2, grades: [{ member: id('beto'), grade: 10 }] }] });
assert.deepEqual(r, { created: 0, grades: 1, widened: 0 });
checks += 9;
assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);

// ---- Navegador: libro con columnas ordenadas, menú de la columna y archivo de una sección ----
const elements = new Map();
const element = (selector) => {
  if (!elements.has(selector)) {
    elements.set(selector, { innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, querySelector: () => null, focus() {} });
  }
  return elements.get(selector);
};
const toasts = [];
const ctx = vm.createContext({
  document: { querySelector: element, querySelectorAll: () => [], getElementById: (x) => element('#' + x), addEventListener() {}, head: { append() {} }, body: { classList: { add() {}, remove() {}, toggle() {} } } },
  window: { addEventListener() {}, scrollY: 0, scrollTo() {} },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  crypto: globalThis.crypto, structuredClone, console, setTimeout, clearTimeout, confirm: () => true, toasts,
});
const load = (file, transform = (s) => s) => vm.runInContext(transform(readFileSync('src/public/' + file, 'utf8')), ctx);
for (const file of ['fecha.js', 'richtext.js', 'trash.js', 'reactivos.js', 'evaluaciones.js', 'banco.js', 'oficina.js', 'resultados.js', 'd2l.js', 'importar.js', 'foros.js', 'condiciones.js', 'importaciones.js', 'secciones.js', 'especial.js', 'foto.js', 'pendientes.js', 'calendario.js', 'navegacion.js', 'movil.js', 'registro.js', 'workspace.js', 'preview.js', 'attendance.js', 'teams.js', 'grading.js', 'rubrics.js']) load(file);
load('app.js', (s) => s.replace('\ninit();', '\n'));
const run = (code) => vm.runInContext(code, ctx);
// Los arreglos del contexto del navegador simulado son de otro «realm»: se comparan como JSON.
const json = (code) => JSON.parse(JSON.stringify(run(code)));
run(`
  toast = (text) => toasts.push(text);
  me = { id: 'teacher', name: 'Docente', role: 'teacher' };
  current = {
    course: { id: 'c', name: 'Física I', group_name: '5' }, canTeach: true, canDelete: true, files: [],
    sections: [{ id: 'sa', name: '5AV' }, { id: 'sb', name: '5BV' }],
    members: [
      { id: 'm-ana', name: 'Ana', role: 'student', matricula: '1', email: 'ana@x.mx', section: 'sa' },
      { id: 'm-carla', name: 'Carla', role: 'student', matricula: '3', email: 'carla@x.mx', section: 'sb' },
    ],
    records: [
      { id: 'a', kind: 'task', data: { title: 'Tarea 1', visible: true, due: '' } },
      { id: 'b', kind: 'task', data: { title: 'Tarea 2', visible: true, due: '' } },
      { id: 'x', kind: 'task', data: { title: 'Examen final', visible: true, due: '', sections: ['sb'] } },
      { id: 's1', kind: 'submission', revision: 1, data: { task: 'a', member: 'm-ana', grade: 9, published: true } },
      { id: 's2', kind: 'submission', revision: 1, data: { task: 'a', member: 'm-carla', grade: 7, published: true } },
      { id: 'grading:c', kind: 'grading', revision: 1, data: { scheme: 'tasks', categories: [], columnOrder: ['x', 'a'], final: { decimals: 0, rounding: 'down', passing: 6, failingAs: null, missingAsZero: false } } },
    ],
  };
  attendanceData = { course: 'c', sessions: [], records: [], settings: {} };
  section = 'grades'; gradeTab = 'entry';
`);
assert.deepEqual(json('orderedTasks().map((t) => t.id)'), ['x', 'a', 'b'], 'Primero el orden guardado; lo demás al final, por fecha');
run('renderGrades()');
let page = run("$('#main').innerHTML");
const at = (title) => page.indexOf(`</small>` + title) >= 0 ? page.indexOf(`</small>` + title) : page.indexOf('<span>' + title);
assert(at('Examen final') < at('Tarea 1') && at('Tarea 1') < at('Tarea 2'), 'Las columnas siguen el orden guardado');
assert.equal((page.match(/<th class="gb-task-col" draggable="true" data-gb-col="/g) || []).length, 3, 'Cada columna se puede arrastrar');
assert(page.includes('data-action="trash" data-kind="task" data-id="a">Eliminar actividad'), 'El menú de la columna elimina la actividad');
const menu = run("gradebookColumnMenu(find('x'), null, find('a'))");
assert(/data-gb-target="" disabled>← Mover a la izquierda/.test(menu) && menu.includes(`data-gb-target="a" data-gb-after="1" >Mover a la derecha`), 'La primera columna no se mueve a la izquierda');
checks += 5;
// Mover: se ve de inmediato y se guarda el orden completo.
await run(`
  var sent = [];
  request = async (path, body) => { sent.push({ path, body }); return { order: body.order, created: false }; };
  moveGradebookColumn('b', 'x');
`);
assert.deepEqual(json('sent[0]'), { path: '/api/grades/order', body: { course: 'c', order: ['b', 'x', 'a'] } });
assert.deepEqual(json('gradingSettings().columnOrder'), ['b', 'x', 'a']);
await run(`moveGradebookColumn('b', 'a', true)`);
assert.deepEqual(json('sent[1].body.order'), ['x', 'a', 'b'], 'Después de la columna elegida');
// Si el servidor lo rechaza, vuelve al orden anterior y lo avisa.
await run(`
  request = async () => { throw new Error('Este curso está archivado.'); };
  moveGradebookColumn('x', 'b', true);
`);
assert.deepEqual(json('gradingSettings().columnOrder'), ['x', 'a', 'b']);
assert.equal(toasts.at(-1), 'Este curso está archivado.');
// La confirmación de eliminar dice qué actividad y cuántas calificaciones tiene.
assert.equal(run("trashConfirmText('task', 'a')"), '¿Eliminar «Tarea 1»? Tiene 2 calificaciones. Sus entregas y calificaciones se conservan en la papelera y vuelven si la restauras.');
checks += 5;

// Archivo de 5BV: cada grupo tiene sus propias actividades (12.45). Una columna solo se une sola a una actividad que
// sea exactamente de 5BV («Examen final»); «Tarea 1» y «Tarea 2» son de todo el curso, así que se proponen como nuevas
// para 5BV (antes se compartían y eliminarlas desde un grupo las quitaba del otro). Quien es de otra sección se omite
// y «Tarea 11» no se confunde con «Tarea 1».
const students = run('current.members');
const tasks = run("records('task')");
const archivo = [
  ['Matrícula', 'Alumno', 'Tarea 1 (Sección 5BV)', 'Tarea 2 5BV', 'Tarea 11', 'Examen final'],
  ['3', 'Carla', '8', '9', '10', '7'],
  ['1', 'Ana', '1', '1', '1', '1'],
];
const plano = (x) => JSON.parse(JSON.stringify(x));
const deB = plano(run('parseGradesImport')(archivo, students, tasks, { section: 'sb', sectionNames: ['5AV', '5BV'] }));
assert.deepEqual(deB.columns.map((x) => [x.title, x.task, x.cells.map((y) => y.member.id).join()]), [
  ['Tarea 1 (Sección 5BV)', '', 'm-carla'],
  ['Tarea 2 5BV', '', 'm-carla'],
  ['Tarea 11', '', 'm-carla'],
  ['Examen final', 'x', 'm-carla'],
]);
assert.deepEqual([deB.matched, deB.outside], [1, ['Ana · 1']]);
// Sin sección, todos cuentan (como antes).
const todos = plano(run('parseGradesImport')(archivo, students, tasks));
assert.deepEqual([todos.matched, todos.outside, todos.columns[0].cells.length], [2, [], 2]);
assert.throws(() => run('parseGradesImport')([['Alumno', 'Tarea 1'], ['Ana', '9']], students, tasks, { section: 'sb' }), /sección elegida/);
// La columna «Sección» de la exportación de Enlace se sigue ignorando; una actividad con «Sección» en el nombre, no.
assert.deepEqual(plano(run('parseGradesImport')([['Matrícula', 'Alumno', 'Sección', 'Tarea 1'], ['3', 'Carla', '5BV', '9']], students, tasks)).columns.map((x) => x.title), ['Tarea 1']);
checks += 5;
// Lo que pasará con cada columna.
run(`var colB = parseGradesImport(${JSON.stringify(archivo)}, current.members, records('task'), { section: 'sb', sectionNames: ['5AV', '5BV'] }).columns;`);
assert.match(run("gradeColumnNote(colB[2], '', 'sb')"), /Se creará una actividad nueva solo para 5BV\. ¿Es «Tarea 1»\?/);
assert.match(run("gradeColumnNote(colB[0], 'a', 'sb')"), /1 de estos alumnos ya tiene calificación/);
run(`var colA = parseGradesImport(${JSON.stringify(archivo)}, current.members, records('task'), { section: 'sa' }).columns;`);
assert.match(run("gradeColumnNote(colA[3], 'x', 'sa')"), /también quedará para 5AV/);
assert.match(run("gradeColumnNote(colA[3], 'x', '')"), /1 de estos alumnos no es de las secciones de esta actividad/);
checks += 4;

// ---- Navegador: examen abierto (12.30) ----
// Con el examen que bloquea la plataforma, la campana no se pide y una respuesta 423 no vuelve a abrir el curso encima
// del intento (antes la campana, a los pocos minutos de empezar, borraba la pantalla del examen a media respuesta).
await run(`
  var abiertos = 0, pedidos = [];
  openCourse = async () => { abiertos++; };
  updateBellBadge = () => {};
  request = async (path) => { pedidos.push(path); return { items: [], unread: 0 }; };
  me = { id: 'u-ana', role: 'student', activeExam: null };
  section = 'quiz'; detail = 'x';
  goToActiveExam({ quiz: 'x', course: 'c' });
`);
assert.equal(run('abiertos'), 0, 'Con el intento en pantalla no se vuelve a abrir el curso');
assert.deepEqual(json('me.activeExam'), { quiz: 'x', course: 'c' });
await run(`loadNotices()`);
assert.deepEqual(json('pedidos'), [], 'Con el examen abierto la campana no se pide');
await run(`me.activeExam = null; loadNotices()`);
assert.deepEqual(json('pedidos'), ['/api/notifications']);
checks += 4;

console.log(`PASS: ${checks} verificaciones de la 12.30 — libro de calificaciones: eliminar desde la columna, mover columnas (orden por curso, papelera y copia) e importar por sección sin tocar las demás; con el examen abierto, sin campana ni recargas encima del intento.`);
