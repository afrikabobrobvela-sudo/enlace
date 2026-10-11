// Notificaciones Web Push (12.72): suscripción, cifrado RFC 8291 (se descifra aquí como lo haría el navegador), firma
// VAPID, cada aviso llega a quien debe y no a otros, sin calificaciones en el texto, recordatorio de «vence mañana»
// una vez al día, sesión cerrada = sin avisos, suscripciones vencidas (410) y llave cifrada con SESSION_SECRET.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { encryptPayload, queueDueReminders, runPush, sendQueued, validEndpoint } from '../src/server/push.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const sent = []; // { endpoint, headers, body }
const gone = new Set();
const env = {
  DB: store.DB,
  BUCKET: memoryBucket(),
  AULA_OWNER_EMAIL: 'admin@example.test',
  SESSION_SECRET: 'x'.repeat(40),
  PUSH_FETCH: async (endpoint, init) => {
    sent.push({ endpoint, headers: init.headers, body: init.body });
    return new Response('', { status: gone.has(endpoint) ? 410 : 201 });
  },
};
let checks = 0;
const ok = (value, message) => {
  assert(value, message);
  checks++;
};
const cookies = {};
async function call(who, path, data, status = 200, exec) {
  cookies[who] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who[0].toUpperCase() + who.slice(1) }), env);
  const before = store.counter.queries;
  const sentBefore = sent.length;
  const res = await api(
    new Request('https://t.local' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { cookie: cookies[who], Origin: 'https://t.local', 'X-Aula-Request': '1' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
    exec,
  );
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${who}) → ${text}`);
  // Límite del plan gratuito: consultas + envíos (subsolicitudes) por solicitud.
  const used = store.counter.queries - before + (sent.length - sentBefore);
  assert(used <= 50, `${path}: ${used} consultas y envíos`);
  checks++;
  return JSON.parse(text);
}

// ---- Un «navegador» de prueba: llaves propias y descifrado como lo hace el navegador (RFC 8291) ----------------
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const fromB64u = (text) => new Uint8Array(Buffer.from(text, 'base64url'));
async function browser(id) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: b64u(publicRaw), auth: b64u(auth) }, pair, auth, publicRaw };
}
async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}
async function decrypt(b, body) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  assert.equal(rs, 4096);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, b.pair.privateKey, 256));
  const enc = new TextEncoder();
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...b.publicRaw, ...asPublic]);
  const ikm = await hkdf(b.auth, shared, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idlen)));
  assert.equal(plain[plain.length - 1], 2, 'delimitador del último registro');
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}
async function verifyVapid(headers, endpoint) {
  const [, t, k] = headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  const [h, p, sig] = t.split('.');
  const key = await crypto.subtle.importKey('raw', fromB64u(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromB64u(sig), new TextEncoder().encode(`${h}.${p}`));
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  return { valid, claims, header: JSON.parse(Buffer.from(h, 'base64url')), k };
}
/** Avisos enviados desde `mark` para el navegador `b`, ya descifrados. */
async function inbox(b, mark) {
  const mine = sent.slice(mark).filter((x) => x.endpoint === b.endpoint);
  return Promise.all(mine.map((x) => decrypt(b, x.body)));
}

// ---- Curso -------------------------------------------------------------------------------------------------
await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física', group: '1' }, 201)).id;
const otro = (await call('docente', '/api/courses', { name: 'Otro', group: '2' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: ['ana', 'beto'].map((n) => ({ name: n[0].toUpperCase() + n.slice(1), email: n + '@example.test' })) });
await call('docente', '/api/members/bulk', { course: otro, students: [{ name: 'Dani', email: 'dani@example.test' }] });
const members = (await call('docente', '/api/course?id=' + c)).members;
const id = (n) => members.find((m) => m.email === n + '@example.test').id;
const daniId = (await call('docente', '/api/course?id=' + otro)).members.find((m) => m.email === 'dani@example.test').id;

// ---- Suscripción ----------------------------------------------------------------------------------------------
const key = await call('ana', '/api/push/key');
ok(fromB64u(key.publicKey).length === 65 && fromB64u(key.publicKey)[0] === 4, 'llave pública P-256 sin comprimir');
ok((await call('beto', '/api/push/key')).publicKey === key.publicKey, 'una sola llave para la instalación');
const meta = await store.DB.prepare("SELECT value FROM aula_push_meta WHERE key='vapid'").first();
ok(!/"d"/.test(meta.value) && !meta.value.includes('{'), 'la llave privada se guarda cifrada');

ok(validEndpoint('https://fcm.googleapis.com/fcm/send/x'), 'FCM');
ok(validEndpoint('https://web.push.apple.com/abc'), 'Apple');
ok(validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'), 'Mozilla');
ok(validEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x'), 'Windows');
ok(!validEndpoint('https://evil.example/fcm.googleapis.com'), 'otro servidor no');
ok(!validEndpoint('http://fcm.googleapis.com/x'), 'sin https no');
ok(!validEndpoint('https://fcm.googleapis.com:8443/x'), 'otro puerto no');
ok(!validEndpoint('https://push.apple.com.evil.example/x'), 'dominio parecido no');

const anaPhone = await browser('ana-telefono');
const docPhone = await browser('docente-telefono');
const daniPhone = await browser('dani-telefono');
await call('ana', '/api/push/subscribe', { endpoint: 'https://evil.example/x', keys: anaPhone.keys }, 400);
await call('ana', '/api/push/subscribe', { endpoint: anaPhone.endpoint, keys: { p256dh: 'abc', auth: anaPhone.keys.auth } }, 400);
await call('ana', '/api/push/subscribe', { endpoint: anaPhone.endpoint, keys: anaPhone.keys });
await call('docente', '/api/push/subscribe', { endpoint: docPhone.endpoint, keys: docPhone.keys });
await call('dani', '/api/push/subscribe', { endpoint: daniPhone.endpoint, keys: daniPhone.keys });
ok((await call('ana', '/api/push/key?endpoint=' + encodeURIComponent(anaPhone.endpoint))).subscribed, 'ana suscrita');
ok(!(await call('beto', '/api/push/key?endpoint=' + encodeURIComponent(anaPhone.endpoint))).subscribed, 'beto no ve la de ana como suya');

// Prueba: firma VAPID y descifrado.
let mark = sent.length;
await call('ana', '/api/push/test', { endpoint: anaPhone.endpoint });
ok(sent.length === mark + 1, 'un aviso de prueba');
const vapid = await verifyVapid(sent[mark].headers, anaPhone.endpoint);
ok(vapid.valid, 'firma VAPID válida');
ok(vapid.header.alg === 'ES256' && vapid.claims.aud === 'https://fcm.googleapis.com' && vapid.claims.sub === 'https://t.local', 'aud y sub');
ok(vapid.claims.exp > Date.now() / 1000 && vapid.claims.exp <= Date.now() / 1000 + 24 * 3600, 'vence en menos de 24 h');
ok(vapid.k === key.publicKey, 'k = llave pública');
ok(sent[mark].headers['Content-Encoding'] === 'aes128gcm' && Number(sent[mark].headers.TTL) > 0 && /^[A-Za-z0-9_-]{1,32}$/.test(sent[mark].headers.Topic), 'encabezados');
ok((await inbox(anaPhone, mark))[0].body === 'Las notificaciones funcionan en este dispositivo.', 'se descifra como en el navegador');
await call('beto', '/api/push/test', { endpoint: anaPhone.endpoint }, 404); // no es de beto

// Cifrado: dos envíos del mismo texto no se parecen (sal y llave efímera nuevas).
const one = await encryptPayload('{"a":1}', anaPhone.keys.p256dh, anaPhone.keys.auth);
const two = await encryptPayload('{"a":1}', anaPhone.keys.p256dh, anaPhone.keys.auth);
ok(b64u(one) !== b64u(two), 'cada aviso con sal nueva');
ok((await decrypt(anaPhone, one)).a === 1, 'descifrado directo');

// ---- Mensajes ---------------------------------------------------------------------------------------------------
mark = sent.length;
await call('docente', '/api/messages', { course: c, members: [id('ana'), id('beto')], body: 'Mañana no hay clase. Calificación: 9' }, 201);
let got = await inbox(anaPhone, mark);
ok(got.length === 1 && got[0].title === 'Mensaje de Docente' && got[0].body === 'Física', 'mensaje del docente a ana');
ok(!JSON.stringify(got).includes('Mañana no hay clase'), 'sin el texto del mensaje');
ok(got[0].url === `/#c=${c}&s=messages`, 'abre la conversación');
ok(sent.length === mark + 1, 'beto no tiene notificaciones activadas');
mark = sent.length;
await call('docente', '/api/messages', { course: c, members: [daniId], body: 'Hola' }, 404); // de otro curso
ok(sent.length === mark, 'a un alumno de otro curso, nada');
await call('ana', '/api/messages', { course: c, body: 'Gracias' }, 201);
got = await inbox(docPhone, mark);
ok(got.length === 1 && got[0].title === 'Mensaje de Ana' && got[0].url === `/#c=${c}&s=messages&d=${id('ana')}`, 'al docente, con la conversación');
ok((await inbox(anaPhone, mark)).length === 0, 'quien escribe no recibe su propio aviso');

// ---- Calificaciones ---------------------------------------------------------------------------------------------
const tarea = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Práctica 1', visible: true } }, 201);
mark = sent.length;
const g1 = await call('docente', '/api/grade', { course: c, task: tarea.id, member: id('ana'), grade: 9.5, feedback: 'Bien' });
got = await inbox(anaPhone, mark);
ok(got.length === 1 && got[0].title === 'Calificación publicada' && got[0].body === 'Práctica 1 · Física', 'calificación publicada');
ok(!JSON.stringify(got).includes('9.5') && !JSON.stringify(got).includes('Bien'), 'sin la calificación ni el comentario');
ok(got[0].url === `/#c=${c}&s=task&d=${tarea.id}`, 'abre la actividad');
mark = sent.length;
await call('docente', '/api/grade', { course: c, task: tarea.id, member: id('ana'), grade: 9.5, feedback: 'Muy bien', revision: g1.revision });
ok((await inbox(anaPhone, mark)).length === 0, 'cambiar solo el comentario no vuelve a avisar');
const tarea2 = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Práctica 2', visible: true } }, 201);
mark = sent.length;
await call('docente', '/api/grade', { course: c, task: tarea2.id, member: id('ana'), grade: 7, publish: false });
ok((await inbox(anaPhone, mark)).length === 0, 'un borrador no avisa');
await call('docente', '/api/grades/publish', { course: c, task: tarea2.id });
got = await inbox(anaPhone, mark);
ok(got.length === 1 && got[0].body === 'Práctica 2 · Física', 'al publicar los borradores');
mark = sent.length;
await call('docente', '/api/grades/publish', { course: c, task: tarea2.id });
ok((await inbox(anaPhone, mark)).length === 0, 'publicar otra vez no repite');
const tarea3 = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Práctica 3', visible: true } }, 201);
await call('docente', '/api/grades/bulk', { course: c, task: tarea3.id, grade: 10, members: [id('ana'), id('beto')], publish: false });
ok((await inbox(anaPhone, mark)).length === 0, 'calificación en bloque como borrador: nada');
await call('docente', '/api/grades/bulk', { course: c, task: tarea3.id, grade: 10, members: [id('ana'), id('beto')], replace: true });
got = await inbox(anaPhone, mark);
ok(got.length === 1 && got[0].body === 'Práctica 3 · Física', 'calificación en bloque publicada');
mark = sent.length;
await call('docente', '/api/grades/bulk', { course: c, task: tarea3.id, grade: 10, members: [id('ana')], replace: true });
ok((await inbox(anaPhone, mark)).length === 0, 'la misma calificación otra vez: nada');

// ---- Entregas (al docente) --------------------------------------------------------------------------------------
const tarea4 = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Reporte', visible: true } }, 201);
mark = sent.length;
const entrega = await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: tarea4.id, body: 'Mi reporte' } }, 201);
got = await inbox(docPhone, mark);
ok(got.length === 1 && got[0].title === 'Entrega nueva: Reporte' && got[0].body === 'Ana · Física' && got[0].tag === `entregas:${tarea4.id}`, 'entrega nueva al docente');
const topicA = sent[sent.length - 1].headers.Topic;
mark = sent.length;
await call('ana', '/api/record', { course: c, kind: 'submission', id: entrega.id, revision: entrega.revision, data: { task: tarea4.id, body: 'Corregido' } });
got = await inbox(docPhone, mark);
ok(got.length === 1 && got[0].title === 'Entrega actualizada: Reporte', 'entrega actualizada');
ok(sent[sent.length - 1].headers.Topic === topicA, 'misma actividad, mismo Topic (el servicio junta las pendientes)');

// ---- Asistencia -------------------------------------------------------------------------------------------------
const clase = (await call('docente', '/api/attendance/session', { course: c, date: '2026-10-05' }, 201)).id;
mark = sent.length;
await call('docente', '/api/attendance/mark', { course: c, session: clase, marks: [{ member: id('ana'), status: 'absent' }, { member: id('beto'), status: 'present' }] });
got = await inbox(anaPhone, mark);
ok(got.length === 1 && got[0].title === 'Inasistencia registrada' && got[0].body === 'Física · clase del 05/10/2026', 'inasistencia');
ok(got[0].url === `/#c=${c}&s=attendance`, 'abre la asistencia');
mark = sent.length;
await call('docente', '/api/attendance/mark', { course: c, session: clase, marks: [{ member: id('ana'), status: 'absent', note: 'Sin justificante' }] });
ok((await inbox(anaPhone, mark)).length === 0, 'la misma falta otra vez: nada');
await call('docente', '/api/attendance/mark', { course: c, session: clase, marks: [{ member: id('ana'), status: 'present' }] });
ok((await inbox(anaPhone, mark)).length === 0, 'asistencia: nada');
await call('docente', '/api/attendance/mark', { course: c, session: clase, marks: [{ member: id('ana'), status: 'late' }] });
ok((await inbox(anaPhone, mark)).length === 0, 'retardo: nada');

const clase2 = (await call('docente', '/api/attendance/session', { course: c, date: '2026-10-06' }, 201)).id;
mark = sent.length;
await call('docente', '/api/attendance/checkin/open', { course: c, session: clase2, minutes: 10 });
got = await inbox(anaPhone, mark);
ok(got.length === 1 && got[0].title === 'Pase de lista abierto' && got[0].body === 'Física · regístrate en los próximos 10 min', 'pase de lista abierto');
ok((await inbox(daniPhone, mark)).length === 0, 'otro curso no');
mark = sent.length;
await call('docente', '/api/attendance/checkin/close', { course: c, session: clase2 });
got = await inbox(anaPhone, mark);
ok(got.length === 1 && got[0].title === 'Inasistencia registrada' && got[0].body === 'Física · clase del 06/10/2026', 'falta al cerrar el registro sin registrarse');
mark = sent.length;
await call('docente', '/api/attendance/checkin/close', { course: c, session: clase2 });
ok((await inbox(anaPhone, mark)).length === 0, 'cerrar otra vez no repite');

// ---- Noticia urgente (sin correo configurado, solo notificación) ------------------------------------------------
const noticia = await call('docente', '/api/record', { course: c, kind: 'notice', data: { title: 'Cambio de salón', body: 'Hoy en el 204', visible: true } }, 201);
mark = sent.length;
const aviso = await call('docente', '/api/notice/email', { course: c, id: noticia.id });
ok(aviso.notified === 1 && aviso.sent === 0, 'noticia urgente como notificación');
got = await inbox(anaPhone, mark);
ok(got.length === 1 && got[0].title === 'Cambio de salón' && got[0].body === 'Noticia de Física' && got[0].url === `/#c=${c}&s=notices`, 'contenido de la noticia urgente');
await call('docente', '/api/notice/email', { course: c, id: noticia.id }, 409); // una sola vez

// ---- Vence mañana -----------------------------------------------------------------------------------------------
// «Hoy» es el 11 de octubre de 2026 a las 19:00 de la Ciudad de México (01:00 UTC del 12).
const now = new Date('2026-10-12T01:00:00Z');
const manana = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Informe final', visible: true, due: '2026-10-13T04:30:00.000Z' } }, 201); // 12 oct 22:30 local
await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Pasado mañana', visible: true, due: '2026-10-13T07:00:00.000Z' } }, 201); // 13 oct 01:00 local
const entregada = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Ya entregada', visible: true, due: '2026-10-12T20:00:00.000Z' } }, 201);
await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: entregada.id, body: 'Listo' } }, 201);
await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Oculta', visible: false, due: '2026-10-12T20:00:00.000Z' } }, 201);
ok((await queueDueReminders(env.DB, new Date('2026-10-11T23:00:00Z'))) === 0, 'antes de las 18:00 (17:00 local) no');
mark = sent.length;
ok((await queueDueReminders(env.DB, now)) === 1, 'un recordatorio');
ok((await queueDueReminders(env.DB, new Date('2026-10-12T03:00:00Z'))) === 0, 'una sola vez al día');
await runPush(env, now);
got = await inbox(anaPhone, mark);
ok(got.length === 1 && got[0].title === 'Vence mañana: Informe final' && got[0].body === 'Física · a las 22:30' && got[0].url === `/#c=${c}&s=task&d=${manana.id}`, 'vence mañana');
ok((await inbox(docPhone, mark)).length === 0, 'al docente no');

// ---- Cola: lo que no alcanza se envía en la tarea programada ----------------------------------------------------
const extra = [];
for (let i = 0; i < 35; i++) {
  extra.push(await browser('ana-extra-' + i));
}
// Diez navegadores como máximo por persona: los más viejos se olvidan.
for (const b of extra.slice(0, 12)) await call('ana', '/api/push/subscribe', { endpoint: b.endpoint, keys: b.keys });
ok((await store.DB.prepare("SELECT count(*) AS n FROM aula_push_subscriptions s JOIN aula_users u ON u.id=s.user_id WHERE u.email='ana@example.test'").first()).n === 10, 'diez por persona');
ok(!(await store.DB.prepare('SELECT 1 FROM aula_push_subscriptions WHERE endpoint=?').bind(anaPhone.endpoint).first()), 'el más viejo se olvidó');
await call('ana', '/api/push/subscribe', { endpoint: anaPhone.endpoint, keys: anaPhone.keys }); // al abrir Enlace en él, vuelve
// Muchos alumnos con notificaciones: se envían 30 al terminar la solicitud y el resto en la tarea programada.
const many = Array.from({ length: 45 }, (_, i) => ({ name: `Alumno ${i}`, email: `a${i}@example.test` }));
await call('docente', '/api/members/bulk', { course: c, students: many });
for (let i = 0; i < 45; i++) await call(`a${i}`, '/api/push/subscribe', { endpoint: `https://fcm.googleapis.com/fcm/send/a${i}`, keys: anaPhone.keys });
const all45 = (await call('docente', '/api/course?id=' + c)).members.filter((m) => /^a\d+@/.test(m.email)).map((m) => m.id);
mark = sent.length;
await call('docente', '/api/messages', { course: c, members: all45, body: 'Aviso general' }, 201);
ok(sent.length - mark === 30, 'treinta al terminar la solicitud');
const queued = (await store.DB.prepare('SELECT count(*) AS n FROM aula_push_queue').first()).n;
ok(queued === 15, 'quince en la cola');
await runPush(env, now);
ok(sent.length - mark === 45, 'la tarea programada envía el resto');
ok((await store.DB.prepare('SELECT count(*) AS n FROM aula_push_queue').first()).n === 0, 'cola vacía');

// Con waitUntil (producción): la respuesta no espera el envío.
const pendientes = [];
mark = sent.length;
await call('docente', '/api/messages', { course: c, members: [id('ana')], body: 'Otra' }, 201, { waitUntil: (p) => pendientes.push(p) });
ok(pendientes.length === 1, 'envío con waitUntil');
await Promise.all(pendientes);
ok((await inbox(anaPhone, mark)).length === 1, 'llega después de responder');

// Avisos vencidos (más de un día en la cola) ya no se envían.
await store.DB.prepare(
  "INSERT INTO aula_push_queue (endpoint,p256dh,auth,origin,payload,expires,created) VALUES (?,?,?,?,?,'2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z')",
)
  .bind(anaPhone.endpoint, anaPhone.keys.p256dh, anaPhone.keys.auth, 'https://t.local', '{"title":"Viejo"}')
  .run();
mark = sent.length;
await sendQueued(env);
ok(sent.length === mark, 'lo vencido no se envía');

// ---- 410: el navegador quitó la suscripción ---------------------------------------------------------------------
gone.add(daniPhone.endpoint);
mark = sent.length;
const daniNotice = await call('docente', '/api/record', { course: otro, kind: 'notice', data: { title: 'Aviso', body: 'x', visible: true } }, 201);
await call('docente', '/api/notice/email', { course: otro, id: daniNotice.id });
ok(sent.length === mark + 1, 'se intentó');
ok(!(await store.DB.prepare('SELECT 1 FROM aula_push_subscriptions WHERE endpoint=?').bind(daniPhone.endpoint).first()), '410 borra la suscripción');

// ---- Sesión cerrada: sin avisos ----------------------------------------------------------------------------------
await call('ana', '/api/logout-all', {});
mark = sent.length;
await store.DB.prepare('DELETE FROM aula_push_queue').run();
await call('docente', '/api/messages', { course: c, members: [id('ana')], body: 'Después de salir' }, 201);
ok((await inbox(anaPhone, mark)).length === 0, 'al cerrar sesión deja de recibir');
delete cookies.ana;
ok(!(await call('ana', '/api/push/key?endpoint=' + encodeURIComponent(anaPhone.endpoint))).subscribed, 'con la sesión nueva no está ligada');
await call('ana', '/api/push/subscribe', { endpoint: anaPhone.endpoint, keys: anaPhone.keys });
mark = sent.length;
await call('docente', '/api/messages', { course: c, members: [id('ana')], body: 'De nuevo' }, 201);
ok((await inbox(anaPhone, mark)).length === 1, 'al volver a ligarla, llega otra vez');
// Mismo navegador, otra persona (computadora compartida): pasa a esa persona.
await call('beto', '/api/push/subscribe', { endpoint: anaPhone.endpoint, keys: anaPhone.keys });
mark = sent.length;
await call('docente', '/api/messages', { course: c, members: [id('ana')], body: 'Para Ana' }, 201);
ok((await inbox(anaPhone, mark)).length === 0, 'ya no es de ana');
await call('beto', '/api/push/unsubscribe', { endpoint: anaPhone.endpoint });
ok(!(await store.DB.prepare('SELECT 1 FROM aula_push_subscriptions WHERE endpoint=?').bind(anaPhone.endpoint).first()), 'desactivar la borra');

// ---- Otra SESSION_SECRET: llave nueva y suscripciones olvidadas -------------------------------------------------
const before = (await store.DB.prepare('SELECT count(*) AS n FROM aula_push_subscriptions').first()).n;
ok(before > 0, 'hay suscripciones');
const env2 = { ...env, SESSION_SECRET: 'y'.repeat(40) };
const { vapidKeys } = await import('../src/server/push.js');
const k2 = await vapidKeys(env2);
ok(k2.publicKey !== key.publicKey, 'llave nueva');
ok((await store.DB.prepare('SELECT count(*) AS n FROM aula_push_subscriptions').first()).n === 0, 'suscripciones viejas borradas');

console.log(`PASS: ${checks} verificaciones de notificaciones — suscripción, cifrado y firma VAPID, mensajes, calificaciones, entregas, asistencia, noticia urgente, vence mañana, cola y sesiones.`);
