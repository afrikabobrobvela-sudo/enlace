// Pruebas de condiciones de liberación (12.23): el alumno ve una unidad, material, foro, evaluación o actividad solo
// cuando cumple sus condiciones, por todas las vías (curso, descargas, seguimiento, entregas, evaluaciones, foros,
// avisos, pendientes, calendario y resumen por correo). Quien enseña y la vista general «como alumno» lo ven todo.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { digestMessages } from '../src/server/digest.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'docente@example.test', SESSION_SECRET: 'c'.repeat(40) };
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
async function upload(name) {
  const res = await send('docente', `/api/upload?course=${c}&scope=material`, { method: 'POST', headers: { 'x-file-name': name }, body: '%PDF-1.4 ' + name });
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
await call('docente', '/api/members/bulk', { course: c, students: ['ana', 'luis'].map((n) => ({ name: n, email: n + '@example.test' })) });
await call('ana', '/api/me');
await call('luis', '/api/me');
const record = (kind, data, status = 201) => call('docente', '/api/record', { course: c, kind, data: { visible: true, body: '', ...data } }, status);
const ids = async (user, suffix = '') => new Set((await call(user, '/api/course?id=' + c + suffix)).records.map((r) => r.id));
const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();

// ---- Elementos base y elementos con condiciones ----
const lectura = await record('material', { title: 'Lectura 1' });
const tarea = await record('task', { title: 'Tarea 1', submissionMode: 'text' });
const quiz = await record('quiz', { title: 'Quiz 1', questions: [{ type: 'truefalse', text: '¿2 > 1?', correct: true }], settings: { attempts: 3 } });
const cond = (items, mode = 'all') => ({ mode, items });

// Validación.
await record('module', { title: 'x', conditions: cond([{ type: 'otra', target: lectura.id }]) }, 400);
await record('module', { title: 'x', conditions: cond([{ type: 'material_done', target: 'no-existe' }]) }, 400);
await record('module', { title: 'x', conditions: cond([{ type: 'material_done', target: tarea.id }]) }, 400); // tipo equivocado
await record('task', { title: 'x', conditions: cond([{ type: 'task_grade', target: tarea.id, value: 11 }]) }, 400);
await record('module', { title: 'x', conditions: cond(Array.from({ length: 11 }, () => ({ type: 'material_done', target: lectura.id }))) }, 400);
const sinCondiciones = await record('module', { title: 'Libre', conditions: cond([]) });
assert.equal(sinCondiciones.data.conditions, undefined);
checks++;

const unidad = await record('module', { title: 'Unidad 2', conditions: cond([{ type: 'material_done', target: lectura.id }]) });
const archivo = await upload('guia.pdf');
const dentro = await record('material', { title: 'Guía de la unidad 2', module: unidad.id, fileIds: [archivo] });
const tarea2 = await record('task', { title: 'Tarea 2', submissionMode: 'text', due: soon, conditions: cond([{ type: 'task_grade', target: tarea.id, value: 7 }]) });
const quiz2 = await record('quiz', {
  title: 'Quiz 2',
  questions: [{ type: 'truefalse', text: '¿3 > 1?', correct: true }],
  conditions: cond(
    [
      { type: 'quiz_score', target: quiz.id, value: 8 },
      { type: 'task_submitted', target: tarea.id },
    ],
    'any',
  ),
});
const foro = await record('forum', { title: 'Foro de la lectura', conditions: cond([{ type: 'material_opened', target: lectura.id }]) });
// Una actividad no puede depender de sí misma.
await call('docente', '/api/record', { course: c, kind: 'task', id: tarea2.id, revision: tarea2.revision, data: { title: 'Tarea 2', conditions: cond([{ type: 'task_submitted', target: tarea2.id }]) } }, 400);
assert.deepEqual(tarea2.data.conditions, { mode: 'all', items: [{ type: 'task_grade', target: tarea.id, value: 7 }] });
checks++;

const bloqueados = [unidad.id, dentro.id, tarea2.id, quiz2.id, foro.id];
// Quien enseña y la vista general «como alumno» lo ven todo.
let docente = await ids('docente');
assert(bloqueados.every((id) => docente.has(id)));
const general = await ids('docente', '&as=student');
assert(bloqueados.every((id) => general.has(id)));
// El alumno no ve nada de lo condicionado.
let ana = await ids('ana');
assert(bloqueados.every((id) => !ana.has(id)));
assert([lectura.id, tarea.id, quiz.id].every((id) => ana.has(id)));
checks += 4;

// Por las demás vías tampoco.
await download('ana', archivo, 403);
await call('ana', '/api/progress', { course: c, record: dentro.id, action: 'open' }, 403);
await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: tarea2.id, body: 'Hola' } }, 403);
await call('ana', '/api/attempt/start', { course: c, quiz: quiz2.id }, 403);
await call('ana', '/api/record', { course: c, kind: 'post', data: { forum: foro.id, title: 'x', body: 'x' } }, 403);
await call('ana', '/api/forum/follow', { course: c, item: foro.id, follow: true }, 403);
let avisos = (await call('ana', '/api/notifications')).items.map((i) => i.id);
assert(!avisos.includes(quiz2.id) && !avisos.includes(dentro.id) && !avisos.includes(tarea2.id));
assert(!(await call('ana', '/api/dashboard')).pending.some((p) => p.id === tarea2.id));
const cal = await call('ana', `/api/calendar?from=${new Date().toISOString()}&to=${new Date(Date.now() + 5 * 86_400_000).toISOString()}`);
assert(!JSON.stringify(cal).includes(tarea2.id));
store.raw().prepare('UPDATE aula_users SET digest_sent_at=?').run(new Date(Date.now() - 3_600_000).toISOString());
let correo = (await digestMessages(env.DB, env, new Date(Date.now() + 1000))).find((m) => m.to === 'ana@example.test');
assert(correo && !correo.text.includes('Quiz 2') && !correo.text.includes('Tarea 2') && !correo.text.includes('Guía de la unidad 2'), correo?.text);
checks += 4;

// ---- Cumplir condiciones ----
// Abrir la lectura libera el foro (abrir); completarla, la unidad y su material.
await call('ana', '/api/progress', { course: c, record: lectura.id, action: 'open' });
ana = await ids('ana');
assert(ana.has(foro.id) && !ana.has(unidad.id));
await call('ana', '/api/record', { course: c, kind: 'post', data: { forum: foro.id, title: 'Duda', body: 'Sobre la lectura' } }, 201);
await call('ana', '/api/progress', { course: c, record: lectura.id, action: 'complete' });
ana = await ids('ana');
assert(ana.has(unidad.id) && ana.has(dentro.id));
await download('ana', archivo, 200);
await call('ana', '/api/progress', { course: c, record: dentro.id, action: 'open' });
checks += 2;
// Luis no ha hecho nada: sigue sin verlos (cada alumno por separado).
const luis = await ids('luis');
assert(bloqueados.every((id) => !luis.has(id)));
await download('luis', archivo, 403);
checks++;
// La vista de un alumno concreto usa lo de ese alumno.
const miembros = (await call('docente', '/api/course?id=' + c)).members;
const anaM = miembros.find((m) => m.name === 'ana');
const luisM = miembros.find((m) => m.name === 'luis');
assert((await ids('docente', '&as=m:' + anaM.id)).has(unidad.id));
assert(!(await ids('docente', '&as=m:' + luisM.id)).has(unidad.id));
checks += 2;

// Calificación: borrador no cuenta; publicada y ≥ 7 sí.
await call('docente', '/api/grade', { course: c, task: tarea.id, member: anaM.id, grade: 9, publish: false });
assert(!(await ids('ana')).has(tarea2.id));
const borrador = (await call('docente', '/api/course?id=' + c)).records.find((r) => r.kind === 'submission' && r.data.task === tarea.id && r.data.member === anaM.id);
await call('docente', '/api/grade', { course: c, task: tarea.id, member: anaM.id, revision: borrador.revision, grade: 6.5, publish: true });
assert(!(await ids('ana')).has(tarea2.id));
const publicada = (await call('docente', '/api/course?id=' + c)).records.find((r) => r.kind === 'submission' && r.data.task === tarea.id && r.data.member === anaM.id);
await call('docente', '/api/grade', { course: c, task: tarea.id, member: anaM.id, revision: publicada.revision, grade: 7, publish: true });
assert((await ids('ana')).has(tarea2.id));
assert((await call('ana', '/api/dashboard')).pending.some((p) => p.id === tarea2.id));
await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: tarea2.id, body: 'Listo' } }, 201);
checks += 4;
// «Cualquiera»: Luis entrega la tarea 1 (no contesta el quiz) y le aparece el quiz 2.
await call('luis', '/api/record', { course: c, kind: 'submission', data: { task: tarea.id, body: 'Entrego' } }, 201);
assert((await ids('luis')).has(quiz2.id));
const start = await call('luis', '/api/attempt/start', { course: c, quiz: quiz2.id });
assert.equal(start.attempt, 1);
// Ana: por el puntaje del quiz 1 (necesita 8).
await call('ana', '/api/attempt/start', { course: c, quiz: quiz.id });
await call('ana', '/api/attempt', { course: c, quiz: quiz.id, answers: { 0: 1 } }, 201); // falso: 0
assert(!(await ids('ana')).has(quiz2.id));
await call('ana', '/api/attempt/start', { course: c, quiz: quiz.id });
await call('ana', '/api/attempt', { course: c, quiz: quiz.id, answers: { 0: 0 } }, 201); // verdadero: 10
assert((await ids('ana')).has(quiz2.id));
checks += 4;
// Ahora sí llegan los avisos.
avisos = (await call('ana', '/api/notifications')).items.map((i) => i.id);
assert(avisos.includes(quiz2.id) && avisos.includes(dentro.id));
checks++;

// ---- Si se elimina el elemento de una condición, queda bloqueado (y el docente lo ve al editar) ----
const extra = await record('material', { title: 'Extra' });
const depende = await record('material', { title: 'Depende de Extra', conditions: cond([{ type: 'material_done', target: extra.id }]) });
await call('docente', '/api/record', { course: c, kind: 'material', id: extra.id }, 200, 'DELETE');
assert(!(await ids('ana')).has(depende.id));
await call('docente', '/api/record', { course: c, kind: 'material', id: depende.id, revision: depende.revision, data: { title: 'Depende de Extra', visible: true, conditions: depende.data.conditions } }, 400);
checks++;

// ---- Copiar el curso: las condiciones apuntan a lo copiado ----
const copia = await call('docente', '/api/course/copy', { course: c, name: 'Física I', group: '102' }, 201);
const copiado = (await call('docente', '/api/course?id=' + copia.id)).records;
const byTitle = (title) => copiado.find((r) => r.data.title === title);
assert.equal(byTitle('Unidad 2').data.conditions.items[0].target, byTitle('Lectura 1').id);
assert.equal(byTitle('Tarea 2').data.conditions.items[0].target, byTitle('Tarea 1').id);
assert.equal(byTitle('Quiz 2').data.conditions.items[0].target, byTitle('Quiz 1').id);
checks += 3;

// Consultas: el curso del alumno sigue dentro del límite.
store.counter.queries = 0;
await call('ana', '/api/course?id=' + c);
assert(store.counter.queries <= 13, `consultas: ${store.counter.queries}`);
checks++;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones de condiciones de liberación — unidades, materiales, foros, evaluaciones y actividades que aparecen al cumplir (todas o cualquiera), por alumno y por todas las vías, y copia de curso.`);
