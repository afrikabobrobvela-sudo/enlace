// Pruebas de la auditoría de seguridad (12.34): curso archivado con ?course= señuelo, enviar sin «Comenzar», topes de
// códigos y cuotas sin carrera entre solicitudes paralelas, co-docentes protegidos y detalles menores.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { evaluate } from '../src/server/quizzes.js';
import worker from '../src/worker.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'docente@example.test', SESSION_SECRET: 's'.repeat(40) };
let checks = 0;
const cookies = {};
async function raw(who, path, { method, body, headers = {} } = {}) {
  cookies[who] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who }), env);
  return api(
    new Request('https://t.local' + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { cookie: cookies[who], Origin: 'https://t.local', 'X-Aula-Request': '1', ...headers }, body }),
    env,
  );
}
async function call(who, path, data, status = 200, method) {
  const res = await raw(who, path, { method, body: data === undefined ? undefined : JSON.stringify(data) });
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${who}) → ${text}`);
  checks++;
  return JSON.parse(text);
}
const statuses = (list) => list.reduce((acc, s) => ({ ...acc, [s]: (acc[s] || 0) + 1 }), {});

await call('docente', '/api/me');
const c = (await call('docente', '/api/courses', { name: 'Física I', group: 'A' }, 201)).id;
const otro = (await call('docente', '/api/courses', { name: 'Física II', group: 'B' }, 201)).id;
for (const course of [c, otro]) await call('docente', '/api/members/bulk', { course, students: [{ name: 'Ana', email: 'ana@example.test' }] });
await call('ana', '/api/me');

// ---- 1. Curso archivado: un ?course= de otro curso no tapa el curso del cuerpo ----
const archivado = (await call('docente', '/api/courses', { name: 'Física 0', group: 'Z' }, 201)).id;
await call('docente', '/api/members/bulk', { course: archivado, students: [{ name: 'Ana', email: 'ana@example.test' }] });
const tarea = await call('docente', '/api/record', { course: archivado, kind: 'task', data: { title: 'Práctica', visible: true } }, 201);
await call('docente', '/api/course/archive', { course: archivado });
const entrega = { course: archivado, kind: 'submission', data: { task: tarea.id, body: 'tarde' } };
await call('ana', '/api/record', entrega, 409);
await call('ana', '/api/record?course=' + otro, entrega, 409);
await call('ana', '/api/record?course=' + otro, { ...entrega, course: [archivado] }, 409); // un arreglo se revisa como texto

// ---- 2. Sin «Comenzar» no se envía fuera de fechas ni sin el código ----
const preguntas = [{ type: 'choice', text: 'Unidad de fuerza', options: ['J', 'N'], correct: 1 }];
const futura = await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Aún no abre', visible: true, questions: preguntas, settings: { attempts: 1, opensAt: '2099-01-01T00:00' } } }, 201);
await call('ana', '/api/attempt', { course: c, quiz: futura.id, answers: [1] }, 403);
const libre = await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Libre', visible: true, questions: preguntas, settings: { attempts: 1 } } }, 201);
await call('ana', '/api/attempt', { course: c, quiz: libre.id, answers: [1] }, 201); // sin fechas ni código sigue igual

// ---- 3. Código del examen: solicitudes en paralelo no pasan del tope ----
const examen = await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Parcial', visible: true, questions: preguntas, settings: { attempts: 1, timeLimit: 30, exam: { enabled: true, password: 'gauss' } } } }, 201);
const intentos = await Promise.all(Array.from({ length: 30 }, () => raw('ana', '/api/attempt/start', { body: JSON.stringify({ course: c, quiz: examen.id, password: 'newton' }) })));
const porCodigo = statuses(intentos.map((r) => r.status));
assert.equal(porCodigo[400], 5, `5 por minuto: ${JSON.stringify(porCodigo)}`);
assert.equal(porCodigo[429], 25);
const tries = await store.DB.prepare('SELECT failures FROM aula_exam_tries WHERE quiz=?').bind(examen.id).first();
assert.equal(tries.failures, 5, 'Solo se probaron 5 códigos');
checks += 3;

// ---- 3b. PIN de asistencia en paralelo ----
const session = (await call('docente', '/api/attendance/session', { course: c, date: '2026-09-28', start_time: '07:00' }, 201)).id;
const open = await call('docente', '/api/attendance/checkin/open', { course: c, session, minutes: 15 });
const { createHmac } = await import('node:crypto');
const w = Math.floor(Date.now() / 10_000);
const qr = `${open.code}.${w.toString(36)}.${createHmac('sha256', Buffer.from(open.secret, 'base64url')).update(`${open.code}.${w}`).digest('base64url').slice(0, 16)}`;
const scan = await call('ana', '/api/attendance/checkin', { token: qr, device: 'telefono-de-ana' });
const malo = open.pin === '0000' ? '1111' : '0000';
const pins = await Promise.all(Array.from({ length: 20 }, () => raw('ana', '/api/attendance/checkin/pin', { body: JSON.stringify({ claim: scan.claim, pin: malo }) })));
const porPin = statuses(pins.map((r) => r.status));
assert.equal(porPin[400], 4, JSON.stringify(porPin));
assert.equal(porPin[429], 16);
await call('ana', '/api/attendance/checkin/pin', { claim: scan.claim, pin: open.pin }, 429); // ni el correcto pasa ya
checks += 2;

// Acertar no cuenta como fallo.
const luisCourse = (await call('docente', '/api/attendance/session', { course: c, date: '2026-09-29', start_time: '07:00' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: [{ name: 'Luis', email: 'luis@example.test' }] });
await call('luis', '/api/me');
const open2 = await call('docente', '/api/attendance/checkin/open', { course: c, session: luisCourse, minutes: 15 });
const w2 = Math.floor(Date.now() / 10_000);
const qr2 = `${open2.code}.${w2.toString(36)}.${createHmac('sha256', Buffer.from(open2.secret, 'base64url')).update(`${open2.code}.${w2}`).digest('base64url').slice(0, 16)}`;
const scan2 = await call('luis', '/api/attendance/checkin', { token: qr2, device: 'telefono-de-luis' });
await call('luis', '/api/attendance/checkin/pin', { claim: scan2.claim, pin: open2.pin });
const fila = await store.DB.prepare('SELECT failures, checked_in FROM aula_checkins WHERE session=?').bind(luisCourse).first();
assert.equal(fila.failures, 0);
assert(fila.checked_in);
checks += 2;

// ---- 4. Cuota del alumno: subidas en paralelo no pasan juntas ----
await store.DB.prepare("INSERT INTO aula_files (id,course,owner,scope,name,size,mime,created) VALUES ('relleno',?,(SELECT id FROM aula_users WHERE email='ana@example.test'),'submission','viejo.pdf',?,'application/pdf','2026-01-01')")
  .bind(c, 290 * 1024 * 1024)
  .run();
const MB6 = new Uint8Array(6 * 1024 * 1024);
const subidas = await Promise.all(
  [1, 2, 3].map((n) => raw('ana', `/api/upload?course=${c}&scope=submission`, { body: MB6, headers: { 'x-file-name': `parte${n}.pdf`, 'content-type': 'application/pdf' } })),
);
const porSubida = statuses(subidas.map((r) => r.status));
assert.deepEqual(porSubida, { 201: 1, 413: 2 }, JSON.stringify(porSubida));
const r2 = await store.DB.prepare("SELECT count(*) AS n FROM aula_files WHERE course=? AND id<>'relleno'").bind(c).first();
assert.equal(r2.n, 1, 'Solo quedó registrada la subida que cabía');
checks += 2;

// ---- 5. Un co-docente no degrada ni quita a otro ----
await store.DB.prepare("INSERT INTO aula_members (id,course,email,name,role,section) VALUES ('m-adjunto',?,'adjunto@example.test','Adjunto','teacher','')").bind(c).run();
await call('docente', '/api/member', { course: c, email: 'adjunto@example.test', name: 'Adjunto' }, 409);
await call('docente', '/api/members/bulk', { course: c, students: [{ name: 'Adjunto', email: 'adjunto@example.test' }] });
await call('docente', '/api/member', { course: c, id: 'm-adjunto' }, 200, 'DELETE');
const adjunto = await store.DB.prepare("SELECT role FROM aula_members WHERE id='m-adjunto'").first();
assert.equal(adjunto.role, 'teacher', 'Sigue siendo co-docente');
checks++;

// ---- 7. Detalles ----
assert.throws(() => evaluate('constructor(1)'), (e) => !(e instanceof TypeError), 'Una función heredada no se resuelve');
assert.throws(() => evaluate('__proto__(1)'), (e) => !(e instanceof TypeError));
const roto = await worker.fetch(new Request('https://t.local/%E0%A4%A'), env);
assert.equal(roto.status, 404, 'Un % mal formado es 404, no 500');
checks += 3;

// Al alumno no le llegan los pesos de actividades ocultas.
const visible = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Visible', visible: true } }, 201);
const oculta = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Borrador', visible: false } }, 201);
await store.DB.prepare('UPDATE aula_tasks SET weight=10 WHERE id IN (?,?)').bind(visible.id, oculta.id).run();
await store.DB.prepare("INSERT OR IGNORE INTO aula_grade_settings (course,updated,updated_by) VALUES (?, '2026-01-01', 'x')").bind(c).run();
const pesos = (who) => call(who, '/api/course?id=' + c).then((d) => d.records.find((r) => r.kind === 'weights')?.data.weights || {});
assert.deepEqual(Object.keys(await pesos('ana')), [visible.id]);
assert.deepEqual(Object.keys(await pesos('docente')).sort(), [visible.id, oculta.id].sort());
checks += 2;

console.log(`PASS: ${checks} verificaciones de seguridad — curso archivado con curso señuelo, enviar sin comenzar, códigos y PIN en paralelo, cuota sin carrera, co-docentes protegidos y detalles.`);
