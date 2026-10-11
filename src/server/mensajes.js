// Mensajes directos (12.70): una conversación por alumno y curso entre el alumno y quienes enseñan en él.
// El docente escribe a uno, a varios o a todo un grupo (un mensaje en la conversación de cada uno); el alumno solo
// escribe en la suya. Los mensajes nuevos llegan a la campana (dashboard.js) y al resumen por correo (digest.js).
import { access } from './access.js';
import { all, fail, json, nowIso, one, readJson, run, text } from './http.js';
import { courseUrl, flushPush, pushToMembers, pushToTeachers } from './push.js';

const MAX_RECIPIENTS = 1000;
const MAX_BODY = 4000;
const PAGE = 200;
const STUDENT_PER_HOUR = 30;

/** La inscripción de alumno de la persona en el curso (el alumno solo ve y escribe en la suya). */
async function ownMember(db, course, user) {
  const m = await one(db, "SELECT id, name FROM aula_members WHERE course=? AND user_id=? AND role='student'", course, user.id);
  if (!m) fail('Los mensajes son entre los alumnos inscritos y sus docentes.', 403);
  return m;
}

/** Marca la conversación como leída por un lado ('student_read_at' o 'teacher_read_at'). */
const markRead = (db, course, member, column) =>
  run(
    db,
    `INSERT INTO aula_message_threads (member, course, ${column}) VALUES (?,?,?)
     ON CONFLICT(member) DO UPDATE SET ${column}=excluded.${column}`,
    member,
    course,
    nowIso(),
  );

export const messageRoutes = {
  /** Docente: conversaciones del curso con su último mensaje y cuántos del alumno no ha leído el equipo docente. */
  async 'GET /api/messages'({ db, user, url }) {
    const a = await access(db, user, url.searchParams.get('course'));
    if (!a.teach) {
      const m = await ownMember(db, a.course.id, user);
      const row = await one(
        db,
        `SELECT count(*) AS unread FROM aula_messages g LEFT JOIN aula_message_threads t ON t.member=g.member
         WHERE g.member=? AND g.from_teacher=1 AND g.created>coalesce(t.student_read_at,'')`,
        m.id,
      );
      return json({ unread: row?.unread || 0 });
    }
    const threads = await all(
      db,
      `SELECT g.member, mem.name, mem.section, max(g.created) AS last_at,
         sum(CASE WHEN g.from_teacher=0 AND g.created>coalesce(t.teacher_read_at,'') THEN 1 ELSE 0 END) AS unread,
         (SELECT x.body FROM aula_messages x WHERE x.member=g.member ORDER BY x.created DESC LIMIT 1) AS last_body,
         (SELECT x.from_teacher FROM aula_messages x WHERE x.member=g.member ORDER BY x.created DESC LIMIT 1) AS last_from_teacher
       FROM aula_messages g
       JOIN aula_members mem ON mem.id=g.member AND mem.role='student'
       LEFT JOIN aula_message_threads t ON t.member=g.member
       WHERE g.course=?
       GROUP BY g.member ORDER BY last_at DESC`,
      a.course.id,
    );
    return json({ threads: threads.map((t) => ({ ...t, last_body: String(t.last_body || '').slice(0, 160) })) });
  },

  /** Una conversación (la del alumno, o la que elija el docente) y la marca como leída por ese lado. */
  async 'GET /api/messages/thread'({ db, user, url }) {
    const a = await access(db, user, url.searchParams.get('course'));
    const member = a.teach
      ? await one(db, "SELECT id, name FROM aula_members WHERE id=? AND course=? AND role='student'", String(url.searchParams.get('member') || ''), a.course.id)
      : await ownMember(db, a.course.id, user);
    if (!member) fail('Alumno no encontrado en este curso.', 404);
    const rows = await all(
      db,
      `SELECT * FROM (SELECT id, from_teacher, author_name, body, created FROM aula_messages WHERE member=? ORDER BY created DESC LIMIT ${PAGE})
       ORDER BY created`,
      member.id,
    );
    await markRead(db, a.course.id, member.id, a.teach ? 'teacher_read_at' : 'student_read_at');
    return json({ member: { id: member.id, name: member.name }, messages: rows });
  },

  async 'POST /api/messages'(ctx) {
    const { db, user, request } = ctx;
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    const message = text(body.body, MAX_BODY);
    const now = nowIso();
    if (!a.teach) {
      const m = await ownMember(db, a.course.id, user);
      const recent = await one(
        db,
        'SELECT count(*) AS n FROM aula_messages WHERE member=? AND from_teacher=0 AND created>?',
        m.id,
        new Date(Date.now() - 3_600_000).toISOString(),
      );
      if (recent.n >= STUDENT_PER_HOUR) fail('Enviaste muchos mensajes en poco tiempo. Espera un rato antes de escribir de nuevo.', 429);
      const [, , pushed] = await db.batch([
        db
          .prepare('INSERT INTO aula_messages (id, course, member, from_teacher, author, author_name, body, created) VALUES (?,?,?,0,?,?,?,?)')
          .bind(crypto.randomUUID(), a.course.id, m.id, user.id, m.name, message, now),
        db
          .prepare(
            `INSERT INTO aula_message_threads (member, course, student_read_at) VALUES (?,?,?)
             ON CONFLICT(member) DO UPDATE SET student_read_at=excluded.student_read_at`,
          )
          .bind(m.id, a.course.id, now),
        // Notificación (12.72) a quienes enseñan: quién escribió, sin el contenido.
        pushToTeachers(db, a.course.id, { title: `Mensaje de ${m.name}`, body: a.course.name, url: courseUrl(a.course.id, 'messages', m.id), tag: `mensaje:${m.id}` }, user.id),
      ]);
      await flushPush(ctx, pushed);
      return json({ sent: 1 }, 201);
    }
    const ids = Array.isArray(body.members) ? [...new Set(body.members.map(String))] : [];
    if (!ids.length) fail('Elige al menos un alumno.');
    if (ids.length > MAX_RECIPIENTS) fail(`Elige como máximo ${MAX_RECIPIENTS} alumnos a la vez.`);
    // Un mensaje en la conversación de cada alumno elegido (solo alumnos de este curso), en una sola instrucción.
    const result = await run(
      db,
      `INSERT INTO aula_messages (id, course, member, from_teacher, author, author_name, body, created)
       SELECT lower(hex(randomblob(16))), m.course, m.id, 1, ?, ?, ?, ? FROM aula_members m
       WHERE m.course=? AND m.role='student' AND m.id IN (SELECT value FROM json_each(?))`,
      user.id,
      String(user.name || 'Docente').slice(0, 150),
      message,
      now,
      a.course.id,
      JSON.stringify(ids),
    );
    const sent = result.meta?.changes ?? 0;
    if (!sent) fail('Ninguno de esos alumnos sigue inscrito. Recarga la página.', 404);
    const pushed = await pushToMembers(db, a.course.id, ids, {
      title: `Mensaje de ${String(user.name || 'tu docente').slice(0, 80)}`,
      body: a.course.name,
      url: courseUrl(a.course.id, 'messages'),
      tag: `mensaje:${a.course.id}`,
    })
      .run()
      .catch(() => null); // la notificación nunca impide el mensaje
    await flushPush(ctx, pushed);
    return json({ sent }, 201);
  },
};
