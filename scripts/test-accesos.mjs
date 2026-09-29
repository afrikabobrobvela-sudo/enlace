// Pruebas de accesos (12.20): inicios de sesión de alumnos y docentes durante el curso (historial que no se borra con
// las sesiones vencidas) e ingresos al curso (visita nueva tras 30 min; a lo más una escritura cada 5 min).
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
const sql = store.raw();
let checks = 0;
const cookies = {};
const users = {};
async function login(who) {
  users[who] = await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who });
  cookies[who] = await sessionCookieForTests(users[who], env);
}
async function call(who, path, data, status = 200) {
  if (!cookies[who]) await login(who);
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
const MIN = 60_000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const row = (course, who) => sql.prepare('SELECT * FROM aula_course_access WHERE course=? AND user_id=?').get(course, users[who].id);
const shift = (course, who, ms) => sql.prepare('UPDATE aula_course_access SET last_at=? WHERE course=? AND user_id=?').run(ago(ms), course, users[who].id);

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
await call('admin', '/api/teachers', { email: 'adjunta@example.test', name: 'Adjunta', role: 'teacher' });
await call('adjunta', '/api/me');
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '5AV' }, 201)).id;
await call('docente', '/api/course/teachers', { course: c, email: 'adjunta@example.test' }, 201);
await call('docente', '/api/members/bulk', { course: c, students: ['ana', 'beto'].map((n) => ({ name: n.toUpperCase(), email: n + '@example.test' })) });
await call('ana', '/api/me'); // Beto nunca entra

// ---- Historial de inicios de sesión ----
const created = sql.prepare('SELECT created FROM aula_courses WHERE id=?').get(c).created;
assert.equal(sql.prepare('SELECT count(*) AS n FROM aula_login_log WHERE user_id=?').get(users.ana.id).n, 1, 'Cada inicio queda en el historial');
await login('ana'); // otro dispositivo
await login('ana');
// Un inicio de antes del curso no cuenta.
sql.prepare('INSERT INTO aula_login_log (id,user_id,at) VALUES (?,?,?)').run('viejo', users.ana.id, new Date(Date.parse(created) - 86_400_000).toISOString());
// Las sesiones vencidas se borran de aula_logins al volver a entrar, pero el historial se queda.
sql.prepare('UPDATE aula_logins SET expires=? WHERE user_id=?').run(ago(MIN), users.ana.id);
await login('ana');
assert.equal(sql.prepare('SELECT count(*) AS n FROM aula_logins WHERE user_id=?').get(users.ana.id).n, 1);
assert.equal(sql.prepare('SELECT count(*) AS n FROM aula_login_log WHERE user_id=?').get(users.ana.id).n, 5);
checks += 2;

// ---- Ingresos al curso ----
await call('ana', '/api/course?id=' + c);
await call('ana', '/api/course?id=' + c);
assert.equal(row(c, 'ana').visits, 1, 'Recargar no es otro ingreso');
const first = row(c, 'ana').first_at;
shift(c, 'ana', 40 * MIN);
await call('ana', '/api/course?id=' + c);
assert.equal(row(c, 'ana').visits, 2, 'Tras 30 min sin actividad es un ingreso nuevo');
shift(c, 'ana', 10 * MIN);
await call('ana', '/api/course?id=' + c);
assert.equal(row(c, 'ana').visits, 2, 'A los 10 min sigue siendo el mismo ingreso');
assert(row(c, 'ana').last_at > ago(MIN), 'pero se actualiza la hora');
const touched = ago(2 * MIN);
sql.prepare('UPDATE aula_course_access SET last_at=? WHERE course=? AND user_id=?').run(touched, c, users.ana.id);
await call('ana', '/api/course?id=' + c);
assert.equal(row(c, 'ana').last_at, touched, 'Con menos de 5 min no se escribe');
assert.equal(row(c, 'ana').first_at, first);
await call('docente', '/api/course?id=' + c);
await call('adjunta', '/api/course?id=' + c);
await call('admin', '/api/course?id=' + c);
assert.equal(row(c, 'admin'), undefined, 'La administración que solo revisa no cuenta');
await call('docente', '/api/course?id=' + c + '&as=student');
assert.equal(row(c, 'docente').visits, 1);
checks += 8;

// ---- Pantalla de accesos: solo quien enseña ----
await call('ana', '/api/course/access?id=' + c, undefined, 403);
await call('otro', '/api/course/access?id=' + c, undefined, 403);
let report = await call('adjunta', '/api/course/access?id=' + c);
assert.equal(report.since, created);
assert.equal(report.until, null);
const by = (name) => report.people.find((p) => p.name === name);
assert.deepEqual(report.people.map((p) => [p.name, p.role, p.owner]), [
  ['Docente', 'teacher', true],
  ['Adjunta', 'teacher', false],
  ['ANA', 'student', false],
  ['BETO', 'student', false],
]);
assert.equal(by('ANA').logins, 4, 'Solo los inicios desde que existe el curso');
assert.equal(by('ANA').visits, 2);
assert(by('ANA').lastLogin && by('ANA').lastVisit && by('ANA').firstVisit);
assert.equal(by('ANA').account, true);
assert.deepEqual([by('BETO').account, by('BETO').logins, by('BETO').visits, by('BETO').lastVisit], [false, 0, 0, null]);
assert.equal(by('Docente').logins, 0, 'El docente entró para crear el curso (antes)');
assert.equal(by('Docente').visits, 1);
assert.equal(by('Adjunta').logins, 0, 'La adjunta entró antes de que existiera el curso');
assert(!('email' in by('ANA')), 'Sin correos en el reporte');
assert(report.people.every((p) => p.member === null || typeof p.member === 'string'));
checks += 11;

// ---- Curso archivado: lo posterior al archivo no cuenta ----
await call('docente', '/api/course/archive', { course: c, archived: true });
const archivedAt = sql.prepare('SELECT archived_at FROM aula_courses WHERE id=?').get(c).archived_at;
sql.prepare('INSERT INTO aula_login_log (id,user_id,at) VALUES (?,?,?)').run('despues', users.ana.id, new Date(Date.parse(archivedAt) + 86_400_000).toISOString());
report = await call('docente', '/api/course/access?id=' + c);
assert.equal(report.until, archivedAt);
assert.equal(report.people.find((p) => p.name === 'ANA').logins, 4);
// Consultar un curso archivado sigue contando como ingreso (es una lectura).
shift(c, 'ana', 40 * MIN);
await call('ana', '/api/course?id=' + c);
assert.equal(row(c, 'ana').visits, 3);
checks += 3;

// ---- Muchos alumnos: pocas consultas ----
const big = (await call('docente', '/api/courses', { name: 'Física II', group: '5BV' }, 201)).id;
await call('docente', '/api/members/bulk', { course: big, students: Array.from({ length: 300 }, (_, i) => ({ name: 'Alumno ' + i, email: `a${i}@example.test` })) });
const before = store.counter.queries;
report = await call('docente', '/api/course/access?id=' + big);
assert.equal(report.people.length, 301);
assert(store.counter.queries - before <= 3, `${store.counter.queries - before} consultas`);
checks += 2;

console.log(`PASS: ${checks} verificaciones de accesos — historial de inicios de sesión que no se borra, inicios contados durante el curso, ingresos al curso con pocas escrituras y reporte solo para quien enseña.`);
