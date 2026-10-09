// Avisos por correo: resumen diario (tarea programada de Cloudflare, `scheduled` en worker.js), noticia urgente
// enviada por el docente, preferencia de cada persona y panel de la administración. Se calcula con pocas consultas
// para todos a la vez (el plan gratuito permite 50 por ejecución) y respeta secciones, publicación programada y
// visibilidad igual que la campana de avisos.
import { access, requireAdmin, requireTeacher } from './access.js';
import { all, fail, json, nowIso, one, readJson, run } from './http.js';
import { dailyLimit, mailBody, mailConfigured, mailProvider, mailQuota, sendMails } from './mail.js';
import { forSection, isPublished, publishedSql, sectionSql, specialRecordSql, specialTaskSql } from './published.js';
import { forumActivitySql, threadTitleSql } from './foros.js';
import { conditionsSql, recordConditionsSql } from './condiciones.js';

const HOUR = 3_600_000;
const MAX_ITEMS_PER_GROUP = 8;
const when = (iso) => new Date(iso).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' });
const FOOTER = 'Recibes este resumen porque tienes cuenta en Enlace. Para dejar de recibirlo, entra a Enlace → Mi perfil.';

/** Destinatarios, ventana de cada uno (desde su último resumen, máximo 3 días) y sus cursos. */
const RECIPIENTS = `rcpt AS (
    SELECT id AS uid, email, name, max(coalesce(digest_sent_at, ?2), ?3) AS since FROM aula_users
    WHERE email_digest=1 AND suspended_at IS NULL),
  mine AS (
    SELECT r.uid, m.id AS member, m.course, m.section, r.since FROM rcpt r
    JOIN aula_members m ON m.user_id=r.uid AND m.role='student'
    JOIN aula_courses c ON c.id=m.course AND c.archived_at IS NULL AND c.student_visible=1
    WHERE NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id))`;

/** Cursos activos donde enseña cada destinatario (alias `r`): propios o como co-docente, por índice (12.30). */
const TEACHES = (r) => `CROSS JOIN aula_courses c ON (c.owner=${r}.uid OR c.id IN (SELECT t.course FROM aula_members t WHERE t.user_id=${r}.uid AND t.role='teacher'))
         AND EXISTS (SELECT 1 FROM aula_users tu WHERE tu.id=${r}.uid AND tu.role IN ('teacher','admin'))
         AND c.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)`;

/** Arma los mensajes del resumen (uno por persona con algo nuevo). */
export async function digestMessages(db, env, now = new Date()) {
  const nowIsoText = now.toISOString();
  // ?1 ahora, ?2 hace 24 h, ?3 hace 72 h (ventanas); solo la consulta de «vence pronto» usa ?4 (dentro de 24 h).
  const params = [nowIsoText, new Date(+now - 24 * HOUR).toISOString(), new Date(+now - 72 * HOUR).toISOString()];
  const soon = new Date(+now + 24 * HOUR).toISOString();
  const [people, content, tasks, grades, due, toGrade, posts] = await Promise.all([
    all(db, `WITH ${RECIPIENTS} SELECT uid, email, name FROM rcpt`, ...params),
    // Noticias, evaluaciones y materiales publicados (o programados que ya se publicaron) desde su último resumen.
    all(
      db,
      `WITH ${RECIPIENTS}, shown AS (
         SELECT m.uid, m.section, m.member AS cond_member, r.*, c.name AS course_name, max(r.updated, coalesce(json_extract(r.data,'$.publishAt'),'')) AS at, m.since
         FROM mine m JOIN aula_records r ON r.course=m.course AND r.deleted_at IS NULL AND r.kind IN ('notice','quiz','material')
         JOIN aula_courses c ON c.id=r.course
         WHERE ${publishedSql('r', '?1')} AND ${sectionSql("json_extract(r.data,'$.sections')", 'm.section')} AND ${specialRecordSql('r', 'm.member')}
           AND ${recordConditionsSql('r', 'm.member')})
       SELECT uid, kind, course_name, json_extract(data,'$.title') AS title, at FROM shown s
       WHERE at>since AND at<=?1 AND (kind<>'material' OR coalesce(json_extract(data,'$.module'),'')='' OR EXISTS (
         SELECT 1 FROM aula_records p WHERE p.id=json_extract(s.data,'$.module') AND p.deleted_at IS NULL AND ${publishedSql('p', '?1')}
           AND ${sectionSql("json_extract(p.data,'$.sections')", 's.section', 'sp')} AND ${recordConditionsSql('p', 's.cond_member', 'cp')}))
       ORDER BY at LIMIT 20000`,
      ...params,
    ),
    // Actividades que se abrieron (o se crearon ya abiertas) desde su último resumen, con la fecha de su sección.
    all(
      db,
      `WITH ${RECIPIENTS}
       SELECT m.uid, t.id, c.name AS course_name, t.title, coalesce(nullif(e.due,''), nullif(d.due,''), t.due) AS due
       FROM mine m JOIN aula_tasks t ON t.course=m.course AND t.visible=1 AND t.deleted_at IS NULL
       JOIN aula_courses c ON c.id=t.course
       LEFT JOIN aula_extensions e ON e.task=t.id AND e.member=m.member
       LEFT JOIN aula_section_dates d ON d.item=t.id AND d.section=m.section
       WHERE ${sectionSql('t.sections', 'm.section')} AND ${specialTaskSql('t', 'm.member')} AND ${conditionsSql('t.conditions', 'm.member')}
         AND coalesce(nullif(e.start_at,''), nullif(d.start_at,''), t.start_at, '')<=?1
         AND (t.created>m.since OR coalesce(nullif(e.start_at,''), nullif(d.start_at,''), t.start_at, '')>m.since)
       LIMIT 20000`,
      ...params,
    ),
    // Calificaciones publicadas (o corregidas) desde su último resumen; `updated` cambia también al publicar en bloque.
    all(
      db,
      `WITH ${RECIPIENTS}
       SELECT m.uid, c.name AS course_name, t.title, s.grade FROM mine m
       JOIN aula_submissions s ON s.member=m.member AND s.published=1 AND s.grade IS NOT NULL AND s.updated>m.since
       JOIN aula_tasks t ON t.id=s.task AND t.deleted_at IS NULL JOIN aula_courses c ON c.id=s.course
       LIMIT 20000`,
      ...params,
    ),
    // Vence en las próximas 24 horas y no ha entregado (una sola vez).
    all(
      db,
      `WITH ${RECIPIENTS}
       SELECT m.uid, t.id, c.name AS course_name, t.title, coalesce(nullif(e.due,''), nullif(d.due,''), t.due) AS due
       FROM mine m JOIN aula_tasks t ON t.course=m.course AND t.visible=1 AND t.deleted_at IS NULL
       JOIN aula_courses c ON c.id=t.course
       LEFT JOIN aula_extensions e ON e.task=t.id AND e.member=m.member
       LEFT JOIN aula_section_dates d ON d.item=t.id AND d.section=m.section
       WHERE ${sectionSql('t.sections', 'm.section')} AND ${specialTaskSql('t', 'm.member')} AND t.forum IS NULL AND ${conditionsSql('t.conditions', 'm.member')}
         AND coalesce(nullif(e.due,''), nullif(d.due,''), t.due) BETWEEN ?1 AND ?4
         -- Lo que ya se recordó en el resumen anterior (existía y vencía dentro de sus 24 h) no se repite.
         AND (t.created>m.since OR coalesce(nullif(e.due,''), nullif(d.due,''), t.due) > strftime('%Y-%m-%dT%H:%M:%fZ', m.since, '+1 day'))
         AND NOT EXISTS (SELECT 1 FROM aula_submissions s WHERE s.task=t.id AND s.member=m.member AND (s.submitted!='' OR s.grade IS NOT NULL))
       LIMIT 20000`,
      ...params,
      soon,
    ),
    // Docentes: entregas nuevas por calificar en sus cursos (12.30: por índice, sin recorrer todas las entregas).
    all(
      db,
      `WITH ${RECIPIENTS}
       SELECT r.uid, c.name AS course_name, count(*) AS n FROM rcpt r
       ${TEACHES('r')}
       CROSS JOIN aula_submissions s ON s.course=c.id AND s.manual=0 AND s.submitted>r.since AND s.grade IS NULL
       JOIN aula_tasks t ON t.id=s.task AND t.deleted_at IS NULL
       GROUP BY r.uid, c.id LIMIT 5000`,
      ...params,
    ),
    // Foros (12.23): publicaciones nuevas en lo que sigue cada quien y respuestas a sus hilos, por hilo.
    // 12.30: solo las publicaciones recientes de sus cursos, por índice (antes se recorrían todos los registros).
    all(
      db,
      `WITH ${RECIPIENTS}, place AS (
         SELECT uid, course, section, member, 0 AS teach, since FROM mine
         UNION ALL
         SELECT r.uid, c.id, '', NULL, 1, r.since FROM rcpt r ${TEACHES('r')})
       SELECT place.uid, c.name AS course_name, ${threadTitleSql} AS title, count(*) AS n
       FROM place CROSS JOIN aula_records p ON p.course=place.course AND p.kind='post' AND p.deleted_at IS NULL AND p.created>place.since AND p.created<=?1
       JOIN aula_records f ON f.id=json_extract(p.data,'$.forum') AND f.deleted_at IS NULL
       JOIN aula_courses c ON c.id=p.course
       WHERE ${forumActivitySql('place.uid', 'place', '?1')}
       GROUP BY place.uid, coalesce(json_extract(p.data,'$.parent'), p.id) LIMIT 20000`,
      ...params,
    ),
  ]);
  const byUser = new Map();
  const add = (uid, course, line) => {
    if (!byUser.has(uid)) byUser.set(uid, new Map());
    const courses = byUser.get(uid);
    if (!courses.has(course)) courses.set(course, []);
    courses.get(course).push(line);
  };
  const label = { notice: 'Noticia', quiz: 'Evaluación nueva', material: 'Material nuevo' };
  for (const x of due) add(x.uid, x.course_name, `⏰ Vence pronto: «${x.title}» (${when(x.due)})`);
  for (const x of grades) add(x.uid, x.course_name, `Calificación publicada en «${x.title}»: ${x.grade}`);
  // Una actividad nueva que además vence pronto aparece una sola vez (como «vence pronto»).
  const dueSoon = new Set(due.map((x) => x.uid + ':' + x.id));
  for (const x of tasks) if (!dueSoon.has(x.uid + ':' + x.id)) add(x.uid, x.course_name, `Actividad nueva: «${x.title}»${x.due ? ` (vence ${when(x.due)})` : ''}`);
  for (const x of content) add(x.uid, x.course_name, `${label[x.kind]}: «${x.title}»`);
  for (const x of toGrade) add(x.uid, x.course_name, `${x.n} ${x.n === 1 ? 'entrega nueva' : 'entregas nuevas'} por calificar`);
  for (const x of posts) add(x.uid, x.course_name, `Foro: ${x.n === 1 ? 'publicación nueva' : `${x.n} publicaciones nuevas`} en «${x.title}»`);
  const url = env.ENLACE_URL || '';
  const messages = [];
  for (const person of people) {
    const courses = byUser.get(person.uid);
    if (!courses) continue;
    const total = [...courses.values()].reduce((n, lines) => n + lines.length, 0);
    const groups = [...courses].map(([heading, lines]) => ({
      heading,
      lines: lines.length > MAX_ITEMS_PER_GROUP ? [...lines.slice(0, MAX_ITEMS_PER_GROUP), `…y ${lines.length - MAX_ITEMS_PER_GROUP} más en Enlace`] : lines,
    }));
    const body = mailBody({ title: `Hola, ${person.name.split(' ')[0]}. Esto es lo nuevo en Enlace`, groups, url, footer: FOOTER });
    messages.push({ uid: person.uid, to: person.email, subject: `Enlace: ${total} ${total === 1 ? 'aviso nuevo' : 'avisos nuevos'}`, ...body });
  }
  return messages;
}

/** Corre el resumen: envía y avanza la ventana de quienes ya quedaron al día (los que no alcanzaron cupo, mañana). */
export async function runDigest(db, env, now = new Date()) {
  if (!mailConfigured(env)) return { sent: 0, skipped: 0, error: 'El correo de avisos no está configurado.' };
  const messages = await digestMessages(db, env, now);
  const result = await sendMails(db, env, messages);
  const pending = messages.filter((m) => result.skipped.includes(m.to)).map((m) => m.uid);
  await run(
    db,
    'UPDATE aula_users SET digest_sent_at=?1 WHERE email_digest=1 AND suspended_at IS NULL AND id NOT IN (SELECT value FROM json_each(?2))',
    now.toISOString(),
    JSON.stringify(pending),
  );
  console.log('aula-mail resumen', result.sent.length, 'enviados', pending.length, 'pendientes');
  return { sent: result.sent.length, skipped: pending.length, error: result.error };
}

export const digestRoutes = {
  // Recibir (o no) el resumen diario por correo.
  'POST /api/profile/notifications': async ({ db, user, request }) => {
    const body = await readJson(request);
    if (typeof body.digest !== 'boolean') fail('Indica si quieres recibir el resumen.');
    await run(db, 'UPDATE aula_users SET email_digest=? WHERE id=?', body.digest ? 1 : 0, user.id);
    return json({ digest: body.digest });
  },

  /**
   * Noticia urgente: el docente la envía por correo en ese momento a los alumnos a los que va dirigida (su sección),
   * una sola vez. Respeta a quien apagó los correos y el cupo del día.
   */
  'POST /api/notice/email': async ({ db, env, user, request }) => {
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    requireTeacher(a);
    if (!mailConfigured(env)) fail('El correo de avisos todavía no está configurado. Pídelo a la administración.', 409);
    const row = await one(db, "SELECT * FROM aula_records WHERE id=? AND course=? AND kind='notice' AND deleted_at IS NULL", String(body.id ?? ''), body.course);
    if (!row) fail('Noticia no encontrada.', 404);
    const notice = { ...row, data: JSON.parse(row.data) };
    if (!isPublished(notice)) fail('La noticia debe estar visible y publicada para enviarla por correo.', 409);
    if (notice.data.emailedAt) fail(`Esta noticia ya se envió por correo (${when(notice.data.emailedAt)}).`, 409);
    const students = (
      await all(
        db,
        `SELECT u.email, u.name, m.section FROM aula_members m JOIN aula_users u ON u.id=m.user_id
         WHERE m.course=? AND m.role='student' AND u.email_digest=1 AND u.suspended_at IS NULL`,
        body.course,
      )
    ).filter((s) => forSection(notice.data.sections, s.section));
    if (!students.length) fail('No hay alumnos con cuenta que reciban correos en esta noticia.', 409);
    if (students.length > (await mailQuota(db, env))) fail(`Hoy ya no alcanza el cupo de correos para ${students.length} alumnos. Inténtalo mañana.`, 429);
    const plain = String(notice.data.body || '').replace(/\$\$?([^$]*)\$\$?/g, '$1').replace(/[*_#>`]/g, '').slice(0, 4000);
    const messages = students.map((s) => ({
      to: s.email,
      subject: `${a.course.name}: ${notice.data.title}`,
      ...mailBody({ title: notice.data.title, intro: plain, groups: [], url: env.ENLACE_URL || '', footer: `Noticia de ${a.course.name} en Enlace. ${FOOTER}` }),
    }));
    const result = await sendMails(db, env, messages);
    if (result.sent.length) {
      await run(db, "UPDATE aula_records SET data=json_set(data,'$.emailedAt',?) WHERE id=?", nowIso(), row.id);
    }
    return json({ sent: result.sent.length, skipped: result.skipped.length, error: result.error });
  },

  // ---- Administración ----
  'GET /api/mail/status': async ({ db, env, user }) => {
    requireAdmin(user);
    const log = await one(db, 'SELECT * FROM aula_mail_log ORDER BY day DESC LIMIT 1');
    const sentToday = log?.day === new Date().toISOString().slice(0, 10) ? log.sent : 0;
    return json({
      configured: mailConfigured(env),
      provider: mailProvider(env),
      from: mailProvider(env) === 'gmail' ? env.CORREO_AVISOS : mailProvider(env) === 'resend' ? env.EMAIL_FROM : null,
      url: env.ENLACE_URL || null,
      limit: dailyLimit(env),
      sentToday,
      lastRun: log?.last_run || null,
      lastError: log?.last_error || null,
    });
  },

  'POST /api/mail/test': async ({ db, env, user }) => {
    requireAdmin(user);
    if (!mailConfigured(env)) fail('El correo de avisos no está configurado. Ejecuta configurar.cmd (o npm run correo).', 409);
    const result = await sendMails(db, env, [
      {
        to: user.email,
        subject: 'Enlace: correo de prueba',
        ...mailBody({ title: 'El correo de avisos de Enlace funciona', intro: 'Si lees esto, tus alumnos recibirán el resumen diario y las noticias urgentes.', url: env.ENLACE_URL || '' }),
      },
    ]);
    if (!result.sent.length) fail(`No se pudo enviar: ${result.error || 'error desconocido'}`, 502);
    return json({ sent: 1, to: user.email });
  },

  'POST /api/mail/digest': async ({ db, env, user }) => {
    requireAdmin(user);
    if (!mailConfigured(env)) fail('El correo de avisos no está configurado.', 409);
    return json(await runDigest(db, env));
  },
};
