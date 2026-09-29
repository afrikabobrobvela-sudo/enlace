// Publicación programada: unidades, materiales, noticias, foros y evaluaciones pueden llevar `data.publishAt`
// (ISO). Para los alumnos un elemento existe solo si está visible Y ya llegó su fecha; quien enseña lo ve siempre.
// Todas las consultas y comprobaciones de "lo que ve un alumno" deben usar estas dos funciones.
import { fail, isoDate } from './http.js';

export const SCHEDULABLE_KINDS = ['module', 'material', 'notice', 'forum', 'quiz'];

/** ¿Lo ve un alumno? (visible y con la fecha de publicación cumplida). */
export const isPublished = (r, now = new Date().toISOString()) => Boolean(r) && r.data.visible !== false && (!r.data.publishAt || r.data.publishAt <= now);

/** Lo mismo en SQL, para un alias de aula_records y el parámetro con la hora actual (por ejemplo '?3'). */
export const publishedSql = (alias, nowParam) =>
  `(json_type(${alias}.data,'$.visible') IS NOT 'false' AND coalesce(json_extract(${alias}.data,'$.publishAt'),'') <= ${nowParam})`;

/** Fecha de publicación del formulario: vacía = inmediata. */
export function publishAtField(value) {
  if (value === undefined || value === null || value === '') return '';
  const date = isoDate(value);
  if (!date) fail('Fecha de publicación no válida.');
  return date;
}

// ---- Contenido por sección (12.18) -----------------------------------------------------------------------
// Unidades, materiales, noticias, foros y evaluaciones llevan `data.sections`; las actividades, la columna
// `sections` (JSON). Vacío = para todas las secciones. Un alumno sin sección solo ve lo que es para todas.
// `section` null = no filtrar (la vista general «como alumno» de quien enseña).

/** ¿Va dirigido a la sección de este alumno? */
export const forSection = (sections, section) => section === null || section === undefined || !sections?.length || (Boolean(section) && sections.includes(section));

/** Lo mismo en SQL: `json` es una expresión con el arreglo (o NULL/''), `section` la sección del alumno. */
export const sectionSql = (json, section, alias = 'sx') =>
  `(coalesce(json_array_length(nullif(${json},'')),0)=0 OR EXISTS (SELECT 1 FROM json_each(nullif(${json},'')) ${alias} WHERE ${alias}.value=${section}))`;

/** Arreglo de secciones guardado en una actividad ('' o JSON). */
export const taskSections = (value) => {
  try {
    const list = JSON.parse(value || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

// ---- Acceso especial (12.22) -------------------------------------------------------------------------
// Una actividad (`aula_tasks.special_only`) o una evaluación (`data.specialOnly`) puede ser solo para los alumnos con
// acceso especial: una fila en aula_extensions (actividades) o aula_quiz_access (evaluaciones). Toda comprobación de
// «lo que ve un alumno» sobre actividades y evaluaciones suma estas condiciones a las de sección.

/** ¿Ve este alumno la actividad? (`member` es una expresión SQL con el id de su inscripción). */
export const specialTaskSql = (t, member) =>
  `(${t}.special_only=0 OR EXISTS (SELECT 1 FROM aula_extensions sa WHERE sa.task=${t}.id AND sa.member=${member}))`;

/** Lo mismo para aula_records (solo las evaluaciones pueden llevar `specialOnly`). */
export const specialRecordSql = (r, member) =>
  `(coalesce(json_extract(${r}.data,'$.specialOnly'),0)=0 OR EXISTS (SELECT 1 FROM aula_quiz_access qa WHERE qa.quiz=${r}.id AND qa.member=${member}))`;
