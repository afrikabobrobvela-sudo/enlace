// Respaldo de los archivos adjuntos (R2) para la administración.
//
// El respaldo de la base (npm run respaldo y respaldo.yml) no incluye los archivos: tareas, presentaciones y
// evidencias viven en R2. Aquí la administración los copia desde el navegador a una carpeta de su computadora
// (solo los que aún no tiene) y, si algún día faltan en R2, los devuelve desde esa carpeta.
//
// - Se respalda cada objeto una vez: las copias de curso comparten el objeto original (`r2_key`).
// - Restaurar solo escribe objetos que faltan y que la base conoce, con el tamaño exacto registrado:
//   nunca reemplaza un archivo que existe ni permite subir algo nuevo por esta vía.
import { requireAdmin } from './access.js';
import { all, fail, json, one, readJson } from './http.js';

export const BACKUP_PAGE = 1000;
// Cada consulta a R2 cuenta como subsolicitud (el plan gratuito permite 50 por solicitud).
export const EXISTS_BATCH = 40;

// Un objeto por llave: se prefiere la fila original (r2_key NULL) para el nombre y el curso.
const OBJECTS = `SELECT o.key, o.name, o.size, o.mime, o.created, o.scope, o.course, coalesce(c.name, '') AS course_name
  FROM (SELECT coalesce(f.r2_key, f.id) AS key, f.name, f.size, f.mime, f.created, f.scope, f.course,
               row_number() OVER (PARTITION BY coalesce(f.r2_key, f.id) ORDER BY f.r2_key IS NOT NULL, f.created) AS n
        FROM aula_files f) o
  LEFT JOIN aula_courses c ON c.id=o.course
  WHERE o.n=1 AND o.key > ?1 ORDER BY o.key LIMIT ${BACKUP_PAGE}`;

/** Fila de la base que corresponde a una llave de R2 (el original o, si ya no existe, una copia). */
async function objectRow(db, key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(key)) fail('Archivo no válido.');
  const row = await one(db, 'SELECT coalesce(r2_key, id) AS key, name, size, mime FROM aula_files WHERE id=?1 OR r2_key=?1 ORDER BY r2_key IS NOT NULL LIMIT 1', key);
  if (!row) fail('Ese archivo no está registrado en Enlace.', 404);
  return row;
}

export const backupRoutes = {
  // Lista paginada por llave: ?after=<última llave de la página anterior>.
  'GET /api/backup/files': async ({ db, user, url }) => {
    requireAdmin(user);
    const files = await all(db, OBJECTS, url.searchParams.get('after') || '');
    return json({ files, next: files.length === BACKUP_PAGE ? files.at(-1).key : null });
  },

  // El contenido tal cual, siempre como descarga (nunca se interpreta en el navegador).
  'GET /api/backup/object': async ({ db, env, user, url }) => {
    requireAdmin(user);
    const row = await objectRow(db, url.searchParams.get('key'));
    const object = await env.BUCKET.get(row.key);
    if (!object) fail('Este archivo falta en el almacenamiento.', 410);
    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${row.key}"`,
        'Content-Length': String(row.size),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },

  // ¿Cuáles de estas llaves faltan en R2? Para restaurar solo lo necesario sin volver a subir todo.
  'POST /api/backup/missing': async ({ env, user, request }) => {
    requireAdmin(user);
    const { keys } = await readJson(request);
    if (!Array.isArray(keys) || keys.length > EXISTS_BATCH || keys.some((k) => typeof k !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(k))) {
      fail(`Envía de 1 a ${EXISTS_BATCH} archivos por consulta.`);
    }
    const found = await Promise.all(keys.map((k) => env.BUCKET.head(k)));
    return json({ missing: keys.filter((_, i) => !found[i]) });
  },

  // Devuelve a R2 un archivo que falta, desde el respaldo. El cuerpo es el archivo; ?key=<llave>.
  'POST /api/backup/restore': async ({ db, env, user, url, request }) => {
    requireAdmin(user);
    const row = await objectRow(db, url.searchParams.get('key'));
    if (await env.BUCKET.head(row.key)) fail('Este archivo ya está en el almacenamiento; no se reemplaza.', 409);
    const reader = request.body?.getReader();
    if (!reader) fail('Archivo vacío.');
    const parts = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > row.size) {
        await reader.cancel();
        break;
      }
      parts.push(value);
    }
    if (size !== row.size) fail(`El archivo del respaldo no coincide con el registrado (${row.size} bytes). No se restauró.`);
    await env.BUCKET.put(row.key, new Blob(parts), { httpMetadata: { contentType: row.mime } });
    return json({ restored: row.key, size }, 201);
  },
};
