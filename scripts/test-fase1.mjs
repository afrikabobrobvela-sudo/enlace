// Pruebas de la fase 1: asistencia, calificaciones en borrador, equipos en lote y vista previa de archivos.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'docente@example.test', SESSION_SECRET: 'f'.repeat(40) };
let checks = 0;
const sessions = {};

async function send(user, path, { method = 'GET', data, headers = {}, raw } = {}) {
  sessions[user] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user }),
    env,
  );
  return api(
    new Request('https://t.local' + path, {
      method,
      headers: { cookie: sessions[user], Origin: 'https://t.local', 'X-Aula-Request': '1', ...headers },
      body: raw ?? (data === undefined ? undefined : JSON.stringify(data)),
    }),
    env,
  );
}
async function call(user, path, data, status = 200, method = data === undefined ? 'GET' : 'POST') {
  const res = await send(user, path, { method, data });
  const text = await res.text();
  assert.equal(res.status, status, `${method} ${path} → ${text}`);
  checks++;
  return JSON.parse(text);
}

// ---- Preparación: un curso con tres alumnos ----
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '101' }, 201)).id;
await call('docente', '/api/members/bulk', {
  course: c,
  students: ['ana', 'luis', 'sofia'].map((n) => ({ name: n, email: n + '@example.test' })),
});
for (const n of ['ana', 'luis', 'sofia', 'intruso']) await call(n, '/api/me');
const roster = (await call('docente', '/api/course?id=' + c)).members;
const id = (n) => roster.find((m) => m.email === n + '@example.test').id;

// ---- Asistencia ----
await call('ana', '/api/attendance/session', { course: c, date: '2026-09-28' }, 403);
await call('docente', '/api/attendance/session', { course: c, date: '2026-02-30' }, 400); // fecha inexistente
await call('docente', '/api/attendance/session', { course: c, date: '2026-09-28', start_time: '25:00' }, 400);
const s1 = (await call('docente', '/api/attendance/session', { course: c, date: '2026-09-28', start_time: '07:00', topic: 'Cinemática' }, 201)).id;
await call('docente', '/api/attendance/session', { course: c, date: '2026-09-28', start_time: '07:00' }, 409);

// Lunes y viernes del 28 de sept. al 9 de oct., sin el viernes 2 (inhábil): 28, 5, 9 → 3 fechas, una ya existía.
const generated = await call(
  'docente',
  '/api/attendance/generate',
  { course: c, from: '2026-09-28', to: '2026-10-09', weekdays: [1, 5], start_time: '07:00', skip: ['2026-10-02'] },
  201,
);
assert.deepEqual(generated, { created: 2, existing: 1 });
await call('docente', '/api/attendance/generate', { course: c, from: '2026-01-01', to: '2027-12-31', weekdays: [0, 1, 2, 3, 4, 5, 6] }, 400);

let data = await call('docente', '/api/attendance?course=' + c);
assert.deepEqual(data.sessions.map((s) => s.date), ['2026-09-28', '2026-10-05', '2026-10-09']);
assert.deepEqual(data.settings, { min_percent: 80, lates_per_absence: 0, excused_counts: 'present' });

await call('docente', '/api/attendance/mark', { course: c, session: s1, marks: [{ member: id('ana'), status: 'tarde' }] }, 400);
await call('docente', '/api/attendance/mark', { course: c, session: s1, marks: [{ member: 'otro-curso', status: 'present' }] }, 400);
await call('ana', '/api/attendance/mark', { course: c, session: s1, marks: [{ member: id('ana'), status: 'present' }] }, 403);
// "Todos presentes" y luego un toque para cambiar a Luis a retardo con nota.
await call('docente', '/api/attendance/mark', { course: c, session: s1, marks: ['ana', 'luis', 'sofia'].map((n) => ({ member: id(n), status: 'present' })) });
await call('docente', '/api/attendance/mark', { course: c, session: s1, marks: [{ member: id('luis'), status: 'late', note: 'Llegó 07:15' }] });
const s2 = data.sessions[1].id;
await call('docente', '/api/attendance/mark', { course: c, session: s2, marks: [{ member: id('ana'), status: 'absent' }, { member: id('sofia'), status: 'excused', note: 'Consulta médica' }] });

data = await call('docente', '/api/attendance?course=' + c);
assert.equal(data.records.length, 5);
assert.deepEqual(
  data.records.find((r) => r.member === id('luis') && r.session === s1),
  { session: s1, member: id('luis'), status: 'late', note: 'Llegó 07:15' },
);
const mine = await call('ana', '/api/attendance?course=' + c);
assert.equal(mine.canTeach, false);
assert(mine.records.every((r) => r.member === id('ana')) && mine.records.length === 2, 'Cada alumno solo ve su propio registro');
await call('intruso', '/api/attendance?course=' + c, undefined, 403);

await call('docente', '/api/attendance/settings', { course: c, min_percent: 90, lates_per_absence: 3, excused_counts: 'excluded' });
assert.equal((await call('ana', '/api/attendance?course=' + c)).settings.min_percent, 90);
await call('docente', '/api/attendance/settings', { course: c, min_percent: 120, lates_per_absence: 0, excused_counts: 'present' }, 400);

// Borrar una sesión borra sus registros (ON DELETE CASCADE) y nada más.
await call('docente', '/api/attendance/session', { course: c, id: s2 }, 200, 'DELETE');
data = await call('docente', '/api/attendance?course=' + c);
assert.equal(data.sessions.length, 2);
assert.equal(data.records.length, 3);

// ---- Calificaciones en borrador ----
const task = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Práctica 1' } }, 201);
const sub = await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: task.id, body: 'Mi reporte' } }, 201);
const draft = await call('docente', '/api/grade', { course: c, task: task.id, member: id('ana'), revision: sub.revision, grade: 8.5, feedback: 'Revisa unidades', publish: false });
assert.equal(draft.data.published, false);
let anaView = (await call('ana', '/api/course?id=' + c)).records.find((r) => r.id === sub.id);
assert.equal(anaView.data.grade, null, 'El borrador no se ve');
assert.equal(anaView.data.feedback, '');
assert(!('published' in anaView.data), 'El alumno ni siquiera sabe que hay un borrador');
await call('docente', '/api/grade', { course: c, task: task.id, member: id('luis'), grade: 9, publish: false }); // calificación manual en borrador
await call('ana', '/api/grades/publish', { course: c, task: task.id }, 403);
assert.deepEqual(await call('docente', '/api/grades/publish', { course: c, task: task.id }), { published: 2 });
anaView = (await call('ana', '/api/course?id=' + c)).records.find((r) => r.id === sub.id);
assert.equal(anaView.data.grade, 8.5);
assert.equal(anaView.data.feedback, 'Revisa unidades');
assert.deepEqual(await call('docente', '/api/grades/publish', { course: c, task: task.id }), { published: 0 });
// Sin indicar `publish`, la calificación se publica (compatibilidad con la versión anterior).
const direct = await call('docente', '/api/grade', { course: c, task: task.id, member: id('sofia'), grade: 7 });
assert.equal(direct.data.published, true);

// ---- Equipos en lote ----
const teams = (members) => ({ course: c, category: 'Equipos de laboratorio', groups: members.map((m, i) => ({ title: 'Equipo ' + (i + 1), members: m })) });
await call('ana', '/api/groups/bulk', teams([[id('ana')]]), 403);
await call('docente', '/api/groups/bulk', teams([[id('ana')], [id('ana')]]), 400); // alumno repetido
await call('docente', '/api/groups/bulk', teams([['no-existe']]), 400);
await call('docente', '/api/groups/bulk', { ...teams([[id('ana')], []]), groups: [{ title: 'A', members: [] }, { title: 'a', members: [] }] }, 400);
assert.deepEqual(await call('docente', '/api/groups/bulk', teams([[id('ana'), id('luis')], [id('sofia')]]), 201), { created: 2 });
await call('docente', '/api/groups/bulk', teams([[id('ana')]]), 409); // la categoría ya existe
let groups = (await call('docente', '/api/course?id=' + c)).records.filter((r) => r.kind === 'group');
assert.deepEqual(groups.map((g) => [g.data.title, g.data.members.length, g.data.category]).sort(), [
  ['Equipo 1', 2, 'Equipos de laboratorio'],
  ['Equipo 2', 1, 'Equipos de laboratorio'],
]);
await call('docente', '/api/groups/category', { course: c, category: 'Equipos de laboratorio', confirm: 'otra' }, 400, 'DELETE');
assert.deepEqual(await call('docente', '/api/groups/category', { course: c, category: 'Equipos de laboratorio', confirm: 'Equipos de laboratorio' }, 200, 'DELETE'), { deleted: 2 });
groups = (await call('docente', '/api/course?id=' + c)).records.filter((r) => r.kind === 'group');
assert.equal(groups.length, 0);

// ---- Vista previa ----
async function upload(user, name, bytes, scope = 'material') {
  const res = await send(user, `/api/upload?course=${c}&scope=${scope}`, { method: 'POST', headers: { 'X-File-Name': encodeURIComponent(name) }, raw: bytes });
  assert.equal(res.status, 201);
  return (await res.json()).id;
}
const pdfBytes = new TextEncoder().encode('%PDF-1.7\n' + 'x'.repeat(200));
const pdf = await upload('docente', 'guia.pdf', pdfBytes);
const fakePdf = await upload('docente', 'trampa.pdf', new TextEncoder().encode('<html><script>alert(1)</script></html>'));
const png = await upload('docente', 'foto.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
const mp4 = await upload('docente', 'clase.mp4', new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode('ftypmp42'), ...new Array(90).fill(7)]));
const docx = await upload('docente', 'reporte.docx', new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]));
await call('docente', '/api/record', { course: c, kind: 'material', data: { title: 'Lecturas', fileIds: [pdf, png, mp4] } }, 201);

let res = await send('docente', `/api/file/${pdf}?preview=1`);
assert.equal(res.status, 200);
assert.equal(res.headers.get('content-type'), 'application/pdf');
assert.match(res.headers.get('content-disposition'), /^inline;/);
assert.match(res.headers.get('content-security-policy'), /sandbox/);
assert.equal(res.headers.get('accept-ranges'), 'bytes');
assert.equal((await res.arrayBuffer()).byteLength, pdfBytes.length);
res = await send('docente', `/api/file/${fakePdf}?preview=1`);
assert.equal(res.status, 415, 'Un HTML disfrazado de PDF nunca se muestra dentro de Enlace');
assert.equal((await send('docente', `/api/file/${docx}?preview=1`)).status, 415);
assert.equal((await send('docente', `/api/file/${png}?preview=1`)).headers.get('content-type'), 'image/png');

// Video por partes (Safari lo exige).
res = await send('docente', `/api/file/${mp4}?preview=1`, { headers: { Range: 'bytes=10-19' } });
assert.equal(res.status, 206);
assert.equal(res.headers.get('content-type'), 'video/mp4');
assert.equal(res.headers.get('content-range'), 'bytes 10-19/102');
assert.equal((await res.arrayBuffer()).byteLength, 10);
res = await send('docente', `/api/file/${mp4}?preview=1`, { headers: { Range: 'bytes=-2' } });
assert.equal(res.headers.get('content-range'), 'bytes 100-101/102');
assert.equal((await send('docente', `/api/file/${mp4}?preview=1`, { headers: { Range: 'bytes=500-' } })).status, 416);
// Mismos permisos que la descarga: el alumno ve lo publicado; un externo, nada.
assert.equal((await send('ana', `/api/file/${pdf}?preview=1`)).status, 200);
assert.equal((await send('ana', `/api/file/${docx}?preview=1`)).status, 403);
assert.equal((await send('intruso', `/api/file/${pdf}?preview=1`)).status, 403);
// La descarga normal sigue igual: siempre como archivo adjunto.
assert.match((await send('docente', `/api/file/${fakePdf}`)).headers.get('content-disposition'), /^attachment;/);
checks += 18;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
store.close();
console.log(`PASS: ${checks} verificaciones de la fase 1 — asistencia, borradores de calificación, equipos en lote y vista previa segura con descargas parciales.`);
