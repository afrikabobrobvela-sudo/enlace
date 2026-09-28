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
  const isOwner = ownsCourse(user, course);
  // Un co-docente solo conserva el acceso mientras siga en la lista de docentes (igual que el propietario).
  const staff = user.role === 'teacher' || isAdmin;
  const coTeacher = memberRole === 'teacher' && staff;
  if (!isAdmin && !isOwner && !coTeacher && (!memberRole || memberRole === 'removed' || memberRole === 'teacher')) {
    fail('No tienes acceso a este curso.', 403);
  }
  return { course, teach: isAdmin || isOwner || coTeacher };
}

export function requireTeacher(access) {
  if (!access.teach) fail('Solo el docente puede realizar esta acción.', 403);
}

export function requireAdmin(user) {
  if (user.role !== 'admin') fail('Solo la administración puede realizar esta acción.', 403);
}

/**
 * Quien creó el curso lo administra solo mientras siga en la lista de docentes:
 * al retirarlo pierde el acceso a sus cursos (se conservan intactos para la administración).
 */
export function ownsCourse(user, course) {
  return course.owner === user.id && (user.role === 'teacher' || user.role === 'admin');
}

/**
 * Vista como alumno: con `?as=student`, quien enseña en el curso recibe los datos exactamente como un alumno
 * inscrito sin entregas (mismos filtros del servidor). Solo aplica a lecturas; `viewer` es null en esa vista.
 */
export function viewAs(a, user, url) {
  const preview = a.teach && url.searchParams.get('as') === 'student';
  return { teach: a.teach && !preview, preview, viewer: preview ? null : user.id };
}
