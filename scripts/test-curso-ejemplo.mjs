// Pruebas del curso de ejemplo: se crea completo en una sola solicitud (≤ 50 consultas), con alumnos ficticios sin
// cuenta, contenido, foros, equipos, actividades calificadas, rúbrica, evaluación con intentos y asistencia; solo lo
// crea el personal docente, queda a su nombre y respeta el límite de cursos de ejemplo.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { demoCourse } from '../src/server/demo.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
let checks = 0;
const cookies = {};
async function call(user, path, data, status = 200, method = data === undefined ? 'GET' : 'POST') {
  cookies[user] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user }),
    env,
  );
  const before = store.counter.queries;
  const res = await api(
    new Request('https://t.local' + path, {
      method,
      headers: { cookie: cookies[user], Origin: 'https://t.local', 'X-Aula-Request': '1' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${user}) → ${text}`);
  assert(store.counter.queries - before <= 50, `${path}: ${store.counter.queries - before} consultas`);
  checks++;
  return JSON.parse(text);
}

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });

// ---- Solo docentes ----
await call('alumna', '/api/me');
await call('alumna', '/api/demo-course', {}, 403);

// ---- Se crea completo ----
const { id } = await call('docente', '/api/demo-course', {}, 201);
const course = await call('docente', '/api/course?id=' + id);
const kinds = {};
for (const r of course.records) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
assert.match(course.course.name, /\(curso de ejemplo\)$/);
assert(course.course.period);
assert.equal(course.members.length, 18);
assert(course.members.every((m) => m.email.endsWith('@ejemplo.invalid') && !m.user_id && m.role === 'student'));
assert.equal(kinds.module, 4);
assert(kinds.material >= 6);
assert.equal(kinds.notice, 3);
assert.equal(kinds.forum, 2);
assert(kinds.post >= 7);
assert.equal(kinds.group, 4);
assert.equal(kinds.quiz, 2);
assert.equal(kinds.task, 7);
assert(kinds.submission > 60);
assert.equal(kinds.attempt, 16);
assert.equal(kinds.rubric, 1);
checks += 13;

// Unidad oculta, actividad oculta y proyecto por equipo.
const records = (kind) => course.records.filter((r) => r.kind === kind);
assert.equal(records('module').filter((m) => !m.data.visible).length, 1);
assert.equal(records('task').filter((t) => !t.data.visible).length, 1);
assert.equal(records('task').filter((t) => t.data.groupCategory === 'Equipos de laboratorio').length, 1);
// Todos los alumnos están en algún equipo y los materiales apuntan a una unidad del curso.
const inTeams = new Set(records('group').flatMap((g) => g.data.members));
assert.equal(inTeams.size, 18);
const moduleIds = new Set(records('module').map((m) => m.id));
assert(records('material').every((m) => moduleIds.has(m.data.module)));
checks += 5;

// Calificaciones: publicadas, borradores sin publicar, por calificar, con rúbrica y capturadas sin entrega.
const subs = records('submission');
assert(subs.some((s) => s.data.published && s.data.grade !== null));
assert(subs.some((s) => !s.data.published && s.data.grade !== null));
assert(subs.some((s) => s.data.submitted && s.data.grade === null));
assert(subs.some((s) => s.data.rubricScores?.items.length === 3));
assert(subs.some((s) => s.data.manual && s.data.grade !== null));
assert(subs.some((s) => s.data.late));
assert(subs.every((s) => s.data.grade === null || (s.data.grade >= 0 && s.data.grade <= 10)));
const grading = records('grading')[0];
assert.equal(grading.data.scheme, 'categories');
assert.deepEqual(grading.data.categories.map((c) => c.weight).reduce((a, b) => a + b), 100);
assert(grading.data.categories.some((c) => c.source === 'attendance'));
checks += 10;

// Evaluación diagnóstica: intentos calificados por el mismo evaluador que usan los alumnos.
const attempts = records('attempt');
assert(attempts.every((a) => a.data.total === 5 && a.data.score === (a.data.correct / 5) * 10 && a.data.details.length === 5));
assert(new Set(attempts.map((a) => a.data.score)).size > 2, 'Resultados variados');
checks += 2;

// Asistencia: sesiones pasadas con los cuatro estados.
const att = await call('docente', '/api/attendance?course=' + id);
assert(att.sessions.length >= 10);
assert(att.sessions.every((s) => s.date < new Date().toISOString().slice(0, 10)));
assert.equal(att.records.length, att.sessions.length * 18);
assert.deepEqual(new Set(att.records.map((r) => r.status)), new Set(['present', 'late', 'absent', 'excused']));
assert.equal(att.settings.min_percent, 80);
checks += 5;

// ---- Nadie más lo ve; la vista como alumno funciona ----
await call('alumna', '/api/course?id=' + id, undefined, 403);
const preview = await call('docente', `/api/course?id=${id}&as=student`);
assert(!preview.records.some((r) => r.kind === 'task' && !r.data.visible));
assert(!preview.records.some((r) => r.kind === 'attempt' || r.kind === 'submission'));
assert(!JSON.stringify(preview).includes('ejemplo.invalid'), 'Sin correos de alumnos en la vista de alumno');
checks += 3;

// ---- Se puede trabajar con él como con cualquier curso ----
const porCalificar = subs.find((s) => s.data.submitted && s.data.grade === null);
await call('docente', '/api/grade', { course: id, task: porCalificar.data.task, member: porCalificar.data.member, revision: porCalificar.revision, grade: 8.5, feedback: 'Bien' });
const sesion = att.sessions[0];
await call('docente', '/api/attendance/mark', { course: id, session: sesion.id, marks: [{ member: course.members[0].id, status: 'absent' }] });
await call('docente', '/api/record', { course: id, kind: 'notice', data: { title: 'Aviso nuevo', body: 'Hola', visible: true } }, 201);
const copia = await call('docente', '/api/course/copy', { course: id, name: 'Copia del ejemplo', group: 'B' }, 201);
assert(copia.id);
checks++;

// ---- Límite de cursos de ejemplo ----
await call('docente', '/api/demo-course', {}, 201);
await call('docente', '/api/demo-course', {}, 201);
const limite = await call('docente', '/api/demo-course', {}, 409);
assert.match(limite.error, /3 cursos de ejemplo/);
checks++;
// Al eliminar uno, se puede crear otro.
await call('docente', '/api/course', { course: id, confirm: course.course.name }, 200, 'DELETE');
await call('docente', '/api/demo-course', {}, 201);

// ---- Las fechas se calculan desde hoy ----
const junio = demoCourse({ id: 'u1' }, new Date('2027-06-15T12:00:00Z'));
assert.equal(junio.course.period, 'Primavera 2027');
assert(junio.sessions.every((s) => s.date < '2027-06-15' && s.date > '2027-04-30'));
assert(junio.tasks.some((t) => t.due > '2027-06-15') && junio.tasks.some((t) => t.due < '2027-06-15'));
checks += 3;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones del curso de ejemplo — alumnos ficticios, contenido, foros, equipos, calificaciones, rúbrica, intentos, asistencia, permisos y límite.`);
