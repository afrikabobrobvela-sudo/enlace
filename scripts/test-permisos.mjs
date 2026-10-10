// Pruebas de permisos de la 12.64 (auditoría de seguridad): traer alumnos de otro curso no toca a los co-docentes, la
// academia se registra una sola vez, a un docente retirado ya no le llegan clases ni avisos de sus cursos e inscribir
// un correo no da facultades sobre la foto de un docente.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
let checks = 0;
const cookies = {};
async function login(who) {
  cookies[who] = await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who }), env);
}
async function raw(who, path, { data, bytes, method } = {}) {
  if (!cookies[who]) await login(who);
  return api(
    new Request('https://t.local' + path, {
      method: method || (data === undefined && !bytes ? 'GET' : 'POST'),
      headers: { cookie: cookies[who], Origin: 'https://t.local', 'X-Aula-Request': '1' },
      body: bytes || (data === undefined ? undefined : JSON.stringify(data)),
    }),
    env,
  );
}
async function call(who, path, data, status = 200, method) {
  const res = await raw(who, path, { data, method });
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${who}) → ${text}`);
  checks++;
  return JSON.parse(text);
}

await call('admin', '/api/me');
for (const who of ['duena', 'xavier', 'yolanda', 'zoe']) await call('admin', '/api/teachers', { email: who + '@example.test', name: who, role: 'teacher' });

// ---- Traer alumnos de otro curso no convierte en alumno a un co-docente ----
const a = (await call('duena', '/api/courses', { name: 'Física I', group: '501' }, 201)).id;
await call('duena', '/api/course/teachers', { course: a, email: 'xavier@example.test' }, 201);
await call('duena', '/api/course/teachers', { course: a, email: 'yolanda@example.test' }, 201);
const b = (await call('xavier', '/api/courses', { name: 'Física II', group: '502' }, 201)).id;
await call('xavier', '/api/member', { course: b, name: 'Yolanda', email: 'yolanda@example.test' });
await call('xavier', '/api/member', { course: b, name: 'Alumna', email: 'alumna@example.test' });
const copied = await call('xavier', '/api/members/copy', { course: a, source: b });
assert.equal(copied.total, 2);
assert.equal((await call('yolanda', '/api/course?id=' + a)).canTeach, true, 'Sigue como co-docente');
const filas = store.raw().prepare("SELECT email, role FROM aula_members WHERE course=? ORDER BY email").all(a);
assert.deepEqual(filas.map((m) => [m.email, m.role]), [['alumna@example.test', 'student'], ['xavier@example.test', 'teacher'], ['yolanda@example.test', 'teacher']]);
checks += 3;

// ---- La academia se registra una vez; después solo la administración cambia la suya ----
const fisica = (await call('admin', '/api/catalog', { kind: 'academy', name: 'Física' }, 201)).id;
const quimica = (await call('admin', '/api/catalog', { kind: 'academy', name: 'Química' }, 201)).id;
const prepa = (await call('admin', '/api/catalog', { kind: 'unit', name: 'Preparatoria A' }, 201)).id;
await call('zoe', '/api/profile/classification', { academy: fisica, unit: prepa });
await call('zoe', '/api/profile/classification', { academy: quimica, unit: prepa }, 409);
assert.equal((await call('zoe', '/api/me')).academyId, fisica);
await call('admin', '/api/profile/classification', { academy: fisica, unit: prepa });
await call('admin', '/api/profile/classification', { academy: quimica, unit: prepa });
assert.equal((await call('admin', '/api/me')).academyId, quimica);
checks += 2;

// ---- Un docente retirado ya no ve clases, cursos ni entregas de sus cursos en el calendario y los avisos ----
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const range = `/api/calendar?from=${encodeURIComponent(new Date(Date.now() - 5 * 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 20 * 86_400_000).toISOString())}`;
const c = (await call('zoe', '/api/courses', { name: 'Química I', group: '601' }, 201)).id;
await call('zoe', '/api/attendance/session', { course: c, date: day(1), start_time: '07:00', topic: 'Enlaces' }, 201);
await call('zoe', '/api/member', { course: c, name: 'Beto', email: 'beto@example.test' });
const tarea = await call('zoe', '/api/record', { course: c, kind: 'task', data: { title: 'Práctica de enlaces', visible: true } }, 201);
await call('beto', '/api/record', { course: c, kind: 'submission', data: { task: tarea.id, body: 'Mi práctica' } }, 201);
let calendario = await call('zoe', range);
assert(calendario.courses.some((x) => x.id === c) && calendario.events.some((e) => e.type === 'session' && e.course === c));
assert((await call('zoe', '/api/notifications')).items.some((i) => i.type === 'submission' && i.course === c));
await call('admin', '/api/teachers', { email: 'zoe@example.test' }, 200, 'DELETE');
await login('zoe'); // sus sesiones se cerraron al retirarla
await call('zoe', '/api/course?id=' + c, undefined, 403);
calendario = await call('zoe', range);
assert(!calendario.courses.some((x) => x.id === c), 'El curso ya no sale en su calendario');
assert(!calendario.events.some((e) => e.course === c), 'Ni sus clases');
assert(!(await call('zoe', '/api/notifications')).items.some((i) => i.course === c), 'Ni avisos de entregas');
checks += 5;

// ---- Inscribir el correo de un docente no da facultades sobre su foto ----
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(7)]);
assert.equal((await raw('yolanda', '/api/profile/photo', { bytes: jpeg })).status, 201);
const yolandaId = (await call('yolanda', '/api/me')).id;
// Walter no comparte ningún curso con Yolanda como docente: la inscribe como alumna en el suyo.
await call('admin', '/api/teachers', { email: 'walter@example.test', name: 'walter', role: 'teacher' });
const propio = (await call('walter', '/api/courses', { name: 'Física III', group: '503' }, 201)).id;
await call('walter', '/api/member', { course: propio, name: 'Yolanda', email: 'yolanda@example.test' });
assert.equal((await raw('walter', '/api/photo/' + yolandaId)).status, 404, 'No ve la foto de una docente inscrita como alumna');
await call('walter', '/api/profile/photo/delete', { user: yolandaId, course: propio }, 404);
assert.equal((await raw('yolanda', '/api/photo/' + yolandaId)).status, 200, 'La foto sigue');
assert.equal((await raw('duena', '/api/photo/' + yolandaId)).status, 200, 'Quien comparte curso con ella como docente sí la ve');
assert.equal((await raw('alumna', '/api/photo/' + yolandaId)).status, 200, 'Su alumna también');
checks += 5;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones de permisos — co-docentes intactos al traer alumnos, academia registrada una vez, docente retirado sin avisos ni clases de sus cursos y fotos de docentes protegidas.`);
