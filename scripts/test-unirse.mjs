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

// ---- Código por sección (12.74): quien se une queda en esa sección ----
const c2 = (await call('docente', '/api/courses', { name: 'Física I', group: '5AV y 5BV' }, 201)).id;
const s5av = (await call('docente', '/api/sections', { course: c2, name: '5AV' }, 201)).id;
const s5bv = (await call('docente', '/api/sections', { course: c2, name: '5BV' }, 201)).id;
const otherCourse = (await call('colega', '/api/courses', { name: 'Ajeno', group: 'X' }, 201)).id;
const sOther = (await call('colega', '/api/sections', { course: otherCourse, name: 'Z' }, 201)).id;
assert.deepEqual(await call('docente', `/api/course/join-code?course=${c2}&section=${s5av}`), { code: '', section: s5av });
await call('docente', `/api/course/join-code?course=${c2}&section=${sOther}`, undefined, 404);
await call('docente', '/api/course/join-code', { course: c2, section: sOther, enabled: true }, 404);
await call('ana', '/api/course/join-code', { course: c2, section: s5av, enabled: true }, 403);
const codeA = (await call('docente', '/api/course/join-code', { course: c2, section: s5av, enabled: true })).code;
const codeB = (await call('docente', '/api/course/join-code', { course: c2, section: s5bv, enabled: true })).code;
const codeAll = (await call('docente', '/api/course/join-code', { course: c2, enabled: true })).code;
assert.equal(new Set([codeA, codeB, codeAll]).size, 3, 'Cada sección y el curso tienen su propio código');
assert.equal((await call('docente', `/api/course/join-code?course=${c2}&section=${s5av}`)).code, codeA);
assert.equal((await call('docente', `/api/course/join-code?course=${c2}`)).code, codeAll, 'El código general no cambia');
checks += 3;

const ema = await call('ema', '/api/join', { code: codeA }, 201);
assert.deepEqual([ema.course, ema.section, ema.already], [c2, '5AV', false]);
await call('fer', '/api/join', { code: codeB.toLowerCase() }, 201);
await call('gabi', '/api/join', { code: codeAll }, 201);
const sectionOfMember = async (email) => (await call('docente', '/api/course?id=' + c2)).members.find((m) => m.email === email).section;
assert.equal(await sectionOfMember('ema@example.test'), s5av);
assert.equal(await sectionOfMember('fer@example.test'), s5bv);
assert.equal(await sectionOfMember('gabi@example.test'), '', 'El código general deja sin sección');
// Quien estaba sin sección queda en la del código; quien ya tenía una no se cambia solo.
const gabi = await call('gabi', '/api/join', { code: codeB });
assert.deepEqual([gabi.already, gabi.placed, gabi.section], [true, true, '5BV']);
assert.equal(await sectionOfMember('gabi@example.test'), s5bv);
const emaAgain = await call('ema', '/api/join', { code: codeB });
assert.deepEqual([emaAgain.already, emaAgain.placed, emaAgain.section], [true, undefined, '']);
assert.equal(await sectionOfMember('ema@example.test'), s5av, 'El alumno no se cambia de sección con otro código');
assert.equal((await call('docente', '/api/join', { code: codeA })).already, true, 'El propietario no se inscribe');
checks += 8;

// El código de la sección nunca sale en las respuestas del curso (ni al docente ni al alumno).
for (const who of ['docente', 'ema']) {
  const body = JSON.stringify(await call(who, '/api/course?id=' + c2)) + JSON.stringify(await call(who, '/api/courses'));
  assert.equal(body.includes(codeA) || body.includes(codeB), false, `${who} no recibe códigos de sección`);
}
assert.equal(JSON.stringify(await call('docente', '/api/members/sources?course=' + c)).includes(codeA), false, 'Ni en «Traer de otro curso»');
checks += 2;

// Cambiar o quitar el de una sección no toca los demás; al borrar la sección, su código deja de servir.
const codeA2 = (await call('docente', '/api/course/join-code', { course: c2, section: s5av, enabled: true, regenerate: true })).code;
assert.notEqual(codeA2, codeA);
await call('hugo', '/api/join', { code: codeA }, 404);
await call('docente', '/api/course/join-code', { course: c2, section: s5bv, enabled: false });
await call('hugo', '/api/join', { code: codeB }, 404);
assert.equal((await call('hugo', '/api/join', { code: codeA2 }, 201)).section, '5AV');
assert.equal((await call('docente', `/api/course/join-code?course=${c2}`)).code, codeAll);
const s5cv = (await call('docente', '/api/sections', { course: c2, name: '5CV' }, 201)).id;
const codeC = (await call('docente', '/api/course/join-code', { course: c2, section: s5cv, enabled: true })).code;
await call('docente', '/api/sections/delete', { course: c2, id: s5cv });
await call('iris', '/api/join', { code: codeC }, 404);
checks += 4;

console.log(`PASS: ${checks} verificaciones del código para unirse — solo el docente lo ve y lo cambia, inscripción sin duplicados, sin tocar bajas ni docentes, y nunca sale en las respuestas del curso; código por sección.`);
