// Categorías con pesos, reglas de la calificación final y banco de rúbricas.
import { access, requireTeacher } from './access.js';
import { rubricRecord } from './gradebook.js';
import { all, fail, json, nowIso, one, optionalText, readJson, run, text } from './http.js';

const STALE = 'Recarga la configuración de calificaciones antes de editar.';

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
    if (input.length > 20) fail('Usa como máximo 20 categorías.');
    const existing = new Set((await all(db, 'SELECT id FROM aula_grade_categories WHERE course=?', body.course)).map((c) => c.id));
    const names = new Set();
    let attendance = 0;
    const categories = input.map((c, position) => {
      const name = text(c?.name, 80);
      if (names.has(name.toLowerCase())) fail(`La categoría "${name}" está repetida.`);
      names.add(name.toLowerCase());
      const weight = Number(c.weight);
      if (!Number.isFinite(weight) || weight < 0 || weight > 100) fail(`El peso de "${name}" debe estar entre 0 y 100.`);
      const source = c.source === 'attendance' ? 'attendance' : 'tasks';
      if (source === 'attendance' && ++attendance > 1) fail('Solo puede haber una categoría de asistencia.');
      const key = String(c.key ?? '');
      return { key, id: existing.has(key) ? key : crypto.randomUUID(), name, weight, source, position };
    });
    if (body.scheme === 'categories') {
      if (!categories.length) fail('Agrega al menos una categoría.');
      const total = categories.reduce((n, c) => n + c.weight, 0);
      if (Math.abs(total - 100) > 0.01) fail(`Los pesos de las categorías deben sumar 100 % (ahora suman ${Math.round(total * 100) / 100} %).`);
    }
    const byKey = new Map(categories.map((c) => [c.key, c]));
    const taskIds = new Set((await all(db, 'SELECT id FROM aula_tasks WHERE course=? AND deleted_at IS NULL', body.course)).map((t) => t.id));
    const seen = new Set();
    const assignments = (Array.isArray(body.assignments) ? body.assignments : []).map((item) => {
      if (!taskIds.has(item?.task) || seen.has(item.task)) fail('Actividad no encontrada o repetida.');
      seen.add(item.task);
      const category = item.category ? byKey.get(String(item.category)) : null;
      if (item.category && !category) fail('Categoría no encontrada.');
      if (category?.source === 'attendance') fail('La categoría de asistencia no lleva actividades.');
      const points = Number(item.points ?? 1);
      if (!(points > 0 && points <= 1000)) fail('El valor de cada actividad debe ser mayor que 0 y hasta 1000.');
      return { task: item.task, category: category?.id ?? null, points };
    });
    await claimSettings(db, body.course, body.revision, user.id);
    const now = nowIso();
    const list = JSON.stringify(categories);
    const statements = [
      db.prepare('UPDATE aula_grade_settings SET scheme=? WHERE course=?').bind(body.scheme, body.course),
      // Las actividades de una categoría eliminada quedan sin categoría (ON DELETE SET NULL).
      db
        .prepare("DELETE FROM aula_grade_categories WHERE course=? AND id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?))")
        .bind(body.course, list),
      db
        .prepare(
          `INSERT INTO aula_grade_categories (id,course,name,weight,source,position,updated)
           SELECT json_extract(value,'$.id'), ?1, json_extract(value,'$.name'), json_extract(value,'$.weight'),
                  json_extract(value,'$.source'), json_extract(value,'$.position'), ?2 FROM json_each(?3) WHERE true
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, weight=excluded.weight, source=excluded.source,
             position=excluded.position, updated=excluded.updated`,
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
    await db.batch(statements);
    return json({ ok: true });
  },

  'POST /api/grades/final-rules': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const decimals = Number(body.decimals);
    const passing = Number(body.passing);
    const failingAs = body.failingAs === null || body.failingAs === '' || body.failingAs === undefined ? null : Number(body.failingAs);
    if (![0, 1, 2].includes(decimals)) fail('Elige 0, 1 o 2 decimales.');
    if (!['half_up', 'down'].includes(body.rounding)) fail('Forma de redondeo no válida.');
    if (!Number.isFinite(passing) || passing < 0 || passing > 10) fail('La mínima aprobatoria debe estar entre 0 y 10.');
    if (failingAs !== null && (!Number.isFinite(failingAs) || failingAs < 0 || failingAs >= passing)) {
      fail('La calificación para no aprobados debe ser menor que la mínima aprobatoria.');
    }
    await claimSettings(db, body.course, body.revision, user.id);
    await run(
      db,
      'UPDATE aula_grade_settings SET final_decimals=?, final_rounding=?, passing_grade=?, failing_as=?, missing_as_zero=? WHERE course=?',
      decimals,
      body.rounding,
      passing,
      failingAs,
      body.missingAsZero ? 1 : 0,
      body.course,
    );
    return json({ ok: true });
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
