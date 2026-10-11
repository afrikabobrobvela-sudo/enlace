// Constancias con folio y QR (12.67): configuración del docente, el alumno la obtiene al aprobar la evaluación elegida,
// el docente la entrega o la revoca, y la página pública /constancia/<folio> dice si es válida.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import worker from '../src/worker.js';
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
const page = async (folio) => {
  const res = await worker.fetch(new Request('https://t.local/constancia/' + folio), env);
  return { status: res.status, html: await res.text(), csp: res.headers.get('content-security-policy') };
};

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Dra. Elena Ruiz', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Difracción de rayos X', group: 'Curso abierto' }, 201)).id;
await call('docente', '/api/members/bulk', {
  course: c,
  students: [
    { name: 'Ana López', email: 'ana@example.test' },
    { name: 'Beto Cruz', email: 'beto@example.test' },
    { name: 'Carla Díaz', email: 'carla@example.test' },
  ],
});
const final = await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Evaluación final', visible: true, questions: [{ type: 'truefalse', text: 'La ley de Bragg es nλ = 2d sen θ', correct: true }], settings: { attempts: 3 } } }, 201);
const members = (await call('docente', '/api/course?id=' + c)).members;
const id = (n) => members.find((m) => m.email === n + '@example.test').id;

// ---- Configuración ----
await call('ana', '/api/certificates/settings', { course: c, enabled: true }, 403);
await call('docente', '/api/certificates/settings', { course: c, enabled: true, quiz: 'no-existe' }, 404);
await call('docente', '/api/certificates/settings', { course: c, enabled: true, minScore: 11 }, 400);
await call('docente', '/api/certificates/settings', { course: c, enabled: true, hours: -3 }, 400);
let cfg = await call('docente', '/api/certificates/settings', { course: c, enabled: true, quiz: final.id, minScore: 8, hours: 20, title: '', signer: '' });
assert.deepEqual(cfg.settings, { enabled: true, quiz: final.id, minScore: 8, hours: 20, title: '', signer: '' });
checks++;

// ---- El alumno la obtiene al aprobar ----
let ana = await call('ana', '/api/certificates?course=' + c);
assert.deepEqual([ana.settings.enabled, ana.settings.byQuiz, ana.quizTitle, ana.best, ana.certificate], [true, true, 'Evaluación final', null, null]);
assert.equal(ana.settings.quiz, undefined, 'El alumno no recibe el id ni el firmante');
let error = await call('ana', '/api/certificates/claim', { course: c }, 409);
assert.match(error.error, /necesitas 8 o más en «Evaluación final»/);
await call('ana', '/api/attempt', { course: c, quiz: final.id, answers: [1] }, 201);
await call('ana', '/api/certificates/claim', { course: c }, 409); // con 0 todavía no
await call('ana', '/api/attempt', { course: c, quiz: final.id, answers: [0] }, 201);
const claim = await call('ana', '/api/certificates/claim', { course: c }, 201);
const folio = claim.certificate.id;
assert.match(folio, /^ENL-[0-9A-F]{10}$/);
assert.deepEqual(
  [claim.certificate.name, claim.certificate.courseName, claim.certificate.hours, claim.certificate.grade, claim.certificate.signer],
  ['Ana López', 'Difracción de rayos X', 20, 10, 'Dra. Elena Ruiz'],
);
assert.equal((await call('ana', '/api/certificates/claim', { course: c })).certificate.id, folio, 'Pedirla otra vez devuelve la misma');
await call('docente', '/api/certificates/claim', { course: c }, 403);
checks += 4;

// ---- Página pública ----
let p = await page(folio);
assert.equal(p.status, 200);
assert.match(p.html, /Constancia válida/);
assert.match(p.html, /Ana López/);
assert.match(p.html, /20 horas/);
assert.match(p.html, /10 de 10/);
assert.match(p.csp, /default-src 'self'/);
assert.equal((await page(folio.toLowerCase())).status, 200, 'El folio no distingue mayúsculas');
assert.equal((await page('ENL-0000000000')).status, 404);
assert.match((await page('ENL-0000000000')).html, /no es auténtica/);
assert.equal((await page('<script>')).status, 404);
checks += 8;

// ---- El docente entrega y revoca ----
await call('beto', '/api/certificates/issue', { course: c, members: [id('beto')] }, 403);
let list = await call('docente', '/api/certificates/issue', { course: c, members: [id('beto'), id('carla'), id('ana')] });
assert.deepEqual(list.certificates.map((x) => x.name), ['Ana López', 'Beto Cruz', 'Carla Díaz']);
assert.equal(list.certificates.find((x) => x.name === 'Ana López').id, folio, 'Entregar a quien ya la tiene no cambia su folio');
assert.equal(list.certificates.find((x) => x.name === 'Beto Cruz').grade, null);
const beto = list.certificates.find((x) => x.name === 'Beto Cruz').id;
await call('docente', '/api/certificates/revoke', { course: c, id: beto });
await call('docente', '/api/certificates/revoke', { course: c, id: beto }, 404);
p = await page(beto);
assert.match(p.html, /Constancia revocada/);
assert.match(p.html, /ya no tiene validez/);
error = await call('beto', '/api/certificates/claim', { course: c }, 409);
assert.match(error.error, /revocada/);
list = await call('docente', '/api/certificates/issue', { course: c, members: [id('beto')] });
assert.equal(list.certificates.find((x) => x.name === 'Beto Cruz').id, beto, 'Reactivar conserva el folio');
assert.match((await page(beto)).html, /Constancia válida/);
checks += 7;

// ---- Otro curso no puede tocarlas; con las constancias apagadas no se piden ----
const otro = (await call('docente', '/api/courses', { name: 'Otro', group: 'B' }, 201)).id;
await call('docente', '/api/certificates/revoke', { course: otro, id: folio }, 404);
await call('docente', '/api/certificates/settings', { course: c, enabled: false, quiz: final.id });
await call('carla', '/api/certificates/claim', { course: c }, 200); // ya la tenía: la conserva
assert.match((await call('beto', '/api/certificates/claim', { course: c }, 200)).certificate.id, /^ENL-/);
const solo = (await call('docente', '/api/certificates?course=' + c)).certificates.length;
assert.equal(solo, 3);
await call('docente', '/api/certificates/issue', { course: c, members: [id('carla')] }, 409);
checks += 2;

console.log(`PASS: ${checks} verificaciones de constancias — configuración, obtenerla al aprobar, entregar y revocar con el mismo folio, y verificación pública.`);
