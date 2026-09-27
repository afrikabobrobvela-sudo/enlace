// Interfaz de la fase 2A: firma del QR en el navegador, ZIP de entregas y reglas de riesgo.
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const context = vm.createContext({
  document: { addEventListener() {}, querySelector: () => null, getElementById: () => null },
  window: { addEventListener() {} },
  crypto: globalThis.crypto,
  TextEncoder,
  atob,
  btoa,
  console,
});
for (const file of ['attendance.js', 'checkin.js', 'zip.js', 'risk.js']) vm.runInContext(readFileSync('src/public/' + file, 'utf8'), context);
const run = (code) => vm.runInContext(code, context);
let checks = 0;
const check = (...args) => {
  assert(...args);
  checks++;
};

// ---- El QR del navegador del docente coincide con la definición del servidor ----
const secret = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64url');
context.state = { code: 'Ab3_x9Zq', secret, windowMs: 10000, offset: 0 };
for (const [now, offset] of [[1790510400000, 0], [1790510409999, 0], [1790510410000, 0], [1790510400000, 25000], [1790510400000, -7000]]) {
  context.state.offset = offset;
  const { slot, token } = await run(`checkinToken(state, ${now})`);
  const expectedSlot = Math.floor((now + offset) / 10000);
  const signature = createHmac('sha256', Buffer.from(secret, 'base64url')).update(`Ab3_x9Zq.${expectedSlot}`).digest('base64url').slice(0, 16);
  check(slot === expectedSlot && token === `Ab3_x9Zq.${expectedSlot.toString(36)}.${signature}`, `Token con desfase de reloj ${offset} ms`);
}
check(run(`bytesToBase64url(base64urlToBytes('${secret}'))`) === secret, 'base64url ida y vuelta');

// ---- ZIP de entregas ----
const members = [
  { id: 'm1', name: 'Ana Pérez', matricula: '202612345', role: 'student' },
  { id: 'm2', name: 'Luis: "el/de" <Atrás>', matricula: '', role: 'student' },
  { id: 'm3', name: 'Sofía Núñez', matricula: '2026', role: 'student' },
];
const files = [
  { id: 'f1', name: 'reporte final.pdf', size: 20 },
  { id: 'f2', name: 'reporte final.pdf', size: 12 },
  { id: 'f3', name: 'foto?.jpg', size: 4 },
];
const task = { id: 't1', data: { title: 'Práctica 1: péndulo' } };
const submissions = [
  { data: { task: 't1', member: 'm1', submitted: '2026-09-20T10:00:00Z', body: 'Mi conclusión: T ∝ √L', fileIds: ['f1', 'f2'], grade: 9 } },
  { data: { task: 't1', member: 'm2', submitted: '2026-09-21T10:00:00Z', late: true, body: '', fileIds: ['f3'], grade: null } },
  { data: { task: 't1', member: 'm3', submitted: '', body: 'borrador sin enviar', fileIds: [] } },
  { data: { task: 'otra', member: 'm1', submitted: '2026-09-20T10:00:00Z', body: 'otra actividad', fileIds: [] } },
];
context.zipInput = { task, members, submissions, files };
const { folder, plan, students } = run('submissionZipPlan(zipInput.task, zipInput.members, zipInput.submissions, zipInput.files)');
check(folder === 'Práctica 1_ péndulo' && students === 2, 'Solo entregas enviadas de esta actividad');
check(
  JSON.stringify(plan.map((p) => p.path)) ===
    JSON.stringify([
      'Práctica 1_ péndulo/resumen.csv',
      'Práctica 1_ péndulo/Ana Pérez - 202612345/texto de la entrega.txt',
      'Práctica 1_ péndulo/Ana Pérez - 202612345/reporte final.pdf',
      'Práctica 1_ péndulo/Ana Pérez - 202612345/reporte final (2).pdf',
      'Práctica 1_ péndulo/Luis_ _el_de_ _Atrás_/foto_.jpg',
    ]),
  'Carpetas por alumno, nombres seguros y sin repetir',
);
const bytes = { f1: 'PDF de Ana, parte 1', f2: 'PDF de Ana 2', f3: 'JPG!' };
context.entries = plan.map((p) => ({ name: p.path, data: new TextEncoder().encode(p.text ?? bytes[p.fileId]), date: new Date('2026-09-20T10:00:00Z') }));
const parts = run('zipParts(entries)');
const zipBytes = Buffer.concat(parts.map((p) => Buffer.from(p)));
const dir = mkdtempSync(join(tmpdir(), 'enlace-zip-'));
writeFileSync(join(dir, 'entregas.zip'), zipBytes);
const python = spawnSync(
  'python3',
  [
    '-c',
    `import zipfile, json, sys
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
print(json.dumps({"bad": bad, "names": z.namelist(), "csv": z.read(z.namelist()[0]).decode("utf-8-sig"), "txt": z.read(z.namelist()[1]).decode("utf-8"), "pdf2": z.read(z.namelist()[3]).decode()}))`,
    join(dir, 'entregas.zip'),
  ],
  { encoding: 'utf8' },
);
assert.equal(python.status, 0, python.stderr);
const unzipped = JSON.parse(python.stdout);
check(unzipped.bad === null, 'Python verifica el CRC de cada archivo');
check(unzipped.names.length === 5 && unzipped.names[1] === 'Práctica 1_ péndulo/Ana Pérez - 202612345/texto de la entrega.txt', 'Nombres con acentos intactos (UTF-8)');
check(unzipped.txt === 'Mi conclusión: T ∝ √L' && unzipped.pdf2 === 'PDF de Ana 2');
check(unzipped.csv.split('\r\n')[2] === '"","Luis: ""el/de"" <Atrás>","2026-09-21T10:00:00Z","Sí","","1"', 'Resumen con entrega tardía y comillas escapadas');

// ---- Alumnos en riesgo ----
const now = Date.parse('2026-10-01T12:00:00Z');
const tasks = [
  { id: 'a', data: { title: 'Tarea 1', due: '2026-09-10T00:00:00Z', visible: true } },
  { id: 'b', data: { title: 'Tarea 2', due: '2026-09-20T00:00:00Z', visible: true } },
  { id: 'c', data: { title: 'Tarea 3', due: '2026-10-20T00:00:00Z', visible: true } }, // aún no vence
  { id: 'd', data: { title: 'Oculta', due: '2026-09-01T00:00:00Z', visible: false } },
];
const riskStudents = ['ana', 'beto', 'caro', 'dani'].map((id) => ({ id, name: id.toUpperCase() }));
context.riskInput = {
  students: riskStudents,
  tasks,
  submissions: [
    { data: { member: 'ana', task: 'a', submitted: '2026-09-09' } },
    { data: { member: 'ana', task: 'b', submitted: '2026-09-19' } },
    { data: { member: 'caro', task: 'a', submitted: '', grade: 8 } }, // calificación manual cuenta como entregada
    { data: { member: 'dani', task: 'b', submitted: '2026-09-19' } },
  ],
  averages: new Map([['ana', 9.5], ['beto', 4.2], ['caro', 5.5], ['dani', null]]),
  attendance: new Map([['ana', { low: false }], ['beto', { low: true }], ['caro', { low: false }], ['dani', { low: true }]]),
  now,
};
const report = run('riskReport(riskInput)');
const byId = Object.fromEntries(report.map((r) => [r.member.id, r]));
check(byId.beto.level === 'alto' && byId.beto.flags.join() === 'asistencia,entregas,promedio', 'Beto: los tres criterios');
check(byId.caro.level === 'medio' && byId.caro.flags.join() === 'promedio', 'Caro: una entrega faltante no basta; su promedio sí');
check(byId.dani.level === 'medio' && byId.dani.missing.map((t) => t.id).join() === 'a', 'Dani: sin promedio aún, asistencia baja');
check(byId.ana.level === '' && byId.ana.missing.length === 0, 'Ana sin alertas; la tarea oculta y la que no vence no cuentan');
check(report[0].member.id === 'beto' && report.at(-1).member.id === 'ana', 'Ordenado de mayor a menor riesgo');
check(run('riskReport({ ...riskInput, attendance: null })').find((r) => r.member.id === 'dani').level === '', 'Sin datos de asistencia no se inventa alerta');

console.log(`PASS: ${checks} verificaciones de interfaz — firma del QR igual a la del servidor, ZIP válido para Python y reglas de riesgo.`);
