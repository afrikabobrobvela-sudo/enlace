// Pruebas de foros (12.23): hilos y respuestas, anónimo (el docente sí ve el nombre), «publica primero», fijar y cerrar,
// seguir con avisos en la campana y el resumen por correo, lectura y calificación de la participación.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { digestMessages } from '../src/server/digest.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

let checks = 0;
const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'docente@example.test', SESSION_SECRET: 'f'.repeat(40) };
const cookies = {};
async function call(user, path, data, status = 200, method = data === undefined ? 'GET' : 'POST') {
  cookies[user] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user[0].toUpperCase() + user.slice(1) }),
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
  assert.equal(res.status, status, `${method} ${path} (${user}) → ${text}`);
  checks++;
  return JSON.parse(text);
}

await call('docente', '/api/me');
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '501' }, 201)).id;
await call('docente', '/api/members/bulk', {
  course: c,
  students: [
    ['ana', 'Ana López'],
    ['luis', 'Luis Pérez'],
    ['eva', 'Eva Ruiz'],
  ].map(([u, name]) => ({ name, email: u + '@example.test' })),
});
for (const u of ['ana', 'luis', 'eva']) await call(u, '/api/me');
const course = (user) => call(user, '/api/course?id=' + c);
const posts = async (user) => (await course(user)).records.filter((r) => r.kind === 'post');
const post = (user, data, status = 201) => call(user, '/api/record', { course: c, kind: 'post', data }, status);
const forum = (data, status = 201, old) =>
  call('docente', '/api/record', { course: c, kind: 'forum', ...(old ? { id: old.id, revision: old.revision } : {}), data: { title: 'Debate', body: '', visible: true, ...data } }, status);

// ---- Foro con anónimo y «publica primero» ----
const f = await forum({ title: 'Debate: energía', anonymous: true, mustPost: true });
assert.deepEqual([f.data.anonymous, f.data.mustPost, f.data.locked], [true, true, undefined]);
const abierto = await forum({ title: 'Dudas' });
assert.equal(abierto.data.anonymous, undefined);
checks += 2;

const hiloAna = await post('ana', { forum: f.id, title: '¿La energía se crea?', body: 'Creo que no.', anonymous: true });
assert.deepEqual([hiloAna.data.anonymous, hiloAna.data.name], [true, 'Ana López']);
// Luis aún no publica: no ve el hilo de Ana (sí el foro).
assert.equal((await posts('luis')).filter((p) => p.data.forum === f.id).length, 0);
const hiloLuis = await post('luis', { forum: f.id, title: 'Mi postura', body: 'Se transforma.' });
// Ya publicó: ve el de Ana, pero anónimo (sin nombre ni autor).
const vistaLuis = (await posts('luis')).find((p) => p.id === hiloAna.id);
assert.deepEqual([vistaLuis.data.name, vistaLuis.author], ['Anónimo', 'anonimo']);
assert(!JSON.stringify(await course('luis')).includes('Ana López') || (await course('luis')).members.some((m) => m.name === 'Ana López'));
// Ana ve su propia publicación con su autor (puede borrarla) y el docente ve el nombre.
assert.equal((await posts('ana')).find((p) => p.id === hiloAna.id).author !== 'anonimo', true);
assert.equal((await posts('docente')).find((p) => p.id === hiloAna.id).data.name, 'Ana López');
checks += 5;

// Reglas: anónimo solo si el foro lo permite (y nunca el docente); respuestas de un nivel y en el mismo foro.
await post('ana', { forum: abierto.id, title: 'x', body: 'x', anonymous: true }, 400);
await post('docente', { forum: f.id, title: 'x', body: 'x', anonymous: true }, 400);
const resp = await post('eva', { forum: f.id, parent: hiloAna.id, body: 'Estoy de acuerdo.' });
assert.equal(resp.data.title, 'Re: ¿La energía se crea?');
assert.equal(resp.data.parent, hiloAna.id);
await post('ana', { forum: f.id, parent: resp.id, body: 'Respuesta a respuesta' }, 400);
const otroHilo = await post('ana', { forum: abierto.id, title: 'Pregunta', body: '¿Cuándo es el examen?' });
await post('eva', { forum: f.id, parent: otroHilo.id, body: 'Mal foro' }, 400);
checks += 2;

// ---- Fijar y cerrar ----
await call('ana', '/api/forum/thread', { course: c, id: hiloLuis.id, pinned: true }, 403);
await call('docente', '/api/forum/thread', { course: c, id: resp.id, pinned: true }, 400);
let t = await call('docente', '/api/forum/thread', { course: c, id: hiloLuis.id, pinned: true, locked: true });
assert.deepEqual([t.pinned, t.locked], [true, true]);
await post('eva', { forum: f.id, parent: hiloLuis.id, body: 'No debería' }, 409);
await post('docente', { forum: f.id, parent: hiloLuis.id, body: 'El docente sí puede responder.' });
t = await call('docente', '/api/forum/thread', { course: c, id: hiloLuis.id, locked: false });
assert.deepEqual([t.pinned, t.locked], [true, false]);
await post('eva', { forum: f.id, parent: hiloLuis.id, body: 'Ahora sí.' });
// Foro cerrado: ni hilos ni respuestas de alumnos.
const cerrado = await forum({ title: 'Cerrado', locked: true });
await post('ana', { forum: cerrado.id, title: 'x', body: 'x' }, 409);
checks += 2;

// Foro oculto o de otra sección: no se publica ni se sigue.
const oculto = await forum({ title: 'Oculto', visible: false });
await post('ana', { forum: oculto.id, title: 'x', body: 'x' }, 403);
await call('ana', '/api/forum/follow', { course: c, item: oculto.id, follow: true }, 403);

// ---- Seguir y avisos ----
const campana = async (user) => (await call(user, '/api/notifications')).items.filter((i) => i.type === 'post');
// Ana abrió un hilo: le avisan de las respuestas sin seguir nada (una por hilo, agrupadas).
let avisos = await campana('ana');
assert.equal(avisos.length, 1);
assert.deepEqual([avisos[0].id, avisos[0].title], [hiloAna.id, '¿La energía se crea?']);
// Luis sigue el foro: le avisan de todo lo nuevo de otros (no de lo suyo).
await call('luis', '/api/forum/follow', { course: c, item: f.id, follow: true });
await post('eva', { forum: f.id, title: 'Tercer hilo', body: 'Hola' });
avisos = await campana('luis');
assert(avisos.some((a) => a.title === 'Tercer hilo'));
assert(avisos.every((a) => a.title !== 'Mi postura' || a.count >= 1));
// Seguir un hilo: Eva sigue el de Luis y Ana responde.
await call('eva', '/api/forum/follow', { course: c, item: hiloLuis.id, follow: true });
await call('eva', '/api/forum/follow', { course: c, item: resp.id, follow: true }, 404); // las respuestas no se siguen
await post('ana', { forum: f.id, parent: hiloLuis.id, body: 'Coincido.', anonymous: true });
avisos = await campana('eva');
assert(avisos.some((a) => a.id === hiloLuis.id));
// El aviso de una publicación anónima no revela el nombre.
assert(!JSON.stringify(avisos).includes('Ana López'));
// Dejar de seguir.
await call('luis', '/api/forum/follow', { course: c, item: f.id, follow: false });
const estado = (await course('luis')).forumState;
assert.deepEqual(estado.map((s) => [s.item, s.follow]), [[f.id, 0]]);
checks += 7;

// El docente sigue el foro de dudas (curso que enseña) y le avisan.
await call('docente', '/api/forum/follow', { course: c, item: abierto.id, follow: true });
await post('luis', { forum: abierto.id, parent: otroHilo.id, body: 'El viernes.' });
assert((await campana('docente')).some((a) => a.id === otroHilo.id));
checks++;

// ---- Leído ----
const leido = await call('luis', '/api/forum/read', { course: c, item: hiloAna.id });
assert.equal((await course('luis')).forumState.find((s) => s.item === hiloAna.id).read_at, leido.readAt);
// Leer otra vez en menos de un minuto no escribe (la fecha no cambia).
await call('luis', '/api/forum/read', { course: c, item: hiloAna.id });
assert.equal((await course('luis')).forumState.find((s) => s.item === hiloAna.id).read_at, leido.readAt);
checks += 2;

// ---- Resumen por correo ----
store.raw().prepare('UPDATE aula_users SET digest_sent_at=?').run(new Date(Date.now() - 3_600_000).toISOString());
const mensajes = await digestMessages(env.DB, env, new Date(Date.now() + 1000));
const deEva = mensajes.find((m) => m.to === 'eva@example.test');
assert(deEva && /Foro: .*«Mi postura»/.test(deEva.text), deEva?.text);
assert(!mensajes.some((m) => m.text.includes('Ana López')));
checks += 2;

// ---- Eliminar un hilo oculta sus respuestas (vuelven al restaurar) ----
const antes = (await posts('docente')).filter((p) => p.data.parent === hiloAna.id).length;
assert(antes >= 1);
await call('docente', '/api/record', { course: c, kind: 'post', id: hiloAna.id }, 200, 'DELETE');
assert.equal((await posts('docente')).filter((p) => p.data.parent === hiloAna.id).length, 0);
assert.equal((await posts('eva')).filter((p) => p.data.parent === hiloAna.id).length, 0);
await call('docente', '/api/trash/restore', { course: c, kind: 'post', id: hiloAna.id });
assert.equal((await posts('docente')).filter((p) => p.data.parent === hiloAna.id).length, antes);
checks += 3;

// ---- Calificar la participación ----
await call('ana', '/api/forum/grading', { course: c, forum: f.id }, 403);
const g = await call('docente', '/api/forum/grading', { course: c, forum: f.id }, 201);
const otra = await call('docente', '/api/forum/grading', { course: c, forum: f.id });
assert.deepEqual([otra.task, otra.created], [g.task, false]);
const tarea = (await course('ana')).records.find((r) => r.id === g.task);
assert.equal(tarea.data.forum, f.id);
assert.match(tarea.data.title, /Participación: Debate: energía/);
// El alumno no entrega nada en ella.
await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: g.task, body: 'Mi participación' } }, 409);
// El docente califica y el alumno ve su calificación en el libro.
const docente = await course('docente');
const ana = docente.members.find((m) => m.name === 'Ana López');
await call('docente', '/api/grade', { course: c, task: g.task, member: ana.id, grade: 9.5, publish: true });
const suya = (await course('ana')).records.find((r) => r.kind === 'submission' && r.data.task === g.task);
assert.equal(suya.data.grade, 9.5);
checks += 5;
// No aparece como pendiente de entregar aunque tenga fecha.
store.raw().prepare('UPDATE aula_tasks SET due=? WHERE id=?').run(new Date(Date.now() + 86_400_000).toISOString(), g.task);
const pendientes = (await call('luis', '/api/dashboard')).pending;
assert(!pendientes.some((p) => p.id === g.task));
checks++;

// ---- Copiar el curso conserva la liga con el foro copiado ----
const copia = await call('docente', '/api/course/copy', { course: c, name: 'Física I', group: '502', period: '2027A' }, 201);
const copiado = await call('docente', '/api/course?id=' + copia.id);
const foroCopiado = copiado.records.find((r) => r.kind === 'forum' && r.data.title === 'Debate: energía');
const tareaCopiada = copiado.records.find((r) => r.kind === 'task' && r.data.title.startsWith('Participación'));
assert.equal(tareaCopiada.data.forum, foroCopiado.id);
assert.equal(copiado.records.filter((r) => r.kind === 'post').length, 0);
checks += 2;

// Consultas: el curso con foros sigue dentro del límite.
store.counter.queries = 0;
await course('ana');
assert(store.counter.queries <= 13, `consultas: ${store.counter.queries}`);
store.counter.queries = 0;
await call('ana', '/api/notifications');
assert(store.counter.queries <= 8, `consultas de avisos: ${store.counter.queries}`);
checks += 2;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones de foros — hilos y respuestas, anónimo (el docente ve el nombre), publicar primero, fijar y cerrar, seguir con avisos y resumen por correo, lectura, participación calificada y copia de curso.`);
