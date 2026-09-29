// Pruebas del acceso especial (12.22): en actividades (varios alumnos a la vez con otro horario, que abre de nuevo una
// actividad cerrada; «solo para quienes tienen acceso especial» en curso, pendientes, calendario, avisos, correo,
// entregas y descargas) y en evaluaciones (otro horario, minutos extra, intentos adicionales, examen activo y monitor).
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { digestMessages } from '../src/server/digest.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40), MAILER: async () => true };
let checks = 0;
const cookies = {};
async function raw(who, path, { method, body, headers = {} } = {}) {
  cookies[who] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who }), env);
  const before = store.counter.queries;
  const res = await api(
    new Request('https://t.local' + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { cookie: cookies[who], Origin: 'https://t.local', 'X-Aula-Request': '1', ...headers }, body }),
    env,
  );
  assert(store.counter.queries - before <= 50, `${path}: ${store.counter.queries - before} consultas`);
  return res;
}
async function call(who, path, data, status = 200, method) {
  const res = await raw(who, path, { method, body: data === undefined ? undefined : JSON.stringify(data) });
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${who}) → ${text}`);
  checks++;
  return JSON.parse(text);
}
const MIN = 60_000;
const at = (ms) => new Date(Date.now() + ms).toISOString();

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Química', group: '30311' }, 201)).id;
const a = (await call('docente', '/api/sections', { course: c, name: '30311' }, 201)).id;
const b = (await call('docente', '/api/sections', { course: c, name: '30315' }, 201)).id;
await call('docente', '/api/members/bulk', {
  course: c,
  students: [
    { name: 'Ana', email: 'ana@example.test', section: '30311' },
    { name: 'Beto', email: 'beto@example.test', section: '30311' },
    { name: 'Carla', email: 'carla@example.test', section: '30315' },
  ],
});
for (const who of ['ana', 'beto', 'carla']) await call(who, '/api/me');
const course = (who = 'docente') => call(who, '/api/course?id=' + c);
const members = Object.fromEntries((await course()).members.map((m) => [m.name.toLowerCase(), m.id]));
const rec = (kind, data, status = 201) => call('docente', '/api/record', { course: c, kind, data }, status);
const grant = (data, status = 200) => call('docente', '/api/special-access', { course: c, ...data }, status);
const only = (kind, item, specialOnly) => call('docente', '/api/special-access/only', { course: c, kind, item, specialOnly });
const submit = (who, task, status = 201) => call(who, '/api/record', { course: c, kind: 'submission', data: { task, body: 'Mi entrega' } }, status);

// ================= Actividades =================
// Cerrada para el grupo: con acceso especial, Ana y Beto pueden volver a entregar; Carla no.
const cerrada = await rec('task', { title: 'Práctica 1', visible: true, due: at(-120 * MIN), end: at(-60 * MIN) });
assert.match((await submit('ana', cerrada.id, 403)).error, /terminado/);
await call('ana', '/api/special-access', { course: c, kind: 'task', item: cerrada.id, members: [members.ana], due: at(60 * MIN) }, 403);
await grant({ kind: 'task', item: cerrada.id, members: [] }, 400);
await grant({ kind: 'task', item: cerrada.id, members: [members.ana, 'otro'] }, 404);
await grant({ kind: 'task', item: cerrada.id, members: [members.ana] }, 400); // sin fechas y sin «solo acceso especial»
await grant({ kind: 'task', item: cerrada.id, members: [members.ana], startAt: at(60 * MIN), endAt: at(30 * MIN) }, 400);
await grant({ kind: 'task', item: cerrada.id, members: [members.ana], due: at(90 * MIN), endAt: at(30 * MIN) }, 400);
await grant({ kind: 'quiz', item: cerrada.id, members: [members.ana], endAt: at(MIN) }, 404);
assert.equal((await grant({ kind: 'task', item: cerrada.id, members: [members.ana, members.beto], due: at(60 * MIN), endAt: at(120 * MIN), reason: 'Justificante' })).saved, 2);
await submit('ana', cerrada.id);
await submit('carla', cerrada.id, 403);
const deAna = (await course('ana')).records.find((r) => r.id === cerrada.id);
assert.equal(deAna.data.extended, true);
assert(Date.parse(deAna.data.end) > Date.now(), 'El alumno recibe su propio cierre');
checks += 2;
// Fecha de inicio propia: todavía no puede entregar.
await grant({ kind: 'task', item: cerrada.id, members: [members.beto], startAt: at(30 * MIN), due: at(60 * MIN) });
assert.match((await submit('beto', cerrada.id, 403)).error, /todavía no está disponible/);
// El docente ve todas las filas, con su inicio; la prórroga individual de antes sigue funcionando.
let docente = await course();
const filas = docente.records.filter((r) => r.kind === 'extension' && r.data.task === cerrada.id);
assert.equal(filas.length, 2);
assert(filas.find((r) => r.data.member === members.beto).data.start);
await call('docente', '/api/extension', { course: c, task: cerrada.id, member: members.carla, due: at(60 * MIN) });
await submit('carla', cerrada.id);
checks += 3;
// Quitar el acceso especial a varios.
assert.equal((await call('docente', '/api/special-access', { course: c, kind: 'task', item: cerrada.id, members: [members.beto, members.carla] }, 200, 'DELETE')).removed, 2);
checks++;

// Actividad de una sección: no se da acceso a alumnos de otra.
const deA = await rec('task', { title: 'Solo 30311', visible: true, due: at(60 * MIN), sections: [a] });
assert.match((await grant({ kind: 'task', item: deA.id, members: [members.carla], due: at(90 * MIN) }, 400)).error, /Carla no es de las secciones/);
checks++;

// «Solo para quienes tienen acceso especial»: una reposición con archivo del docente.
const up = await raw('docente', `/api/upload?course=${c}&scope=material`, { body: '%PDF-1.4 reposición', headers: { 'x-file-name': 'repo.pdf', 'content-type': 'application/pdf' } });
const archivo = (await up.json()).id;
const repo = await rec('task', { title: 'Reposición', visible: true, due: at(24 * 60 * MIN), fileIds: [archivo] });
await only('task', repo.id, true);
await grant({ kind: 'task', item: repo.id, members: [members.ana] }); // sin fechas: basta con verla
const ve = async (who) => (await course(who)).records.some((r) => r.id === repo.id);
assert.deepEqual([await ve('ana'), await ve('beto'), await ve('docente')], [true, false, true]);
assert.equal((await course()).records.find((r) => r.id === repo.id).data.specialOnly, true);
await submit('beto', repo.id, 403);
assert.equal((await raw('beto', '/api/file/' + archivo)).status, 403);
assert.equal((await raw('ana', '/api/file/' + archivo)).status, 200);
const pendientes = async (who) => (await call(who, '/api/dashboard')).pending.map((p) => p.title);
assert((await pendientes('ana')).includes('Reposición'));
assert(!(await pendientes('beto')).includes('Reposición'));
const cal = async (who) => (await call(who, `/api/calendar?from=${encodeURIComponent(at(-60 * MIN))}&to=${encodeURIComponent(at(3 * 24 * 60 * MIN))}`)).events.map((e) => e.title);
assert((await cal('ana')).includes('Reposición'));
assert(!(await cal('beto')).includes('Reposición'));
const avisos = async (who) => (await call(who, '/api/notifications')).items.map((i) => i.title);
assert((await avisos('ana')).includes('Reposición'));
assert(!(await avisos('beto')).includes('Reposición'));
const correos = await digestMessages(env.DB, env, new Date(Date.now() + MIN));
const correoDe = (who) => correos.find((m) => m.to === who + '@example.test')?.text || '';
assert.match(correoDe('ana'), /Reposición/);
assert.doesNotMatch(correoDe('beto'), /Reposición/);
checks += 13;
// Quitar «solo acceso especial»: todos la ven.
await only('task', repo.id, false);
assert.equal(await ve('beto'), true);
checks++;
// Editar la actividad no cambia el acceso especial.
await only('task', repo.id, true);
const repoDoc = (await course()).records.find((r) => r.id === repo.id);
await call('docente', '/api/record', { course: c, kind: 'task', id: repo.id, revision: repoDoc.revision, data: { ...repoDoc.data, title: 'Reposición 1' } });
assert.deepEqual([await ve('ana'), await ve('beto')], [true, false]);
checks++;

// ================= Evaluaciones =================
const preguntas = [{ type: 'choice', text: '¿Símbolo del sodio?', options: ['Na', 'So'], correct: 0 }];
const parcial = await rec('quiz', { title: 'Parcial 1', visible: true, questions: preguntas, settings: { attempts: 1, timeLimit: 10, opensAt: at(-120 * MIN), closesAt: at(-60 * MIN) } });
assert.match((await call('ana', '/api/attempt/start', { course: c, quiz: parcial.id }, 403)).error, /cerró/);
await grant({ kind: 'quiz', item: parcial.id, members: [members.ana] }, 400);
await grant({ kind: 'quiz', item: parcial.id, members: [members.ana], extraMinutes: 601 }, 400);
await grant({ kind: 'quiz', item: parcial.id, members: [members.ana], extraAttempts: 1.5 }, 400);
await grant({ kind: 'quiz', item: parcial.id, members: [members.ana, members.beto], startAt: at(-MIN), endAt: at(120 * MIN), extraMinutes: 5, extraAttempts: 1, reason: 'Estaba enferma' });
const ajustes = (await course('ana')).records.find((r) => r.id === parcial.id).data.settings;
assert.deepEqual([ajustes.attempts, ajustes.timeLimit, Date.parse(ajustes.closesAt) > Date.now()], [2, 15, true]);
const inicio = await call('ana', '/api/attempt/start', { course: c, quiz: parcial.id });
assert(Math.abs(Date.parse(inicio.deadline) - (Date.now() + 15 * MIN)) < 5000, 'Tiempo límite con los minutos extra');
await call('ana', '/api/attempt', { course: c, quiz: parcial.id, answers: { 0: 0 } }, 201);
await call('ana', '/api/attempt/start', { course: c, quiz: parcial.id }); // intento adicional
await call('carla', '/api/attempt/start', { course: c, quiz: parcial.id }, 403);
checks += 3;
// El alumno solo recibe su propio acceso y sin el motivo; el docente, todos.
const vistaAna = await course('ana');
assert(!('quizAccess' in vistaAna));
assert(!JSON.stringify(vistaAna).includes('Estaba enferma'));
docente = await course();
assert.deepEqual(docente.quizAccess.filter((g) => g.quiz === parcial.id).map((g) => g.member).sort(), [members.ana, members.beto].sort());
assert.equal(docente.quizAccess.find((g) => g.member === members.ana).reason, 'Estaba enferma');
checks += 4;

// Examen «solo con acceso especial» que bloquea la plataforma: el tiempo extra cuenta en el examen activo y el monitor.
const examen = await rec('quiz', { title: 'Examen de reposición', visible: true, questions: preguntas, settings: { attempts: 1, timeLimit: 1, exam: { enabled: true, lockPlatform: true } } });
await only('quiz', examen.id, true);
await grant({ kind: 'quiz', item: examen.id, members: [members.beto], extraMinutes: 30 });
const veQuiz = async (who) => (await course(who)).records.some((r) => r.id === examen.id);
assert.deepEqual([await veQuiz('beto'), await veQuiz('ana'), await veQuiz('docente')], [true, false, true]);
await call('ana', '/api/attempt/start', { course: c, quiz: examen.id }, 403);
assert(!(await avisos('ana')).includes('Examen de reposición'));
const deBeto = await call('beto', '/api/attempt/start', { course: c, quiz: examen.id });
assert(Math.abs(Date.parse(deBeto.deadline) - (Date.now() + 31 * MIN)) < 5000);
// Minuto 3 del examen: sin los minutos extra ya habría terminado; con ellos sigue activo.
store.raw().prepare('UPDATE aula_attempt_starts SET started=? WHERE quiz=?').run(at(-3 * MIN), examen.id);
assert.deepEqual((await call('beto', '/api/me')).activeExam, { quiz: examen.id, course: c });
const monitor = await call('docente', `/api/exam/monitor?course=${c}&quiz=${examen.id}`);
assert(Date.parse(monitor.running[0].deadline) > Date.now() + 20 * MIN, 'El monitor muestra el tiempo extra');
checks += 6;
// Editar la evaluación conserva «solo acceso especial»; al copiar el curso no se copia (ahí nadie tendría acceso).
const exDoc = (await course()).records.find((r) => r.id === examen.id);
await call('docente', '/api/record', { course: c, kind: 'quiz', id: examen.id, revision: exDoc.revision, data: { ...exDoc.data, title: 'Examen de reposición B' } });
const exDoc2 = (await course()).records.find((r) => r.id === examen.id);
assert.equal(exDoc2.data.title, 'Examen de reposición B');
assert.equal(exDoc2.data.specialOnly, true);
const copia = await call('docente', '/api/course/copy', { course: c, name: 'Química', group: '30311-B' }, 201);
const copiado = (await call('docente', '/api/course?id=' + copia.id)).records.find((r) => r.kind === 'quiz' && r.data.title.startsWith('Examen de reposición'));
assert.equal(copiado.data.specialOnly, undefined);
checks += 2;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones de acceso especial — actividades cerradas que se abren a unos alumnos, fechas propias, «solo con acceso especial» en todas las vías, evaluaciones con otro horario, minutos e intentos extra, examen activo y monitor.`);
