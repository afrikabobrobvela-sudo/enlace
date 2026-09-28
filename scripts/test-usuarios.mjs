// Pruebas del directorio de usuarios (12.12): búsqueda y ficha solo para la administración, suspender y reactivar
// accesos, transferir cursos, registro de acciones y la vista de un alumno concreto, que debe ser idéntica a lo que
// ese alumno recibe al entrar (y nunca permitir escribir ni ver a otros).
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
let checks = 0;
const cookies = {};
const login = async (who) => sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who[0].toUpperCase() + who.slice(1) }), env);
async function call(who, path, data, status = 200, method) {
  cookies[who] ??= await login(who);
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
const idOf = (who) => store.raw().prepare('SELECT id FROM aula_users WHERE email=?').get(who + '@example.test').id;

await call('admin', '/api/me');
for (const t of ['docente', 'docente2']) await call('admin', '/api/teachers', { email: t + '@example.test', name: t === 'docente' ? 'Docente Uno' : 'Docente Dos', role: 'teacher' });
for (const who of ['docente', 'docente2', 'ana', 'beto', 'carla']) await call(who, '/api/me');

// ---- Un curso con de todo para Ana y Beto ----
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '501' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: ['ana', 'beto'].map((n) => ({ name: n, email: n + '@example.test' })) });
const course = await call('docente', '/api/course?id=' + c);
const member = Object.fromEntries(course.members.map((m) => [m.email.split('@')[0], m.id]));
const task = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Tarea 1', body: '', visible: true, submissionMode: 'text' } }, 201);
const oculta = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Oculta', body: '', visible: false, submissionMode: 'text' } }, 201);
await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: task.id, body: 'Mi respuesta' } }, 201);
await call('beto', '/api/record', { course: c, kind: 'submission', data: { task: task.id, body: 'La de Beto' } }, 201);
let subs = (await call('docente', '/api/course?id=' + c)).records.filter((r) => r.kind === 'submission');
const subOf = (m) => subs.find((s) => s.data.member === member[m]);
await call('docente', '/api/grade', { course: c, task: task.id, member: member.ana, revision: subOf('ana').revision, grade: 9, feedback: 'Muy bien' });
await call('docente', '/api/grade', { course: c, task: task.id, member: member.beto, revision: subOf('beto').revision, grade: 5, feedback: 'Borrador', publish: false });
await call('docente', '/api/extension', { course: c, task: task.id, member: member.ana, due: '2030-01-01T00:00:00.000Z', end: '2030-01-02T00:00:00.000Z', reason: 'Médica' });
const quiz = await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Q', visible: true, questions: [{ type: 'choice', text: '¿1+1?', options: ['2', '3'], correct: 0 }] } }, 201);
await call('ana', '/api/attempt', { course: c, quiz: quiz.id, answers: { 0: 0 } }, 201);
const sesion = await call('docente', '/api/attendance/session', { course: c, date: '2026-09-01', start_time: '07:00', topic: 'Intro' }, 201);
await call('docente', '/api/attendance/mark', { course: c, session: sesion.id, marks: [{ member: member.ana, status: 'late' }, { member: member.beto, status: 'absent' }] });

// ---- La vista de Ana es idéntica a lo que Ana recibe ----
const strip = ({ canTeach, canPreview, preview, viewing, canDelete, ...rest }) => rest;
const sortRecords = (r) => ({ ...r, records: [...r.records].sort((a, b) => (a.id < b.id ? -1 : 1)) });
const propia = await call('ana', '/api/course?id=' + c);
const vista = await call('docente', `/api/course?id=${c}&as=m:${member.ana}`);
assert.deepEqual(sortRecords(strip(vista)), sortRecords(strip(propia)), 'La vista de Ana coincide con lo que ve Ana');
assert.deepEqual(vista.viewing, { id: member.ana, name: 'ana', user_id: idOf('ana'), key: idOf('ana') });
assert.equal(vista.canTeach, false);
assert.equal(vista.preview, true);
// Lo esencial, por si acaso: su entrega calificada, su prórroga, su intento; nada de Beto ni lo oculto.
assert(vista.records.some((r) => r.kind === 'submission' && r.data.grade === 9));
assert(vista.records.some((r) => r.kind === 'task' && r.data.extended));
assert(vista.records.some((r) => r.kind === 'attempt'));
assert(!JSON.stringify(vista).includes('La de Beto') && !vista.records.some((r) => r.id === oculta.id));
assert(!JSON.stringify(vista).includes('beto@example.test'));
// Beto: su borrador no publicado no aparece como calificación.
const vistaBeto = await call('docente', `/api/course?id=${c}&as=m:${member.beto}`);
assert.equal(vistaBeto.records.find((r) => r.kind === 'submission').data.grade, null);
assert.deepEqual(sortRecords(strip(vistaBeto)), sortRecords(strip(await call('beto', '/api/course?id=' + c))));
// Asistencia: igual a la suya.
const asisVista = await call('docente', `/api/attendance?course=${c}&as=m:${member.ana}`);
const asisPropia = await call('ana', `/api/attendance?course=${c}`);
assert.deepEqual({ ...asisVista, canTeach: null }, { ...asisPropia, canTeach: null });
assert.deepEqual(asisVista.records.map((r) => r.status), ['late']);
checks += 12;

// ---- Quién puede usarla ----
// Un alumno no puede ver a otro: el parámetro se ignora y recibe lo suyo.
const truco = await call('ana', `/api/course?id=${c}&as=m:${member.beto}`);
assert.equal(truco.viewing, null);
assert(!JSON.stringify(truco).includes('La de Beto'));
// Otro docente, sin acceso al curso.
await call('docente2', `/api/course?id=${c}&as=m:${member.ana}`, undefined, 403);
// Una inscripción que no es de alumno, o de otro curso.
await call('docente', `/api/course?id=${c}&as=m:no-existe`, undefined, 404);
const otro = (await call('docente2', '/api/courses', { name: 'Otro', group: 'X' }, 201)).id;
await call('docente2', '/api/members/bulk', { course: otro, students: [{ name: 'Carla', email: 'carla@example.test' }] });
const carla = (await call('docente2', '/api/course?id=' + otro)).members[0].id;
await call('docente', `/api/course?id=${c}&as=m:${carla}`, undefined, 404);
// La administración sí puede (enseña en todos los cursos).
assert.equal((await call('admin', `/api/course?id=${c}&as=m:${member.ana}`)).viewing.id, member.ana);
checks += 2;

// ---- Registro: una entrada por consulta (no una por cada recarga) ----
let log = (await call('admin', '/api/audit?action=ver_alumno')).log;
const deAna = log.filter((l) => l.target_name === 'Ana');
assert.equal(deAna.length, 2, 'Docente y administración, una vez cada uno');
assert.deepEqual(deAna.map((l) => l.actor_name).sort(), ['Admin', 'Docente Uno']);
assert.equal(deAna[0].course_name, 'Física I');
await call('docente', '/api/audit', undefined, 403);
checks += 3;

// ---- Curso de ejemplo: alumnos sin cuenta ----
const demo = (await call('docente', '/api/demo-course', {}, 201)).id;
const demoCourse = await call('docente', '/api/course?id=' + demo);
const ficticio = demoCourse.members.find((m) => m.name.startsWith('Ana Sofía'));
const vistaFicticia = await call('docente', `/api/course?id=${demo}&as=m:${ficticio.id}`);
assert.equal(vistaFicticia.viewing.key, 'demo:' + ficticio.id);
assert(vistaFicticia.records.filter((r) => r.kind === 'submission').every((s) => s.data.member === ficticio.id));
assert(vistaFicticia.records.some((r) => r.kind === 'submission' && r.data.grade !== null));
assert.equal(vistaFicticia.records.filter((r) => r.kind === 'attempt').length, 1);
const asisFicticia = await call('docente', `/api/attendance?course=${demo}&as=m:${ficticio.id}`);
assert(asisFicticia.records.length >= 10 && asisFicticia.records.every((r) => r.member === ficticio.id));
checks += 5;

// ---- Directorio ----
await call('docente', '/api/users', undefined, 403);
await call('ana', '/api/users/detail?id=' + idOf('beto'), undefined, 403);
let dir = await call('admin', '/api/users');
assert.equal(dir.counts.total, 6);
assert.deepEqual([dir.counts.students, dir.counts.staff, dir.counts.suspended], [3, 3, 0]);
assert.deepEqual((await call('admin', '/api/users?q=bet')).users.map((u) => u.email), ['beto@example.test']);
assert.deepEqual((await call('admin', '/api/users?q=DOCENTE2@')).users.map((u) => u.name), ['Docente Dos']);
assert.deepEqual((await call('admin', '/api/users?role=teacher')).users.map((u) => u.name), ['Docente Dos', 'Docente Uno']);
assert.equal((await call('admin', '/api/users?q=%25')).users.length, 0, 'Los comodines se buscan como texto');
const fichaAna = dir.users.find((u) => u.email === 'ana@example.test');
assert.deepEqual([fichaAna.enrolled, fichaAna.owned, fichaAna.role], [1, 0, 'student']);
// Paginación: 60 alumnos más.
for (let i = 0; i < 60; i++) await completeLogin(env, { provider: 'google', subject: 'p' + i, email: `persona${String(i).padStart(2, '0')}@example.test`, name: `Persona ${String(i).padStart(2, '0')}` });
const pag1 = await call('admin', '/api/users?q=persona');
assert.equal(pag1.users.length, 50);
const pag2 = await call('admin', '/api/users?q=persona&after=' + encodeURIComponent(pag1.next));
assert.equal(pag2.users.length, 10);
assert.equal(pag2.next, null);
assert.equal(new Set([...pag1.users, ...pag2.users].map((u) => u.id)).size, 60);
checks += 11;

// Ficha
let ficha = await call('admin', '/api/users/detail?id=' + idOf('ana'));
assert.equal(ficha.user.email, 'ana@example.test');
assert.deepEqual(ficha.memberships.map((m) => [m.name, m.role]), [['Física I', 'student']]);
assert.equal(ficha.identities[0].provider, 'google');
assert(ficha.sessions >= 1);
assert(ficha.log.some((l) => l.action === 'ver_alumno'));
const fichaDocente = await call('admin', '/api/users/detail?id=' + idOf('docente'));
assert.deepEqual(fichaDocente.owned.map((o) => o.name).sort(), ['Física I', 'Mecánica clásica (curso de ejemplo)']);
await call('admin', '/api/users/detail?id=nadie', undefined, 404);
checks += 6;

// ---- Suspender y reactivar ----
await call('admin', '/api/users/suspend', { user: idOf('admin'), reason: 'x' }, 400);
await call('docente', '/api/users/suspend', { user: idOf('beto'), reason: 'x' }, 403);
await call('admin', '/api/users/suspend', { user: idOf('beto') }, 400); // falta el motivo
await call('admin', '/api/users/suspend', { user: idOf('beto'), reason: 'Baja temporal' });
await call('admin', '/api/users/suspend', { user: idOf('beto'), reason: 'otra vez' }, 409);
// Su sesión abierta deja de servir, y una nueva también se rechaza.
await call('beto', '/api/me', undefined, 401);
assert.equal((await call('admin', '/api/users/detail?id=' + idOf('beto'))).sessions, 0, 'Se cerraron sus sesiones');
const nueva = await completeLogin(env, { provider: 'google', subject: 'g-beto', email: 'beto@example.test', name: 'Beto' });
assert(nueva.suspended_at, 'El inicio de sesión sabe que está suspendido');
cookies.beto = await sessionCookieForTests(nueva, env);
const bloqueado = await call('beto', '/api/me', undefined, 403);
assert.match(bloqueado.error, /suspendido/);
// Sus datos siguen intactos para el docente.
subs = (await call('docente', '/api/course?id=' + c)).records.filter((r) => r.kind === 'submission');
assert.equal(subOf('beto').data.body, 'La de Beto');
dir = await call('admin', '/api/users?status=suspended');
assert.deepEqual(dir.users.map((u) => u.email), ['beto@example.test']);
ficha = await call('admin', '/api/users/detail?id=' + idOf('beto'));
assert.deepEqual([ficha.user.suspended_reason, ficha.user.suspended_by], ['Baja temporal', 'Admin']);
await call('admin', '/api/users/reactivate', { user: idOf('beto'), note: 'Regresó' });
await call('admin', '/api/users/reactivate', { user: idOf('beto') }, 409);
cookies.beto = await login('beto');
await call('beto', '/api/me');
log = (await call('admin', '/api/users/detail?id=' + idOf('beto'))).log.map((l) => l.action);
assert(log.includes('suspender') && log.includes('reactivar'));
checks += 7;

// ---- Transferir un curso ----
await call('docente', '/api/course/transfer', { course: c, confirm: 'Física I', email: 'docente2@example.test' }, 403);
await call('admin', '/api/course/transfer', { course: c, confirm: 'Otro nombre', email: 'docente2@example.test' }, 400);
await call('admin', '/api/course/transfer', { course: c, confirm: 'Física I', email: 'ana@example.test' }, 400);
await call('admin', '/api/course/transfer', { course: c, confirm: 'Física I', email: 'nadie@example.test' }, 404);
await call('admin', '/api/course/transfer', { course: c, confirm: 'Física I', email: 'docente@example.test' }, 409);
// Archivado: se puede transferir igual.
await call('docente', '/api/course/archive', { course: c });
const hecho = await call('admin', '/api/course/transfer', { course: c, confirm: 'Física I', email: 'docente2@example.test', keepPrevious: true });
assert.deepEqual([hecho.owner, hecho.keptPrevious], [idOf('docente2'), true]);
await call('docente2', '/api/course/archive', { course: c, archived: false });
// La nueva propietaria lo administra; la anterior sigue como co-docente; alumnos y calificaciones intactos.
const traspasado = await call('docente2', '/api/course?id=' + c);
assert.equal(traspasado.canDelete, true);
assert.equal(traspasado.course.owner, idOf('docente2'));
assert(traspasado.members.some((m) => m.email === 'docente@example.test' && m.role === 'teacher'));
assert.equal(traspasado.records.filter((r) => r.kind === 'submission').length, 2);
assert.equal((await call('docente', '/api/course?id=' + c)).canTeach, true);
// Sin conservar: al regresarlo, quien lo tenía (Docente Dos) pierde el acceso.
await call('admin', '/api/course/transfer', { course: c, confirm: 'Física I', email: 'docente@example.test' });
await call('docente2', '/api/course?id=' + c, undefined, 403);
const deVuelta = await call('docente', '/api/course?id=' + c);
assert.equal(deVuelta.canDelete, true);
assert(!deVuelta.members.some((m) => m.role === 'teacher'), 'Ya no aparece como co-docente de su propio curso');
log = (await call('admin', '/api/audit?action=transferir_curso')).log;
assert.equal(log.length, 2);
assert.match(log[1].detail, /De Docente Uno a Docente Dos; quien lo tenía queda como co-docente/);
checks += 12;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones de usuarios — vista de un alumno idéntica a la suya y registrada, directorio con búsqueda y ficha, suspender y reactivar sin perder datos, transferir cursos.`);
