// Pruebas de periodos: copiar un curso al siguiente semestre y archivar cursos (solo lectura).
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'z'.repeat(40) };
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
  assert.equal(res.status, status, `${method} ${path} (${user}) → ${text}`);
  checks++;
  return JSON.parse(text);
}
async function upload(user, course, name) {
  const res = await send(user, `/api/upload?course=${course}&scope=material`, { method: 'POST', headers: { 'x-file-name': name }, body: '%PDF-1.4 ' + name });
  return { status: res.status, id: res.ok ? (await res.json()).id : null };
}
const download = async (user, id) => (await send(user, '/api/file/' + id)).status;

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
await call('admin', '/api/teachers', { email: 'otra@example.test', name: 'Otra', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '501', period: 'Primavera 2026' }, 201)).id;
await call('docente', '/api/member', { course: c, name: 'Ana', email: 'ana@example.test' });
const view = (user, course = c) => call(user, '/api/course?id=' + course);

// ---- Curso de origen con todo tipo de contenido ----
const guia = (await upload('docente', c, 'guia.pdf')).id;
const foto = (await upload('docente', c, 'foto.png')).id;
await call('docente', '/api/course-guide', { course: c, sections: Array.from({ length: 7 }, (_, i) => ({ title: 'Apartado ' + i, body: 'Texto' })) }, 201);
const unidad = await call('docente', '/api/record', { course: c, kind: 'module', data: { title: 'Unidad 1', body: `Mira: ![diagrama](archivo:${foto})`, visible: true, fileIds: [foto] } }, 201);
await call('docente', '/api/record', { course: c, kind: 'material', data: { title: 'Guía', module: unidad.id, fileIds: [guia], visible: true } }, 201);
const foro = await call('docente', '/api/record', { course: c, kind: 'forum', data: { title: 'Dudas', body: '' } }, 201);
await call('ana', '/api/record', { course: c, kind: 'post', data: { forum: foro.id, title: 'Hola', body: 'pregunta' } }, 201);
await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Diagnóstico', visible: true, questions: [{ text: '¿1+1?', options: ['1', '2'], correct: 1 }] } }, 201);
const g0 = (await view('docente')).records.find((r) => r.kind === 'grading');
await call('docente', '/api/grades/final-rules', { course: c, revision: g0.revision, passing: 7, missingAsZero: true });
const tarea = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Práctica 1', visible: true, due: '2026-03-10T12:00:00Z', fileIds: [guia] } }, 201);
const g1 = (await view('docente')).records.find((r) => r.kind === 'grading');
await call('docente', '/api/grades/scheme', { course: c, revision: g1.revision, scheme: 'categories', categories: [{ key: 'p', name: 'Prácticas', weight: 100 }], assignments: [{ task: tarea.id, category: 'p', points: 2 }] });
await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: tarea.id, body: 'mi trabajo' } }, 201);
await call('docente', '/api/attendance/settings', { course: c, min_percent: 90, lates_per_absence: 3, excused_counts: 'excluded' });
const borrada = await call('docente', '/api/record', { course: c, kind: 'notice', data: { title: 'Eliminada', body: '' } }, 201);
await call('docente', '/api/record', { course: c, kind: 'notice', id: borrada.id }, 200, 'DELETE');

// ---- Copiar ----
await call('ana', '/api/course/copy', { course: c, name: 'x', group: 'y' }, 403);
await call('otra', '/api/course/copy', { course: c, name: 'x', group: 'y' }, 403); // no enseña en ese curso
const copia = await call('docente', '/api/course/copy', { course: c, name: 'Física I', group: '502', period: 'Otoño 2026' }, 201);
const n = copia.id;
const nuevo = await view('docente', n);
assert.deepEqual([nuevo.course.period, nuevo.course.group_name, nuevo.members.length], ['Otoño 2026', '502', 0], 'Sin alumnos');
const kinds = (r) => r.records.filter((x) => !['grading', 'weights', 'rubric'].includes(x.kind)).map((x) => x.kind).sort();
assert.deepEqual(kinds(nuevo), ['forum', 'material', 'material', 'material', 'material', 'material', 'material', 'material', 'material', 'module', 'module', 'quiz', 'task']);
assert(!nuevo.records.some((r) => ['post', 'submission', 'attempt'].includes(r.kind)), 'Sin publicaciones, entregas ni intentos');
assert(nuevo.records.some((r) => r.id === 'courseguide:' + n), 'La guía conserva su id especial');
assert(!nuevo.records.some((r) => r.data?.title === 'Eliminada'), 'Lo eliminado no se copia');
const nuevaUnidad = nuevo.records.find((r) => r.kind === 'module' && r.data.title === 'Unidad 1');
const nuevoMaterial = nuevo.records.find((r) => r.kind === 'material' && r.data.title === 'Guía');
assert.equal(nuevoMaterial.data.module, nuevaUnidad.id, 'El material apunta a la unidad copiada');
const [nuevaFoto] = nuevaUnidad.data.fileIds;
assert.notEqual(nuevaFoto, foto);
assert.equal(nuevaUnidad.data.body, `Mira: ![diagrama](archivo:${nuevaFoto})`, 'Las imágenes del texto apuntan al archivo copiado');
const nuevaTarea = nuevo.records.find((r) => r.kind === 'task');
assert.deepEqual([nuevaTarea.data.due, nuevaTarea.data.points], ['', 2], 'Fechas vacías para el nuevo periodo; conserva el valor');
const nuevoGrading = nuevo.records.find((r) => r.kind === 'grading');
assert.deepEqual([nuevoGrading.data.scheme, nuevoGrading.data.final.passing, nuevoGrading.data.final.failingAs], ['categories', 7, null]);
assert.equal(nuevaTarea.data.category, nuevoGrading.data.categories[0].id, 'La actividad queda en la categoría copiada');
assert.equal(nuevo.files.length, 2);
assert.equal((await call('docente', '/api/attendance?course=' + n)).settings.min_percent, 90);
// Los archivos se comparten (misma copia en R2) y respetan los permisos del curso nuevo.
assert.equal(await download('docente', nuevaFoto), 200);
assert.equal(await download('ana', nuevaFoto), 403, 'Ana no está inscrita en el curso nuevo');
assert.equal(store.raw().prepare('SELECT r2_key FROM aula_files WHERE id=?').get(nuevaFoto).r2_key, foto);
// Con las fechas: se conservan si se pide.
const conFechas = await call('docente', '/api/course/copy', { course: c, name: 'Física I', group: '503', keepDates: true }, 201);
assert.equal((await view('docente', conFechas.id)).records.find((r) => r.kind === 'task').data.due, '2026-03-10T12:00:00.000Z');
checks += 4;

// ---- Archivar: solo lectura para todos ----
await call('ana', '/api/course/archive', { course: c }, 403);
await call('otra', '/api/course/archive', { course: c }, 403);
await call('docente', '/api/course/archive', { course: c });
assert((await call('docente', '/api/courses')).find((x) => x.id === c).archived_at, 'Se marca como archivado');
assert.equal((await view('ana')).course.archived_at !== null, true, 'El alumno lo sigue consultando');
await call('docente', '/api/record', { course: c, kind: 'notice', data: { title: 'Nueva', body: '' } }, 409);
await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: tarea.id, body: 'otra versión' } }, 409);
await call('docente', '/api/attendance/session', { course: c, date: '2026-05-01' }, 409);
// Aunque se declare otro tipo de contenido, el cuerpo se revisa igual.
const disfrazada = await send('docente', '/api/record', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ course: c, kind: 'notice', data: { title: 'x', body: '' } }) });
assert.equal(disfrazada.status, 409);
assert.equal((await upload('docente', c, 'x.pdf')).status, 409);
assert.equal(await download('ana', guia), 200, 'Los archivos se siguen descargando');
await call('docente', '/api/course/copy', { course: c, name: 'Física I', group: '504' }, 201); // copiar un archivado sí se puede
await call('admin', '/api/course/archive', { course: c, archived: false });
await call('docente', '/api/record', { course: c, kind: 'notice', data: { title: 'Nueva', body: '' } }, 201);

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), [], 'Sin llaves foráneas rotas');
console.log(`PASS: ${checks} verificaciones de periodos — copiar un curso (contenido, actividades, categorías, reglas y archivos compartidos, sin alumnos ni entregas) y archivar cursos de solo lectura.`);
