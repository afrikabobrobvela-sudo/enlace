// Directorio de usuarios para la administración: buscar a cualquier persona, ver sus cursos y accesos,
// suspender o reactivar su acceso, transferir un curso a otro docente y consultar el registro de acciones.
//
// - Suspender no borra nada: cierra sus sesiones y le impide entrar hasta que se reactive. Sus cursos,
//   entregas y calificaciones siguen igual.
// - Todo lo delicado queda en aula_audit (quién, qué, a quién y cuándo).
import { access, requireAdmin } from './access.js';
import { all, email as validEmail, fail, json, nowIso, one, optionalText, readJson, run, text } from './http.js';

export const USERS_PAGE = 50;
const ROLE_FILTERS = { student: "u.role='student'", teacher: "u.role='teacher'", admin: "u.role='admin'" };

/** Sentencia para registrar una acción (se agrega al mismo batch que la acción). */
export function auditStatement(db, { actor, action, targetUser = null, course = null, detail = '' }) {
  return db
    .prepare('INSERT INTO aula_audit (id,actor,action,target_user,course,detail,created) VALUES (?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), actor, action, targetUser, course, String(detail).slice(0, 500), nowIso());
}

const isOwnerEmail = (env, address) => address === String(env.AULA_OWNER_EMAIL || '').toLowerCase();

async function loadUser(db, id) {
  const row = await one(db, 'SELECT * FROM aula_users WHERE id=?', text(id, 100));
  if (!row) fail('Usuario no encontrado.', 404);
  return row;
}

export const userRoutes = {
  // Búsqueda por nombre o correo, con filtros de rol y estado. Paginada por nombre (?after=nombre\u0000id).
  'GET /api/users': async ({ db, user, url }) => {
    requireAdmin(user);
    const q = String(url.searchParams.get('q') || '')
      .trim()
      .toLowerCase()
      .slice(0, 100);
    const role = ROLE_FILTERS[url.searchParams.get('role')] || '1';
    const status = url.searchParams.get('status') === 'suspended' ? 'u.suspended_at IS NOT NULL' : '1';
    const [afterName = '', afterId = ''] = String(url.searchParams.get('after') || '').split('\u0000');
    const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const rows = await all(
      db,
      `SELECT u.id, u.email, u.name, u.role, u.suspended_at,
         (SELECT max(i.last_login) FROM aula_identities i WHERE i.user_id=u.id) AS last_login,
         (SELECT count(*) FROM aula_members m WHERE m.user_id=u.id AND m.role='student'
            AND NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=m.course)) AS enrolled,
         (SELECT count(*) FROM aula_courses c WHERE c.owner=u.id
            AND NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)) AS owned
       FROM aula_users u
       WHERE (?1='' OR lower(u.name) LIKE ?2 ESCAPE '\\' OR lower(u.email) LIKE ?2 ESCAPE '\\')
         AND ${role} AND ${status}
         AND (u.name COLLATE NOCASE > ?3 OR (u.name COLLATE NOCASE = ?3 AND u.id > ?4))
       ORDER BY u.name COLLATE NOCASE, u.id LIMIT ${USERS_PAGE + 1}`,
      q,
      like,
      afterName,
      afterId,
    );
    const more = rows.length > USERS_PAGE;
    const users = rows.slice(0, USERS_PAGE);
    const counts = await one(
      db,
      "SELECT count(*) AS total, sum(role='student') AS students, sum(role!='student') AS staff, sum(suspended_at IS NOT NULL) AS suspended FROM aula_users",
    );
    return json({ users, next: more ? `${users.at(-1).name}\u0000${users.at(-1).id}` : null, counts });
  },

  // Ficha de una persona: cuentas vinculadas, sesiones abiertas, cursos que imparte o cursa, y su registro.
  'GET /api/users/detail': async ({ db, env, user, url }) => {
    requireAdmin(user);
    const person = await loadUser(db, url.searchParams.get('id'));
    const [identities, sessions, owned, memberships, log] = await Promise.all([
      all(db, 'SELECT provider, email, created, last_login FROM aula_identities WHERE user_id=? ORDER BY last_login DESC', person.id),
      one(db, 'SELECT count(*) AS n FROM aula_logins WHERE user_id=? AND revoked_at IS NULL AND expires>?', person.id, nowIso()),
      all(
        db,
        `SELECT c.id, c.name, c.group_name, c.period, c.archived_at,
           (SELECT count(*) FROM aula_members m WHERE m.course=c.id AND m.role='student') AS students
         FROM aula_courses c WHERE c.owner=? AND NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)
         ORDER BY c.archived_at IS NOT NULL, c.name`,
        person.id,
      ),
      all(
        db,
        `SELECT m.id AS member, m.role, m.matricula, c.id AS course, c.name, c.group_name, c.period, c.archived_at, o.name AS owner_name
         FROM aula_members m JOIN aula_courses c ON c.id=m.course LEFT JOIN aula_users o ON o.id=c.owner
         WHERE m.user_id=? AND NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)
         ORDER BY m.role='removed', c.name`,
        person.id,
      ),
      all(
        db,
        `SELECT a.action, a.detail, a.created, a.course, c.name AS course_name, x.name AS actor_name, t.name AS target_name,
           a.actor=?1 AS by_person
         FROM aula_audit a LEFT JOIN aula_users x ON x.id=a.actor LEFT JOIN aula_users t ON t.id=a.target_user
           LEFT JOIN aula_courses c ON c.id=a.course
         WHERE a.target_user=?1 OR a.actor=?1 ORDER BY a.created DESC LIMIT 50`,
        person.id,
      ),
    ]);
    const suspendedBy = person.suspended_by ? await one(db, 'SELECT name FROM aula_users WHERE id=?', person.suspended_by) : null;
    return json({
      user: {
        id: person.id,
        email: person.email,
        name: person.name,
        role: person.role,
        principal: isOwnerEmail(env, person.email),
        suspended_at: person.suspended_at,
        suspended_by: suspendedBy?.name || null,
        suspended_reason: person.suspended_reason,
        privacy_accepted_at: person.privacy_accepted_at,
      },
      identities,
      sessions: sessions.n,
      owned,
      memberships,
      log,
    });
  },

  // Suspender: cierra sus sesiones y le impide entrar. No toca cursos, entregas ni calificaciones.
  'POST /api/users/suspend': async ({ db, env, user, request }) => {
    requireAdmin(user);
    const body = await readJson(request);
    const person = await loadUser(db, body.user);
    if (person.id === user.id) fail('No puedes suspender tu propia cuenta.');
    if (isOwnerEmail(env, person.email)) fail('La cuenta principal de administración no se puede suspender.');
    if (person.suspended_at) fail('Esa cuenta ya está suspendida.', 409);
    const reason = text(body.reason, 300);
    const now = nowIso();
    await db.batch([
      db
        .prepare('UPDATE aula_users SET suspended_at=?, suspended_by=?, suspended_reason=?, session_version=session_version+1 WHERE id=?')
        .bind(now, user.id, reason, person.id),
      db.prepare('UPDATE aula_logins SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(now, person.id),
      auditStatement(db, { actor: user.id, action: 'suspender', targetUser: person.id, detail: reason }),
    ]);
    return json({ ok: true });
  },

  'POST /api/users/reactivate': async ({ db, user, request }) => {
    requireAdmin(user);
    const body = await readJson(request);
    const person = await loadUser(db, body.user);
    if (!person.suspended_at) fail('Esa cuenta no está suspendida.', 409);
    await db.batch([
      db.prepare('UPDATE aula_users SET suspended_at=NULL, suspended_by=NULL, suspended_reason=NULL WHERE id=?').bind(person.id),
      auditStatement(db, { actor: user.id, action: 'reactivar', targetUser: person.id, detail: optionalText(body.note, 300) }),
    ]);
    return json({ ok: true });
  },

  // Cambia la persona propietaria de un curso (por ejemplo, cuando otro profesor toma el grupo).
  // Alumnos, contenido, entregas y calificaciones no cambian. Quien lo tenía puede quedarse como co-docente.
  'POST /api/course/transfer': async ({ db, env, user, request }) => {
    requireAdmin(user);
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    if (body.confirm !== a.course.name) fail('Escribe el nombre exacto del curso para confirmar.');
    const address = validEmail(body.email);
    const target = await one(db, 'SELECT * FROM aula_users WHERE email=?', address);
    if (!target) fail('Esa persona todavía no ha entrado a Enlace. Pídele que entre una vez y vuelve a intentarlo.', 404);
    if (!['teacher', 'admin'].includes(target.role)) fail('Solo se puede transferir a un docente. Dale de alta en «Docentes» primero.');
    if (target.suspended_at) fail('Esa cuenta está suspendida.');
    if (target.id === a.course.owner) fail('Esa persona ya es la propietaria del curso.', 409);
    const previous = await one(db, 'SELECT id, email, name, role FROM aula_users WHERE id=?', a.course.owner);
    const statements = [
      db.prepare('UPDATE aula_courses SET owner=? WHERE id=?').bind(target.id, a.course.id),
      // Si la nueva propietaria era co-docente, esa inscripción ya no hace falta.
      db.prepare("UPDATE aula_members SET role='removed' WHERE course=? AND user_id=? AND role='teacher'").bind(a.course.id, target.id),
    ];
    const keep = body.keepPrevious === true && previous && ['teacher', 'admin'].includes(previous.role);
    if (keep) {
      statements.push(
        db
          .prepare(
            `INSERT INTO aula_members (id,course,email,user_id,name,matricula,role) VALUES (?,?,?,?,?,'','teacher')
             ON CONFLICT(course,email) DO UPDATE SET role='teacher', user_id=excluded.user_id`,
          )
          .bind(crypto.randomUUID(), a.course.id, previous.email, previous.id, previous.name),
      );
    }
    statements.push(
      auditStatement(db, {
        actor: user.id,
        action: 'transferir_curso',
        targetUser: target.id,
        course: a.course.id,
        detail: `De ${previous?.name || 'sin propietario'} a ${target.name}${keep ? '; quien lo tenía queda como co-docente' : ''}`,
      }),
    );
    await db.batch(statements);
    return json({ ok: true, owner: target.id, keptPrevious: Boolean(keep) });
  },

  // Registro general (las últimas acciones), para revisar quién consultó o cambió qué.
  'GET /api/audit': async ({ db, user, url }) => {
    requireAdmin(user);
    const action = url.searchParams.get('action');
    const rows = await all(
      db,
      `SELECT a.action, a.detail, a.created, a.course, c.name AS course_name, x.name AS actor_name, t.name AS target_name, a.target_user
       FROM aula_audit a LEFT JOIN aula_users x ON x.id=a.actor LEFT JOIN aula_users t ON t.id=a.target_user
         LEFT JOIN aula_courses c ON c.id=a.course
       WHERE (?1 IS NULL OR a.action=?1) ORDER BY a.created DESC LIMIT 200`,
      ['ver_alumno', 'suspender', 'reactivar', 'transferir_curso'].includes(action) ? action : null,
    );
    return json({ log: rows });
  },
};
