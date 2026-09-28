// Pruebas del historial de calificaciones, los reportes por academia y unidad y la limpieza de archivos huérfanos.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const bucket = memoryBucket();
const env = { DB: store.DB, BUCKET: bucket, AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'r'.repeat(40) };
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
  const before = store.counter.queries;
  const res = await send(user, path, { method, body: data === undefined ? undefined : JSON.stringify(data) });
  const text = await res.text();
  assert.equal(res.status, status, `${method} ${path} (${user}) → ${text}`);
  assert(store.counter.queries - before <= 50, `${path}: demasiadas consultas`);
  checks++;
  return JSON.parse(text);
}
async function upload(user, course, name, scope = 'material') {
  const res = await send(user, `/api/upload?course=${course}&scope=${scope}`, { method: 'POST', headers: { 'x-file-name': name }, body: '%PDF-1.4 ' + name });
  assert.equal(res.status, 201);
  return (await res.json()).id;
}
const sql = (q, ...p) => store.raw().prepare(q).all(...p);

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '501', period: 'Otoño 2026' }, 201)).id;
await call('docente', '/api/member', { course: c, name: 'Ana', email: 'ana@example.test' });
await call('docente', '/api/member', { course: c, name: 'Luis', email: 'luis@example.test' });
const members = (await call('docente', '/api/course?id=' + c)).members;
const ana = members.find((m) => m.email === 'ana@example.test').id;
const luis = members.find((m) => m.email === 'luis@example.test').id;
const tarea = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Práctica 1', visible: true, allowResubmit: true } }, 201);

// ---- Historial de calificaciones ----
const historial = (member) => call('docente', `/api/grade-history?course=${c}&task=${tarea.id}&member=${member}`);
await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: tarea.id, body: 'primera versión' } }, 201);
const entrega = (await call('docente', '/api/course?id=' + c)).records.find((x) => x.kind === 'submission');
let s = await call('docente', '/api/grade', { course: c, task: tarea.id, member: ana, revision: entrega.revision, grade: 6, feedback: 'Falta el análisis', publish: false });
s = await call('docente', '/api/grade', { course: c, task: tarea.id, member: ana, revision: s.revision, grade: 8, feedback: 'Falta el análisis', publish: false });
// Una revisión vieja no guarda nada ni deja rastro.
await call('docente', '/api/grade', { course: c, task: tarea.id, member: ana, revision: s.revision - 1, grade: 2 }, 409);
await call('docente', '/api/grade', { course: c, task: tarea.id, member: luis, grade: 5, publish: false }); // sin entrega: calificación manual
await call('docente', '/api/grades/publish', { course: c, task: tarea.id });
let h = (await historial(ana)).history;
assert.deepEqual(
  h.map((x) => [x.reason, x.old_grade, x.new_grade, x.old_published, x.new_published, x.feedback_changed]).reverse(),
  [
    ['calificación', null, 6, 1, 0, 1],
    ['calificación', 6, 8, 0, 0, 0],
    ['publicación', 8, 8, 0, 1, 0],
  ],
);
assert.equal(h[0].changed_by, 'Docente');
assert.deepEqual((await historial(luis)).history.map((x) => [x.reason, x.old_grade, x.new_grade]).reverse(), [['calificación', null, 5], ['publicación', 5, 5]]);
// Una nueva entrega borra la calificación: queda registrada.
const propia = (await call('ana', '/api/course?id=' + c)).records.find((r) => r.kind === 'submission');
await call('ana', '/api/record', { course: c, kind: 'submission', id: propia.id, revision: propia.revision, data: { task: tarea.id, body: 'segunda versión' } });
h = (await historial(ana)).history;
assert.deepEqual([h[0].reason, h[0].old_grade, h[0].new_grade, h[0].changed_by], ['nueva entrega', 8, null, 'ana']);
// Solo docentes del curso.
await call('ana', `/api/grade-history?course=${c}&task=${tarea.id}&member=${ana}`, undefined, 403);
checks += 4;

// ---- Reportes ----
const fisica = await call('admin', '/api/catalog', { kind: 'academy', name: 'Física' }, 201);
store.raw().prepare('UPDATE aula_courses SET academy_id=? WHERE id=?').run(fisica.id, c);
const otro = (await call('admin', '/api/courses', { name: 'Cálculo', group: '101' }, 201)).id;
await call('admin', '/api/course/archive', { course: otro });
await call('docente', '/api/reports', undefined, 403);
const r = await call('admin', '/api/reports');
assert.deepEqual([r.totals.courses, r.totals.active, r.totals.teachers, r.totals.students], [2, 1, 2, 2]);
const grupo = r.groups.find((g) => g.academy === 'Física');
assert.deepEqual([grupo.unit, grupo.courses, grupo.students, grupo.tasks, grupo.submissions], ['Sin unidad', 1, 2, 1, 1]);
assert(r.courses.find((x) => x.id === otro).archived_at);
checks += 3;

// ---- Archivos huérfanos ----
const usado = await upload('docente', c, 'usado.pdf');
const suelto = await upload('docente', c, 'suelto.pdf');
const reciente = await upload('docente', c, 'reciente.pdf');
const enPapelera = await upload('docente', c, 'papelera.pdf');
const compartido = await upload('docente', c, 'compartido.pdf');
await call('docente', '/api/record', { course: c, kind: 'material', data: { title: 'Guía', fileIds: [usado], visible: true } }, 201);
const borrado = await call('docente', '/api/record', { course: c, kind: 'material', data: { title: 'Vieja', fileIds: [enPapelera] } }, 201);
await call('docente', '/api/record', { course: c, kind: 'material', id: borrado.id }, 200, 'DELETE');
// Una copia del curso apunta al mismo objeto de R2 con otra fila.
store.raw().prepare("INSERT INTO aula_files (id,course,owner,scope,name,size,mime,created,r2_key) SELECT 'copia-1',course,owner,scope,name,size,mime,created,id FROM aula_files WHERE id=?").run(compartido);
store.raw().prepare("UPDATE aula_files SET created='2026-01-01T00:00:00.000Z' WHERE id<>?").run(reciente);
await call('docente', '/api/storage/orphans', undefined, 403);
const o = await call('admin', '/api/storage/orphans');
assert.deepEqual(o.files.map((f) => f.id).sort(), [suelto, compartido, 'copia-1'].sort(), 'Ni lo enlazado, ni lo reciente, ni lo que está en la papelera');
await call('admin', '/api/storage/cleanup', { ids: [suelto], confirm: 'si' }, 400);
// Se piden también archivos en uso: no se tocan.
const limpio = await call('admin', '/api/storage/cleanup', { ids: [suelto, usado, reciente, enPapelera, compartido], confirm: 'BORRAR ARCHIVOS' });
assert.deepEqual([limpio.deleted, limpio.objects], [2, 1], 'El objeto compartido sigue en R2 mientras la copia exista');
assert(!bucket.blobs.has(suelto) && bucket.blobs.has(compartido) && bucket.blobs.has(usado) && bucket.blobs.has(enPapelera));
const fin = await call('admin', '/api/storage/cleanup', { ids: ['copia-1'], confirm: 'BORRAR ARCHIVOS' });
assert.deepEqual([fin.deleted, fin.objects], [1, 1]);
assert(!bucket.blobs.has(compartido));
assert.equal((await send('docente', '/api/file/' + usado)).status, 200);
checks += 5;

assert.deepEqual(sql('PRAGMA foreign_key_check'), []);
console.log(`PASS: ${checks} verificaciones de historial de calificaciones, reportes por academia y unidad y limpieza de archivos huérfanos.`);
