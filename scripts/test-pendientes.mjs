// Pruebas de "Mis pendientes", avisos dentro de Enlace y comprobantes de entrega.
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
  assert.equal(res.status, status, `${method} ${path} (${user}) → ${text}`);
  checks++;
  return JSON.parse(text);
}
const inDays = (d) => new Date(Date.now() + d * 86_400_000).toISOString();

await call('docente', '/api/me');
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '501' }, 201)).id;
const c2 = (await call('docente', '/api/courses', { name: 'Física II', group: '601' }, 201)).id;
for (const course of [c, c2]) await call('docente', '/api/members/bulk', { course, students: ['ana', 'luis'].map((n) => ({ name: n, email: n + '@example.test' })) });
const task = (course, data) => call('docente', '/api/record', { course, kind: 'task', data: { visible: true, ...data } }, 201);
const pronto = await task(c, { title: 'Práctica 1', due: inDays(2) });
await task(c2, { title: 'Reporte', due: inDays(5) });
await task(c, { title: 'Oculta', due: inDays(1), visible: false });
await task(c, { title: 'Lejana', due: inDays(40) });
const vencida = await task(c, { title: 'Vencida', due: inDays(-2) });
await task(c, { title: 'Sin fecha' });
const archivado = (await call('docente', '/api/courses', { name: 'Viejo', group: 'X' }, 201)).id;
await call('docente', '/api/member', { course: archivado, name: 'ana', email: 'ana@example.test' });
await task(archivado, { title: 'Del archivado', due: inDays(1) });
await call('docente', '/api/course/archive', { course: archivado });

// ---- Mis pendientes ----
let dash = await call('ana', '/api/dashboard');
assert.deepEqual(dash.pending.map((p) => p.title), ['Vencida', 'Práctica 1', 'Reporte'], 'Solo lo visible, con fecha próxima y de cursos activos, en orden');
assert.deepEqual([dash.pending[0].overdue, dash.pending[1].overdue, dash.pending[2].course_name], [true, false, 'Física II']);
await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: pronto.id, body: 'listo' } }, 201);
dash = await call('ana', '/api/dashboard');
assert(!dash.pending.some((p) => p.title === 'Práctica 1'), 'Lo entregado sale de pendientes');
// Prórroga: la fecha del alumno es la suya.
const roster = (await call('docente', '/api/course?id=' + c)).members;
const luis = roster.find((m) => m.email === 'luis@example.test').id;
await call('docente', '/api/extension', { course: c, task: vencida.id, member: luis, due: inDays(3) });
const deLuis = (await call('luis', '/api/dashboard')).pending.find((p) => p.title === 'Vencida');
assert.deepEqual([deLuis.overdue, deLuis.extended], [false, true]);
// Docente: entregas por calificar.
assert.deepEqual((await call('docente', '/api/dashboard')).toGrade.map((x) => [x.course_name, x.count]), [['Física I', 1]]);
const ana = roster.find((m) => m.email === 'ana@example.test').id;
await call('docente', '/api/grade', { course: c, task: pronto.id, member: ana, revision: 1, grade: 9 });
dash = await call('ana', '/api/dashboard');
assert.deepEqual(dash.grades.map((g) => [g.title, g.grade]), [['Práctica 1', 9]], 'Calificación reciente');
assert.deepEqual((await call('docente', '/api/dashboard')).toGrade, []);
checks += 7;

// ---- Avisos ----
let feed = await call('ana', '/api/notifications');
assert(feed.unread > 0);
assert(!feed.items.some((i) => i.title === 'Oculta' || i.title === 'Del archivado'), 'Nada oculto ni de cursos archivados');
assert(feed.items.some((i) => i.type === 'grade' && i.title === 'Práctica 1'));
await call('ana', '/api/notifications/seen', {});
feed = await call('ana', '/api/notifications');
assert.equal(feed.unread, 0, 'Revisados');
await call('docente', '/api/record', { course: c, kind: 'notice', data: { title: 'Examen el viernes', body: '' } }, 201);
await call('docente', '/api/record', { course: c, kind: 'notice', data: { title: 'Borrador', body: '', visible: false } }, 201);
feed = await call('ana', '/api/notifications');
assert.deepEqual(feed.items.filter((i) => i.fresh).map((i) => [i.type, i.title]), [['notice', 'Examen el viernes']]);
// Material dentro de una unidad oculta: no avisa.
const unidad = await call('docente', '/api/record', { course: c, kind: 'module', data: { title: 'U2', visible: false } }, 201);
await call('docente', '/api/record', { course: c, kind: 'material', data: { title: 'Secreto', module: unidad.id } }, 201);
assert(!(await call('ana', '/api/notifications')).items.some((i) => i.title === 'Secreto'));
// El docente recibe las entregas nuevas agrupadas por actividad.
await call('luis', '/api/record', { course: c, kind: 'submission', data: { task: pronto.id, body: 'mío' } }, 201);
const docFeed = await call('docente', '/api/notifications');
assert.deepEqual(docFeed.items.filter((i) => i.type === 'submission').map((i) => [i.title, i.count]), [['Práctica 1', 2]]);
checks += 6;

// ---- Comprobante ----
const sub = (await call('ana', '/api/course?id=' + c)).records.find((r) => r.kind === 'submission' && r.data.task === pronto.id);
const recibo = await call('ana', `/api/receipt?course=${c}&id=${encodeURIComponent(sub.id)}`);
assert.match(recibo.folio, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
assert.deepEqual([recibo.task, recibo.student, recibo.course], ['Práctica 1', 'ana', 'Física I']);
assert.equal((await call('docente', `/api/receipt?course=${c}&id=${encodeURIComponent(sub.id)}`)).folio, recibo.folio, 'El docente verifica el mismo folio');
await call('luis', `/api/receipt?course=${c}&id=${encodeURIComponent(sub.id)}`, undefined, 403);
// Si la entrega cambia, cambia el folio.
await call('ana', '/api/record', { course: c, kind: 'submission', id: sub.id, revision: sub.revision, data: { task: pronto.id, body: 'versión 2' } });
assert.notEqual((await call('ana', `/api/receipt?course=${c}&id=${encodeURIComponent(sub.id)}`)).folio, recibo.folio);
checks += 3;

console.log(`PASS: ${checks} verificaciones de pendientes, avisos y comprobantes — vencimientos por alumno con prórroga, calificaciones recientes, entregas por calificar, avisos sin contenido oculto y folio verificable.`);
