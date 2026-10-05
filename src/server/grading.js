// Categorías con pesos, reglas de la calificación final y banco de rúbricas.
import { access, requireTeacher } from './access.js';
import { categoryGradeRecord, parseTerms, rubricRecord } from './gradebook.js';
import { all, fail, json, nowIso, one, optionalText, readJson, run, text } from './http.js';

const STALE = 'Recarga la configuración de calificaciones antes de editar.';
const MAX_COLUMNS = 1000;

/** Toma el turno de edición de la configuración del curso (la misma revisión que usan las ponderaciones). */
async function claimSettings(db, course, revision, userId) {
  const settings = await one(db, 'SELECT revision FROM aula_grade_settings WHERE course=?', course);
  const now = nowIso();
  if (settings) {
    if (revision !== settings.revision) fail(STALE, 409);
    const bumped = await run(
      db,
      'UPDATE aula_grade_settings SET revision=revision+1, updated=?, updated_by=? WHERE course=? AND revision=?',
      now,
      userId,
      course,
      settings.revision,
    );
    if (!bumped.meta.changes) fail(STALE, 409);
  } else {
    if (revision) fail(STALE, 409);
    try {
      await run(db, 'INSERT INTO aula_grade_settings (course,revision,updated,updated_by) VALUES (?,1,?,?)', course, now, userId);
    } catch {
      fail(STALE, 409);
    }
  }
}

function rubricDefinition(input) {
  const levels = Array.isArray(input?.levels) ? input.levels : [];
  const criteria = Array.isArray(input?.criteria) ? input.criteria : [];
  if (levels.length < 2 || levels.length > 6) fail('Usa de 2 a 6 niveles.');
  if (!criteria.length || criteria.length > 20) fail('Agrega de 1 a 20 criterios.');
  const cleanLevels = levels.map((level) => {
    const name = text(level?.name, 60);
    const points = Number(level?.points);
    if (!Number.isFinite(points) || points < 0 || points > 100) fail(`Los puntos de "${name}" deben estar entre 0 y 100.`);
    return { name, points };
  });
  if (Math.max(...cleanLevels.map((l) => l.points)) <= 0) fail('Al menos un nivel debe valer más de 0 puntos.');
  return {
    levels: cleanLevels,
    criteria: criteria.map((c) => ({ name: text(c?.name, 200), descriptors: cleanLevels.map((_, i) => optionalText(c?.descriptors?.[i], 500)) })),
  };
}

const isTeacher = (user) => user.role === 'teacher' || user.role === 'admin';

export const gradingRoutes = {
  // Esquema del curso: "tasks" (pesos por actividad, como antes) o "categories".
  'POST /api/grades/scheme': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    if (!['tasks', 'categories'].includes(body.scheme)) fail('Esquema de calificación no válido.');
    const input = Array.isArray(body.categories) ? body.categories : [];
    if (input.length > 40) fail('Usa como máximo 40 categorías.');
    const [settingsRow, existingRows] = await Promise.all([
      one(db, 'SELECT terms FROM aula_grade_settings WHERE course=?', body.course),
      all(db, 'SELECT id FROM aula_grade_categories WHERE course=?', body.course),
    ]);
    const existing = new Set(existingRows.map((c) => c.id));
    // Parciales (12.26): su peso es sobre la calificación final; los ids viven solo dentro del curso.
    const oldTerms = new Set(parseTerms(settingsRow?.terms).map((t) => t.id));
    const termInput = Array.isArray(body.terms) ? body.terms : [];
    if (termInput.length > 8) fail('Usa como máximo 8 parciales.');
    const termNames = new Set();
    const terms = termInput.map((t) => {
      const name = text(t?.name, 60);
      if (termNames.has(name.toLowerCase())) fail(`El parcial "${name}" está repetido.`);
      termNames.add(name.toLowerCase());
      const weight = Number(t.weight);
      if (!Number.isFinite(weight) || weight < 0 || weight > 100) fail(`El peso de "${name}" debe estar entre 0 y 100.`);
      const key = String(t.key ?? '');
      return { key, id: oldTerms.has(key) ? key : crypto.randomUUID(), name, weight };
    });
    const termByKey = new Map(terms.map((t) => [t.key, t]));
    const names = new Set();
    let attendance = 0;
    const categories = input.map((c, position) => {
      const name = text(c?.name, 80);
      const term = c.term ? termByKey.get(String(c.term)) : null;
      if (c.term && !term) fail(`El parcial de "${name}" no existe.`);
      // El mismo nombre puede repetirse en parciales distintos (Tareas del parcial 1 y del 2).
      const unique = `${term?.id ?? ''}\u0000${name.toLowerCase()}`;
      if (names.has(unique)) fail(`La categoría "${name}" está repetida${term ? ` en ${term.name}` : ''}.`);
      names.add(unique);
      const weight = Number(c.weight);
      if (!Number.isFinite(weight) || weight < 0 || weight > 100) fail(`El peso de "${name}" debe estar entre 0 y 100.`);
      const source = c.source === 'attendance' ? 'attendance' : 'tasks';
      if (source === 'attendance' && ++attendance > 1) fail('Solo puede haber una categoría de asistencia.');
      if (source === 'attendance' && term) fail('La asistencia se calcula con todo el curso: déjala en «Toda la materia», no dentro de un parcial.');
      const distribution = c.distribution === 'equal' ? 'equal' : 'manual';
      const dropLow = Number(c.dropLow ?? 0);
      const dropHigh = Number(c.dropHigh ?? 0);
      if (![dropLow, dropHigh].every((n) => Number.isInteger(n) && n >= 0 && n <= 20)) fail(`En "${name}", las calificaciones que no cuentan van de 0 a 20.`);
      const key = String(c.key ?? '');
      return {
        key,
        id: existing.has(key) ? key : crypto.randomUUID(),
        name,
        weight,
        source,
        position,
        term: term?.id ?? '',
        distribution,
        drop_low: source === 'tasks' ? dropLow : 0,
        drop_high: source === 'tasks' ? dropHigh : 0,
      };
    });
    if (body.scheme === 'categories') {
      if (!categories.length) fail('Agrega al menos una categoría.');
      const round = (n) => Math.round(n * 100) / 100;
      // Nivel superior: los parciales y las categorías de toda la materia.
      const top = terms.reduce((n, t) => n + t.weight, 0) + categories.filter((c) => !c.term).reduce((n, c) => n + c.weight, 0);
      if (Math.abs(top - 100) > 0.01) {
        fail(
          terms.length
            ? `Los parciales y las categorías de toda la materia deben sumar 100 % (ahora suman ${round(top)} %).`
            : `Los pesos de las categorías deben sumar 100 % (ahora suman ${round(top)} %).`,
        );
      }
      for (const term of terms) {
        const inside = categories.filter((c) => c.term === term.id);
        if (!inside.length) fail(`«${term.name}» no tiene categorías: agrégale al menos una (por ejemplo, Exámenes y Tareas).`);
        const sum = inside.reduce((n, c) => n + c.weight, 0);
        if (Math.abs(sum - 100) > 0.01) fail(`Las categorías de «${term.name}» deben sumar 100 % del parcial (ahora suman ${round(sum)} %).`);
      }
    }
    const byKey = new Map(categories.map((c) => [c.key, c]));
    const categoryOf = (item, what) => {
      const category = item.category ? byKey.get(String(item.category)) : null;
      if (item.category && !category) fail('Categoría no encontrada.');
      if (category?.source === 'attendance') fail(`La categoría de asistencia no lleva ${what}.`);
      return category;
    };
    const pointsOf = (value, fallback) => {
      const points = Number(value ?? fallback);
      if (!(points > 0 && points <= 1000)) fail('El valor de cada elemento debe ser mayor que 0 y hasta 1000.');
      return points;
    };
    const wantsQuizzes = Array.isArray(body.quizzes) && body.quizzes.length;
    const wantsForums = Array.isArray(body.forums) && body.forums.length;
    const [taskRows, quizRows, forumRows] = await Promise.all([
      all(db, 'SELECT id, forum FROM aula_tasks WHERE course=? AND deleted_at IS NULL', body.course),
      wantsQuizzes ? all(db, "SELECT id, data FROM aula_records WHERE course=? AND kind='quiz' AND deleted_at IS NULL", body.course) : [],
      wantsForums ? all(db, "SELECT id, data FROM aula_records WHERE course=? AND kind='forum' AND deleted_at IS NULL", body.course) : [],
    ]);
    const taskIds = new Set(taskRows.map((t) => t.id));
    const seen = new Set();
    const assignments = (Array.isArray(body.assignments) ? body.assignments : []).map((item) => {
      if (!taskIds.has(item?.task) || seen.has(item.task)) fail('Actividad no encontrada o repetida.');
      seen.add(item.task);
      const category = categoryOf(item, 'actividades');
      return { task: item.task, category: category?.id ?? null, points: pointsOf(item.points, 1) };
    });
    // Evaluaciones (12.26): su categoría también se elige aquí; solo se tocan las que cambiaron.
    const quizzes = new Map(quizRows.map((q) => [q.id, JSON.parse(q.data)]));
    const quizChanges = [];
    for (const item of wantsQuizzes ? body.quizzes : []) {
      const data = quizzes.get(item?.quiz);
      if (!data || seen.has(item.quiz)) fail('Evaluación no encontrada o repetida.');
      seen.add(item.quiz);
      const category = categoryOf(item, 'evaluaciones');
      const grade = category
        ? { category: category.id, points: pointsOf(item.points, data.grade?.points ?? 10), policy: ['best', 'last', 'average'].includes(item.policy) ? item.policy : 'best' }
        : null;
      const before = data.grade?.category ? { category: data.grade.category, points: data.grade.points, policy: data.grade.policy || 'best' } : null;
      if (JSON.stringify(before) !== JSON.stringify(grade)) quizChanges.push({ quiz: item.quiz, grade });
    }
    // Foros sin actividad de participación: elegirles categoría la crea (como «Calificar participación»).
    const graded = new Set(taskRows.map((t) => t.forum).filter(Boolean));
    const forums = new Map(forumRows.map((f) => [f.id, JSON.parse(f.data)]));
    const now = nowIso();
    const newTasks = [];
    for (const item of wantsForums ? body.forums : []) {
      const data = forums.get(item?.forum);
      if (!data || seen.has(item.forum)) fail('Foro no encontrado o repetido.');
      seen.add(item.forum);
      const category = categoryOf(item, 'foros');
      if (!category || graded.has(item.forum)) continue;
      newTasks.push({
        id: crypto.randomUUID(),
        title: `Participación: ${data.title}`.slice(0, 200),
        body: `Se califica tu participación en el foro «${data.title}». No hay nada que entregar aquí: participa en el foro.`,
        visible: data.visible === false ? 0 : 1,
        sections: data.sections?.length ? JSON.stringify(data.sections) : '',
        forum: item.forum,
        category: category.id,
        points: pointsOf(item.points, 1),
      });
    }
    await claimSettings(db, body.course, body.revision, user.id);
    const list = JSON.stringify(categories);
    const statements = [
      db.prepare('UPDATE aula_grade_settings SET scheme=?, terms=? WHERE course=?').bind(body.scheme, terms.length ? JSON.stringify(terms.map(({ id, name, weight }) => ({ id, name, weight }))) : '', body.course),
      // Si se elimina una categoría, también se eliminan sus capturas manuales.
      db
        .prepare("DELETE FROM aula_records WHERE course=?1 AND kind='category-grade' AND json_extract(data,'$.category') NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?2))")
        .bind(body.course, list),
      // Las actividades de una categoría eliminada quedan sin categoría (ON DELETE SET NULL).
      db
        .prepare("DELETE FROM aula_grade_categories WHERE course=? AND id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?))")
        .bind(body.course, list),
      db
        .prepare(
          `INSERT INTO aula_grade_categories (id,course,name,weight,source,position,term,distribution,drop_low,drop_high,updated)
           SELECT json_extract(value,'$.id'), ?1, json_extract(value,'$.name'), json_extract(value,'$.weight'),
                  json_extract(value,'$.source'), json_extract(value,'$.position'), json_extract(value,'$.term'),
                  json_extract(value,'$.distribution'), json_extract(value,'$.drop_low'), json_extract(value,'$.drop_high'), ?2
           FROM json_each(?3) WHERE true
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, weight=excluded.weight, source=excluded.source,
             position=excluded.position, term=excluded.term, distribution=excluded.distribution,
             drop_low=excluded.drop_low, drop_high=excluded.drop_high, updated=excluded.updated`,
        )
        .bind(body.course, now, list),
    ];
    if (assignments.length) {
      statements.push(
        db
          .prepare(
            `UPDATE aula_tasks SET
               category=(SELECT json_extract(value,'$.category') FROM json_each(?1) WHERE json_extract(value,'$.task')=aula_tasks.id),
               points=(SELECT json_extract(value,'$.points') FROM json_each(?1) WHERE json_extract(value,'$.task')=aula_tasks.id)
             WHERE course=?2 AND id IN (SELECT json_extract(value,'$.task') FROM json_each(?1))`,
          )
          .bind(JSON.stringify(assignments), body.course),
      );
    }
    if (quizChanges.length) {
      // Sube la revisión: quien tenga la evaluación abierta en el editor recibirá «recarga» en vez de pisar el cambio.
      statements.push(
        db
          .prepare(
            `UPDATE aula_records SET
               data=(SELECT CASE WHEN json_extract(value,'$.grade') IS NULL THEN json_remove(aula_records.data,'$.grade')
                            ELSE json_set(aula_records.data,'$.grade',json(json_extract(value,'$.grade'))) END
                     FROM json_each(?1) WHERE json_extract(value,'$.quiz')=aula_records.id),
               revision=revision+1, updated=?3
             WHERE course=?2 AND kind='quiz' AND deleted_at IS NULL AND id IN (SELECT json_extract(value,'$.quiz') FROM json_each(?1))`,
          )
          .bind(JSON.stringify(quizChanges), body.course, now),
      );
    }
    if (newTasks.length) {
      statements.push(
        db
          .prepare(
            `INSERT INTO aula_tasks (id,course,author,title,body,visible,submission_mode,max_files,extensions,file_ids,allow_resubmit,due,start_at,end_at,
               sections,forum,category,points,revision,created,updated)
             SELECT json_extract(value,'$.id'), ?1, ?2, json_extract(value,'$.title'), json_extract(value,'$.body'), json_extract(value,'$.visible'),
                    'text',1,'[]','[]',0,'','','', json_extract(value,'$.sections'), json_extract(value,'$.forum'), json_extract(value,'$.category'),
                    json_extract(value,'$.points'), 1, ?3, ?3
             FROM json_each(?4)`,
          )
          .bind(body.course, user.id, now, JSON.stringify(newTasks)),
      );
    }
    await db.batch(statements);
    return json({ ok: true, quizzes: quizChanges.length, forums: newTasks.length });
  },

  'POST /api/grades/final-rules': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const passing = Number(body.passing);
    if (!Number.isFinite(passing) || passing < 0 || passing > 10) fail('La mínima aprobatoria debe estar entre 0 y 10.');
    await claimSettings(db, body.course, body.revision, user.id);
    await run(
      db,
      'UPDATE aula_grade_settings SET final_decimals=?, final_rounding=?, passing_grade=?, failing_as=?, missing_as_zero=? WHERE course=?',
      0,
      'down',
      passing,
      null,
      body.missingAsZero ? 1 : 0,
      body.course,
    );
    return json({ ok: true });
  },

  // Orden de las columnas del libro (12.30): ids de actividades del curso, de izquierda a derecha. No usa la revisión de
  // la configuración: mover una columna no debe invalidar los pesos o las categorías que alguien esté editando.
  'POST /api/grades/order': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    if (!Array.isArray(body.order) || body.order.length > MAX_COLUMNS) fail('Orden de columnas no válido.');
    const wanted = [...new Set(body.order.map(String))];
    // También las de la papelera: si se restauran, vuelven a su lugar.
    const known = new Set(
      (await all(db, 'SELECT id FROM aula_tasks WHERE course=? AND id IN (SELECT value FROM json_each(?))', body.course, JSON.stringify(wanted))).map((t) => t.id),
    );
    const order = wanted.filter((id) => known.has(id));
    const now = nowIso();
    // Si el curso aún no tenía configuración, la fila nace aquí: `created` avisa al navegador que recargue la revisión.
    const created = await run(
      db,
      'INSERT INTO aula_grade_settings (course,revision,updated,updated_by,column_order) VALUES (?,1,?,?,?) ON CONFLICT(course) DO NOTHING',
      body.course,
      now,
      user.id,
      order.length ? JSON.stringify(order) : '',
    );
    if (!created.meta.changes) await run(db, 'UPDATE aula_grade_settings SET column_order=? WHERE course=?', order.length ? JSON.stringify(order) : '', body.course);
    return json({ order, created: created.meta.changes > 0 });
  },

  // Captura directa de un rubro por alumno. Una calificación manual sustituye el cálculo del rubro;
  // `grade: null` la borra y devuelve el rubro a su cálculo automático.
  'POST /api/grades/category': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const [category, member] = await Promise.all([
      one(db, "SELECT id, source FROM aula_grade_categories WHERE id=? AND course=?", body.category, body.course),
      one(db, "SELECT id FROM aula_members WHERE id=? AND course=? AND role='student'", body.member, body.course),
    ]);
    if (!category) fail('Rubro no encontrado.', 404);
    if (category.source !== 'tasks') fail('Este rubro se calcula desde asistencia y no admite captura manual.');
    if (!member) fail('Alumno no encontrado.', 404);
    const id = `category-grade:${category.id}:${member.id}`;
    const existing = await one(db, "SELECT * FROM aula_records WHERE id=? AND course=? AND kind='category-grade'", id, body.course);
    if (existing && body.revision !== existing.revision) fail('Esta calificación cambió. Recarga antes de guardar.', 409);
    if (!existing && body.revision) fail('Esta calificación cambió. Recarga antes de guardar.', 409);
    if (body.grade === null) {
      if (!existing) return json({ deleted: true, id });
      const deleted = await run(db, "DELETE FROM aula_records WHERE id=? AND course=? AND kind='category-grade' AND revision=?", id, body.course, existing.revision);
      if (!deleted.meta.changes) fail('Esta calificación cambió. Recarga antes de guardar.', 409);
      return json({ deleted: true, id });
    }
    const grade = Number(body.grade);
    if (!Number.isFinite(grade) || grade < 0 || grade > 10) fail('La calificación va de 0 a 10.');
    const now = nowIso();
    const data = JSON.stringify({ category: category.id, member: member.id, grade });
    if (existing) {
      const changed = await run(
        db,
        "UPDATE aula_records SET author=?,data=?,revision=revision+1,updated=? WHERE id=? AND course=? AND kind='category-grade' AND revision=?",
        user.id,
        data,
        now,
        id,
        body.course,
        existing.revision,
      );
      if (!changed.meta.changes) fail('Esta calificación cambió. Recarga antes de guardar.', 409);
    } else {
      try {
        await run(db, "INSERT INTO aula_records (id,course,kind,author,data,revision,created,updated) VALUES (?,?,'category-grade',?,?,1,?,?)", id, body.course, user.id, data, now, now);
      } catch {
        fail('Esta calificación cambió. Recarga antes de guardar.', 409);
      }
    }
    return json(categoryGradeRecord(await one(db, 'SELECT * FROM aula_records WHERE id=?', id)));
  },

  // Rúbricas propias y las compartidas con la Academia.
  'GET /api/rubrics': async ({ db, user }) => {
    if (!isTeacher(user)) fail('Solo el personal docente usa rúbricas.', 403);
    const rows = await all(
      db,
      `SELECT r.*, u.name AS owner_name FROM aula_rubrics r JOIN aula_users u ON u.id=r.owner
       WHERE r.owner=? OR r.shared=1 ORDER BY r.title COLLATE NOCASE`,
      user.id,
    );
    return json({ rubrics: rows.map((row) => ({ ...rubricRecord(row), mine: row.owner === user.id })) });
  },

  'POST /api/rubric': async ({ db, user, request }) => {
    if (!isTeacher(user)) fail('Solo el personal docente usa rúbricas.', 403);
    const body = await readJson(request);
    const title = text(body.title, 120);
    const definition = JSON.stringify(rubricDefinition(body));
    const shared = body.shared ? 1 : 0;
    const now = nowIso();
    if (!body.id) {
      const id = crypto.randomUUID();
      await run(
        db,
        'INSERT INTO aula_rubrics (id,owner,title,definition,shared,revision,created,updated) VALUES (?,?,?,?,?,1,?,?)',
        id,
        user.id,
        title,
        definition,
        shared,
        now,
        now,
      );
      return json({ id }, 201);
    }
    const current = await one(db, 'SELECT owner, revision FROM aula_rubrics WHERE id=?', body.id);
    if (!current) fail('Rúbrica no encontrada.', 404);
    // Solo quien la creó la modifica; administración puede eliminarla, pero no cambiar el trabajo de un colega.
    if (current.owner !== user.id) fail('Solo quien creó la rúbrica puede editarla.', 403);
    const result = await run(
      db,
      'UPDATE aula_rubrics SET title=?, definition=?, shared=?, revision=revision+1, updated=? WHERE id=? AND revision=?',
      title,
      definition,
      shared,
      now,
      body.id,
      body.revision,
    );
    if (!result.meta.changes) fail('La rúbrica cambió. Recarga antes de guardar.', 409);
    return json({ id: body.id });
  },

  'DELETE /api/rubric': async ({ db, user, request }) => {
    const body = await readJson(request);
    const current = await one(db, 'SELECT owner FROM aula_rubrics WHERE id=?', body.id);
    if (!current) fail('Rúbrica no encontrada.', 404);
    if (current.owner !== user.id && user.role !== 'admin') fail('Solo quien creó la rúbrica puede eliminarla.', 403);
    // Las actividades que la usaban quedan sin rúbrica; las evaluaciones ya hechas conservan su copia.
    await run(db, 'DELETE FROM aula_rubrics WHERE id=?', body.id);
    return json({ ok: true });
  },
};
