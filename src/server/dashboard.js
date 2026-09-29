// "Mis pendientes", avisos dentro de Enlace y comprobantes de entrega.
// Los avisos no se guardan uno por alumno: se calculan de lo publicado después de su última revisión,
// así no se gastan escrituras de D1 (100 000 al día en el plan gratuito).
import { access } from './access.js';
import { publishedSql } from './published.js';
import { base64url, fail, json, nowIso, one, all, readJson, run } from './http.js';

const DAY = 86_400_000;
const WINDOW_DAYS = 14;
// Historial de avisos: hasta 60 días (y más elementos) cuando se pide con ?days=60.
const HISTORY_DAYS = 60;
const READ_BATCH = 50;
const CALENDAR_MAX_DAYS = 100;
/** Clave de un aviso: si el elemento se actualiza, cambia la fecha y vuelve a contar como nuevo. */
const noticeKey = (item) => `${item.type}:${item.id}:${item.at}`;

/** Cursos activos (no archivados ni retirados) en los que la persona es alumna. */
const STUDENT_COURSES = `SELECT m.id AS member, m.course, m.section FROM aula_members m JOIN aula_courses c ON c.id=m.course
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
         SELECT t.id, t.title, t.course, c.name AS course_name, coalesce(e.due, nullif(d.due,''), t.due) AS due,
                CASE WHEN e.due IS NOT NULL THEN 1 ELSE 0 END AS extended
         FROM mine JOIN aula_tasks t ON t.course=mine.course AND t.visible=1 AND t.deleted_at IS NULL
         JOIN aula_courses c ON c.id=t.course
         LEFT JOIN aula_extensions e ON e.task=t.id AND e.member=mine.member
         LEFT JOIN aula_section_dates d ON d.item=t.id AND d.section=mine.section
         WHERE coalesce(e.due, nullif(d.due,''), t.due) BETWEEN ?2 AND ?3 AND (coalesce(nullif(d.start_at,''), t.start_at)='' OR coalesce(nullif(d.start_at,''), t.start_at)<=?4)
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

  // Avisos de los últimos 14 días (o 60 con ?days=60, para el historial). Un aviso es nuevo si es posterior a
  // «marcar todo como leído» (notices_seen_at) y no se abrió uno por uno (aula_notice_reads).
  'GET /api/notifications': async ({ db, user, url }) => {
    const days = url?.searchParams.get('days') === String(HISTORY_DAYS) ? HISTORY_DAYS : WINDOW_DAYS;
    const limit = days === HISTORY_DAYS ? 150 : 40;
    const since = new Date(Date.now() - days * DAY).toISOString();
    const seen = user.notices_seen_at || '';
    // D1 admite como máximo 5 términos en un SELECT compuesto (UNION): se hacen dos consultas de 3 y se juntan aquí.
    const ctes = `WITH mine AS (${STUDENT_COURSES}), teach AS (${TEACHER_COURSES})`;
    const [content, activity] = await Promise.all([
      // Con publicación programada, la fecha del aviso es la de publicación (aparece como nuevo en ese momento).
      all(
        db,
        `${ctes}, shown AS (
           SELECT r.*, max(r.updated, coalesce(json_extract(r.data,'$.publishAt'),'')) AS at
           FROM mine JOIN aula_records r ON r.course=mine.course AND r.deleted_at IS NULL AND r.kind IN ('notice','material','quiz')
           WHERE ${publishedSql('r', '?3')})
         SELECT 'notice' AS type, r.id, r.course, c.name AS course_name, json_extract(r.data,'$.title') AS title, r.at
           FROM shown r JOIN aula_courses c ON c.id=r.course WHERE r.kind='notice' AND r.at>?2
         UNION ALL
         SELECT 'material', r.id, r.course, c.name, json_extract(r.data,'$.title'), r.at
           FROM shown r JOIN aula_courses c ON c.id=r.course
           WHERE r.kind='material' AND r.at>?2 AND (coalesce(json_extract(r.data,'$.module'),'')='' OR EXISTS (SELECT 1 FROM aula_records p
             WHERE p.id=json_extract(r.data,'$.module') AND p.deleted_at IS NULL AND ${publishedSql('p', '?3')}))
         UNION ALL
         SELECT 'quiz', r.id, r.course, c.name, json_extract(r.data,'$.title'), r.at
           FROM shown r JOIN aula_courses c ON c.id=r.course WHERE r.kind='quiz' AND r.at>?2
         ORDER BY at DESC LIMIT ${limit}`,
        user.id,
        since,
        nowIso(),
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
         ORDER BY at DESC LIMIT ${limit}`,
        user.id,
        since,
        nowIso(),
      ),
    ]);
    const reads = new Set((await all(db, 'SELECT item FROM aula_notice_reads WHERE user_id=?', user.id)).map((r) => r.item));
    const items = [...content, ...activity].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
    // Varias entregas de la misma actividad se agrupan en un solo aviso.
    const grouped = [];
    for (const item of items) {
      const same = item.type === 'submission' && grouped.find((g) => g.type === 'submission' && g.id === item.id);
      if (same) same.count++;
      else {
        const key = noticeKey(item);
        grouped.push({ ...item, key, count: 1, fresh: item.at > seen && !reads.has(key) });
      }
    }
    return json({ items: grouped, unread: grouped.filter((g) => g.fresh).length, days });
  },

  // Marcar todo como leído: basta con la fecha; las marcas individuales ya no hacen falta y se borran.
  'POST /api/notifications/seen': async ({ db, user }) => {
    await db.batch([
      db.prepare('UPDATE aula_users SET notices_seen_at=? WHERE id=?').bind(nowIso(), user.id),
      db.prepare('DELETE FROM aula_notice_reads WHERE user_id=?').bind(user.id),
    ]);
    return json({ ok: true });
  },

  // Marcar avisos como leídos uno por uno (al abrirlos). Una sola escritura para varios.
  'POST /api/notifications/read': async ({ db, user, request }) => {
    const { items } = await readJson(request);
    if (!Array.isArray(items) || !items.length || items.length > READ_BATCH || items.some((k) => typeof k !== 'string' || k.length > 200)) {
      fail(`Envía de 1 a ${READ_BATCH} avisos.`);
    }
    await run(
      db,
      'INSERT OR IGNORE INTO aula_notice_reads (user_id,item,read_at) SELECT ?1, value, ?2 FROM json_each(?3)',
      user.id,
      nowIso(),
      JSON.stringify(items),
    );
    return json({ ok: true });
  },

  // Calendario: actividades y clases de todos los cursos activos de la persona entre ?from y ?to (fechas ISO).
  // Para el alumno, con su prórroga y el estado de su entrega; para quien enseña, también lo oculto (marcado) y
  // cuántas entregas faltan por calificar.
  'GET /api/calendar': async ({ db, user, url }) => {
    const from = new Date(url.searchParams.get('from') || '');
    const to = new Date(url.searchParams.get('to') || '');
    if (Number.isNaN(+from) || Number.isNaN(+to) || to <= from) fail('Indica el periodo del calendario.');
    if (to - from > CALENDAR_MAX_DAYS * DAY) fail(`El calendario muestra como máximo ${CALENDAR_MAX_DAYS} días a la vez.`);
    const now = nowIso();
    const [fromIso, toIso] = [from.toISOString(), to.toISOString()];
    // Las clases guardan la fecha local (AAAA-MM-DD): se amplía un día a cada lado y el navegador acomoda.
    const [fromDay, toDay] = [new Date(+from - DAY).toISOString().slice(0, 10), new Date(+to + DAY).toISOString().slice(0, 10)];
    const teaching = user.role === 'teacher' || user.role === 'admin';
    const [studentTasks, teacherTasks, sessions, courses] = await Promise.all([
      all(
        db,
        `WITH mine AS (${STUDENT_COURSES})
         SELECT t.id, t.title, t.course, coalesce(e.due, nullif(d.due,''), t.due) AS due, coalesce(e.end_at, nullif(d.end_at,''), t.end_at) AS end_at,
                e.due IS NOT NULL AS extended, s.submitted, s.grade, s.published, s.late
         FROM mine JOIN aula_tasks t ON t.course=mine.course AND t.visible=1 AND t.deleted_at IS NULL
         LEFT JOIN aula_extensions e ON e.task=t.id AND e.member=mine.member
         LEFT JOIN aula_section_dates d ON d.item=t.id AND d.section=mine.section
         LEFT JOIN aula_submissions s ON s.task=t.id AND s.member=mine.member
         WHERE coalesce(e.due, nullif(d.due,''), t.due) BETWEEN ?2 AND ?3
           AND (coalesce(nullif(d.start_at,''), t.start_at)='' OR coalesce(nullif(d.start_at,''), t.start_at)<=?4) ORDER BY due LIMIT 300`,
        user.id,
        fromIso,
        toIso,
        now,
      ),
      teaching
        ? all(
            db,
            `WITH teach AS (${TEACHER_COURSES})
             SELECT t.id, t.title, t.course, t.due, t.end_at, t.visible,
               (SELECT count(*) FROM aula_submissions s WHERE s.task=t.id AND s.submitted!='' AND s.manual=0) AS submitted,
               (SELECT count(*) FROM aula_submissions s WHERE s.task=t.id AND s.submitted!='' AND s.grade IS NULL) AS to_grade
             FROM teach JOIN aula_tasks t ON t.course=teach.course AND t.deleted_at IS NULL
             WHERE t.due BETWEEN ?2 AND ?3 ORDER BY t.due LIMIT 300`,
            user.id,
            fromIso,
            toIso,
          )
        : [],
      all(
        db,
        `WITH mine AS (${STUDENT_COURSES}), teach AS (${TEACHER_COURSES})
         SELECT x.id, x.course, x.date, x.start_time, x.topic, x.role,
           (SELECT a.status FROM aula_attendance a WHERE a.session=x.id AND a.member=x.member) AS status
         FROM (SELECT s.*, 'student' AS role, mine.member FROM mine JOIN aula_sessions s ON s.course=mine.course
                 AND (s.section='' OR s.section=mine.section)
               UNION ALL
               SELECT s.*, 'teacher', NULL FROM teach JOIN aula_sessions s ON s.course=teach.course) x
         WHERE x.date BETWEEN ?2 AND ?3 ORDER BY x.date, x.start_time LIMIT 400`,
        user.id,
        fromDay,
        toDay,
      ),
      all(
        db,
        `WITH mine AS (${STUDENT_COURSES}), teach AS (${TEACHER_COURSES})
         SELECT c.id, c.name, c.group_name, 'student' AS role FROM mine JOIN aula_courses c ON c.id=mine.course
         UNION SELECT c.id, c.name, c.group_name, 'teacher' FROM teach JOIN aula_courses c ON c.id=teach.course
         ORDER BY name`,
        user.id,
      ),
    ]);
    const status = (t) => {
      if (t.grade !== null && t.published === 1) return 'graded';
      if (t.submitted) return 'submitted';
      return t.due < now ? 'missing' : 'pending';
    };
    const events = [
      ...studentTasks.map((t) => ({ type: 'task', role: 'student', id: t.id, course: t.course, title: t.title, at: t.due, end: t.end_at || '', extended: t.extended === 1, status: status(t), late: t.late === 1 })),
      ...teacherTasks.map((t) => ({ type: 'task', role: 'teacher', id: t.id, course: t.course, title: t.title, at: t.due, end: t.end_at || '', hidden: t.visible !== 1, submitted: t.submitted, toGrade: t.to_grade })),
      ...sessions.map((s) => ({ type: 'session', role: s.role, id: s.id, course: s.course, title: s.topic || 'Clase', date: s.date, time: s.start_time, attendance: s.status || null })),
    ];
    return json({ events, courses });
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
