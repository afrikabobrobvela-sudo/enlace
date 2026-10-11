// Mensajes directos (12.70): el docente escribe a uno o a varios, el alumno solo en su conversación, nadie lee la
// ajena, lecturas por lado, aviso en la campana y en el resumen por correo, y tope para el alumno.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { digestMessages } from '../src/server/digest.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
let checks = 0;
const cookies = {};
async function call(who, path, data, status = 200) {
  cookies[who] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who[0].toUpperCase() + who.slice(1) }), env);
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
const c = (await call('docente', '/api/courses', { name: 'Física', group: '1' }, 201)).id;
const otro = (await call('docente', '/api/courses', { name: 'Otro', group: '2' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: ['ana', 'beto', 'carla'].map((n) => ({ name: n[0].toUpperCase() + n.slice(1), email: n + '@example.test' })) });
await call('docente', '/api/members/bulk', { course: otro, students: [{ name: 'Dani', email: 'dani@example.test' }] });
const members = (await call('docente', '/api/course?id=' + c)).members;
const id = (n) => members.find((m) => m.email === n + '@example.test').id;
const daniId = (await call('docente', '/api/course?id=' + otro)).members.find((m) => m.email === 'dani@example.test').id;

// ---- El docente escribe a varios (solo alumnos de este curso) ----
await call('docente', '/api/messages', { course: c, members: [], body: 'Hola' }, 400);
await call('docente', '/api/messages', { course: c, members: [id('ana')], body: '   ' }, 400);
await call('docente', '/api/messages', { course: c, members: [daniId], body: 'Intruso' }, 404);
const sent = await call('docente', '/api/messages', { course: c, members: [id('ana'), id('beto'), daniId], body: 'Recuerden traer la bata el jueves.' }, 201);
assert.equal(sent.sent, 2, 'Dani es de otro curso: no recibe');
checks++;

// ---- Cada alumno ve solo su conversación ----
let ana = await call('ana', `/api/messages/thread?course=${c}&member=${id('beto')}`);
assert.equal(ana.member.id, id('ana'), 'El alumno no puede pedir otra conversación');
assert.deepEqual(ana.messages.map((m) => [m.from_teacher, m.body]), [[1, 'Recuerden traer la bata el jueves.']]);
assert.equal((await call('carla', `/api/messages/thread?course=${c}`)).messages.length, 0);
await call('dani', `/api/messages/thread?course=${c}`, undefined, 403);
await call('dani', '/api/messages', { course: c, body: 'Hola' }, 403);
checks += 3;

// ---- Responder y leídos por lado ----
assert.equal((await call('beto', '/api/messages?course=' + c)).unread, 1);
await call('beto', `/api/messages/thread?course=${c}`);
assert.equal((await call('beto', '/api/messages?course=' + c)).unread, 0, 'Abrirla la marca como leída');
await call('beto', '/api/messages', { course: c, body: '¿Sirve una bata prestada?' }, 201);
let threads = (await call('docente', '/api/messages?course=' + c)).threads;
const betoThread = threads.find((t) => t.member === id('beto'));
assert.deepEqual([betoThread.unread, betoThread.last_body, betoThread.last_from_teacher], [1, '¿Sirve una bata prestada?', 0]);
assert.equal(threads.find((t) => t.member === id('ana')).unread, 0);
await call('docente', `/api/messages/thread?course=${c}&member=${id('beto')}`);
assert.equal((await call('docente', '/api/messages?course=' + c)).threads.find((t) => t.member === id('beto')).unread, 0);
await call('docente', `/api/messages/thread?course=${c}&member=${daniId}`, undefined, 404);
checks += 4;

// ---- Campana y resumen por correo ----
const bell = (who) => call(who, '/api/notifications').then((r) => r.items.filter((i) => i.type === 'message'));
assert.deepEqual((await bell('ana')).map((i) => [i.id, i.title]), [[id('ana'), 'Mensaje de Docente']]);
assert.deepEqual((await bell('carla')), []);
assert.deepEqual((await bell('docente')).map((i) => [i.id, i.title]), [[id('beto'), 'Mensaje de Beto']]);
const mails = await digestMessages(env.DB, env, new Date(Date.now() + 1000));
const text = (who) => mails.find((m) => m.to === who + '@example.test')?.text || '';
assert.match(text('ana'), /Tienes un mensaje nuevo/);
assert.match(text('docente'), /Tienes un mensaje nuevo/);
assert.doesNotMatch(text('carla'), /mensaje/);
checks += 6;

// ---- Tope para el alumno ----
for (let i = 1; i < 30; i++) await call('carla', '/api/messages', { course: c, body: 'Mensaje ' + i }, 201);
await call('carla', '/api/messages', { course: c, body: 'Uno más' }, 201);
assert.match((await call('carla', '/api/messages', { course: c, body: 'Y otro' }, 429)).error, /muchos mensajes/);
checks++;

console.log(`PASS: ${checks} verificaciones de mensajes — el docente escribe a varios, cada alumno solo ve la suya, leídos por lado, campana, resumen por correo y tope.`);
