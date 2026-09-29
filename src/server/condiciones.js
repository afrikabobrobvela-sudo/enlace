// Condiciones de liberación (12.23), como en Brightspace: una unidad, material, foro, evaluación o actividad aparece
// para el alumno solo cuando cumple sus condiciones (todas o cualquiera): completar o abrir un material, entregar una
// actividad o sacar al menos cierta calificación, contestar una evaluación o sacar al menos cierto puntaje.
// Se guardan en data.conditions (aula_records) o en aula_tasks.conditions: { mode: 'all'|'any', items: [{ type, target, value }] }.
// Quien enseña siempre ve todo; la vista general «como alumno» también (como con el acceso especial).
import { all, fail, one } from './http.js';

/** Tipo de condición → qué tipo de elemento es su objetivo. */
export const CONDITION_TYPES = {
  material_done: 'material',
  material_opened: 'material',
  task_submitted: 'task',
  task_grade: 'task',
  quiz_done: 'quiz',
  quiz_score: 'quiz',
};
/** Elementos de aula_records que pueden llevar condiciones (además de las actividades). */
export const CONDITION_KINDS = ['module', 'material', 'forum', 'quiz'];
const MAX_CONDITIONS = 10;
const WITH_VALUE = ['task_grade', 'quiz_score'];

/** Valida las condiciones que manda el editor. Devuelve null si no hay ninguna. */
export async function conditionsField(db, course, input, selfId = null) {
  if (input === undefined || input === null || input === '') return null;
  const items = Array.isArray(input?.items) ? input.items : null;
  if (!items) fail('Revisa las condiciones de liberación.');
  if (!items.length) return null;
  if (items.length > MAX_CONDITIONS) fail(`Pon como máximo ${MAX_CONDITIONS} condiciones.`);
  const mode = input.mode === 'any' ? 'any' : 'all';
  const clean = items.map((x) => {
    const type = String(x?.type ?? '');
    if (!CONDITION_TYPES[type]) fail('Tipo de condición no válido.');
    const target = String(x?.target ?? '');
    if (!target) fail('Elige el elemento de cada condición.');
    if (target === selfId) fail('Una condición no puede depender del mismo elemento.');
    const item = { type, target };
    if (WITH_VALUE.includes(type)) {
      const value = Number(x.value);
      if (!Number.isFinite(value) || value < 0 || value > 10) fail('La calificación mínima de una condición va de 0 a 10.');
      item.value = Math.round(value * 100) / 100;
    }
    return item;
  });
  // Los elementos deben existir en el curso (y no estar eliminados), con el tipo que corresponde.
  const found = await all(
    db,
    `SELECT id, kind FROM aula_records WHERE course=?1 AND deleted_at IS NULL AND kind IN ('material','quiz') AND id IN (SELECT value FROM json_each(?2))
     UNION ALL
     SELECT id, 'task' FROM aula_tasks WHERE course=?1 AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?2))`,
    course,
    JSON.stringify([...new Set(clean.map((x) => x.target))]),
  );
  const kinds = new Map(found.map((r) => [r.id, r.kind]));
  for (const x of clean) if (kinds.get(x.target) !== CONDITION_TYPES[x.type]) fail('Uno de los elementos de las condiciones ya no existe. Revísalas.');
  return { mode, items: clean };
}

/** ¿Se cumple una condición? (SQL; `a` es la fila de json_each y `member` el id de inscripción del alumno). */
function metSql(a, member) {
  const target = `json_extract(${a}.value,'$.target')`;
  const value = `json_extract(${a}.value,'$.value')`;
  // Los intentos se guardan con la cuenta del alumno (o demo:<inscripción> en el curso de ejemplo).
  const who = `(SELECT coalesce(${a}m.user_id, 'demo:' || ${a}m.id) FROM aula_members ${a}m WHERE ${a}m.id=${member})`;
  return `CASE json_extract(${a}.value,'$.type')
    WHEN 'material_done' THEN EXISTS (SELECT 1 FROM aula_progress ${a}p WHERE ${a}p.member=${member} AND ${a}p.record=${target} AND ${a}p.completed_at IS NOT NULL)
    WHEN 'material_opened' THEN EXISTS (SELECT 1 FROM aula_progress ${a}p WHERE ${a}p.member=${member} AND ${a}p.record=${target} AND ${a}p.opened_at IS NOT NULL)
    WHEN 'task_submitted' THEN EXISTS (SELECT 1 FROM aula_submissions ${a}s WHERE ${a}s.member=${member} AND ${a}s.task=${target} AND ${a}s.submitted<>'')
    WHEN 'task_grade' THEN EXISTS (SELECT 1 FROM aula_submissions ${a}s WHERE ${a}s.member=${member} AND ${a}s.task=${target} AND ${a}s.published=1 AND ${a}s.grade>=${value})
    WHEN 'quiz_done' THEN EXISTS (SELECT 1 FROM aula_attempts ${a}t WHERE ${a}t.quiz=${target} AND ${a}t.user_id=${who})
    WHEN 'quiz_score' THEN EXISTS (SELECT 1 FROM aula_attempts ${a}t WHERE ${a}t.quiz=${target} AND ${a}t.user_id=${who} AND ${a}t.score>=${value})
    ELSE 0 END`;
}

/**
 * ¿Cumple el alumno las condiciones? (SQL). `json` es una expresión con el JSON de las condiciones ('' o NULL = no
 * tiene) y `member`, la del id de inscripción. `alias` debe ser distinto si se usa dentro de otra condición.
 */
export function conditionsSql(json, member, alias = 'cx') {
  const j = `nullif(${json},'')`;
  return `(CASE json_extract(${j},'$.mode')
    WHEN 'any' THEN (EXISTS (SELECT 1 FROM json_each(${j},'$.items') ${alias} WHERE ${metSql(alias, member)}) OR coalesce(json_array_length(${j},'$.items'),0)=0)
    ELSE NOT EXISTS (SELECT 1 FROM json_each(${j},'$.items') ${alias} WHERE NOT (${metSql(alias, member)})) END)`;
}

/** Condiciones de un registro de aula_records (SQL). */
export const recordConditionsSql = (r, member, alias) => conditionsSql(`json_extract(${r}.data,'$.conditions')`, member, alias);

/**
 * Lo que ya hizo un alumno, para revisar condiciones en el navegador de datos del curso: materiales abiertos y
 * completados, actividades entregadas, calificaciones publicadas y mejor puntaje de cada evaluación.
 */
export function studentFacts(progress, records, memberId) {
  const facts = { opened: new Set(), completed: new Set(), submitted: new Set(), grades: new Map(), scores: new Map() };
  for (const p of progress) {
    if (p.member !== memberId) continue;
    if (p.opened_at) facts.opened.add(p.record);
    if (p.completed_at) facts.completed.add(p.record);
  }
  for (const r of records) {
    if (r.kind === 'submission' && r.data.member === memberId) {
      if (r.data.submitted) facts.submitted.add(r.data.task);
      // Al alumno solo le llegan las calificaciones publicadas (sin el campo `published`).
      if (r.data.published !== false && typeof r.data.grade === 'number') facts.grades.set(r.data.task, Math.max(facts.grades.get(r.data.task) ?? -1, r.data.grade));
    }
    if (r.kind === 'attempt' && typeof r.data.score === 'number') facts.scores.set(r.data.quiz, Math.max(facts.scores.get(r.data.quiz) ?? -1, r.data.score));
  }
  return facts;
}

/** ¿Cumple las condiciones? (con los datos de studentFacts). */
export function conditionsMet(conditions, facts) {
  if (!conditions?.items?.length || !facts) return true;
  const met = (x) => {
    switch (x.type) {
      case 'material_done':
        return facts.completed.has(x.target);
      case 'material_opened':
        return facts.opened.has(x.target);
      case 'task_submitted':
        return facts.submitted.has(x.target);
      case 'task_grade':
        return (facts.grades.get(x.target) ?? -1) >= x.value;
      case 'quiz_done':
        return facts.scores.has(x.target);
      case 'quiz_score':
        return (facts.scores.get(x.target) ?? -1) >= x.value;
    }
    return false;
  };
  return conditions.mode === 'any' ? conditions.items.some(met) : conditions.items.every(met);
}

/** Revisa en el servidor las condiciones de un elemento para un alumno (una consulta). */
export async function assertConditions(db, conditions, memberId, message = 'Este elemento aún no está disponible.') {
  if (!conditions?.items?.length) return;
  const row = await one(db, `SELECT ${conditionsSql('?1', '?2')} AS ok`, JSON.stringify(conditions), memberId);
  if (!row?.ok) fail(message, 403);
}
