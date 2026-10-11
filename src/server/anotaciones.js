// Anotaciones sobre las entregas (12.69): el docente marca el PDF o la imagen que entregó el alumno (pluma, resaltado y
// comentarios numerados) y el alumno las ve, y las descarga en PDF, cuando la calificación de esa entrega está
// publicada. Las coordenadas van como fracción del ancho de la página, así se dibujan igual a cualquier tamaño.
import { access, requireTeacher } from './access.js';
import { fail, json, nowIso, one, readJson, run } from './http.js';

const MAX_BYTES = 300_000;
const MAX_PAGES = 500;
const MAX_ITEMS = 400; // por página
const MAX_POINTS = 1500; // por trazo
const COLORS = new Set(['#c0183f', '#1f3fd1', '#0a6e60', '#111a2e']);

/**
 * Archivos de entregas con anotaciones que puede ver el alumno `viewer` (en sus entregas publicadas de actividades
 * vigentes). Lo usa GET /api/course (`annotated`) y la lectura de una anotación.
 */
export const VISIBLE_TO_STUDENT = `EXISTS (
  SELECT 1 FROM aula_submissions s
  JOIN aula_members m ON m.id=s.member
  JOIN aula_tasks t ON t.id=s.task AND t.deleted_at IS NULL
  WHERE s.course=a.course AND m.user_id=?2 AND s.published=1
    AND EXISTS (SELECT 1 FROM json_each(s.file_ids) j WHERE j.value=a.file_id))`;

const num = (v, max = 5) => {
  const n = Number(v);
  if (!Number.isFinite(n)) fail('Anotación no válida.');
  return Math.min(max, Math.max(0, Math.round(n * 10000) / 10000));
};

/** Deja solo lo que la interfaz sabe dibujar, con números acotados. */
export function cleanAnnotations(input) {
  const pages = input?.pages && typeof input.pages === 'object' ? input.pages : {};
  const out = {};
  const keys = Object.keys(pages);
  if (keys.length > MAX_PAGES) fail('Demasiadas páginas anotadas.');
  for (const key of keys) {
    if (!/^[1-9]\d{0,3}$/.test(key)) fail('Página no válida.');
    const items = Array.isArray(pages[key]) ? pages[key] : [];
    if (items.length > MAX_ITEMS) fail(`Demasiadas marcas en la página ${key}.`);
    const clean = items.map((item) => {
      if (item?.t === 'pen') {
        const pts = Array.isArray(item.pts) ? item.pts : [];
        if (pts.length < 2 || pts.length > MAX_POINTS) fail('Trazo no válido.');
        return { t: 'pen', c: COLORS.has(item.c) ? item.c : '#c0183f', pts: pts.map((p) => [num(p?.[0]), num(p?.[1])]) };
      }
      if (item?.t === 'box') return { t: 'box', x: num(item.x), y: num(item.y), w: num(item.w), h: num(item.h) };
      if (item?.t === 'text') {
        const s = String(item.s ?? '').trim().slice(0, 500);
        if (!s) fail('Escribe el comentario.');
        return { t: 'text', x: num(item.x), y: num(item.y), s };
      }
      fail('Marca no válida.');
    });
    if (clean.length) out[key] = clean;
  }
  return { v: 1, pages: out };
}

/** El archivo debe ser de una entrega de este curso (los materiales del docente no se anotan aquí). */
async function submissionFile(db, course, fileId) {
  const file = await one(db, "SELECT id, name FROM aula_files WHERE id=? AND course=? AND scope='submission'", String(fileId ?? ''), course);
  if (!file) fail('Archivo de entrega no encontrado.', 404);
  return file;
}

export const annotationRoutes = {
  async 'GET /api/annotation'({ db, user, url }) {
    const a = await access(db, user, url.searchParams.get('course'));
    const file = await submissionFile(db, a.course.id, url.searchParams.get('file'));
    const row = await one(
      db,
      `SELECT a.data, a.updated FROM aula_annotations a WHERE a.file_id=?1 AND a.course=?3 ${a.teach ? '' : `AND ${VISIBLE_TO_STUDENT}`}`,
      file.id,
      user.id,
      a.course.id,
    );
    if (!row && !a.teach) fail('Todavía no hay correcciones publicadas en este archivo.', 404);
    return json({ data: row ? JSON.parse(row.data) : { v: 1, pages: {} }, updated: row?.updated || null });
  },

  async 'POST /api/annotation'({ db, user, request }) {
    const body = await readJson(request, MAX_BYTES + 10_000);
    const a = await access(db, user, body.course);
    requireTeacher(a);
    const file = await submissionFile(db, a.course.id, body.file);
    const data = cleanAnnotations(body.data);
    const text = JSON.stringify(data);
    if (text.length > MAX_BYTES) fail('Las anotaciones son demasiado grandes. Divide los trazos largos o borra algunos.', 413);
    if (!Object.keys(data.pages).length) {
      await run(db, 'DELETE FROM aula_annotations WHERE file_id=? AND course=?', file.id, a.course.id);
      return json({ data, updated: null });
    }
    const updated = nowIso();
    await run(
      db,
      `INSERT INTO aula_annotations (file_id, course, data, updated, updated_by) VALUES (?,?,?,?,?)
       ON CONFLICT(file_id) DO UPDATE SET data=excluded.data, updated=excluded.updated, updated_by=excluded.updated_by
       WHERE aula_annotations.course=excluded.course`,
      file.id,
      a.course.id,
      text,
      updated,
      user.id,
    );
    return json({ data, updated });
  },
};
