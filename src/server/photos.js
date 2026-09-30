// Foto de perfil: cada persona sube la suya (el navegador la reduce a un cuadrado pequeño). La ven ella misma, la
// administración y quienes comparten un curso con ella cuando una de las dos enseña en él (el docente ve a sus
// alumnos y los alumnos a su docente; los compañeros entre sí, no). Quien enseña puede quitar la foto de un alumno
// de su curso si no es adecuada.
import { access, requireTeacher } from './access.js';
import { SECURITY_HEADERS, fail, json, nowIso, one, readJson, run } from './http.js';

export const MAX_PHOTO_BYTES = 400 * 1024;
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const TYPE_OF_EXTENSION = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const PHOTO_TYPES = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };

/** Tipo real por los primeros bytes (nunca SVG ni HTML, aunque digan ser imagen). */
function photoType(bytes) {
  for (const [type, magic] of Object.entries(PHOTO_TYPES)) {
    if (magic.every((b, i) => bytes[i] === b) && (type !== 'image/webp' || String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP')) return type;
  }
  return null;
}

/** ¿Puede `viewer` ver la foto de `owner`? Una consulta. */
async function canSeePhoto(db, viewer, ownerId) {
  if (viewer.id === ownerId || viewer.role === 'admin') return true;
  const row = await one(
    db,
    `SELECT 1 AS ok FROM aula_members a JOIN aula_members b ON b.course=a.course
       WHERE a.user_id=?1 AND b.user_id=?2 AND a.role IN ('student','teacher') AND b.role IN ('student','teacher')
         AND (a.role='teacher' OR b.role='teacher')
     UNION ALL
     SELECT 1 FROM aula_courses c JOIN aula_members m ON m.course=c.id AND m.role IN ('student','teacher')
       WHERE (c.owner=?2 AND m.user_id=?1) OR (c.owner=?1 AND m.user_id=?2)
     LIMIT 1`,
    ownerId,
    viewer.id,
  );
  return Boolean(row);
}

/** GET /api/photo/<usuario> */
export async function servePhoto({ db, env, user }, ownerId) {
  const owner = await one(db, 'SELECT id, photo FROM aula_users WHERE id=?', ownerId);
  if (!owner?.photo || !(await canSeePhoto(db, user, owner.id))) fail('Foto no disponible.', 404);
  const object = await env.BUCKET.get(owner.photo);
  if (!object) fail('Foto no disponible.', 404);
  return new Response(object.body, {
    headers: {
      ...SECURITY_HEADERS,
      // El tipo va en la llave (se detectó por sus primeros bytes al subirla).
      'Content-Type': TYPE_OF_EXTENSION[owner.photo.split('.').pop()] || 'image/jpeg',
      // La dirección lleva ?v=<fecha de cambio>: puede guardarse en el navegador sin que se vea una foto vieja.
      'Cache-Control': 'private, max-age=604800',
    },
  });
}

export const photoRoutes = {
  // Sube o reemplaza la foto propia (cuerpo: la imagen ya reducida por el navegador).
  'POST /api/profile/photo': async ({ db, env, user, request }) => {
    const length = Number(request.headers.get('content-length') || 0);
    if (length > MAX_PHOTO_BYTES) fail('La foto es demasiado grande. Elige otra o recórtala.', 413);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) fail('No llegó la foto.');
    if (bytes.length > MAX_PHOTO_BYTES) fail('La foto es demasiado grande. Elige otra o recórtala.', 413);
    const type = photoType(bytes);
    if (!type) fail('Usa una foto JPG, PNG o WEBP.');
    const key = `perfil/${user.id}/${crypto.randomUUID()}.${EXTENSIONS[type]}`;
    await env.BUCKET.put(key, new Blob([bytes], { type }), { httpMetadata: { contentType: type } });
    const previous = await one(db, 'SELECT photo FROM aula_users WHERE id=?', user.id);
    const updated = nowIso();
    await run(db, 'UPDATE aula_users SET photo=?, photo_updated=? WHERE id=?', key, updated, user.id);
    if (previous?.photo) await env.BUCKET.delete(previous.photo);
    return json({ photo: updated }, 201);
  },

  // Quita una foto: la propia, o la de un alumno de un curso donde enseñas (o cualquiera, la administración).
  'POST /api/profile/photo/delete': async ({ db, env, user, request }) => {
    const body = await readJson(request);
    const target = body.user ? String(body.user) : user.id;
    if (target !== user.id && user.role !== 'admin') {
      requireTeacher(await access(db, user, body.course));
      const enrolled = await one(db, "SELECT 1 AS ok FROM aula_members WHERE course=? AND user_id=? AND role='student'", body.course, target);
      if (!enrolled) fail('Ese alumno no está en este curso.', 404);
    }
    const row = await one(db, 'SELECT photo FROM aula_users WHERE id=?', target);
    if (!row?.photo) return json({ ok: true });
    await run(db, 'UPDATE aula_users SET photo=NULL, photo_updated=? WHERE id=?', nowIso(), target);
    await env.BUCKET.delete(row.photo);
    if (target !== user.id) console.log('aula-api foto quitada', user.email, target);
    return json({ ok: true });
  },
};

// ---- Portada del curso (12.25) ----------------------------------------------------------------------------
// Quien enseña sube una imagen (el navegador la reduce); la ven todas las personas del curso.
export const MAX_COVER_BYTES = 1.5 * 1024 * 1024;

/** GET /api/course-cover/<curso> */
export async function serveCourseCover({ db, env, user }, courseId) {
  await access(db, user, courseId);
  const course = await one(db, 'SELECT cover FROM aula_courses WHERE id=?', courseId);
  if (!course?.cover) fail('Portada no disponible.', 404);
  const object = await env.BUCKET.get(course.cover);
  if (!object) fail('Portada no disponible.', 404);
  return new Response(object.body, {
    headers: {
      ...SECURITY_HEADERS,
      'Content-Type': TYPE_OF_EXTENSION[course.cover.split('.').pop()] || 'image/jpeg',
      'Cache-Control': 'private, max-age=604800',
    },
  });
}

export const coverRoutes = {
  // Sube o reemplaza la portada (?course=; cuerpo: la imagen).
  'POST /api/course/cover': async ({ db, env, user, request, url }) => {
    const course = url.searchParams.get('course');
    requireTeacher(await access(db, user, course));
    const length = Number(request.headers.get('content-length') || 0);
    if (length > MAX_COVER_BYTES) fail('La imagen es demasiado grande (máximo 1.5 MB).', 413);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) fail('No llegó la imagen.');
    if (bytes.length > MAX_COVER_BYTES) fail('La imagen es demasiado grande (máximo 1.5 MB).', 413);
    const type = photoType(bytes);
    if (!type) fail('Usa una imagen JPG, PNG o WEBP.');
    const key = `portadas/${course}/${crypto.randomUUID()}.${EXTENSIONS[type]}`;
    await env.BUCKET.put(key, new Blob([bytes], { type }), { httpMetadata: { contentType: type } });
    const previous = await one(db, 'SELECT cover FROM aula_courses WHERE id=?', course);
    const updated = nowIso();
    await run(db, 'UPDATE aula_courses SET cover=?, cover_updated=? WHERE id=?', key, updated, course);
    if (previous?.cover) await env.BUCKET.delete(previous.cover);
    return json({ cover_updated: updated }, 201);
  },

  'POST /api/course/cover/delete': async ({ db, env, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const row = await one(db, 'SELECT cover FROM aula_courses WHERE id=?', body.course);
    await run(db, 'UPDATE aula_courses SET cover=NULL, cover_updated=NULL WHERE id=?', body.course);
    if (row?.cover) await env.BUCKET.delete(row.cover);
    return json({ ok: true });
  },
};
