// Código para unirse a un curso (12.68): solo quien enseña lo ve y lo cambia, el alumno se inscribe con el código,
// no se repite ni toca a co-docentes o dados de baja, y el código nunca sale en las respuestas del curso.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
let checks = 0;
const cookies = {};
async function call(who, path, data, status = 200, method = data === undefined ? 'GET' : 'POST') {
  cookies[who] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who[0].toUpperCase() + who.slice(1) }), env);
  const res = await api(
    new Request('https://t.local' + path, {
      method,
      headers: { cookie: cookies[who], Origin: 'https://t.local', 'X-Aula-Request': '1' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${who}) → ${text}`);
  checks++;
  return JSON.parse(text);
}

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
await call('admin', '/api/teachers', { email: 'colega@example.test', name: 'Colega', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Difracción de rayos X', group: 'Abierto' }, 201)).id;

// ---- Solo quien enseña lo activa y lo ve ----
assert.equal((await call('docente', '/api/course/join-code?course=' + c)).code, '');
await call('ana', '/api/join', { code: 'ABCD2345' }, 404);
const { code } = await call('docente', '/api/course/join-code', { course: c, enabled: true });
assert.match(code, /^[A-HJKMNP-Z2-9]{8}$/);
assert.equal((await call('docente', '/api/course/join-code', { course: c, enabled: true })).code, code, 'Guardar sin pedir otro conserva el código');
await call('ana', '/api/course/join-code?course=' + c, undefined, 403);
await call('ana', '/api/course/join-code', { course: c, enabled: true, regenerate: true }, 403);
checks += 2;

// ---- El alumno se une (con minúsculas, espacios o guion) ----
await call('ana', '/api/join', { code: '12' }, 400);
const pretty = code.toLowerCase().slice(0, 4) + ' - ' + code.toLowerCase().slice(4);
const joined = await call('ana', '/api/join', { code: pretty }, 201);
assert.deepEqual([joined.course, joined.already], [c, false]);
assert.equal((await call('ana', '/api/join', { code })).already, true, 'Unirse otra vez no duplica');
let course = await call('ana', '/api/course?id=' + c);
assert.equal(course.course.join_code, undefined, 'El alumno no recibe el código');
assert.equal(JSON.stringify(course).includes(code), false);
assert.equal(JSON.stringify(await call('ana', '/api/courses')).includes(code), false, 'Tampoco en Mis cursos');
let members = (await call('docente', '/api/course?id=' + c)).members;
assert.deepEqual(members.filter((m) => m.role === 'student').map((m) => [m.name, m.email]), [['Ana', 'ana@example.test']]);
assert.equal(JSON.stringify(await call('docente', '/api/courses')).includes(code), false, 'Ni el docente lo recibe en la lista');
checks += 6;

// ---- Propietario y dados de baja no cambian ----
const ana = members.find((m) => m.email === 'ana@example.test');
await call('docente', '/api/member', { course: c, id: ana.id }, 200, 'DELETE');
assert.match((await call('ana', '/api/join', { code }, 403)).error, /te dio de baja/);
assert.equal((await call('docente', '/api/join', { code })).already, true, 'El propietario no se inscribe como alumno');
checks += 2;

// ---- Cambiar o quitar el código ----
const otro = (await call('docente', '/api/course/join-code', { course: c, enabled: true, regenerate: true })).code;
assert.notEqual(otro, code);
await call('beto', '/api/join', { code }, 404);
await call('beto', '/api/join', { code: otro }, 201);
await call('docente', '/api/course/join-code', { course: c, enabled: false });
await call('carla', '/api/join', { code: otro }, 404);
checks += 1;

// ---- Curso oculto o archivado ----
await call('docente', '/api/course/join-code', { course: c, enabled: true });
const actual = (await call('docente', '/api/course/join-code?course=' + c)).code;
await call('docente', '/api/course/archive', { course: c, archived: true });
assert.match((await call('dani', '/api/join', { code: actual }, 409)).error, /ya terminó/);
checks++;

console.log(`PASS: ${checks} verificaciones del código para unirse — solo el docente lo ve y lo cambia, inscripción sin duplicados, sin tocar bajas ni docentes, y nunca sale en las respuestas del curso.`);
