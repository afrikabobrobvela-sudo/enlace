// Anotaciones sobre entregas (12.69): solo quien enseña anota archivos de entregas; el alumno las ve (y sabe que
// existen) solo en sus entregas con calificación publicada; otro alumno nunca; los datos se limpian y acotan.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
let checks = 0;
const cookies = {};
const cookie = async (who) => (cookies[who] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who }), env));
async function call(who, path, data, status = 200) {
  const before = store.counter.queries;
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
  assert(store.counter.queries - before <= 50, `${path}: ${store.counter.queries - before} consultas`);
  checks++;
  return JSON.parse(text);
}
async function upload(who, course, scope, name) {
  const res = await api(
    new Request(`https://t.local/api/upload?course=${course}&scope=${scope}`, {
      method: 'POST',
      headers: { cookie: await cookie(who), Origin: 'https://t.local', 'X-Aula-Request': '1', 'X-File-Name': name },
      body: '%PDF-1.4 prueba',
    }),
    env,
  );
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()).id;
}

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física', group: '1' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: [{ name: 'Ana', email: 'ana@example.test' }, { name: 'Beto', email: 'beto@example.test' }] });
const tarea = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Reporte', visible: true } }, 201);
const anaFile = await upload('ana', c, 'submission', 'reporte.pdf');
const betoFile = await upload('beto', c, 'submission', 'reporte-beto.pdf');
const material = await upload('docente', c, 'material', 'guia.pdf');
await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: tarea.id, body: 'Mi reporte', fileIds: [anaFile] } }, 201);
await call('beto', '/api/record', { course: c, kind: 'submission', data: { task: tarea.id, body: 'El mío', fileIds: [betoFile] } }, 201);

const marks = {
  pages: {
    1: [
      { t: 'pen', c: '#c0183f', pts: [[0.1, 0.1], [0.2, 0.25], [9, -3]] },
      { t: 'box', x: 0.3, y: 0.4, w: 0.2, h: 0.05 },
      { t: 'text', x: 0.5, y: 0.5, s: '  Revisa las unidades  ' },
    ],
    2: [],
  },
};

// ---- Solo quien enseña anota, y solo archivos de entregas del curso ----
await call('ana', '/api/annotation', { course: c, file: anaFile, data: marks }, 403);
await call('docente', '/api/annotation', { course: c, file: material, data: marks }, 404);
await call('docente', '/api/annotation', { course: c, file: anaFile, data: { pages: { 1: [{ t: 'script', s: 'x' }] } } }, 400);
await call('docente', '/api/annotation', { course: c, file: anaFile, data: { pages: { '<b>': [] } } }, 400);
await call('docente', '/api/annotation', { course: c, file: anaFile, data: { pages: { 1: [{ t: 'text', x: 0, y: 0, s: '   ' }] } } }, 400);
const saved = await call('docente', '/api/annotation', { course: c, file: anaFile, data: marks });
assert.deepEqual(saved.data.pages[1][0].pts[2], [5, 0], 'Coordenadas acotadas');
assert.equal(saved.data.pages[1][2].s, 'Revisa las unidades');
assert.equal(saved.data.pages[2], undefined, 'Las páginas vacías no se guardan');
assert.deepEqual((await call('docente', `/api/annotation?course=${c}&file=${anaFile}`)).data, saved.data);
checks += 4;

// ---- El alumno: solo con la calificación publicada, y solo lo suyo ----
const anaSub = () => call('docente', '/api/course?id=' + c).then((d) => d.records.find((r) => r.kind === 'submission' && r.data.body === 'Mi reporte'));
let sub = await anaSub();
await call('docente', '/api/grade', { course: c, task: tarea.id, member: sub.data.member, revision: sub.revision, grade: 8, feedback: 'Bien', publish: false });
assert.deepEqual((await call('ana', '/api/course?id=' + c)).annotated, [], 'Borrador: todavía no las ve');
await call('ana', `/api/annotation?course=${c}&file=${anaFile}`, undefined, 404);
sub = await anaSub();
await call('docente', '/api/grade', { course: c, task: tarea.id, member: sub.data.member, revision: sub.revision, grade: 8, feedback: 'Bien', publish: true });
assert.deepEqual((await call('ana', '/api/course?id=' + c)).annotated.map((x) => x.file_id), [anaFile]);
assert.equal((await call('ana', `/api/annotation?course=${c}&file=${anaFile}`)).data.pages[1].length, 3);
await call('beto', `/api/annotation?course=${c}&file=${anaFile}`, undefined, 404);
assert.deepEqual((await call('beto', '/api/course?id=' + c)).annotated, []);
assert.deepEqual((await call('docente', '/api/course?id=' + c)).annotated.map((x) => x.file_id), [anaFile]);
assert.deepEqual((await call('docente', `/api/course?id=${c}&as=student`)).annotated, [], 'La vista de alumno no ve las de nadie');
checks += 5;

// ---- Borrar todas las marcas quita la anotación ----
await call('docente', '/api/annotation', { course: c, file: anaFile, data: { pages: {} } });
assert.deepEqual((await call('docente', '/api/course?id=' + c)).annotated, []);
await call('ana', `/api/annotation?course=${c}&file=${anaFile}`, undefined, 404);
checks++;

console.log(`PASS: ${checks} verificaciones de anotaciones — solo el docente anota entregas, el alumno las ve con la calificación publicada y solo las suyas, y los datos se limpian.`);
