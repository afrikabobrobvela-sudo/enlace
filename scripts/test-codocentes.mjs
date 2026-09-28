// Pruebas de co-docentes: el propietario comparte su curso con otros docentes registrados.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'k'.repeat(40) };
let checks = 0;
const cookies = {};
async function call(user, path, data, status = 200, method = data === undefined ? 'GET' : 'POST') {
  cookies[user] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user }),
    env,
  );
  const res = await api(
    new Request('https://t.local' + path, {
      method,
      headers: { cookie: cookies[user], Origin: 'https://t.local', 'X-Aula-Request': '1' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  const text = await res.text();
  assert.equal(res.status, status, `${method} ${path} (${user}) → ${text}`);
  checks++;
  return JSON.parse(text);
}

await call('admin', '/api/me');
for (const t of ['titular', 'adjunto', 'externo']) await call('admin', '/api/teachers', { email: t + '@example.test', name: t, role: 'teacher' });
const c = (await call('titular', '/api/courses', { name: 'Física I', group: '501' }, 201)).id;
await call('titular', '/api/member', { course: c, name: 'Ana', email: 'ana@example.test' });
await call('adjunto', '/api/course?id=' + c, undefined, 403);

// Solo propietario o administración; solo docentes registrados.
await call('ana', '/api/course/teachers', { course: c, email: 'adjunto@example.test' }, 403);
await call('titular', '/api/course/teachers', { course: c, email: 'nadie@example.test' }, 404);
await call('titular', '/api/course/teachers', { course: c, email: 'ana@example.test' }, 404, 'POST'); // alumna, no docente
await call('titular', '/api/course/teachers', { course: c, email: 'titular@example.test' }, 409);
await call('titular', '/api/course/teachers', { course: c, email: 'adjunto@example.test' }, 201);

// El co-docente enseña: ve todo, edita, califica; no puede borrar el curso ni agregar más co-docentes.
const course = await call('adjunto', '/api/course?id=' + c);
assert.equal(course.canTeach, true);
assert.equal(course.canDelete, false);
assert((await call('adjunto', '/api/courses')).find((x) => x.id === c).canTeach);
const tarea = await call('adjunto', '/api/record', { course: c, kind: 'task', data: { title: 'Práctica', visible: true } }, 201);
const ana = course.members.find((m) => m.email === 'ana@example.test').id;
await call('adjunto', '/api/grade', { course: c, task: tarea.id, member: ana, grade: 9 });
await call('adjunto', '/api/course/teachers', { course: c, email: 'externo@example.test' }, 403);
await call('adjunto', '/api/course', { course: c, confirm: 'Física I' }, 403, 'DELETE');
// El alumno lo ve en la lista con rol de docente, sin correo.
const vista = await call('ana', '/api/course?id=' + c);
assert.deepEqual(vista.members.find((m) => m.role === 'teacher'), { id: vista.members.find((m) => m.role === 'teacher').id, user_id: vista.members.find((m) => m.role === 'teacher').user_id, name: 'adjunto', role: 'teacher' });

// Si deja de ser docente de Enlace, pierde el acceso también como co-docente.
await call('admin', '/api/teachers', { email: 'adjunto@example.test' }, 200, 'DELETE');
cookies.adjunto = undefined;
await call('adjunto', '/api/course?id=' + c, undefined, 403);
assert(!(await call('adjunto', '/api/courses')).some((x) => x.id === c));
await call('admin', '/api/teachers', { email: 'adjunto@example.test', name: 'adjunto', role: 'teacher' });
assert.equal((await call('adjunto', '/api/course?id=' + c)).canTeach, true);

// Retirar al co-docente.
const coId = (await call('titular', '/api/course?id=' + c)).members.find((m) => m.role === 'teacher').id;
await call('titular', '/api/course/teachers', { course: c, id: ana }, 404, 'DELETE'); // un alumno no se retira por aquí
await call('titular', '/api/course/teachers', { course: c, id: coId }, 200, 'DELETE');
await call('adjunto', '/api/course?id=' + c, undefined, 403);

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones de co-docentes — alta solo por el propietario, permisos de docente sin borrar el curso, y retiro.`);
