// Interfaz de la fase 2B: cálculo con categorías, calificación final, rúbricas y equipos.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const elements = new Map();
const element = (selector) => {
  if (!elements.has(selector)) {
    elements.set(selector, {
      innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, querySelector: () => null, focus() {},
    });
  }
  return elements.get(selector);
};
const downloads = [];
const context = vm.createContext({
  document: {
    querySelector: element, querySelectorAll: () => [], getElementById: (id) => element('#' + id),
    addEventListener() {}, head: { append() {} }, body: { classList: { add() {}, remove() {}, toggle() {} } },
  },
  window: { addEventListener() {}, scrollY: 0, scrollTo() {} },
  localStorage: { getItem: () => null, setItem() {} },
  crypto: globalThis.crypto, structuredClone, console, setTimeout, clearTimeout, confirm: () => true, downloads,
});
const load = (file, transform = (s) => s) => vm.runInContext(transform(readFileSync('src/public/' + file, 'utf8')), context);
for (const file of ['fecha.js', 'richtext.js', 'trash.js', 'reactivos.js', 'evaluaciones.js', 'banco.js', 'oficina.js', 'resultados.js', 'd2l.js', 'importar.js', 'foros.js', 'condiciones.js', 'importaciones.js', 'secciones.js', 'especial.js', 'foto.js', 'pendientes.js', 'calendario.js', 'navegacion.js', 'movil.js', 'registro.js', 'workspace.js', 'preview.js', 'attendance.js', 'teams.js', 'grading.js', 'rubrics.js']) load(file);
load('app.js', (s) => s.replace('\ninit();', '\n'));
const run = (code) => vm.runInContext(code, context);
let checks = 0;
const check = (...args) => {
  assert(...args);
  checks++;
};
const close = (a, b) => Math.abs(a - b) < 1e-9;

// ---- Cálculo con categorías ----
run(`
  var past = '2026-09-01T12:00:00Z', future = '2099-01-01T12:00:00Z';
  var T = (id, category, points, due = '', visible = true) => ({ id, data: { title: id, category, points, due, visible } });
  var tasks = [T('ex1', 'E', 2), T('ex2', 'E', 1), T('ta1', 'T', 1), T('ta2', 'T', 1, past), T('oculta', 'T', 1, past, false), T('suelta', null, 1)];
  var grades = new Map([['ex1', 8], ['ex2', 5], ['ta1', 10], ['suelta', 0]]);
  var settings = {
    scheme: 'categories',
    categories: [{ id: 'E', name: 'Exámenes', weight: 60, source: 'tasks' }, { id: 'T', name: 'Tareas', weight: 30, source: 'tasks' }, { id: 'A', name: 'Asistencia', weight: 10, source: 'attendance' }],
    final: { decimals: 0, rounding: 'down', passing: 6, failingAs: null, missingAsZero: true },
  };
`);
let result = run('computeGrade({ tasks, grades, settings, attendancePercent: 90 })');
check(close(result.categories[0].value, 7), 'Exámenes por puntos: (8×2 + 5×1) / 3 = 7');
check(close(result.categories[1].value, 10) && close(result.categories[2].value, 9), 'Tareas 10; asistencia 90 % = 9');
check(close(result.value, 8.1), 'Parcial: 7×0.6 + 10×0.3 + 9×0.1 = 8.1 (la actividad sin categoría no cuenta)');
check(close(run('computeGrade({ tasks, grades, settings, attendancePercent: null }).value'), 7.2), 'Sin asistencia, su 10 % no se redistribuye: 7×60 % + 10×30 % = 7.2');
result = run("computeGrade({ tasks, grades, settings, attendancePercent: 90, categoryGrades: new Map([['E', 6.25]]) })");
check(close(result.categories[0].value, 6.25) && close(result.value, 7.65), 'La captura manual sustituye el cálculo automático del rubro');
result = run('computeGrade({ tasks, grades, settings, attendancePercent: 90, final: true })');
check(close(result.categories[1].value, 5), 'Final: la tarea vencida sin calificar vale 0; la oculta no cuenta');
check(close(result.value, 6.6), 'Final: 7×0.6 + 5×0.3 + 9×0.1 = 6.6');
check(close(run("computeGrade({ tasks, grades, settings: { ...settings, final: { ...settings.final, missingAsZero: false } }, attendancePercent: 90, final: true }).value"), 8.1));
// Pesos por actividad (como antes de la fase 2B): simple, o ponderado si todas tienen peso.
run(`var plain = [T('a'), T('b'), T('c')]; var g2 = new Map([['a', 10], ['b', 6], ['c', null]]); var tasksMode = { ...settings, scheme: 'tasks' };`);
check(close(run('computeGrade({ tasks: plain, grades: g2, settings: tasksMode }).value'), 8), 'Promedio simple de lo calificado');
check(close(run('computeGrade({ tasks: plain, grades: g2, settings: tasksMode, weights: { a: 25, b: 75, c: 0 } }).value'), 7), 'Ponderado: (10×25 + 6×75) / 100');
check(run('computeGrade({ tasks: plain, grades: new Map(), settings: tasksMode }).value') === null);

// ---- Redondeo y calificación final ----
const rules = { decimals: 0, rounding: 'down', passing: 6, failingAs: null };
check(run(`finalGradeHint({ scheme: 'categories', categories: [{ id: 'a', term: 'p1', weight: 100 }, { id: 'b', term: 'p2', weight: 100 }], terms: [{ id: 'p1', name: 'Parcial 1', weight: 50 }, { id: 'p2', name: 'Parcial 2', weight: 50 }] })`) === 'Promedio de Parcial 1 y Parcial 2', 'La final dice que es el promedio de los parciales');
check(run(`finalGradeHint({ scheme: 'categories', categories: [{ id: 'a', term: 'p1', weight: 100 }, { id: 'b', term: 'p2', weight: 100 }], terms: [{ id: 'p1', name: 'Parcial 1', weight: 40 }, { id: 'p2', name: 'Parcial 2', weight: 60 }] })`) === 'Ponderado: Parcial 1 40 % y Parcial 2 60 %', 'Con pesos distintos, la final los muestra');
check(JSON.stringify(run(`finalGrade(5.9, ${JSON.stringify(rules)})`)) === '{"value":5,"passed":false}', 'Reprobatoria: 5.9 → 5');
check(JSON.stringify(run(`finalGrade(4.9, ${JSON.stringify(rules)})`)) === '{"value":4,"passed":false}', 'Reprobatoria: 4.9 → 4');
check(JSON.stringify(run(`finalGrade(6.56, ${JSON.stringify(rules)})`)) === '{"value":7,"passed":true}', 'Aprobatoria arriba de .55: 6.56 → 7');
check(JSON.stringify(run(`finalGrade(6.55, ${JSON.stringify(rules)})`)) === '{"value":6,"passed":true}', 'Aprobatoria hasta .55: 6.55 → 6');
check(JSON.stringify(run(`finalGrade(6.6, ${JSON.stringify(rules)})`)) === '{"value":7,"passed":true}', 'Aprobatoria 6.6 → 7');
check(JSON.stringify(run(`finalGrade(9.8, ${JSON.stringify(rules)})`)) === '{"value":10,"passed":true}', 'Aprobatoria 9.8 → 10');
check(JSON.stringify(run(`finalGrade(9.6, ${JSON.stringify(rules)})`)) === '{"value":10,"passed":true}' && JSON.stringify(run(`finalGrade(10, ${JSON.stringify(rules)})`)) === '{"value":10,"passed":true}', 'La final nunca supera 10');
check(run(`finalGrade(null, ${JSON.stringify(rules)})`) === null);

// ---- Curso de prueba: rúbrica, equipos y categorías ----
run(`
  var reviewPreview = [];
  mountInlinePreview = (target, id) => reviewPreview.push(id);
  me = { id: 'teacher', name: 'Docente', role: 'teacher' };
  var rubric = { id: 'r1', kind: 'rubric', revision: 1, data: { title: 'Reporte', shared: false,
    levels: [{ name: 'Excelente', points: 4 }, { name: 'Bien', points: 3 }, { name: 'Suficiente', points: 2 }, { name: 'Insuficiente', points: 0 }],
    criteria: [{ name: 'Planteamiento', descriptors: ['Claro'] }, { name: 'Datos', descriptors: [] }, { name: 'Conclusiones', descriptors: [] }] } };
  current = {
    course: { id: 'c', name: 'Física I', group_name: '101' }, canTeach: true, canDelete: true,
    members: [
      { id: 'm-ana', user_id: 'u-ana', name: 'Ana', role: 'student', matricula: '1' },
      { id: 'm-luis', user_id: 'u-luis', name: 'Luis <b>', role: 'student', matricula: '2' },
      { id: 'm-sofia', user_id: 'u-sofia', name: 'Sofía', role: 'student', matricula: '3' },
    ],
    files: [],
    records: [
      { id: 'e1', kind: 'task', data: { title: 'Examen', visible: true, category: 'E', points: 1, due: '' } },
      { id: 'p1', kind: 'task', data: { title: 'Práctica', visible: true, category: 'T', points: 1, rubric: 'r1', groupCategory: 'Laboratorio', due: '' } },
      rubric,
      { id: 'g1', kind: 'group', data: { title: 'Equipo 1', category: 'Laboratorio', members: ['m-ana', 'm-luis'] } },
      { id: 's1', kind: 'submission', revision: 1, data: { task: 'p1', member: 'm-ana', submitted: '2026-09-20T10:00:00Z', body: 'Reporte', fileIds: [], grade: null, published: true } },
      { id: 's2', kind: 'submission', revision: 1, data: { task: 'e1', member: 'm-sofia', submitted: '', manual: true, grade: 4, published: true } },
      { id: 'grading:c', kind: 'grading', revision: 3, data: { scheme: 'categories',
        categories: [{ id: 'E', name: 'Exámenes', weight: 50, source: 'tasks' }, { id: 'T', name: 'Prácticas', weight: 50, source: 'tasks' }],
        final: { decimals: 0, rounding: 'down', passing: 6, failingAs: null, missingAsZero: false } } },
    ],
  };
  section = 'review'; detail = 'p1'; reviewMember = 'm-ana';
  renderReview();
`);
let page = run("$('#main').innerHTML");
check(page.includes('<legend>Rúbrica: Reporte</legend>') && (page.match(/data-rubric-score=/g) || []).length === 12, 'Rúbrica con 3 criterios × 4 niveles');
check(page.includes('<small>Claro</small>'), 'Se muestra la descripción del nivel');
check(page.includes('name="team" checked') && page.includes('Aplicar a todo el equipo (Equipo 1: Ana, Luis &lt;b&gt;)'), 'Opción de equipo, con nombres escapados');
check(run('collectRubric()') === undefined, 'Sin niveles elegidos se califica sin rúbrica');
run('rubricGrading.scores = [0, 1, null]');
assert.throws(() => run('collectRubric()'), /cada criterio/);
checks++;
run("rubricGrading.scores = [0, 1, 2]; rubricGrading.comments = ['', 'Faltan unidades', ''];");
check(run('rubricTotalText()') === '9 de 12 puntos: 7.5 de 10');
check(JSON.stringify(run('collectRubric()')) === '{"scores":[0,1,2],"comments":["","Faltan unidades",""]}');
// Al volver a abrir, se recuperan los niveles elegidos (si la rúbrica no cambió).
run(`current.records[4].data.rubricScores = { title: 'Reporte', scores: [3, 3, 1], items: [{ comment: 'a' }, { comment: '' }, { comment: 'c' }], total: 3, max: 12 }; renderReview();`);
check(JSON.stringify(run('rubricGrading.scores')) === '[3,3,1]' && run('rubricGrading.comments[2]') === 'c');
run(`current.records[4].data.rubricScores.title = 'Otra rúbrica'; renderReview();`);
check(JSON.stringify(run('rubricGrading.scores')) === '[null,null,null]', 'Si la rúbrica cambió, no se reutilizan niveles viejos');
run(`reviewMember = 'm-sofia'; renderReview();`);
check(!run("$('#main').innerHTML").includes('name="team"'), 'Sofía no tiene equipo: no aparece la opción');

// ---- Tabla de calificaciones: final y categorías ----
let categoryCell = run("categoryGradeCellHtml({ id: 'E', name: 'Exámenes', weight: 50, source: 'tasks', automaticValue: 4 }, current.members[2], 4)");
check(categoryCell.includes('class="category-grade-input"') && categoryCell.includes('value=""') && categoryCell.includes('placeholder="4.00"') && !categoryCell.includes('Doble clic'), 'Los rubros muestran una casilla editable directa con el cálculo automático como referencia');
run("current.records.push({ id: 'cg', kind: 'category-grade', revision: 1, data: { category: 'E', member: 'm-sofia', grade: 6.6 } })");
categoryCell = run("categoryGradeCellHtml({ id: 'E', name: 'Exámenes', weight: 50, source: 'tasks', automaticValue: 4 }, current.members[2], 6.6)");
check(categoryCell.includes('manual-grade-tag') && categoryCell.includes('value="6.6"') && categoryCell.includes('automático: 4.00'), 'La celda distingue una captura manual y conserva la referencia automática');
run("current.records.pop()");
run(`section = 'grades'; gradeTab = 'entry'; renderGrades();`);
page = run("$('#main').innerHTML");
check(run(`(() => {
  const task = { id: 'x', data: { due: '2000-01-01T00:00' } }, m = { id: 'nadie' };
  const hue = (g) => Number(/hsl\\((\\d+)/.exec(gradeHeatAttr(task, m, { data: { grade: g } }))[1]);
  const missing = gradeHeatAttr(task, m, null), later = gradeHeatAttr({ id: 'y', data: { due: '2999-01-01T00:00' } }, m, null);
  return hue(10) > hue(7) && hue(7) > hue(5) && hue(5) > hue(0) && hue(0) < 10 && missing.includes('missing') && later === '';
})()`), 'Casillas del libro: verde en 10 que baja hacia rojo; rojo si no se entregó y venció');
check(run(`(() => { const n = gradebookStudents().map((m) => m.name); return n.length > 1 && n.join('|') === [...n].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })).join('|'); })()`), 'Libro de calificaciones en orden alfabético');
check(page.includes('<th class="final-col">Calificación final<div class="muted">Promedio ponderado de los rubros</div></th>') && page.includes('Exámenes<div class="muted">50 %</div>'), 'Columnas de final y de categorías');
check((page.match(/class="category-grade-input"/g) || []).length === 6, 'El libro completo muestra una casilla directa por alumno en cada rubro editable');
check(page.includes('<small class="gb-task-placement">Exámenes</small>Examen') && page.includes('<small class="gb-task-placement">Prácticas</small>Práctica'), 'Cada actividad muestra arriba el rubro o parcial al que pertenece');
check(/final-grade grade-low">2<\/td>/.test(page), 'Sofía: Exámenes 4×50 % y Prácticas vacío → la final queda en 2');
check(page.includes('Promedio parcial por categorías'));
run("download = (name, text) => downloads.push(text); exportGrades();");
const csv = downloads[0].replace(/^\uFEFF/, '').split('\r\n');
check(csv[0].includes('"Calificación final","Exámenes (50 %)","Prácticas (50 %)"'), 'La exportación incluye final y categorías');
check(csv.find((row) => row.includes('Sofía')).includes('"2.00","2","4.00",""'), 'Sofía: promedio y final 2; Exámenes 4.00×50 % y Prácticas vacía');
await run(`
  request = async (path, body) => ({ id: 'cg-direct', kind: 'category-grade', revision: 1, data: { category: body.category, member: body.member, grade: body.grade } });
  saveCategoryGradeInput({ dataset: { cgCategory: 'E', cgMember: 'm-sofia' }, value: '8.25', classList: { add() {}, remove() {} }, focus() {} });
`);
check(run("categoryGradeOf('m-sofia', 'E')?.data.grade") === 8.25, 'Escribir directamente en la casilla guarda la calificación manual del rubro');

// ---- Calificación directa y masiva dentro de una tarea ----
const taskRoster = run(`
  var originalQuerySelector = document.querySelector;
  var originalQuerySelectorAll = document.querySelectorAll;
  var originalGetElementById = document.getElementById;
  var taskRows = current.members.filter((member) => member.role === 'student').map((member) => ({
    dataset: {}, hidden: false, textContent: member.name,
    cells: [{ innerHTML: '', textContent: '' }, { innerHTML: '', textContent: '' }, { innerHTML: '', textContent: '' }, { innerHTML: '', textContent: '' }],
  }));
  var taskWrap = {
    toolbar: '',
    querySelectorAll: (selector) => selector === 'tbody tr' ? taskRows : [],
    insertAdjacentHTML(_position, html) { this.toolbar = html; },
  };
  var taskSearch = { value: '' };
  var taskFilter = { value: 'all' };
  var taskBulk = { disabled: false };
  var taskCount = { textContent: '' };
  document.querySelector = (selector) => selector === '#main .table-wrap' ? taskWrap
    : selector === '[data-task-roster-search]' ? taskSearch
    : selector === '[data-task-roster-filter]' ? taskFilter
    : selector === '[data-action="bulk-grade-visible"]' ? taskBulk
    : originalQuerySelector(selector);
  document.querySelectorAll = (selector) => selector === '[data-task-submission-row]' ? taskRows : originalQuerySelectorAll(selector);
  document.getElementById = (id) => id === 'taskRosterCount' ? taskCount : originalGetElementById(id);
  enhanceTaskGradeRoster(find('p1'), records('submission').filter((submission) => submission.data.task === 'p1'));
  var initial = {
    toolbar: taskWrap.toolbar,
    rows: taskRows.map((row) => ({ dataset: { ...row.dataset }, grade: row.cells[2].innerHTML, status: row.cells[1].textContent })),
    count: taskCount.textContent,
  };
  taskFilter.value = 'submitted';
  filterTaskGradeRoster();
  var submittedHidden = taskRows.map((row) => row.hidden);
  var submittedCount = taskCount.textContent;
  taskFilter.value = 'missing';
  filterTaskGradeRoster();
  var missingHidden = taskRows.map((row) => row.hidden);
  var missingCount = taskCount.textContent;
  taskFilter.value = 'all';
  taskSearch.value = 'sofía';
  filterTaskGradeRoster();
  var searchHidden = taskRows.map((row) => row.hidden);
  var searchCount = taskCount.textContent;
  document.querySelector = originalQuerySelector;
  document.querySelectorAll = originalQuerySelectorAll;
  document.getElementById = originalGetElementById;
  ({ initial, submittedHidden, submittedCount, missingHidden, missingCount, searchHidden, searchCount });
`);
check(taskRoster.initial.toolbar.includes('Sí entregaron') && taskRoster.initial.toolbar.includes('No entregaron') && taskRoster.initial.toolbar.includes('Aplicar calificación a los mostrados'), 'La tarea ofrece filtros de entrega y calificación masiva');
check(taskRoster.initial.rows.every((row) => row.grade.includes('task-grade-input')), 'Cada alumno tiene captura directa de calificación dentro de la tarea');
check(taskRoster.initial.rows[0].dataset.submitted === 'yes' && taskRoster.initial.rows[0].status === 'Entregado', 'Una entrega real se identifica como entregada');
check(taskRoster.initial.rows[1].dataset.submitted === 'no' && taskRoster.initial.rows[1].status === 'Sin entrega', 'Un alumno sin envío se identifica como no entregado');
check(JSON.stringify(taskRoster.submittedHidden) === '[false,true,true]' && taskRoster.submittedCount === '1 alumno mostrado', 'El filtro Sí entregaron deja solo las entregas reales');
check(JSON.stringify(taskRoster.missingHidden) === '[true,false,false]' && taskRoster.missingCount === '2 alumnos mostrados', 'El filtro No entregaron deja solo los alumnos pendientes');
check(JSON.stringify(taskRoster.searchHidden) === '[true,true,false]' && taskRoster.searchCount === '1 alumno mostrado', 'La búsqueda por alumno se combina con los filtros');
const bulkGradeRequest = await run(`(async () => {
  var bulkOriginalQuerySelectorAll = document.querySelectorAll;
  var bulkOriginalModal = modal;
  var bulkOriginalRequest = request;
  taskRows.forEach((row, index) => row.hidden = index === 0);
  document.querySelectorAll = (selector) => selector === '[data-task-submission-row]' ? taskRows : bulkOriginalQuerySelectorAll(selector);
  var sentBulkRequest = null;
  var bulkSubmitPromise = null;
  modal = (_title, _html, submit) => {
    bulkSubmitPromise = submit(new Map([['grade', '8.5'], ['publish', 'on']]));
  };
  request = async (path, body) => {
    sentBulkRequest = { path, body };
    return { grades: body.activities[0].grades.length };
  };
  bulkGradeVisibleModal('p1');
  await bulkSubmitPromise;
  document.querySelectorAll = bulkOriginalQuerySelectorAll;
  modal = bulkOriginalModal;
  request = bulkOriginalRequest;
  return sentBulkRequest;
})()`);
check(bulkGradeRequest.path === '/api/grades/import' && bulkGradeRequest.body.activities[0].grades.length === 2, 'La calificación masiva utiliza únicamente los alumnos mostrados');
check(bulkGradeRequest.body.activities[0].grades.every((item) => item.grade === 8.5) && bulkGradeRequest.body.publish === true, 'La calificación y publicación elegidas se aplican a todo el filtro');

// ---- El alumno ve su equipo ----
run(`me = { id: 'u-luis', role: 'student' };`);
check(run("teamBannerHtml(current.records[1])").includes('<strong>Equipo 1</strong> (Ana, Luis &lt;b&gt;)'));
run(`me = { id: 'u-sofia', role: 'student' };`);
check(run("teamBannerHtml(current.records[1])").includes('todavía no tienes equipo en "Laboratorio"'));

console.log(`PASS: ${checks} verificaciones de interfaz — categorías con puntos y asistencia, reglas de la calificación final, rúbrica, equipos y exportación.`);
