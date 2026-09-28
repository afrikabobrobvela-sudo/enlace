// Pruebas del calendario y de los avisos (12.13): el calendario junta actividades y clases de todos los cursos
// activos, con la fecha de cada alumno (prórrogas), su estado de entrega y sin lo oculto ni lo eliminado; quien enseña
// ve también lo oculto y lo que falta calificar. Los avisos se marcan como leídos uno por uno o todos, vuelven a ser
// nuevos si el elemento cambia, y hay historial de 60 días. El archivo .ics respeta RFC 5545.
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
async function call(who, path, data, status = 200, method) {
  cookies[who] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who }), env);
  const before = store.counter.queries;
  const res = await api(
    new Request('https://t.local' + path, {
      method: method || (data === undefined ? 'GET' : 'POST'),
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
const DAY = 86_400_000;
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();
const day = (n) => inDays(n).slice(0, 10);
const range = (a = -10, b = 20) => `/api/calendar?from=${encodeURIComponent(inDays(a))}&to=${encodeURIComponent(inDays(b))}`;

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '501' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: ['ana', 'beto'].map((n) => ({ name: n, email: n + '@example.test' })) });
for (const who of ['ana', 'beto']) await call(who, '/api/me');
const members = Object.fromEntries((await call('docente', '/api/course?id=' + c)).members.map((m) => [m.name, m.id]));
const task = (title, extra = {}) => call('docente', '/api/record', { course: c, kind: 'task', data: { title, body: '', visible: true, submissionMode: 'text', ...extra } }, 201);
const t1 = await task('Tarea próxima', { due: inDays(3) });
const t2 = await task('Oculta', { due: inDays(5), visible: false });
const t3 = await task('Eliminada', { due: inDays(4) });
const t4 = await task('Aún no abre', { due: inDays(8), start: inDays(6) });
const t5 = await task('Vencida', { due: inDays(-2) });
const t6 = await task('Fuera del rango', { due: inDays(40) });
await call('docente', '/api/record', { course: c, kind: 'task', id: t3.id }, 200, 'DELETE');
await call('docente', '/api/extension', { course: c, task: t1.id, member: members.ana, due: inDays(6), reason: 'Médica' });
await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: t5.id, body: 'Tarde' } }, 201);
const sesion = await call('docente', '/api/attendance/session', { course: c, date: day(1), start_time: '07:00', topic: 'Leyes de Newton' }, 201);
await call('docente', '/api/attendance/mark', { course: c, session: sesion.id, marks: [{ member: members.ana, status: 'late' }] });
// Otro curso archivado y otro del que no es alumna: no aparecen.
const archivado = (await call('docente', '/api/courses', { name: 'Archivado', group: 'X' }, 201)).id;
await call('docente', '/api/members/bulk', { course: archivado, students: [{ name: 'ana', email: 'ana@example.test' }] });
await call('docente', '/api/record', { course: archivado, kind: 'task', data: { title: 'De archivado', body: '', visible: true, submissionMode: 'text', due: inDays(2) } }, 201);
await call('docente', '/api/course/archive', { course: archivado });

// ---- Alumna ----
let cal = await call('ana', range());
const byTitle = (t) => cal.events.find((e) => e.title === t);
assert.deepEqual(cal.events.filter((e) => e.type === 'task').map((e) => e.title).sort(), ['Tarea próxima', 'Vencida']);
assert.equal(byTitle('Tarea próxima').at, inDays(6).slice(0, 10) + byTitle('Tarea próxima').at.slice(10), 'Con la fecha de su prórroga');
assert.equal(byTitle('Tarea próxima').extended, true);
assert.equal(byTitle('Tarea próxima').status, 'pending');
assert.equal(byTitle('Vencida').status, 'submitted');
const clase = cal.events.find((e) => e.type === 'session');
assert.deepEqual([clase.title, clase.date, clase.time, clase.attendance, clase.role], ['Leyes de Newton', day(1), '07:00', 'late', 'student']);
assert.deepEqual(cal.courses.map((x) => x.name), ['Física I']);
assert(!JSON.stringify(cal).includes('Oculta') && !JSON.stringify(cal).includes('Eliminada') && !JSON.stringify(cal).includes('Aún no abre'));
checks += 8;

// Beto: sin prórroga; la vencida sin entregar; la calificada (publicada) aparece como calificada.
cal = await call('beto', range());
assert.equal(byTitle('Tarea próxima').extended, false);
assert.equal(byTitle('Vencida').status, 'missing');
assert.equal(cal.events.find((e) => e.type === 'session').attendance, null);
await call('beto', '/api/record', { course: c, kind: 'submission', data: { task: t1.id, body: 'Lista' } }, 201);
let subs = (await call('docente', '/api/course?id=' + c)).records.filter((r) => r.kind === 'submission');
const deBeto = subs.find((s) => s.data.member === members.beto);
await call('docente', '/api/grade', { course: c, task: t1.id, member: members.beto, revision: deBeto.revision, grade: 8, feedback: '', publish: false });
cal = await call('beto', range());
assert.equal(byTitle('Tarea próxima').status, 'submitted', 'Un borrador no se ve como calificado');
await call('docente', '/api/grades/publish', { course: c, task: t1.id });
cal = await call('beto', range());
assert.equal(byTitle('Tarea próxima').status, 'graded');
checks += 5;

// ---- Docente: todo lo de sus cursos activos, con lo oculto marcado y lo que falta calificar ----
cal = await call('docente', range());
const tareas = cal.events.filter((e) => e.type === 'task');
assert.deepEqual(tareas.map((e) => e.title).sort(), ['Aún no abre', 'Oculta', 'Tarea próxima', 'Vencida']);
assert.equal(tareas.find((e) => e.title === 'Oculta').hidden, true);
assert.equal(tareas.find((e) => e.title === 'Vencida').toGrade, 1);
assert.equal(tareas.find((e) => e.title === 'Tarea próxima').submitted, 1);
assert.equal(cal.events.find((e) => e.type === 'session').role, 'teacher');
assert(!tareas.some((e) => e.title === 'De archivado'));
// Un periodo más largo alcanza la del día 40.
assert((await call('docente', range(30, 50))).events.some((e) => e.id === t6.id));
checks += 6;

// ---- Validación ----
await call('ana', '/api/calendar?from=x&to=y', undefined, 400);
await call('ana', range(0, 150), undefined, 400);
await call('ana', range(5, 1), undefined, 400);
assert(t2 && t4);

// ---- Avisos: uno por uno, todos, y de nuevo si cambian ----
const aviso = await call('docente', '/api/record', { course: c, kind: 'notice', data: { title: 'Cambio de salón', body: 'Lab 3', visible: true } }, 201);
let feed = await call('ana', '/api/notifications');
const unread0 = feed.unread;
assert(unread0 >= 3);
const item = feed.items.find((i) => i.title === 'Cambio de salón');
assert(item.fresh && item.key.startsWith('notice:' + aviso.id + ':'));
await call('ana', '/api/notifications/read', { items: [item.key] });
feed = await call('ana', '/api/notifications');
assert.equal(feed.unread, unread0 - 1);
assert.equal(feed.items.find((i) => i.id === aviso.id).fresh, false);
// Solo afecta a quien lo leyó.
assert.equal((await call('beto', '/api/notifications')).items.find((i) => i.id === aviso.id).fresh, true);
// Si el docente lo edita, vuelve a ser nuevo.
await call('docente', '/api/record', { course: c, kind: 'notice', id: aviso.id, revision: aviso.revision, data: { title: 'Cambio de salón', body: 'Lab 4', visible: true } });
feed = await call('ana', '/api/notifications');
assert.equal(feed.items.find((i) => i.id === aviso.id).fresh, true);
// Marcar todo: cero sin leer y se vacían las marcas individuales.
await call('ana', '/api/notifications/seen', {});
feed = await call('ana', '/api/notifications');
assert.equal(feed.unread, 0);
assert.equal(store.raw().prepare("SELECT count(*) AS n FROM aula_notice_reads WHERE user_id=(SELECT id FROM aula_users WHERE email='ana@example.test')").get().n, 0);
await call('ana', '/api/notifications/read', { items: Array.from({ length: 51 }, (_, i) => 'k' + i) }, 400);
await call('ana', '/api/notifications/read', { items: [] }, 400);
checks += 8;

// ---- Historial: 60 días ----
store.raw().prepare("UPDATE aula_records SET updated=? WHERE id=?").run(inDays(-30), aviso.id);
assert(!(await call('ana', '/api/notifications')).items.some((i) => i.id === aviso.id), 'Fuera de los 14 días');
const historial = await call('ana', '/api/notifications?days=60');
assert.equal(historial.days, 60);
assert(historial.items.some((i) => i.id === aviso.id));
checks += 3;

// ---- Archivo .ics (código de la pantalla) ----
const context = vm.createContext({ document: { addEventListener() {} }, TextEncoder, URL, Blob, Date, esc: (s) => String(s), openItemAttrs: () => '' });
vm.runInContext(readFileSync('src/public/calendario.js', 'utf8'), context);
vm.runInContext(`calState.data = { courses: [{ id: 'c1', name: 'Física I', group_name: '501' }] }`, context);
const ics = vm.runInContext(
  `calendarIcs([
    { type: 'task', role: 'student', id: 't1', course: 'c1', title: 'Tarea; con, comas y\\nsalto', at: '2026-10-05T23:00:00.000Z', status: 'pending' },
    { type: 'session', role: 'student', id: 's1', course: 'c1', title: 'Leyes de Newton: ${'á'.repeat(60)}', date: '2026-10-06', time: '07:00', attendance: null },
  ], new Date('2026-09-28T12:00:00Z'))`,
  context,
);
assert(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
assert(!/[^\r]\n/.test(ics), 'Solo saltos CRLF');
assert(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75), 'Líneas de 75 octetos como máximo');
const unfolded = ics.replace(/\r\n /g, '');
assert(unfolded.includes('SUMMARY:Entrega: Tarea\\; con\\, comas y\\nsalto'));
assert(unfolded.includes('DTSTART:20261005T223000Z') && unfolded.includes('DTEND:20261005T230000Z'));
assert(unfolded.includes('DTSTART:20261006T070000') && unfolded.includes('DTEND:20261006T080000'));
assert(unfolded.includes(`SUMMARY:Clase: Leyes de Newton: ${'á'.repeat(60)}`), 'Se dobla sin partir letras');
assert.equal((unfolded.match(/BEGIN:VEVENT/g) || []).length, 2);
checks += 8;

console.log(`PASS: ${checks} verificaciones de calendario y avisos — fechas por alumno con prórroga, estado de entrega, sin lo oculto ni archivado, vista del docente, avisos leídos uno por uno o todos, historial de 60 días y archivo .ics.`);
