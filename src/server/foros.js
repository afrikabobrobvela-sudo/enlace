// Foros (12.23): hilos con respuestas, publicaciones anónimas (el docente sí ve el nombre), fijar y cerrar hilos,
// seguir un foro o un hilo (avisos en la campana y en el resumen por correo), marcar lo leído y calificar la
// participación con una actividad del libro de calificaciones (aula_tasks.forum).
import { access, requireTeacher } from './access.js';
import { fail, json, nowIso, one, parseJson, readJson, run, text } from './http.js';
import { forSection, isPublished, publishedSql, sectionSql } from './published.js';
import { assertConditions, recordConditionsSql } from './condiciones.js';

const unpack = (row) => (row ? { ...row, data: parseJson(row.data, {}) } : null);

async function record(db, id, course, kind) {
  const r = unpack(await one(db, 'SELECT * FROM aula_records WHERE id=? AND course=? AND kind=? AND deleted_at IS NULL', String(id ?? ''), course, kind));
  if (!r) fail(kind === 'forum' ? 'Foro no encontrado.' : 'Publicación no encontrada.', 404);
  return r;
}

/** Alumno inscrito que publica (con su nombre de la lista del curso) o null si enseña. */
async function enrolledStudent(db, course, user) {
  return one(db, "SELECT id, name, section FROM aula_members WHERE course=? AND user_id=? AND role='student'", course, user.id);
}

/**
 * Datos de una publicación nueva (hilo o respuesta). Valida que el foro esté disponible para el alumno, que no esté
 * cerrado (ni el hilo), que la respuesta sea a un hilo del mismo foro y que el anonimato esté permitido.
 */
export async function postFields(db, a, user, course, input, now = nowIso()) {
  const forum = await record(db, input.forum, course, 'forum');
  const student = a.teach ? null : await enrolledStudent(db, course, user);
  if (!a.teach && (!isPublished(forum, now) || !forSection(forum.data.sections, student?.section || ''))) fail('Foro no disponible.', 403);
  if (!a.teach) await assertConditions(db, forum.data.conditions, student?.id, 'Foro no disponible.');
  if (!a.teach && forum.data.locked) fail('Este foro está cerrado: ya no recibe publicaciones.', 409);
  let parent = null;
  if (input.parent) {
    parent = await record(db, input.parent, course, 'post');
    if (parent.data.forum !== forum.id || parent.data.parent) fail('Solo se puede responder a un hilo de este foro.');
    if (!a.teach && parent.data.locked) fail('Este hilo está cerrado: ya no recibe respuestas.', 409);
  }
  if (input.anonymous === true && (a.teach || !forum.data.anonymous)) fail('Este foro no permite publicar como anónimo.');
  const title = parent ? String(input.title ?? '').trim().slice(0, 200) || `Re: ${parent.data.title}`.slice(0, 200) : text(input.title, 200);
  return {
    forum: forum.id,
    title,
    body: text(input.body, 15000),
    // Un alumno publica con su nombre de la lista del curso, no con el de su cuenta.
    name: student?.name || user.name,
    ...(parent ? { parent: parent.id } : {}),
    ...(input.anonymous === true ? { anonymous: true } : {}),
  };
}

/**
 * Publicaciones de foros que le interesan a `uid` (?1 en la consulta): de un foro o hilo que sigue, o respuestas a un
 * hilo que abrió él. `place` debe tener course, section, member y teach (1 si enseña en el curso); `p` es la publicación.
 * El alumno solo recibe lo de foros publicados para su sección (y, si el foro pide publicar primero, cuando ya
 * publicó).
 */
export function forumActivitySql(uid, place, nowParam) {
  const root = `coalesce(json_extract(p.data,'$.parent'), p.id)`;
  return `p.kind='post' AND p.deleted_at IS NULL AND p.author<>${uid}
    AND (json_extract(p.data,'$.parent') IS NULL OR EXISTS (SELECT 1 FROM aula_records pr WHERE pr.id=json_extract(p.data,'$.parent') AND pr.deleted_at IS NULL))
    AND (${place}.teach=1 OR (${publishedSql('f', nowParam)} AND ${sectionSql("json_extract(f.data,'$.sections')", `${place}.section`, 'fs')}
      AND ${recordConditionsSql('f', `${place}.member`, 'cf')}
      AND (coalesce(json_extract(f.data,'$.mustPost'),0)=0 OR EXISTS (SELECT 1 FROM aula_records o WHERE o.course=p.course AND o.kind='post'
        AND o.deleted_at IS NULL AND o.author=${uid} AND json_extract(o.data,'$.forum')=f.id))))
    AND (EXISTS (SELECT 1 FROM aula_forum_state st WHERE st.user_id=${uid} AND st.follow=1 AND st.item IN (f.id, ${root}))
      OR EXISTS (SELECT 1 FROM aula_records mine WHERE mine.id=json_extract(p.data,'$.parent') AND mine.author=${uid}))`;
}

/** Título del hilo al que pertenece la publicación `p`. */
export const threadTitleSql = `coalesce((SELECT json_extract(tr.data,'$.title') FROM aula_records tr WHERE tr.id=json_extract(p.data,'$.parent')), json_extract(p.data,'$.title'))`;

/** Lo que un alumno ve de las publicaciones de un foro: anónimas sin nombre y, si el foro lo pide, solo tras publicar. */
export function studentPosts(records, forums, me) {
  const posted = new Set(records.filter((r) => r.kind === 'post' && me && r.author === me).map((r) => r.data.forum));
  return records
    .filter((r) => r.kind !== 'post' || r.author === me || !forums.get(r.data.forum)?.data.mustPost || posted.has(r.data.forum))
    .map((r) => (r.kind === 'post' && r.data.anonymous && r.author !== me ? { ...r, author: 'anonimo', data: { ...r.data, name: 'Anónimo' } } : r));
}

export const forumRoutes = {
  // Fijar (arriba de la lista) o cerrar un hilo (sin respuestas nuevas de alumnos). Solo quien enseña.
  'POST /api/forum/thread': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const post = await record(db, body.id, body.course, 'post');
    if (post.data.parent) fail('Solo se fijan o cierran hilos, no respuestas.');
    for (const key of ['pinned', 'locked']) if (body[key] !== undefined && typeof body[key] !== 'boolean') fail('Valor no válido.');
    const data = { ...post.data };
    for (const key of ['pinned', 'locked']) {
      if (body[key] === true) data[key] = true;
      if (body[key] === false) delete data[key];
    }
    await run(db, 'UPDATE aula_records SET data=?, revision=revision+1 WHERE id=?', JSON.stringify(data), post.id);
    return json({ id: post.id, pinned: data.pinned === true, locked: data.locked === true });
  },

  // Seguir (o dejar de seguir) un foro o un hilo: sus publicaciones nuevas llegan a la campana y al resumen.
  'POST /api/forum/follow': async ({ db, user, request }) => {
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    if (typeof body.follow !== 'boolean') fail('Indica si quieres seguirlo.');
    const item = unpack(await one(db, "SELECT * FROM aula_records WHERE id=? AND course=? AND kind IN ('forum','post') AND deleted_at IS NULL", String(body.item ?? ''), body.course));
    if (!item || (item.kind === 'post' && item.data.parent)) fail('Foro o hilo no encontrado.', 404);
    if (!a.teach) {
      const forum = item.kind === 'forum' ? item : await record(db, item.data.forum, body.course, 'forum');
      const student = await enrolledStudent(db, body.course, user);
      if (!student || !isPublished(forum) || !forSection(forum.data.sections, student.section)) fail('Foro no disponible.', 403);
      await assertConditions(db, forum.data.conditions, student.id, 'Foro no disponible.');
    }
    await run(
      db,
      `INSERT INTO aula_forum_state (user_id,course,item,follow,read_at) VALUES (?1,?2,?3,?4,'')
       ON CONFLICT(user_id,item) DO UPDATE SET follow=excluded.follow`,
      user.id,
      body.course,
      item.id,
      body.follow ? 1 : 0,
    );
    return json({ item: item.id, follow: body.follow });
  },

  // Marca como leído un hilo o un foro (al abrirlo). Una escritura; sin cambios si se leyó hace menos de un minuto.
  'POST /api/forum/read': async ({ db, user, request }) => {
    const body = await readJson(request);
    await access(db, user, body.course);
    const item = await one(db, "SELECT id FROM aula_records WHERE id=? AND course=? AND kind IN ('forum','post') AND deleted_at IS NULL", String(body.item ?? ''), body.course);
    if (!item) fail('Foro o hilo no encontrado.', 404);
    const now = nowIso();
    await run(
      db,
      `INSERT INTO aula_forum_state (user_id,course,item,follow,read_at) VALUES (?1,?2,?3,0,?4)
       ON CONFLICT(user_id,item) DO UPDATE SET read_at=excluded.read_at
       WHERE aula_forum_state.read_at < strftime('%Y-%m-%dT%H:%M:%fZ', excluded.read_at, '-1 minute')`,
      user.id,
      body.course,
      item.id,
      now,
    );
    return json({ item: item.id, readAt: now });
  },

  // Calificar la participación: crea (o devuelve) la actividad del libro de calificaciones ligada al foro. Los
  // alumnos no entregan nada en ella; el docente pone la calificación desde el foro (o desde Calificaciones).
  'POST /api/forum/grading': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const forum = await record(db, body.forum, body.course, 'forum');
    const existing = await one(db, 'SELECT id FROM aula_tasks WHERE course=? AND forum=? AND deleted_at IS NULL', body.course, forum.id);
    if (existing) return json({ task: existing.id, created: false });
    const id = crypto.randomUUID();
    const now = nowIso();
    const sections = forum.data.sections?.length ? JSON.stringify(forum.data.sections) : '';
    await run(
      db,
      `INSERT INTO aula_tasks (id,course,author,title,body,visible,submission_mode,max_files,extensions,file_ids,allow_resubmit,due,start_at,end_at,
         sections,forum,revision,created,updated)
       VALUES (?1,?2,?3,?4,?5,?6,'text',1,'[]','[]',0,'','','',?7,?8,1,?9,?9)`,
      id,
      body.course,
      user.id,
      `Participación: ${forum.data.title}`.slice(0, 200),
      `Se califica tu participación en el foro «${forum.data.title}». No hay nada que entregar aquí: participa en el foro.`,
      forum.data.visible === false ? 0 : 1,
      sections,
      forum.id,
      now,
    );
    return json({ task: id, created: true }, 201);
  },
};
