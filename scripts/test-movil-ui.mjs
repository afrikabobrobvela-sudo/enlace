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
for (const file of ['fecha.js', 'richtext.js', 'compress.js', 'trash.js', 'reactivos.js', 'evaluaciones.js', 'banco.js', 'oficina.js', 'resultados.js', 'd2l.js', 'importar.js', 'foros.js', 'condiciones.js', 'importaciones.js', 'secciones.js', 'especial.js', 'foto.js', 'pendientes.js', 'calendario.js', 'navegacion.js', 'movil.js', 'registro.js', 'workspace.js', 'preview.js', 'attendance.js', 'teams.js', 'grading.js', 'rubrics.js']) load(file);
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
      { id: 't1', kind: 'task', data: { title: 'Práctica <1>', due: new Date(Date.now() + 3 * 86400000).toISOString(), visible: true } },
      { id: 't5', kind: 'task', data: { title: 'Lejana', due: '2099-01-01T00:00:00Z', visible: true } }, // fuera de la ventana de 14 días del inicio
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
check(run('tasksBadge()') === 1, 'Alumno: solo cuenta la que vence pronto sin entregar (t1), como «Por entregar» del inicio');
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

// ---- Modo examen: los controles nativos no cuentan como salir de la página ----
const examFocusResult = await run(`(async () => {
  var examCalls = [];
  var examToasts = [];
  var examSelect = {
    matches: (selector) => selector === 'select' || selector === '#quizAttempt select',
    closest: (selector) => selector === '#quizAttempt' ? examSelect : null,
  };
  var examRadio = {
    matches: () => false,
    closest: (selector) => selector === '#quizAttempt' ? examRadio : null,
  };
  globalThis.fetch = async (url) => {
    examCalls.push(url);
    return { ok: true, json: async () => url.endsWith('/back') ? { locked: false } : { ok: true } };
  };
  globalThis.navigator ??= { userAgent: 'Mozilla/5.0' };
  toast = (message) => examToasts.push(message);
  saveExamProgress = async () => {};
  var focused = false;
  document.hasFocus = () => focused;
  document.visibilityState = 'visible';
  var wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  var newExamState = () => ({ quizId: 'q2', attempt: 1, exam: { lockOnLeave: true }, collect: () => ({}), position: 0, events: [], awaySince: null, blurTimer: null, lastCopy: 0, saveTimer: null, locked: false });
  var snapshot = () => ({ calls: [...examCalls], events: [...examState.events], toasts: [...examToasts] });
  var reset = () => { examCalls.length = 0; examToasts.length = 0; examState = newExamState(); };

  // Un selector nativo abierto le quita el foco a la ventana aunque la página nunca se oculte (12.30).
  reset();
  document.activeElement = examSelect;
  examAwayCheck();
  await wait(BLUR_CONFIRM_MS + 100);
  focused = true; examAwayCheck(); focused = false;
  var selectResult = snapshot();

  // Un parpadeo del foco al tocar una respuesta en el teléfono no es salida (12.32).
  reset();
  document.activeElement = examRadio;
  examAwayCheck();
  await wait(50);
  focused = true; examAwayCheck(); focused = false;
  await wait(BLUR_CONFIRM_MS + 50);
  var touchResult = snapshot();

  // Perder el foco más de BLUR_CONFIRM_MS (otra ventana con la página a la vista) sí es salida.
  reset();
  document.activeElement = null;
  examAwayCheck();
  await wait(BLUR_CONFIRM_MS + 100);
  focused = true; examAwayCheck(); focused = false;
  await wait(0); await wait(0);
  var desktopAwayResult = snapshot();

  // Ocultar de verdad la pestaña o la aplicación cuenta en ese instante.
  reset();
  document.visibilityState = 'hidden';
  examAwayCheck();
  document.visibilityState = 'visible';
  focused = true; examAwayCheck(); focused = false;
  await wait(0); await wait(0);
  var hiddenResult = snapshot();

  // Salir de pantalla completa por un selector abierto no se registra; una salida real sí.
  examState = newExamState();
  document.fullscreenElement = null;
  document.activeElement = examSelect;
  examFullscreenCheck();
  var internalFullscreenEvents = [...examState.events];
  document.activeElement = null;
  examFullscreenCheck();
  var realFullscreenEvents = [...examState.events];
  document.getElementById('examFullscreenBar')?.remove?.();
  examState = null;
  return { selectResult, touchResult, desktopControlResult: touchResult, desktopAwayResult, hiddenResult, internalFullscreenEvents, realFullscreenEvents };
})()`);
check(examFocusResult.selectResult.calls.length === 0 && examFocusResult.selectResult.events.length === 0 && examFocusResult.selectResult.toasts.length === 0, 'Abrir y elegir en un selector del examen no se registra como salida');
check(examFocusResult.touchResult.calls.length === 0 && examFocusResult.touchResult.events.length === 0 && examFocusResult.touchResult.toasts.length === 0, 'Tocar una respuesta en el teléfono no bloquea ni muestra el aviso de salida');
check(examFocusResult.desktopControlResult.calls.length === 0 && examFocusResult.desktopControlResult.events.length === 0, 'Seleccionar una respuesta en computadora tampoco se confunde con cambiar de ventana');
check(examFocusResult.desktopAwayResult.calls.some((url) => url.endsWith('/away')) && examFocusResult.desktopAwayResult.calls.some((url) => url.endsWith('/back')), 'Cambiar realmente de ventana en computadora continúa registrándose');
check(examFocusResult.hiddenResult.calls.some((url) => url.endsWith('/away')) && examFocusResult.hiddenResult.calls.some((url) => url.endsWith('/back')), 'Cambiar realmente de pestaña o aplicación sí se registra');
check(examFocusResult.hiddenResult.events.some((event) => event.kind === 'left') && examFocusResult.hiddenResult.toasts.some((message) => message.includes('Saliste del examen')), 'Una salida real conserva el evento y el aviso');
check(examFocusResult.internalFullscreenEvents.length === 0 && examFocusResult.realFullscreenEvents.some((event) => event.kind === 'fullscreen'), 'Solo una salida real de pantalla completa queda registrada');

const examNavigationResult = await run(`(async () => {
  var navOriginalQuerySelector = document.querySelector;
  var navOriginalQuerySelectorAll = document.querySelectorAll;
  var navOriginalSave = saveExamProgress;
  var navOriginalConfirm = confirm;
  var navFields = Array.from({ length: 3 }, () => ({
    hidden: false, disabled: false,
    querySelectorAll: () => [],
    querySelector: () => ({ focus() {} }),
  }));
  var navPrev = { hidden: false, disabled: false, textContent: '' };
  var navNext = { hidden: false, disabled: false, textContent: '' };
  document.querySelectorAll = (selector) => selector === '#quizAttempt fieldset[data-position]' ? navFields
    : selector === '[data-exam-nav]' ? [navPrev, navNext]
    : navOriginalQuerySelectorAll(selector);
  document.querySelector = (selector) => selector === '[data-exam-nav="prev"]' ? navPrev
    : selector === '[data-exam-nav="next"]' ? navNext
    : navOriginalQuerySelector(selector);
  confirm = () => { throw new Error('No debe abrir confirm'); };
  // Sin regresar, avanzar pide confirmación dentro de la página (12.32), nunca con confirm().
  var navOriginalExamConfirm = examConfirm;
  var confirmCalls = 0;
  examConfirm = async () => { confirmCalls++; return true; };
  var saveCalls = 0;
  var releaseSave;
  saveExamProgress = async () => {
    saveCalls++;
    await new Promise((resolve) => { releaseSave = resolve; });
  };
  examState = {
    exam: { oneByOne: true, noBack: true, randomOrder: true }, position: 0, navigating: false,
    events: [], saveTimer: null, blurTimer: null, ignoreBlur: false,
  };
  var first = examNavigate('next');
  var second = examNavigate('next');
  await new Promise((resolve) => setTimeout(resolve, 0));
  var duringSave = { position: examState.position, navigating: examState.navigating, saveCalls, buttonsDisabled: navPrev.disabled && navNext.disabled };
  releaseSave();
  await Promise.all([first, second]);
  var afterSave = {
    position: examState.position, navigating: examState.navigating, saveCalls,
    hidden: navFields.map((field) => field.hidden), disabled: navFields.map((field) => field.disabled),
    prevHidden: navPrev.hidden, nextText: navNext.textContent,
  };
  await examNavigate('prev');
  var afterForbiddenBack = { position: examState.position, saveCalls };

  examState.position = 0;
  saveExamProgress = async () => { saveCalls++; throw new Error('sin red'); };
  await examNavigate('next');
  var afterFailure = { position: examState.position, navigating: examState.navigating };
  examState = null;
  document.querySelector = navOriginalQuerySelector;
  document.querySelectorAll = navOriginalQuerySelectorAll;
  saveExamProgress = navOriginalSave;
  confirm = navOriginalConfirm;
  examConfirm = navOriginalExamConfirm;
  return { confirmCalls, duringSave, afterSave, afterForbiddenBack, afterFailure };
})()`);
check(examNavigationResult.duringSave.position === 1 && examNavigationResult.duringSave.navigating && examNavigationResult.duringSave.saveCalls === 1 && examNavigationResult.duringSave.buttonsDisabled, 'Guardar y siguiente bloquea ambos botones mientras guarda');
check(examNavigationResult.afterSave.position === 1 && examNavigationResult.afterSave.saveCalls === 1, 'Un doble clic no salta dos preguntas');
check(examNavigationResult.confirmCalls >= 1, 'Sin regresar, avanzar se confirma dentro de la página');
check(JSON.stringify(examNavigationResult.afterSave.hidden) === '[true,false,true]' && JSON.stringify(examNavigationResult.afterSave.disabled) === '[true,false,false]', 'La pregunta cambia dentro de la misma vista y la anterior queda cerrada');
check(examNavigationResult.afterSave.prevHidden && examNavigationResult.afterSave.nextText.includes('aleatoria'), 'Sin regresar oculta Anterior y anuncia la siguiente pregunta aleatoria');
check(examNavigationResult.afterForbiddenBack.position === 1 && examNavigationResult.afterForbiddenBack.saveCalls === 1, 'Sin regresar impide volver incluso por llamada directa');
check(examNavigationResult.afterFailure.position === 0 && !examNavigationResult.afterFailure.navigating, 'Si no se puede guardar, permanece en la pregunta actual');

const hardenedExam = run(`(() => {
  var hardOriginalQuerySelector = document.querySelector;
  var hardOriginalToast = toast;
  var hardNames = ['exam', 'oneByOne', 'noBack', 'lockPlatform', 'lockOnLeave', 'shuffle', 'shuffleOptions', 'seb'];
  var hardInputs = Object.fromEntries(hardNames.map((name) => [name, { checked: false }]));
  var hardGrace = { value: '0' };
  var hardExamOptions = { hidden: true, removeAttribute() {} };
  var hardSebOptions = { hidden: true };
  var hardToast = '';
  document.querySelector = (selector) => {
    var match = /^input\\[name="([^"]+)"\\]$/.exec(selector);
    if (match) return hardInputs[match[1]] || null;
    if (selector === 'select[name="lockGrace"]') return hardGrace;
    if (selector === '.exam-options') return hardExamOptions;
    if (selector === '.seb-options') return hardSebOptions;
    return hardOriginalQuerySelector(selector);
  };
  toast = (message) => { hardToast = message; };
  dirty = false;
  hardenExamSettings();
  var result = { checked: hardNames.map((name) => hardInputs[name].checked), grace: hardGrace.value, examHidden: hardExamOptions.hidden, sebHidden: hardSebOptions.hidden, dirty, toast: hardToast };
  document.querySelector = hardOriginalQuerySelector;
  toast = hardOriginalToast;
  return result;
})()`);
check(hardenedExam.checked.every(Boolean) && hardenedExam.grace === '5', 'La configuración reforzada activa pregunta por pregunta, azar, bloqueos y Safe Exam Browser');
check(!hardenedExam.examHidden && !hardenedExam.sebHidden && hardenedExam.dirty && hardenedExam.toast.includes('reforzada'), 'El docente ve y revisa la configuración reforzada antes de guardarla');

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
