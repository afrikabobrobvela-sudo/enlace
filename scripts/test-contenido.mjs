// Pruebas de contenido: archivos en unidades y visibilidad con un toque.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'docente@example.test', SESSION_SECRET: 'q'.repeat(40) };
let checks = 0;
const cookies = {};
async function send(user, path, init = {}) {
  cookies[user] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user }),
    env,
  );
  return api(new Request('https://t.local' + path, { ...init, headers: { cookie: cookies[user], Origin: 'https://t.local', 'X-Aula-Request': '1', ...init.headers } }), env);
}
async function call(user, path, data, status = 200, method = data === undefined ? 'GET' : 'POST') {
  const res = await send(user, path, { method, body: data === undefined ? undefined : JSON.stringify(data) });
  const text = await res.text();
  assert.equal(res.status, status, `${method} ${path} → ${text}`);
  checks++;
  return JSON.parse(text);
}
async function upload(user, name) {
  const res = await send(user, `/api/upload?course=${c}&scope=material`, { method: 'POST', headers: { 'x-file-name': name }, body: '%PDF-1.4 ' + name });
  assert.equal(res.status, 201);
  return (await res.json()).id;
}
async function download(user, id, status) {
  const res = await send(user, '/api/file/' + id);
  assert.equal(res.status, status, `descarga ${id} por ${user}`);
  checks++;
}

await call('docente', '/api/me');
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '101' }, 201)).id;
await call('docente', '/api/member', { course: c, name: 'Ana', email: 'ana@example.test' });
const view = async (user) => (await call(user, '/api/course?id=' + c)).records;
const toggle = (kind, id, visible, user = 'docente', status = 200) => call(user, '/api/record/visibility', { course: c, kind, id, visible }, status);

// ---- Archivos en la unidad ----
const programa = await upload('docente', 'programa.pdf');
const unidad = await call('docente', '/api/record', { course: c, kind: 'module', data: { title: 'Unidad 1', body: '**Cinemática**', visible: false, fileIds: [programa] } }, 201);
assert.deepEqual(unidad.data.fileIds, [programa]);
await download('ana', programa, 403); // unidad oculta
assert(!(await call('ana', '/api/course?id=' + c)).files.some((f) => f.id === programa));

// ---- Mostrar / ocultar con un toque ----
await toggle('module', unidad.id, true, 'ana', 403);
await toggle('module', unidad.id, 'si', 'docente', 400);
await toggle('module', unidad.id, true);
await download('ana', programa, 200);
assert((await call('ana', '/api/course?id=' + c)).files.some((f) => f.id === programa));
assert.equal((await view('docente')).find((r) => r.id === unidad.id).revision, 2, 'El cambio sube la revisión');

const guia = await upload('docente', 'guia.pdf');
const material = await call('docente', '/api/record', { course: c, kind: 'material', data: { title: 'Guía', module: unidad.id, fileIds: [guia] } }, 201);
await download('ana', guia, 200);
await toggle('material', material.id, false);
await download('ana', guia, 403);
assert(!(await view('ana')).some((r) => r.id === material.id));
await toggle('material', material.id, true);
await toggle('module', unidad.id, false); // ocultar la unidad oculta también sus materiales
await download('ana', guia, 403);
assert(!(await view('ana')).some((r) => r.id === material.id));
await toggle('module', unidad.id, true);

const tarea = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Tarea', visible: false } }, 201);
assert(!(await view('ana')).some((r) => r.id === tarea.id));
await toggle('task', tarea.id, true);
assert((await view('ana')).some((r) => r.id === tarea.id));

await toggle('group', 'x', true, 'docente', 400);
await call('docente', '/api/record', { course: c, kind: 'material', id: material.id }, 200, 'DELETE');
await toggle('material', material.id, true, 'docente', 404); // en la papelera

// El JSON del elemento se conserva intacto al cambiar la visibilidad.
const saved = (await view('docente')).find((r) => r.id === unidad.id);
assert.deepEqual([saved.data.title, saved.data.body, saved.data.fileIds, saved.data.visible], ['Unidad 1', '**Cinemática**', [programa], true]);

// ---- Vista como alumno: el docente recibe exactamente lo que recibe un alumno ----
await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Q', visible: true, questions: [{ text: '¿1+1?', options: ['1', '2'], correct: 1 }] } }, 201);
await call('docente', '/api/record', { course: c, kind: 'notice', data: { title: 'Borrador', body: '', visible: false } }, 201);
const real = await call('ana', '/api/course?id=' + c);
const vista = await call('docente', '/api/course?id=' + c + '&as=student');
const normal = await call('docente', '/api/course?id=' + c);
assert.deepEqual([vista.canTeach, vista.canPreview, vista.preview, vista.canDelete], [false, true, true, false]);
assert.deepEqual([normal.canTeach, normal.canPreview, normal.preview], [true, true, false]);
const ids = (r) => r.records.filter((x) => x.kind !== 'grading').map((x) => x.id).sort();
assert.deepEqual(ids(vista), ids(real), 'Mismos elementos que un alumno (sin ocultos ni eliminados)');
assert(ids(normal).length > ids(vista).length, 'El docente normalmente ve más');
assert(vista.records.filter((r) => r.kind === 'quiz').every((q) => q.data.questions.every((x) => x === null)), 'Sin preguntas antes de contestar (ni respuestas correctas)');
assert(vista.members.every((m) => !('email' in m) && !('matricula' in m)), 'Sin correos ni matrículas');
assert.deepEqual(vista.files.map((f) => f.id).sort(), real.files.map((f) => f.id).sort(), 'Mismos archivos visibles');
assert(!vista.records.some((r) => r.kind === 'submission' || r.kind === 'attempt'), 'Sin entregas propias ni ajenas');
// Un alumno que pide la vista de alumno no gana nada; la asistencia también se filtra.
const trampa = await call('ana', '/api/course?id=' + c + '&as=student');
assert.deepEqual([trampa.canTeach, trampa.canPreview, trampa.preview], [false, false, false]);
await call('docente', '/api/attendance/session', { course: c, date: '2026-10-01', start_time: '08:00' }, 201);
const asistencia = await call('docente', '/api/attendance?course=' + c + '&as=student');
assert.deepEqual([asistencia.canTeach, asistencia.records.length, asistencia.sessions.length], [false, 0, 1]);
assert.equal((await call('docente', '/api/attendance?course=' + c)).canTeach, true);
checks += 12;

console.log(`PASS: ${checks} verificaciones de contenido — archivos en unidades con permisos por visibilidad, mostrar/ocultar con un toque y vista como alumno idéntica a la de un alumno real.`);
