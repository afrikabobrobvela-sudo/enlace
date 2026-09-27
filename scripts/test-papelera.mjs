// Pruebas de la papelera (eliminar y restaurar), nombres de alumnos en foros y cuotas de archivos.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'docente@example.test', SESSION_SECRET: 'p'.repeat(40) };
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
  assert.equal(res.status, status, `${method} ${path} → ${text}`);
  checks++;
  return JSON.parse(text);
}

await call('docente', '/api/me');
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '101' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: ['ana', 'luis'].map((n) => ({ name: n, email: n + '@example.test' })) });
const record = async (kind, data, user = 'docente') => call(user, '/api/record', { course: c, kind, data }, 201);
const remove = (kind, id, user = 'docente', status = 200) => call(user, '/api/record', { course: c, kind, id }, status, 'DELETE');
const restore = (kind, id, status = 200) => call('docente', '/api/trash/restore', { course: c, kind, id }, status);
const view = (user) => call(user, '/api/course?id=' + c);
const ids = async (user, kind) => (await view(user)).records.filter((r) => r.kind === kind).map((r) => r.id);
const download = async (user, id, status = 200) => {
  const res = await api(new Request('https://t.local/api/file/' + id, { headers: { cookie: cookies[user] } }), env);
  assert.equal(res.status, status, 'descarga de ' + id);
  checks++;
};
const trash = async () => (await call('docente', '/api/trash?course=' + c)).items;

// ---- Publicaciones de foro: el docente modera, el autor retira la suya, nadie más ----
const forum = await record('forum', { title: 'Dudas', body: '' });
const ofensiva = await record('post', { forum: forum.id, title: 'Spam', body: 'texto inapropiado' }, 'ana');
const propia = await record('post', { forum: forum.id, title: 'Pregunta', body: '¿Cuándo es el examen?' }, 'luis');
await remove('post', ofensiva.id, 'luis', 403); // otro alumno no puede
await remove('post', ofensiva.id); // el docente sí
await remove('post', propia.id, 'luis'); // el autor retira la suya
await remove('post', propia.id, 'docente', 404); // ya no está
assert.deepEqual(await ids('ana', 'post'), []);
assert.deepEqual(await ids('docente', 'post'), [], 'Tampoco el docente la ve fuera de la papelera');
await call('ana', '/api/trash?course=' + c, undefined, 403);
let items = await trash();
assert.deepEqual(items.map((i) => i.kind).sort(), ['post', 'post']);
assert.match(items.find((i) => i.id === ofensiva.id).title, /Spam · ana/);
assert.equal(items.find((i) => i.id === ofensiva.id).deletedBy, 'docente');
await restore('post', propia.id);
assert.deepEqual(await ids('ana', 'post'), [propia.id]);

// ---- Foro: sus publicaciones no vuelven sin él ----
await remove('forum', forum.id);
assert.deepEqual(await ids('ana', 'forum'), []);
await call('ana', '/api/record', { course: c, kind: 'post', data: { forum: forum.id, title: 'x', body: 'y' } }, 404);
await restore('post', ofensiva.id, 409); // el foro sigue en la papelera
await restore('forum', forum.id);
assert.deepEqual(await ids('ana', 'forum'), [forum.id]);

// ---- Unidades y materiales: los archivos de un material eliminado ya no se descargan ----
const upload = await (async () => {
  const res = await api(
    new Request(`https://t.local/api/upload?course=${c}&scope=material`, {
      method: 'POST',
      headers: { cookie: cookies.docente, Origin: 'https://t.local', 'X-Aula-Request': '1', 'x-file-name': 'guia.pdf', 'content-type': 'application/pdf' },
      body: '%PDF-1.4 guía',
    }),
    env,
  );
  assert.equal(res.status, 201);
  return res.json();
})();
const unidad = await record('module', { title: 'Unidad 1', body: '' });
const material = await record('material', { title: 'Guía', body: '', module: unidad.id, fileIds: [upload.id] });
await download('ana', upload.id);
await remove('module', unidad.id, 'docente', 409); // tiene un material
await remove('material', material.id);
await download('ana', upload.id, 403);
await remove('module', unidad.id);
await call('docente', '/api/record', { course: c, kind: 'material', data: { title: 'Otra', module: unidad.id } }, 404);
await restore('material', material.id, 409); // su unidad sigue en la papelera
await restore('module', unidad.id);
await restore('material', material.id);
await download('ana', upload.id);
assert.deepEqual(await ids('ana', 'material'), [material.id]);

// ---- Evaluación: se conservan los intentos ----
const quiz = await record('quiz', { title: 'Q1', body: '', questions: [{ text: '1+1', options: ['1', '2'], correct: 1 }] });
await call('ana', '/api/attempt', { course: c, quiz: quiz.id, answers: [1] }, 201);
await remove('quiz', quiz.id, 'ana', 403);
await remove('quiz', quiz.id);
await call('luis', '/api/attempt', { course: c, quiz: quiz.id, answers: [1] }, 404);
await restore('quiz', quiz.id);
assert.equal((await view('ana')).records.find((r) => r.kind === 'attempt' && r.data.quiz === quiz.id).data.score, 10);

// ---- Actividad: entregas y calificaciones se conservan y vuelven al restaurar ----
const tarea = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Tarea 1', visible: true } }, 201);
const otra = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Tarea 2', visible: true } }, 201);
await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: tarea.id, body: 'mi respuesta' } }, 201);
const ana = (await view('docente')).members.find((m) => m.email === 'ana@example.test').id;
const graded = (await view('docente')).records.find((r) => r.kind === 'submission' && r.data.task === tarea.id);
await call('docente', '/api/grade', { course: c, task: tarea.id, member: ana, revision: graded.revision, grade: 9, feedback: 'Bien' });
await remove('task', tarea.id, 'ana', 403);
await remove('task', tarea.id);
let teacherView = await view('docente');
assert.deepEqual(teacherView.records.filter((r) => r.kind === 'task').map((r) => r.id), [otra.id]);
assert(!teacherView.records.some((r) => r.kind === 'submission' && r.data.task === tarea.id), 'Sus entregas no se muestran ni cuentan');
assert(!(await view('ana')).records.some((r) => r.kind === 'submission'));
await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: tarea.id, body: 'otra' } }, 404);
await call('docente', '/api/grade', { course: c, task: tarea.id, member: ana, revision: 2, grade: 5 }, 404);
// Los pesos solo consideran las actividades activas.
await call('docente', '/api/record', { course: c, kind: 'weights', data: { weights: { [otra.id]: 100 } } }, 201);
items = await trash();
assert.equal(items.find((i) => i.id === tarea.id).submissions, 1);
await restore('task', tarea.id);
await restore('task', tarea.id, 404);
const back = (await view('ana')).records.find((r) => r.kind === 'submission' && r.data.task === tarea.id);
assert.deepEqual([back.data.grade, back.data.feedback], [9, 'Bien'], 'La calificación vuelve intacta');

// ---- Nombres: un alumno no cambia el suyo y publica con el de la lista del curso ----
await call('ana', '/api/profile', { name: 'Dr. Vela' }, 403);
await call('docente', '/api/member', { course: c, name: 'Ana Pérez López', email: 'ana@example.test' });
const post = await record('post', { forum: forum.id, title: 'Hola', body: 'texto' }, 'ana');
assert.equal(post.data.name, 'Ana Pérez López');
await call('docente', '/api/profile', { name: 'Dr. Docente' });
assert.equal((await call('docente', '/api/me')).name, 'Dr. Docente');

// ---- Cuota de archivos por alumno ----
const uploadAs = async (user, bytes, scope = 'submission') =>
  (
    await api(
      new Request(`https://t.local/api/upload?course=${c}&scope=${scope}`, {
        method: 'POST',
        headers: { cookie: cookies[user], Origin: 'https://t.local', 'X-Aula-Request': '1', 'x-file-name': 'a.pdf', 'content-length': String(bytes) },
        body: new Uint8Array(bytes),
      }),
      env,
    )
  ).status;
store.raw().prepare("INSERT INTO aula_files (id,course,owner,scope,name,size,mime,created) SELECT 'lleno',?,id,'submission','x',?,'x','' FROM aula_users WHERE email='luis@example.test'").run(c, 300 * 1024 * 1024 - 10);
assert.equal(await uploadAs('luis', 100), 413, 'Sobre la cuota del alumno');
assert.equal(await uploadAs('ana', 100), 201, 'Otro alumno no se ve afectado');
assert.equal(await uploadAs('docente', 100, 'material'), 201);
store.raw().prepare("UPDATE aula_files SET size=? WHERE id='lleno'").run(9 * 1024 * 1024 * 1024);
assert.equal(await uploadAs('docente', 100, 'material'), 507, 'Plataforma casi llena');
store.raw().prepare("DELETE FROM aula_files WHERE id='lleno'").run();
checks += 4;

// ---- Tipos que no van a la papelera y cursos ajenos ----
await remove('group', 'x', 'docente', 400);
await call('docente', '/api/teachers', { email: 'colega@example.test', name: 'Colega', role: 'teacher' });
await remove('material', material.id, 'colega', 403);
await call('colega', '/api/trash/restore', { course: c, kind: 'task', id: tarea.id }, 403);

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), [], 'Sin llaves foráneas rotas');
console.log(`PASS: ${checks} verificaciones de papelera, nombres y cuotas — moderación de foros, contenido y actividades se eliminan sin perder datos y se restauran; alumnos sin cambio de nombre; cuotas de archivos.`);
