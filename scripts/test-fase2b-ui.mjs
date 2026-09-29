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
for (const file of ['fecha.js', 'richtext.js', 'trash.js', 'reactivos.js', 'evaluaciones.js', 'banco.js', 'oficina.js', 'resultados.js', 'importar.js', 'foros.js', 'condiciones.js', 'importaciones.js', 'secciones.js', 'especial.js', 'foto.js', 'pendientes.js', 'calendario.js', 'navegacion.js', 'movil.js', 'registro.js', 'workspace.js', 'preview.js', 'attendance.js', 'teams.js', 'grading.js', 'rubrics.js']) load(file);
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
    final: { decimals: 1, rounding: 'half_up', passing: 6, failingAs: null, missingAsZero: true },
  };
`);
let result = run('computeGrade({ tasks, grades, settings, attendancePercent: 90 })');
check(close(result.categories[0].value, 7), 'Exámenes por puntos: (8×2 + 5×1) / 3 = 7');
check(close(result.categories[1].value, 10) && close(result.categories[2].value, 9), 'Tareas 10; asistencia 90 % = 9');
check(close(result.value, 8.1), 'Parcial: 7×0.6 + 10×0.3 + 9×0.1 = 8.1 (la actividad sin categoría no cuenta)');
check(close(run('computeGrade({ tasks, grades, settings, attendancePercent: null }).value'), 8), 'Sin datos de asistencia se normaliza: (7×60 + 10×30) / 90 = 8');
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
check(run("roundGrade(5.95, 1, 'half_up')") === 6, '5.95 → 6.0');
check(run("roundGrade(1.005, 2, 'half_up')") === 1.01, '1.005 → 1.01: en JavaScript 1.005 × 100 = 100.4999…, sin corrección daría 1.00');
check(run("roundGrade(5.5, 0, 'half_up')") === 6 && run("roundGrade(5.95, 0, 'down')") === 5);
check(run("roundGrade(8.449, 2, 'half_up')") === 8.45);
const rules = { decimals: 0, rounding: 'half_up', passing: 6, failingAs: 5 };
check(JSON.stringify(run(`finalGrade(5.45, ${JSON.stringify(rules)})`)) === '{"value":5,"passed":false}', 'No aprueba: se asienta 5');
check(JSON.stringify(run(`finalGrade(5.5, ${JSON.stringify(rules)})`)) === '{"value":6,"passed":true}', '5.5 redondea a 6 y aprueba');
check(JSON.stringify(run(`finalGrade(3.2, ${JSON.stringify({ ...rules, failingAs: null })})`)) === '{"value":3,"passed":false}', 'Sin regla de 5, se asienta la calculada');
check(JSON.stringify(run(`finalGrade(5.99, ${JSON.stringify({ ...rules, decimals: 1, rounding: 'down', failingAs: null })})`)) === '{"value":5.9,"passed":false}', 'Truncar: 5.99 → 5.9');
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
        final: { decimals: 0, rounding: 'half_up', passing: 6, failingAs: 5, missingAsZero: false } } },
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
run(`section = 'grades'; gradeTab = 'entry'; renderGrades();`);
page = run("$('#main').innerHTML");
check(page.includes('<th>Calificación final</th>') && page.includes('Exámenes<div class="muted">50 %</div>'), 'Columnas de final y de categorías');
check(/final-grade grade-low">5<\/td>/.test(page), 'Sofía: 4 en Exámenes → se asienta 5, no aprueba');
check(page.includes('Promedio parcial por categorías'));
run("download = (name, text) => downloads.push(text); exportGrades();");
const csv = downloads[0].replace(/^\uFEFF/, '').split('\r\n');
check(csv[0].includes('"Calificación final","Exámenes (50 %)","Prácticas (50 %)"'), 'La exportación incluye final y categorías');
check(csv.find((row) => row.includes('Sofía')).includes('"4.00","5","4.00",""'), 'Sofía: parcial 4.00, final 5, Exámenes 4.00, Prácticas vacía');

// ---- El alumno ve su equipo ----
run(`me = { id: 'u-luis', role: 'student' };`);
check(run("teamBannerHtml(current.records[1])").includes('<strong>Equipo 1</strong> (Ana, Luis &lt;b&gt;)'));
run(`me = { id: 'u-sofia', role: 'student' };`);
check(run("teamBannerHtml(current.records[1])").includes('todavía no tienes equipo en "Laboratorio"'));

console.log(`PASS: ${checks} verificaciones de interfaz — categorías con puntos y asistencia, reglas de la calificación final, rúbrica, equipos y exportación.`);
