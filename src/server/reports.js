// Reportes para la administración (cursos y uso por academia y unidad) y limpieza de archivos huérfanos en R2.
import { requireAdmin } from './access.js';
import { all, fail, json, readJson } from './http.js';

const DAY = 86_400_000;
/** Un archivo recién subido puede estar en un formulario sin guardar: solo cuenta como huérfano después de 7 días. */
const ORPHAN_DAYS = 7;
const CLEANUP_BATCH = 500;
export const CLEANUP_CONFIRMATION = 'BORRAR ARCHIVOS';

/**
 * Archivos que nada enlaza: ni unidades/materiales/noticias/foros (aunque estén en la papelera, porque se pueden
 * restaurar), ni actividades (también en papelera), ni entregas, ni imágenes de preguntas de evaluaciones o del
 * banco de preguntas. Por eso aquí NO se filtra deleted_at.
 * D1 admite hasta 5 términos por SELECT compuesto: aquí son 5 (el máximo).
 */
const ORPHANS = `WITH refs(id) AS (
    SELECT j.value FROM aula_records r, json_each(r.data,'$.fileIds') j WHERE json_valid(r.data)
    UNION SELECT j.value FROM aula_tasks t, json_each(t.file_ids) j
    UNION SELECT j.value FROM aula_submissions s, json_each(s.file_ids) j
    UNION SELECT json_extract(q.value,'$.image') FROM aula_records r, json_each(r.data,'$.questions') q
      WHERE r.kind='quiz' AND json_valid(r.data)
    UNION SELECT json_extract(b.question,'$.image') FROM aula_question_bank b)
  SELECT f.id, f.course, f.name, f.size, f.scope, f.created, coalesce(f.r2_key, f.id) AS r2_key, c.name AS course_name
  FROM aula_files f LEFT JOIN aula_courses c ON c.id=f.course
  WHERE f.created < ?1 AND f.id NOT IN (SELECT id FROM refs WHERE id IS NOT NULL)`;

export const reportRoutes = {
  // Cursos con su academia y unidad, alumnos, actividades, entregas y espacio usado. La agrupación se hace aquí.
  'GET /api/reports': async ({ db, user }) => {
    requireAdmin(user);
    const [courses, storage] = await Promise.all([
      all(
        db,
        `SELECT c.id, c.name, c.group_name, c.period, c.archived_at, c.created,
                coalesce(a.name, 'Sin academia') AS academy, coalesce(u.name, 'Sin unidad') AS unit, coalesce(o.name, o.email, '') AS owner,
                (SELECT count(*) FROM aula_members m WHERE m.course=c.id AND m.role='student') AS students,
                (SELECT count(*) FROM aula_tasks t WHERE t.course=c.id AND t.deleted_at IS NULL) AS tasks,
                (SELECT count(*) FROM aula_submissions s JOIN aula_tasks t ON t.id=s.task AND t.deleted_at IS NULL
                   WHERE s.course=c.id AND s.submitted!='') AS submissions,
                (SELECT coalesce(sum(f.size),0) FROM aula_files f WHERE f.course=c.id AND f.r2_key IS NULL) AS bytes
         FROM aula_courses c LEFT JOIN aula_academies a ON a.id=c.academy_id LEFT JOIN aula_units u ON u.id=c.unit_id
           LEFT JOIN aula_users o ON o.id=c.owner
         WHERE NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)
         ORDER BY academy, unit, c.name LIMIT 3000`,
      ),
      // Solo los objetos propios: las copias de cursos comparten el archivo original y no ocupan espacio extra.
      all(db, 'SELECT coalesce(sum(size),0) AS bytes, count(*) AS files FROM aula_files WHERE r2_key IS NULL'),
    ]);
    const groups = new Map();
    for (const c of courses) {
      const key = `${c.academy}\u0000${c.unit}`;
      const g = groups.get(key) || { academy: c.academy, unit: c.unit, courses: 0, active: 0, teachers: new Set(), students: 0, tasks: 0, submissions: 0, bytes: 0 };
      g.courses++;
      if (!c.archived_at) g.active++;
      g.teachers.add(c.owner);
      g.students += c.students;
      g.tasks += c.tasks;
      g.submissions += c.submissions;
      g.bytes += c.bytes;
      groups.set(key, g);
    }
    return json({
      courses,
      groups: [...groups.values()].map((g) => ({ ...g, teachers: g.teachers.size })),
      totals: {
        courses: courses.length,
        active: courses.filter((c) => !c.archived_at).length,
        teachers: new Set(courses.map((c) => c.owner)).size,
        students: courses.reduce((n, c) => n + c.students, 0),
        bytes: storage[0].bytes,
        files: storage[0].files,
      },
    });
  },

  'GET /api/storage/orphans': async ({ db, user }) => {
    requireAdmin(user);
    const before = new Date(Date.now() - ORPHAN_DAYS * DAY).toISOString();
    const files = await all(db, `${ORPHANS} ORDER BY f.size DESC LIMIT ${CLEANUP_BATCH}`, before);
    return json({ files, bytes: files.reduce((n, f) => n + f.size, 0), days: ORPHAN_DAYS, confirmation: CLEANUP_CONFIRMATION });
  },

  // Borra los huérfanos: vuelve a comprobarlos en la misma consulta que los elimina, y en R2 solo borra
  // los objetos que ya ninguna fila usa (una copia de curso puede seguir apuntando al mismo objeto).
  'POST /api/storage/cleanup': async ({ db, env, user, request }) => {
    requireAdmin(user);
    const body = await readJson(request);
    if (body.confirm !== CLEANUP_CONFIRMATION) fail(`Escribe ${CLEANUP_CONFIRMATION} para confirmar.`);
    const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string').slice(0, CLEANUP_BATCH) : [];
    if (!ids.length) fail('No hay archivos seleccionados.');
    const before = new Date(Date.now() - ORPHAN_DAYS * DAY).toISOString();
    const deleted = await all(
      db,
      `DELETE FROM aula_files WHERE id IN (SELECT id FROM (${ORPHANS}) WHERE id IN (SELECT value FROM json_each(?2)))
       RETURNING id, size, coalesce(r2_key, id) AS r2_key`,
      before,
      JSON.stringify(ids),
    );
    const keys = [...new Set(deleted.map((f) => f.r2_key))];
    let removed = [];
    if (keys.length) {
      const inUse = new Set(
        (
          await all(
            db,
            'SELECT DISTINCT coalesce(r2_key, id) AS k FROM aula_files WHERE coalesce(r2_key, id) IN (SELECT value FROM json_each(?))',
            JSON.stringify(keys),
          )
        ).map((r) => r.k),
      );
      removed = keys.filter((k) => !inUse.has(k));
      if (removed.length) await env.BUCKET.delete(removed);
    }
    console.log('aula-api limpieza de archivos', user.email, deleted.length, removed.length);
    return json({ deleted: deleted.length, objects: removed.length, bytes: deleted.reduce((n, f) => n + f.size, 0) });
  },
};
