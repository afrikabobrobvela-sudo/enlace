// Actividades H5P (12.71): dirección firmada solo para quien puede leer el material, el reproductor y los archivos del
// paquete se leen del ZIP en R2 (desinflados o guardados), todo bajo /h5p/ va aislado (CSP sandbox), y el resultado
// guarda la mejor calificación, que el docente lleva al libro.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { api } from '../src/server/api.js';
import worker from '../src/worker.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
let checks = 0;
const cookies = {};
const cookie = async (who) => (cookies[who] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who }), env));
async function call(who, path, data, status = 200) {
  const res = await api(
    new Request('https://t.local' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { cookie: await cookie(who), Origin: 'https://t.local', 'X-Aula-Request': '1' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${who}) → ${text}`);
  checks++;
  return JSON.parse(text);
}
async function upload(who, course, name, body) {
  const res = await api(
    new Request(`https://t.local/api/upload?course=${course}&scope=material`, {
      method: 'POST',
      headers: { cookie: await cookie(who), Origin: 'https://t.local', 'X-Aula-Request': '1', 'X-File-Name': name },
      body,
    }),
    env,
  );
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()).id;
}
const get = (path) => worker.fetch(new Request('https://t.local' + path), env);

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física', group: '1' }, 201)).id;
const otro = (await call('docente', '/api/courses', { name: 'Otro', group: '2' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: [{ name: 'Ana', email: 'ana@example.test' }, { name: 'Beto', email: 'beto@example.test' }] });
await call('docente', '/api/members/bulk', { course: otro, students: [{ name: 'Dani', email: 'dani@example.test' }] });
const h5p = await upload('docente', c, 'prueba.h5p', readFileSync(new URL('./fixtures/prueba.h5p', import.meta.url)));
const pdf = await upload('docente', c, 'guia.pdf', '%PDF-1.4');
const hidden = await call('docente', '/api/record', { course: c, kind: 'material', data: { title: 'Pregunta interactiva', visible: false, fileIds: [h5p] } }, 201);

// ---- Dirección firmada: las mismas reglas que una descarga ----
await call('ana', `/api/h5p/token?course=${c}&file=${h5p}`, undefined, 403); // material oculto
await call('docente', `/api/h5p/token?course=${c}&file=${pdf}`, undefined, 404); // no es .h5p
await call('dani', `/api/h5p/token?course=${c}&file=${h5p}`, undefined, 403);
const shown = await call('docente', '/api/record', { course: c, kind: 'material', id: hidden.id, revision: hidden.revision, data: { title: 'Pregunta interactiva', visible: true, fileIds: [h5p] } });
const { url } = await call('ana', `/api/h5p/token?course=${c}&file=${h5p}`);
assert.match(url, /^\/h5p\/[A-Za-z0-9_.-]+\/$/);
checks++;

// ---- Reproductor y archivos del paquete, aislados ----
let res = await get(url);
assert.equal(res.status, 200);
assert.match(res.headers.get('content-security-policy'), /^sandbox allow-scripts/);
assert.doesNotMatch(res.headers.get('content-security-policy'), /allow-same-origin/);
assert.equal(res.headers.get('access-control-allow-origin'), '*');
assert.match(await res.text(), /h5p-jugador\.js/);
res = await get(url + 'c/h5p.json');
assert.equal(JSON.parse(await res.text()).mainLibrary, 'H5P.EnlacePrueba', 'Entrada desinflada');
assert.match(res.headers.get('content-type'), /application\/json/);
res = await get(url + 'c/H5P.EnlacePrueba-1.0/prueba.js');
assert.match(await res.text(), /triggerXAPIScored/);
assert.match(res.headers.get('content-security-policy'), /^sandbox/, 'Un archivo abierto directamente también va aislado');
assert.equal(await (await get(url + 'c/H5P.EnlacePrueba-1.0/notas.txt')).text(), 'archivo guardado sin comprimir', 'Entrada guardada sin comprimir');
assert.equal((await get(url + 'c/content/content.json')).status, 200);
for (const bad of ['c/../h5p.json', 'c/%2e%2e/x', 'c/no-existe.js', 'x/h5p.json']) assert.equal((await get(url + bad)).status, 404, bad);
assert.equal((await get('/h5p/' + 'a'.repeat(40) + '.firma/')).status, 404, 'Token falso');
const [body, sig] = url.split('/')[2].split('.');
// Se cambia el primer carácter (sus 6 bits cuentan): cambiar los últimos podía dejar los mismos bytes (bits de relleno).
assert.equal((await get(`/h5p/${body}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}/`)).status, 404, 'Firma alterada');
const vendor = await get('/vendor/h5p-standalone-3.8.2/fonts/h5p-core-30.woff2');
assert.equal(vendor.headers.get('access-control-allow-origin'), '*', 'Las fuentes del reproductor se pueden leer desde el marco');
assert.equal((await get('/index.html')).headers.get('access-control-allow-origin'), null);
checks += 18;

// ---- Resultado: la mejor calificación ----
await call('ana', '/api/progress', { course: c, record: shown.id, action: 'complete', score: 11 }, 400);
await call('ana', '/api/progress', { course: c, record: shown.id, action: 'open', score: 5 }, 400);
await call('ana', '/api/progress', { course: c, record: shown.id, action: 'complete', score: 8 });
await call('ana', '/api/progress', { course: c, record: shown.id, action: 'complete', score: 2 });
await call('beto', '/api/progress', { course: c, record: shown.id, action: 'complete', score: 6.5 });
let course = await call('docente', '/api/course?id=' + c);
const scoreOf = (n) => course.progress.find((p) => p.member === course.members.find((m) => m.email === n + '@example.test').id)?.score;
assert.deepEqual([scoreOf('ana'), scoreOf('beto')], [8, 6.5], 'Se conserva la mejor');
assert.deepEqual((await call('ana', '/api/course?id=' + c)).progress.map((p) => p.score), [8], 'El alumno solo ve el suyo');
checks += 2;

// ---- Al libro: la actividad se crea una vez y el material la recuerda ----
const imported = await call('docente', '/api/grades/import', { course: c, publish: true, activities: [{ title: 'Pregunta interactiva', grades: course.progress.map((p) => ({ member: p.member, grade: p.score })) }] });
assert.equal(imported.tasks.length, 1);
const task = imported.tasks[0].id;
const linked = await call('docente', '/api/record', { course: c, kind: 'material', id: shown.id, revision: shown.revision, data: { title: 'Pregunta interactiva', visible: true, fileIds: [h5p], h5pTask: task } });
assert.equal(linked.data.h5pTask, task);
const edited = await call('docente', '/api/record', { course: c, kind: 'material', id: shown.id, revision: linked.revision, data: { title: 'Pregunta interactiva (editada)', visible: true, fileIds: [h5p] } });
assert.equal(edited.data.h5pTask, task, 'Editar el material no pierde la actividad del libro');
const foreign = (await call('docente', '/api/record', { course: otro, kind: 'task', data: { title: 'Ajena', visible: true } }, 201)).id;
const bad = await call('docente', '/api/record', { course: c, kind: 'material', id: shown.id, revision: edited.revision, data: { title: 'X', visible: true, fileIds: [h5p], h5pTask: foreign } });
assert.equal(bad.data.h5pTask, undefined, 'No acepta una actividad de otro curso');
course = await call('ana', '/api/course?id=' + c);
assert.equal(course.records.find((r) => r.kind === 'submission' && r.data.task === task)?.data.grade, 8);
checks += 4;

console.log(`PASS: ${checks} verificaciones de H5P — dirección firmada con las reglas de descarga, paquete leído del ZIP y aislado, mejor resultado y paso al libro.`);
