// Notificaciones en el celular y la computadora (Web Push, 12.72). Sin aplicación de tienda: el navegador se suscribe
// con la llave pública de Enlace y el servicio de avisos del navegador (Google, Apple, Mozilla, Microsoft) entrega lo
// que Enlace le manda, cifrado de punta a punta (RFC 8291) y firmado con VAPID (RFC 8292).
//
// - La llave VAPID se crea sola la primera vez y se guarda en aula_push_meta cifrada con SESSION_SECRET (un respaldo
//   de la base no basta para enviar avisos). Si SESSION_SECRET cambia, se crea otra y las suscripciones viejas se
//   borran (el navegador se vuelve a suscribir solo al abrir Enlace).
// - Cada suscripción está ligada a la sesión con la que se activó: al cerrar sesión, cerrar todas o suspender la
//   cuenta, ese navegador deja de recibir avisos (pushSql() solo toma sesiones vigentes).
// - Los avisos se encolan con una sola instrucción INSERT … SELECT (pushSql) dentro de la operación que los causa, y
//   se envían al terminar la respuesta (waitUntil) hasta PER_REQUEST; lo demás, la tarea programada de cada 5 min.
//   Así nunca se pasa del límite de 50 subsolicitudes por ejecución del plan gratuito.
// - El texto del aviso no lleva calificaciones ni el contenido de los mensajes: solo qué pasó y en qué curso.
import { all, base64url, fail, fromBase64url, json, nowIso, one, readJson, run } from './http.js';
import { conditionsSql } from './condiciones.js';
import { sectionSql, specialTaskSql } from './published.js';

export const PUSH_CRON = '*/5 * * * *'; // el de wrangler.toml
const PER_REQUEST = 30; // avisos que se envían al terminar una solicitud (lo demás, en la tarea programada)
const PER_CRON = 40;
const MAX_PER_USER = 10; // navegadores por persona; al pasarse se borra el más viejo
const TTL_SECONDS = 24 * 3600;
const REMINDER_HOUR = 18; // hora local (Ciudad de México) de los recordatorios de «vence mañana»
const MX_OFFSET_HOURS = 6; // Ciudad de México es UTC−6 todo el año (sin horario de verano desde 2022)

/** Servicios de avisos de los navegadores. Solo a estos se envía (nunca a una dirección cualquiera). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

export function validEndpoint(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || String(value).length > 1000) return null;
  return PUSH_HOSTS.some((re) => re.test(url.hostname)) ? url.href : null;
}

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/**
 * Encola un aviso para cada navegador de las personas que devuelve `select` (columnas user_id, title, body, url, tag).
 * Solo sesiones vigentes y cuentas no suspendidas. Úsalo con db.prepare(pushSql(…)).bind(…) dentro del mismo batch
 * que la operación (antes de ella si el SELECT depende del estado anterior).
 */
export const pushSql = (select, where = '') => `INSERT INTO aula_push_queue (endpoint, p256dh, auth, origin, payload, expires, created)
  SELECT s.endpoint, s.p256dh, s.auth, s.origin,
    json_object('title', substr(n.title,1,120), 'body', substr(coalesce(n.body,''),1,240), 'url', n.url, 'tag', n.tag),
    strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day'), ${NOW_SQL}
  FROM (${select}) n
  JOIN aula_push_subscriptions s ON s.user_id=n.user_id
  JOIN aula_logins l ON l.id=s.sid AND l.user_id=s.user_id AND l.revoked_at IS NULL AND l.expires>${NOW_SQL}
  JOIN aula_users u ON u.id=s.user_id AND u.suspended_at IS NULL${where ? ` WHERE ${where}` : ''}`;

/** Aviso a las cuentas de unas inscripciones de alumno del curso (alumnos sin cuenta no reciben nada). */
export const pushToMembers = (db, course, memberIds, { title, body, url, tag }) =>
  db
    .prepare(
      pushSql(`SELECT DISTINCT m.user_id, ? AS title, ? AS body, ? AS url, ? AS tag FROM aula_members m
        WHERE m.course=? AND m.role='student' AND m.id IN (SELECT value FROM json_each(?)) AND m.user_id IS NOT NULL`),
    )
    .bind(title, body, url, tag, course, JSON.stringify(memberIds));

/** Aviso a quienes enseñan en el curso: propietario y co-docentes que sigan siendo docentes. */
export const pushToTeachers = (db, course, { title, body, url, tag }, exceptUser = '') =>
  db
    .prepare(
      pushSql(`SELECT t.user_id, ? AS title, ? AS body, ? AS url, ? AS tag FROM (
        SELECT c.owner AS user_id FROM aula_courses c WHERE c.id=?
        UNION SELECT m.user_id FROM aula_members m WHERE m.course=? AND m.role='teacher' AND m.user_id IS NOT NULL) t
        JOIN aula_users tu ON tu.id=t.user_id AND tu.role IN ('teacher','admin') WHERE t.user_id<>?`),
    )
    .bind(title, body, url, tag, course, course, exceptUser);

/** Dirección dentro de Enlace (la ruta de navegacion.js) que abre el aviso. */
export const courseUrl = (course, section, detail) =>
  `/#${new URLSearchParams({ c: course, s: section, ...(detail ? { d: detail } : {}) }).toString()}`;

/** Notificación de calificación publicada (12.72): qué actividad y en qué curso, nunca la calificación. */
export const gradeNotice = (course, task) => ({
  title: 'Calificación publicada',
  body: `${task.title} · ${course.name}`,
  url: courseUrl(course.id, 'task', task.id),
  tag: `calificacion:${task.id}`,
});

/**
 * Después de encolar: si algo quedó en la cola, se envía al terminar la respuesta. `results` son los resultados de
 * run()/batch() de las instrucciones de pushSql. En las pruebas (sin waitUntil) se envía antes de responder.
 */
export async function flushPush(ctx, ...results) {
  if (!results.flat().some((r) => r?.meta?.changes > 0)) return;
  const sending = sendQueued(ctx.env, PER_REQUEST).catch((error) => console.error('aula-push', error));
  if (ctx.waitUntil) ctx.waitUntil(sending);
  else await sending;
}

// ---- Llave VAPID ----------------------------------------------------------------------------------------

const encoder = new TextEncoder();
let cachedKeys = null; // { secret, privateKey, publicKey (base64url, 65 bytes) } por aislamiento

async function wrappingKey(secret) {
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('enlace-push'), info: encoder.encode('llave VAPID') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function unwrap(secret, value) {
  try {
    const [iv, data] = String(value).split('.').map(fromBase64url);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await wrappingKey(secret), data);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null; // otra SESSION_SECRET (o dato dañado)
  }
}

async function wrap(secret, jwk) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await wrappingKey(secret), encoder.encode(JSON.stringify(jwk)));
  return `${base64url(iv)}.${base64url(data)}`;
}

/** La llave VAPID de esta instalación (la crea la primera vez). */
export async function vapidKeys(env) {
  const secret = env.SESSION_SECRET;
  if (!secret) fail('Falta SESSION_SECRET.', 503);
  if (cachedKeys?.secret === secret && cachedKeys.db === env.DB) return cachedKeys;
  const db = env.DB;
  let row = await one(db, "SELECT value FROM aula_push_meta WHERE key='vapid'");
  let jwk = row && (await unwrap(secret, row.value));
  if (!jwk) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const fresh = await wrap(secret, await crypto.subtle.exportKey('jwk', pair.privateKey));
    if (row) {
      // La llave guardada es de otra SESSION_SECRET: se reemplaza y las suscripciones hechas con ella ya no sirven.
      await db.batch([
        db.prepare("UPDATE aula_push_meta SET value=? WHERE key='vapid' AND value=?").bind(fresh, row.value),
        db.prepare('DELETE FROM aula_push_subscriptions'),
        db.prepare('DELETE FROM aula_push_queue'),
      ]);
    } else {
      await run(db, "INSERT INTO aula_push_meta (key, value) VALUES ('vapid', ?) ON CONFLICT(key) DO NOTHING", fresh);
    }
    // Si otra solicitud la creó al mismo tiempo, gana la que quedó guardada.
    row = await one(db, "SELECT value FROM aula_push_meta WHERE key='vapid'");
    jwk = await unwrap(secret, row?.value);
    if (!jwk) fail('No se pudo preparar la llave de notificaciones.', 503);
  }
  const { d: _d, key_ops: _ops, ...pub } = jwk;
  cachedKeys = {
    secret,
    db,
    privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']),
    publicKey: base64url(new Uint8Array([4, ...fromBase64url(pub.x), ...fromBase64url(pub.y)])),
  };
  return cachedKeys;
}

/** Encabezado Authorization de VAPID (RFC 8292): JWT ES256 para el origen del servicio de avisos. */
async function vapidAuthorization(keys, endpoint, origin) {
  const part = (value) => base64url(encoder.encode(JSON.stringify(value)));
  const subject = /^https:\/\//.test(origin) ? origin : 'mailto:avisos@enlace.invalid';
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, encoder.encode(unsigned));
  return `vapid t=${unsigned}.${base64url(signature)}, k=${keys.publicKey}`;
}

// ---- Cifrado del contenido (RFC 8291, aes128gcm) -------------------------------------------------------

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** Cifra `payload` para la suscripción (p256dh, auth). `test` permite fijar sal y llave efímera en las pruebas. */
export async function encryptPayload(payload, p256dh, auth, test = {}) {
  const uaPublic = fromBase64url(p256dh);
  const authSecret = fromBase64url(auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('Suscripción no válida');
  const local = test.keyPair || (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = test.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concat(typeof payload === 'string' ? encoder.encode(payload) : payload, new Uint8Array([2])); // 2 = último registro
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

// ---- Envío ---------------------------------------------------------------------------------------------

async function topicOf(tag) {
  if (!tag) return null;
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(tag))).slice(0, 32);
}

/** Envía un aviso a una suscripción. Devuelve el estado HTTP (0 si no se pudo conectar). */
async function deliver(env, keys, row) {
  const doFetch = env.PUSH_FETCH || fetch;
  const payload = JSON.parse(row.payload);
  const headers = {
    TTL: String(TTL_SECONDS),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    Urgency: 'high', // avisos que la persona ve (pocos y oportunos, como el pase de lista abierto)
    Authorization: await vapidAuthorization(keys, row.endpoint, row.origin),
  };
  const topic = await topicOf(payload.tag);
  if (topic) headers.Topic = topic;
  try {
    const res = await doFetch(row.endpoint, { method: 'POST', headers, body: await encryptPayload(row.payload, row.p256dh, row.auth) });
    if (res.status >= 300) console.error('aula-push', res.status, new URL(row.endpoint).hostname, (await res.text().catch(() => '')).slice(0, 200));
    return res.status;
  } catch (error) {
    console.error('aula-push', error?.message || error);
    return 0;
  }
}

/** Toma hasta `limit` avisos de la cola (los borra de una vez: dos ejecuciones nunca envían el mismo) y los envía. */
export async function sendQueued(env, limit = PER_CRON) {
  const db = env.DB;
  const rows = await all(
    db,
    'DELETE FROM aula_push_queue WHERE id IN (SELECT id FROM aula_push_queue ORDER BY id LIMIT ?) RETURNING id, endpoint, p256dh, auth, origin, payload, expires',
    limit,
  );
  const now = nowIso();
  const pending = rows.filter((r) => r.expires > now).sort((a, b) => a.id - b.id);
  if (!pending.length) return { sent: 0, gone: 0 };
  const keys = await vapidKeys(env);
  const statuses = await Promise.all(pending.map((row) => deliver(env, keys, row)));
  // 404/410: el navegador ya no tiene esa suscripción (la quitó la persona o se desinstaló).
  const gone = [...new Set(pending.filter((_, i) => statuses[i] === 404 || statuses[i] === 410).map((r) => r.endpoint))];
  if (gone.length) await run(db, 'DELETE FROM aula_push_subscriptions WHERE endpoint IN (SELECT value FROM json_each(?))', JSON.stringify(gone));
  return { sent: statuses.filter((s) => s >= 200 && s < 300).length, gone: gone.length };
}

// ---- Recordatorio «vence mañana» ----------------------------------------------------------------------

/** Fecha local (Ciudad de México) de un instante, como AAAA-MM-DD. */
const localDay = (date) => new Date(+date - MX_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);

/**
 * Una vez al día, a partir de las 18:00 de la Ciudad de México: a cada alumno, las actividades que vencen mañana (día
 * local) y que no ha entregado, y (12.75) las que vencieron en las últimas 24 horas sin que las entregara. Misma regla
 * de visibilidad que «vence pronto» del resumen por correo (sección, acceso especial, condiciones, prórroga y fecha de
 * la sección).
 */
export async function queueDueReminders(db, now = new Date()) {
  const local = new Date(+now - MX_OFFSET_HOURS * 3_600_000);
  if (local.getUTCHours() < REMINDER_HOUR) return 0;
  const today = localDay(now);
  // Solo una ejecución por día gana (las demás no cambian nada y no devuelven fila).
  const claimed = await one(
    db,
    `INSERT INTO aula_push_meta (key, value) VALUES ('reminders', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value
     WHERE aula_push_meta.value<>excluded.value RETURNING value`,
    today,
  );
  if (!claimed) return 0;
  const from = new Date(Date.parse(today + 'T00:00:00Z') + (24 + MX_OFFSET_HOURS) * 3_600_000).toISOString();
  const to = new Date(Date.parse(from) + 24 * 3_600_000).toISOString();
  const due = "coalesce(nullif(e.due,''), nullif(d.due,''), t.due)";
  // Mismas reglas de visibilidad y de «sin entregar» para los dos avisos.
  const pending = (when) => `FROM aula_members m
       JOIN aula_courses c ON c.id=m.course AND c.archived_at IS NULL AND c.student_visible=1
       JOIN aula_tasks t ON t.course=m.course AND t.visible=1 AND t.deleted_at IS NULL AND t.forum IS NULL
       LEFT JOIN aula_extensions e ON e.task=t.id AND e.member=m.id
       LEFT JOIN aula_section_dates d ON d.item=t.id AND d.section=m.section
       WHERE m.role='student' AND m.user_id IN (SELECT user_id FROM aula_push_subscriptions)
         AND NOT EXISTS (SELECT 1 FROM aula_deleted_courses x WHERE x.course=c.id)
         AND ${sectionSql('t.sections', 'm.section')} AND ${specialTaskSql('t', 'm.id')} AND ${conditionsSql('t.conditions', 'm.id')}
         AND ${when}
         AND NOT EXISTS (SELECT 1 FROM aula_submissions s WHERE s.task=t.id AND s.member=m.id AND (s.submitted!='' OR s.grade IS NOT NULL))`;
  // 12.75: lo que venció desde las 18:00 de ayer hasta las 18:00 de hoy (cada actividad entra en un solo día).
  const sixPm = new Date(Date.parse(today + 'T00:00:00Z') + (REMINDER_HOUR + MX_OFFSET_HOURS) * 3_600_000);
  const results = await db.batch([
    db
      .prepare(
        pushSql(`SELECT m.user_id, 'Vence mañana: ' || t.title AS title,
         c.name || ' · a las ' || strftime('%H:%M', ${due}, '-${MX_OFFSET_HOURS} hours') AS body,
         '/#c=' || c.id || '&s=task&d=' || t.id AS url, 'vence:' || t.id AS tag
       ${pending(`${due} >= ?1 AND ${due} < ?2`)}`),
      )
      .bind(from, to),
    db
      .prepare(
        pushSql(`SELECT m.user_id, 'Sin entregar: ' || t.title AS title,
         c.name || ' · venció el ' || strftime('%d/%m a las %H:%M', ${due}, '-${MX_OFFSET_HOURS} hours') AS body,
         '/#c=' || c.id || '&s=task&d=' || t.id AS url, 'vencida:' || t.id AS tag
       ${pending(`${due} <> '' AND ${due} >= ?1 AND ${due} < ?2`)}`),
      )
      .bind(new Date(+sixPm - 24 * 3_600_000).toISOString(), sixPm.toISOString()),
  ]);
  return results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
}

/** Tarea programada de cada 5 minutos: recordatorios del día (una vez) y lo que haya quedado en la cola. */
export async function runPush(env, now = new Date()) {
  await queueDueReminders(env.DB, now);
  return sendQueued(env, PER_CRON);
}

// ---- Rutas ---------------------------------------------------------------------------------------------

export const pushRoutes = {
  /** Llave pública para suscribirse y si este navegador (por su dirección) ya está suscrito con esta sesión. */
  'GET /api/push/key': async ({ env, db, user, url }) => {
    const keys = await vapidKeys(env);
    const endpoint = validEndpoint(url.searchParams.get('endpoint'));
    const mine = endpoint ? await one(db, 'SELECT sid FROM aula_push_subscriptions WHERE endpoint=? AND user_id=?', endpoint, user.id) : null;
    return json({ publicKey: keys.publicKey, subscribed: Boolean(mine && mine.sid === user.sid) });
  },

  /** Guarda (o mueve a esta persona y sesión) la suscripción de este navegador. */
  'POST /api/push/subscribe': async ({ db, user, request, url }) => {
    const body = await readJson(request);
    const endpoint = validEndpoint(body.endpoint);
    if (!endpoint) fail('Este navegador usa un servicio de notificaciones que Enlace no reconoce.');
    const p256dh = String(body.keys?.p256dh || '');
    const auth = String(body.keys?.auth || '');
    let ok = false;
    try {
      ok = fromBase64url(p256dh).length === 65 && fromBase64url(p256dh)[0] === 4 && fromBase64url(auth).length === 16;
    } catch {
      ok = false;
    }
    if (!ok) fail('La suscripción del navegador no es válida.');
    const now = nowIso();
    await db.batch([
      db
        .prepare(
          `INSERT INTO aula_push_subscriptions (id, user_id, sid, endpoint, p256dh, auth, origin, created, updated) VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, sid=excluded.sid, p256dh=excluded.p256dh, auth=excluded.auth,
             origin=excluded.origin, updated=excluded.updated`,
        )
        .bind(crypto.randomUUID(), user.id, user.sid, endpoint, p256dh, auth, url.origin, now, now),
      // Como máximo MAX_PER_USER navegadores por persona: se olvidan los que no se han usado en más tiempo.
      db
        .prepare(
          `DELETE FROM aula_push_subscriptions WHERE user_id=?1 AND id NOT IN (
             SELECT id FROM aula_push_subscriptions WHERE user_id=?1 ORDER BY updated DESC LIMIT ${MAX_PER_USER})`,
        )
        .bind(user.id),
    ]);
    return json({ ok: true });
  },

  'POST /api/push/unsubscribe': async ({ db, user, request }) => {
    const body = await readJson(request);
    const endpoint = validEndpoint(body.endpoint);
    if (endpoint) await run(db, 'DELETE FROM aula_push_subscriptions WHERE endpoint=? AND user_id=?', endpoint, user.id);
    return json({ ok: true });
  },

  /** Aviso de prueba a este navegador. */
  'POST /api/push/test': async (ctx) => {
    const { db, user, request } = ctx;
    const body = await readJson(request);
    const endpoint = validEndpoint(body.endpoint);
    if (!endpoint) fail('Activa primero las notificaciones en este dispositivo.');
    const result = await run(
      db,
      pushSql("SELECT ? AS user_id, 'Enlace' AS title, 'Las notificaciones funcionan en este dispositivo.' AS body, '/' AS url, 'prueba' AS tag", 's.endpoint=? AND s.sid=?'),
      user.id,
      endpoint,
      user.sid,
    );
    if (!result.meta?.changes) fail('Este dispositivo no tiene las notificaciones activadas con esta sesión.', 404);
    await flushPush(ctx, result);
    return json({ ok: true });
  },
};
