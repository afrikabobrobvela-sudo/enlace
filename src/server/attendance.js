// Asistencia: sesiones de clase, registro por alumno y reglas para calcular el porcentaje.
import { access, requireTeacher } from './access.js';
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
async function registerCheckin(db, session, memberId, device, userId) {
  const now = new Date();
  const late = session.checkin_late_minutes > 0 && now - Date.parse(session.checkin_started) > session.checkin_late_minutes * 60_000;
  const status = late ? 'late' : 'present';
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO aula_checkins (session,member,device,failures,checked_in) VALUES (?,?,?,0,?)
           ON CONFLICT(session,member) DO UPDATE SET device=excluded.device, checked_in=excluded.checked_in`,
        )
        .bind(session.id, memberId, device, now.toISOString()),
      db
        .prepare(
          `INSERT INTO aula_attendance (session,member,status,note,updated_by,updated) VALUES (?,?,?,'Registro con QR',?,?)
           ON CONFLICT(session,member) DO UPDATE SET status=excluded.status, note=excluded.note,
             updated_by=excluded.updated_by, updated=excluded.updated`,
        )
        .bind(session.id, memberId, status, userId, now.toISOString()),
    ]);
  } catch (error) {
    if (/UNIQUE/i.test(String(error?.message))) {
      fail('Este teléfono ya registró a otro alumno en esta clase. Cada alumno debe registrarse desde su propio teléfono.', 409);
    }
    throw error;
  }
  return { course: session.course_name, date: session.date, start_time: session.start_time, status };
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

async function sessionOf(db, id, course) {
  const session = await one(db, 'SELECT * FROM aula_sessions WHERE id=? AND course=?', id, course);
  if (!session) fail('Sesión no encontrada.', 404);
  return session;
}

export const attendanceRoutes = {
  'GET /api/attendance': async ({ db, user, url }) => {
    const course = url.searchParams.get('course');
    const a = await access(db, user, course);
    const settings =
      (await one(db, 'SELECT min_percent, lates_per_absence, excused_counts FROM aula_attendance_settings WHERE course=?', course)) ||
      DEFAULT_SETTINGS;
    const sessions = await all(db, 'SELECT id, date, start_time, topic FROM aula_sessions WHERE course=? ORDER BY date, start_time', course);
    const records = a.teach
      ? await all(
          db,
          'SELECT a.session, a.member, a.status, a.note FROM aula_attendance a JOIN aula_sessions s ON s.id=a.session WHERE s.course=?',
          course,
        )
      : await all(
          db,
          `SELECT a.session, a.member, a.status, a.note FROM aula_attendance a
           JOIN aula_sessions s ON s.id=a.session JOIN aula_members m ON m.id=a.member
           WHERE s.course=? AND m.user_id=?`,
          course,
          user.id,
        );
    return json({ settings, sessions, records, canTeach: a.teach });
  },

  'POST /api/attendance/session': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const id = crypto.randomUUID();
    try {
      await run(
        db,
        'INSERT INTO aula_sessions (id,course,date,start_time,topic,created_by,created) VALUES (?,?,?,?,?,?,?)',
        id,
        body.course,
        validDate(body.date),
        validTime(body.start_time),
        optionalText(body.topic, 200),
        user.id,
        nowIso(),
      );
    } catch (error) {
      if (error.status) throw error;
      fail('Ya existe una sesión en esa fecha y hora.', 409);
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
      `INSERT OR IGNORE INTO aula_sessions (id,course,date,start_time,topic,created_by,created)
       SELECT json_extract(j.value,'$.id'), ?1, json_extract(j.value,'$.date'), ?2, ?3, ?4, ?5 FROM json_each(?6) j`,
      body.course,
      time,
      optionalText(body.topic, 200),
      user.id,
      now,
      JSON.stringify(rows),
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
    await sessionOf(db, body.session, body.course);
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
       WHERE m.course=? AND m.role='student' AND m.id IN (SELECT json_extract(value,'$.member') FROM json_each(?))`,
      body.course,
      marks,
    );
    if (valid.n !== byMember.size) fail('Hay alumnos que no pertenecen a este curso.');
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
  'POST /api/attendance/checkin/open': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const session = await sessionOf(db, body.session, body.course);
    const minutes = Number(body.minutes ?? 15);
    const lateMinutes = Number(body.late_minutes ?? 0);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) fail('La duración debe ser de 1 a 180 minutos.');
    if (!Number.isInteger(lateMinutes) || lateMinutes < 0 || lateMinutes > 240) fail('El retardo debe ser de 0 a 240 minutos.');
    const pin = body.pin === false ? '' : String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
    const secret = randomToken(32);
    const started = new Date();
    const until = new Date(started.getTime() + minutes * 60_000).toISOString();
    let code;
    for (let attempt = 0; attempt < 3 && !code; attempt++) {
      const candidate = randomToken(6);
      try {
        await run(
          db,
          `UPDATE aula_sessions SET checkin_code=?, checkin_secret=?, checkin_pin=?, checkin_started=?, checkin_until=?,
             checkin_late_minutes=? WHERE id=? AND course=?`,
          candidate,
          secret,
          pin,
          started.toISOString(),
          until,
          lateMinutes,
          session.id,
          body.course,
        );
        code = candidate;
      } catch (error) {
        if (!/UNIQUE/i.test(String(error?.message))) throw error;
      }
    }
    if (!code) fail('No se pudo abrir el registro. Inténtalo de nuevo.', 503);
    return json({ code, secret, pin, until, started: started.toISOString(), late_minutes: lateMinutes, serverNow: Date.now(), windowMs: WINDOW_MS });
  },

  'POST /api/attendance/checkin/close': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    await sessionOf(db, body.session, body.course);
    await run(db, 'UPDATE aula_sessions SET checkin_code=NULL, checkin_until=? WHERE id=? AND course=?', nowIso(), body.session, body.course);
    return json({ ok: true });
  },

  // Estado de una sesión para la pantalla del docente (se consulta cada pocos segundos mientras el QR está abierto).
  'GET /api/attendance/session': async ({ db, user, url }) => {
    const course = url.searchParams.get('course');
    requireTeacher(await access(db, user, course));
    const session = await sessionOf(db, url.searchParams.get('id'), course);
    const records = await all(db, 'SELECT member, status, note, updated FROM aula_attendance WHERE session=?', session.id);
    const checkin = isOpen(session)
      ? {
          code: session.checkin_code,
          secret: session.checkin_secret,
          pin: session.checkin_pin,
          until: session.checkin_until,
          started: session.checkin_started,
          late_minutes: session.checkin_late_minutes,
          windowMs: WINDOW_MS,
        }
      : null;
    return json({ session: { id: session.id, date: session.date, start_time: session.start_time, topic: session.topic }, records, checkin, serverNow: Date.now() });
  },

  // El alumno escanea el QR. Si la clase pide PIN, recibe un permiso firmado de 2 minutos para escribirlo.
  'POST /api/attendance/checkin': async ({ db, user, env, request }) => {
    const body = await readJson(request);
    const [code, windowText, signature] = String(body.token ?? '').split('.');
    if (!code || !windowText || !signature) fail('Código QR no válido.');
    const session = await checkinSession(db, 'checkin_code', code);
    if (!isOpen(session)) fail(CLOSED, 410);
    const window = parseInt(windowText, 36);
    const current = Math.floor(Date.now() / WINDOW_MS);
    if (!Number.isSafeInteger(window) || current - window > 2 || window - current > 1) fail(EXPIRED, 410);
    if (!sameText(signature, await qrSignature(session.checkin_secret, code, window))) fail('Código QR no válido.');
    const device = validDevice(body.device);
    const member = await one(db, "SELECT id FROM aula_members WHERE course=? AND user_id=? AND role='student'", session.course, user.id);
    if (!member) fail('No estás inscrito como alumno en este curso.', 403);
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
