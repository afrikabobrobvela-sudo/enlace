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
