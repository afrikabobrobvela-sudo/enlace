// Alumno de prueba (12.92).
//
// Cada curso puede tener una cuenta de alumno propia, sin correo real, inscrita como cualquier alumno. Quien enseña
// entra con ella desde su cuenta (y vuelve con un botón) o, en otro dispositivo, con un enlace de un solo uso. Así
// contesta evaluaciones y exámenes, entrega actividades y ve todo exactamente como sus alumnos: lo que hace se guarda,
// el examen se bloquea al salir y aparece en el monitor. «Reiniciar» borra lo que hizo para volver a probar.
//
// La cuenta se reconoce por su correo (`prueba-<curso>@alumno-prueba.invalid`, `isTestUser()` en access.js): el
// dominio `.invalid` está reservado y ningún proveedor de acceso lo entrega. No puede unirse a otros cursos, pedir ser
// docente ni recibir correos; tampoco se le pide foto de perfil.
import { access, isTestUser, requireTeacher, TEST_DOMAIN } from './access.js';
import { all, fail, json, nowIso, one, readJson } from './http.js';
import { PRIVACY_VERSION } from './privacy.js';

export { isTestUser, TEST_DOMAIN };

/** Cookie con la sesión de docente que se deja guardada mientras se usa el alumno de prueba en ese navegador. */
export const TEACHER_COOKIE = '__Host-enlace_docente';
export const TEST_NAME = 'Alumno de prueba';
export const TEST_LINK_MINUTES = 10;

const PREFIX = 'prueba-';
export const testEmail = (course) => `${PREFIX}${course}@${TEST_DOMAIN}`;
const testUserId = (course) => PREFIX + course;
/** Curso del alumno de prueba (lo lleva su correo). */
export const testCourseOf = (user) => (isTestUser(user) ? user.email.slice(PREFIX.length, -(TEST_DOMAIN.length + 1)) : null);

/**
 * Crea (o reactiva) la cuenta y su inscripción y la deja en `section` ('' = sin sección; una que no sea del curso
 * también queda en ''). Devuelve la fila de aula_users, que es lo que necesita la sesión.
 */
export async function ensureTestStudent(db, course, section, actor) {
  const userId = testUserId(course.id);
  const email = testEmail(course.id);
  const now = nowIso();
  await db.batch([
    // El aviso de privacidad ya lo aceptó quien enseña con su propia cuenta; la de prueba no envía resúmenes por correo.
    db
      .prepare(
        `INSERT INTO aula_users (id,email,name,role,session_version,privacy_version,privacy_accepted_at,email_digest)
         VALUES (?1,?2,?3,'student',1,?4,?5,0)
         ON CONFLICT(id) DO UPDATE SET privacy_version=?4, privacy_accepted_at=coalesce(aula_users.privacy_accepted_at, ?5), email_digest=0`,
      )
      .bind(userId, email, TEST_NAME, PRIVACY_VERSION, now),
    // Nunca toca una fila de docente (alguien podría haber escrito ese correo como co-docente).
    db
      .prepare(
        `INSERT INTO aula_members (id,course,email,user_id,name,matricula,role,section)
         VALUES (?1,?2,?3,?4,?5,'','student',coalesce((SELECT id FROM aula_sections WHERE id=?6 AND course=?2), ''))
         ON CONFLICT(course,email) DO UPDATE SET user_id=excluded.user_id, role='student', section=excluded.section
         WHERE aula_members.role<>'teacher'`,
      )
      .bind(crypto.randomUUID(), course.id, email, userId, TEST_NAME, String(section ?? '')),
    db
      .prepare('INSERT INTO aula_audit (id,actor,action,target_user,course,detail,created) VALUES (?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), actor.id, 'alumno_prueba', userId, course.id, 'Entró como alumno de prueba', now),
  ]);
  const user = await one(db, 'SELECT * FROM aula_users WHERE id=?', userId);
  if (!user || !isTestUser(user)) fail('No se pudo preparar el alumno de prueba.', 409);
  if (user.suspended_at) fail('La administración suspendió el alumno de prueba de este curso.', 403);
  return user;
}

const STATE_SQL = `SELECT m.id, m.role, m.section,
    (SELECT count(*) FROM aula_attempts a WHERE a.course=?1 AND a.user_id=?2) AS attempts,
    (SELECT count(*) FROM aula_attempt_starts s JOIN aula_records r ON r.id=s.quiz AND r.course=?1
       WHERE s.user_id=?2 AND NOT EXISTS (SELECT 1 FROM aula_attempts a WHERE a.quiz=s.quiz AND a.user_id=s.user_id AND a.attempt=s.attempt)) AS running,
    (SELECT count(*) FROM aula_submissions b WHERE b.course=?1 AND b.member=m.id AND b.submitted<>'') AS submissions
  FROM aula_members m WHERE m.course=?1 AND m.email=?3`;

/**
 * Borra lo que hizo el alumno de prueba en el curso (intentos, entregas y su historial, asistencia, seguimiento,
 * mensajes, constancia y publicaciones en foros, estas a la papelera). No toca accesos especiales ni prórrogas: los
 * pone quien enseña y sirven para probar evaluaciones restringidas. Con `remove`, además lo da de baja y cierra sus
 * sesiones (deja de aparecer en listas y en el libro).
 */
async function resetTestStudent(db, courseId, remove) {
  const member = await one(db, 'SELECT id FROM aula_members WHERE course=? AND email=? AND role IN (?,?)', courseId, testEmail(courseId), 'student', 'removed');
  if (!member) return { attempts: 0, submissions: 0 };
  const userId = testUserId(courseId);
  const now = nowIso();
  const quizzes = "(SELECT id FROM aula_records WHERE course=?1 AND kind='quiz')";
  const statements = [
    db.prepare('DELETE FROM aula_attempts WHERE course=?1 AND user_id=?2').bind(courseId, userId),
    db.prepare(`DELETE FROM aula_attempt_starts WHERE user_id=?2 AND quiz IN ${quizzes}`).bind(courseId, userId),
    db.prepare(`DELETE FROM aula_exam_tries WHERE user_id=?2 AND quiz IN ${quizzes}`).bind(courseId, userId),
    db.prepare('DELETE FROM aula_grade_history WHERE course=?1 AND member=?2').bind(courseId, member.id),
    db.prepare('DELETE FROM aula_submissions WHERE course=?1 AND member=?2').bind(courseId, member.id),
    db.prepare('DELETE FROM aula_progress WHERE course=?1 AND member=?2').bind(courseId, member.id),
    db.prepare('DELETE FROM aula_checkins WHERE member=?').bind(member.id),
    db.prepare('DELETE FROM aula_attendance WHERE member=?').bind(member.id),
    db.prepare('DELETE FROM aula_messages WHERE course=?1 AND member=?2').bind(courseId, member.id),
    db.prepare('DELETE FROM aula_message_threads WHERE member=?').bind(member.id),
    db.prepare('DELETE FROM aula_certificates WHERE course=?1 AND member_id=?2').bind(courseId, member.id),
    db
      .prepare("UPDATE aula_records SET deleted_at=?3 WHERE course=?1 AND kind='post' AND author=?2 AND deleted_at IS NULL")
      .bind(courseId, userId, now),
  ];
  if (remove) {
    statements.push(
      db.prepare("UPDATE aula_members SET role='removed' WHERE id=? AND role='student'").bind(member.id),
      db.prepare('UPDATE aula_logins SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(now, userId),
    );
  }
  const results = await db.batch(statements);
  return { attempts: results[0].meta.changes, submissions: results[4].meta.changes };
}

export const testStudentRoutes = {
  /** Estado del alumno de prueba del curso (para la ventana de quien enseña). */
  async 'GET /api/test-student'({ db, user, url }) {
    const a = await access(db, user, url.searchParams.get('course'));
    requireTeacher(a);
    const row = await one(db, STATE_SQL, a.course.id, testUserId(a.course.id), testEmail(a.course.id));
    const sessions = row
      ? (await all(db, 'SELECT count(*) AS n FROM aula_logins WHERE user_id=? AND revoked_at IS NULL AND expires>?', testUserId(a.course.id), nowIso()))[0].n
      : 0;
    return json({
      enrolled: row?.role === 'student',
      section: row?.role === 'student' ? row.section : '',
      attempts: row?.attempts || 0,
      running: row?.running || 0,
      submissions: row?.submissions || 0,
      sessions,
    });
  },

  /** Borra lo que hizo el alumno de prueba; con `remove`, también lo da de baja del curso. */
  async 'POST /api/test-student/reset'({ db, user, request }) {
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    requireTeacher(a);
    return json({ ok: true, ...(await resetTestStudent(db, a.course.id, body.remove === true)) });
  },
};
