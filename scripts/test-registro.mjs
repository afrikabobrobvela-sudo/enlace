// Pruebas del registro de docentes: catálogo de academias y unidades, solicitud con correo institucional,
// aprobación o rechazo por la administración, clasificación de docentes y de cursos.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@correo.buap.mx', SESSION_SECRET: 'r'.repeat(40) };
let checks = 0;
const cookies = {};
async function call(email, path, data, status = 200, method = data === undefined ? 'GET' : 'POST') {
  cookies[email] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + email, email, name: email.split('@')[0] }),
    env,
  );
  const res = await api(
    new Request('https://t.local' + path, {
      method,
      headers: { cookie: cookies[email], Origin: 'https://t.local', 'X-Aula-Request': '1' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  const text = await res.text();
  assert.equal(res.status, status, `${method} ${path} (${email}) → ${text}`);
  checks++;
  return JSON.parse(text);
}
const ADMIN = 'admin@correo.buap.mx';
const DOCENTE = 'maria.lopez@correo.buap.mx';
const ALUMNO = 'ana@alumno.buap.mx';
const GMAIL = 'pedro@gmail.com';

// ---- Sin catálogo nadie puede pedir ser docente ni se exige clasificación ----
let me = await call(DOCENTE, '/api/me');
assert.deepEqual([me.role, me.canRequestTeacher, me.teacherRequest], ['student', false, null]);
me = await call(ADMIN, '/api/me');
assert.deepEqual([me.role, me.needsClassification, me.pendingTeacherRequests], ['admin', false, 0]);

// ---- Catálogo: solo la administración lo edita ----
await call(DOCENTE, '/api/catalog', { kind: 'academy', name: 'Física' }, 403);
await call(ADMIN, '/api/catalog', { kind: 'otra', name: 'x' }, 400);
const fisica = (await call(ADMIN, '/api/catalog', { kind: 'academy', name: 'Física' }, 201)).id;
await call(ADMIN, '/api/catalog', { kind: 'academy', name: 'FÍSICA' }, 409); // sin importar mayúsculas…
await call(ADMIN, '/api/catalog', { kind: 'academy', name: 'Fisica' }, 409); // …ni acentos
await call(ADMIN, '/api/catalog', { kind: 'academy', id: fisica, name: 'Física' }); // renombrarse a sí misma no choca
let bulk = await call(ADMIN, '/api/catalog/bulk', { kind: 'academy', names: ['Matemáticas', 'Química', 'MATEMATICAS', '  ', 'física'] }, 201);
assert.deepEqual(bulk, { created: 2, existing: 2 });
bulk = await call(ADMIN, '/api/catalog/bulk', { kind: 'unit', names: ['Preparatoria Regional A', 'Preparatoria Regional B'] }, 201);
assert.equal(bulk.created, 2);
let catalog = await call(ADMIN, '/api/catalog');
const quimica = catalog.academies.find((a) => a.name === 'Química').id;
const prepaA = catalog.units.find((u) => u.name === 'Preparatoria Regional A').id;
const prepaB = catalog.units.find((u) => u.name === 'Preparatoria Regional B').id;
await call(ADMIN, '/api/catalog', { kind: 'academy', id: quimica, name: 'Química', active: false });
catalog = await call(DOCENTE, '/api/catalog');
assert(!catalog.academies.some((a) => a.id === quimica), 'Lo desactivado no se ofrece');
assert((await call(ADMIN, '/api/catalog')).academies.some((a) => a.id === quimica && a.active === 0), 'La administración sí lo ve');

// ---- Solicitud para ser docente ----
me = await call(DOCENTE, '/api/me');
assert.equal(me.canRequestTeacher, true, 'Correo institucional con catálogo listo');
assert.equal((await call(GMAIL, '/api/me')).canRequestTeacher, false);
assert.equal((await call(ALUMNO, '/api/me')).canRequestTeacher, false, 'Correo de alumno BUAP no es de docente');
const solicitud = { name: 'María López', academy: fisica, unit: prepaA, subjects: 'Física I, Física II', message: 'Imparto en 5.º semestre.' };
await call(GMAIL, '/api/teacher-request', solicitud, 403);
await call(DOCENTE, '/api/teacher-request', { ...solicitud, academy: quimica }, 400); // academia desactivada
await call(DOCENTE, '/api/teacher-request', { ...solicitud, unit: 'no-existe' }, 400);
await call(DOCENTE, '/api/teacher-request', { ...solicitud, name: '' }, 400);
await call(DOCENTE, '/api/teacher-request', solicitud, 201);
await call(DOCENTE, '/api/teacher-request', solicitud, 409); // ya hay una pendiente
me = await call(DOCENTE, '/api/me');
assert.equal(me.teacherRequest.status, 'pending');
await call(DOCENTE, '/api/courses', { name: 'Física I', group: '501' }, 403); // todavía no es docente

// La administración ve la pendiente; nadie más.
await call(DOCENTE, '/api/teacher-requests', undefined, 403);
assert.equal((await call(ADMIN, '/api/me')).pendingTeacherRequests, 1);
let { requests } = await call(ADMIN, '/api/teacher-requests');
assert.deepEqual(
  [requests[0].name, requests[0].email, requests[0].academy, requests[0].unit, requests[0].subjects],
  ['María López', DOCENTE, 'Física', 'Preparatoria Regional A', 'Física I, Física II'],
);

// Rechazo con motivo y nueva solicitud.
await call(ADMIN, '/api/teacher-requests/decide', { id: requests[0].id, approve: false }, 400); // falta el motivo
await call(ADMIN, '/api/teacher-requests/decide', { id: requests[0].id, approve: false, reason: 'Indica tu unidad correcta.' });
await call(ADMIN, '/api/teacher-requests/decide', { id: requests[0].id, approve: true }, 409); // ya decidida
me = await call(DOCENTE, '/api/me');
assert.deepEqual([me.role, me.teacherRequest.status, me.teacherRequest.reason], ['student', 'rejected', 'Indica tu unidad correcta.']);
await call(DOCENTE, '/api/teacher-request', { ...solicitud, unit: prepaB }, 201);

// Aprobación: queda como docente con su academia y unidad, de inmediato.
({ requests } = await call(ADMIN, '/api/teacher-requests'));
const pendiente = requests.find((r) => r.status === 'pending');
await call(ADMIN, '/api/teacher-requests/decide', { id: pendiente.id, approve: true });
me = await call(DOCENTE, '/api/me');
assert.deepEqual([me.role, me.name, me.academyId, me.unitId, me.needsClassification, me.teacherRequest.status], ['teacher', 'María López', fisica, prepaB, false, 'approved']);
const curso = (await call(DOCENTE, '/api/courses', { name: 'Física I', group: '501' }, 201)).id;
const row = store.raw().prepare('SELECT academy_id, unit_id FROM aula_courses WHERE id=?').get(curso);
assert.deepEqual([row.academy_id, row.unit_id], [fisica, prepaB], 'El curso queda clasificado');
let teachers = await call(ADMIN, '/api/teachers');
const maria = teachers.find((t) => t.email === DOCENTE);
assert.deepEqual([maria.academy, maria.unit, maria.courses], ['Física', 'Preparatoria Regional B', 1]);
await call(DOCENTE, '/api/teacher-request', solicitud, 409); // ya es docente

// ---- Docentes dados de alta antes del registro: completan su academia y unidad ----
await call(ADMIN, '/api/teachers', { email: 'colega@correo.buap.mx', name: 'Colega', role: 'teacher' });
me = await call('colega@correo.buap.mx', '/api/me');
assert.deepEqual([me.role, me.needsClassification], ['teacher', true]);
assert.equal((await call(ADMIN, '/api/me')).needsClassification, true, 'La administración también se clasifica');
await call(ALUMNO, '/api/profile/classification', { academy: fisica, unit: prepaA }, 403);
await call('colega@correo.buap.mx', '/api/profile/classification', { academy: quimica, unit: prepaA }, 400);
await call('colega@correo.buap.mx', '/api/profile/classification', { academy: fisica, unit: prepaA });
assert.equal((await call('colega@correo.buap.mx', '/api/me')).needsClassification, false);

// Un alumno no ve solicitudes ni datos de la administración.
me = await call(ALUMNO, '/api/me');
assert(!('pendingTeacherRequests' in me));

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), [], 'Sin llaves foráneas rotas');
console.log(`PASS: ${checks} verificaciones del registro de docentes — catálogo de academias y unidades, solicitud con correo institucional, aprobación o rechazo, y clasificación de docentes y cursos.`);
