// Acceso especial (12.22), como en Brightspace: a uno o varios alumnos se les da otro horario en una actividad
// (aula_extensions: desde, vence, cierre) o en una evaluación (aula_quiz_access: se abre, se cierra, minutos extra e
// intentos adicionales). Además, la actividad o evaluación puede ser «solo para quienes tienen acceso especial»
// (por ejemplo, una reposición). La prórroga individual de antes (`/api/extension`) es un acceso especial de un alumno.
import { access, requireTeacher } from './access.js';
import { all, fail, isoDate, json, nowIso, one, optionalText, readJson, run } from './http.js';
import { taskSections } from './published.js';

const MAX_MEMBERS = 1000;
const MAX_EXTRA_MINUTES = 600;
const MAX_EXTRA_ATTEMPTS = 10;

/** La actividad o evaluación (no eliminada) con sus secciones y si es solo para acceso especial. */
async function itemOf(db, course, kind, id) {
  if (kind === 'task') {
    const t = await one(db, 'SELECT id, title, sections, special_only FROM aula_tasks WHERE id=? AND course=? AND deleted_at IS NULL', String(id ?? ''), course);
    if (!t) fail('Actividad no encontrada.', 404);
    return { id: t.id, title: t.title, sections: taskSections(t.sections), specialOnly: t.special_only === 1 };
  }
  if (kind === 'quiz') {
    const r = await one(db, "SELECT id, data FROM aula_records WHERE id=? AND course=? AND kind='quiz' AND deleted_at IS NULL", String(id ?? ''), course);
    if (!r) fail('Evaluación no encontrada.', 404);
    const data = JSON.parse(r.data);
    return { id: r.id, title: data.title, sections: data.sections || [], specialOnly: data.specialOnly === true };
  }
  fail('Elige una actividad o una evaluación.');
}

/** Alumnos del curso elegidos (todos deben existir y ser de las secciones del elemento). */
async function membersOf(db, course, item, input) {
  const ids = Array.isArray(input) ? [...new Set(input.map(String))] : [];
  if (!ids.length) fail('Elige al menos un alumno.');
  if (ids.length > MAX_MEMBERS) fail(`Elige como máximo ${MAX_MEMBERS} alumnos a la vez.`);
  const rows = await all(
    db,
    "SELECT id, name, section FROM aula_members WHERE course=? AND role='student' AND id IN (SELECT value FROM json_each(?))",
    course,
    JSON.stringify(ids),
  );
  if (rows.length !== ids.length) fail('Uno de los alumnos ya no está inscrito. Recarga la página.', 404);
  const outside = item.sections.length ? rows.filter((m) => !item.sections.includes(m.section)) : [];
  if (outside.length) {
    fail(`${outside.length === 1 ? `${outside[0].name} no es` : `${outside.length} alumnos no son`} de las secciones a las que va dirigida («${item.title}»).`);
  }
  return ids;
}

const whole = (value, max, label) => {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > max) fail(`${label} va de 0 a ${max}.`);
  return n;
};

export const specialAccessRoutes = {
  // Da (o cambia) el acceso especial de varios alumnos a la vez.
  'POST /api/special-access': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const item = await itemOf(db, body.course, body.kind, body.item);
    const members = await membersOf(db, body.course, item, body.members);
    const startAt = isoDate(body.startAt || '');
    const endAt = isoDate(body.endAt || '');
    const reason = optionalText(body.reason, 300);
    const now = nowIso();
    if (startAt && endAt && endAt <= startAt) fail('El cierre debe ser posterior al inicio.');
    if (body.kind === 'task') {
      const due = isoDate(body.due || '');
      if (due && startAt && due < startAt) fail('El vencimiento debe ser posterior al inicio.');
      if (due && endAt && endAt < due) fail('El cierre no puede ser antes del vencimiento.');
      if (!startAt && !due && !endAt && !item.specialOnly) fail('Indica al menos una fecha (o marca que solo la vean los alumnos con acceso especial).');
      await run(
        db,
        `INSERT INTO aula_extensions (task,member,start_at,due,end_at,reason,created_by,created)
         SELECT ?1, value, ?2, ?3, ?4, ?5, ?6, ?7 FROM json_each(?8) WHERE true
         ON CONFLICT(task,member) DO UPDATE SET start_at=excluded.start_at, due=excluded.due, end_at=excluded.end_at,
           reason=excluded.reason, created_by=excluded.created_by, created=excluded.created`,
        item.id,
        startAt,
        due,
        endAt,
        reason,
        user.id,
        now,
        JSON.stringify(members),
      );
    } else {
      const extraMinutes = whole(body.extraMinutes, MAX_EXTRA_MINUTES, 'El tiempo extra (minutos)');
      const extraAttempts = whole(body.extraAttempts, MAX_EXTRA_ATTEMPTS, 'Los intentos adicionales');
      if (!startAt && !endAt && !extraMinutes && !extraAttempts && !item.specialOnly) {
        fail('Indica otro horario, tiempo extra o intentos adicionales (o marca que solo la vean los alumnos con acceso especial).');
      }
      await run(
        db,
        `INSERT INTO aula_quiz_access (quiz,member,course,start_at,end_at,extra_minutes,extra_attempts,reason,created_by,created)
         SELECT ?1, value, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 FROM json_each(?10) WHERE true
         ON CONFLICT(quiz,member) DO UPDATE SET start_at=excluded.start_at, end_at=excluded.end_at, extra_minutes=excluded.extra_minutes,
           extra_attempts=excluded.extra_attempts, reason=excluded.reason, created_by=excluded.created_by, created=excluded.created`,
        item.id,
        body.course,
        startAt,
        endAt,
        extraMinutes,
        extraAttempts,
        reason,
        user.id,
        now,
        JSON.stringify(members),
      );
    }
    return json({ saved: members.length });
  },

  // Quita el acceso especial de uno o varios alumnos.
  'DELETE /api/special-access': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const item = await itemOf(db, body.course, body.kind, body.item);
    const members = Array.isArray(body.members) ? [...new Set(body.members.map(String))].slice(0, MAX_MEMBERS) : [];
    if (!members.length) fail('Elige al menos un alumno.');
    const table = body.kind === 'task' ? 'aula_extensions' : 'aula_quiz_access';
    const column = body.kind === 'task' ? 'task' : 'quiz';
    const result = await run(db, `DELETE FROM ${table} WHERE ${column}=? AND member IN (SELECT value FROM json_each(?))`, item.id, JSON.stringify(members));
    return json({ removed: result.meta.changes || 0 });
  },

  // «Solo la ven los alumnos con acceso especial» (sí o no). No cambia la fecha del elemento: no vuelve a avisar.
  'POST /api/special-access/only': async ({ db, user, request }) => {
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    if (typeof body.specialOnly !== 'boolean') fail('Indica si solo la ven los alumnos con acceso especial.');
    const item = await itemOf(db, body.course, body.kind, body.item);
    if (body.kind === 'task') {
      await run(db, 'UPDATE aula_tasks SET special_only=?, revision=revision+1 WHERE id=?', body.specialOnly ? 1 : 0, item.id);
    } else {
      await run(
        db,
        `UPDATE aula_records SET data=CASE WHEN ?1 THEN json_set(data,'$.specialOnly',json('true')) ELSE json_remove(data,'$.specialOnly') END,
           revision=revision+1 WHERE id=?2`,
        body.specialOnly ? 1 : 0,
        item.id,
      );
    }
    return json({ specialOnly: body.specialOnly });
  },
};
