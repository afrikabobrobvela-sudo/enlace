// API de Enlace: cursos, contenido, inscripciones, actividades, entregas, calificaciones y archivos.
// Las rutas y las respuestas son compatibles con la interfaz de la versión 8.

import { access, ownsCourse, requireAdmin, requireTeacher, viewAs } from './access.js';
import { attendanceRoutes } from './attendance.js';
import { directoryRoutes, registrationStatus } from './directory.js';
import { PRIVACY_VERSION, privacyAccepted, privacyRoutes } from './privacy.js';
import { assertWritable, periodRoutes } from './periods.js';
import { dashboardRoutes } from './dashboard.js';
import { reportRoutes } from './reports.js';
import { demoRoutes } from './demo.js';
import { backupRoutes } from './backup.js';
import {
  MAX_EXAM_EVENTS,
  MAX_PASSWORD_FAILURES,
  assertInTime,
  deadlineOf,
  examPlaceCheck,
  finalAnswers,
  gradeAttempt,
  integritySummary,
  publicQuestions,
  publicSettings,
  quizFields,
  quizInstance,
  sameQuestions,
  validEvents,
} from './quizzes.js';
import { gradingRoutes } from './grading.js';
import { clearSessionCookie, identity, lastLogins, revokeAllStatements } from './auth.js';
import {
  assertAvailable,
  courseGradebook,
  loadTask,
  quizHasAttempts,
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

export async function api(request, env) {
  try {
    const user = await identity(request, env);
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    if (!['GET', 'HEAD'].includes(request.method)) {
      requireSameOrigin(request);
      await assertWritable(env.DB, route, url, request); // un curso archivado es de solo lectura
    }
    const ctx = { db: env.DB, env, user, url, request };
    const handler =
      routes[route] || attendanceRoutes[route] || gradingRoutes[route] || directoryRoutes[route] || privacyRoutes[route] || periodRoutes[route] || dashboardRoutes[route] || reportRoutes[route] || demoRoutes[route] || backupRoutes[route];
    if (handler) return await handler(ctx);
    if (request.method === 'GET' && url.pathname.startsWith('/api/file/')) return await downloadFile(ctx, url.pathname.slice(10));
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

const unpack = (row) => (row ? { ...row, data: parseJson(row.data, {}) } : null);

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
  if (r.data.visible === false) fail('La actividad no está disponible.', 403);
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

async function attemptContext(db, user, body) {
  const a = await access(db, user, body.course);
  if (a.teach) fail('Las evaluaciones se responden desde una cuenta de alumno. Usa Ver como alumno para revisarlas.');
  const quiz = await contentRecord(db, body.quiz, body.course, 'quiz');
  assertRecordAvailable(quiz);
  return { a, quiz };
}

// ---- Rutas -------------------------------------------------------------------------------------

const routes = {
  'GET /api/me': async ({ db, env, user }) =>
    json({ ...publicUser(user), ...(await registrationStatus(db, env, user)), privacyAccepted: privacyAccepted(user), privacyVersion: PRIVACY_VERSION }),

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
             WHERE ((?2 AND c.owner=?1)
                    OR EXISTS (SELECT 1 FROM aula_members m WHERE m.course=c.id AND m.user_id=?1
                               AND (m.role='student' OR (?2 AND m.role='teacher'))))
               AND ${notDeleted}
             ORDER BY c.created DESC`,
            user.id,
            user.role === 'teacher' ? 1 : 0,
          );
    return json(
      rows.map(({ can_teach: canTeach, ...c }) => ({
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
      'INSERT INTO aula_courses (id,owner,name,group_name,intro,created,academy_id,unit_id,period) VALUES (?,?,?,?,?,?,?,?,?)',
      id,
      user.id,
      text(body.name, 150),
      text(body.group, 100),
      optionalText(body.intro, 10000),
      nowIso(),
      user.academy_id ?? null,
      user.unit_id ?? null,
      optionalText(body.period, 60),
    );
    return json({ id }, 201);
  },

  'GET /api/course': async ({ db, user, url }) => {
    const courseId = url.searchParams.get('id');
    const a = await access(db, user, courseId);
    const { teach, preview, viewer } = viewAs(a, user, url);
    const rows = (
      await all(
        db,
        `SELECT * FROM aula_records WHERE course=? AND deleted_at IS NULL AND kind IN (${CONTENT_KINDS.map(() => '?').join(',')}) ORDER BY created`,
        courseId,
        ...CONTENT_KINDS,
      )
    ).map(unpack);
    const visible = (r) => r?.data.visible !== false;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const content = teach
      ? rows
      : rows
          .filter(
            (r) =>
              visible(r) &&
              (r.kind !== 'material' || !r.data.module || visible(byId.get(r.data.module))) &&
              (r.kind !== 'post' || visible(byId.get(r.data.forum))),
          )
          .map((r) =>
            // El alumno nunca recibe respuestas correctas, fórmulas ni rangos de las variables.
            // Del modo examen tampoco recibe la contraseña ni la ubicación del salón.
            r.kind === 'quiz' ? { ...r, data: { ...r.data, questions: publicQuestions(r.data.questions), settings: publicSettings(r.data.settings) } } : r,
          );
    const records = [...content, ...(await courseGradebook(db, courseId, { teacher: teach, userId: viewer }))];

    const memberRows = await all(db, "SELECT * FROM aula_members WHERE course=? AND role!='removed' ORDER BY name", courseId);
    const members = teach
      ? memberRows
      : memberRows.map((m) => ({ id: m.id, user_id: m.user_id, name: m.name, role: m.role }));

    let files = await all(db, 'SELECT id,course,owner,scope,name,size,mime,created FROM aula_files WHERE course=?', courseId);
    if (!teach) {
      const shared = new Set(records.filter((r) => ['module', 'material', 'task'].includes(r.kind)).flatMap((r) => r.data.fileIds || []));
      files = files.filter((f) => (viewer && f.owner === viewer) || (f.scope === 'material' && shared.has(f.id)));
    }
    return json({
      course: a.course,
      canTeach: teach,
      // canPreview: quien enseña puede alternar entre su vista y la de alumno.
      canPreview: a.teach,
      preview,
      canDelete: !preview && (user.role === 'admin' || ownsCourse(user, a.course)),
      records,
      members,
      files,
    });
  },

  'POST /api/course': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    await run(
      db,
      'UPDATE aula_courses SET name=?,group_name=?,intro=?,period=? WHERE id=?',
      text(body.name, 150),
      text(body.group, 100),
      optionalText(body.intro, 10000),
      optionalText(body.period, 60),
      body.course,
    );
    return json({ ok: true });
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
    await run(
      db,
      `INSERT INTO aula_members (id,course,email,user_id,name,matricula,role) VALUES (?,?,?,?,?,?,'student')
       ON CONFLICT(course,email) DO UPDATE SET name=excluded.name,matricula=excluded.matricula,role='student',
         user_id=coalesce(aula_members.user_id,excluded.user_id)`,
      crypto.randomUUID(),
      body.course,
      address,
      existingUser?.id || null,
      text(body.name, 150),
      optionalText(body.matricula, 50),
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
    body.students.forEach((s, index) => {
      try {
        const address = validEmail(s?.email);
        byEmail.set(address, {
          id: crypto.randomUUID(),
          email: address,
          name: text(s.name, 150),
          matricula: optionalText(s.matricula, 50),
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
      `INSERT INTO aula_members (id,course,email,user_id,name,matricula,role)
       SELECT json_extract(j.value,'$.id'), ?1, json_extract(j.value,'$.email'),
              (SELECT u.id FROM aula_users u WHERE u.email=json_extract(j.value,'$.email')),
              json_extract(j.value,'$.name'), json_extract(j.value,'$.matricula'), 'student'
       FROM json_each(?2) j WHERE true
       ON CONFLICT(course,email) DO UPDATE SET name=excluded.name,matricula=excluded.matricula,role='student',
         user_id=coalesce(aula_members.user_id,excluded.user_id)`,
      body.course,
      students,
    );
    return json({ total: byEmail.size, created: byEmail.size - before.n, updated: before.n });
  },

  'DELETE /api/member': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    await run(db, "UPDATE aula_members SET role='removed' WHERE id=? AND course=?", text(body.id, 200), body.course);
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
    if (TEACHER_CONTENT_KINDS.includes(kind)) {
      requireTeacher(a);
      data = { title: text(input.title, 200), body: String(input.body || '').slice(0, 30000), visible: input.visible !== false };
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
        if (previous && !sameQuestions(previous.data.questions, data.questions) && (await quizHasAttempts(db, body.course, previous.id))) {
          fail('Una evaluación con intentos no permite cambiar sus preguntas. Crea una nueva.');
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
      // kind === 'post'
      if (previous) fail('Las publicaciones no se editan desde este formulario.');
      const forum = await contentRecord(db, input.forum, body.course, 'forum');
      if (!a.teach && forum.data.visible === false) fail('Foro no disponible.', 403);
      // Un alumno publica con su nombre de la lista del curso, no con el de su cuenta.
      const enrolled = a.teach ? null : await one(db, "SELECT name FROM aula_members WHERE course=? AND user_id=? AND role='student'", body.course, user.id);
      data = { forum: forum.id, title: text(input.title, 200), body: text(input.body, 15000), name: enrolled?.name || user.name };
    }
    const saved = await saveContentRecord(db, previous, data, user.id, body.course, kind);
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
    const max = quiz.data.settings?.attempts || 1;
    const exam = quiz.data.settings?.exam || null;
    for (;;) {
      const done = await one(db, 'SELECT count(*) AS n, coalesce(max(attempt),0) AS last FROM aula_attempts WHERE quiz=? AND user_id=?', quiz.id, user.id);
      if (done.n >= max) fail(max === 1 ? 'Ya enviaste esta evaluación. Se permite un intento.' : `Ya usaste tus ${max} intentos.`, 409);
      const attempt = done.last + 1;
      let start = await one(db, 'SELECT * FROM aula_attempt_starts WHERE quiz=? AND user_id=? AND attempt=?', quiz.id, user.id, attempt);
      if (!start) {
        // Modo examen: la contraseña (la dicta el docente en el salón) solo se pide al empezar; retomar tras recargar no la pide.
        if (exam?.password) {
          const tries = await one(db, 'SELECT failures FROM aula_exam_tries WHERE quiz=? AND user_id=?', quiz.id, user.id);
          if ((tries?.failures || 0) >= MAX_PASSWORD_FAILURES) fail('Demasiadas contraseñas equivocadas. Pide a tu docente que te desbloquee.', 429);
          if (!sameSecret(String(body.password ?? '').trim(), exam.password)) {
            await run(
              db,
              'INSERT INTO aula_exam_tries (quiz,user_id,failures) VALUES (?,?,1) ON CONFLICT(quiz,user_id) DO UPDATE SET failures=failures+1',
              quiz.id,
              user.id,
            );
            const left = MAX_PASSWORD_FAILURES - (tries?.failures || 0) - 1;
            fail(left > 0 ? `Contraseña incorrecta. Te ${left === 1 ? 'queda 1 intento' : `quedan ${left} intentos`}.` : 'Demasiadas contraseñas equivocadas. Pide a tu docente que te desbloquee.', left > 0 ? 400 : 429);
          }
        }
        const place = exam ? examPlaceCheck(quiz, body.location, String(body.locationError || '')) : { flag: '', distance: null };
        await run(
          db,
          'INSERT OR IGNORE INTO aula_attempt_starts (quiz,user_id,attempt,started,flag,distance) VALUES (?,?,?,?,?,?)',
          quiz.id,
          user.id,
          attempt,
          nowIso(),
          place.flag,
          place.distance,
        );
        start = await one(db, 'SELECT * FROM aula_attempt_starts WHERE quiz=? AND user_id=? AND attempt=?', quiz.id, user.id, attempt);
      }
      const { started } = start;
      const deadline = deadlineOf(quiz, started);
      // Un intento cuyo tiempo se acabó sin enviarse cuenta como intento con 0.
      if (deadline && Date.now() > Date.parse(deadline) + 60_000) {
        await run(
          db,
          `INSERT OR IGNORE INTO aula_attempts (id,course,quiz,user_id,name,answers,correct,total,score,created,attempt,details,integrity)
           VALUES (?,?,?,?,?,'[]',0,?,0,?,?,NULL,?)`,
          attemptId(quiz.id, user.id, attempt),
          quiz.course,
          quiz.id,
          user.id,
          user.name,
          quiz.data.questions.length,
          nowIso(),
          attempt,
          exam ? JSON.stringify(integritySummary(start)) : null,
        );
        continue;
      }
      const questions = quizInstance(quiz, user.id, attempt).map(({ values: _v, ...q }) => q);
      // Al retomar un examen se devuelven las respuestas guardadas y la pregunta en la que iba.
      let saved = {};
      try {
        saved = JSON.parse(start.progress || '{}') || {};
      } catch {
        saved = {};
      }
      return json({
        attempt, started, deadline, attemptsLeft: max - done.n, serverNow: Date.now(), questions,
        exam: exam ? { oneByOne: exam.oneByOne, noBack: exam.noBack, position: start.position, answers: saved, flagged: Boolean(start.flag) } : null,
      });
    }
  },

  // Modo examen: guarda las respuestas mientras se contesta, la pregunta a la que avanzó y las salidas de la pantalla.
  'POST /api/attempt/progress': async ({ db, user, request }) => {
    const body = await readJson(request);
    const { quiz } = await attemptContext(db, user, body);
    if (!quiz.data.settings?.exam) fail('Esta evaluación no está en modo examen.');
    const start = await openStart(db, quiz, user.id);
    if (!start || start.attempt !== Number(body.attempt)) fail('Este intento ya no está en curso. Recarga la página.', 409);
    assertInTime(quiz, start.started);
    const events = validEvents(body.events);
    const noBack = quiz.data.settings.exam.noBack;
    const position = Number.isInteger(body.position) ? Math.min(Math.max(body.position, 0), quiz.data.questions.length) : start.position;
    let answers = null;
    if (body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)) {
      const next = {};
      for (const q of quiz.data.questions.keys()) {
        const value = body.answers[q];
        if (Number.isInteger(value)) next[q] = value; // opción elegida
        else if (typeof value === 'string' && value.trim()) next[q] = value.slice(0, 100); // respuesta numérica tal como se escribió
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
    const max = quiz.data.settings?.attempts || 1;
    const done = await one(db, 'SELECT count(*) AS n, coalesce(max(attempt),0) AS last FROM aula_attempts WHERE quiz=? AND user_id=?', quiz.id, user.id);
    if (done.n >= max) fail(max === 1 ? 'Ya enviaste esta evaluación. Se permite un intento.' : `Ya usaste tus ${max} intentos.`, 409);
    const attempt = done.last + 1;
    const start = await one(db, 'SELECT * FROM aula_attempt_starts WHERE quiz=? AND user_id=? AND attempt=?', quiz.id, user.id, attempt);
    const exam = quiz.data.settings?.exam || null;
    if ((quiz.data.settings?.timeLimit || exam) && !start) fail('Comienza el intento antes de enviarlo.', 409);
    if (start) assertInTime(quiz, start.started);
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
    return json(attemptRecord(await one(db, 'SELECT * FROM aula_attempts WHERE id=?', id)), 201);
  },

  // Examen en curso (docente): quién está contestando, sus salidas y quién quedó bloqueado por la contraseña.
  'GET /api/exam/monitor': async ({ db, user, url }) => {
    const course = url.searchParams.get('course');
    requireTeacher(await access(db, user, course));
    const quiz = await contentRecord(db, url.searchParams.get('quiz'), course, 'quiz');
    const [running, blocked] = await Promise.all([
      all(
        db,
        `SELECT s.*, coalesce(m.name, u.name) AS name FROM aula_attempt_starts s JOIN aula_users u ON u.id=s.user_id
           LEFT JOIN aula_members m ON m.course=? AND m.user_id=s.user_id
         WHERE s.quiz=? AND NOT EXISTS (SELECT 1 FROM aula_attempts a WHERE a.quiz=s.quiz AND a.user_id=s.user_id AND a.attempt=s.attempt)
         ORDER BY name`,
        course,
        quiz.id,
      ),
      all(
        db,
        `SELECT t.user_id, t.failures, coalesce(m.name, u.name) AS name FROM aula_exam_tries t JOIN aula_users u ON u.id=t.user_id
           LEFT JOIN aula_members m ON m.course=? AND m.user_id=t.user_id
         WHERE t.quiz=? AND t.failures>=?`,
        course,
        quiz.id,
        MAX_PASSWORD_FAILURES,
      ),
    ]);
    return json({
      running: running.map((s) => ({ name: s.name, attempt: s.attempt, started: s.started, deadline: deadlineOf(quiz, s.started), answered: Object.keys(JSON.parse(s.progress || '{}')).length, ...integritySummary(s) })),
      blocked: blocked.map((b) => ({ user: b.user_id, name: b.name })),
      total: quiz.data.questions.length,
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
    // Una sola consulta: lo que ya subió esta persona en el curso y el total de la plataforma.
    const used = await one(
      db,
      'SELECT (SELECT coalesce(sum(size),0) FROM aula_files WHERE course=? AND owner=?) AS mine, (SELECT coalesce(sum(size),0) FROM aula_files) AS total',
      course,
      user.id,
    );
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
    await env.BUCKET.put(id, new Blob(parts), { httpMetadata: { contentType: mime } });
    try {
      await run(
        db,
        'INSERT INTO aula_files (id,course,owner,scope,name,size,mime,created) VALUES (?,?,?,?,?,?,?,?)',
        id,
        course,
        user.id,
        scope,
        name,
        size,
        mime,
        nowIso(),
      );
    } catch (error) {
      await env.BUCKET.delete(id);
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

async function downloadFile({ db, env, user, url, request }, id) {
  const file = await one(db, 'SELECT * FROM aula_files WHERE id=?', id);
  if (!file) fail('Archivo no encontrado.', 404);
  const a = await access(db, user, file.course);
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
        `SELECT 1 AS ok FROM aula_records r, json_each(r.data,'$.fileIds') j
         WHERE r.course=?1 AND r.kind IN ('material','module') AND j.value=?2 AND json_type(r.data,'$.visible') IS NOT 'false'
           AND r.deleted_at IS NULL
           AND (r.kind='module' OR coalesce(json_extract(r.data,'$.module'),'')=''
                OR EXISTS (SELECT 1 FROM aula_records p WHERE p.id=json_extract(r.data,'$.module') AND p.course=?1
                           AND p.deleted_at IS NULL AND json_type(p.data,'$.visible') IS NOT 'false'))
         UNION ALL
         SELECT 1 FROM aula_tasks t, json_each(t.file_ids) j WHERE t.course=?1 AND t.visible=1 AND t.deleted_at IS NULL AND j.value=?2
         LIMIT 1`,
        file.course,
        id,
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
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
