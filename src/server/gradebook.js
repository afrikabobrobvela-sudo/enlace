// Actividades, entregas, calificaciones, ponderaciones e intentos de evaluación.
//
// Desde la versión 9 estos datos viven en tablas propias (aula_tasks, aula_submissions,
// aula_attempts, aula_grade_settings) con llaves foráneas y restricciones CHECK.
// Hacia la interfaz se siguen entregando con la misma forma que en la versión 8
// ({ id, kind, data, revision, ... }), para que el frontend no tenga que cambiar.

import { all, fail, isoDate, nowIso, one, optionalText, parseJson, run, text } from './http.js';

// ---- Conversión fila → registro --------------------------------------------------------------

export function taskRecord(row) {
  return {
    id: row.id,
    course: row.course,
    kind: 'task',
    author: row.author,
    revision: row.revision,
    created: row.created,
    updated: row.updated,
    data: {
      title: row.title,
      body: row.body,
      visible: row.visible === 1,
      fileIds: parseJson(row.file_ids, []),
      submissionMode: row.submission_mode,
      maxFiles: row.max_files,
      extensions: parseJson(row.extensions, []),
      allowResubmit: row.allow_resubmit === 1,
      due: row.due,
      start: row.start_at,
      end: row.end_at,
      category: row.category ?? null,
      points: row.points ?? 1,
      rubric: row.rubric ?? null,
      groupCategory: row.group_category || '',
    },
  };
}

export function submissionRecord(row) {
  return {
    id: row.id,
    course: row.course,
    kind: 'submission',
    author: row.author,
    revision: row.revision,
    created: row.created,
    updated: row.updated,
    data: {
      task: row.task,
      member: row.member,
      body: row.body,
      fileIds: parseJson(row.file_ids, []),
      submitted: row.submitted,
      late: row.late === 1,
      manual: row.manual === 1,
      grade: row.grade,
      feedback: row.feedback,
      gradedAt: row.graded_at || '',
      published: row.published !== 0,
      rubricScores: parseJson(row.rubric_scores, null),
    },
  };
}

export function attemptRecord(row) {
  return {
    id: row.id,
    course: row.course,
    kind: 'attempt',
    author: row.user_id,
    revision: 1,
    created: row.created,
    updated: row.created,
    data: {
      quiz: row.quiz,
      answers: parseJson(row.answers, []),
      score: row.score,
      correct: row.correct,
      total: row.total,
      name: row.name,
      attempt: row.attempt ?? 1,
      details: parseJson(row.details, null),
    },
  };
}

/** Las ponderaciones se exponen como un único registro "weights" por curso, como en la versión 8. */
export function weightsRecord(course, settings, tasks) {
  if (!settings) return null;
  const weights = {};
  for (const t of tasks) if (t.weight !== null && t.weight !== undefined) weights[t.id] = t.weight;
  return {
    id: 'weights:' + course,
    course,
    kind: 'weights',
    author: settings.updated_by,
    revision: settings.revision,
    created: settings.updated,
    updated: settings.updated,
    data: { weights },
  };
}

// ---- Lectura ---------------------------------------------------------------------------------

export async function loadTask(db, id, course) {
  const row = await one(db, 'SELECT * FROM aula_tasks WHERE id=? AND course=? AND deleted_at IS NULL', id, course);
  if (!row) fail('Elemento no encontrado.', 404);
  return row;
}

/** Todo lo de calificaciones de un curso. Si se indica `userId`, solo lo que esa persona puede ver. */
export async function courseGradebook(db, course, { teacher, userId }) {
  // Para el alumno, su prórroga viene en la misma consulta (ext_due / ext_end): no suma consultas.
  const tasks = teacher
    ? await all(db, 'SELECT * FROM aula_tasks WHERE course=? AND deleted_at IS NULL ORDER BY created', course)
    : await all(
        db,
        `SELECT t.*, e.due AS ext_due, e.end_at AS ext_end FROM aula_tasks t
         LEFT JOIN aula_extensions e ON e.task=t.id AND e.member=(SELECT id FROM aula_members WHERE course=?1 AND user_id=?2)
         WHERE t.course=?1 AND t.deleted_at IS NULL ORDER BY t.created`,
        course,
        userId,
      );
  const settings = await one(db, 'SELECT * FROM aula_grade_settings WHERE course=?', course);
  // Las entregas de una actividad en la papelera se conservan, pero no se muestran ni cuentan.
  const active = 'AND s.task IN (SELECT id FROM aula_tasks WHERE course=s.course AND deleted_at IS NULL)';
  const submissions = teacher
    ? await all(db, `SELECT s.* FROM aula_submissions s WHERE s.course=? ${active} ORDER BY s.created`, course)
    : await all(
        db,
        `SELECT s.* FROM aula_submissions s JOIN aula_members m ON m.id=s.member WHERE s.course=? AND m.user_id=? ${active} ORDER BY s.created`,
        course,
        userId,
      );
  const attempts = teacher
    ? await all(db, 'SELECT * FROM aula_attempts WHERE course=? ORDER BY created', course)
    : await all(db, 'SELECT * FROM aula_attempts WHERE course=? AND user_id=? ORDER BY created', course, userId);
  // Prórrogas: el docente las ve todas; el alumno recibe sus actividades ya con sus fechas extendidas.
  const extensions = teacher ? await all(db, 'SELECT e.* FROM aula_extensions e JOIN aula_tasks t ON t.id=e.task WHERE t.course=?', course) : [];
  const hideDraft = (record) => {
    if (teacher) return record;
    const { published, ...data } = record.data;
    return published ? { ...record, data } : { ...record, data: { ...data, grade: null, feedback: '', gradedAt: '', rubricScores: null } };
  };
  const records = [
    ...tasks
      .filter((t) => teacher || t.visible === 1)
      .map((t) => {
        if (teacher) return taskRecord(t);
        const extension = t.ext_due ? { due: t.ext_due, end_at: t.ext_end } : null;
        const record = taskRecord(withExtension(t, extension));
        return extension ? { ...record, data: { ...record.data, extended: true } } : record;
      }),
    ...(teacher
      ? extensions.map((e) => ({
          id: `extension:${e.task}:${e.member}`,
          kind: 'extension',
          revision: 1,
          data: { task: e.task, member: e.member, due: e.due, end: e.end_at, reason: e.reason, created: e.created },
        }))
      : []),
    ...submissions.map(submissionRecord).map(hideDraft),
    ...attempts.map(attemptRecord),
  ];
  const weights = weightsRecord(course, settings, tasks);
  if (weights) records.push(weights);
  const categories = await all(db, 'SELECT id, name, weight, source FROM aula_grade_categories WHERE course=? ORDER BY position, name', course);
  records.push(gradingRecord(course, settings, categories));
  if (teacher) {
    // Rúbricas asignadas a actividades de este curso (aunque su autor haya dejado de compartirlas).
    const rubrics = await all(db, 'SELECT * FROM aula_rubrics WHERE id IN (SELECT rubric FROM aula_tasks WHERE course=? AND rubric IS NOT NULL AND deleted_at IS NULL)', course);
    records.push(...rubrics.map(rubricRecord));
  }
  return records;
}

/** Cómo se calcula la calificación del curso: esquema, categorías y reglas de la calificación final. */
export function gradingRecord(course, settings, categories) {
  return {
    id: 'grading:' + course,
    course,
    kind: 'grading',
    revision: settings?.revision ?? 0,
    data: {
      scheme: settings?.scheme ?? 'tasks',
      categories: categories.map((c) => ({ id: c.id, name: c.name, weight: c.weight, source: c.source })),
      final: {
        decimals: settings?.final_decimals ?? 1,
        rounding: settings?.final_rounding ?? 'half_up',
        passing: settings?.passing_grade ?? 6,
        failingAs: settings?.failing_as ?? null,
        missingAsZero: settings?.missing_as_zero === 1,
      },
    },
  };
}

export function rubricRecord(row) {
  return {
    id: row.id,
    kind: 'rubric',
    author: row.owner,
    revision: row.revision,
    updated: row.updated,
    data: { title: row.title, shared: row.shared === 1, ownerName: row.owner_name || '', ...parseJson(row.definition, { levels: [], criteria: [] }) },
  };
}

/** Equipo de un alumno dentro de una categoría de equipos (solo integrantes que siguen inscritos). */
export async function teamOf(db, course, category, memberId) {
  const row = await one(
    db,
    `SELECT id, data FROM aula_records r WHERE r.course=? AND r.kind='group' AND json_extract(r.data,'$.category')=?
       AND EXISTS (SELECT 1 FROM json_each(r.data,'$.members') j WHERE j.value=?)`,
    course,
    category,
    memberId,
  );
  if (!row) return null;
  const data = parseJson(row.data, {});
  const members = await all(
    db,
    "SELECT id, user_id FROM aula_members WHERE course=? AND role='student' AND id IN (SELECT value FROM json_each(?))",
    course,
    JSON.stringify(data.members || []),
  );
  return { id: row.id, title: data.title, members };
}

// ---- Actividades -------------------------------------------------------------------------------

/** Valida y normaliza los campos de una actividad (misma validación que en la versión 8). */
export function taskFields(input, fileIds) {
  const fields = {
    title: text(input.title, 200),
    body: String(input.body || '').slice(0, 30000),
    visible: input.visible !== false,
    fileIds,
    submissionMode: ['files', 'text', 'both'].includes(input.submissionMode) ? input.submissionMode : 'both',
    maxFiles: Number(input.maxFiles || 5),
    extensions: String(input.extensions || '')
      .toLowerCase()
      .split(',')
      .map((x) => x.trim().replace(/^\./, ''))
      .filter(Boolean),
    allowResubmit: input.allowResubmit !== false,
    due: isoDate(input.due),
    start: isoDate(input.start),
    end: isoDate(input.end),
    rubric: input.rubric ? String(input.rubric) : null,
    groupCategory: optionalText(input.groupCategory, 100),
  };
  if (!Number.isInteger(fields.maxFiles) || fields.maxFiles < 1 || fields.maxFiles > 5) fail('Selecciona de uno a cinco archivos.');
  if (fields.extensions.some((x) => !/^[a-z0-9]{1,12}$/.test(x))) fail('Escribe extensiones separadas por comas: pdf, docx, jpg.');
  if (fields.start && fields.end && fields.start > fields.end) fail('La fecha final debe ser posterior a la inicial.');
  return fields;
}

export async function saveTask(db, { course, userId, id, revision, fields }) {
  const now = nowIso();
  if (fields.rubric) {
    const rubric = await one(db, 'SELECT owner, shared FROM aula_rubrics WHERE id=?', fields.rubric);
    const current = id ? await one(db, 'SELECT rubric FROM aula_tasks WHERE id=? AND course=?', id, course) : null;
    // Una rúbrica propia o compartida (o la que ya tenía la actividad, aunque su autor dejara de compartirla).
    if (!rubric || (rubric.owner !== userId && rubric.shared !== 1 && current?.rubric !== fields.rubric)) fail('Rúbrica no disponible.');
  }
  const values = [
    fields.title,
    fields.body,
    fields.visible ? 1 : 0,
    fields.submissionMode,
    fields.maxFiles,
    JSON.stringify(fields.extensions),
    JSON.stringify(fields.fileIds),
    fields.allowResubmit ? 1 : 0,
    fields.due,
    fields.start,
    fields.end,
    fields.rubric,
    fields.groupCategory,
  ];
  if (id) {
    const current = await loadTask(db, id, course);
    if (revision !== current.revision) fail('Este elemento cambió. Recarga para obtener la versión actual.', 409);
    const result = await run(
      db,
      `UPDATE aula_tasks SET title=?,body=?,visible=?,submission_mode=?,max_files=?,extensions=?,file_ids=?,
         allow_resubmit=?,due=?,start_at=?,end_at=?,rubric=?,group_category=?,revision=revision+1,updated=?
       WHERE id=? AND course=? AND revision=?`,
      ...values,
      now,
      id,
      course,
      current.revision,
    );
    if (!result.meta.changes) fail('Otra persona modificó este elemento. Recarga antes de guardar.', 409);
    return { record: taskRecord(await loadTask(db, id, course)), created: false };
  }
  const newId = crypto.randomUUID();
  await run(
    db,
    `INSERT INTO aula_tasks (id,course,author,title,body,visible,submission_mode,max_files,extensions,file_ids,
       allow_resubmit,due,start_at,end_at,rubric,group_category,revision,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    newId,
    course,
    userId,
    ...values,
    now,
    now,
  );
  return { record: taskRecord(await loadTask(db, newId, course)), created: true };
}

/**
 * Fechas de la actividad para un alumno, con su prórroga si la tiene: nuevo vencimiento y, si la actividad
 * tenía cierre, cierre en la nueva fecha (o en la que indicó el docente).
 */
export function withExtension(task, extension) {
  if (!extension) return task;
  return { ...task, due: extension.due || task.due, end_at: extension.end_at || (task.end_at ? extension.due || task.end_at : '') };
}

/** Lanza un error si la actividad está oculta o fuera de su periodo de entrega. */
export function assertAvailable(task) {
  if (task.visible !== 1) fail('La actividad no está disponible.', 403);
  const now = Date.now();
  if (task.start_at && now < Date.parse(task.start_at)) fail('La actividad todavía no está disponible.', 403);
  if (task.end_at && now > Date.parse(task.end_at)) fail('El periodo de entrega ha terminado.', 403);
}

// ---- Ponderaciones -----------------------------------------------------------------------------

export async function saveWeights(db, { course, userId, id, revision, weights }) {
  const tasks = await all(db, 'SELECT id FROM aula_tasks WHERE course=? AND deleted_at IS NULL', course);
  const valid =
    weights &&
    typeof weights === 'object' &&
    Object.keys(weights).length === tasks.length &&
    tasks.every((t) => Number.isFinite(weights[t.id]) && weights[t.id] >= 0 && weights[t.id] <= 100) &&
    Math.abs(Object.values(weights).reduce((a, b) => a + b, 0) - 100) <= 0.01;
  if (!valid) fail('Los pesos de todas las actividades deben sumar 100 %.');

  const now = nowIso();
  const settings = await one(db, 'SELECT * FROM aula_grade_settings WHERE course=?', course);
  if (settings) {
    if (id !== 'weights:' + course || revision !== settings.revision) fail('Recarga la configuración antes de editar.', 409);
    // Quien gana este UPDATE condicionado es quien escribe; el otro recibe 409 y no toca los pesos.
    const bumped = await run(
      db,
      'UPDATE aula_grade_settings SET revision=revision+1,updated=?,updated_by=? WHERE course=? AND revision=?',
      now,
      userId,
      course,
      settings.revision,
    );
    if (!bumped.meta.changes) fail('Recarga la configuración antes de editar.', 409);
  } else {
    if (id) fail('Recarga la configuración antes de editar.', 409);
    try {
      await run(db, 'INSERT INTO aula_grade_settings (course,revision,updated,updated_by) VALUES (?,1,?,?)', course, now, userId);
    } catch {
      fail('Recarga la configuración antes de editar.', 409);
    }
  }
  await run(
    db,
    'UPDATE aula_tasks SET weight=(SELECT j.value FROM json_each(?) j WHERE j.key=aula_tasks.id) WHERE course=? AND deleted_at IS NULL',
    JSON.stringify(weights),
    course,
  );
  const taskWeights = await all(db, 'SELECT id, weight FROM aula_tasks WHERE course=? AND deleted_at IS NULL', course);
  return weightsRecord(course, await one(db, 'SELECT * FROM aula_grade_settings WHERE course=?', course), taskWeights);
}

// ---- Entregas del alumno -----------------------------------------------------------------------

export async function saveSubmission(db, { course, user, id, revision, input, validateFiles }) {
  const member = await one(db, 'SELECT * FROM aula_members WHERE course=? AND user_id=?', course, user.id);
  const previous = id ? await one(db, 'SELECT * FROM aula_submissions WHERE id=? AND course=?', id, course) : null;
  if (id && !previous) fail('Elemento no encontrado.', 404);
  if (previous && (!member || previous.member !== member.id || previous.task !== input.task)) {
    fail('No puedes modificar esta entrega.', 403);
  }
  if (previous && revision !== previous.revision) fail('Este elemento cambió. Recarga para obtener la versión actual.', 409);

  const loaded = await loadTask(db, input.task, course);
  if (!member || member.role !== 'student') fail('Solo un alumno inscrito puede entregar esta actividad.', 403);
  const extension = await one(db, 'SELECT due, end_at FROM aula_extensions WHERE task=? AND member=?', loaded.id, member.id);
  const task = withExtension(loaded, extension);
  assertAvailable(task);

  const existing = await one(db, 'SELECT * FROM aula_submissions WHERE task=? AND member=?', task.id, member.id);
  if (existing) {
    if (task.allow_resubmit !== 1 && existing.manual !== 1) fail('Esta actividad permite una sola entrega.', 403);
    if (!previous || previous.id !== existing.id) fail('Ya existe una entrega. Recarga antes de actualizarla.', 409);
  }

  const body = String(input.body || '').trim().slice(0, 30000);
  const fileIds = await validateFiles(input.fileIds, 'submission');
  if (fileIds.length > task.max_files) fail('Se excedió el número de archivos permitido.');
  if (task.submission_mode === 'files' && !fileIds.length) fail('Adjunta al menos un archivo.');
  if (task.submission_mode === 'text' && (!body || fileIds.length)) fail('Esta actividad requiere una respuesta de texto sin archivos.');
  const allowed = parseJson(task.extensions, []);
  if (allowed.length) {
    for (const fileId of fileIds) {
      const file = await one(db, 'SELECT name FROM aula_files WHERE id=?', fileId);
      if (!allowed.includes(file.name.split('.').pop().toLowerCase())) fail('Extensión no permitida. Usa: ' + allowed.join(', '));
    }
  }
  if (!body && !fileIds.length) fail('Escribe una respuesta o adjunta un archivo.');

  const now = nowIso();
  const late = task.due && Date.now() > Date.parse(task.due) ? 1 : 0;
  // Entrega por equipo: la misma entrega queda a nombre de cada integrante.
  let teammates = [];
  if (task.group_category) {
    const team = await teamOf(db, course, task.group_category, member.id);
    if (!team) fail(`Es una entrega por equipo y no perteneces a ningún equipo de "${task.group_category}". Pide a tu docente que te agregue.`, 403);
    teammates = team.members.filter((m) => m.id !== member.id);
    if (task.allow_resubmit !== 1 && teammates.length) {
      const done = await one(
        db,
        'SELECT 1 AS x FROM aula_submissions WHERE task=? AND manual=0 AND member IN (SELECT value FROM json_each(?))',
        task.id,
        JSON.stringify(teammates.map((m) => m.id)),
      );
      if (done) fail('Tu equipo ya entregó esta actividad.', 403);
    }
  }
  const shareWithTeam = async () => {
    if (!teammates.length) return;
    await db.batch(
      teammates.map((m) =>
        db
          .prepare(
            `INSERT INTO aula_submissions (id,course,task,member,author,body,file_ids,submitted,late,manual,grade,feedback,published,revision,created,updated)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,0,NULL,'',1,1,?8,?8)
             ON CONFLICT(task,member) DO UPDATE SET author=excluded.author, body=excluded.body, file_ids=excluded.file_ids,
               submitted=excluded.submitted, late=excluded.late, manual=0, grade=NULL, feedback='', published=1, graded_by=NULL,
               graded_at=NULL, rubric_scores=NULL, revision=aula_submissions.revision+1, updated=excluded.updated`,
          )
          .bind(`submission:${task.id}:${m.user_id || 'm-' + m.id}`, course, task.id, m.id, user.id, body, JSON.stringify(fileIds), now, late),
      ),
    );
  };
  // Una nueva entrega reinicia la calificación: el docente debe revisar el trabajo nuevo (igual que en v8).
  if (existing) {
    const result = await run(
      db,
      `UPDATE aula_submissions SET author=?,body=?,file_ids=?,submitted=?,late=?,grade=NULL,feedback='',published=1,graded_by=NULL,
         graded_at=NULL,rubric_scores=NULL,revision=revision+1,updated=? WHERE id=? AND revision=?`,
      user.id,
      body,
      JSON.stringify(fileIds),
      now,
      late,
      now,
      existing.id,
      existing.revision,
    );
    if (!result.meta.changes) fail('Otra persona modificó este elemento. Recarga antes de guardar.', 409);
    await shareWithTeam();
    return { record: submissionRecord(await one(db, 'SELECT * FROM aula_submissions WHERE id=?', existing.id)), created: false };
  }
  const newId = `submission:${task.id}:${user.id}`;
  try {
    await run(
      db,
      `INSERT INTO aula_submissions (id,course,task,member,author,body,file_ids,submitted,late,manual,grade,feedback,revision,created,updated)
       VALUES (?,?,?,?,?,?,?,?,?,0,NULL,'',1,?,?)`,
      newId,
      course,
      task.id,
      member.id,
      user.id,
      body,
      JSON.stringify(fileIds),
      now,
      late,
      now,
      now,
    );
  } catch {
    fail('Ya existe una entrega. Recarga antes de actualizarla.', 409);
  }
  await shareWithTeam();
  return { record: submissionRecord(await one(db, 'SELECT * FROM aula_submissions WHERE id=?', newId)), created: true };
}

// ---- Calificación del docente -----------------------------------------------------------------

/**
 * Evaluación con la rúbrica de la actividad. Se guarda una copia de lo elegido (criterio, nivel, puntos y comentario)
 * para que el alumno vea exactamente lo que se calificó aunque la rúbrica cambie después.
 */
async function rubricSnapshot(db, task, input) {
  if (input === undefined) return undefined; // no se toca
  if (input === null) return null;
  const row = task.rubric ? await one(db, 'SELECT title, definition FROM aula_rubrics WHERE id=?', task.rubric) : null;
  if (!row) fail('Esta actividad no tiene rúbrica.');
  const definition = parseJson(row.definition, { levels: [], criteria: [] });
  const scores = Array.isArray(input.scores) ? input.scores : [];
  if (scores.length !== definition.criteria.length) fail('Evalúa todos los criterios de la rúbrica.');
  const top = Math.max(...definition.levels.map((l) => l.points));
  const items = definition.criteria.map((criterion, i) => {
    const level = Number.isInteger(scores[i]) ? definition.levels[scores[i]] : undefined;
    if (!level) fail(`Elige un nivel para "${criterion.name}".`);
    return { criterion: criterion.name, level: level.name, points: level.points, max: top, comment: optionalText(input.comments?.[i], 1000) };
  });
  const total = items.reduce((n, item) => n + item.points, 0);
  return JSON.stringify({ title: row.title, scores, items, total, max: top * items.length });
}

export async function saveGrade(db, { course, grader, taskId, memberId, revision, grade, feedback, publish = true, rubric, team = false }) {
  const task = await loadTask(db, taskId, course);
  const member = await one(db, 'SELECT * FROM aula_members WHERE id=? AND course=?', memberId, course);
  if (!member) fail('Alumno no encontrado.');
  if (grade !== null && (!Number.isFinite(grade) || grade < 0 || grade > 10)) fail('Calificación fuera de la escala 0 a 10.');
  const note = optionalText(feedback, 15000);
  const scores = await rubricSnapshot(db, task, rubric);
  const existing = await one(db, 'SELECT * FROM aula_submissions WHERE task=? AND member=?', task.id, member.id);
  if (existing && revision !== existing.revision) fail('Esta calificación cambió. Recarga antes de guardar.', 409);
  if (!existing && revision) fail('Esta calificación cambió. Recarga antes de guardar.', 409);

  // Todo el equipo: misma calificación, comentarios y rúbrica para cada integrante, con o sin entrega registrada.
  let targets = [member];
  if (team) {
    if (!task.group_category) fail('Esta actividad no es por equipo.');
    const found = await teamOf(db, course, task.group_category, member.id);
    if (!found) fail('Este alumno no pertenece a ningún equipo de la actividad.');
    targets = found.members;
  }
  const now = nowIso();
  // Sin entrega previa se crea un registro "manual" (por ejemplo, un examen escrito).
  // ?13: la revisión que vio el docente; si otra persona guardó antes, no se sobrescribe.
  const sql = `INSERT INTO aula_submissions (id,course,task,member,author,body,file_ids,submitted,late,manual,grade,feedback,published,
      graded_by,graded_at,rubric_scores,revision,created,updated)
    VALUES (?1,?2,?3,?4,?5,'','[]','',0,1,?6,?7,?8,?9,?10,?11,1,?10,?10)
    ON CONFLICT(task,member) DO UPDATE SET grade=excluded.grade, feedback=excluded.feedback, published=excluded.published,
      graded_by=excluded.graded_by, graded_at=excluded.graded_at,
      rubric_scores=CASE WHEN ?12 THEN excluded.rubric_scores ELSE aula_submissions.rubric_scores END,
      revision=aula_submissions.revision+1, updated=excluded.updated
    WHERE ?13 IS NULL OR aula_submissions.revision=?13`;
  await db.batch(
    targets.map((m) => {
      const owner = m.user_id || m.id;
      const seen = m.id === member.id ? (existing ? existing.revision : null) : null;
      return db
        .prepare(sql)
        .bind(`submission:${task.id}:${owner}`, course, task.id, m.id, owner, grade, note, publish ? 1 : 0, grader.id, now, scores ?? null, scores === undefined ? 0 : 1, seen);
    }),
  );
  const saved = await one(db, 'SELECT * FROM aula_submissions WHERE task=? AND member=?', task.id, member.id);
  if (saved.graded_at !== now) fail('Esta calificación cambió. Recarga antes de guardar.', 409);
  return submissionRecord(saved);
}

export async function quizHasAttempts(db, course, quizId) {
  return Boolean(await one(db, 'SELECT 1 AS x FROM aula_attempts WHERE course=? AND quiz=? LIMIT 1', course, quizId));
}
