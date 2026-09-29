// Interfaz en el teléfono: direcciones de cada pantalla (botón «Atrás»), barra inferior y menú «Más»,
// tablas que se leen como tarjetas, «Mis calificaciones» del alumno y fotos unidas en un PDF.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const elements = new Map();
const element = (selector) => {
  if (!elements.has(selector)) {
    elements.set(selector, {
      innerHTML: '', textContent: '', value: '', hidden: false, style: {}, dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, querySelector: () => null, focus() {},
    });
  }
  return elements.get(selector);
};
const bodyClasses = new Set();
const context = vm.createContext({
  document: {
    querySelector: element, querySelectorAll: () => [], getElementById: (id) => element('#' + id),
    addEventListener() {}, head: { append() {} },
    body: { classList: { add: (c) => bodyClasses.add(c), remove: (c) => bodyClasses.delete(c), toggle: (c, on) => (on ? bodyClasses.add(c) : bodyClasses.delete(c)) } },
  },
  window: { addEventListener() {}, scrollY: 0, scrollTo() {} },
  localStorage: { getItem: () => null, setItem() {} },
  crypto: globalThis.crypto, structuredClone, console, setTimeout, clearTimeout, confirm: () => true,
  TextEncoder, Blob, File, URLSearchParams,
});
const load = (file, transform = (s) => s) => vm.runInContext(transform(readFileSync('src/public/' + file, 'utf8')), context);
for (const file of ['fecha.js', 'richtext.js', 'compress.js', 'trash.js', 'reactivos.js', 'evaluaciones.js', 'banco.js', 'oficina.js', 'resultados.js', 'importar.js', 'foros.js', 'condiciones.js', 'importaciones.js', 'secciones.js', 'especial.js', 'foto.js', 'pendientes.js', 'calendario.js', 'navegacion.js', 'movil.js', 'registro.js', 'workspace.js', 'preview.js', 'attendance.js', 'teams.js', 'grading.js', 'rubrics.js']) load(file);
load('app.js', (s) => s.replace('\ninit();', '\n'));
const run = (code) => vm.runInContext(code, context);
let checks = 0;
const check = (condition, message) => {
  assert(condition, message);
  checks++;
};
const same = (a, b, message) => {
  assert.deepEqual(JSON.parse(JSON.stringify(a)), b, message);
  checks++;
};

// ---- Direcciones de pantalla (#c=…&s=…) ----
same(run(`parseRoute('#c=curso1&s=task&d=t1&x=ignorado')`), { c: 'curso1', s: 'task', d: 't1' }, 'Lee curso, sección y elemento; ignora lo demás');
same(run(`parseRoute('#c=' + 'a'.repeat(201))`), {}, 'Valores demasiado largos se descartan');
check(run(`routeHash({ c: 'c 1', s: 'content', m: 'u/1', d: '' })`) === '#c=c+1&s=content&m=u%2F1', 'Se codifica y omite lo vacío');
check(run(`routeHash({})`) === '', 'Mis cursos no lleva dirección');
run(`me = { id: 'u-ana', name: 'Ana', role: 'student' }; homeView = 'courses'; current = null;`);
same(run('routeNow()'), {}, 'Sin curso: ruta vacía');
run(`homeView = 'reports';`);
same(run('routeNow()'), { h: 'reports' }, 'Pantallas de administración se recuerdan');
run(`
  homeView = 'courses';
  current = {
    course: { id: 'c1', name: 'Física I', group_name: '501' }, canTeach: false,
    members: [{ id: 'm-ana', user_id: 'u-ana', name: 'Ana', role: 'student' }, { id: 'm-luis', user_id: 'u-luis', name: 'Luis', role: 'student' }],
    files: [],
    records: [
      { id: 't1', kind: 'task', data: { title: 'Práctica <1>', due: '2099-01-01T00:00:00Z', visible: true } },
      { id: 't2', kind: 'task', data: { title: 'Reporte', due: '2020-01-01T00:00:00Z', visible: true } },
      { id: 't3', kind: 'task', data: { title: 'Cerrada', due: '2020-01-01T00:00:00Z', end: '2020-01-02T00:00:00Z', visible: true } },
      { id: 't4', kind: 'task', data: { title: 'Entregada', due: '2099-01-01T00:00:00Z', visible: true } },
      { id: 's4', kind: 'submission', author: 'u-ana', data: { task: 't4', member: 'm-ana', submitted: '2026-09-01T00:00:00Z', grade: null } },
      { id: 's2', kind: 'submission', author: 'u-ana', data: { task: 't2', member: 'm-ana', submitted: '2026-09-01T00:00:00Z', grade: 8.5, feedback: 'Bien <b>hecho</b>' } },
      { id: 'q1', kind: 'quiz', data: { title: 'Diagnóstico', questions: [{}], settings: { attempts: 2 } } },
      { id: 'q2', kind: 'quiz', data: { title: 'Parcial', questions: [{}], settings: { attempts: 1, exam: { enabled: true } } } },
      { id: 'a1', kind: 'attempt', author: 'u-ana', data: { quiz: 'q1', score: 7, attempt: 1 } },
      { id: 'mod', kind: 'module', data: { title: 'Unidad 1' } },
    ],
  };
  section = 'task'; detail = 't1';
`);
same(run('routeNow()'), { c: 'c1', s: 'task', d: 't1' }, 'Detalle de actividad');
run(`section = 'tasks';`);
same(run('routeNow()'), { c: 'c1', s: 'tasks' }, 'En una lista no se arrastra el elemento anterior');
run(`section = 'content'; moduleId = 'mod';`);
same(run('routeNow()'), { c: 'c1', s: 'content', m: 'mod' }, 'Unidad abierta');
run(`section = 'attendance'; moduleId = null; attendanceSessionId = 'ses1';`);
same(run('routeNow()'), { c: 'c1', s: 'attendance', a: 'ses1' }, 'Pasar lista de una sesión');
run(`section = 'review'; detail = 't1'; reviewMember = 'm-ana'; attendanceSessionId = null;`);
same(run('routeNow()'), { c: 'c1', s: 'review', d: 't1', r: 'm-ana' }, 'Revisión de un alumno');

// ---- Barra inferior y menú «Más» ----
same(run('bottomNavSections()'), ['hub', 'content', 'tasks', 'grades'], 'Alumno: sus notas en la barra');
check(run('moreSections()').includes('quizzes') && !run('moreSections()').includes('grades'), 'Alumno: evaluaciones en «Más»');
check(run('tasksBadge()') === 1, 'Alumno: solo cuenta la actividad abierta sin entregar (t1)');
run(`section = 'task'; renderBottomNav();`);
let bar = element('#bottomnav').innerHTML;
check((bar.match(/data-section=/g) || []).length === 4 && bar.includes('data-more-sheet'), 'Cuatro secciones y «Más»');
check(/data-section="tasks" class="active" aria-current="page"/.test(bar), 'El detalle de una actividad marca «Actividades»');
check(bar.includes('>1</b>') && bar.includes('1 por entregar'), 'Globo con las actividades por entregar');
check(element('#bottomnav').hidden === false && bodyClasses.has('has-bottomnav'), 'La barra se muestra dentro de un curso');
run(`current.canTeach = true;`);
same(run('bottomNavSections()'), ['hub', 'content', 'tasks', 'attendance'], 'Docente: pasar lista en la barra');
check(run('moreSections()').includes('grades') && run('moreSections()').includes('admin'), 'Docente: calificaciones y administración en «Más»');
check(run('tasksBadge()') === 1, 'Docente: entregas por calificar (s4)');
run(`current.canTeach = false; const saved = current; current = null; renderBottomNav(); current = saved;`);
check(element('#bottomnav').hidden === true && !bodyClasses.has('has-bottomnav'), 'Fuera de un curso no hay barra');

// ---- Mis calificaciones (alumno) ----
let html = run('myGradesHtml()');
check(html.includes('<p class="my-grade-big grade-pass">8.50</p>'), 'Promedio parcial con las actividades calificadas');
check(html.includes('Práctica &lt;1&gt;') && !html.includes('Práctica <1>'), 'Títulos escapados');
check(html.includes('Bien &lt;b&gt;hecho&lt;/b&gt;'), 'Comentario del docente escapado');
check(html.includes('>Por calificar</span>') && html.includes('>Sin entrega</span>') && html.includes('>Pendiente</span>'), 'Estados de lo que no está calificado');
check(html.includes('data-action="task" data-id="t1"') && html.includes('data-action="quiz" data-id="q1"'), 'Cada fila abre su actividad o evaluación');
check(/>7\.00<\/span>/.test(html) && html.includes('Sin contestar'), 'Mejor intento de cada evaluación');
run(`previewAsStudent = true; me = { id: 'docente', role: 'teacher' };`);
check(run('myGradesHtml()').includes('En la vista de alumno no hay un alumno en particular'), 'Vista de alumno sin alumno concreto');
run(`previewAsStudent = false; me = { id: 'u-ana', name: 'Ana', role: 'student' };`);
check(run(`quizStudentStatus(find('q1'))`) === '7.00 / 10 · queda 1 intento', 'Evaluación con intentos restantes');
check(run(`quizStudentStatus(find('q2'))`) === 'Pendiente · modo examen', 'Examen pendiente');

// ---- Asistencia: forma corta de «Justificada» ----
check(run('attStateLabel(ATT_STATUS.excused)').includes('att-compact" aria-hidden="true">Justif.'), 'Justificada tiene forma corta');
check(run('attStateLabel(ATT_STATUS.present)') === 'Presente', 'Los demás estados no cambian');

// ---- Tablas como tarjetas ----
const cell = (text, colSpan = 1) => ({ textContent: text, colSpan, dataset: {}, classList: { list: [], add(c) { this.list.push(c); } }, hasAttribute: () => false });
const fakeTable = (heads, rows, excluded = false) => ({
  tHead: { rows: [{ cells: heads.map((h) => cell(h)) }] },
  tBodies: [{ rows: rows.map((r) => ({ cells: r })) }],
  classList: { list: [], add(c) { this.list.push(c); } },
  closest: () => (excluded ? {} : null),
});
const lista = fakeTable(['Alumno', 'Estado', 'Calificación'], [[cell('Ana'), cell('Entregó'), cell('9')], [cell('Sin alumnos', 3)]]);
const matriz = fakeTable(['Alumno', 'P1'], [[cell('Ana'), cell('9')]], true);
context.fakeRoot = { querySelectorAll: () => [lista, matriz] };
run('labelTables(fakeRoot)');
check(lista.classList.list.includes('stack-table') && lista.tBodies[0].rows[0].cells[1].dataset.label === 'Estado', 'Cada celda lleva el nombre de su columna');
check(lista.tBodies[0].rows[1].cells[0].classList.list.includes('stack-full') && !lista.tBodies[0].rows[1].cells[0].dataset.label, 'Una celda que abarca varias columnas va completa');
check(!matriz.classList.list.includes('stack-table'), 'El libro de calificaciones y la asistencia se quedan como tabla');

// ---- Fotos a PDF ----
check(run(`isPhoto({ type: 'image/jpeg', name: 'a.jpg' })`) && run(`isPhoto({ type: '', name: 'IMG_1.HEIC' })`) && !run(`isPhoto({ type: 'application/pdf', name: 'a.pdf' })`), 'Reconoce fotos por tipo o nombre');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
context.jpegPages = [
  { bytes: new Uint8Array(jpeg), width: 1200, height: 1600 },
  { bytes: new Uint8Array(jpeg), width: 1600, height: 1200 },
];
const pdf = Buffer.from(await run('jpegPagesToPdf(jpegPages)').arrayBuffer());
const text = pdf.toString('latin1');
check(text.startsWith('%PDF-1.4') && text.trimEnd().endsWith('%%EOF'), 'Encabezado y final de PDF');
check(text.includes('/Count 2') && text.includes('/MediaBox [0 0 595 793]') && text.includes('/MediaBox [0 0 595 446]'), 'Dos páginas del ancho de A4 con la proporción de cada foto');
check((text.match(/\/Filter \/DCTDecode/g) || []).length === 2 && text.includes(`/Length ${jpeg.length}`), 'Cada foto va como JPEG sin volver a comprimir');
const startxref = Number(/startxref\n(\d+)/.exec(text)[1]);
check(text.slice(startxref, startxref + 4) === 'xref', 'startxref apunta a la tabla de referencias');
const offsets = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
check(offsets.length === 8 && offsets.every((o, i) => text.slice(o).startsWith(`${i + 1} 0 obj`)), 'Cada entrada de la tabla apunta a su objeto');

console.log(`PASS: ${checks} verificaciones de interfaz en el teléfono — direcciones para «Atrás», barra inferior y menú Más, tablas como tarjetas, Mis calificaciones y fotos unidas en PDF.`);
