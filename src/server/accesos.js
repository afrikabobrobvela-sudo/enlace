// Accesos (12.20): cuántas veces inició sesión cada alumno y docente durante el curso y cuántas veces entró al curso.
// - Inicios de sesión: aula_login_log (uno por cada vez que entra con Google, Microsoft o el enlace por correo), contados
//   entre la creación del curso y su archivo (o hoy). Una sesión dura 14 días en cada dispositivo, así que quien no
//   cierra sesión puede tener pocos inicios aunque use Enlace a diario: por eso también se cuentan los ingresos.
// - Ingresos al curso: aula_course_access, una fila por persona y curso. Abrir el curso después de 30 minutos sin
//   actividad cuenta como un ingreso nuevo; la fila se actualiza a lo más cada 5 minutos (pocas escrituras en D1).
import { access, requireTeacher } from './access.js';
import { all, json, nowIso, run } from './http.js';

const NEW_VISIT_AFTER = '+30 minutes';
const TOUCH_EVERY = '+5 minutes';
const iso = (column, offset) => `strftime('%Y-%m-%dT%H:%M:%fZ', ${column}, '${offset}')`;

/** Registra que esta persona abrió el curso (una sola sentencia; no escribe si su último registro tiene < 5 min). */
export async function recordVisit(db, a, user) {
  if (!a.visitor) return;
  await run(
    db,
    `INSERT INTO aula_course_access (course,user_id,visits,first_at,last_at) VALUES (?1,?2,1,?3,?3)
     ON CONFLICT(course,user_id) DO UPDATE SET visits=visits+(excluded.last_at>${iso('last_at', NEW_VISIT_AFTER)}), last_at=excluded.last_at
     WHERE excluded.last_at>${iso('last_at', TOUCH_EVERY)}`,
    a.course.id,
    user.id,
    nowIso(),
  );
}

export const accessRoutes = {
  // Alumnos y docentes del curso con sus inicios de sesión durante el curso y sus ingresos. Solo quien enseña.
  'GET /api/course/access': async ({ db, user, url }) => {
    const a = await access(db, user, url.searchParams.get('id'));
    requireTeacher(a);
    const since = a.course.created;
    const until = a.course.archived_at || nowIso();
    const people = await all(
      db,
      `WITH people AS (
         SELECT m.id AS member, m.user_id, m.name, m.role, m.section FROM aula_members m WHERE m.course=?1 AND m.role IN ('student','teacher')
         UNION ALL
         SELECT NULL, u.id, u.name, 'owner', '' FROM aula_courses c JOIN aula_users u ON u.id=c.owner
         WHERE c.id=?1 AND NOT EXISTS (SELECT 1 FROM aula_members m WHERE m.course=?1 AND m.user_id=c.owner AND m.role='teacher'))
       SELECT p.member, p.user_id, p.name, p.role, p.section,
         (SELECT count(*) FROM aula_login_log l WHERE l.user_id=p.user_id AND l.at>=?2 AND l.at<=?3) AS logins,
         (SELECT max(l.at) FROM aula_login_log l WHERE l.user_id=p.user_id AND l.at<=?3) AS last_login,
         coalesce(v.visits, 0) AS visits, v.first_at, v.last_at
       FROM people p LEFT JOIN aula_course_access v ON v.course=?1 AND v.user_id=p.user_id
       ORDER BY CASE p.role WHEN 'owner' THEN 0 WHEN 'teacher' THEN 1 ELSE 2 END, p.name COLLATE NOCASE`,
      a.course.id,
      since,
      until,
    );
    return json({
      since,
      until: a.course.archived_at || null,
      people: people.map((p) => ({
        member: p.member,
        name: p.name,
        role: p.role === 'student' ? 'student' : 'teacher',
        owner: p.role === 'owner',
        section: p.section || '',
        account: Boolean(p.user_id),
        logins: p.logins,
        lastLogin: p.last_login,
        visits: p.visits,
        firstVisit: p.first_at,
        lastVisit: p.last_at,
      })),
    });
  },
};
