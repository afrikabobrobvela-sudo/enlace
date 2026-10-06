// Importar calificaciones (12.24): de un libro de Excel o CSV (por ejemplo, el que exporta Brightspace) a las
// actividades del curso. Cada columna es una actividad existente o una nueva (se crea); las calificaciones ya vienen
// en escala de 0 a 10 (el navegador las convierte) y se guardan como calificación capturada por el docente, con su
// historial, en un solo batch.
// Por sección (12.30): con `section`, solo se aceptan alumnos de esa sección (nunca se tocan las calificaciones de
// otra), las actividades nuevas son solo para esa sección y una actividad existente dirigida a otras secciones
// también queda para esta (si no, sus alumnos no verían la calificación importada).
import { access, requireTeacher } from './access.js';
import { all, fail, json, nowIso, one, readJson, text } from './http.js';
import { taskSections } from './published.js';
import { validSection } from './sections.js';

const MAX_ACTIVITIES = 60;

/**
 * Fecha de una actividad creada al importar (12.46): el momento de la importación, para que el libro y el calendario
 * muestren cuándo se generó (antes quedaba sin fecha). Las fechas se guardan en ISO como las demás.
 */
const importDue = (iso) => iso;
const MAX_GRADES = 15000;

export const importRoutes = {
  'POST /api/grades/import': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const activities = Array.isArray(body.activities) ? body.activities : [];
    if (!activities.length) fail('No hay calificaciones para importar.');
    if (activities.length > MAX_ACTIVITIES) fail(`Importa como máximo ${MAX_ACTIVITIES} actividades a la vez.`);
    const publish = body.publish === false ? 0 : 1;
    const overwrite = body.overwrite === false ? 0 : 1;
    const section = await validSection(db, body.course, body.section); // '' = todo el curso
    // Actividades existentes del curso (no eliminadas), con sus secciones.
    const existingIds = activities.map((a) => a?.task).filter(Boolean).map(String);
    const existing = new Map(
      existingIds.length
        ? (
            await all(
              db,
              'SELECT id, sections FROM aula_tasks WHERE course=? AND deleted_at IS NULL AND forum IS NULL AND id IN (SELECT value FROM json_each(?))',
              body.course,
              JSON.stringify(existingIds),
            )
          ).map((r) => [r.id, taskSections(r.sections)])
        : [],
    );
    const newTasks = [];
    const widened = [];
    const grades = new Map();
    for (const a of activities) {
      let task = a?.task ? String(a.task) : '';
      if (task && !existing.has(task)) fail('Una de las actividades ya no existe o no admite calificaciones importadas. Recarga la página.', 404);
      if (!task) {
        task = crypto.randomUUID();
        newTasks.push({ id: task, title: text(a?.title, 200), sections: section ? JSON.stringify([section]) : '' });
      } else {
        const sections = existing.get(task);
        if (section && sections.length && !sections.includes(section) && !widened.some((w) => w.id === task))
          widened.push({ id: task, sections: JSON.stringify([...sections, section].sort()) });
      }
      for (const g of Array.isArray(a?.grades) ? a.grades : []) {
        const grade = Number(g?.grade);
        if (!Number.isFinite(grade) || grade < 0 || grade > 10) fail('Cada calificación va de 0 a 10.');
        grades.set(`${task}:${g.member}`, { task, member: String(g?.member ?? ''), grade: Math.round(grade * 100) / 100 });
      }
    }
    if (grades.size > MAX_GRADES) fail(`Importa como máximo ${MAX_GRADES} calificaciones a la vez (divide el archivo).`);
    const rows = [...grades.values()];
    const members = [...new Set(rows.map((r) => r.member))];
    if (members.length) {
      const valid = await one(
        db,
        "SELECT count(*) AS n FROM aula_members WHERE course=?1 AND role='student' AND id IN (SELECT value FROM json_each(?2)) AND (?3='' OR section=?3)",
        body.course,
        JSON.stringify(members),
        section,
      );
      if (valid.n !== members.length)
        fail(section ? 'Hay alumnos que no son de la sección elegida. Recarga la página.' : 'Hay alumnos que no pertenecen a este curso. Recarga la página.');
    }
    const now = nowIso();
    const list = JSON.stringify(rows);
    const statements = [];
    if (newTasks.length) {
      // Actividades nuevas: visibles, con entrega de texto (el docente puede cambiarlas después en el editor).
      statements.push(
        db
          .prepare(
            `INSERT INTO aula_tasks (id,course,author,title,body,visible,submission_mode,max_files,extensions,file_ids,allow_resubmit,due,start_at,end_at,sections,revision,created,updated)
             SELECT json_extract(value,'$.id'), ?1, ?2, json_extract(value,'$.title'), '', 1, 'both', 5, '[]', '[]', 1, ?5, '', '',
                    json_extract(value,'$.sections'), 1, ?3, ?3 FROM json_each(?4)`,
          )
          .bind(body.course, user.id, now, JSON.stringify(newTasks), importDue(now)),
      );
    }
    if (widened.length) {
      // Sube la revisión: quien tenga la actividad abierta en el editor recibirá «recarga» en vez de quitar la sección.
      statements.push(
        db
          .prepare(
            `UPDATE aula_tasks SET sections=(SELECT json_extract(value,'$.sections') FROM json_each(?1) WHERE json_extract(value,'$.id')=aula_tasks.id),
               revision=revision+1, updated=?2
             WHERE course=?3 AND id IN (SELECT json_extract(value,'$.id') FROM json_each(?1))`,
          )
          .bind(JSON.stringify(widened), now, body.course),
      );
    }
    if (rows.length) {
      // Historial primero (con los valores anteriores), solo de lo que cambia.
      statements.push(
        db
          .prepare(
            `INSERT INTO aula_grade_history (id,course,task,member,old_grade,new_grade,old_published,new_published,feedback_changed,reason,changed_by,changed_at)
             SELECT lower(hex(randomblob(16))), ?1, json_extract(j.value,'$.task'), json_extract(j.value,'$.member'), s.grade, json_extract(j.value,'$.grade'),
                    s.published, ?2, 0, 'importación', ?3, ?4
             FROM json_each(?5) j LEFT JOIN aula_submissions s ON s.task=json_extract(j.value,'$.task') AND s.member=json_extract(j.value,'$.member')
             WHERE (s.grade IS NULL OR ?6) AND (s.grade IS NOT json_extract(j.value,'$.grade') OR s.published IS NOT ?2)`,
          )
          .bind(body.course, publish, user.id, now, list, overwrite),
        db
          .prepare(
            `INSERT INTO aula_submissions (id,course,task,member,author,body,file_ids,submitted,late,manual,grade,feedback,published,graded_by,graded_at,revision,created,updated)
             SELECT 'submission:' || json_extract(j.value,'$.task') || ':' || coalesce(m.user_id, m.id), ?1, json_extract(j.value,'$.task'), m.id,
                    coalesce(m.user_id, m.id), '', '[]', '', 0, 1, json_extract(j.value,'$.grade'), '', ?2, ?3, ?4, 1, ?4, ?4
             FROM json_each(?5) j JOIN aula_members m ON m.id=json_extract(j.value,'$.member') AND m.course=?1
             WHERE true
             ON CONFLICT(task,member) DO UPDATE SET grade=excluded.grade, published=excluded.published, graded_by=excluded.graded_by,
               graded_at=excluded.graded_at, revision=aula_submissions.revision+1, updated=excluded.updated
             WHERE (aula_submissions.grade IS NULL OR ?6) AND (aula_submissions.grade IS NOT excluded.grade OR aula_submissions.published IS NOT excluded.published)`,
          )
          .bind(body.course, publish, user.id, now, list, overwrite),
      );
    }
    await db.batch(statements);
    return json({ created: newTasks.length, grades: rows.length, widened: widened.length });
  },
};
