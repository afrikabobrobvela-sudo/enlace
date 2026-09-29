// Secciones de un curso (por ejemplo 5AV, 5BV y 5CV de Física I): un solo curso con el mismo contenido para todos,
// y alumnos, asistencia, calificaciones y fechas que se filtran o ajustan por sección. Un curso sin secciones funciona
// igual que antes.
import { access, requireTeacher } from './access.js';
import { all, fail, isoDate, json, nowIso, one, readJson, run, text } from './http.js';

export const MAX_SECTIONS = 30;
const MAX_NAME = 40;

const cleanName = (value) => text(String(value ?? '').trim().replace(/\s+/g, ' '), MAX_NAME);
const key = (name) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const sectionsOf = (db, course) => all(db, 'SELECT id, name, position FROM aula_sections WHERE course=? ORDER BY position, name', course);

async function sectionOf(db, course, id) {
  const row = await one(db, 'SELECT * FROM aula_sections WHERE id=? AND course=?', String(id ?? ''), course);
  if (!row) fail('Sección no encontrada.', 404);
  return row;
}

/** '' (sin sección) o el id de una sección del curso. */
export async function validSection(db, course, value) {
  const id = String(value ?? '');
  if (!id) return '';
  await sectionOf(db, course, id);
  return id;
}

/**
 * Ids de secciones por nombre (sin distinguir mayúsculas ni acentos); crea las que falten. Para importar listas
 * con una columna «Sección» o «Grupo».
 */
export async function sectionIdsByName(db, course, names) {
  const wanted = new Map();
  for (const raw of names) {
    const name = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
    if (name) wanted.set(key(name), name);
  }
  if (!wanted.size) return new Map();
  let existing = await sectionsOf(db, course);
  const byKey = new Map(existing.map((s) => [key(s.name), s.id]));
  const missing = [...wanted].filter(([k]) => !byKey.has(k)).map(([, name]) => name);
  if (missing.length) {
    if (existing.length + missing.length > MAX_SECTIONS) fail(`Un curso admite hasta ${MAX_SECTIONS} secciones.`);
    const now = nowIso();
    const rows = missing.map((name, i) => ({ id: crypto.randomUUID(), name, position: existing.length + i }));
    await run(
      db,
      `INSERT OR IGNORE INTO aula_sections (id,course,name,position,created)
       SELECT json_extract(value,'$.id'), ?1, json_extract(value,'$.name'), json_extract(value,'$.position'), ?2 FROM json_each(?3)`,
      course,
      now,
      JSON.stringify(rows),
    );
    existing = await sectionsOf(db, course);
    for (const s of existing) byKey.set(key(s.name), s.id);
  }
  return new Map([...wanted.keys()].map((k) => [k, byKey.get(k)]));
}
export const sectionKey = key;

/** Fechas de la sección aplicadas a una actividad (lo vacío conserva la fecha general). */
export function withSectionDates(task, dates) {
  if (!dates) return task;
  return { ...task, start_at: dates.start_at || task.start_at, due: dates.due || task.due, end_at: dates.end_at || task.end_at };
}

/** Evaluación con las fechas de la sección del alumno: se abre (`start_at`) y se cierra (`end_at`). */
export function quizWithSectionDates(quiz, dates) {
  if (!dates || (!dates.start_at && !dates.end_at)) return quiz;
  const settings = { ...(quiz.data.settings || {}) };
  if (dates.start_at) settings.opensAt = dates.start_at;
  if (dates.end_at) settings.closesAt = dates.end_at;
  return { ...quiz, data: { ...quiz.data, settings } };
}

/** La evaluación como la vive este alumno (con las fechas de su sección). Una consulta. */
export async function quizForStudent(db, quiz, userId) {
  const dates = await one(
    db,
    `SELECT m.section, d.start_at, d.end_at FROM aula_members m LEFT JOIN aula_section_dates d ON d.section=m.section AND d.item=?1
     WHERE m.course=?2 AND m.user_id=?3 AND m.role='student'`,
    quiz.id,
    quiz.course,
    userId,
  );
  // Una evaluación de otras secciones no está disponible para este alumno.
  const sections = quiz.data.sections || [];
  if (sections.length && !sections.includes(dates?.section)) fail('La evaluación no está disponible.', 403);
  return quizWithSectionDates(quiz, dates);
}

/** Valida las fechas por sección de una actividad o evaluación ([{ section, startAt, due, endAt }]). */
async function validDates(db, course, input, kind) {
  if (!Array.isArray(input) || input.length > MAX_SECTIONS) fail('Revisa las fechas por sección.');
  const sections = new Map((await sectionsOf(db, course)).map((s) => [s.id, s.name]));
  const seen = new Set();
  const rows = [];
  for (const entry of input) {
    const section = String(entry?.section ?? '');
    if (!sections.has(section)) fail('Sección no válida.');
    if (seen.has(section)) continue;
    seen.add(section);
    const startAt = isoDate(entry.startAt || '');
    const due = kind === 'task' ? isoDate(entry.due || '') : '';
    const endAt = isoDate(entry.endAt || '');
    const name = sections.get(section);
    if (startAt && endAt && endAt <= startAt) fail(`Sección ${name}: el cierre debe ser posterior al inicio.`);
    if (due && startAt && due < startAt) fail(`Sección ${name}: el vencimiento debe ser posterior al inicio.`);
    if (due && endAt && endAt < due) fail(`Sección ${name}: el cierre no puede ser antes del vencimiento.`);
    if (startAt || due || endAt) rows.push({ section, start_at: startAt, due, end_at: endAt });
  }
  return rows;
}

export const sectionRoutes = {
  'POST /api/sections': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const name = cleanName(body.name);
    const existing = await sectionsOf(db, body.course);
    if (existing.some((s) => key(s.name) === key(name))) fail(`Ya existe la sección ${name}.`, 409);
    if (existing.length >= MAX_SECTIONS) fail(`Un curso admite hasta ${MAX_SECTIONS} secciones.`);
    const id = crypto.randomUUID();
    await run(db, 'INSERT INTO aula_sections (id,course,name,position,created) VALUES (?,?,?,?,?)', id, body.course, name, existing.length, nowIso());
    return json({ id, name }, 201);
  },

  'POST /api/sections/update': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const section = await sectionOf(db, body.course, body.id);
    const name = cleanName(body.name);
    const existing = await sectionsOf(db, body.course);
    if (existing.some((s) => s.id !== section.id && key(s.name) === key(name))) fail(`Ya existe la sección ${name}.`, 409);
    await run(db, 'UPDATE aula_sections SET name=? WHERE id=?', name, section.id);
    return json({ ok: true });
  },

  // Solo se elimina una sección vacía (sin alumnos ni clases): así nunca se pierde a qué grupo pertenecía algo.
  'POST /api/sections/delete': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const section = await sectionOf(db, body.course, body.id);
    const used = await one(
      db,
      `SELECT (SELECT count(*) FROM aula_members WHERE course=?1 AND section=?2 AND role='student') AS students,
              (SELECT count(*) FROM aula_sessions WHERE course=?1 AND section=?2) AS sessions`,
      body.course,
      section.id,
    );
    if (used.students) fail(`La sección ${section.name} tiene ${used.students} alumnos. Pásalos a otra sección antes de eliminarla.`, 409);
    if (used.sessions) fail(`La sección ${section.name} tiene clases en la asistencia. Elimínalas antes (o conserva la sección).`, 409);
    await db.batch([
      db.prepare('DELETE FROM aula_section_dates WHERE section=?').bind(section.id),
      db.prepare('DELETE FROM aula_sections WHERE id=?').bind(section.id),
    ]);
    return json({ ok: true });
  },

  // Pasa alumnos a una sección ('' = sin sección).
  'POST /api/sections/assign': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const section = await validSection(db, body.course, body.section);
    const members = Array.isArray(body.members) ? [...new Set(body.members.map(String))] : [];
    if (!members.length || members.length > 1000) fail('Elige a los alumnos.');
    const result = await run(
      db,
      "UPDATE aula_members SET section=? WHERE course=? AND role='student' AND id IN (SELECT value FROM json_each(?))",
      section,
      body.course,
      JSON.stringify(members),
    );
    return json({ changed: result.meta.changes || 0 });
  },

  // Fechas de una actividad o evaluación por sección: reemplaza todas las de ese elemento.
  'POST /api/sections/dates': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const kind = body.kind === 'quiz' ? 'quiz' : 'task';
    const item = String(body.item ?? '');
    const found =
      kind === 'task'
        ? await one(db, 'SELECT id FROM aula_tasks WHERE id=? AND course=? AND deleted_at IS NULL', item, body.course)
        : await one(db, "SELECT id FROM aula_records WHERE id=? AND course=? AND kind='quiz' AND deleted_at IS NULL", item, body.course);
    if (!found) fail('Elemento no encontrado.', 404);
    const rows = await validDates(db, body.course, body.dates, kind);
    const now = nowIso();
    await db.batch([
      db.prepare('DELETE FROM aula_section_dates WHERE item=? AND course=?').bind(item, body.course),
      db
        .prepare(
          `INSERT INTO aula_section_dates (item,section,course,start_at,due,end_at,updated)
           SELECT ?1, json_extract(value,'$.section'), ?2, json_extract(value,'$.start_at'), json_extract(value,'$.due'),
                  json_extract(value,'$.end_at'), ?3 FROM json_each(?4)`,
        )
        .bind(item, body.course, now, JSON.stringify(rows)),
    ]);
    return json({ saved: rows.length });
  },

  /**
   * Trae a este curso, en una sección, a los alumnos de otro curso que también enseñas (para juntar en uno solo
   * los grupos que se habían creado por separado). Solo la lista: las entregas y calificaciones se quedan en su curso.
   */
  'POST /api/sections/import': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const from = await access(db, user, body.from);
    requireTeacher(from);
    if (from.course.id === body.course) fail('Elige otro curso.');
    const section = body.section ? await validSection(db, body.course, body.section) : (await sectionIdsByName(db, body.course, [from.course.group_name || from.course.name])).values().next().value;
    const result = await run(
      db,
      `INSERT INTO aula_members (id,course,email,user_id,name,matricula,role,section)
       SELECT lower(hex(randomblob(16))), ?1, m.email, m.user_id, m.name, m.matricula, 'student', ?2
       FROM aula_members m WHERE m.course=?3 AND m.role='student' AND true
       ON CONFLICT(course,email) DO UPDATE SET section=excluded.section, role='student',
         user_id=coalesce(aula_members.user_id, excluded.user_id) WHERE aula_members.role<>'teacher'`,
      body.course,
      section,
      from.course.id,
    );
    return json({ imported: result.meta.changes || 0, section }, 201);
  },
};

/** Secciones a las que va dirigido un elemento: [] = todas; si no, ids de secciones de este curso. */
export async function sectionsField(db, course, input) {
  if (input === undefined || input === null || input === '') return [];
  if (!Array.isArray(input) || input.length > MAX_SECTIONS) fail('Revisa las secciones elegidas.');
  const ids = [...new Set(input.map(String))];
  if (!ids.length) return [];
  const valid = new Set((await sectionsOf(db, course)).map((s) => s.id));
  if (ids.some((id) => !valid.has(id))) fail('Una de las secciones elegidas ya no existe. Recarga la página.');
  return ids.sort();
}
