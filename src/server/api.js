// API de Enlace: cursos, contenido, inscripciones, actividades, entregas, calificaciones y archivos.
// Las rutas y las respuestas son compatibles con la interfaz de la versión 8.

import { access, requireAdmin, requireTeacher } from './access.js';
import { attendanceRoutes } from './attendance.js';
import { gradingRoutes } from './grading.js';
import { clearSessionCookie, identity, lastLogins, revokeAllStatements } from './auth.js';
import {
  assertAvailable,
  courseGradebook,
  loadTask,
  quizHasAttempts,
  saveAttempt,
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
const MAX_BULK_STUDENTS = 500;
/** Tipos que siguen guardándose como JSON libre en aula_records. */
const CONTENT_KINDS = ['module', 'material', 'notice', 'forum', 'post', 'group', 'quiz'];
const TEACHER_CONTENT_KINDS = ['module', 'material', 'notice', 'forum', 'quiz', 'group'];

export async function api(request, env) {
  try {
    const user = await identity(request, env);
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) requireSameOrigin(request);
    const ctx = { db: env.DB, env, user, url, request };
    const route = `${request.method} ${url.pathname}`;
    const handler = routes[route] || attendanceRoutes[route] || gradingRoutes[route];
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
  const r = unpack(await one(db, 'SELECT * FROM aula_records WHERE id=? AND course=?', id, course));
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

// ---- Rutas -------------------------------------------------------------------------------------

const routes = {
  'GET /api/me': async ({ user }) => json(publicUser(user)),

  // Cierra la sesión en todos los dispositivos de la persona (por ejemplo, si perdió su teléfono).
  'POST /api/logout-all': async ({ db, user }) => {
    await db.batch(revokeAllStatements(db, user.id));
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
  },

  'POST /api/profile': async ({ db, user, request }) => {
    const body = await readJson(request);
    await run(db, 'UPDATE aula_users SET name=? WHERE id=?', text(body.name, 150), user.id);
    return json({ ok: true });
  },

  // Una sola consulta sin importar cuántos cursos haya: el plan gratuito de D1 permite
  // 50 consultas por solicitud y la versión 8 hacía tres por curso.
  'GET /api/courses': async ({ db, user }) => {
    const notDeleted = 'NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)';
    const rows =
      user.role === 'admin'
        ? await all(db, `SELECT c.*, 1 AS can_teach FROM aula_courses c WHERE ${notDeleted} ORDER BY c.created DESC`)
        : await all(
            db,
            `SELECT c.*,
               CASE WHEN c.owner=?1 OR EXISTS (SELECT 1 FROM aula_members t WHERE t.course=c.id AND t.user_id=?1 AND t.role='teacher')
                 THEN 1 ELSE 0 END AS can_teach
             FROM aula_courses c
             WHERE (c.owner=?1 OR EXISTS (SELECT 1 FROM aula_members m WHERE m.course=c.id AND m.user_id=?1 AND m.role!='removed'))
               AND ${notDeleted}
             ORDER BY c.created DESC`,
            user.id,
          );
    return json(
      rows.map(({ can_teach: canTeach, ...c }) => ({
        ...c,
        canTeach: canTeach === 1,
        canDelete: user.role === 'admin' || c.owner === user.id,
      })),
    );
  },

  'POST /api/courses': async ({ db, user, request }) => {
    if (!['teacher', 'admin'].includes(user.role)) fail('No puedes crear cursos.', 403);
    const body = await readJson(request);
    const id = crypto.randomUUID();
    await run(
      db,
      'INSERT INTO aula_courses (id,owner,name,group_name,intro,created) VALUES (?,?,?,?,?,?)',
      id,
      user.id,
      text(body.name, 150),
      text(body.group, 100),
      optionalText(body.intro, 10000),
      nowIso(),
    );
    return json({ id }, 201);
  },

  'GET /api/course': async ({ db, user, url }) => {
    const courseId = url.searchParams.get('id');
    const a = await access(db, user, courseId);
    const rows = (
      await all(
        db,
        `SELECT * FROM aula_records WHERE course=? AND kind IN (${CONTENT_KINDS.map(() => '?').join(',')}) ORDER BY created`,
        courseId,
        ...CONTENT_KINDS,
      )
    ).map(unpack);
    const visible = (r) => r?.data.visible !== false;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const content = a.teach
      ? rows
      : rows
          .filter(
            (r) =>
              visible(r) &&
              (r.kind !== 'material' || !r.data.module || visible(byId.get(r.data.module))) &&
              (r.kind !== 'post' || visible(byId.get(r.data.forum))),
          )
          .map((r) =>
            // El alumno nunca recibe las respuestas correctas de una evaluación.
            r.kind === 'quiz' ? { ...r, data: { ...r.data, questions: r.data.questions.map(({ correct: _c, ...q }) => q) } } : r,
          );
    const records = [...content, ...(await courseGradebook(db, courseId, { teacher: a.teach, userId: user.id }))];

    const memberRows = await all(db, "SELECT * FROM aula_members WHERE course=? AND role!='removed' ORDER BY name", courseId);
    const members = a.teach
      ? memberRows
      : memberRows.map((m) => ({ id: m.id, user_id: m.user_id, name: m.name, role: m.role }));

    let files = await all(db, 'SELECT id,course,owner,scope,name,size,mime,created FROM aula_files WHERE course=?', courseId);
    if (!a.teach) {
      const shared = new Set(records.filter((r) => ['material', 'task'].includes(r.kind)).flatMap((r) => r.data.fileIds || []));
      files = files.filter((f) => f.owner === user.id || (f.scope === 'material' && shared.has(f.id)));
    }
    return json({
      course: a.course,
      canTeach: a.teach,
      canDelete: user.role === 'admin' || a.course.owner === user.id,
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
      'UPDATE aula_courses SET name=?,group_name=?,intro=? WHERE id=?',
      text(body.name, 150),
      text(body.group, 100),
      optionalText(body.intro, 10000),
      body.course,
    );
    return json({ ok: true });
  },

  // Retirar un curso lo oculta y bloquea el acceso, pero conserva registros y archivos.
  'DELETE /api/course': async ({ db, user, request }) => {
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    if (user.role !== 'admin' && a.course.owner !== user.id) fail('Solo el propietario o el administrador puede eliminar el curso.', 403);
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
    if (await one(db, 'SELECT id FROM aula_records WHERE id=?', moduleId)) {
      fail('Este curso ya tiene una guía inicial. Edita sus apartados en Contenido.', 409);
    }
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
        if (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > 50) {
          fail('Agrega de una a cincuenta preguntas.');
        }
        data.questions = input.questions.map((q) => {
          const validOptions =
            Array.isArray(q.options) &&
            q.options.length >= 2 &&
            q.options.length <= 6 &&
            Number.isInteger(q.correct) &&
            q.correct >= 0 &&
            q.correct < q.options.length;
          if (!validOptions) fail('Opciones de respuesta inválidas.');
          return { text: text(q.text, 3000), options: q.options.map((o) => text(o, 1500)), correct: q.correct };
        });
        if (previous && (await quizHasAttempts(db, body.course, previous.id)) && JSON.stringify(previous.data.questions) !== JSON.stringify(data.questions)) {
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
      data = { forum: forum.id, title: text(input.title, 200), body: text(input.body, 15000), name: user.name };
    }
    const saved = await saveContentRecord(db, previous, data, user.id, body.course, kind);
    return json(saved, previous ? 200 : 201);
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
    const result = await run(
      db,
      'UPDATE aula_submissions SET published=1,revision=revision+1,updated=? WHERE course=? AND task=? AND published=0',
      nowIso(),
      body.course,
      body.task,
    );
    return json({ published: result.meta.changes });
  },

  'POST /api/attempt': async ({ db, user, request }) => {
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    const quiz = await contentRecord(db, body.quiz, body.course, 'quiz');
    assertRecordAvailable(quiz);
    if (a.teach) fail('Las evaluaciones se envían desde una cuenta de alumno.');
    return json(await saveAttempt(db, { course: body.course, user, quiz, answers: body.answers }), 201);
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
    if (Number(request.headers.get('content-length')) > MAX_UPLOAD_BYTES) fail('El límite por archivo es de 20 MB.', 413);
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
      `SELECT g.email, g.name, g.role, g.added_at, u.id AS user_id,
         (SELECT count(*) FROM aula_courses c WHERE c.owner=u.id
            AND NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)) AS courses
       FROM aula_teachers g LEFT JOIN aula_users u ON u.email=g.email
       ORDER BY g.name COLLATE NOCASE`,
    );
    const teachers = rows.map((r) => ({ ...r, owner: r.email === ownerEmail }));
    if (ownerEmail && !teachers.some((t) => t.owner)) {
      const owner = await one(
        db,
        `SELECT u.id, u.name, (SELECT count(*) FROM aula_courses c WHERE c.owner=u.id
            AND NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)) AS courses
         FROM aula_users u WHERE u.email=?`,
        ownerEmail,
      );
      teachers.unshift({
        email: ownerEmail,
        name: owner?.name || ownerEmail,
        role: 'admin',
        added_at: '',
        user_id: owner?.id || null,
        courses: owner?.courses || 0,
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

  // Retirar a un docente no borra nada: conserva sus cursos, pero ya no puede crear nuevos.
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
    // Un alumno solo descarga material del docente enlazado desde contenido visible
    // (y cuya unidad también es visible) o desde una actividad visible.
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
         WHERE r.course=?1 AND r.kind='material' AND j.value=?2 AND json_type(r.data,'$.visible') IS NOT 'false'
           AND (coalesce(json_extract(r.data,'$.module'),'')=''
                OR EXISTS (SELECT 1 FROM aula_records p WHERE p.id=json_extract(r.data,'$.module') AND p.course=?1
                           AND json_type(p.data,'$.visible') IS NOT 'false'))
         UNION ALL
         SELECT 1 FROM aula_tasks t, json_each(t.file_ids) j WHERE t.course=?1 AND t.visible=1 AND j.value=?2
         LIMIT 1`,
        file.course,
        id,
      ));
    if (!permitted) fail('No tienes acceso a este archivo.', 403);
  }
  if (url.searchParams.get('preview') === '1') return previewFile(env, request, file);
  const object = await env.BUCKET.get(id);
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
  const head = await env.BUCKET.get(file.id, { range: { offset: 0, length: 64 } });
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
  const object = await env.BUCKET.get(file.id, range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : {});
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
