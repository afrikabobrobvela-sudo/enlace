// Asistencia: sesiones de clase, registro por alumno y reglas para calcular el porcentaje.
import { access, requireTeacher, viewAs } from './access.js';
import { validSection } from './sections.js';
import {
  all,
  base64url,
  fail,
  fromBase64url,
  json,
  nowIso,
  one,
  optionalText,
  randomToken,
  readJson,
  run,
  signToken,
  verifyToken,
} from './http.js';

const STATUSES = ['present', 'late', 'absent', 'excused'];
const DEFAULT_SETTINGS = { min_percent: 80, lates_per_absence: 0, excused_counts: 'present' };
const MAX_GENERATED = 200;
// Registro con QR: la firma cambia cada 10 s y se acepta hasta ~30 s después (lo que tarda un teléfono en leerla).
const WINDOW_MS = 10_000;
const MAX_PIN_FAILURES = 5;
const CLOSED = 'El registro de asistencia de esta clase ya se cerró. Pide al docente que te registre.';
const EXPIRED = 'El código QR expiró: cambia cada 10 segundos. Vuelve a escanear el que está proyectado.';
const BLOCKED = 'Demasiados intentos con PIN incorrecto. Pide al docente que te registre.';
// Registro con código escrito en el pizarrón: sin letras que se confunden (0/O, 1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const RADII = [0, 100, 150, 300, 500];
const NO_CODE = 'Ese código no corresponde a ningún registro abierto. Revisa que lo hayas copiado bien o pide el código actual a tu docente.';

function boardCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** Ubicación enviada por el navegador; null si no viene o no es válida. */
function validLocation(value) {
  if (!value || typeof value !== 'object') return null;
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  const accuracy = Number(value.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? Math.min(accuracy, 100_000) : 1000 };
}

/** Distancia en metros entre dos puntos (fórmula del semiverseno). */
export function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Red de la solicitud: prefijo de la IP pública (/24 en IPv4, /48 en IPv6). Solo es un indicio: la red de la escuela suele compartir IP. */
export function networkOf(request) {
  const ip = String(request.headers.get('CF-Connecting-IP') || '').trim().toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return 'v4:' + ip.split('.').slice(0, 3).join('.');
  if (ip.includes(':')) {
    const [head] = ip.split('::');
    const groups = head.split(':').filter(Boolean);
    return 'v6:' + [...groups, '0', '0', '0'].slice(0, 3).join(':');
  }
  return null;
}

const distanceText = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

/**
 * Revisa la ubicación del alumno contra la del salón. Devuelve lo que se guarda (distancia, precisión, red)
 * y el motivo para revisar ('' si todo está bien). Nunca se guardan las coordenadas del alumno.
 */
function locationCheck(session, place, locationError, network) {
  const sameNetwork = session.checkin_network && network ? (session.checkin_network === network ? 1 : 0) : null;
  const result = { distance: null, accuracy: place ? Math.round(place.accuracy) : null, sameNetwork, flag: '' };
  if (!session.checkin_radius) return result;
  if (session.checkin_lat === null || session.checkin_lat === undefined) {
    // El docente no compartió la ubicación del salón: solo queda la red como indicio.
    if (sameNetwork === 0) result.flag = 'se registró desde otra red que el docente';
    return result;
  }
  if (!place || place.accuracy > 2000) {
    if (sameNetwork !== 1) result.flag = place ? `ubicación muy imprecisa (±${distanceText(place.accuracy)})` : locationError === 'denied' ? 'no permitió ver su ubicación' : 'no se obtuvo su ubicación';
    return result;
  }
  const distance = distanceMeters({ lat: session.checkin_lat, lng: session.checkin_lng }, place);
  result.distance = Math.round(distance);
  // Margen por la imprecisión de ambos teléfonos dentro de edificios (hasta 250 m cada uno).
  const margin = Math.min(place.accuracy, 250) + Math.min(session.checkin_accuracy ?? 0, 250);
  if (distance > session.checkin_radius + margin) result.flag = `a ${distanceText(distance)} del salón`;
  return result;
}

async function qrSignature(secret, code, window) {
  const key = await crypto.subtle.importKey('raw', fromBase64url(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${code}.${window}`));
  return base64url(signature).slice(0, 16);
}

/** Comparación en tiempo constante (no revela cuántos caracteres coinciden). */
function sameText(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

function validDevice(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(value)) fail('No se pudo identificar este dispositivo. Recarga la página.');
  return value;
}

const isOpen = (session) => Boolean(session?.checkin_code && session.checkin_until && Date.parse(session.checkin_until) > Date.now());

async function checkinSession(db, where, value) {
  return one(db, `SELECT s.*, c.name AS course_name FROM aula_sessions s JOIN aula_courses c ON c.id=s.course WHERE s.${where}=?`, value);
}

/** Marca la asistencia y el teléfono usado, en una sola transacción. */
async function registerCheckin(db, session, memberId, device, userId, check = null) {
  const now = new Date();
  const how = session.checkin_mode === 'code' ? 'Registro con código' : 'Registro con QR';
  const note = check?.flag ? `${how} · Por revisar: ${check.flag}` : how;
  const late = session.checkin_late_minutes > 0 && now - Date.parse(session.checkin_started) > session.checkin_late_minutes * 60_000;
  const status = late ? 'late' : 'present';
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO aula_checkins (session,member,device,failures,checked_in,distance,accuracy,same_network,flag) VALUES (?,?,?,0,?,?,?,?,?)
           ON CONFLICT(session,member) DO UPDATE SET device=excluded.device, checked_in=excluded.checked_in, distance=excluded.distance,
             accuracy=excluded.accuracy, same_network=excluded.same_network, flag=excluded.flag, reviewed_by=NULL`,
        )
        .bind(session.id, memberId, device, now.toISOString(), check?.distance ?? null, check?.accuracy ?? null, check?.sameNetwork ?? null, check?.flag || ''),
      db
        .prepare(
          `INSERT INTO aula_attendance (session,member,status,note,updated_by,updated) VALUES (?,?,?,?,?,?)
           ON CONFLICT(session,member) DO UPDATE SET status=excluded.status, note=excluded.note,
             updated_by=excluded.updated_by, updated=excluded.updated`,
        )
        .bind(session.id, memberId, status, note, userId, now.toISOString()),
    ]);
  } catch (error) {
    if (/UNIQUE/i.test(String(error?.message))) {
      fail('Este teléfono ya registró a otro alumno en esta clase. Cada alumno debe registrarse desde su propio teléfono.', 409);
    }
    throw error;
  }
  return { course: session.course_name, date: session.date, start_time: session.start_time, status, ...(check ? { review: Boolean(check.flag) } : {}) };
}

/** Acepta solo fechas reales con formato AAAA-MM-DD (rechaza, por ejemplo, 2026-02-30). */
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Fecha no válida.');
  const date = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail('Fecha no válida.');
  return value;
}

function validTime(value) {
  const time = String(value ?? '').trim();
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail('Hora no válida (usa HH:MM).');
  return time;
}

const OTHER_SECTION = 'Este registro de asistencia es para otra sección del curso. Regístrate en la clase de tu sección.';

async function sessionOf(db, id, course) {
  const session = await one(db, 'SELECT * FROM aula_sessions WHERE id=? AND course=?', id, course);
  if (!session) fail('Sesión no encontrada.', 404);
  return session;
}

export const attendanceRoutes = {
  'GET /api/attendance': async ({ db, user, url }) => {
    const course = url.searchParams.get('course');
    const a = await access(db, user, course);
    const { teach, viewer, member } = await viewAs(db, a, user, url);
    const settings =
      (await one(db, 'SELECT min_percent, lates_per_absence, excused_counts FROM aula_attendance_settings WHERE course=?', course)) ||
      DEFAULT_SETTINGS;
    // El alumno solo ve las clases de todo el curso y las de su sección.
    const sessions = await all(
      db,
      `SELECT id, date, start_time, topic, section FROM aula_sessions WHERE course=?1
         AND (?2 OR section='' OR section=(SELECT section FROM aula_members WHERE course=?1 AND role='student' AND (id=?4 OR (?4 IS NULL AND user_id=?3))))
       ORDER BY date, start_time`,
      course,
      teach ? 1 : 0,
      viewer,
      member?.id ?? null,
    );
    const records = teach
      ? await all(
          db,
          'SELECT a.session, a.member, a.status, a.note FROM aula_attendance a JOIN aula_sessions s ON s.id=a.session WHERE s.course=?',
          course,
        )
      : await all(
          db,
          `SELECT a.session, a.member, a.status, a.note FROM aula_attendance a
           JOIN aula_sessions s ON s.id=a.session JOIN aula_members m ON m.id=a.member
           WHERE s.course=?1 AND (m.id=?3 OR (?3 IS NULL AND m.user_id=?2))`,
          course,
          viewer,
          member?.id ?? null,
        );
    return json({ settings, sessions, records, canTeach: teach });
  },

  'POST /api/attendance/session': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const id = crypto.randomUUID();
    const section = await validSection(db, body.course, body.section);
    try {
      await run(
        db,
        'INSERT INTO aula_sessions (id,course,date,start_time,topic,created_by,created,section) VALUES (?,?,?,?,?,?,?,?)',
        id,
        body.course,
        validDate(body.date),
        validTime(body.start_time),
        optionalText(body.topic, 200),
        user.id,
        nowIso(),
        section,
      );
    } catch (error) {
      if (error.status) throw error;
      fail(section ? 'Esa sección ya tiene una sesión en esa fecha y hora.' : 'Ya existe una sesión en esa fecha y hora.', 409);
    }
    return json({ id }, 201);
  },

  // Genera las sesiones del periodo a partir de los días de clase, sin duplicar las que ya existen.
  'POST /api/attendance/generate': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const from = validDate(body.from);
    const to = validDate(body.to);
    if (from > to) fail('La fecha final debe ser posterior a la inicial.');
    const weekdays = Array.isArray(body.weekdays) ? [...new Set(body.weekdays)] : [];
    if (!weekdays.length || weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) fail('Elige al menos un día de clase.');
    const skip = new Set((Array.isArray(body.skip) ? body.skip : []).map(validDate));
    const time = validTime(body.start_time);
    const section = await validSection(db, body.course, body.section);
    const dates = [];
    for (let d = new Date(from + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      if (weekdays.includes(d.getUTCDay()) && !skip.has(date)) dates.push(date);
      if (dates.length > MAX_GENERATED) fail(`El periodo genera más de ${MAX_GENERATED} sesiones. Acorta las fechas.`);
    }
    if (!dates.length) fail('Ninguna fecha del periodo coincide con los días elegidos.');
    const now = nowIso();
    const rows = dates.map((date) => ({ id: crypto.randomUUID(), date }));
    const result = await run(
      db,
      `INSERT OR IGNORE INTO aula_sessions (id,course,date,start_time,topic,created_by,created,section)
       SELECT json_extract(j.value,'$.id'), ?1, json_extract(j.value,'$.date'), ?2, ?3, ?4, ?5, ?7 FROM json_each(?6) j`,
      body.course,
      time,
      optionalText(body.topic, 200),
      user.id,
      now,
      JSON.stringify(rows),
      section,
    );
    return json({ created: result.meta.changes, existing: dates.length - result.meta.changes }, 201);
  },

  'DELETE /api/attendance/session': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    await sessionOf(db, body.id, body.course);
    // ON DELETE CASCADE borra también los registros de esa sesión.
    await run(db, 'DELETE FROM aula_sessions WHERE id=? AND course=?', body.id, body.course);
    return json({ ok: true });
  },

  // Guarda uno o varios registros (un toque en la lista o "todos presentes") en una sola consulta.
  'POST /api/attendance/mark': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const session = await sessionOf(db, body.session, body.course);
    if (!Array.isArray(body.marks) || !body.marks.length || body.marks.length > 500) fail('No hay registros para guardar.');
    const byMember = new Map();
    for (const mark of body.marks) {
      if (!STATUSES.includes(mark?.status)) fail('Estado de asistencia no válido.');
      byMember.set(String(mark.member ?? ''), { member: String(mark.member ?? ''), status: mark.status, note: optionalText(mark.note, 500) });
    }
    const marks = JSON.stringify([...byMember.values()]);
    const valid = await one(
      db,
      `SELECT count(*) AS n FROM aula_members m
       WHERE m.course=? AND m.role='student' AND (?='' OR m.section=?) AND m.id IN (SELECT json_extract(value,'$.member') FROM json_each(?))`,
      body.course,
      session.section,
      session.section,
      marks,
    );
    if (valid.n !== byMember.size) fail(session.section ? 'Hay alumnos que no pertenecen a la sección de esta clase.' : 'Hay alumnos que no pertenecen a este curso.');
    await run(
      db,
      `INSERT INTO aula_attendance (session,member,status,note,updated_by,updated)
       SELECT ?1, json_extract(j.value,'$.member'), json_extract(j.value,'$.status'), json_extract(j.value,'$.note'), ?2, ?3
       FROM json_each(?4) j WHERE true
       ON CONFLICT(session,member) DO UPDATE SET status=excluded.status, note=excluded.note,
         updated_by=excluded.updated_by, updated=excluded.updated`,
      body.session,
      user.id,
      nowIso(),
      marks,
    );
    return json({ saved: byMember.size });
  },

  // ---- Registro con QR ----------------------------------------------------------------------

  // El docente abre el registro: se genera un código nuevo, un secreto para firmar el QR y, si se pide, un PIN.
  // Con mode='code' el código se escribe en el pizarrón y puede revisarse la ubicación del salón (del teléfono del docente).
  'POST /api/attendance/checkin/open': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const session = await sessionOf(db, body.session, body.course);
    const mode = body.mode === 'code' ? 'code' : 'qr';
    const minutes = Number(body.minutes ?? 15);
    const lateMinutes = Number(body.late_minutes ?? 0);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) fail('La duración debe ser de 1 a 180 minutos.');
    if (!Number.isInteger(lateMinutes) || lateMinutes < 0 || lateMinutes > 240) fail('El retardo debe ser de 0 a 240 minutos.');
    const radius = mode === 'code' ? Number(body.radius ?? 150) : 0;
    if (!RADII.includes(radius)) fail('Radio no válido.');
    const place = mode === 'code' && radius ? validLocation(body.location) : null;
    const pin = mode === 'code' || body.pin === false ? '' : String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
    const secret = randomToken(32);
    const started = new Date();
    const until = new Date(started.getTime() + minutes * 60_000).toISOString();
    let code;
    for (let attempt = 0; attempt < 3 && !code; attempt++) {
      const candidate = mode === 'code' ? boardCode() : randomToken(6);
      try {
        await run(
          db,
          `UPDATE aula_sessions SET checkin_code=?, checkin_secret=?, checkin_pin=?, checkin_started=?, checkin_until=?,
             checkin_late_minutes=?, checkin_mode=?, checkin_lat=?, checkin_lng=?, checkin_accuracy=?, checkin_radius=?,
             checkin_strict=?, checkin_network=? WHERE id=? AND course=?`,
          candidate,
          secret,
          pin,
          started.toISOString(),
          until,
          lateMinutes,
          mode,
          place?.lat ?? null,
          place?.lng ?? null,
          place?.accuracy ?? null,
          radius,
          mode === 'code' && body.strict === true ? 1 : 0,
          networkOf(request),
          session.id,
          body.course,
        );
        code = candidate;
      } catch (error) {
        if (!/UNIQUE/i.test(String(error?.message))) throw error;
      }
    }
    if (!code) fail('No se pudo abrir el registro. Inténtalo de nuevo.', 503);
    return json({
      code, secret, pin, until, started: started.toISOString(), late_minutes: lateMinutes, serverNow: Date.now(), windowMs: WINDOW_MS,
      mode, radius, strict: mode === 'code' && body.strict === true, located: Boolean(place),
    });
  },

  // Cambia el código escrito (por ejemplo, si alguien lo compartió). El anterior deja de servir de inmediato.
  'POST /api/attendance/checkin/rotate': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const session = await sessionOf(db, body.session, body.course);
    if (!isOpen(session) || session.checkin_mode !== 'code') fail('El registro con código no está abierto.', 409);
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = boardCode();
      try {
        await run(db, 'UPDATE aula_sessions SET checkin_code=? WHERE id=? AND course=?', code, session.id, body.course);
        return json({ code });
      } catch (error) {
        if (!/UNIQUE/i.test(String(error?.message))) throw error;
      }
    }
    fail('No se pudo cambiar el código. Inténtalo de nuevo.', 503);
  },

  // El alumno escribe el código del pizarrón; el navegador envía su ubicación si la persona lo permite.
  'POST /api/attendance/checkin/code': async ({ db, user, request }) => {
    const body = await readJson(request);
    const code = String(body.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== CODE_LENGTH) fail(`El código tiene ${CODE_LENGTH} letras y números.`);
    const session = await one(
      db,
      "SELECT s.*, c.name AS course_name FROM aula_sessions s JOIN aula_courses c ON c.id=s.course WHERE s.checkin_code=? AND s.checkin_mode='code'",
      code,
    );
    if (!session) fail(NO_CODE, 404);
    if (!isOpen(session)) fail(CLOSED, 410);
    const device = validDevice(body.device);
    const member = await one(db, "SELECT id, section FROM aula_members WHERE course=? AND user_id=? AND role='student'", session.course, user.id);
    if (!member) fail('No estás inscrito como alumno en este curso.', 403);
    if (session.section && member.section !== session.section) fail(OTHER_SECTION, 403);
    const info = { course: session.course_name, date: session.date, start_time: session.start_time };
    const existing = await one(db, 'SELECT status FROM aula_attendance WHERE session=? AND member=?', session.id, member.id);
    if (existing && (existing.status === 'present' || existing.status === 'late')) return json({ ...info, status: existing.status, already: true });
    const check = locationCheck(session, validLocation(body.location), String(body.locationError || ''), networkOf(request));
    if (check.flag && session.checkin_strict) {
      fail(`No se pudo registrar tu asistencia: ${check.flag}. Si estás en el salón, activa la ubicación del navegador y vuelve a intentarlo, o pide a tu docente que te registre.`, 403);
    }
    return json(await registerCheckin(db, session, member.id, device, user.id, check));
  },

  // El docente confirma un registro "por revisar" (la falta se marca con la lista normal).
  'POST /api/attendance/checkin/review': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const session = await sessionOf(db, body.session, body.course);
    const now = nowIso();
    const [result] = await db.batch([
      db.prepare("UPDATE aula_checkins SET flag='', reviewed_by=? WHERE session=? AND member=? AND flag<>''").bind(user.id, session.id, body.member),
      db
        .prepare("UPDATE aula_attendance SET note=substr(note,1,instr(note,' · Por revisar')-1) || ' · Confirmado por el docente', updated_by=?, updated=? WHERE session=? AND member=? AND instr(note,' · Por revisar')>0")
        .bind(user.id, now, session.id, body.member),
    ]);
    if (!result.meta.changes) fail('Ese registro ya no está por revisar.', 409);
    return json({ ok: true });
  },

  'POST /api/attendance/checkin/close': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    await sessionOf(db, body.session, body.course);
    // La ubicación del salón solo se necesita mientras el registro está abierto.
    await run(
      db,
      'UPDATE aula_sessions SET checkin_code=NULL, checkin_until=?, checkin_lat=NULL, checkin_lng=NULL, checkin_accuracy=NULL, checkin_network=NULL WHERE id=? AND course=?',
      nowIso(),
      body.session,
      body.course,
    );
    return json({ ok: true });
  },

  // Estado de una sesión para la pantalla del docente (se consulta cada pocos segundos mientras el QR está abierto).
  'GET /api/attendance/session': async ({ db, user, url }) => {
    const course = url.searchParams.get('course');
    requireTeacher(await access(db, user, course));
    const session = await sessionOf(db, url.searchParams.get('id'), course);
    const [records, flags] = await Promise.all([
      all(db, 'SELECT member, status, note, updated FROM aula_attendance WHERE session=?', session.id),
      all(db, "SELECT member, flag, distance FROM aula_checkins WHERE session=? AND flag<>''", session.id),
    ]);
    const checkin = isOpen(session)
      ? {
          code: session.checkin_code,
          secret: session.checkin_secret,
          pin: session.checkin_pin,
          until: session.checkin_until,
          started: session.checkin_started,
          late_minutes: session.checkin_late_minutes,
          windowMs: WINDOW_MS,
          mode: session.checkin_mode,
          radius: session.checkin_radius,
          strict: session.checkin_strict === 1,
          located: session.checkin_lat !== null,
        }
      : null;
    return json({ session: { id: session.id, date: session.date, start_time: session.start_time, topic: session.topic, section: session.section }, records, flags, checkin, serverNow: Date.now() });
  },

  // El alumno escanea el QR. Si la clase pide PIN, recibe un permiso firmado de 2 minutos para escribirlo.
  'POST /api/attendance/checkin': async ({ db, user, env, request }) => {
    const body = await readJson(request);
    const [code, windowText, signature] = String(body.token ?? '').split('.');
    if (!code || !windowText || !signature) fail('Código QR no válido.');
    const session = await checkinSession(db, 'checkin_code', code);
    if (!isOpen(session)) fail(CLOSED, 410);
    if (session.checkin_mode === 'code') fail('Código QR no válido.');
    const window = parseInt(windowText, 36);
    const current = Math.floor(Date.now() / WINDOW_MS);
    if (!Number.isSafeInteger(window) || current - window > 2 || window - current > 1) fail(EXPIRED, 410);
    if (!sameText(signature, await qrSignature(session.checkin_secret, code, window))) fail('Código QR no válido.');
    const device = validDevice(body.device);
    const member = await one(db, "SELECT id, section FROM aula_members WHERE course=? AND user_id=? AND role='student'", session.course, user.id);
    if (!member) fail('No estás inscrito como alumno en este curso.', 403);
    if (session.section && member.section !== session.section) fail(OTHER_SECTION, 403);
    const info = { course: session.course_name, date: session.date, start_time: session.start_time };
    const existing = await one(db, 'SELECT status FROM aula_attendance WHERE session=? AND member=?', session.id, member.id);
    if (existing && (existing.status === 'present' || existing.status === 'late')) return json({ ...info, status: existing.status, already: true });
    if (session.checkin_pin) {
      const tries = await one(db, 'SELECT failures FROM aula_checkins WHERE session=? AND member=?', session.id, member.id);
      if ((tries?.failures || 0) >= MAX_PIN_FAILURES) fail(BLOCKED, 429);
      const exp = Math.floor(Date.now() / 1000) + 120;
      const claim = await signToken({ k: 'checkin', u: user.id, s: session.id, m: member.id, d: device, exp }, env.SESSION_SECRET);
      return json({ ...info, needPin: true, claim });
    }
    return json(await registerCheckin(db, session, member.id, device, user.id));
  },

  'POST /api/attendance/checkin/pin': async ({ db, user, env, request }) => {
    const body = await readJson(request);
    const claim = await verifyToken(body.claim, env.SESSION_SECRET);
    if (!claim || claim.k !== 'checkin' || claim.u !== user.id) fail('Tu registro expiró. Vuelve a escanear el código QR.', 410);
    const session = await checkinSession(db, 'id', claim.s);
    if (!isOpen(session)) fail(CLOSED, 410);
    const tries = await one(db, 'SELECT failures FROM aula_checkins WHERE session=? AND member=?', session.id, claim.m);
    const failures = tries?.failures || 0;
    if (failures >= MAX_PIN_FAILURES) fail(BLOCKED, 429);
    if (!sameText(String(body.pin ?? '').trim(), session.checkin_pin)) {
      await run(
        db,
        `INSERT INTO aula_checkins (session,member,device,failures) VALUES (?,?,?,1)
         ON CONFLICT(session,member) DO UPDATE SET failures=failures+1`,
        session.id,
        claim.m,
        claim.d,
      );
      const left = MAX_PIN_FAILURES - failures - 1;
      if (left <= 0) fail(BLOCKED, 429);
      fail(`PIN incorrecto. Te ${left === 1 ? 'queda 1 intento' : `quedan ${left} intentos`}.`);
    }
    return json(await registerCheckin(db, session, claim.m, claim.d, user.id));
  },

  'POST /api/attendance/settings': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const min = Number(body.min_percent);
    const lates = Number(body.lates_per_absence);
    if (!Number.isFinite(min) || min < 0 || min > 100) fail('El mínimo debe estar entre 0 y 100 %.');
    if (!Number.isInteger(lates) || lates < 0 || lates > 10) fail('Los retardos por falta deben ser de 0 a 10.');
    if (!['present', 'excluded'].includes(body.excused_counts)) fail('Opción no válida para faltas justificadas.');
    await run(
      db,
      `INSERT INTO aula_attendance_settings (course,min_percent,lates_per_absence,excused_counts,updated) VALUES (?,?,?,?,?)
       ON CONFLICT(course) DO UPDATE SET min_percent=excluded.min_percent, lates_per_absence=excluded.lates_per_absence,
         excused_counts=excluded.excused_counts, updated=excluded.updated`,
      body.course,
      min,
      lates,
      body.excused_counts,
      nowIso(),
    );
    return json({ ok: true });
  },
};
