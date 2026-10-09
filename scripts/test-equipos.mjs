// Pruebas de equipos por sección y calificar individual o por equipo (12.63): un equipo no mezcla secciones, cada alumno
// va en un solo equipo por categoría, la misma categoría se repite por sección, el docente cambia el modo de calificar
// sin abrir el editor y capturar en el libro aplica al equipo sin borrar comentarios.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
let checks = 0;
const cookies = {};
async function call(who, path, data, status = 200) {
  cookies[who] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who }), env);
  const before = store.counter.queries;
  const res = await api(
    new Request('https://t.local' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { cookie: cookies[who], Origin: 'https://t.local', 'X-Aula-Request': '1' },
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

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '5.º semestre' }, 201)).id;
const av = (await call('docente', '/api/sections', { course: c, name: '5AV' }, 201)).id;
const bv = (await call('docente', '/api/sections', { course: c, name: '5BV' }, 201)).id;
await call('docente', '/api/members/bulk', {
  course: c,
  students: [
    { name: 'Ana', email: 'ana@example.test', section: '5AV' },
    { name: 'Beto', email: 'beto@example.test', section: '5AV' },
    { name: 'Carla', email: 'carla@example.test', section: '5AV' },
    { name: 'Dani', email: 'dani@example.test', section: '5BV' },
    { name: 'Eva', email: 'eva@example.test', section: '5BV' },
  ],
});
let data = await call('docente', '/api/course?id=' + c);
const id = (n) => data.members.find((m) => m.email === n + '@example.test').id;
const group = (title, members, section, status = 201, category = 'Laboratorio') =>
  call('docente', '/api/record', { course: c, kind: 'group', data: { title, category, section, members: members.map(id), visible: true } }, status);

// ---- Un equipo no mezcla secciones ----
const mezcla = await group('Equipo X', ['ana', 'dani'], av, 400);
assert.match(mezcla.error, /diferentes secciones en un equipo: Dani es de otra sección/);
await group('Equipo X', ['ana', 'beto'], 'otra', 404);
const e1 = await group('Equipo 1', ['ana', 'beto'], av);
assert.equal(e1.data.section, av);
// Un alumno solo va en un equipo por categoría (en otra categoría sí puede repetirse).
const repetido = await group('Equipo 2', ['beto', 'carla'], av, 409);
assert.match(repetido.error, /Beto ya está en "Equipo 1" de "Laboratorio"/);
await group('Proyecto A', ['beto', 'carla'], av, 201, 'Proyecto');
// Editar el mismo equipo no choca consigo mismo.
await call('docente', '/api/record', { course: c, kind: 'group', id: e1.id, revision: e1.revision, data: { title: 'Equipo 1', category: 'Laboratorio', section: av, members: [id('ana'), id('beto'), id('carla')], visible: true } });
checks += 3;

// ---- En lote: de una sección; la misma categoría se puede repetir en otra sección ----
await call('docente', '/api/groups/bulk', { course: c, category: 'Laboratorio', section: bv, groups: [{ title: 'Equipo 1', members: [id('dani'), id('ana')] }] }, 400);
const otra = await call('docente', '/api/groups/bulk', { course: c, category: 'Laboratorio', section: av, groups: [{ title: 'Equipo 9', members: [] }] }, 409);
assert.match(otra.error, /en esta sección/);
await call('docente', '/api/groups/bulk', { course: c, category: 'Laboratorio', section: bv, groups: [{ title: 'Equipo 1', members: [id('dani'), id('eva')] }] }, 201);
data = await call('docente', '/api/course?id=' + c);
const lab = data.records.filter((r) => r.kind === 'group' && r.data.category === 'Laboratorio');
assert.deepEqual(lab.map((g) => g.data.section).sort(), [av, bv].sort());
checks += 2;

// ---- Calificar individual o por equipo ----
const tarea = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Práctica 1', visible: true } }, 201);
await call('docente', '/api/task/team', { course: c, id: tarea.id, groupCategory: 'No existe' }, 404);
await call('ana', '/api/task/team', { course: c, id: tarea.id, groupCategory: 'Laboratorio' }, 403);
await call('docente', '/api/task/team', { course: c, id: tarea.id, groupCategory: 'Laboratorio' });
data = await call('docente', '/api/course?id=' + c);
assert.equal(data.records.find((r) => r.id === tarea.id).data.groupCategory, 'Laboratorio');
checks++;

// Comentario individual a Ana; luego, desde el libro (sin `feedback`), 8 para todo su equipo: el comentario se conserva.
await call('docente', '/api/grade', { course: c, task: tarea.id, member: id('ana'), grade: 6, feedback: 'Revisa la gráfica', publish: true });
const sub = (n) => data.records.find((r) => r.kind === 'submission' && r.data.task === tarea.id && r.data.member === id(n));
data = await call('docente', '/api/course?id=' + c);
const libro = await call('docente', '/api/grade', { course: c, task: tarea.id, member: id('ana'), revision: sub('ana').revision, grade: 8, publish: true, team: true });
assert.equal(libro.teamRecords.length, 2);
data = await call('docente', '/api/course?id=' + c);
assert.deepEqual(['ana', 'beto', 'carla'].map((n) => sub(n).data.grade), [8, 8, 8]);
assert.equal(sub('ana').data.feedback, 'Revisa la gráfica');
assert.equal(sub('dani'), undefined); // el equipo de otra sección no se toca
checks += 4;
// Individual: solo Beto.
await call('docente', '/api/grade', { course: c, task: tarea.id, member: id('beto'), revision: sub('beto').revision, grade: 9, publish: true });
data = await call('docente', '/api/course?id=' + c);
assert.deepEqual(['ana', 'beto', 'carla'].map((n) => sub(n).data.grade), [8, 9, 8]);
// De vuelta a individual: ya no se puede aplicar al equipo.
await call('docente', '/api/task/team', { course: c, id: tarea.id, groupCategory: '' });
await call('docente', '/api/grade', { course: c, task: tarea.id, member: id('ana'), revision: sub('ana').revision, grade: 7, team: true }, 400);
checks += 2;

console.log(`PASS: ${checks} verificaciones de equipos — sin mezclar secciones, un equipo por categoría, categoría por sección, calificar individual o por equipo y comentarios conservados.`);
