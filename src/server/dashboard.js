// "Mis pendientes", avisos dentro de Enlace y comprobantes de entrega.
// Los avisos no se guardan uno por alumno: se calculan de lo publicado después de su última revisión,
// así no se gastan escrituras de D1 (100 000 al día en el plan gratuito).
import { access } from './access.js';
import { publishedSql, sectionSql, specialRecordSql, specialTaskSql } from './published.js';
import { base64url, fail, json, nowIso, one, all, readJson, run } from './http.js';
import { forumActivitySql, threadTitleSql } from './foros.js';
import { conditionsSql, recordConditionsSql } from './condiciones.js';

const DAY = 86_400_000;
const WINDOW_DAYS = 14;
// Historial de avisos: hasta 60 días (y más elementos) cuando se pide con ?days=60.
const HISTORY_DAYS = 60;
const READ_BATCH = 50;
const CALENDAR_MAX_DAYS = 100;
/** Clave de un aviso: si el elemento se actualiza, cambia la fecha y vuelve a contar como nuevo. */
const noticeKey = (item) => `${item.type}:${item.id}:${item.at}`;

// Lecturas de D1 (12.30): la campana se pide cada 5 minutos en cada pestaña abierta, así que estas consultas parten
// SIEMPRE de los cursos de la persona (pocas filas) con `CROSS JOIN`, que obliga a SQLite a respetar ese orden y a buscar
// por índice en las tablas grandes. Antes recorrían todas las publicaciones, entregas o cursos de la base en cada
// llamada (miles de filas leídas por aviso). `node scripts/medir-consultas.mjs --planes` muestra cómo las resuelve D1.

/** Cursos activos (no archivados ni retirados) en los que la persona es alumna. */
const STUDENT_COURSES = `SELECT m.id AS member, m.course, m.section FROM aula_members m JOIN aula_courses c ON c.id=m.course
  WHERE m.user_id=?1 AND m.role='student' AND c.archived_at IS NULL AND c.student_visible=1
    AND NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)`;
/**
 * Cursos activos en los que la persona enseña (propietaria o co-docente): por índice, sin recorrer todos los cursos.
 * Como en access(), solo mientras siga siendo docente (12.64: a quien se retira ya no le llegan avisos ni clases).
 */
const TEACHER_COURSES = `SELECT c.id AS course FROM aula_courses c
  WHERE (c.owner=?1 OR c.id IN (SELECT t.course FROM aula_members t WHERE t.user_id=?1 AND t.role='teacher'))
    AND EXISTS (SELECT 1 FROM aula_users tu WHERE tu.id=?1 AND tu.role IN ('teacher','admin'))
    AND c.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)`;

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
         SELECT t.id, t.title, t.course, c.name AS course_name, coalesce(nullif(e.due,''), nullif(d.due,''), t.due) AS due,
                CASE WHEN e.task IS NOT NULL THEN 1 ELSE 0 END AS extended
         FROM mine CROSS JOIN aula_tasks t ON t.course=mine.course AND t.deleted_at IS NULL AND t.visible=1
         JOIN aula_courses c ON c.id=t.course
         LEFT JOIN aula_extensions e ON e.task=t.id AND e.member=mine.member
         LEFT JOIN aula_section_dates d ON d.item=t.id AND d.section=mine.section
         WHERE coalesce(nullif(e.due,''), nullif(d.due,''), t.due) BETWEEN ?2 AND ?3
           AND coalesce(nullif(e.start_at,''), nullif(d.start_at,''), t.start_at)<=?4
           AND ${sectionSql('t.sections', 'mine.section')} AND ${specialTaskSql('t', 'mine.member')} AND t.forum IS NULL AND ${conditionsSql('t.conditions', 'mine.member')}
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
         FROM mine CROSS JOIN aula_submissions s ON s.member=mine.member AND s.published=1 AND s.grade IS NOT NULL AND s.graded_at>?2
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
             FROM mine CROSS JOIN aula_submissions s ON s.course=mine.course AND s.submitted!='' AND s.grade IS NULL
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
    // D1 admite como máximo 5 términos en un SELECT compuesto (UNION): se hacen tres consultas y se juntan aquí.
    const ctes = `WITH mine AS (${STUDENT_COURSES}), teach AS (${TEACHER_COURSES})`;
    const [content, activity, forums] = await Promise.all([
      // Noticias, materiales y evaluaciones en una sola pasada (antes se calculaba todo tres veces). Primero el filtro
      // por fecha, que es barato; las condiciones de sección, acceso especial y liberación solo para lo reciente.
      // Con publicación programada, la fecha del aviso es la de publicación (aparece como nuevo en ese momento).
      all(
        db,
        `WITH mine AS (${STUDENT_COURSES})
         SELECT r.kind AS type, r.id, r.course, c.name AS course_name, json_extract(r.data,'$.title') AS title,
                max(r.updated, coalesce(json_extract(r.data,'$.publishAt'),'')) AS at
         FROM mine CROSS JOIN aula_records r ON r.course=mine.course AND r.kind IN ('notice','material','quiz') AND r.deleted_at IS NULL
         JOIN aula_courses c ON c.id=r.course
         WHERE max(r.updated, coalesce(json_extract(r.data,'$.publishAt'),''))>?2
           AND ${publishedSql('r', '?3')} AND ${sectionSql("json_extract(r.data,'$.sections')", 'mine.section')} AND ${specialRecordSql('r', 'mine.member')}
           AND ${recordConditionsSql('r', 'mine.member')}
           AND (r.kind<>'material' OR coalesce(json_extract(r.data,'$.module'),'')='' OR EXISTS (SELECT 1 FROM aula_records p
             WHERE p.id=json_extract(r.data,'$.module') AND p.deleted_at IS NULL AND ${publishedSql('p', '?3')}
               AND ${sectionSql("json_extract(p.data,'$.sections')", 'mine.section', 'sp')} AND ${recordConditionsSql('p', 'mine.member', 'cp')}))
         ORDER BY at DESC LIMIT ${limit}`,
        user.id,
        since,
        nowIso(),
      ),
      all(
        db,
        `${ctes}
         SELECT 'task' AS type, t.id, t.course, c.name AS course_name, t.title, t.updated AS at
           FROM mine CROSS JOIN aula_tasks t ON t.course=mine.course AND t.deleted_at IS NULL AND t.visible=1
           JOIN aula_courses c ON c.id=t.course WHERE t.updated>?2 AND (t.start_at='' OR t.start_at<=?3) AND ${sectionSql('t.sections', 'mine.section')}
             AND ${specialTaskSql('t', 'mine.member')} AND ${conditionsSql('t.conditions', 'mine.member')}
         UNION ALL
         SELECT 'grade', t.id, s.course, c.name, t.title, s.graded_at
           FROM mine CROSS JOIN aula_submissions s ON s.member=mine.member AND s.published=1 AND s.grade IS NOT NULL AND s.graded_at>?2
           JOIN aula_tasks t ON t.id=s.task AND t.deleted_at IS NULL JOIN aula_courses c ON c.id=s.course
         UNION ALL
         SELECT 'submission', t.id, s.course, c.name, t.title, s.submitted
           FROM teach CROSS JOIN aula_submissions s ON s.course=teach.course AND s.manual=0 AND s.submitted>?2
           JOIN aula_tasks t ON t.id=s.task AND t.deleted_at IS NULL JOIN aula_courses c ON c.id=s.course
         ORDER BY at DESC LIMIT ${limit}`,
        user.id,
        since,
        nowIso(),
      ),
      // Foros (12.23): publicaciones nuevas en lo que sigue y respuestas a sus hilos (una por hilo más abajo).
      // Por índice (curso, tipo, sin eliminar, fecha): solo las publicaciones recientes de sus cursos.
      all(
        db,
        `${ctes}, place AS (SELECT course, section, member, 0 AS teach FROM mine UNION ALL SELECT course, '', NULL, 1 FROM teach)
         SELECT 'post' AS type, coalesce(json_extract(p.data,'$.parent'), p.id) AS id, p.course, c.name AS course_name,
                ${threadTitleSql} AS title, p.created AS at, f.id AS forum
         FROM place CROSS JOIN aula_records p ON p.course=place.course AND p.kind='post' AND p.deleted_at IS NULL AND p.created>?2
         JOIN aula_records f ON f.id=json_extract(p.data,'$.forum') AND f.deleted_at IS NULL
         JOIN aula_courses c ON c.id=p.course
         WHERE ${forumActivitySql('?1', 'place', '?3')}
         ORDER BY at DESC LIMIT ${limit}`,
        user.id,
        since,
        nowIso(),
      ),
    ]);
    const reads = new Set((await all(db, 'SELECT item FROM aula_notice_reads WHERE user_id=?', user.id)).map((r) => r.item));
    const items = [...content, ...activity, ...forums].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
    // Varias entregas de la misma actividad (o publicaciones del mismo hilo) se agrupan en un solo aviso.
    const grouped = [];
    for (const item of items) {
      const same = (item.type === 'submission' || item.type === 'post') && grouped.find((g) => g.type === item.type && g.id === item.id);
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
         SELECT t.id, t.title, t.course, coalesce(nullif(e.due,''), nullif(d.due,''), t.due) AS due,
                coalesce(nullif(e.end_at,''), nullif(d.end_at,''), t.end_at) AS end_at,
                e.task IS NOT NULL AS extended, s.submitted, s.grade, s.published, s.late
         FROM mine CROSS JOIN aula_tasks t ON t.course=mine.course AND t.deleted_at IS NULL AND t.visible=1
         LEFT JOIN aula_extensions e ON e.task=t.id AND e.member=mine.member
         LEFT JOIN aula_section_dates d ON d.item=t.id AND d.section=mine.section
         LEFT JOIN aula_submissions s ON s.task=t.id AND s.member=mine.member
         WHERE coalesce(nullif(e.due,''), nullif(d.due,''), t.due) BETWEEN ?2 AND ?3 AND ${sectionSql('t.sections', 'mine.section')}
           AND ${specialTaskSql('t', 'mine.member')} AND ${conditionsSql('t.conditions', 'mine.member')}
           AND coalesce(nullif(e.start_at,''), nullif(d.start_at,''), t.start_at)<=?4 ORDER BY due LIMIT 300`,
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
             FROM teach CROSS JOIN aula_tasks t ON t.course=teach.course AND t.deleted_at IS NULL
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
         FROM (SELECT s.*, 'student' AS role, mine.member FROM mine CROSS JOIN aula_sessions s ON s.course=mine.course
                 AND s.date BETWEEN ?2 AND ?3 AND (s.section='' OR s.section=mine.section)
               UNION ALL
               SELECT s.*, 'teacher', NULL FROM teach CROSS JOIN aula_sessions s ON s.course=teach.course AND s.date BETWEEN ?2 AND ?3) x
         ORDER BY x.date, x.start_time LIMIT 400`,
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
