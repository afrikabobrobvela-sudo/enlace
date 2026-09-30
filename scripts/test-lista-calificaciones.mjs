// Pruebas de la 12.24: ubicación que ya no marca a quien está en el salón (imprecisión de ambos teléfonos, posición
// del grupo y red), importar pase de lista e importar calificaciones (formato de Brightspace), y la interpretación de
// los archivos en el navegador.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'l'.repeat(40) };
let checks = 0;
const cookies = {};
const ESCUELA = '148.228.10.20';
const CASA = '189.203.4.5';
async function call(user, path, data, status = 200, ip = ESCUELA) {
  cookies[user] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user }),
    env,
  );
  const before = store.counter.queries;
  const res = await api(
    new Request('https://t.local' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { cookie: cookies[user], Origin: 'https://t.local', 'X-Aula-Request': '1', 'CF-Connecting-IP': ip },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${user}) → ${text}`);
  assert(store.counter.queries - before <= 50);
  checks++;
  return JSON.parse(text);
}

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '501' }, 201)).id;
const alumnos = ['ana', 'beto', 'carla', 'dani', 'eva', 'fer', 'gil', 'hugo'];
await call('docente', '/api/members/bulk', {
  course: c,
  students: alumnos.map((n, i) => ({ name: `${n[0].toUpperCase()}${n.slice(1)} Pérez`, email: n + '@example.test', matricula: `20260${i}` })),
});
const miembros = (await call('docente', '/api/course?id=' + c)).members;
const id = (n) => miembros.find((m) => m.email === n + '@example.test').id;

// ---- Ubicación ----
// El punto del docente quedó ~650 m al norte del salón (su GPS dentro del edificio) y los alumnos, en el salón.
const salon = { lat: 19.0006, lng: -98.2016 };
const docente = { lat: salon.lat + 0.00585, lng: salon.lng, accuracy: 20 }; // ~650 m
const enSalon = (k) => ({ lat: salon.lat + k * 0.00002, lng: salon.lng, accuracy: 15 });
const hoy = (await call('docente', '/api/attendance/session', { course: c, date: '2026-10-05' }, 201)).id;
const abierto = await call('docente', '/api/attendance/checkin/open', { course: c, session: hoy, mode: 'code', minutes: 10, radius: 100, location: docente });
const registrar = (quien, location, ip = CASA) => call(quien, '/api/attendance/checkin/code', { code: abierto.code, device: 'tel-' + quien + '-0001', location }, 200, ip);
// Los primeros cinco (desde datos móviles, sin la red de la escuela) aún no tienen grupo con qué compararse.
const primeros = [];
for (const [k, n] of ['ana', 'beto', 'carla', 'dani', 'eva'].entries()) primeros.push((await registrar(n, enSalon(k))).review);
assert.deepEqual(primeros, [true, true, true, true, true]);
// Con el grupo ya registrado, quien está donde el grupo no queda por revisar…
assert.equal((await registrar('fer', enSalon(6))).review, false);
// …pero quien está lejos del grupo sí (a 6 km, desde su casa).
assert.equal((await registrar('gil', { lat: 19.05, lng: -98.23, accuracy: 15 })).review, true);
// En la red de la escuela y a menos de 1.5 km, una lectura dudosa no se marca.
assert.equal((await registrar('hugo', { lat: salon.lat - 0.004, lng: salon.lng, accuracy: 40 }, ESCUELA)).review, false);
checks += 4;
// Al cerrar, los primeros se revisan contra el grupo: se quita el «por revisar»; el de 6 km se queda.
await call('docente', '/api/attendance/checkin/close', { course: c, session: hoy });
const notas = Object.fromEntries(store.raw().prepare('SELECT member, note FROM aula_attendance WHERE session=?').all(hoy).map((r) => [r.member, r.note]));
for (const n of ['ana', 'beto', 'carla', 'dani', 'eva']) assert.match(notas[id(n)], /Ubicación confirmada con el grupo/, n);
assert.match(notas[id('gil')], /Por revisar: a .* del salón/);
const flags = store.raw().prepare("SELECT count(*) AS n FROM aula_checkins WHERE session=? AND flag<>''").get(hoy).n;
assert.equal(flags, 1);
checks += 7;
// Dentro del margen de imprecisión de los dos teléfonos no se marca (precisión de 400 m, a 350 m).
const otra = (await call('docente', '/api/attendance/session', { course: c, date: '2026-10-06' }, 201)).id;
const abierto2 = await call('docente', '/api/attendance/checkin/open', { course: c, session: otra, mode: 'code', minutes: 10, radius: 100, location: { ...salon, accuracy: 30 } });
const r2 = await call('ana', '/api/attendance/checkin/code', { code: abierto2.code, device: 'tel-ana-0001', location: { lat: salon.lat + 0.00315, lng: salon.lng, accuracy: 400 } }, 200, CASA);
assert.equal(r2.review, false);
checks++;

// ---- Corregir el estado después de pasar lista (misma ruta que la lista) ----
await call('docente', '/api/attendance/mark', { course: c, session: hoy, marks: [{ member: id('gil'), status: 'excused', note: 'Constancia médica' }] });
const gil = store.raw().prepare('SELECT status, note FROM aula_attendance WHERE session=? AND member=?').get(hoy, id('gil'));
assert.deepEqual([gil.status, gil.note], ['excused', 'Constancia médica']);
checks++;

// ---- Importar pase de lista ----
const entries = [
  { date: '2026-09-01', time: '', member: id('ana'), status: 'present' },
  { date: '2026-09-01', time: '', member: id('beto'), status: 'late' },
  { date: '2026-09-03', time: '', member: id('ana'), status: 'absent' },
  { date: '2026-09-03', time: '', member: id('beto'), status: 'excused', note: 'Justificante' },
  { date: '2026-10-05', time: '', member: id('ana'), status: 'late' }, // clase que ya existía
];
await call('ana', '/api/attendance/import', { course: c, entries }, 403);
await call('docente', '/api/attendance/import', { course: c, entries: [{ ...entries[0], status: 'tarde' }] }, 400);
await call('docente', '/api/attendance/import', { course: c, entries: [{ ...entries[0], date: '2026-02-30' }] }, 400);
await call('docente', '/api/attendance/import', { course: c, entries: [{ ...entries[0], member: 'otro' }] }, 400);
// Sin reemplazar: la clase del 5 de octubre ya tenía a Ana presente y se respeta.
let r = await call('docente', '/api/attendance/import', { course: c, entries, overwrite: false });
assert.deepEqual(r, { sessions: 2, marks: 5 });
const lista = await call('docente', '/api/attendance?course=' + c);
const reg = (date, n) => lista.records.find((x) => x.session === lista.sessions.find((s) => s.date === date).id && x.member === id(n));
assert.deepEqual([reg('2026-09-01', 'beto').status, reg('2026-09-03', 'beto').note, reg('2026-10-05', 'ana').status], ['late', 'Justificante', 'present']);
// Reemplazando, se actualiza y no duplica clases.
r = await call('docente', '/api/attendance/import', { course: c, entries });
assert.equal(r.sessions, 0);
assert.equal((await call('docente', '/api/attendance?course=' + c)).records.find((x) => x.member === id('ana') && x.session === hoy).status, 'late');
checks += 4;

// ---- Importar calificaciones ----
const tarea = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Reporte práctica 0', visible: true } }, 201);
await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: tarea.id, body: 'Mi reporte' } }, 201);
// Beto ya tenía un 5 capturado.
await call('docente', '/api/grade', { course: c, task: tarea.id, member: id('beto'), grade: 5, publish: true });
const imp = (data, status = 200) => call('docente', '/api/grades/import', { course: c, ...data }, status);
await call('ana', '/api/grades/import', { course: c, activities: [] }, 403);
await imp({ activities: [{ task: tarea.id, grades: [{ member: id('ana'), grade: 11 }] }] }, 400);
await imp({ activities: [{ task: 'no-existe', grades: [] }] }, 404);
r = await imp({
  overwrite: false,
  activities: [
    { task: tarea.id, grades: [{ member: id('ana'), grade: 7 }, { member: id('beto'), grade: 9 }] },
    { title: 'Reporte práctica 1', grades: [{ member: id('ana'), grade: 10 }, { member: id('carla'), grade: 8.5 }] },
  ],
});
assert.deepEqual(r, { created: 1, grades: 4 });
let curso = await call('docente', '/api/course?id=' + c);
const nota = (task, n) => curso.records.find((x) => x.kind === 'submission' && x.data.task === task && x.data.member === id(n));
const nueva = curso.records.find((x) => x.kind === 'task' && x.data.title === 'Reporte práctica 1');
// Ana conserva su entrega y ahora tiene 7; a Beto no se le reemplazó su 5.
assert.deepEqual([nota(tarea.id, 'ana').data.grade, nota(tarea.id, 'ana').data.body, nota(tarea.id, 'beto').data.grade], [7, 'Mi reporte', 5]);
assert.deepEqual([nota(nueva.id, 'ana').data.grade, nota(nueva.id, 'carla').data.grade], [10, 8.5]);
// Con reemplazo y sin publicar: Beto pasa a 9 en borrador (su alumno no la ve) y queda en el historial.
await imp({ publish: false, activities: [{ task: tarea.id, grades: [{ member: id('beto'), grade: 9 }] }] });
curso = await call('docente', '/api/course?id=' + c);
assert.deepEqual([nota(tarea.id, 'beto').data.grade, nota(tarea.id, 'beto').data.published], [9, false]);
const deBeto = (await call('beto', '/api/course?id=' + c)).records.find((x) => x.kind === 'submission' && x.data.task === tarea.id);
assert.notEqual(deBeto?.data.grade, 9);
const historial = store.raw().prepare("SELECT old_grade, new_grade FROM aula_grade_history WHERE reason='importación' AND member=?").all(id('beto'));
assert.deepEqual(historial.map((h) => [h.old_grade, h.new_grade]), [[5, 9]]);
// La actividad de participación de un foro no recibe calificaciones importadas.
const foro = await call('docente', '/api/record', { course: c, kind: 'forum', data: { title: 'Debate', body: '', visible: true } }, 201);
const part = await call('docente', '/api/forum/grading', { course: c, forum: foro.id }, 201);
await imp({ activities: [{ task: part.task, grades: [{ member: id('ana'), grade: 8 }] }] }, 404);
checks += 6;

// ---- Navegador: interpretar archivos ----
const ctx = vm.createContext({ console, TextEncoder, TextDecoder, Blob, Response, DecompressionStream, structuredClone, URL });
for (const file of ['reactivos.js', 'zip.js', 'oficina.js', 'd2l.js', 'importar.js', 'importaciones.js']) {
  vm.runInContext(readFileSync('src/public/' + file, 'utf8').replace(/\ndocument\.addEventListener\([\s\S]*$/, ''), ctx);
}
const g = (name) => vm.runInContext(name, ctx);
const estudiantes = [
  { id: 'm1', name: 'Federico Aguilar Becerra', matricula: '202612345', email: 'federico.aguilar@alumno.buap.mx', role: 'student' },
  { id: 'm2', name: 'Juan David Agustini Cruz', matricula: '202600001', email: 'juan.agustini@alumno.buap.mx', role: 'student' },
  { id: 'm3', name: 'René Álvarez de la Cuadra Farías', matricula: '', email: 'rene@alumno.buap.mx', role: 'student' },
];
const plano = (x) => JSON.parse(JSON.stringify(x));
// Pase de lista: la exportación de Enlace y fechas en formato mexicano.
const asistencia = plano(
  g('parseAttendanceImport')(
    [
      ['Matrícula', 'Alumno', '2026-09-01 07:00', '03/09/2026', '5/9/26', 'Asistencias', 'Porcentaje'],
      ['202612345', 'Federico Aguilar Becerra', 'P', 'R', 'Justificada', '1', '100'],
      ['', 'Agustini Cruz, Juan David', 'F', 'p', '', '0', '0'],
      ['999', 'Alguien Más', 'P', 'P', 'P', '', ''],
      ['', 'Álvarez de la Cuadra Farías, René', '?', 'n/a', '1', '', ''],
    ],
    estudiantes,
  ),
);
assert.equal(asistencia.dates, 3);
assert.deepEqual(asistencia.entries.map((e) => [e.member, e.date, e.time, e.status]), [
  ['m1', '2026-09-01', '07:00', 'present'],
  ['m1', '2026-09-03', '', 'late'],
  ['m1', '2026-09-05', '', 'excused'],
  ['m2', '2026-09-01', '07:00', 'absent'],
  ['m2', '2026-09-03', '', 'present'],
  ['m3', '2026-09-05', '', 'present'],
]);
assert.deepEqual([asistencia.unmatched, asistencia.unknown], [['Alguien Más · 999'], ['?']]);
checks += 3;
// Calificaciones: exportación de Brightspace (usuario, apellidos, nombre, puntos máximos en el encabezado).
const libro = plano(
  g('parseGradesImport')(
    [
      ['OrgDefinedId', 'Username', 'Last Name', 'First Name', 'Email', 'Reporte practica 0 Puntos Calificación <Numérico Máx. Puntos:10 Peso:5>', 'Examen 1 Puntos Calificación <Numérico Máx. Puntos:40>', 'Calificación final calculada Numerador', 'End-of-Line Indicator'],
      ['#202612345', '#federico.aguilar', 'Aguilar Becerra', 'Federico', '', '7', '30', '22', '#'],
      ['', '#juan.agustini', 'Agustini Cruz', 'Juan David', '', '9 / 10, 90 %', '', '38', '#'],
    ],
    estudiantes,
    [{ id: 't0', data: { title: 'Reporte práctica 0' } }],
  ),
);
assert.deepEqual(libro.columns.map((x) => [x.title, x.task, x.max, x.cells.length]), [
  ['Reporte practica 0', 't0', 10, 2],
  ['Examen 1', '', 40, 1],
]);
assert.deepEqual(libro.columns[0].cells.map((x) => [x.member.id, x.cell.value, x.cell.max ?? null]), [['m1', 7, null], ['m2', 9, 10]]);
// Se reconoce por título aunque cambien los acentos.
const conAcentos = plano(g('parseGradesImport')([['Alumno', 'Reporte práctica 0'], ['Federico Aguilar Becerra', '8']], estudiantes, [{ id: 't0', data: { title: 'Reporte practica 0' } }]));
assert.equal(conAcentos.columns[0].task, 't0');
// La exportación de Enlace: columnas de promedio, final y categorías se ignoran.
const deEnlace = plano(g('parseGradesImport')([['Matrícula', 'Alumno', 'Promedio parcial', 'Calificación final', 'Tareas (40 %)', 'Tarea 1', 'Tarea 2'], ['202600001', 'x', '8', '8', '8', 'n/a', '9.5']], estudiantes, []));
assert.deepEqual(deEnlace.columns.map((x) => x.title), ['Tarea 2']);
checks += 3;
assert.throws(() => g('parseGradesImport')([['Nada', 'Otra'], ['1', '2']], estudiantes, []), /columna de los alumnos/);
checks++;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones de la 12.24 — ubicación con margen, grupo y red; corregir estados; importar pase de lista y calificaciones (formato de Brightspace y de Enlace).`);
