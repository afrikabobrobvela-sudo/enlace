// "Mis pendientes", avisos dentro de Enlace y comprobantes de entrega.
// Los avisos no se guardan uno por alumno: se calculan de lo publicado después de su última revisión,
// así no se gastan escrituras de D1 (100 000 al día en el plan gratuito).
import { access } from './access.js';
import { base64url, fail, json, nowIso, one, all, run } from './http.js';

const DAY = 86_400_000;
const WINDOW_DAYS = 14;

/** Cursos activos (no archivados ni retirados) en los que la persona es alumna. */
const STUDENT_COURSES = `SELECT m.id AS member, m.course FROM aula_members m JOIN aula_courses c ON c.id=m.course
  WHERE m.user_id=?1 AND m.role='student' AND c.archived_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)`;
/** Cursos activos en los que la persona enseña (propietaria o co-docente). */
const TEACHER_COURSES = `SELECT c.id AS course FROM aula_courses c
  WHERE c.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)
    AND (c.owner=?1 OR EXISTS (SELECT 1 FROM aula_members t WHERE t.course=c.id AND t.user_id=?1 AND t.role='teacher'))`;

async function receiptFolio(env, submission) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(env.SESSION_SECRET)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`recibo|${submission.id}|${submission.submitted}|${submission.body}|${submission.file_ids}`),
  );
  const code = base64url(digest).replace(/[-_]/g, '').toUpperCase().slice(0, 12);
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

export const dashboardRoutes = {
  // Lo que vence pronto (con prórrogas), calificaciones recientes y, para docentes, entregas por calificar.
  'GET /api/dashboard': async ({ db, user }) => {
    const now = new Date();
    const from = new Date(now - 7 * DAY).toISOString();
    const to = new Date(+now + WINDOW_DAYS * DAY).toISOString();
    const teaching = user.role === 'teacher' || user.role === 'admin';
    const [pending, grades, toGrade] = await Promise.all([
      all(
        db,
        `WITH mine AS (${STUDENT_COURSES})
         SELECT t.id, t.title, t.course, c.name AS course_name, coalesce(e.due, t.due) AS due,
                CASE WHEN e.due IS NOT NULL THEN 1 ELSE 0 END AS extended
         FROM mine JOIN aula_tasks t ON t.course=mine.course AND t.visible=1 AND t.deleted_at IS NULL
         JOIN aula_courses c ON c.id=t.course
         LEFT JOIN aula_extensions e ON e.task=t.id AND e.member=mine.member
         WHERE coalesce(e.due, t.due) BETWEEN ?2 AND ?3 AND (t.start_at='' OR t.start_at<=?4)
           AND NOT EXISTS (SELECT 1 FROM aula_submissions s WHERE s.task=t.id AND s.member=mine.member AND (s.submitted!='' OR s.grade IS NOT NULL))
         ORDER BY due LIMIT 30`,
        user.id,
        from,
        to,
        now.toISOString(),
      ),
      all(
        db,
        `WITH mine AS (${STUDENT_COURSES})
         SELECT t.id, t.title, t.course, c.name AS course_name, s.grade, s.graded_at
         FROM mine JOIN aula_submissions s ON s.member=mine.member AND s.published=1 AND s.grade IS NOT NULL AND s.graded_at>?2
         JOIN aula_tasks t ON t.id=s.task AND t.deleted_at IS NULL JOIN aula_courses c ON c.id=s.course
         ORDER BY s.graded_at DESC LIMIT 10`,
        user.id,
        new Date(now - WINDOW_DAYS * DAY).toISOString(),
      ),
      teaching
        ? all(
            db,
            `WITH mine AS (${TEACHER_COURSES})
             SELECT c.id AS course, c.name AS course_name, count(*) AS count
             FROM mine JOIN aula_submissions s ON s.course=mine.course AND s.submitted!='' AND s.grade IS NULL
             JOIN aula_tasks t ON t.id=s.task AND t.deleted_at IS NULL JOIN aula_courses c ON c.id=mine.course
             GROUP BY c.id ORDER BY count DESC LIMIT 20`,
            user.id,
          )
        : [],
    ]);
    return json({ pending: pending.map((p) => ({ ...p, overdue: p.due < now.toISOString(), extended: p.extended === 1 })), grades, toGrade });
  },

  // Avisos de los últimos 14 días; los posteriores a la última revisión cuentan como nuevos.
  'GET /api/notifications': async ({ db, user }) => {
    const since = new Date(Date.now() - WINDOW_DAYS * DAY).toISOString();
    const seen = user.notices_seen_at || '';
    // D1 admite como máximo 5 términos en un SELECT compuesto (UNION): se hacen dos consultas de 3 y se juntan aquí.
    const ctes = `WITH mine AS (${STUDENT_COURSES}), teach AS (${TEACHER_COURSES})`;
    const [content, activity] = await Promise.all([
      all(
        db,
        `${ctes}
         SELECT 'notice' AS type, r.id, r.course, c.name AS course_name, json_extract(r.data,'$.title') AS title, r.updated AS at
           FROM mine JOIN aula_records r ON r.course=mine.course AND r.kind='notice' AND r.deleted_at IS NULL
             AND json_type(r.data,'$.visible') IS NOT 'false' JOIN aula_courses c ON c.id=r.course WHERE r.updated>?2
         UNION ALL
         SELECT 'material', r.id, r.course, c.name, json_extract(r.data,'$.title'), r.updated
           FROM mine JOIN aula_records r ON r.course=mine.course AND r.kind='material' AND r.deleted_at IS NULL
             AND json_type(r.data,'$.visible') IS NOT 'false' JOIN aula_courses c ON c.id=r.course
           WHERE r.updated>?2 AND (coalesce(json_extract(r.data,'$.module'),'')='' OR EXISTS (SELECT 1 FROM aula_records p
             WHERE p.id=json_extract(r.data,'$.module') AND p.deleted_at IS NULL AND json_type(p.data,'$.visible') IS NOT 'false'))
         UNION ALL
         SELECT 'quiz', r.id, r.course, c.name, json_extract(r.data,'$.title'), r.updated
           FROM mine JOIN aula_records r ON r.course=mine.course AND r.kind='quiz' AND r.deleted_at IS NULL
             AND json_type(r.data,'$.visible') IS NOT 'false' JOIN aula_courses c ON c.id=r.course WHERE r.updated>?2
         ORDER BY at DESC LIMIT 40`,
        user.id,
        since,
      ),
      all(
        db,
        `${ctes}
         SELECT 'task' AS type, t.id, t.course, c.name AS course_name, t.title, t.updated AS at
           FROM mine JOIN aula_tasks t ON t.course=mine.course AND t.visible=1 AND t.deleted_at IS NULL
           JOIN aula_courses c ON c.id=t.course WHERE t.updated>?2 AND (t.start_at='' OR t.start_at<=?3)
         UNION ALL
         SELECT 'grade', t.id, s.course, c.name, t.title, s.graded_at
           FROM mine JOIN aula_submissions s ON s.member=mine.member AND s.published=1 AND s.grade IS NOT NULL
           JOIN aula_tasks t ON t.id=s.task AND t.deleted_at IS NULL JOIN aula_courses c ON c.id=s.course WHERE s.graded_at>?2
         UNION ALL
         SELECT 'submission', t.id, s.course, c.name, t.title, s.submitted
           FROM teach JOIN aula_submissions s ON s.course=teach.course AND s.submitted>?2 AND s.manual=0
           JOIN aula_tasks t ON t.id=s.task AND t.deleted_at IS NULL JOIN aula_courses c ON c.id=s.course
         ORDER BY at DESC LIMIT 40`,
        user.id,
        since,
        nowIso(),
      ),
    ]);
    const items = [...content, ...activity].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 40);
    // Varias entregas de la misma actividad se agrupan en un solo aviso.
    const grouped = [];
    for (const item of items) {
      const same = item.type === 'submission' && grouped.find((g) => g.type === 'submission' && g.id === item.id);
      if (same) same.count++;
      else grouped.push({ ...item, count: 1, fresh: item.at > seen });
    }
    return json({ items: grouped, unread: grouped.filter((g) => g.fresh).length });
  },

  'POST /api/notifications/seen': async ({ db, user }) => {
    await run(db, 'UPDATE aula_users SET notices_seen_at=? WHERE id=?', nowIso(), user.id);
    return json({ ok: true });
  },

  // Comprobante de una entrega: lo ve quien entregó (o su equipo) y los docentes del curso.
  'GET /api/receipt': async ({ db, env, user, url }) => {
    const course = url.searchParams.get('course');
    const a = await access(db, user, course);
    const s = await one(
      db,
      `SELECT s.*, t.title AS task_title, m.name AS member_name, m.user_id AS member_user FROM aula_submissions s
       JOIN aula_tasks t ON t.id=s.task JOIN aula_members m ON m.id=s.member WHERE s.id=? AND s.course=?`,
      url.searchParams.get('id'),
      course,
    );
    if (!s || !s.submitted) fail('Entrega no encontrada.', 404);
    if (!a.teach && s.member_user !== user.id) fail('No tienes acceso a este comprobante.', 403);
    const fileIds = JSON.parse(s.file_ids || '[]');
    const files = fileIds.length
      ? await all(db, 'SELECT id, name, size FROM aula_files WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(fileIds))
      : [];
    return json({
      folio: await receiptFolio(env, s),
      course: a.course.name,
      group: a.course.group_name,
      task: s.task_title,
      student: s.member_name,
      submitted: s.submitted,
      late: s.late === 1,
      text: s.body ? s.body.length : 0,
      files: files.map((f) => ({ name: f.name, size: f.size })),
    });
  },
};
