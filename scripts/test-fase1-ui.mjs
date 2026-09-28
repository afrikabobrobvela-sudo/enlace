// Interfaz de la fase 1 ejecutada en una máquina virtual con un DOM mínimo.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const elements = new Map();
const element = (selector) => {
  if (!elements.has(selector)) {
    elements.set(selector, {
      innerHTML: '',
      textContent: '',
      value: '',
      style: {},
      dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {},
      querySelector: () => null,
      focus() {},
    });
  }
  return elements.get(selector);
};
const storage = new Map();
const downloads = [];
const context = vm.createContext({
  document: {
    querySelector: element,
    querySelectorAll: () => [],
    getElementById: (id) => element('#' + id),
    addEventListener() {},
    head: { append() {} },
    body: { classList: { add() {}, remove() {}, toggle() {} } },
  },
  window: { addEventListener() {}, scrollY: 0, scrollTo() {} },
  localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
  crypto: globalThis.crypto,
  console,
  setTimeout,
  clearTimeout,
  confirm: () => true,
});
const load = (file, transform = (s) => s) => vm.runInContext(transform(readFileSync('src/public/' + file, 'utf8')), context);
load('richtext.js');
load('trash.js');
load('evaluaciones.js');
load('pendientes.js');
load('calendario.js');
load('navegacion.js');
load('movil.js');
load('registro.js');
load('workspace.js');
load('preview.js');
load('attendance.js');
load('teams.js');
load('grading.js');
load('rubrics.js');
load('app.js', (s) => s.replace('\ninit();', '\n'));
const run = (code) => vm.runInContext(code, context);
const html = () => element('#main').innerHTML;
let checks = 0;
const check = (...args) => {
  assert(...args);
  checks++;
};

// ---- Reglas de asistencia ----
const summary = (statuses, rules) =>
  run(`attendanceSummary(${JSON.stringify(statuses)}, ${JSON.stringify({ min_percent: 80, lates_per_absence: 0, excused_counts: 'present', ...rules })})`);
check(summary(['present', 'present', 'late', 'absent', 'excused']).percent === 80);
check(summary(['present', 'present', 'late', 'absent', 'excused']).low === false, '80 % exacto cumple el mínimo');
check(summary(['present', 'present', 'late', 'absent', 'excused'], { excused_counts: 'excluded' }).percent === 75);
check(summary(['present', 'present', 'late', 'absent', 'excused'], { excused_counts: 'excluded' }).low === true);
check(summary(['present', 'late', 'late', 'late', 'present'], { lates_per_absence: 3 }).percent === 80, '3 retardos = 1 falta');
check(summary([]).percent === null, 'Sin registros no hay porcentaje');

// ---- Equipos ----
const students = Array.from({ length: 10 }, (_, i) => ({ id: 's' + i, name: 'Alumno ' + String.fromCharCode(74 - i), email: `a${i}@x.mx` }));
const sizes = (teams) => teams.map((t) => t.members.length);
run(`var testStudents = ${JSON.stringify(students)}`);
check(JSON.stringify(sizes(run(`makeTeams(testStudents, { mode: 'count', value: 3, order: 'alpha' })`))) === '[4,3,3]');
check(JSON.stringify(sizes(run(`makeTeams(testStudents, { mode: 'size', value: 4, order: 'alpha' })`))) === '[4,3,3]', 'Equipos de 4: sin equipos de 1 o 2');
check(run(`makeTeams(testStudents, { mode: 'count', value: 3, order: 'alpha' })`)[0].members[0] === 's9', 'Orden alfabético (Alumno A primero)');
check(run(`makeTeams(testStudents, { mode: 'count', value: 50, order: 'alpha' })`).length === 10, 'No hay más equipos que alumnos');
check(run(`makeTeams(testStudents, { mode: 'count', value: 0, order: 'alpha' })`).length === 0);
let seed = 7;
context.seeded = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const random = run(`makeTeams(testStudents, { mode: 'count', value: 4, order: 'random', random: seeded, prefix: 'Brigada' })`);
check(random.flatMap((t) => t.members).sort().join() === students.map((s) => s.id).sort().join(), 'Cada alumno queda en exactamente un equipo');
check(random[3].title === 'Brigada 4');
const pasted = run(`parseTeamList('Equipo\\tCorreo\\nRojo\\ta1@x.mx\\na2@x.mx, Azul\\nRojo;a3@x.mx\\nVerde, nadie@x.mx\\nAzul, a1@x.mx', testStudents)`);
check(JSON.stringify(pasted.teams) === JSON.stringify([{ title: 'Rojo', members: ['s1', 's3'] }, { title: 'Azul', members: ['s2'] }]));
check(pasted.errors.length === 2 && /no está inscrito/.test(pasted.errors[0]) && /dos veces/.test(pasted.errors[1]));

// ---- ¿Qué archivos tienen vista previa? ----
check(run(`previewKind('Reporte.PDF')`) === 'pdf');
check(run(`previewKind('IMG_1644.HEIC')`) === 'image');
check(run(`previewKind('clase.mov')`) === 'video');
check(run(`previewKind('tarea.docx')`) === null, 'Word se descarga, no se previsualiza');
check(run(`previewKind('sin-extension')`) === null);

// ---- Revisión en secuencia ----
run(`
  var inlineCalls = [];
  mountInlinePreview = (target, id, list) => inlineCalls.push({ id, list });
  me = { id: 'teacher', name: 'Docente', email: 't@x.mx', role: 'teacher' };
  current = {
    course: { id: 'c', name: 'Física I', group_name: '101' }, canTeach: true, canDelete: true,
    members: [
      { id: 'm-ana', user_id: 'u1', name: 'Ana', role: 'student', email: 'ana@x.mx' },
      { id: 'm-beto', user_id: 'u2', name: 'Beto <b>', role: 'student', email: 'beto@x.mx' },
      { id: 'm-caro', user_id: null, name: 'Caro', role: 'student', email: 'caro@x.mx' },
    ],
    files: [
      { id: 'f-pdf', name: 'reporte.pdf', size: 2048 },
      { id: 'f-xls', name: 'datos.xlsx', size: 4096 },
    ],
    records: [
      { id: 't1', kind: 'task', data: { title: 'Práctica 1', visible: true } },
      { id: 's-ana', kind: 'submission', revision: 2, data: { task: 't1', member: 'm-ana', submitted: '2026-09-20T10:00:00Z', body: 'Hecho', grade: 9, feedback: '', published: true, fileIds: [] } },
      { id: 's-beto', kind: 'submission', revision: 1, data: { task: 't1', member: 'm-beto', submitted: '2026-09-21T10:00:00Z', body: '', grade: null, feedback: '', published: true, fileIds: ['f-pdf', 'f-xls'] } },
    ],
  };
  section = 'review'; detail = 't1'; reviewMember = 'm-beto';
`);
run('renderReview()');
let page = html();
check(/data-member="m-ana" >‹ Anterior/.test(page), 'Anterior: Ana');
check(/data-member="m-caro" >Siguiente ›/.test(page), 'Siguiente: Caro');
check(/<option value="m-beto" selected>2\. Beto &lt;b&gt; \(sin calificar\)<\/option>/.test(page), 'Selector con la posición y nombre escapado');
check(page.includes('Guardar y siguiente'));
check(page.includes('1 de 3 calificados'));
check((page.match(/data-preview=/g) || []).length === 1, 'Vista previa solo para el PDF, no para Excel');
check(JSON.stringify(run('inlineCalls.at(-1)')) === JSON.stringify({ id: 'f-pdf', list: ['f-pdf'] }), 'El PDF se abre junto al formulario');

run(`reviewOnlyPending = true; reviewMember = 'm-beto'; renderReview();`);
page = html();
check(!page.includes('Guardar y siguiente') && /disabled>‹ Anterior/.test(page), 'Solo pendientes: Ana ya está calificada y Caro no entregó');

run(`reviewOnlyPending = false; current.records[2].data.grade = 7; current.records[2].data.published = false; reviewMember = 'm-beto'; renderReview();`);
check(html().includes('Borrador: el alumno todavía no ve esta calificación.'));
run(`section = 'grades'; gradeTab = 'entry'; renderGrades();`);
page = html();
check(/data-action="publish-task" data-id="t1">Publicar 1 borrador<\/button>/.test(page));
check(page.includes('<span class="draft-tag">borrador</span>'));

// ---- Pasar lista ----
run(`
  current.members.push({ id: 'm-eva', user_id: 'u5', name: '=HYPERLINK("x")', role: 'student', matricula: '2026' });
  attendanceData = {
    course: 'c', canTeach: true,
    settings: { min_percent: 80, lates_per_absence: 0, excused_counts: 'present' },
    sessions: [{ id: 'ses1', date: '2026-09-28', start_time: '07:00', topic: 'Cinemática' }, { id: 'ses2', date: '2026-10-05', start_time: '', topic: '' }],
    records: [
      { session: 'ses1', member: 'm-ana', status: 'present', note: '' },
      { session: 'ses1', member: 'm-beto', status: 'late', note: 'Llegó 07:15' },
      { session: 'ses2', member: 'm-ana', status: 'absent', note: '' },
    ],
  };
  attendanceSessionId = 'ses1';
  renderRollCall();
`);
page = html();
check((page.match(/data-att="mark"/g) || []).length === 16, 'Cuatro estados por cada uno de los 4 alumnos');
check(/data-member="m-beto" data-status="late" aria-pressed="true"/.test(page));
check(page.includes('Marcar 2 sin registro como presentes'));
check(page.includes('value="Llegó 07:15"'));
check(page.includes('1 presentes, 1 retardos, 0 faltas, 0 justificadas, 2 sin registro'));

run(`download = (name, text) => downloadsOut.push({ name, text });`);
context.downloadsOut = downloads;
run('exportAttendance()');
const csv = downloads[0].text.replace(/^\uFEFF/, '').split('\r\n');
check(csv[0] === '"Matrícula","Alumno","2026-09-28 07:00","2026-10-05","Asistencias","Retardos","Faltas","Justificadas","Porcentaje"');
check(csv[1] === '"","Ana","P","F","1","0","1","0","50.0"', 'Ana: 1 de 2 = 50 %');
check(csv[4].startsWith(`"2026","'=HYPERLINK(""x"")"`), 'Un nombre que empieza con = no se vuelve fórmula en Excel');

run(`attendanceData.canTeach = false; attendanceData.records = attendanceData.records.filter((r) => r.member === 'm-ana'); renderMyAttendance();`);
page = html();
check(page.includes('att-pill low') && page.includes('50 %'), 'El alumno ve su porcentaje y la alerta');

console.log(`PASS: ${checks} verificaciones de interfaz — reglas de asistencia, equipos equilibrados, vista previa por tipo, revisión en secuencia, borradores, pasar lista y exportación segura.`);
