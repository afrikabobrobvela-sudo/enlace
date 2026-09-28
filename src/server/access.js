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
 * Vista como alumno (solo lecturas; la interfaz bloquea cualquier escritura mientras está activa):
 * - `?as=student`: quien enseña recibe los datos como un alumno inscrito sin entregas (`viewer` null).
 * - `?as=m:<id de inscripción>`: lo que ve ESE alumno, con sus entregas, calificaciones publicadas, intentos,
 *   prórrogas y asistencia (`member`). Cada consulta queda en el registro (aula_audit).
 * `viewer` es el usuario cuyos archivos y datos se muestran; `attemptUser`, con quién se guardan sus intentos
 * (los alumnos ficticios del curso de ejemplo no tienen cuenta: sus intentos usan `demo:<inscripción>`).
 */
export async function viewAs(db, a, user, url) {
  const as = url.searchParams.get('as') || '';
  if (!a.teach || !as) return { teach: a.teach, preview: false, viewer: user.id, member: null, attemptUser: user.id };
  if (as === 'student') return { teach: false, preview: true, viewer: null, member: null, attemptUser: null };
  const memberId = as.startsWith('m:') ? as.slice(2, 202) : '';
  const member = memberId && (await one(db, "SELECT id, user_id, name FROM aula_members WHERE id=? AND course=? AND role='student'", memberId, a.course.id));
  if (!member) fail('Ese alumno no está inscrito en este curso.', 404);
  return { teach: false, preview: true, viewer: member.user_id, member, attemptUser: member.user_id || `demo:${member.id}` };
}

/** Registra que alguien consultó lo que ve un alumno (una vez cada 30 minutos por alumno y curso). */
export function viewAudit(db, user, course, member) {
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  return db
    .prepare(
      `INSERT INTO aula_audit (id,actor,action,target_user,course,detail,created)
       SELECT ?1,?2,'ver_alumno',?3,?4,?5,?6 WHERE NOT EXISTS (
         SELECT 1 FROM aula_audit WHERE actor=?2 AND action='ver_alumno' AND course=?4 AND detail=?5 AND created>?7)`,
    )
    .bind(crypto.randomUUID(), user.id, member.user_id, course, `Consultó la vista de ${member.name} (${member.id})`, new Date().toISOString(), since)
    .run();
}
