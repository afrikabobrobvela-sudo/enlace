// Pruebas de secciones (12.18): un solo curso para 5AV, 5BV y 5CV con el mismo contenido; alumnos por sección
// (a mano, al importar la lista o traídos de otro curso), fechas de actividades y exámenes por sección (con la
// prórroga individual encima), asistencia por sección y examen activo con el cierre de su sección.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
let checks = 0;
const cookies = {};
async function call(who, path, data, status = 200) {
  cookies[who] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who }), env);
  const before = store.counter.queries;
  const res = await api(
    new Request('https://t.local' + path, {
      method: data === undefined ? 'GET' : 'POST',
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
const min = 60_000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '5.º semestre' }, 201)).id;
const course = () => call('docente', '/api/course?id=' + c);

// ---- Secciones: crear, sin repetir (ni por mayúsculas o acentos), renombrar ----
await call('ana', '/api/sections', { course: c, name: '5AV' }, 403);
const av = (await call('docente', '/api/sections', { course: c, name: '5AV' }, 201)).id;
await call('docente', '/api/sections', { course: c, name: ' 5av ' }, 409);
const bvTemp = (await call('docente', '/api/sections', { course: c, name: '5B' }, 201)).id;
await call('docente', '/api/sections/update', { course: c, id: bvTemp, name: '5AV' }, 409);
await call('docente', '/api/sections/update', { course: c, id: bvTemp, name: '5BV' });
const bv = bvTemp;
checks++;

// ---- Alumnos: lista con columna de sección (crea 5CV), uno a mano y reasignar ----
const lista = [
  { name: 'Ana', email: 'ana@example.test', section: '5av' },
  { name: 'Beto', email: 'beto@example.test', section: '5BV' },
  { name: 'Carla', email: 'carla@example.test', section: '5CV' },
  { name: 'Dani', email: 'dani@example.test' },
];
await call('docente', '/api/members/bulk', { course: c, students: lista });
let data = await course();
const cv = data.sections.find((s) => s.name === '5CV').id;
assert.deepEqual(data.sections.map((s) => s.name), ['5AV', '5BV', '5CV']);
const member = (email) => data.members.find((m) => m.email === email);
assert.deepEqual(['ana', 'beto', 'carla', 'dani'].map((n) => member(n + '@example.test').section), [av, bv, cv, '']);
// Volver a importar sin columna no borra la sección; con `sectionId`, todos a esa sección.
await call('docente', '/api/members/bulk', { course: c, students: [{ name: 'Ana', email: 'ana@example.test' }] });
await call('docente', '/api/member', { course: c, name: 'Eva', email: 'eva@example.test', section: bv });
await call('docente', '/api/member', { course: c, name: 'Eva', email: 'eva@example.test', section: 'otra' }, 404);
await call('docente', '/api/sections/assign', { course: c, section: cv, members: [member('dani@example.test').id] });
data = await course();
assert.deepEqual(['ana', 'dani', 'eva'].map((n) => member(n + '@example.test').section), [av, cv, bv]);
checks += 3;
// El alumno ve las secciones y la suya (no las de otros datos personales).
const deAna = await call('ana', '/api/course?id=' + c);
assert.equal(deAna.sections.length, 3);
assert.equal(deAna.members.find((m) => m.user_id).section, av);
assert(!('sectionDates' in deAna));
checks += 2;

// ---- Actividad con fechas por sección ----
const tarea = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Práctica 1', visible: true, due: iso(-2 * 60 * min), end: iso(-60 * min) } }, 201);
await call('docente', '/api/sections/dates', { course: c, kind: 'task', item: tarea.id, dates: [{ section: 'x', due: iso(min) }] }, 400);
await call('docente', '/api/sections/dates', { course: c, kind: 'task', item: tarea.id, dates: [{ section: bv, startAt: iso(60 * min), endAt: iso(30 * min) }] }, 400);
await call('beto', '/api/sections/dates', { course: c, kind: 'task', item: tarea.id, dates: [] }, 403);
// 5BV entrega mañana; 5AV y los demás, con la fecha general (ya cerró).
const manana = iso(24 * 60 * min);
const cierre = iso(26 * 60 * min);
await call('docente', '/api/sections/dates', { course: c, kind: 'task', item: tarea.id, dates: [{ section: bv, due: manana, endAt: cierre }, { section: cv, due: '' }] });
assert.equal((await course()).sectionDates.length, 1, 'La sección sin fechas no guarda nada');
const tareaDe = async (who) => (await call(who, '/api/course?id=' + c)).records.find((r) => r.id === tarea.id).data;
assert.equal((await tareaDe('beto')).due, manana);
assert.equal((await tareaDe('ana')).due, tarea.data.due);
await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: tarea.id, body: 'tarde' } }, 403);
const entrega = await call('beto', '/api/record', { course: c, kind: 'submission', data: { task: tarea.id, body: 'a tiempo' } }, 201);
assert.equal(entrega.data.late, false);
// Pendientes y calendario con la fecha de su sección.
const dash = await call('eva', '/api/dashboard');
assert.equal(dash.pending.find((p) => p.id === tarea.id)?.due, manana);
const cal = await call('eva', `/api/calendar?from=${encodeURIComponent(iso(-5 * 60 * min))}&to=${encodeURIComponent(iso(48 * 60 * min))}`);
assert.equal(cal.events.find((e) => e.id === tarea.id)?.at, manana);
// La prórroga individual manda sobre la de la sección.
const pasado = iso(3 * 24 * 60 * min);
await call('docente', '/api/extension', { course: c, task: tarea.id, member: member('eva@example.test').id, due: pasado });
assert.equal((await tareaDe('eva')).due, pasado);
checks += 7;

// ---- Examen con horario por sección ----
const examen = await call(
  'docente',
  '/api/record',
  {
    course: c,
    kind: 'quiz',
    data: {
      title: 'Parcial 1',
      visible: true,
      questions: [{ type: 'choice', text: 'Unidad de fuerza', options: ['J', 'N'], correct: 1 }],
      settings: { attempts: 1, timeLimit: 0, opensAt: iso(5 * 24 * 60 * min), exam: { enabled: true, lockPlatform: true } },
    },
  },
  201,
);
// 5AV: ahora y hasta dentro de una hora; 5BV: mañana.
await call('docente', '/api/sections/dates', { course: c, kind: 'quiz', item: examen.id, dates: [{ section: av, startAt: iso(-min), endAt: iso(60 * min) }, { section: bv, startAt: manana, endAt: cierre }] });
const ajustes = async (who) => (await call(who, '/api/course?id=' + c)).records.find((r) => r.id === examen.id).data.settings;
assert.equal((await ajustes('beto')).opensAt, manana, 'El alumno ve el horario de su sección');
assert.equal((await ajustes('carla')).opensAt, examen.data.settings.opensAt, 'Sin fechas de su sección, las generales');
assert.match((await call('beto', '/api/attempt/start', { course: c, quiz: examen.id }, 403)).error, /se abre/);
await call('carla', '/api/attempt/start', { course: c, quiz: examen.id }, 403);
const inicio = await call('ana', '/api/attempt/start', { course: c, quiz: examen.id });
assert(Math.abs(Date.parse(inicio.deadline) - Date.parse(iso(60 * min))) < 5000, 'El cierre de su sección corta el intento');
assert.deepEqual((await call('ana', '/api/me')).activeExam, { quiz: examen.id, course: c });
const monitor = await call('docente', `/api/exam/monitor?course=${c}&quiz=${examen.id}`);
assert.deepEqual([monitor.running[0].section, Boolean(monitor.running[0].deadline)], [av, true]);
// Si el docente adelanta el cierre de 5AV, el examen deja de estar activo (ya no bloquea la plataforma).
await call('docente', '/api/sections/dates', { course: c, kind: 'quiz', item: examen.id, dates: [{ section: av, startAt: iso(-10 * min), endAt: iso(-5 * min) }] });
assert.equal((await call('ana', '/api/me')).activeExam, null);
checks += 7;

// ---- Asistencia por sección ----
const hoy = new Date().toISOString().slice(0, 10);
const sesionAV = (await call('docente', '/api/attendance/session', { course: c, date: hoy, start_time: '07:00', section: av }, 201)).id;
// La otra sección puede tener clase a la misma hora; la misma sección, no.
await call('docente', '/api/attendance/session', { course: c, date: hoy, start_time: '07:00', section: bv }, 201);
await call('docente', '/api/attendance/session', { course: c, date: hoy, start_time: '07:00', section: av }, 409);
await call('docente', '/api/attendance/session', { course: c, date: hoy, start_time: '07:00' }, 201); // de todo el curso
const generadas = await call('docente', '/api/attendance/generate', { course: c, from: hoy, to: hoy, weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: '09:00', section: cv }, 201);
assert.equal(generadas.created, 1);
const deBeto = await call('beto', '/api/attendance?course=' + c);
assert.deepEqual(deBeto.sessions.map((s) => s.section).sort(), ['', bv], 'Beto ve las de su sección y las de todo el curso');
assert.equal((await call('docente', '/api/attendance?course=' + c)).sessions.length, 4);
await call('docente', '/api/attendance/mark', { course: c, session: sesionAV, marks: [{ member: member('beto@example.test').id, status: 'present' }] }, 400);
await call('docente', '/api/attendance/mark', { course: c, session: sesionAV, marks: [{ member: member('ana@example.test').id, status: 'present' }] });
const abierto = await call('docente', '/api/attendance/checkin/open', { course: c, session: sesionAV, mode: 'code', minutes: 5 });
assert.match((await call('beto', '/api/attendance/checkin/code', { code: abierto.code, device: 'tel-beto-0001' }, 403)).error, /otra sección/);
checks += 3;

// ---- Eliminar secciones: solo vacías y sin clases ----
await call('docente', '/api/sections/delete', { course: c, id: bv }, 409);
const vacia = (await call('docente', '/api/sections', { course: c, name: '5DV' }, 201)).id;
await call('docente', '/api/sections/dates', { course: c, kind: 'task', item: tarea.id, dates: [{ section: bv, due: manana, endAt: cierre }, { section: vacia, due: manana }] });
await call('docente', '/api/sections/delete', { course: c, id: vacia });
assert(!(await course()).sectionDates.some((d) => d.section === vacia), 'Sus fechas se van con ella');
checks++;

// ---- Juntar un grupo que se había creado aparte: sus alumnos llegan como sección ----
const aparte = (await call('docente', '/api/courses', { name: 'Física I', group: '5EV' }, 201)).id;
await call('docente', '/api/members/bulk', { course: aparte, students: [{ name: 'Fer', email: 'fer@example.test' }, { name: 'Gus', email: 'gus@example.test' }] });
await call('ana', '/api/sections/import', { course: c, from: aparte }, 403);
const traidos = await call('docente', '/api/sections/import', { course: c, from: aparte }, 201);
assert.equal(traidos.imported, 2);
data = await course();
assert.equal(data.sections.find((s) => s.id === traidos.section).name, '5EV');
assert.equal(member('fer@example.test').section, traidos.section);
// En el curso original siguen igual (sus entregas y calificaciones no se mueven).
assert.equal((await call('docente', '/api/course?id=' + aparte)).members.filter((m) => m.role === 'student').length, 2);
checks += 2;

// ---- Copiar a un nuevo periodo: se copian los nombres de las secciones, sin alumnos ni fechas ----
const copia = (await call('docente', '/api/course/copy', { course: c, name: 'Física I', group: '5.º semestre', period: '2027-1' }, 201)).id;
const nuevo = await call('docente', '/api/course?id=' + copia);
assert.deepEqual(nuevo.sections.map((s) => s.name), ['5AV', '5BV', '5CV', '5EV']);
assert.deepEqual([nuevo.sectionDates.length, nuevo.members.filter((m) => m.role === 'student').length], [0, 0]);
checks++;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones de secciones — un curso para varios grupos, alumnos por sección (lista, a mano o de otro curso), fechas de actividades y exámenes por sección con prórroga encima, asistencia por sección y copia a otro periodo.`);
