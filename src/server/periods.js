// Periodos: copiar un curso al siguiente semestre y archivar cursos terminados (solo lectura).
import { access, ownsCourse, requireTeacher } from './access.js';
import { all, fail, json, nowIso, one, optionalText, readJson, run, text } from './http.js';

const COPY_KINDS = ['module', 'material', 'notice', 'forum', 'quiz'];
const ARCHIVED = 'Este curso está archivado: solo se puede consultar. Desarchívalo en Administración del curso para hacer cambios.';
/** Rutas que sí funcionan en un curso archivado. */
const ARCHIVE_EXEMPT = new Set(['POST /api/course/archive', 'POST /api/course/copy', 'DELETE /api/course', 'POST /api/course/transfer']);

/**
 * Un curso archivado es de solo lectura para todos. Se revisa antes de cualquier escritura con curso:
 * el id viene en la URL (?course=, subidas) o en el cuerpo JSON (se lee una copia; el manejador lee el original).
 */
export async function assertWritable(db, route, url, request) {
  if (ARCHIVE_EXEMPT.has(route)) return;
  let course = url.searchParams.get('course');
  // Sin importar el Content-Type declarado: readJson() del manejador tampoco lo exige.
  const size = Number(request.headers.get('content-length') || 0);
  if (!course && size <= 180_000) {
    const body = await request.clone().json().catch(() => null);
    course = body && typeof body.course === 'string' ? body.course : null;
  }
  if (!course) return;
  const row = await one(db, 'SELECT archived_at FROM aula_courses WHERE id=?', course);
  if (row?.archived_at) fail(ARCHIVED, 409);
}

/** Reemplaza cada id viejo por el nuevo dentro de un texto (JSON de un registro o instrucciones con imágenes). */
function remap(textValue, map) {
  let out = String(textValue ?? '');
  for (const [from, to] of map) if (out.includes(from)) out = out.split(from).join(to);
  return out;
}

export const periodRoutes = {
  'POST /api/course/archive': async ({ db, user, request }) => {
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    if (user.role !== 'admin' && !ownsCourse(user, a.course)) fail('Solo el propietario o la administración puede archivar el curso.', 403);
    await run(db, 'UPDATE aula_courses SET archived_at=? WHERE id=?', body.archived === false ? null : nowIso(), a.course.id);
    return json({ archived: body.archived !== false });
  },

  /**
   * Copia la estructura de un curso a uno nuevo del mismo docente: unidades, materiales, noticias, foros,
   * evaluaciones, actividades, categorías, reglas de calificación y de asistencia. No copia alumnos, entregas,
   * calificaciones, publicaciones de foro, equipos ni asistencia. Los archivos se comparten (no ocupan espacio extra).
   */
  'POST /api/course/copy': async ({ db, user, request }) => {
    if (!['teacher', 'admin'].includes(user.role)) fail('No puedes crear cursos.', 403);
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    requireTeacher(a);
    const source = a.course.id;
    const name = text(body.name, 150);
    const group = text(body.group, 100);
    const period = optionalText(body.period, 60);
    const keepDates = body.keepDates === true;

    const [records, tasks, files, categories, sections] = await Promise.all([
      all(
        db,
        `SELECT * FROM aula_records WHERE course=? AND deleted_at IS NULL AND kind IN (${COPY_KINDS.map(() => '?').join(',')}) ORDER BY created`,
        source,
        ...COPY_KINDS,
      ),
      all(db, 'SELECT * FROM aula_tasks WHERE course=? AND deleted_at IS NULL ORDER BY created', source),
      all(db, "SELECT * FROM aula_files WHERE course=? AND scope='material'", source),
      all(db, 'SELECT * FROM aula_grade_categories WHERE course=?', source),
      all(db, 'SELECT * FROM aula_sections WHERE course=?', source),
    ]);

    const id = crypto.randomUUID();
    const now = nowIso();
    // Mapa de ids viejos → nuevos. La guía inicial conserva su id especial para que Enlace la reconozca.
    const map = new Map();
    for (const f of files) map.set(f.id, crypto.randomUUID());
    for (const r of records) map.set(r.id, r.id === 'courseguide:' + source ? 'courseguide:' + id : crypto.randomUUID());
    for (const t of tasks) map.set(t.id, crypto.randomUUID());
    for (const c of categories) map.set(c.id, crypto.randomUUID());
    // Secciones nuevas: lo dirigido a una sección queda dirigido a la misma sección del curso copiado.
    for (const x of sections) map.set(x.id, crypto.randomUUID());
    const sectionRows = sections.map((x) => ({ id: map.get(x.id), name: x.name, position: x.position }));

    const clearDates = (data) => (keepDates ? data : { ...data, start: '', end: '', due: '' });
    const recordRows = records.map((r) => {
      // Lo que era de los alumnos del curso original no se copia: el acceso especial (el curso nuevo no tiene esos
      // alumnos: una evaluación «solo con acceso especial» no la vería nadie) y el aviso de noticia ya enviada por correo.
      const { specialOnly: _special, emailedAt: _emailed, ...data } = JSON.parse(remap(r.data, map));
      return { id: map.get(r.id), kind: r.kind, data: JSON.stringify(r.kind === 'quiz' ? clearDates(data) : data) };
    });
    const taskRows = tasks.map((t) => ({
      id: map.get(t.id),
      title: t.title,
      body: remap(t.body, map),
      visible: t.visible,
      submission_mode: t.submission_mode,
      max_files: t.max_files,
      extensions: t.extensions,
      file_ids: remap(t.file_ids, map),
      allow_resubmit: t.allow_resubmit,
      due: keepDates ? t.due : '',
      start_at: keepDates ? t.start_at : '',
      end_at: keepDates ? t.end_at : '',
      weight: t.weight,
      category: t.category ? map.get(t.category) ?? null : null,
      sections: remap(t.sections || '', map),
      points: t.points,
      rubric: t.rubric,
    }));
    const fileRows = files.map((f) => ({ id: map.get(f.id), owner: f.owner, name: f.name, size: f.size, mime: f.mime, key: f.r2_key || f.id }));
    const categoryRows = categories.map((c) => ({ id: map.get(c.id), name: c.name, weight: c.weight, source: c.source, position: c.position }));

    const statements = [
      db
        .prepare('INSERT INTO aula_courses (id,owner,name,group_name,intro,created,academy_id,unit_id,period) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(id, user.id, name, group, remap(a.course.intro, map), now, user.academy_id ?? a.course.academy_id ?? null, user.unit_id ?? a.course.unit_id ?? null, period),
      db
        .prepare(
          `INSERT INTO aula_grade_settings (course,revision,updated,updated_by,scheme,final_decimals,final_rounding,passing_grade,failing_as,missing_as_zero)
           SELECT ?1,1,?2,?3,scheme,final_decimals,final_rounding,passing_grade,failing_as,missing_as_zero FROM aula_grade_settings WHERE course=?4`,
        )
        .bind(id, now, user.id, source),
      db
        .prepare(
          `INSERT INTO aula_attendance_settings (course,min_percent,lates_per_absence,excused_counts,updated)
           SELECT ?1,min_percent,lates_per_absence,excused_counts,?2 FROM aula_attendance_settings WHERE course=?3`,
        )
        .bind(id, now, source),
      // Las secciones (solo sus nombres: los alumnos y las fechas por sección son de cada periodo).
      db
        .prepare(
          `INSERT INTO aula_sections (id,course,name,position,created)
           SELECT json_extract(value,'$.id'), ?1, json_extract(value,'$.name'), json_extract(value,'$.position'), ?2 FROM json_each(?3)`,
        )
        .bind(id, now, JSON.stringify(sectionRows)),
      db
        .prepare(
          `INSERT INTO aula_grade_categories (id,course,name,weight,source,position,updated)
           SELECT json_extract(value,'$.id'), ?1, json_extract(value,'$.name'), json_extract(value,'$.weight'),
                  json_extract(value,'$.source'), json_extract(value,'$.position'), ?2 FROM json_each(?3)`,
        )
        .bind(id, now, JSON.stringify(categoryRows)),
      db
        .prepare(
          `INSERT INTO aula_files (id,course,owner,scope,name,size,mime,created,r2_key)
           SELECT json_extract(value,'$.id'), ?1, json_extract(value,'$.owner'), 'material', json_extract(value,'$.name'),
                  json_extract(value,'$.size'), json_extract(value,'$.mime'), ?2, json_extract(value,'$.key') FROM json_each(?3)`,
        )
        .bind(id, now, JSON.stringify(fileRows)),
      db
        .prepare(
          `INSERT INTO aula_tasks (id,course,author,title,body,visible,submission_mode,max_files,extensions,file_ids,allow_resubmit,
             due,start_at,end_at,weight,category,points,rubric,group_category,sections,revision,created,updated)
           SELECT json_extract(value,'$.id'), ?1, ?2, json_extract(value,'$.title'), json_extract(value,'$.body'),
                  json_extract(value,'$.visible'), json_extract(value,'$.submission_mode'), json_extract(value,'$.max_files'),
                  json_extract(value,'$.extensions'), json_extract(value,'$.file_ids'), json_extract(value,'$.allow_resubmit'),
                  json_extract(value,'$.due'), json_extract(value,'$.start_at'), json_extract(value,'$.end_at'),
                  json_extract(value,'$.weight'), json_extract(value,'$.category'), json_extract(value,'$.points'),
                  json_extract(value,'$.rubric'), '', coalesce(json_extract(value,'$.sections'),''), 1, ?3, ?3 FROM json_each(?4)`,
        )
        .bind(id, user.id, now, JSON.stringify(taskRows)),
      db
        .prepare(
          `INSERT INTO aula_records (id,course,kind,author,data,revision,created,updated)
           SELECT json_extract(value,'$.id'), ?1, json_extract(value,'$.kind'), ?2, json_extract(value,'$.data'), 1, ?3, ?3 FROM json_each(?4)`,
        )
        .bind(id, user.id, now, JSON.stringify(recordRows)),
    ];
    await db.batch(statements);
    return json({ id, copied: { content: recordRows.length, tasks: taskRows.length, files: fileRows.length } }, 201);
  },
};
