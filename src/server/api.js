// API de Enlace: cursos, contenido, inscripciones, actividades, entregas, calificaciones y archivos.
// Las rutas y las respuestas son compatibles con la interfaz de la versión 8.

import { access, ownsCourse, requireAdmin, requireTeacher, viewAs, viewAudit } from './access.js';
import { attendanceRoutes } from './attendance.js';
import { directoryRoutes, registrationStatus } from './directory.js';
import { PRIVACY_VERSION, privacyAccepted, privacyRoutes } from './privacy.js';
import { assertWritable, periodRoutes } from './periods.js';
import { dashboardRoutes } from './dashboard.js';
import { reportRoutes } from './reports.js';
import { demoRoutes } from './demo.js';
import { backupRoutes } from './backup.js';
import { userRoutes } from './users.js';
import { forSection, isPublished, publishAtField, publishedSql, SCHEDULABLE_KINDS, sectionSql, specialRecordSql, specialTaskSql, taskSections } from './published.js';
import {
  MAX_EXAM_EVENTS,
  MAX_PASSWORD_FAILURES,
  MAX_UNLOCK_FAILURES,
  assertInTime,
  assertOpen,
  assertTimeLeft,
  studentAttemptView,
  deadlineOf,
  examPlaceCheck,
  finalAnswers,
  gradeAttempt,
  integritySummary,
  publicQuestions,
  publicSettings,
  startCodeOf,
  scoreOf,
  quizFields,
  MAX_QUESTIONS,
  questionCount,
  quizInstance,
  keyChanged,
  sameDraw,
  sameStructure,
  validEvents,
} from './quizzes.js';
import { sebAllows, sebVerified } from './seb.js';
import { bankImageVisible, bankRoutes } from './bank.js';
import { coverRoutes, photoRoutes, serveCourseCover, servePhoto } from './photos.js';
import { digestRoutes } from './digest.js';
import { accessRoutes, recordVisit } from './accesos.js';
import { specialAccessRoutes } from './especial.js';
import { forumRoutes, postFields, studentPosts } from './foros.js';
import { importRoutes } from './importaciones.js';
import { CONDITION_KINDS, assertConditions, conditionsField, conditionsMet, recordConditionsSql, conditionsSql, studentFacts } from './condiciones.js';
import { cleanSaved } from './reactivos.js';
import { mailConfigured } from './mail.js';
import { quizForStudent, quizWithAccess, quizWithSectionDates, sectionIdsByName, sectionKey, sectionRoutes, sectionsField, validSection } from './sections.js';
import { gradingRoutes } from './grading.js';
import { clearSessionCookie, identity, lastLogins, revokeAllStatements } from './auth.js';
import {
  assertAvailable,
  courseGradebook,
  loadTask,
  quizHasAttempts,
  regradeQuiz,
  attemptRecord,
  saveGrade,
  saveSubmission,
  saveTask,
  saveWeights,
  taskFields,
} from './gradebook.js';
import {
  SECURITY_HEADERS,
  all,
  email as validEmail,
  fail,
  isoDate,
  json,
  nowIso,
  one,
  optionalText,
  parseJson,
  readJson,
  requireSameOrigin,
  run,
  text,
} from './http.js';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
// Cuotas de almacenamiento (R2 gratuito: 10 GB en total).
const STUDENT_QUOTA_BYTES = 300 * 1024 * 1024; // por alumno y por curso
const TOTAL_QUOTA_BYTES = 9 * 1024 * 1024 * 1024; // toda la plataforma: deja margen antes del límite gratuito
const MB = 1024 * 1024;
const MAX_BULK_STUDENTS = 500;
/** Tipos que siguen guardándose como JSON libre en aula_records. */
const CONTENT_KINDS = ['module', 'material', 'notice', 'forum', 'post', 'group', 'quiz'];
const TEACHER_CONTENT_KINDS = ['module', 'material', 'notice', 'forum', 'quiz', 'group'];
const VISIBILITY_KINDS = ['module', 'material', 'notice', 'forum', 'quiz'];
/** Lo que va a la papelera (los equipos se eliminan directamente: no guardan trabajo de los alumnos). */
const TRASH_KINDS = ['module', 'material', 'notice', 'forum', 'post', 'quiz', 'task'];
const trashTitle = (kind, data) => (kind === 'post' ? `${data.title || 'Publicación'} · ${data.name || ''}` : data.title || '');

// ---- Plataforma bloqueada durante un examen (opción «lockPlatform») -----------------------------------
// Mientras el alumno tenga el examen abierto, Enlace solo le responde lo necesario para contestarlo: aunque abra otra
// pestaña, otro navegador o vuelva a iniciar sesión, no puede ver otros cursos, materiales, foros ni noticias.
const EXAM_ROUTES = new Set([
  'GET /api/me',
  'GET /api/course',
  'POST /api/attempt/start',
  'POST /api/attempt/progress',
  'POST /api/attempt',
  'POST /api/attempt/away',
  'POST /api/attempt/back',
  'POST /api/attempt/unlock',
  'POST /api/privacy/accept',
]);
const ACTIVE_EXAM_MESSAGE = 'Estás contestando un examen: hasta que lo envíes (o se acabe el tiempo) solo puedes usar el examen.';

// ---- Foto de perfil obligatoria para los alumnos -------------------------------------------------------
// Un alumno sin foto solo puede tomársela (y lo mínimo para llegar ahí): la interfaz le muestra la cámara.
const PHOTO_FREE_ROUTES = new Set(['GET /api/me', 'POST /api/privacy/accept', 'POST /api/profile/photo', 'POST /api/logout-all']);
export const PHOTO_REQUIRED_MESSAGE = 'Antes de continuar, tómate tu foto de perfil.';

export const photoRequired = (env, user) => env.FOTO_OBLIGATORIA === '1' && user.role === 'student' && !user.photo;

function assertHasPhoto(route, user, env) {
  if (!photoRequired(env, user)) return;
  // Un examen ya empezado no se interrumpe (por ejemplo, si el docente le quitó la foto mientras contestaba).
  if (user.activeExam && EXAM_ROUTES.has(route)) return;
  if (!PHOTO_FREE_ROUTES.has(route)) fail(PHOTO_REQUIRED_MESSAGE, 428, { needsPhoto: true });
}

function assertExamRoute(route, url, user) {
  const allowed =
    (EXAM_ROUTES.has(route) && (route !== 'GET /api/course' || url.searchParams.get('id') === user.activeExam.course)) ||
    (route.startsWith('GET /api/file/') && route.length > 'GET /api/file/'.length); // solo imágenes del examen (downloadFile)
  if (!allowed) fail(ACTIVE_EXAM_MESSAGE, 423, { activeExam: user.activeExam });
}

export async function api(request, env) {
  try {
    const user = await identity(request, env);
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    if (!['GET', 'HEAD'].includes(request.method)) {
      requireSameOrigin(request);
      await assertWritable(env.DB, route, url, request); // un curso archivado es de solo lectura
    }
    if (user.activeExam) assertExamRoute(route, url, user);
    assertHasPhoto(route, user, env);
    const ctx = { db: env.DB, env, user, url, request };
    const handler =
      routes[route] || attendanceRoutes[route] || gradingRoutes[route] || directoryRoutes[route] || privacyRoutes[route] || periodRoutes[route] || dashboardRoutes[route] || reportRoutes[route] || demoRoutes[route] || backupRoutes[route] || userRoutes[route] || bankRoutes[route] || sectionRoutes[route] || photoRoutes[route] || digestRoutes[route] || accessRoutes[route] || specialAccessRoutes[route] || forumRoutes[route] || importRoutes[route] || coverRoutes[route];
    if (handler) return await handler(ctx);
    if (request.method === 'GET' && url.pathname.startsWith('/api/file/')) return await downloadFile(ctx, url.pathname.slice(10));
    if (request.method === 'GET' && url.pathname.startsWith('/api/photo/')) return await servePhoto(ctx, url.pathname.slice(11));
    if (request.method === 'GET' && url.pathname.startsWith('/api/course-cover/')) return await serveCourseCover(ctx, url.pathname.slice(18));
    fail('Ruta no encontrada.', 404);
  } catch (error) {
    console.error('aula-api', error.status || 500, error.status ? error.message : error);
    const message = error.status
      ? error.message
      : 'No se pudo completar la operación. Tu información no se ha descartado; vuelve a intentarlo.';
    return json({ error: message, ...(error.extra || {}) }, error.status || 500);
  }
}

// ---- Registros de contenido (aula_records) ---------------------------------------------------

/** El curso sin la llave interna de su portada en R2 (la interfaz usa cover_updated). */
const publicCourse = ({ cover: _cover, ...course }) => course;
const unpack = (row) => (row ? { ...row, data: parseJson(row.data, {}) } : null);

function validTheme(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 6) fail('Color de portada no válido.');
  return n;
}

async function contentRecord(db, id, course, kind) {
  const r = unpack(await one(db, 'SELECT * FROM aula_records WHERE id=? AND course=? AND deleted_at IS NULL', id, course));
  if (!r || !CONTENT_KINDS.includes(r.kind) || (kind && r.kind !== kind)) fail('Elemento no encontrado.', 404);
  return r;
}

async function saveContentRecord(db, previous, data, author, course, kind) {
  const now = nowIso();
  if (previous) {
    const result = await run(
      db,
      'UPDATE aula_records SET data=?,revision=revision+1,updated=? WHERE id=? AND revision=?',
      JSON.stringify(data),
      now,
      previous.id,
      previous.revision,
    );
    if (!result.meta.changes) fail('Otra persona modificó este elemento. Recarga antes de guardar.', 409);
    return { ...previous, data, revision: previous.revision + 1, updated: now };
  }
  const id = crypto.randomUUID();
  await run(
    db,
    'INSERT INTO aula_records (id,course,kind,author,data,revision,created,updated) VALUES (?,?,?,?,?,1,?,?)',
    id,
    course,
    kind,
    author,
    JSON.stringify(data),
    now,
    now,
  );
  return { id, course, kind, author, data, revision: 1, created: now, updated: now };
}

async function validateFiles(db, ids, course, user, scope) {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length > 5) fail('Máximo cinco archivos.');
  for (const id of ids) {
    const file = await one(db, 'SELECT * FROM aula_files WHERE id=? AND course=?', id, course);
    if (!file || (scope === 'submission' && file.owner !== user.id) || file.scope !== scope) fail('Archivo no autorizado.', 403);
  }
  return ids;
}

function assertRecordAvailable(r) {
  if (!isPublished(r)) fail('La actividad no está disponible.', 403);
  const now = Date.now();
  if (r.data.start && now < Date.parse(r.data.start)) fail('La actividad todavía no está disponible.', 403);
  if (r.data.end && now > Date.parse(r.data.end)) fail('El periodo de entrega ha terminado.', 403);
}

/** El primer intento conserva el id de la versión 8; los siguientes llevan su número. */
const attemptId = (quiz, user, attempt) => (attempt === 1 ? `attempt:${quiz}:${user}` : `attempt:${quiz}:${user}:${attempt}`);

/** Comparación en tiempo constante (no revela cuántos caracteres coinciden). */
function sameSecret(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

/** Intento en curso (empezado y sin enviar) de un alumno. */
// ---- Bloqueo al salir (modo examen) ----------------------------------------------------------------
// Si el alumno sale de la página más de la tolerancia, el intento queda bloqueado hasta que escriba el código que su
// docente ve en el monitor (uno distinto por alumno y por bloqueo). Mientras tanto no se guarda ni se envía nada.

const lockCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
const lockEnabled = (quiz) => Boolean(quiz.data.settings?.exam?.lockOnLeave);

/** Bloquea el intento (si no lo estaba) y deja constancia en sus eventos. */
async function lockAttempt(db, start, seconds, reason = 'salida') {
  let events = [];
  try {
    events = JSON.parse(start.events || '[]');
  } catch {
    events = [];
  }
  events.push({ kind: 'locked', seconds: Math.max(0, Math.round(seconds)), reason, at: nowIso() });
  await run(
    db,
    `UPDATE aula_attempt_starts SET locked_at=?, unlock_code=?, unlock_failures=0, locks=locks+1, away_since=NULL, events=?
     WHERE quiz=? AND user_id=? AND attempt=? AND locked_at IS NULL`,
    nowIso(),
    lockCode(),
    JSON.stringify(events.slice(-MAX_EXAM_EVENTS)),
    start.quiz,
    start.user_id,
    start.attempt,
  );
}

/**
 * ¿Debe quedar bloqueado? Si salió (away_since) y ya pasó la tolerancia, se bloquea. Sirve al volver a la página y
 * al retomar tras cerrar el navegador. Devuelve true si el intento está bloqueado.
 */
export const SHORT_EXITS_LOCK = 3;

/** Salidas de la página registradas desde el último desbloqueo (o desde el inicio). */
function exitsSinceUnlock(start) {
  let events = [];
  try {
    events = JSON.parse(start.events || '[]');
  } catch {
    events = [];
  }
  const last = events.map((e) => e.kind).lastIndexOf('unlocked');
  return events.slice(last + 1).filter((e) => e.kind === 'left').length;
}

async function applyLock(db, quiz, start, seconds = null) {
  if (!lockEnabled(quiz) || !start) return false;
  if (start.locked_at) return true;
  if (!start.away_since) return false;
  const grace = quiz.data.settings.exam.lockGrace ?? 5;
  const away = seconds ?? (Date.now() - Date.parse(start.away_since)) / 1000;
  if (away > grace) {
    await lockAttempt(db, start, away);
    return true;
  }
  await run(db, 'UPDATE aula_attempt_starts SET away_since=NULL WHERE quiz=? AND user_id=? AND attempt=?', start.quiz, start.user_id, start.attempt);
  return false;
}

/** Quita el bloqueo (con el código o porque el docente lo permitió) y lo anota en los eventos. */
async function unlockAttempt(db, start, by) {
  let events = [];
  try {
    events = JSON.parse(start.events || '[]');
  } catch {
    events = [];
  }
  events.push({ kind: 'unlocked', seconds: Math.round((Date.now() - Date.parse(start.locked_at)) / 1000), by, at: nowIso() });
  await run(
    db,
    `UPDATE aula_attempt_starts SET locked_at=NULL, unlock_code=NULL, unlock_failures=0, away_since=NULL, events=?
     WHERE quiz=? AND user_id=? AND attempt=?`,
    JSON.stringify(events.slice(-MAX_EXAM_EVENTS)),
    start.quiz,
    start.user_id,
    start.attempt,
  );
}

// ---- Un solo dispositivo -------------------------------------------------------------------------------
// El intento queda atado a la sesión (el dispositivo y navegador) donde se empezó. Volver a iniciar sesión, abrir
// otra pestaña privada u otro teléfono no da un examen "limpio": con bloqueo al salir, queda bloqueado hasta el código
// del docente y sigue solo en el nuevo dispositivo; el anterior deja de poder guardar o enviar.
const OTHER_DEVICE_MESSAGE = 'Este examen continúa en otro dispositivo o sesión. Si quieres seguir aquí, vuelve a abrir el examen: se bloqueará y necesitarás el código de tu docente.';

/** Al retomar desde otra sesión: se registra y, con bloqueo al salir, se bloquea. El examen pasa a esta sesión. */
async function claimDevice(db, quiz, start, user) {
  if (!start.session_id || start.session_id === user.sid) {
    if (!start.session_id) await run(db, 'UPDATE aula_attempt_starts SET session_id=? WHERE quiz=? AND user_id=? AND attempt=?', user.sid, start.quiz, start.user_id, start.attempt);
    return;
  }
  if (lockEnabled(quiz) && !start.locked_at) await lockAttempt(db, start, 0, 'otro dispositivo');
  else {
    let events = [];
    try {
      events = JSON.parse(start.events || '[]');
    } catch {
      events = [];
    }
    events.push({ kind: 'device', seconds: 0, at: nowIso() });
    await run(db, 'UPDATE aula_attempt_starts SET events=? WHERE quiz=? AND user_id=? AND attempt=?', JSON.stringify(events.slice(-MAX_EXAM_EVENTS)), start.quiz, start.user_id, start.attempt);
  }
  await run(db, 'UPDATE aula_attempt_starts SET session_id=? WHERE quiz=? AND user_id=? AND attempt=?', user.sid, start.quiz, start.user_id, start.attempt);
}

/** Guardar, enviar o desbloquear solo desde la sesión que tiene el examen. */
function assertDevice(quiz, start, user) {
  if (quiz.data.settings?.exam && start?.session_id && start.session_id !== user.sid) fail(OTHER_DEVICE_MESSAGE, 409, { otherDevice: true });
}

const LOCKED_MESSAGE = 'Tu examen está bloqueado porque saliste de la página. Pide a tu docente el código para continuar.';

async function openStart(db, quiz, userId) {
  return one(
    db,
    `SELECT s.* FROM aula_attempt_starts s WHERE s.quiz=? AND s.user_id=?
       AND NOT EXISTS (SELECT 1 FROM aula_attempts a WHERE a.quiz=s.quiz AND a.user_id=s.user_id AND a.attempt=s.attempt)
     ORDER BY s.attempt DESC LIMIT 1`,
    quiz.id,
    userId,
  );
}

const PREVIEW_SEED = /^vista:[0-9a-f-]{36}$/;
const SEB_MESSAGE = 'Esta evaluación solo se puede presentar en Safe Exam Browser: en la evaluación toca «Abrir en Safe Exam Browser».';
const CODE_PER_MINUTE = 5;

/** Safe Exam Browser (12.27): si la evaluación lo exige, cada solicitud del intento debe venir de él. */
async function assertSeb(quiz, request) {
  if (!(await sebAllows(quiz, request))) fail(SEB_MESSAGE, 403, { needsSeb: true });
}

/**
 * Cierra un intento cuyo tiempo se acabó sin enviarse: se califica con lo que dejó guardado (o 0). Lo usan empezar,
 * guardar y enviar (12.27): pasado el límite, guardar responde 409 y el intento ya queda enviado.
 */
async function closeExpiredAttempt(db, quiz, user, start) {
  let saved = null;
  try {
    saved = start.progress ? JSON.parse(start.progress) : null;
  } catch {
    saved = null;
  }
  const instance = quizInstance(quiz, user.id, start.attempt);
  let graded = { correct: 0, total: instance.length, score: 0, details: null };
  if (saved && Object.keys(saved).length) {
    try {
      graded = gradeAttempt(quiz, instance, finalAnswers(quiz, instance, start, saved));
    } catch {
      // Una respuesta guardada inválida no impide cerrar el intento.
    }
  }
  await run(
    db,
    `INSERT OR IGNORE INTO aula_attempts (id,course,quiz,user_id,name,answers,correct,total,score,created,attempt,details,integrity)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    attemptId(quiz.id, user.id, start.attempt),
    quiz.course,
    quiz.id,
    user.id,
    user.name,
    JSON.stringify(graded.details ? graded.details.map((d) => d.answer) : []),
    graded.correct,
    graded.total,
    graded.score,
    nowIso(),
    start.attempt,
    graded.details ? JSON.stringify(graded.details) : null,
    quiz.data.settings?.exam ? JSON.stringify(integritySummary(start)) : null,
  );
}

const EXPIRED_MESSAGE = 'Se terminó el tiempo: tu evaluación se envió con las respuestas que tenías guardadas.';
const expired = (quiz, start) => {
  const deadline = deadlineOf(quiz, start.started);
  return Boolean(deadline && Date.now() > Date.parse(deadline) + 60_000);
};

async function attemptContext(db, user, body) {
  const a = await access(db, user, body.course);
  if (a.teach) fail('Las evaluaciones se responden desde una cuenta de alumno. Usa Ver como alumno para revisarlas.');
  // Con las fechas de la sección del alumno (cada grupo presenta a su hora).
  const quiz = await quizForStudent(db, await contentRecord(db, body.quiz, body.course, 'quiz'), user.id);
  if (user.activeExam && user.activeExam.quiz !== quiz.id) fail(ACTIVE_EXAM_MESSAGE, 423, { activeExam: user.activeExam });
  assertRecordAvailable(quiz);
  return { a, quiz };
}

const STORAGE_RECOUNT_MS = 60 * 60_000;

/**
 * Bytes guardados en toda la plataforma (12.30). Sumar `aula_files` en cada subida leía una fila por archivo de Enlace
 * (miles en cada entrega); ahora el total vive en `aula_storage`: cada subida lo aumenta y se vuelve a contar completo
 * si pasó una hora (corrige lo que se borre por otras vías). El margen hasta el límite de R2 cubre esa hora.
 */
async function storageTotal(db) {
  const row = await one(db, 'SELECT bytes, counted_at FROM aula_storage WHERE id=1');
  if (row && Date.now() - Date.parse(row.counted_at) < STORAGE_RECOUNT_MS) return row.bytes;
  const { bytes } = await one(db, 'SELECT coalesce(sum(size),0) AS bytes FROM aula_files');
  await run(
    db,
    'INSERT INTO aula_storage (id,bytes,counted_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET bytes=excluded.bytes, counted_at=excluded.counted_at',
    bytes,
    nowIso(),
  );
  return bytes;
}

/**
 * Curso de un alumno con un examen abierto que bloquea la plataforma: solo esa evaluación, sus intentos, su inscripción y
 * las imágenes de las preguntas, con 5 consultas (12.30). Antes se armaba el curso completo (≈14 consultas y cientos de
 * filas) en cada recarga a media prueba para luego quitar casi todo. Si la evaluación ya no está disponible (oculta,
 * de otra sección…) devuelve null y se usa el camino normal, que la filtra como siempre.
 */
async function examOnlyCourse(db, a, user) {
  const { quiz: quizId } = user.activeExam;
  const row = unpack(await one(db, "SELECT * FROM aula_records WHERE id=? AND course=? AND kind='quiz' AND deleted_at IS NULL", quizId, a.course.id));
  if (!row || !isPublished(row)) return null;
  let lived;
  try {
    lived = await quizForStudent(db, row, user.id);
  } catch (error) {
    if (error.status === 403) return null;
    throw error;
  }
  const images = [...new Set(row.data.questions.map((q) => q?.image).filter(Boolean))];
  const [attemptRows, me, files] = await Promise.all([
    all(db, 'SELECT * FROM aula_attempts WHERE quiz=? AND user_id=? ORDER BY created', quizId, user.id),
    one(
      db,
      `SELECT m.id, m.user_id, m.name, m.role, m.section, CASE WHEN u.photo IS NOT NULL THEN u.photo_updated END AS photo
       FROM aula_members m LEFT JOIN aula_users u ON u.id=m.user_id WHERE m.course=? AND m.user_id=? AND m.role='student'`,
      a.course.id,
      user.id,
    ),
    images.length
      ? all(db, 'SELECT id,course,owner,scope,name,size,mime,created FROM aula_files WHERE course=? AND id IN (SELECT value FROM json_each(?))', a.course.id, JSON.stringify(images))
      : [],
  ]);
  const attempts = attemptRows.map(attemptRecord).map((r) => studentAttemptView(r, row));
  // Como en el curso completo: de las preguntas solo llegan las que ya contestó en un intento enviado.
  const seen = new Set(attempts.flatMap((r) => (r.data.details || []).map((d) => d.index)));
  const quiz = {
    ...lived,
    data: {
      ...lived.data,
      questions: publicQuestions(lived.data.questions).map((q, i) => (seen.has(i) ? q : null)),
      questionCount: questionCount(lived.data),
      settings: publicSettings(lived.data.settings),
    },
  };
  const { photo, ...member } = me || {};
  return {
    course: publicCourse(a.course),
    canTeach: false,
    canPreview: false,
    preview: false,
    viewing: null,
    canDelete: false,
    records: [quiz, ...attempts],
    members: me ? [{ ...member, ...(photo ? { photo } : {}) }] : [],
    files,
    progress: [],
    examOnly: true,
  };
}

// ---- Rutas -------------------------------------------------------------------------------------

const routes = {
  'GET /api/me': async ({ db, env, user }) =>
    json({
      ...publicUser(user),
      ...(await registrationStatus(db, env, user)),
      privacyAccepted: privacyAccepted(user),
      privacyVersion: PRIVACY_VERSION,
      // Examen abierto que bloquea el resto de Enlace: la interfaz entra directo a él.
      activeExam: user.activeExam || null,
      // Alumno sin foto de perfil: la interfaz le pide tomársela antes de mostrar lo demás.
      needsPhoto: photoRequired(env, user),
      // Correos de avisos: si están configurados y si esta persona recibe el resumen diario.
      mailEnabled: mailConfigured(env),
      emailDigest: user.email_digest !== 0,
    }),

  // Cierra la sesión en todos los dispositivos de la persona (por ejemplo, si perdió su teléfono).
  'POST /api/logout-all': async ({ db, user }) => {
    await db.batch(revokeAllStatements(db, user.id));
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
  },

  // Los alumnos no cambian su nombre (evita hacerse pasar por otra persona): en los foros aparecen
  // con el nombre de la lista del curso, que registra y corrige su docente.
  'POST /api/profile': async ({ db, user, request }) => {
    if (user.role === 'student') fail('Tu nombre lo registra tu docente en la lista del curso. Si hay un error, pídele que lo corrija.', 403);
    const body = await readJson(request);
    await run(db, 'UPDATE aula_users SET name=? WHERE id=?', text(body.name, 150), user.id);
    return json({ ok: true });
  },

  // Una sola consulta sin importar cuántos cursos haya: el plan gratuito de D1 permite
  // 50 consultas por solicitud y la versión 8 hacía tres por curso.
  'GET /api/courses': async ({ db, user }) => {
    const notDeleted = 'NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)';
    // ?2: la propiedad de un curso solo cuenta si la persona sigue siendo docente (ver ownsCourse).
    const rows =
      user.role === 'admin'
        ? await all(db, `SELECT c.*, 1 AS can_teach FROM aula_courses c WHERE ${notDeleted} ORDER BY c.created DESC`)
        : await all(
            db,
            `SELECT c.*,
               CASE WHEN ?2 AND (c.owner=?1 OR EXISTS (SELECT 1 FROM aula_members t WHERE t.course=c.id AND t.user_id=?1 AND t.role='teacher'))
                 THEN 1 ELSE 0 END AS can_teach
             FROM aula_courses c
             -- Primero, por índice, solo los cursos propios o con inscripción (12.30: antes se recorrían todos los cursos).
             WHERE (c.owner=?1 OR c.id IN (SELECT i.course FROM aula_members i WHERE i.user_id=?1))
               AND ((?2 AND (c.owner=?1 OR EXISTS (SELECT 1 FROM aula_members t WHERE t.course=c.id AND t.user_id=?1 AND t.role='teacher')))
                    OR (c.student_visible=1 AND EXISTS (SELECT 1 FROM aula_members m WHERE m.course=c.id AND m.user_id=?1 AND m.role='student')))
               AND ${notDeleted}
             ORDER BY c.created DESC`,
            user.id,
            user.role === 'teacher' ? 1 : 0,
          );
    return json(
      rows.map(({ can_teach: canTeach, cover: _cover, ...c }) => ({
        ...c,
        canTeach: canTeach === 1,
        canDelete: user.role === 'admin' || ownsCourse(user, c),
      })),
    );
  },

  'POST /api/courses': async ({ db, user, request }) => {
    if (!['teacher', 'admin'].includes(user.role)) fail('No puedes crear cursos.', 403);
    const body = await readJson(request);
    const id = crypto.randomUUID();
    await run(
      db,
      // El curso queda clasificado con la academia y la unidad de quien lo crea.
      'INSERT INTO aula_courses (id,owner,name,group_name,intro,created,academy_id,unit_id,period,theme,student_visible) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id,
      user.id,
      text(body.name, 150),
      text(body.group, 100),
      optionalText(body.intro, 10000),
      nowIso(),
      user.academy_id ?? null,
      user.unit_id ?? null,
      optionalText(body.period, 60),
      body.theme === undefined ? 0 : validTheme(body.theme),
      body.studentVisible === false ? 0 : 1,
    );
    return json({ id }, 201);
  },

  'GET /api/course': async ({ db, user, url }) => {
    const courseId = url.searchParams.get('id');
    const a = await access(db, user, courseId);
    // Examen abierto que bloquea la plataforma: ruta ligera (12.30), sin armar el curso completo en cada recarga.
    if (user.activeExam && !a.teach && user.activeExam.course === courseId) {
      const exam = await examOnlyCourse(db, a, user);
      if (exam) return json(exam);
    }
    const { teach, preview, viewer, member: viewing, attemptUser } = await viewAs(db, a, user, url);
    if (viewing) await viewAudit(db, user, courseId, viewing);
    await recordVisit(db, a, user); // ingresos al curso (accesos)
    const rows = (
      await all(
        db,
        `SELECT * FROM aula_records WHERE course=? AND deleted_at IS NULL AND kind IN (${CONTENT_KINDS.map(() => '?').join(',')}) ORDER BY created`,
        courseId,
        ...CONTENT_KINDS,
      )
    ).map(unpack);
    // Fechas por sección: quien enseña recibe todas; el alumno, solo las de su sección (ya aplicadas a sus evaluaciones;
    // las de actividades se aplican en courseGradebook).
    // Una sola consulta para las secciones y sus fechas (cuidando el límite de consultas por solicitud).
    const sectionRow = await one(
      db,
      `SELECT (SELECT json_group_array(json_object('id',id,'name',name,'position',position))
                FROM (SELECT * FROM aula_sections WHERE course=?1 ORDER BY position, name)) AS sections,
              (SELECT section FROM aula_members m WHERE m.course=?1 AND m.role='student' AND (m.id=?3 OR (?3 IS NULL AND m.user_id=?2)) LIMIT 1) AS my_section,
              (SELECT id FROM aula_members m WHERE m.course=?1 AND m.role='student' AND (m.id=?3 OR (?3 IS NULL AND m.user_id=?2)) LIMIT 1) AS my_member,
              (SELECT json_group_array(json_object('item',d.item,'section',d.section,'start_at',d.start_at,'due',d.due,'end_at',d.end_at,'code',d.code))
                FROM aula_section_dates d WHERE d.course=?1 AND (?4 OR d.section=(SELECT section FROM aula_members m
                  WHERE m.course=?1 AND m.role='student' AND (m.id=?3 OR (?3 IS NULL AND m.user_id=?2)) LIMIT 1))) AS dates,
              -- Acceso especial en evaluaciones: quien enseña recibe todos; el alumno, solo el suyo.
              (SELECT json_group_array(json_object('quiz',qa.quiz,'member',qa.member,'start_at',qa.start_at,'end_at',qa.end_at,
                        'extra_minutes',qa.extra_minutes,'extra_attempts',qa.extra_attempts,'reason',CASE WHEN ?4 THEN qa.reason ELSE '' END,'created',qa.created))
                FROM aula_quiz_access qa WHERE qa.course=?1 AND (?4 OR qa.member=(SELECT id FROM aula_members m
                  WHERE m.course=?1 AND m.role='student' AND (m.id=?3 OR (?3 IS NULL AND m.user_id=?2)) LIMIT 1))) AS grants,
              -- Foros (12.23): lo que sigue la persona y cuándo leyó cada hilo.
              (SELECT json_group_array(json_object('item',item,'follow',follow,'read_at',read_at))
                FROM aula_forum_state WHERE course=?1 AND user_id=?2) AS forum_state`,
      courseId,
      viewer,
      viewing?.id ?? null,
      teach ? 1 : 0,
    );
    const sections = JSON.parse(sectionRow?.sections || '[]');
    const sectionDates = JSON.parse(sectionRow?.dates || '[]');
    const myDates = teach ? new Map() : new Map(sectionDates.map((d) => [d.item, d]));
    const quizAccess = JSON.parse(sectionRow?.grants || '[]');
    const forumState = JSON.parse(sectionRow?.forum_state || '[]');
    const myAccess = teach ? new Map() : new Map(quizAccess.map((g) => [g.quiz, g]));
    // Sección del alumno (null en la vista general «como alumno»: ahí se ve lo de todas las secciones).
    const mySection = teach || (!viewer && !viewing) ? null : sectionRow?.my_section ?? '';
    // Actividades, entregas, calificaciones e intentos; y el seguimiento del contenido: quien enseña ve el de todos; el
    // alumno (o la vista de un alumno), solo el suyo. Se leen antes de filtrar por las condiciones de liberación.
    const gradebook = await courseGradebook(db, courseId, { teacher: teach, userId: viewer, memberId: viewing?.id, attemptUser });
    const progress = teach
      ? await all(db, 'SELECT member, record, opened_at, completed_at FROM aula_progress WHERE course=?', courseId)
      : await all(
          db,
          `SELECT p.member, p.record, p.opened_at, p.completed_at FROM aula_progress p JOIN aula_members m ON m.id=p.member
           WHERE p.course=?1 AND (m.id=?3 OR (?3 IS NULL AND m.user_id=?2))`,
          courseId,
          viewer,
          viewing?.id ?? null,
        );
    // Condiciones de liberación (12.23): lo que ya hizo el alumno (la vista general «como alumno» lo ve todo).
    const facts = teach || mySection === null || !sectionRow?.my_member ? null : studentFacts(progress, gradebook, sectionRow.my_member);
    const unlocked = (r) => conditionsMet(r.data.conditions, facts);
    // Para el alumno: visible, con su fecha de publicación cumplida, dirigido a su sección y con sus condiciones cumplidas.
    const now = nowIso();
    // Una evaluación «solo con acceso especial» existe para el alumno solo si tiene acceso (la vista general la muestra).
    const visible = (r) =>
      isPublished(r, now) && forSection(r.data.sections, mySection) && (mySection === null || !r.data.specialOnly || myAccess.has(r.id)) && unlocked(r);
    const byId = new Map(rows.map((r) => [r.id, r]));
    // Las respuestas de un hilo eliminado no se muestran (vuelven si se restaura).
    const live = rows.filter((r) => r.kind !== 'post' || !r.data.parent || byId.has(r.data.parent));
    const content = teach
      ? live
      : studentPosts(live, byId, viewing ? attemptUser : viewer)
          .filter(
            (r) =>
              visible(r) &&
              (r.kind !== 'material' || !r.data.module || visible(byId.get(r.data.module))) &&
              (r.kind !== 'post' || visible(byId.get(r.data.forum))),
          )
          .map((r) =>
            // El alumno nunca recibe respuestas correctas, fórmulas ni rangos de las variables.
            // Del modo examen tampoco recibe la contraseña ni la ubicación del salón.
            r.kind === 'quiz'
              ? ((q) => ({ ...q, data: { ...q.data, questions: publicQuestions(q.data.questions), questionCount: questionCount(q.data), settings: publicSettings(q.data.settings) } }))(
                  quizWithAccess(quizWithSectionDates(r, myDates.get(r.id)), myAccess.get(r.id)),
                )
              : r,
          );
    const quizzesById = new Map(rows.filter((r) => r.kind === 'quiz').map((r) => [r.id, r]));
    // El alumno ve de sus intentos lo que permita cada evaluación («qué ve al terminar»).
    const records = [...content, ...gradebook.filter((r) => teach || r.kind !== 'task' || unlocked(r))].map((r) =>
      !teach && r.kind === 'attempt' ? studentAttemptView(r, quizzesById.get(r.data.quiz)) : r,
    );
    // El alumno no recibe las preguntas antes de contestarlas (llegan al empezar el intento, solo las que le tocan):
    // solo las que ya contestó, para ver en qué acertó. Las demás quedan en null.
    if (!teach) {
      const seen = new Map();
      for (const r of records) {
        if (r.kind !== 'attempt') continue;
        if (!seen.has(r.data.quiz)) seen.set(r.data.quiz, new Set());
        for (const d of r.data.details || []) seen.get(r.data.quiz).add(d.index);
      }
      for (const r of records) if (r.kind === 'quiz') r.data.questions = r.data.questions.map((q, i) => (seen.get(r.id)?.has(i) ? q : null));
    }

    // `photo`: fecha de cambio de la foto de perfil (la interfaz la pide a /api/photo/<usuario>?v=<fecha>).
    const memberRows = await all(
      db,
      `SELECT m.*, CASE WHEN u.photo IS NOT NULL THEN u.photo_updated END AS photo
       FROM aula_members m LEFT JOIN aula_users u ON u.id=m.user_id WHERE m.course=? AND m.role!='removed' ORDER BY m.name`,
      courseId,
    );
    const members = teach
      ? memberRows
      : memberRows.map((m) => ({
          id: m.id,
          user_id: m.user_id,
          name: m.name,
          role: m.role,
          ...(m.role === 'student' ? { section: m.section } : {}),
          // El alumno ve la foto de sus docentes y la suya, no la de sus compañeros.
          ...(m.photo && (m.role === 'teacher' || m.user_id === viewer) ? { photo: m.photo } : {}),
        }));

    let files = await all(db, 'SELECT id,course,owner,scope,name,size,mime,created FROM aula_files WHERE course=?', courseId);
    if (!teach) {
      const shared = new Set(records.filter((r) => ['module', 'material', 'task'].includes(r.kind)).flatMap((r) => r.data.fileIds || []));
      files = files.filter((f) => (viewer && f.owner === viewer) || (f.scope === 'material' && shared.has(f.id)));
    }
    // Con un examen abierto que bloquea la plataforma, del curso solo se entrega esa evaluación (y sus imágenes).
    if (user.activeExam && !teach) {
      const quizId = user.activeExam.quiz;
      const quiz = records.find((r) => r.id === quizId);
      const images = new Set((quiz?.data.questions || []).map((q) => q?.image).filter(Boolean));
      return json({
        course: publicCourse(a.course),
        canTeach: false,
        canPreview: false,
        preview: false,
        viewing: null,
        canDelete: false,
        records: records.filter((r) => r.id === quizId || (r.kind === 'attempt' && r.data.quiz === quizId)),
        members: members.filter((m) => m.user_id === user.id),
        files: files.filter((f) => images.has(f.id)),
        progress: [],
        examOnly: true,
      });
    }
    return json({
      course: publicCourse(a.course),
      canTeach: teach,
      // canPreview: quien enseña puede alternar entre su vista y la de alumno.
      canPreview: a.teach,
      preview,
      // Vista de un alumno concreto: a quién se está viendo (la interfaz lo usa en lugar de la persona que consulta).
      viewing: viewing ? { id: viewing.id, name: viewing.name, user_id: viewing.user_id, key: attemptUser } : null,
      canDelete: !preview && (user.role === 'admin' || ownsCourse(user, a.course)),
      records,
      sections,
      ...(teach ? { sectionDates, quizAccess } : {}),
      forumState,
      members,
      files,
      progress,
    });
  },

  // El alumno abre un material o lo marca como completado (o lo desmarca). Solo materiales que puede ver.
  'POST /api/progress': async ({ db, user, request }) => {
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    if (a.teach) fail('El seguimiento es de los alumnos.', 403);
    if (!['open', 'complete', 'undo'].includes(body.action)) fail('Acción no válida.');
    const member = await one(db, "SELECT id, section FROM aula_members WHERE course=? AND user_id=? AND role='student'", body.course, user.id);
    if (!member) fail('No estás inscrito como alumno en este curso.', 403);
    const material = await contentRecord(db, body.record, body.course, 'material');
    const unit = material.data.module ? await one(db, "SELECT data FROM aula_records WHERE id=? AND course=? AND deleted_at IS NULL", material.data.module, body.course) : null;
    const now = nowIso();
    const unitData = unit && { data: JSON.parse(unit.data) };
    const seen = (r) => isPublished(r, now) && forSection(r.data.sections, member.section);
    if (!seen(material) || (material.data.module && !seen(unitData))) fail('Material no disponible.', 403);
    // Condiciones de liberación del material y de su unidad (12.23).
    await assertConditions(db, material.data.conditions, member.id, 'Material no disponible.');
    await assertConditions(db, unitData?.data.conditions, member.id, 'Material no disponible.');
    const completed = body.action === 'complete' ? now : null;
    await run(
      db,
      `INSERT INTO aula_progress (member,record,course,opened_at,completed_at) VALUES (?1,?2,?3,?4,?5)
       ON CONFLICT(member,record) DO UPDATE SET opened_at=coalesce(aula_progress.opened_at, excluded.opened_at),
         completed_at=CASE ?6 WHEN 'open' THEN aula_progress.completed_at ELSE excluded.completed_at END`,
      member.id,
      material.id,
      body.course,
      now,
      completed,
      body.action,
    );
    return json({ record: material.id, opened_at: now, completed_at: body.action === 'open' ? undefined : completed });
  },

  'POST /api/course': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    await run(
      db,
      'UPDATE aula_courses SET name=?,group_name=?,intro=?,period=?,theme=coalesce(?,theme),student_visible=coalesce(?,student_visible) WHERE id=?',
      text(body.name, 150),
      text(body.group, 100),
      optionalText(body.intro, 10000),
      optionalText(body.period, 60),
      body.theme === undefined ? null : validTheme(body.theme),
      body.studentVisible === undefined ? null : body.studentVisible === false ? 0 : 1,
      body.course,
    );
    return json({ ok: true });
  },

  // Oculta o vuelve a mostrar el curso completo sin borrar alumnos, contenido ni calificaciones.
  'POST /api/course/visibility': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    await run(db, 'UPDATE aula_courses SET student_visible=? WHERE id=?', body.visible === false ? 0 : 1, body.course);
    return json({ visible: body.visible !== false });
  },

  // Retirar un curso lo oculta y bloquea el acceso, pero conserva registros y archivos.
  'DELETE /api/course': async ({ db, user, request }) => {
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    if (user.role !== 'admin' && !ownsCourse(user, a.course)) fail('Solo el propietario o el administrador puede eliminar el curso.', 403);
    if (body.confirm !== a.course.name) fail('Escribe el nombre exacto del curso para confirmar.');
    await run(
      db,
      'INSERT OR IGNORE INTO aula_deleted_courses (course,deleted_by,deleted_at) VALUES (?,?,?)',
      body.course,
      user.id,
      nowIso(),
    );
    return json({ ok: true });
  },

  'POST /api/course-guide': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const moduleId = 'courseguide:' + body.course;
    const guide = await one(db, 'SELECT deleted_at FROM aula_records WHERE id=?', moduleId);
    if (guide?.deleted_at) fail('La guía inicial de este curso está en la papelera. Restáurala desde Administración del curso → Papelera.', 409);
    if (guide) fail('Este curso ya tiene una guía inicial. Edita sus apartados en Contenido.', 409);
    if (!Array.isArray(body.sections) || body.sections.length !== 7) fail('La guía requiere sus siete apartados.');
    const sections = body.sections.map((s) => ({
      title: text(s.title, 200),
      body: text(s.body, 30000),
      visible: false,
      module: moduleId,
      fileIds: [],
      url: '',
    }));
    const now = nowIso();
    const rows = [
      {
        id: moduleId,
        kind: 'module',
        data: {
          title: 'Inicio del curso · Guía de la materia',
          body: 'Borrador: adapta los ejemplos al programa de tu materia. Para publicarlos, activa la visibilidad de esta unidad y de cada apartado.',
          visible: false,
        },
      },
      ...sections.map((data) => ({ id: crypto.randomUUID(), kind: 'material', data })),
    ];
    await db.batch(
      rows.map((r) =>
        db
          .prepare('INSERT INTO aula_records (id,course,kind,author,data,revision,created,updated) VALUES (?,?,?,?,?,1,?,?)')
          .bind(r.id, body.course, r.kind, user.id, JSON.stringify(r.data), now, now),
      ),
    );
    return json({ module: moduleId, count: sections.length }, 201);
  },

  // ---- Co-docentes: el propietario o la administración comparten el curso con otros docentes ----

  'POST /api/course/teachers': async ({ db, env, user, request }) => {
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    if (user.role !== 'admin' && !ownsCourse(user, a.course)) fail('Solo el propietario o la administración agrega co-docentes.', 403);
    const address = validEmail(body.email);
    const isOwnerEmail = address === String(env.AULA_OWNER_EMAIL || '').toLowerCase();
    const grant = await one(
      db,
      `SELECT g.name, u.id AS user_id, u.name AS user_name FROM (SELECT ?1 AS email) q
       LEFT JOIN aula_teachers g ON g.email=q.email LEFT JOIN aula_users u ON u.email=q.email`,
      address,
    );
    if (!grant.name && !isOwnerEmail) fail('Ese correo no es de un docente registrado en Enlace. Pídele que solicite acceso de docente.', 404);
    const owner = await one(db, 'SELECT email FROM aula_users WHERE id=?', a.course.owner);
    if (owner?.email === address) fail('Esa persona ya es la propietaria del curso.', 409);
    await run(
      db,
      `INSERT INTO aula_members (id,course,email,user_id,name,matricula,role) VALUES (?,?,?,?,?,'','teacher')
       ON CONFLICT(course,email) DO UPDATE SET role='teacher', user_id=coalesce(aula_members.user_id,excluded.user_id)`,
      crypto.randomUUID(),
      a.course.id,
      address,
      grant.user_id || null,
      grant.name || grant.user_name || address,
    );
    return json({ ok: true }, 201);
  },

  'DELETE /api/course/teachers': async ({ db, user, request }) => {
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    if (user.role !== 'admin' && !ownsCourse(user, a.course)) fail('Solo el propietario o la administración retira co-docentes.', 403);
    const result = await run(db, "UPDATE aula_members SET role='removed' WHERE id=? AND course=? AND role='teacher'", text(body.id, 200), a.course.id);
    if (!result.meta.changes) fail('Co-docente no encontrado.', 404);
    return json({ ok: true });
  },

  // ---- Inscripciones ----

  'POST /api/member': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const address = validEmail(body.email);
    const existingUser = await one(db, 'SELECT id FROM aula_users WHERE email=?', address);
    const section = await validSection(db, body.course, body.section);
    const current = await one(db, 'SELECT role FROM aula_members WHERE course=? AND email=?', body.course, address);
    if (current?.role === 'teacher') fail('Esa persona es co-docente del curso. Solo el propietario puede cambiar su papel.', 409);
    await run(
      db,
      `INSERT INTO aula_members (id,course,email,user_id,name,matricula,role,section) VALUES (?,?,?,?,?,?,'student',?)
       ON CONFLICT(course,email) DO UPDATE SET name=excluded.name,matricula=excluded.matricula,role='student',
         user_id=coalesce(aula_members.user_id,excluded.user_id),
         section=CASE WHEN excluded.section<>'' THEN excluded.section ELSE aula_members.section END
       WHERE aula_members.role<>'teacher'`,
      crypto.randomUUID(),
      body.course,
      address,
      existingUser?.id || null,
      text(body.name, 150),
      optionalText(body.matricula, 50),
      section,
    );
    return json({ ok: true });
  },

  // Inscripción masiva (lista pegada desde Excel o CSV). Una sola consulta con json_each,
  // así no importa cuántos alumnos traiga la lista frente al límite de 100 parámetros de D1.
  'POST /api/members/bulk': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    if (!Array.isArray(body.students) || !body.students.length) fail('La lista está vacía.');
    if (body.students.length > MAX_BULK_STUDENTS) fail(`Importa como máximo ${MAX_BULK_STUDENTS} alumnos a la vez.`);
    const byEmail = new Map();
    // Columna «Sección» o «Grupo» de la lista: se crean las secciones que falten. Sin ella, `section` (id) para todos.
    const named = await sectionIdsByName(db, body.course, body.students.map((s) => s?.section));
    const common = await validSection(db, body.course, body.sectionId);
    body.students.forEach((s, index) => {
      try {
        const address = validEmail(s?.email);
        const sectionName = String(s.section ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
        byEmail.set(address, {
          id: crypto.randomUUID(),
          email: address,
          name: text(s.name, 150),
          matricula: optionalText(s.matricula, 50),
          section: (sectionName && named.get(sectionKey(sectionName))) || common,
        });
      } catch (error) {
        fail(`Fila ${index + 1}: ${error.message}`);
      }
    });
    const students = JSON.stringify([...byEmail.values()]);
    const before = await one(
      db,
      "SELECT count(*) AS n FROM aula_members WHERE course=? AND email IN (SELECT json_extract(value,'$.email') FROM json_each(?))",
      body.course,
      students,
    );
    await run(
      db,
      `INSERT INTO aula_members (id,course,email,user_id,name,matricula,role,section)
       SELECT json_extract(j.value,'$.id'), ?1, json_extract(j.value,'$.email'),
              (SELECT u.id FROM aula_users u WHERE u.email=json_extract(j.value,'$.email')),
              json_extract(j.value,'$.name'), json_extract(j.value,'$.matricula'), 'student', json_extract(j.value,'$.section')
       FROM json_each(?2) j WHERE true
       ON CONFLICT(course,email) DO UPDATE SET name=excluded.name,matricula=excluded.matricula,role='student',
         user_id=coalesce(aula_members.user_id,excluded.user_id),
         section=CASE WHEN excluded.section<>'' THEN excluded.section ELSE aula_members.section END
       WHERE aula_members.role<>'teacher'`,
      body.course,
      students,
    );
    return json({ total: byEmail.size, created: byEmail.size - before.n, updated: before.n });
  },

  // Cursos y secciones de los que el docente puede reutilizar una lista de alumnos.
  'GET /api/members/sources': async ({ db, user, url }) => {
    const destination = String(url.searchParams.get('course') ?? '');
    requireTeacher(await access(db, user, destination));
    const notDeleted = 'NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)';
    const sources = user.role === 'admin'
      ? await all(
          db,
          `SELECT c.id,c.name,c.group_name,c.period,c.archived_at,c.student_visible,
                  (SELECT count(*) FROM aula_members m WHERE m.course=c.id AND m.role='student') AS students
           FROM aula_courses c WHERE c.id<>? AND ${notDeleted} ORDER BY c.name,c.group_name`,
          destination,
        )
      : await all(
          db,
          `SELECT c.id,c.name,c.group_name,c.period,c.archived_at,c.student_visible,
                  (SELECT count(*) FROM aula_members m WHERE m.course=c.id AND m.role='student') AS students
           FROM aula_courses c WHERE c.id<>?1 AND (c.owner=?2 OR EXISTS (
             SELECT 1 FROM aula_members t WHERE t.course=c.id AND t.user_id=?2 AND t.role='teacher'))
             AND ${notDeleted} ORDER BY c.name,c.group_name`,
          destination,
          user.id,
        );
    const ids = sources.map((c) => c.id);
    const sections = ids.length
      ? await all(
          db,
          `SELECT s.id,s.course,s.name,s.position,
                  (SELECT count(*) FROM aula_members m WHERE m.course=s.course AND m.section=s.id AND m.role='student') AS students
           FROM aula_sections s WHERE s.course IN (SELECT value FROM json_each(?)) ORDER BY s.course,s.position,s.name`,
          JSON.stringify(ids),
        )
      : [];
    return json(sources.map((c) => ({ ...c, sections: sections.filter((s) => s.course === c.id).map(({ course: _course, ...s }) => s) })));
  },

  // Reutiliza alumnos de otro curso o de una sola sección. Los correos repetidos se actualizan, no se duplican.
  'POST /api/members/copy': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    requireTeacher(await access(db, user, body.source));
    if (body.course === body.source) fail('Elige otro curso como origen.');
    const sourceSection = await validSection(db, body.source, body.sourceSection);
    const destinationSection = await validSection(db, body.course, body.destinationSection);
    const source = await all(
      db,
      `SELECT email,name,matricula FROM aula_members
       WHERE course=?1 AND role='student' AND (?2='' OR section=?2) ORDER BY name`,
      body.source,
      sourceSection,
    );
    if (!source.length) fail('Ese curso o sección no tiene alumnos para traer.');
    if (source.length > MAX_BULK_STUDENTS) fail(`Trae como máximo ${MAX_BULK_STUDENTS} alumnos a la vez.`);
    const students = JSON.stringify(source.map((m) => ({ id: crypto.randomUUID(), ...m, section: destinationSection })));
    const before = await one(
      db,
      "SELECT count(*) AS n FROM aula_members WHERE course=? AND email IN (SELECT json_extract(value,'$.email') FROM json_each(?))",
      body.course,
      students,
    );
    await run(
      db,
      `INSERT INTO aula_members (id,course,email,user_id,name,matricula,role,section)
       SELECT json_extract(j.value,'$.id'), ?1, json_extract(j.value,'$.email'),
              (SELECT u.id FROM aula_users u WHERE u.email=json_extract(j.value,'$.email')),
              json_extract(j.value,'$.name'), json_extract(j.value,'$.matricula'), 'student', json_extract(j.value,'$.section')
       FROM json_each(?2) j WHERE true
       ON CONFLICT(course,email) DO UPDATE SET name=excluded.name,matricula=excluded.matricula,role='student',
         user_id=coalesce(aula_members.user_id,excluded.user_id),
         section=CASE WHEN excluded.section<>'' THEN excluded.section ELSE aula_members.section END`,
      body.course,
      students,
    );
    return json({ total: source.length, created: source.length - before.n, updated: before.n });
  },

  // Corregir los datos de un alumno inscrito (12.25): nombre, matrícula, correo y sección. Si el correo cambia, la
  // inscripción se liga a la cuenta con el correo nuevo (o a ninguna, hasta que entre con él).
  'POST /api/member/update': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const member = await one(db, "SELECT * FROM aula_members WHERE id=? AND course=? AND role='student'", String(body.id ?? ''), body.course);
    if (!member) fail('Alumno no encontrado.', 404);
    const address = validEmail(body.email);
    const section = body.section === undefined ? member.section : await validSection(db, body.course, body.section);
    if (address !== member.email) {
      const taken = await one(db, 'SELECT role FROM aula_members WHERE course=? AND email=? AND id<>?', body.course, address, member.id);
      if (taken) fail(taken.role === 'removed' ? 'Ese correo es de un alumno que retiraste de este curso.' : 'Ese correo ya es de otra persona inscrita en este curso.', 409);
    }
    await run(
      db,
      `UPDATE aula_members SET name=?1, matricula=?2, section=?3, email=?4,
         user_id=CASE WHEN ?4=email THEN user_id ELSE (SELECT u.id FROM aula_users u WHERE u.email=?4) END
       WHERE id=?5 AND course=?6`,
      text(body.name, 150),
      optionalText(body.matricula, 50),
      section,
      address,
      member.id,
      body.course,
    );
    return json(await one(db, 'SELECT id, name, matricula, email, section, user_id FROM aula_members WHERE id=?', member.id));
  },

  'DELETE /api/member': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    // A un co-docente solo lo quita el propietario (DELETE /api/course/teachers).
    await run(db, "UPDATE aula_members SET role='removed' WHERE id=? AND course=? AND role<>'teacher'", text(body.id, 200), body.course);
    return json({ ok: true });
  },

  // Crea una categoría nueva con todos sus equipos en una sola consulta.
  'POST /api/groups/bulk': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const category = text(body.category, 100);
    if (!Array.isArray(body.groups) || !body.groups.length || body.groups.length > 100) fail('Crea de 1 a 100 equipos a la vez.');
    const titles = new Set();
    const assigned = new Set();
    const groups = body.groups.map((g) => {
      const title = text(g?.title, 200);
      if (titles.has(title.toLowerCase())) fail(`El nombre "${title}" está repetido.`);
      titles.add(title.toLowerCase());
      const members = Array.isArray(g.members) ? g.members.map(String) : [];
      for (const id of members) {
        if (assigned.has(id)) fail('Un alumno aparece en más de un equipo.');
        assigned.add(id);
      }
      return { title, members };
    });
    const existing = await one(
      db,
      "SELECT count(*) AS n FROM aula_records WHERE course=? AND kind='group' AND json_extract(data,'$.category')=?",
      body.course,
      category,
    );
    if (existing.n) fail(`Ya existe la categoría "${category}". Usa otro nombre o elimina esa categoría primero.`, 409);
    if (assigned.size) {
      const valid = await one(
        db,
        "SELECT count(*) AS n FROM aula_members WHERE course=? AND role='student' AND id IN (SELECT value FROM json_each(?))",
        body.course,
        JSON.stringify([...assigned]),
      );
      if (valid.n !== assigned.size) fail('Hay alumnos que no pertenecen a este curso.');
    }
    const now = nowIso();
    const rows = groups.map((g) => ({
      id: crypto.randomUUID(),
      data: JSON.stringify({ title: g.title, body: '', visible: true, members: g.members, category }),
    }));
    await run(
      db,
      `INSERT INTO aula_records (id,course,kind,author,data,revision,created,updated)
       SELECT json_extract(j.value,'$.id'), ?1, 'group', ?2, json_extract(j.value,'$.data'), 1, ?3, ?3 FROM json_each(?4) j`,
      body.course,
      user.id,
      now,
      JSON.stringify(rows),
    );
    return json({ created: rows.length }, 201);
  },

  'DELETE /api/groups/category': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const category = text(body.category, 100);
    if (body.confirm !== category) fail('Escribe el nombre exacto de la categoría para confirmar.');
    const result = await run(
      db,
      "DELETE FROM aula_records WHERE course=? AND kind='group' AND json_extract(data,'$.category')=?",
      body.course,
      category,
    );
    if (!result.meta.changes) fail('Esa categoría no tiene equipos.', 404);
    return json({ deleted: result.meta.changes });
  },

  'DELETE /api/group': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const group = await contentRecord(db, body.id, body.course, 'group');
    if (body.confirm !== group.data.title) fail('Escribe el nombre exacto del grupo para confirmar.');
    if (body.revision !== group.revision) fail('El grupo cambió. Recarga antes de eliminarlo.', 409);
    const result = await run(
      db,
      "DELETE FROM aula_records WHERE id=? AND course=? AND kind='group' AND revision=?",
      group.id,
      body.course,
      group.revision,
    );
    if (!result.meta.changes) fail('El grupo cambió. Recarga antes de eliminarlo.', 409);
    return json({ ok: true });
  },

  // ---- Contenido, actividades y entregas ----

  'POST /api/record': async ({ db, user, request }) => {
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    const kind = body.kind;
    const input = body.data || {};

    if (kind === 'task') {
      requireTeacher(a);
      const fields = taskFields(input, []);
      fields.fileIds = await validateFiles(db, input.fileIds, body.course, user, 'material');
      fields.sections = await sectionsField(db, body.course, input.sections);
      fields.conditions = await conditionsField(db, body.course, input.conditions, body.id);
      const { record, created } = await saveTask(db, {
        course: body.course,
        userId: user.id,
        id: body.id,
        revision: body.revision,
        fields,
      });
      return json(record, created ? 201 : 200);
    }
    if (kind === 'weights') {
      requireTeacher(a);
      const record = await saveWeights(db, {
        course: body.course,
        userId: user.id,
        id: body.id,
        revision: body.revision,
        weights: input.weights,
      });
      return json(record, body.id ? 200 : 201);
    }
    if (kind === 'submission') {
      const { record, created } = await saveSubmission(db, {
        course: body.course,
        user,
        id: body.id,
        revision: body.revision,
        input,
        validateFiles: (ids, scope) => validateFiles(db, ids, body.course, user, scope),
      });
      return json(record, created ? 201 : 200);
    }
    if (!CONTENT_KINDS.includes(kind)) fail('Tipo de elemento no permitido.');

    const previous = body.id ? await contentRecord(db, body.id, body.course, kind) : null;
    if (previous && body.revision !== previous.revision) fail('Este elemento cambió. Recarga para obtener la versión actual.', 409);

    let data;
    let attempted = false;
    if (TEACHER_CONTENT_KINDS.includes(kind)) {
      requireTeacher(a);
      data = { title: text(input.title, 200), body: String(input.body || '').slice(0, 30000), visible: input.visible !== false };
      if (SCHEDULABLE_KINDS.includes(kind)) {
        const publishAt = publishAtField(input.publishAt);
        if (publishAt) data.publishAt = publishAt;
        // Para qué secciones es (vacío = todas).
        const sections = await sectionsField(db, body.course, input.sections);
        if (sections.length) data.sections = sections;
      }
      // Una noticia ya enviada por correo lo sigue estando al editarla (no se vuelve a enviar).
      if (kind === 'notice' && previous?.data.emailedAt) data.emailedAt = previous.data.emailedAt;
      // Condiciones de liberación (12.23): unidades, materiales, foros y evaluaciones.
      if (CONDITION_KINDS.includes(kind)) {
        const conditions = await conditionsField(db, body.course, input.conditions, previous?.id);
        if (conditions) data.conditions = conditions;
      }
      // Foro (12.23): publicar como anónimo, ver lo de otros solo después de publicar y cerrado.
      if (kind === 'forum') {
        for (const key of ['anonymous', 'mustPost', 'locked']) if (input[key] === true) data[key] = true;
      }
      // «Solo con acceso especial» se cambia desde su ventana, no desde el editor: se conserva.
      if (kind === 'quiz' && previous?.data.specialOnly) data.specialOnly = true;
      if (kind === 'module') data.fileIds = await validateFiles(db, input.fileIds, body.course, user, 'material');
      if (kind === 'material') {
        data.module = input.module || null;
        if (data.module) await contentRecord(db, data.module, body.course, 'module');
        data.url = String(input.url || '').trim();
        if (data.url) {
          let parsed;
          try {
            parsed = new URL(data.url);
          } catch {
            fail('Enlace no válido.');
          }
          if (!['https:', 'http:'].includes(parsed.protocol)) fail('Usa un enlace http o https.');
        }
        data.fileIds = await validateFiles(db, input.fileIds, body.course, user, 'material');
      }
      if (kind === 'quiz') {
        Object.assign(data, quizFields(input));
        // Imágenes de las preguntas: archivos de material de este curso.
        const images = [...new Set(data.questions.map((q) => q.image).filter(Boolean))];
        if (images.length) {
          const found = await one(db, "SELECT count(*) AS n FROM aula_files WHERE course=? AND scope='material' AND id IN (SELECT value FROM json_each(?))", body.course, JSON.stringify(images));
          if (found.n !== images.length) fail('Una imagen de las preguntas no es válida. Vuelve a subirla.');
        }
        // Cuenta en la calificación: dentro de una categoría (de actividades) del curso, con su valor en puntos.
        if (input.grade?.category) {
          const category = await one(db, "SELECT id FROM aula_grade_categories WHERE id=? AND course=? AND source='tasks'", String(input.grade.category), body.course);
          if (!category) fail('Elige una categoría de calificación del curso.');
          const points = Number(input.grade.points ?? 10);
          if (!Number.isFinite(points) || points <= 0 || points > 1000) fail('El valor de la evaluación va de 0.1 a 1000 puntos.');
          const policy = ['best', 'last', 'average'].includes(input.grade.policy) ? input.grade.policy : 'best';
          data.grade = { category: category.id, points, policy };
        }
        // Con intentos solo se corrige la clave, los puntos y la retroalimentación (y se recalifican los intentos).
        const changed = previous && (!sameStructure(previous.data.questions, data.questions) || !sameDraw(previous.data.settings, data.settings));
        attempted = Boolean(previous && (changed || keyChanged(previous.data.questions, data.questions)) && (await quizHasAttempts(db, body.course, previous.id)));
        if (attempted && !sameStructure(previous.data.questions, data.questions)) {
          fail('Una evaluación con intentos solo permite corregir las respuestas correctas, los puntos y la retroalimentación. Para cambiar preguntas u opciones, crea una nueva.');
        }
        if (attempted && !sameDraw(previous.data.settings, data.settings)) {
          fail('Una evaluación con intentos no permite cambiar las preguntas al azar ni el orden aleatorio. Crea una nueva.');
        }
      }
      if (kind === 'group') {
        data.members = Array.isArray(input.members) ? [...new Set(input.members)] : [];
        for (const memberId of data.members) {
          if (!(await one(db, 'SELECT id FROM aula_members WHERE id=? AND course=?', memberId, body.course))) fail('Integrante no válido.');
        }
        data.category = String(input.category || 'Equipos de trabajo').slice(0, 100);
      }
    } else {
      // kind === 'post': hilo o respuesta (12.23), con las reglas del foro.
      if (previous) fail('Las publicaciones no se editan desde este formulario.');
      data = await postFields(db, a, user, body.course, input);
    }
    const saved = await saveContentRecord(db, previous, data, user.id, body.course, kind);
    if (attempted && keyChanged(previous.data.questions, data.questions)) saved.regraded = await regradeQuiz(db, saved);
    return json(saved, previous ? 200 : 201);
  },

  // Mostrar u ocultar a los alumnos con un solo toque, sin abrir el editor.
  'POST /api/record/visibility': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    if (typeof body.visible !== 'boolean') fail('Indica si el elemento debe ser visible.');
    if (body.kind === 'task') {
      const task = await loadTask(db, body.id, body.course);
      await run(db, 'UPDATE aula_tasks SET visible=?, revision=revision+1, updated=? WHERE id=?', body.visible ? 1 : 0, nowIso(), task.id);
      return json({ visible: body.visible });
    }
    if (!VISIBILITY_KINDS.includes(body.kind)) fail('Este elemento no tiene visibilidad.');
    const record = await contentRecord(db, body.id, body.course, body.kind);
    await run(
      db,
      "UPDATE aula_records SET data=json_set(data,'$.visible',json(?)), revision=revision+1, updated=? WHERE id=?",
      body.visible ? 'true' : 'false',
      nowIso(),
      record.id,
    );
    return json({ visible: body.visible });
  },

  // Historial de calificaciones de un alumno en una actividad (solo docentes).
  'GET /api/grade-history': async ({ db, user, url }) => {
    const course = url.searchParams.get('course');
    requireTeacher(await access(db, user, course));
    const rows = await all(
      db,
      `SELECT h.old_grade, h.new_grade, h.old_published, h.new_published, h.feedback_changed, h.reason, h.changed_at, u.name AS changed_by
       FROM aula_grade_history h LEFT JOIN aula_users u ON u.id=h.changed_by
       WHERE h.course=? AND h.task=? AND h.member=? ORDER BY h.changed_at DESC LIMIT 100`,
      course,
      url.searchParams.get('task'),
      url.searchParams.get('member'),
    );
    return json({ history: rows });
  },

  // ---- Prórrogas individuales ----

  'POST /api/extension': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const task = await loadTask(db, body.task, body.course);
    const member = await one(db, "SELECT id FROM aula_members WHERE id=? AND course=? AND role='student'", String(body.member ?? ''), body.course);
    if (!member) fail('Alumno no encontrado.', 404);
    const due = isoDate(body.due);
    const end = isoDate(body.end);
    if (!due) fail('Indica la nueva fecha de vencimiento.');
    if (end && end < due) fail('El cierre debe ser posterior al nuevo vencimiento.');
    await run(
      db,
      `INSERT INTO aula_extensions (task,member,due,end_at,reason,created_by,created) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(task,member) DO UPDATE SET due=excluded.due, end_at=excluded.end_at, reason=excluded.reason,
         created_by=excluded.created_by, created=excluded.created`,
      task.id,
      member.id,
      due,
      end,
      optionalText(body.reason, 300),
      user.id,
      nowIso(),
    );
    return json({ ok: true });
  },

  'DELETE /api/extension': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const task = await loadTask(db, body.task, body.course);
    const result = await run(db, 'DELETE FROM aula_extensions WHERE task=? AND member=?', task.id, String(body.member ?? ''));
    if (!result.meta.changes) fail('Ese alumno no tiene prórroga en esta actividad.', 404);
    return json({ ok: true });
  },

  // ---- Papelera ----
  // Eliminar no borra nada: el elemento deja de mostrarse y cualquier docente del curso puede restaurarlo.
  // Las entregas, calificaciones e intentos de una actividad o evaluación eliminada se conservan.

  // Quitar una actividad compartida de UNA sección (12.45): las demás la conservan con sus entregas y calificaciones.
  // Antes, eliminarla desde el grupo 5BV la quitaba también de 5CV (la importación por sección la había compartido).
  'POST /api/task/unshare': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const task = await loadTask(db, body.id, body.course);
    const section = String(body.section || '');
    const courseSecs = (await all(db, 'SELECT id FROM aula_sections WHERE course=?', body.course)).map((r) => r.id);
    if (!courseSecs.includes(section)) fail('Sección no encontrada.', 404);
    const current = taskSections(task.sections);
    const now = current.length ? current : courseSecs; // '' = todas las secciones
    if (!now.includes(section)) fail('La actividad no es de esa sección.', 409);
    const rest = now.filter((x) => x !== section);
    if (!rest.length) fail('Es la única sección de la actividad: elimínala.', 409);
    await run(db, 'UPDATE aula_tasks SET sections=?, revision=revision+1 WHERE id=? AND course=?', JSON.stringify(rest.sort()), task.id, body.course);
    return json({ ok: true, sections: rest });
  },

  // Calificación máxima de la columna (12.51): las calificaciones se guardan sobre 10. Con `rescale` (12.52, solo si el
  // docente lo elige) las ya capturadas conservan sus puntos (6 de 10 → 6 de 9 = 6.67) y se recalcula su valor sobre 10.
  'POST /api/task/max': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const task = await loadTask(db, body.id, body.course);
    const max = Number(body.max);
    if (!(max > 0 && max <= 1000)) fail('La calificación máxima debe ser mayor que 0 y hasta 1000.');
    const old = task.max_score ?? 10;
    if (old === max) return json({ ok: true, max, changed: 0, same: body.rescale === true, old });
    const update = db.prepare('UPDATE aula_tasks SET max_score=?, revision=revision+1 WHERE id=? AND course=?').bind(max, task.id, body.course);
    // Solo si el docente lo pide se recalculan las ya capturadas; si no, conservan su valor sobre 10.
    if (body.rescale !== true) {
      await update.run();
      return json({ ok: true, max, changed: 0 });
    }
    const now = nowIso();
    const results = await db.batch([
      update,
      db
        .prepare(
          `INSERT INTO aula_grade_history (id, course, task, member, old_grade, new_grade, changed_by, changed_at, reason)
           SELECT lower(hex(randomblob(16))), ?1, s.task, s.member, s.grade, min(10, round(s.grade * ?2 / ?3, 4)), ?4, ?5, 'calificación máxima'
           FROM aula_submissions s WHERE s.task=?6 AND s.grade IS NOT NULL`,
        )
        .bind(body.course, old, max, user.id, now, task.id),
      db.prepare('UPDATE aula_submissions SET grade=min(10, round(grade * ?1 / ?2, 4)), revision=revision+1 WHERE task=?3 AND grade IS NOT NULL').bind(old, max, task.id),
    ]);
    return json({ ok: true, max, changed: results[2].meta?.changes ?? 0 });
  },

  'DELETE /api/record': async ({ db, user, request }) => {
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    if (!TRASH_KINDS.includes(body.kind)) fail('Este elemento no se puede eliminar.');
    const now = nowIso();
    if (body.kind === 'task') {
      requireTeacher(a);
      const task = await loadTask(db, body.id, body.course);
      await run(db, 'UPDATE aula_tasks SET deleted_at=?, deleted_by=? WHERE id=? AND deleted_at IS NULL', now, user.id, task.id);
      return json({ ok: true });
    }
    const record = await contentRecord(db, body.id, body.course, body.kind);
    if (record.kind === 'post') {
      // El docente modera el foro; cada quien puede retirar su propia publicación.
      if (!a.teach && record.author !== user.id) fail('Solo el docente o quien la escribió puede eliminar esta publicación.', 403);
    } else {
      requireTeacher(a);
    }
    if (record.kind === 'module') {
      const inside = await one(
        db,
        "SELECT count(*) AS n FROM aula_records WHERE course=? AND kind='material' AND deleted_at IS NULL AND json_extract(data,'$.module')=?",
        body.course,
        record.id,
      );
      if (inside.n) fail(`La unidad tiene ${inside.n === 1 ? '1 material' : `${inside.n} materiales`}. Elimínalos o muévelos a otra unidad primero.`, 409);
    }
    await run(db, 'UPDATE aula_records SET deleted_at=?, deleted_by=? WHERE id=? AND deleted_at IS NULL', now, user.id, record.id);
    return json({ ok: true });
  },

  'GET /api/trash': async ({ db, user, url }) => {
    const course = url.searchParams.get('course');
    requireTeacher(await access(db, user, course));
    const records = await all(
      db,
      `SELECT r.id, r.kind, r.data, r.deleted_at, u.name AS deleted_by FROM aula_records r LEFT JOIN aula_users u ON u.id=r.deleted_by
       WHERE r.course=? AND r.deleted_at IS NOT NULL`,
      course,
    );
    const tasks = await all(
      db,
      `SELECT t.id, t.title, t.deleted_at, u.name AS deleted_by,
         (SELECT count(*) FROM aula_submissions s WHERE s.task=t.id) AS submissions
       FROM aula_tasks t LEFT JOIN aula_users u ON u.id=t.deleted_by WHERE t.course=? AND t.deleted_at IS NOT NULL`,
      course,
    );
    const items = [
      ...records.map((r) => ({ id: r.id, kind: r.kind, title: trashTitle(r.kind, parseJson(r.data, {})), deletedAt: r.deleted_at, deletedBy: r.deleted_by || '' })),
      ...tasks.map((t) => ({ id: t.id, kind: 'task', title: t.title, deletedAt: t.deleted_at, deletedBy: t.deleted_by || '', submissions: t.submissions })),
    ].sort((x, y) => (x.deletedAt < y.deletedAt ? 1 : -1));
    return json({ items });
  },

  'POST /api/trash/restore': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    if (body.kind === 'task') {
      const result = await run(
        db,
        'UPDATE aula_tasks SET deleted_at=NULL, deleted_by=NULL, revision=revision+1 WHERE id=? AND course=? AND deleted_at IS NOT NULL',
        body.id,
        body.course,
      );
      if (!result.meta.changes) fail('Elemento no encontrado en la papelera.', 404);
      return json({ ok: true });
    }
    const record = unpack(await one(db, 'SELECT * FROM aula_records WHERE id=? AND course=? AND deleted_at IS NOT NULL', body.id, body.course));
    if (!record || !TRASH_KINDS.includes(record.kind)) fail('Elemento no encontrado en la papelera.', 404);
    // Un material o una publicación no puede volver a una unidad o un foro que sigue en la papelera.
    const parentId = record.kind === 'material' ? record.data.module : record.kind === 'post' ? record.data.forum : null;
    if (parentId) {
      const parent = await one(db, 'SELECT deleted_at FROM aula_records WHERE id=? AND course=?', parentId, body.course);
      if (parent?.deleted_at) fail(record.kind === 'material' ? 'Restaura primero la unidad a la que pertenece.' : 'Restaura primero el foro al que pertenece.', 409);
    }
    await run(db, 'UPDATE aula_records SET deleted_at=NULL, deleted_by=NULL, revision=revision+1 WHERE id=?', record.id);
    return json({ ok: true });
  },

  'POST /api/grade': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    return json(
      await saveGrade(db, {
        course: body.course,
        grader: user,
        taskId: body.task,
        memberId: body.member,
        revision: body.revision,
        grade: body.grade,
        feedback: body.feedback,
        publish: body.publish !== false,
        rubric: body.rubric,
        team: body.team === true,
      }),
    );
  },

  // Publica de una vez todas las calificaciones en borrador de una actividad.
  'POST /api/grades/publish': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    await loadTask(db, body.task, body.course);
    const now = nowIso();
    const [, result] = await db.batch([
      // Historial: cada borrador publicado queda registrado.
      db
        .prepare(
          `INSERT INTO aula_grade_history (id,course,task,member,old_grade,new_grade,old_published,new_published,feedback_changed,reason,changed_by,changed_at)
           SELECT lower(hex(randomblob(16))), course, task, member, grade, grade, 0, 1, 0, 'publicación', ?1, ?2
           FROM aula_submissions WHERE course=?3 AND task=?4 AND published=0`,
        )
        .bind(user.id, now, body.course, body.task),
      db.prepare('UPDATE aula_submissions SET published=1,revision=revision+1,updated=? WHERE course=? AND task=? AND published=0').bind(now, body.course, body.task),
    ]);
    return json({ published: result.meta.changes });
  },

  // Empieza (o retoma) un intento: fija la hora de inicio y devuelve las preguntas de ese alumno e intento.
  'POST /api/attempt/start': async ({ db, user, request }) => {
    const body = await readJson(request);
    const { quiz } = await attemptContext(db, user, body);
    await assertSeb(quiz, request);
    const max = quiz.data.settings?.attempts || 1;
    const exam = quiz.data.settings?.exam || null;
    for (;;) {
      const done = await one(db, 'SELECT count(*) AS n, coalesce(max(attempt),0) AS last FROM aula_attempts WHERE quiz=? AND user_id=?', quiz.id, user.id);
      if (done.n >= max) fail(max === 1 ? 'Ya enviaste esta evaluación. Se permite un intento.' : `Ya usaste tus ${max} intentos.`, 409);
      const attempt = done.last + 1;
      let start = await one(db, 'SELECT * FROM aula_attempt_starts WHERE quiz=? AND user_id=? AND attempt=?', quiz.id, user.id, attempt);
      if (!start) {
        assertOpen(quiz); // fechas de disponibilidad: solo para empezar; lo que está en curso lo corta el límite de tiempo
        assertTimeLeft(quiz); // un intento nuevo nunca nace vencido (no se gasta ningún intento)
        // El código de su sección o la contraseña del modo examen (los dicta el docente en el salón) solo se pide al
        // empezar; retomar tras recargar no lo pide.
        const code = startCodeOf(quiz.data.settings);
        if (code) {
          // Cada código cuenta como fallo ANTES de compararlo (una sola instrucción, condicionada a los topes): así
          // varias solicitudes en paralelo no pueden probar más códigos que los permitidos. Si acierta, se descuenta.
          const minuteAgo = new Date(Date.now() - 60_000).toISOString();
          const reserved = await one(
            db,
            `INSERT INTO aula_exam_tries (quiz,user_id,failures,recent,last_failure) VALUES (?1,?2,1,1,?3)
             ON CONFLICT(quiz,user_id) DO UPDATE SET failures=failures+1,
               recent=CASE WHEN last_failure > ?4 THEN recent+1 ELSE 1 END, last_failure=?3
             WHERE failures < ?5 AND NOT (recent >= ?6 AND last_failure > ?4)
             RETURNING failures`,
            quiz.id,
            user.id,
            nowIso(),
            minuteAgo,
            MAX_PASSWORD_FAILURES,
            CODE_PER_MINUTE,
          );
          if (!reserved) {
            const tries = await one(db, 'SELECT failures FROM aula_exam_tries WHERE quiz=? AND user_id=?', quiz.id, user.id);
            if ((tries?.failures || 0) >= MAX_PASSWORD_FAILURES) fail('Demasiados códigos equivocados. Pide a tu docente que te desbloquee.', 429);
            fail('Demasiados códigos equivocados seguidos. Espera un minuto y vuelve a intentarlo.', 429);
          }
          if (sameSecret(String(body.password ?? '').trim(), code)) {
            await run(
              db,
              'UPDATE aula_exam_tries SET failures=max(failures-1,0), recent=max(recent-1,0) WHERE quiz=? AND user_id=?',
              quiz.id,
              user.id,
            );
          } else {
            const left = MAX_PASSWORD_FAILURES - reserved.failures;
            fail(left > 0 ? `Código incorrecto. Te ${left === 1 ? 'queda 1 intento' : `quedan ${left} intentos`}.` : 'Demasiados códigos equivocados. Pide a tu docente que te desbloquee.', left > 0 ? 400 : 429);
          }
        }
        const place = exam ? examPlaceCheck(quiz, body.location, String(body.locationError || '')) : { flag: '', distance: null };
        await run(
          db,
          'INSERT OR IGNORE INTO aula_attempt_starts (quiz,user_id,attempt,started,flag,distance,session_id) VALUES (?,?,?,?,?,?,?)',
          quiz.id,
          user.id,
          attempt,
          nowIso(),
          place.flag,
          place.distance,
          exam ? user.sid : null,
        );
        start = await one(db, 'SELECT * FROM aula_attempt_starts WHERE quiz=? AND user_id=? AND attempt=?', quiz.id, user.id, attempt);
      }
      const { started } = start;
      const deadline = deadlineOf(quiz, started);
      // Un intento cuyo tiempo se acabó sin enviarse se cierra con lo que dejó guardado (o con 0).
      if (expired(quiz, start)) {
        await closeExpiredAttempt(db, quiz, user, start);
        continue;
      }
      // Retomar desde otra sesión o dispositivo: se registra (y con bloqueo al salir, se bloquea).
      if (exam) {
        await claimDevice(db, quiz, start, user);
        start = await one(db, 'SELECT * FROM aula_attempt_starts WHERE quiz=? AND user_id=? AND attempt=?', quiz.id, user.id, attempt);
      }
      // Retomar después de salir (por ejemplo, cerró el navegador): si pasó la tolerancia, queda bloqueado.
      const locked = exam ? await applyLock(db, quiz, start) : false;
      // Al navegador no van los valores internos ni las permutaciones (`perm`, `key`): solo lo que se ve, ya en su orden.
      const questions = quizInstance(quiz, user.id, attempt).map(({ values: _v, perm: _p, key: _k, ...q }) => q);
      // Al retomar un examen se devuelven las respuestas guardadas y la pregunta en la que iba.
      let saved = {};
      try {
        saved = JSON.parse(start.progress || '{}') || {};
      } catch {
        saved = {};
      }
      return json({
        attempt, started, deadline, attemptsLeft: max - done.n, serverNow: Date.now(), questions,
        // 12.27: las respuestas guardadas vuelven en cualquier evaluación (recargar la página no pierde nada).
        saved, perPage: quiz.data.settings?.perPage || 0,
        exam: exam
          ? { oneByOne: exam.oneByOne, noBack: exam.noBack, randomOrder: Boolean(quiz.data.settings?.shuffle), position: start.position, flagged: Boolean(start.flag), lockOnLeave: Boolean(exam.lockOnLeave), lockGrace: exam.lockGrace ?? 0, locked, lockPlatform: Boolean(exam.lockPlatform) }
          : null,
      });
    }
  },

  // Modo examen: guarda las respuestas mientras se contesta, la pregunta a la que avanzó y las salidas de la pantalla.
  'POST /api/attempt/progress': async ({ db, user, request }) => {
    const body = await readJson(request);
    const { quiz } = await attemptContext(db, user, body);
    await assertSeb(quiz, request);
    // 12.27: se guarda en cualquier evaluación (antes solo en modo examen); las salidas y el bloqueo, solo en examen.
    const exam = quiz.data.settings?.exam || null;
    const start = await openStart(db, quiz, user.id);
    if (!start || start.attempt !== Number(body.attempt)) fail('Este intento ya no está en curso. Recarga la página.', 409);
    if (expired(quiz, start)) {
      await closeExpiredAttempt(db, quiz, user, start);
      fail(EXPIRED_MESSAGE, 409, { closed: true });
    }
    assertInTime(quiz, start.started);
    if (exam) assertDevice(quiz, start, user);
    if (exam && start.locked_at) fail(LOCKED_MESSAGE, 423, { locked: true });
    const events = exam ? validEvents(body.events) : [];
    const noBack = Boolean(exam?.noBack);
    const position = Number.isInteger(body.position) ? Math.min(Math.max(body.position, 0), questionCount(quiz.data)) : start.position;
    let answers = null;
    if (body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)) {
      const next = {};
      for (const q of quiz.data.questions.keys()) {
        const value = cleanSaved(body.answers[q]); // opción, texto o lista (se valida de verdad al enviar)
        if (value !== undefined) next[q] = value;
      }
      // Sin regresar: lo contestado en las preguntas que ya se dejaron atrás queda fijo (finalAnswers también lo usa al enviar).
      if (noBack && start.position > 0) {
        const saved = JSON.parse(start.progress || '{}') || {};
        for (const q of quizInstance(quiz, user.id, start.attempt).slice(0, start.position)) {
          if (Object.hasOwn(saved, q.index)) next[q.index] = saved[q.index];
          else delete next[q.index];
        }
      }
      answers = JSON.stringify(next);
    }
    await run(
      db,
      `UPDATE aula_attempt_starts SET
         progress=CASE WHEN ?1 IS NULL THEN progress ELSE ?1 END,
         position=CASE WHEN ?2 THEN max(position, ?3) ELSE ?3 END,
         events=CASE WHEN json_array_length(events) + json_array_length(?4) <= ?5
                     THEN (SELECT json_group_array(json(value)) FROM (SELECT value FROM json_each(events) UNION ALL SELECT value FROM json_each(?4)))
                     ELSE events END
       WHERE quiz=?6 AND user_id=?7 AND attempt=?8`,
      answers,
      noBack ? 1 : 0,
      position,
      JSON.stringify(events),
      MAX_EXAM_EVENTS,
      quiz.id,
      user.id,
      start.attempt,
    );
    return json({ ok: true });
  },

  'POST /api/attempt': async ({ db, user, request }) => {
    const body = await readJson(request);
    const { quiz } = await attemptContext(db, user, body);
    await assertSeb(quiz, request);
    const max = quiz.data.settings?.attempts || 1;
    const done = await one(db, 'SELECT count(*) AS n, coalesce(max(attempt),0) AS last FROM aula_attempts WHERE quiz=? AND user_id=?', quiz.id, user.id);
    if (done.n >= max) fail(max === 1 ? 'Ya enviaste esta evaluación. Se permite un intento.' : `Ya usaste tus ${max} intentos.`, 409);
    const attempt = done.last + 1;
    const start = await one(db, 'SELECT * FROM aula_attempt_starts WHERE quiz=? AND user_id=? AND attempt=?', quiz.id, user.id, attempt);
    const exam = quiz.data.settings?.exam || null;
    // Sin «Comenzar» no hay intento: ahí se revisan fechas, tiempo y el código de la sección o del examen.
    if ((quiz.data.settings?.timeLimit || exam || startCodeOf(quiz.data.settings)) && !start) fail('Comienza el intento antes de enviarlo.', 409);
    if (!start) assertOpen(quiz);
    // Tarde de más: se cierra con lo guardado (no con lo que llegue ahora).
    if (start && expired(quiz, start)) {
      await closeExpiredAttempt(db, quiz, user, start);
      fail(EXPIRED_MESSAGE, 409, { closed: true });
    }
    if (start) assertInTime(quiz, start.started);
    if (exam) assertDevice(quiz, start, user);
    if (exam && (await applyLock(db, quiz, start))) fail(LOCKED_MESSAGE, 423, { locked: true });
    const instance = quizInstance(quiz, user.id, attempt);
    const graded = gradeAttempt(quiz, instance, finalAnswers(quiz, instance, start, body.answers));
    const id = attemptId(quiz.id, user.id, attempt);
    try {
      await run(
        db,
        `INSERT INTO aula_attempts (id,course,quiz,user_id,name,answers,correct,total,score,created,attempt,details,integrity)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id,
        quiz.course,
        quiz.id,
        user.id,
        user.name,
        JSON.stringify(graded.details.map((d) => d.answer)),
        graded.correct,
        graded.total,
        graded.score,
        nowIso(),
        attempt,
        JSON.stringify(graded.details),
        exam ? JSON.stringify(integritySummary(start)) : null,
      );
    } catch {
      fail('Este intento ya se envió. Recarga la página.', 409);
    }
    return json(studentAttemptView(attemptRecord(await one(db, 'SELECT * FROM aula_attempts WHERE id=?', id)), quiz), 201);
  },

  // Devolver intentos vacíos (12.29): los que se cerraron por tiempo sin ninguna respuesta guardada (por ejemplo, los
  // que abría el error del tiempo fijo). No borra el trabajo de nadie: solo intentos sin respuestas, de alumnos que no
  // tienen otro intento en curso. Con `user` solo los de ese alumno.
  'POST /api/quiz/void-empty': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const quiz = await contentRecord(db, String(body.quiz ?? ''), body.course, 'quiz');
    const empty = `a.quiz=?1 AND a.course=?2 AND a.details IS NULL AND a.answers='[]' AND (?3 IS NULL OR a.user_id=?3)
      AND NOT EXISTS (SELECT 1 FROM aula_attempt_starts s WHERE s.quiz=a.quiz AND s.user_id=a.user_id
                      AND NOT EXISTS (SELECT 1 FROM aula_attempts x WHERE x.quiz=s.quiz AND x.user_id=s.user_id AND x.attempt=s.attempt))`;
    const who = body.user ? String(body.user) : null;
    const rows = await all(db, `SELECT a.id, a.user_id, a.attempt FROM aula_attempts a WHERE ${empty}`, quiz.id, body.course, who);
    if (!rows.length) return json({ voided: 0 });
    const list = JSON.stringify(rows.map((r) => ({ id: r.id, user: r.user_id, attempt: r.attempt })));
    await db.batch([
      db
        .prepare(
          `DELETE FROM aula_attempt_starts WHERE quiz=?1 AND EXISTS (SELECT 1 FROM json_each(?2) j
             WHERE json_extract(j.value,'$.user')=aula_attempt_starts.user_id AND json_extract(j.value,'$.attempt')=aula_attempt_starts.attempt)`,
        )
        .bind(quiz.id, list),
      db.prepare("DELETE FROM aula_attempts WHERE course=?1 AND quiz=?2 AND details IS NULL AND answers='[]' AND id IN (SELECT json_extract(value,'$.id') FROM json_each(?3))").bind(body.course, quiz.id, list),
    ]);
    return json({ voided: rows.length, students: new Set(rows.map((r) => r.user_id)).size });
  },

  // Duplicar una evaluación (12.30), en el mismo curso o en otro donde también enseñe. La copia queda oculta, sin
  // intentos ni fecha de publicación. En otro curso no se llevan lo que depende del curso de origen (secciones,
  // categoría de calificación, condiciones, acceso especial) y las imágenes se enlazan al mismo archivo guardado.
  'POST /api/quiz/duplicate': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const target = String(body.target || body.course);
    const other = target !== body.course;
    if (other) {
      requireTeacher(await access(db, user, target));
      const archived = await one(db, 'SELECT archived_at FROM aula_courses WHERE id=?', target);
      if (archived?.archived_at) fail('El curso de destino está archivado: desarchívalo para agregarle evaluaciones.', 409);
    }
    const quiz = await contentRecord(db, String(body.quiz ?? ''), body.course, 'quiz');
    const { publishAt: _p, specialOnly: _s, emailedAt: _e, ...rest } = quiz.data;
    const data = { ...structuredClone(rest), title: text(body.title || `Copia de ${quiz.data.title}`, 200), visible: false };
    if (other) {
      delete data.sections;
      delete data.grade;
      delete data.conditions;
      // Imágenes de las preguntas: una fila nueva en el curso destino que apunta al mismo archivo de R2.
      const images = [...new Set(data.questions.map((q) => q.image).filter(Boolean))];
      if (images.length) {
        const files = await all(db, "SELECT * FROM aula_files WHERE course=? AND scope='material' AND id IN (SELECT value FROM json_each(?))", body.course, JSON.stringify(images));
        const map = new Map(files.map((f) => [f.id, crypto.randomUUID()]));
        await run(
          db,
          `INSERT INTO aula_files (id,course,owner,scope,name,size,mime,created,r2_key)
           SELECT json_extract(value,'$.id'), ?1, ?2, 'material', json_extract(value,'$.name'), json_extract(value,'$.size'),
                  json_extract(value,'$.mime'), ?3, json_extract(value,'$.key') FROM json_each(?4)`,
          target,
          user.id,
          nowIso(),
          JSON.stringify(files.map((f) => ({ id: map.get(f.id), name: f.name, size: f.size, mime: f.mime, key: f.r2_key || f.id }))),
        );
        for (const q of data.questions) {
          if (!q.image) continue;
          if (map.has(q.image)) q.image = map.get(q.image);
          else delete q.image;
        }
      }
    }
    const saved = await saveContentRecord(db, null, data, user.id, target, 'quiz');
    return json({ id: saved.id, course: target }, 201);
  },

  // Vista previa del docente (12.27): un sorteo nuevo cada vez (preguntas, orden y datos), tal como lo recibiría un
  // alumno. No se guarda ningún intento. Con `answers` (y la misma `seed`) califica esa vista previa.
  'POST /api/quiz/preview': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const quiz = await contentRecord(db, String(body.quiz ?? ''), body.course, 'quiz');
    const seed = PREVIEW_SEED.test(String(body.seed ?? '')) ? String(body.seed) : `vista:${crypto.randomUUID()}`;
    const instance = quizInstance(quiz, seed, 1);
    if (body.answers !== undefined) return json({ seed, ...gradeAttempt(quiz, instance, body.answers) });
    return json({ seed, perPage: quiz.data.settings?.perPage || 0, questions: instance.map(({ values: _v, perm: _p, key: _k, ...q }) => q) });
  },

  // El docente califica las respuestas escritas de un intento (y puede ajustar el crédito de cualquier otra pregunta).
  'POST /api/attempt/review': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const row = await one(db, 'SELECT * FROM aula_attempts WHERE id=? AND course=?', String(body.id ?? ''), body.course);
    if (!row) fail('Intento no encontrado.', 404);
    const quiz = await contentRecord(db, row.quiz, body.course, 'quiz');
    const reviews = Array.isArray(body.reviews) ? body.reviews : [];
    if (!reviews.length || reviews.length > MAX_QUESTIONS) fail('No hay nada que calificar.');
    const details = JSON.parse(row.details || '[]');
    for (const review of reviews) {
      const d = details.find((x) => x.index === review.index);
      if (!d || !quiz.data.questions[d.index]) fail('Pregunta no encontrada en este intento.', 404);
      const credit = Number(review.credit);
      if (!Number.isFinite(credit) || credit < 0 || credit > 1) fail('El puntaje de cada pregunta va de 0 a 100 %.');
      Object.assign(d, { credit, correct: credit === 1, reviewed: true, feedback: String(review.feedback ?? '').trim().slice(0, 2000) });
      if (!d.manual) d.overridden = true;
    }
    const scored = scoreOf(details, quiz.data.questions);
    await run(db, 'UPDATE aula_attempts SET details=?, correct=?, score=? WHERE id=?', JSON.stringify(details), scored.correct, scored.score, row.id);
    return json(attemptRecord(await one(db, 'SELECT * FROM aula_attempts WHERE id=?', row.id)));
  },

  // El navegador avisa que el alumno salió de la página (se envía al ocultarse, con keepalive).
  'POST /api/attempt/away': async ({ db, user, request }) => {
    const body = await readJson(request);
    const { quiz } = await attemptContext(db, user, body);
    if (!lockEnabled(quiz)) return json({ ok: true });
    // Dentro de Safe Exam Browser (verificado) no se puede salir: tocar su barra no cuenta como salida (12.31).
    if (await sebVerified(quiz, request)) return json({ ok: true });
    const start = await openStart(db, quiz, user.id);
    if (!start || start.attempt !== Number(body.attempt)) fail('Este intento ya no está en curso.', 409);
    assertDevice(quiz, start, user);
    await run(
      db,
      'UPDATE aula_attempt_starts SET away_since=coalesce(away_since, ?) WHERE quiz=? AND user_id=? AND attempt=? AND locked_at IS NULL',
      nowIso(),
      quiz.id,
      user.id,
      start.attempt,
    );
    return json({ ok: true });
  },

  // Volvió a la página: si estuvo fuera más que la tolerancia, se bloquea. `seconds` es lo que midió el navegador;
  // cuenta lo mayor entre eso y lo que midió el servidor (si el aviso de salida llegó).
  'POST /api/attempt/back': async ({ db, user, request }) => {
    const body = await readJson(request);
    const { quiz } = await attemptContext(db, user, body);
    if (!lockEnabled(quiz)) return json({ locked: false });
    // Dentro de Safe Exam Browser (verificado) no se puede salir: tocar su barra no cuenta como salida (12.31).
    if (await sebVerified(quiz, request)) return json({ locked: false });
    const start = await openStart(db, quiz, user.id);
    if (!start || start.attempt !== Number(body.attempt)) fail('Este intento ya no está en curso.', 409);
    assertDevice(quiz, start, user);
    if (start.locked_at) return json({ locked: true });
    const reported = Math.min(Math.max(Number(body.seconds) || 0, 0), 86_400);
    const measured = start.away_since ? (Date.now() - Date.parse(start.away_since)) / 1000 : 0;
    // 12.30: salidas cortas repetidas (ver otra pestaña 3 o 4 segundos, varias veces) también bloquean: a la
    // SHORT_EXITS_LOCK.ª salida desde el último desbloqueo, aunque cada una haya durado menos que la tolerancia.
    if (reported > 0 && exitsSinceUnlock(start) + 1 >= SHORT_EXITS_LOCK) {
      await lockAttempt(db, start, Math.max(reported, measured), 'salidas repetidas');
      return json({ locked: true, repeated: true });
    }
    const locked = await applyLock(db, quiz, { ...start, away_since: start.away_since || nowIso() }, Math.max(reported, measured));
    return json({ locked });
  },

  // El alumno escribe el código que le dio su docente. A los 5 errores solo el docente puede desbloquear.
  'POST /api/attempt/unlock': async ({ db, user, request }) => {
    const body = await readJson(request);
    const { quiz } = await attemptContext(db, user, body);
    const start = await openStart(db, quiz, user.id);
    if (!start || start.attempt !== Number(body.attempt)) fail('Este intento ya no está en curso.', 409);
    assertDevice(quiz, start, user);
    if (!start.locked_at) return json({ locked: false });
    // El intento se cuenta antes de comparar (condicionado al tope), para que no se puedan probar códigos en paralelo.
    const reserved = await one(
      db,
      `UPDATE aula_attempt_starts SET unlock_failures=unlock_failures+1
       WHERE quiz=? AND user_id=? AND attempt=? AND unlock_failures < ? RETURNING unlock_failures`,
      quiz.id,
      user.id,
      start.attempt,
      MAX_UNLOCK_FAILURES,
    );
    if (!reserved) fail('Demasiados códigos equivocados. Tu docente puede desbloquearte desde su monitor.', 429);
    const code = String(body.code ?? '').replace(/\D/g, '');
    if (!sameSecret(code, start.unlock_code || '')) {
      const left = MAX_UNLOCK_FAILURES - reserved.unlock_failures;
      fail(left > 0 ? `Código incorrecto. Te ${left === 1 ? 'queda 1 intento' : `quedan ${left} intentos`}.` : 'Demasiados códigos equivocados. Tu docente puede desbloquearte desde su monitor.', left > 0 ? 400 : 429);
    }
    await unlockAttempt(db, start, 'code');
    return json({ locked: false });
  },

  // El docente deja continuar a un alumno bloqueado sin dictarle el código (o tras 5 códigos equivocados).
  'POST /api/exam/resume': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const quiz = await contentRecord(db, body.quiz, body.course, 'quiz');
    const start = await openStart(db, quiz, String(body.user || ''));
    if (!start?.locked_at) fail('Ese alumno no está bloqueado.', 409);
    await unlockAttempt(db, start, 'teacher');
    return json({ ok: true });
  },

  // Examen en curso (docente): quién está contestando, sus salidas y quién quedó bloqueado por la contraseña.
  'GET /api/exam/monitor': async ({ db, user, url }) => {
    const course = url.searchParams.get('course');
    requireTeacher(await access(db, user, course));
    const quiz = await contentRecord(db, url.searchParams.get('quiz'), course, 'quiz');
    const [running, blocked, submitted, students] = await Promise.all([
      all(
        db,
        `SELECT s.*, coalesce(m.name, u.name) AS name, m.id AS member, m.section, d.start_at AS sec_start, d.end_at AS sec_end,
                qa.quiz AS grant_quiz, qa.start_at AS grant_start, qa.end_at AS grant_end, qa.extra_minutes, qa.extra_attempts
         FROM aula_attempt_starts s JOIN aula_users u ON u.id=s.user_id
           LEFT JOIN aula_members m ON m.course=?1 AND m.user_id=s.user_id
           LEFT JOIN aula_section_dates d ON d.item=s.quiz AND d.section=m.section
           LEFT JOIN aula_quiz_access qa ON qa.quiz=s.quiz AND qa.member=m.id
         WHERE s.quiz=?2 AND NOT EXISTS (SELECT 1 FROM aula_attempts a WHERE a.quiz=s.quiz AND a.user_id=s.user_id AND a.attempt=s.attempt)
         ORDER BY name`,
        course,
        quiz.id,
      ),
      all(
        db,
        `SELECT t.user_id, t.failures, coalesce(m.name, u.name) AS name, m.section FROM aula_exam_tries t JOIN aula_users u ON u.id=t.user_id
           LEFT JOIN aula_members m ON m.course=? AND m.user_id=t.user_id
         WHERE t.quiz=? AND t.failures>=?`,
        course,
        quiz.id,
        MAX_PASSWORD_FAILURES,
      ),
      // Resumen (12.31): quién ya terminó (con su calificación) y quién no ha empezado.
      all(
        db,
        `SELECT a.user_id, a.attempt, a.score, a.correct, a.total, a.created, a.details, coalesce(m.name, a.name) AS name, m.section, m.matricula
         FROM aula_attempts a LEFT JOIN aula_members m ON m.course=?1 AND (m.user_id=a.user_id OR 'demo:' || m.id=a.user_id)
         WHERE a.quiz=?2 AND a.course=?1 ORDER BY a.created`,
        course,
        quiz.id,
      ),
      all(
        db,
        `SELECT m.id, m.name, m.section, m.matricula, coalesce(m.user_id, 'demo:' || m.id) AS who,
                EXISTS (SELECT 1 FROM aula_quiz_access qa WHERE qa.quiz=?2 AND qa.member=m.id) AS granted
         FROM aula_members m WHERE m.course=?1 AND m.role='student' ORDER BY m.name`,
        course,
        quiz.id,
      ),
    ]);
    const byUser = new Map();
    for (const a of submitted) {
      const pending = (parseJson(a.details, []) || []).filter((d) => d?.manual && !d.reviewed).length;
      const row = byUser.get(a.user_id) || { user: a.user_id, name: a.name, section: a.section || '', matricula: a.matricula || '', attempts: 0, best: null, last: null, pending: 0 };
      row.attempts++;
      row.pending += pending;
      if (!row.best || a.score > row.best.score) row.best = { score: a.score, correct: a.correct, total: a.total, attempt: a.attempt };
      row.last = a.created;
      byUser.set(a.user_id, row);
    }
    const sections = Array.isArray(quiz.data.sections) ? quiz.data.sections : [];
    const inProgress = new Set(running.map((s) => s.user_id));
    const notStarted = students
      .filter((m) => (!sections.length || sections.includes(m.section)) && (!quiz.data.specialOnly || m.granted) && !byUser.has(m.who) && !inProgress.has(m.who))
      .map((m) => ({ name: m.name, section: m.section || '', matricula: m.matricula || '' }));
    return json({
      finished: [...byUser.values()].map((r) => ({ ...r, score: r.best.score, correct: r.best.correct, total: r.best.total })),
      notStarted,
      running: running.map((s) => ({
        user: s.user_id,
        name: s.name,
        member: s.member || null,
        section: s.section || '',
        attempt: s.attempt,
        started: s.started,
        deadline: deadlineOf(
          quizWithAccess(
            quizWithSectionDates(quiz, { start_at: s.sec_start, end_at: s.sec_end }),
            s.grant_quiz ? { start_at: s.grant_start, end_at: s.grant_end, extra_minutes: s.extra_minutes, extra_attempts: s.extra_attempts } : null,
          ),
          s.started,
        ),
        answered: Object.keys(JSON.parse(s.progress || '{}')).length,
        ...integritySummary(s),
        // Bloqueado al salir: el código solo lo ve quien enseña (para dictárselo en persona).
        locked: Boolean(s.locked_at),
        lockedAt: s.locked_at || null,
        unlockCode: s.locked_at ? s.unlock_code : null,
        unlockFailures: s.unlock_failures || 0,
        away: Boolean(s.away_since),
      })),
      blocked: blocked.map((b) => ({ user: b.user_id, name: b.name, section: b.section || '' })),
      total: questionCount(quiz.data),
    });
  },

  'POST /api/exam/unlock': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const quiz = await contentRecord(db, body.quiz, body.course, 'quiz');
    await run(db, 'DELETE FROM aula_exam_tries WHERE quiz=? AND user_id=?', quiz.id, String(body.user || ''));
    return json({ ok: true });
  },

  // ---- Archivos ----

  'POST /api/upload': async ({ db, env, user, url, request }) => {
    const course = url.searchParams.get('course');
    const a = await access(db, user, course);
    const scope = url.searchParams.get('scope');
    if (!['material', 'submission'].includes(scope)) fail('Tipo de archivo no válido.');
    if (scope === 'material') requireTeacher(a);
    let name;
    try {
      name = decodeURIComponent(request.headers.get('x-file-name') || '');
    } catch {
      fail('Nombre de archivo no válido.');
    }
    name = text(name, 180).replace(/[\x00-\x1f/\\]/g, '_');
    const declared = Number(request.headers.get('content-length')) || 0;
    if (declared > MAX_UPLOAD_BYTES) fail('El límite por archivo es de 20 MB.', 413);
    // Lo que ya subió esta persona en el curso (por índice) y el total de la plataforma (guardado; ver storageTotal).
    const [mine, total] = await Promise.all([
      one(db, 'SELECT coalesce(sum(size),0) AS bytes FROM aula_files WHERE course=? AND owner=?', course, user.id),
      storageTotal(db),
    ]);
    const used = { mine: mine.bytes, total };
    if (used.total + declared > TOTAL_QUOTA_BYTES) {
      console.error('aula-api almacenamiento casi lleno', used.total);
      fail('El almacenamiento de Enlace está casi lleno. Avisa a la administración.', 507);
    }
    if (!a.teach && used.mine + declared > STUDENT_QUOTA_BYTES) {
      fail(`Llegaste al límite de ${STUDENT_QUOTA_BYTES / MB} MB de archivos en este curso. Pide ayuda a tu docente.`, 413);
    }
    const reader = request.body?.getReader();
    if (!reader) fail('Archivo vacío.');
    const parts = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPLOAD_BYTES) {
        await reader.cancel();
        fail('El límite por archivo es de 20 MB.', 413);
      }
      parts.push(value);
    }
    if (!size) fail('Archivo vacío.');
    if (!a.teach && used.mine + size > STUDENT_QUOTA_BYTES) {
      fail(`Llegaste al límite de ${STUDENT_QUOTA_BYTES / MB} MB de archivos en este curso. Pide ayuda a tu docente.`, 413);
    }
    const id = crypto.randomUUID();
    const mime = request.headers.get('content-type') || 'application/octet-stream';
    // El lugar se aparta con una sola instrucción condicionada a las cuotas ANTES de escribir en R2: así varias subidas
    // en paralelo no pueden pasar juntas la comprobación de arriba (que solo evita leer el cuerpo en vano).
    const reserved = await one(
      db,
      `INSERT INTO aula_files (id,course,owner,scope,name,size,mime,created)
       SELECT ?1,?2,?3,?4,?5,?6,?7,?8
       WHERE coalesce((SELECT bytes FROM aula_storage WHERE id=1),0) + ?6 <= ?9
         AND (?10 OR (SELECT coalesce(sum(size),0) FROM aula_files WHERE course=?2 AND owner=?3) + ?6 <= ?11)
       RETURNING id`,
      id,
      course,
      user.id,
      scope,
      name,
      size,
      mime,
      nowIso(),
      TOTAL_QUOTA_BYTES,
      a.teach ? 1 : 0,
      STUDENT_QUOTA_BYTES,
    );
    if (!reserved) {
      if ((await storageTotal(db)) + size > TOTAL_QUOTA_BYTES) fail('El almacenamiento de Enlace está casi lleno. Avisa a la administración.', 507);
      fail(`Llegaste al límite de ${STUDENT_QUOTA_BYTES / MB} MB de archivos en este curso. Pide ayuda a tu docente.`, 413);
    }
    // El total guardado de la plataforma (12.30, `aula_storage`) sube con la reserva y baja si R2 falla.
    await run(db, 'UPDATE aula_storage SET bytes=bytes+? WHERE id=1', size);
    try {
      await env.BUCKET.put(id, new Blob(parts), { httpMetadata: { contentType: mime } });
    } catch (error) {
      await db.batch([
        db.prepare('DELETE FROM aula_files WHERE id=?').bind(id),
        db.prepare('UPDATE aula_storage SET bytes=max(bytes-?,0) WHERE id=1').bind(size),
      ]);
      throw error;
    }
    return json({ id, name, size }, 201);
  },

  // ---- Administración de docentes ----

  'GET /api/teachers': async ({ db, env, user }) => {
    requireAdmin(user);
    const ownerEmail = String(env.AULA_OWNER_EMAIL || '').toLowerCase();
    const rows = await all(
      db,
      `SELECT g.email, g.name, g.role, g.added_at, u.id AS user_id, a.name AS academy, n.name AS unit,
         (SELECT count(*) FROM aula_courses c WHERE c.owner=u.id
            AND NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)) AS courses
       FROM aula_teachers g LEFT JOIN aula_users u ON u.email=g.email
       LEFT JOIN aula_academies a ON a.id=u.academy_id LEFT JOIN aula_units n ON n.id=u.unit_id
       ORDER BY g.name COLLATE NOCASE`,
    );
    const teachers = rows.map((r) => ({ ...r, owner: r.email === ownerEmail }));
    if (ownerEmail && !teachers.some((t) => t.owner)) {
      const owner = await one(
        db,
        `SELECT u.id, u.name, a.name AS academy, n.name AS unit, (SELECT count(*) FROM aula_courses c WHERE c.owner=u.id
            AND NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)) AS courses
         FROM aula_users u LEFT JOIN aula_academies a ON a.id=u.academy_id LEFT JOIN aula_units n ON n.id=u.unit_id
         WHERE u.email=?`,
        ownerEmail,
      );
      teachers.unshift({
        email: ownerEmail,
        name: owner?.name || ownerEmail,
        role: 'admin',
        added_at: '',
        user_id: owner?.id || null,
        courses: owner?.courses || 0,
        academy: owner?.academy || null,
        unit: owner?.unit || null,
        owner: true,
      });
    }
    const logins = await lastLogins(db, teachers.map((t) => t.user_id).filter(Boolean));
    return json(teachers.map((t) => ({ ...t, lastLogin: logins[t.user_id] || null })));
  },

  'POST /api/teachers': async ({ db, env, user, request }) => {
    requireAdmin(user);
    const body = await readJson(request);
    const address = validEmail(body.email);
    const name = text(body.name, 150);
    const role = body.role === 'admin' ? 'admin' : 'teacher';
    if (address === String(env.AULA_OWNER_EMAIL || '').toLowerCase()) {
      fail('La cuenta principal de administración se define en la configuración del servidor.');
    }
    await db.batch([
      db
        .prepare(
          'INSERT INTO aula_teachers (email,name,role,added_by,added_at) VALUES (?,?,?,?,?) ' +
            'ON CONFLICT(email) DO UPDATE SET name=excluded.name,role=excluded.role',
        )
        .bind(address, name, role, user.id, nowIso()),
      db.prepare('UPDATE aula_users SET role=?,name=? WHERE email=?').bind(role, name, address),
    ]);
    return json({ ok: true });
  },

  // Retirar a un docente no borra nada: sus cursos se conservan (la administración los sigue viendo),
  // pero pierde el acceso a ellos y ya no puede crear nuevos. Si se le vuelve a dar de alta, lo recupera.
  'DELETE /api/teachers': async ({ db, env, user, request }) => {
    requireAdmin(user);
    const body = await readJson(request);
    const address = validEmail(body.email);
    if (address === String(env.AULA_OWNER_EMAIL || '').toLowerCase()) fail('La cuenta principal de administración no se puede retirar.');
    if (address === user.email) fail('No puedes retirar tu propia cuenta.');
    const result = await run(db, 'DELETE FROM aula_teachers WHERE email=?', address);
    if (!result.meta.changes) fail('Ese correo no está en la lista de docentes.', 404);
    // Pierde el acceso de docente de inmediato (también a los cursos que creó) y se cierran sus sesiones abiertas.
    await db.batch([
      db.prepare("UPDATE aula_users SET role='student', session_version=session_version+1 WHERE email=?").bind(address),
      db
        .prepare('UPDATE aula_logins SET revoked_at=? WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM aula_users WHERE email=?)')
        .bind(nowIso(), address),
    ]);
    return json({ ok: true });
  },
};

// ---- Descarga de archivos ----------------------------------------------------------------------

/** Sección del alumno que descarga (en SQL, con ?1 = curso y ?4 = usuario). */
const MY_SECTION = "(SELECT section FROM aula_members WHERE course=?1 AND user_id=?4 AND role='student')";
const MY_MEMBER = "(SELECT id FROM aula_members WHERE course=?1 AND user_id=?4 AND role='student')";

async function downloadFile({ db, env, user, url, request }, id) {
  const file = await one(db, 'SELECT * FROM aula_files WHERE id=?', id);
  if (!file) fail('Archivo no encontrado.', 404);
  // Con un examen abierto que bloquea la plataforma, solo se descargan las imágenes de ese examen.
  if (user.activeExam) {
    const inExam = await one(
      db,
      "SELECT 1 AS ok FROM aula_records r, json_each(r.data,'$.questions') qq WHERE r.id=? AND json_extract(qq.value,'$.image')=? LIMIT 1",
      user.activeExam.quiz,
      id,
    );
    if (!inExam) fail(ACTIVE_EXAM_MESSAGE, 423, { activeExam: user.activeExam });
  }
  // Imagen de una pregunta del banco (propia o compartida por la academia): la ve el docente aunque sea de otro curso.
  const fromBank = url.searchParams.get('bank') === '1' && file.scope === 'material' && (await bankImageVisible(db, user, id));
  const a = fromBank ? { teach: true } : await access(db, user, file.course);
  if (!a.teach && file.owner !== user.id) {
    // Un alumno solo descarga material del docente enlazado desde una unidad visible, un material visible
    // (cuya unidad también es visible) o una actividad visible.
    // Un archivo de entrega también lo ve quien tenga esa entrega a su nombre (entregas por equipo).
    const teammate =
      file.scope === 'submission' &&
      (await one(
        db,
        `SELECT 1 AS ok FROM aula_submissions s JOIN aula_members m ON m.id=s.member, json_each(s.file_ids) j
         WHERE s.course=? AND m.user_id=? AND j.value=? LIMIT 1`,
        file.course,
        user.id,
        id,
      ));
    const permitted =
      teammate ||
      file.scope === 'material' &&
      (await one(
        db,
        // Y dirigido a su sección (lo que es para otras secciones no se descarga).
        `SELECT 1 AS ok FROM aula_records r, json_each(r.data,'$.fileIds') j
         WHERE r.course=?1 AND r.kind IN ('material','module') AND j.value=?2 AND ${publishedSql('r', '?3')}
           AND r.deleted_at IS NULL AND ${sectionSql("json_extract(r.data,'$.sections')", MY_SECTION)} AND ${recordConditionsSql('r', MY_MEMBER, 'ca')}
           AND (r.kind='module' OR coalesce(json_extract(r.data,'$.module'),'')=''
                OR EXISTS (SELECT 1 FROM aula_records p WHERE p.id=json_extract(r.data,'$.module') AND p.course=?1
                           AND p.deleted_at IS NULL AND ${publishedSql('p', '?3')} AND ${sectionSql("json_extract(p.data,'$.sections')", MY_SECTION, 'sp')}
                           AND ${recordConditionsSql('p', MY_MEMBER, 'cb')}))
         UNION ALL
         SELECT 1 FROM aula_tasks t, json_each(t.file_ids) j WHERE t.course=?1 AND t.visible=1 AND t.deleted_at IS NULL AND j.value=?2
           AND ${sectionSql('t.sections', MY_SECTION)} AND ${specialTaskSql('t', MY_MEMBER)} AND ${conditionsSql('t.conditions', MY_MEMBER, 'ct')}
         UNION ALL
         -- Imagen de una pregunta: evaluación publicada y, si es examen, solo después de empezarlo (no se adelantan preguntas).
         SELECT 1 FROM aula_records r, json_each(r.data,'$.questions') qq
         WHERE r.course=?1 AND r.kind='quiz' AND r.deleted_at IS NULL AND ${publishedSql('r', '?3')} AND json_extract(qq.value,'$.image')=?2
           AND ${sectionSql("json_extract(r.data,'$.sections')", MY_SECTION)} AND ${specialRecordSql('r', MY_MEMBER)} AND ${recordConditionsSql('r', MY_MEMBER, 'cq')}
           AND (coalesce(json_extract(r.data,'$.settings.exam.enabled'),0)=0
                OR EXISTS (SELECT 1 FROM aula_attempt_starts s WHERE s.quiz=r.id AND s.user_id=?4))
         LIMIT 1`,
        file.course,
        id,
        nowIso(),
        user.id,
      ));
    if (!permitted) fail('No tienes acceso a este archivo.', 403);
  }
  if (url.searchParams.get('preview') === '1') return previewFile(env, request, file);
  const object = await env.BUCKET.get(file.r2_key || file.id);
  if (!object) fail('Archivo no disponible.', 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      ...SECURITY_HEADERS,
    },
  });
}

// ---- Vista previa ------------------------------------------------------------------------------

/**
 * Tipo real del archivo según sus primeros bytes. Solo formatos que el navegador muestra sin ejecutar código:
 * nunca HTML, SVG ni scripts, aunque la extensión diga otra cosa.
 */
export function sniffPreviewType(bytes) {
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (['heic', 'heix', 'mif1', 'msf1', 'heim', 'heis'].includes(brand)) return 'image/heic';
    if (brand === 'M4A ' || brand === 'M4B ') return 'audio/mp4';
    if (brand === 'qt  ') return 'video/quicktime';
    return 'video/mp4';
  }
  if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  return null;
}

/** Rango HTTP (una sola parte). Safari exige descargas parciales para reproducir video. */
function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return 'invalid';
  let start;
  let end;
  if (match[1] === '') {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start > end || start >= size ? 'invalid' : { start, end };
}

async function previewFile(env, request, file) {
  const head = await env.BUCKET.get(file.r2_key || file.id, { range: { offset: 0, length: 64 } });
  if (!head) fail('Archivo no disponible.', 404);
  const type = sniffPreviewType(new Uint8Array(await head.arrayBuffer()));
  if (!type) fail('Este tipo de archivo no tiene vista previa. Descárgalo para abrirlo.', 415);
  const range = parseRange(request.headers.get('range'), file.size);
  const headers = {
    ...SECURITY_HEADERS,
    'Cache-Control': 'private, max-age=300',
    'Content-Type': type,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Accept-Ranges': 'bytes',
  };
  if (range === 'invalid') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${file.size}` } });
  const object = await env.BUCKET.get(file.r2_key || file.id, range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : {});
  if (!object) fail('Archivo no disponible.', 404);
  if (!range) return new Response(object.body, { headers: { ...headers, 'Content-Length': String(file.size) } });
  return new Response(object.body, {
    status: 206,
    headers: {
      ...headers,
      'Content-Range': `bytes ${range.start}-${range.end}/${file.size}`,
      'Content-Length': String(range.end - range.start + 1),
    },
  });
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, photo: user.photo ? user.photo_updated : null };
}
