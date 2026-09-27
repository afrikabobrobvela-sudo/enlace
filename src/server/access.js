// Permisos por curso, compartidos por todos los módulos de la API.
import { fail, one } from './http.js';

/** Una sola consulta: curso, si está retirado y el rol de la persona en él. */
export async function access(db, user, courseId) {
  const row = await one(
    db,
    `SELECT c.*,
       EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id) AS is_deleted,
       (SELECT m.role FROM aula_members m WHERE m.course=c.id AND m.user_id=?) AS member_role
     FROM aula_courses c WHERE c.id=?`,
    user.id,
    String(courseId ?? ''),
  );
  if (!row || row.is_deleted) fail('Curso no encontrado.', 404);
  const { is_deleted: _deleted, member_role: memberRole, ...course } = row;
  const isAdmin = user.role === 'admin';
  const isOwner = course.owner === user.id;
  if (!isAdmin && !isOwner && (!memberRole || memberRole === 'removed')) fail('No tienes acceso a este curso.', 403);
  return { course, teach: isAdmin || isOwner || memberRole === 'teacher' };
}

export function requireTeacher(access) {
  if (!access.teach) fail('Solo el docente puede realizar esta acción.', 403);
}

export function requireAdmin(user) {
  if (user.role !== 'admin') fail('Solo la administración puede realizar esta acción.', 403);
}
