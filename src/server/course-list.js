import { ownsCourse } from './access.js';
import { all } from './http.js';

/** Cursos visibles para la interfaz y para clientes de solo lectura.
 * Mantiene una única fuente de verdad para propietario, inscripción, visibilidad y papelera.
 */
export async function listCourses(db, user) {
  const notDeleted = 'NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)';
  const rows =
    user.role === 'admin'
      ? await all(db, `SELECT c.*, 1 AS can_teach FROM aula_courses c WHERE ${notDeleted} ORDER BY c.created DESC`)
      : await all(
          db,
          `SELECT c.*,
             CASE WHEN ?2 AND (c.owner=?1 OR EXISTS (SELECT 1 FROM aula_members t WHERE t.course=c.id AND t.user_id=?1 AND t.role='teacher'))
               THEN 1 ELSE 0 END AS can_teach
           FROM aula_courses c
           WHERE (c.owner=?1 OR c.id IN (SELECT i.course FROM aula_members i WHERE i.user_id=?1))
             AND ((?2 AND (c.owner=?1 OR EXISTS (SELECT 1 FROM aula_members t WHERE t.course=c.id AND t.user_id=?1 AND t.role='teacher')))
                  OR (c.student_visible=1 AND EXISTS (SELECT 1 FROM aula_members m WHERE m.course=c.id AND m.user_id=?1 AND m.role='student')))
             AND ${notDeleted}
           ORDER BY c.created DESC`,
          user.id,
          user.role === 'teacher' ? 1 : 0,
        );
  return rows.map(({ can_teach: canTeach, cover: _cover, ...course }) => ({
    ...course,
    canTeach: canTeach === 1,
    canDelete: user.role === 'admin' || ownsCourse(user, course),
  }));
}
