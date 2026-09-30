// Tipos de reactivos (12.21), además de «Elección múltiple» (choice) y «Aritmética» (numeric), que siguen en quizzes.js:
//   truefalse  Verdadero o falso            multi      Selección múltiple (varias correctas)
//   fill       Para completar ([[…]])       matching   Coincidencia (relacionar columnas)
//   ordering   Ordenamiento                 essay      Respuesta escrita (la califica el docente)
//   short      Respuesta corta              multishort Varias respuestas cortas
//   sigfig     Cifras significativas (una aritmética que además exige cierto número de cifras)
// Cada tipo define: validate (al guardar), instance (lo que ve cada alumno; lo privado va en `key`, que nunca llega al
// navegador), grade (crédito de 0 a 1; `manual` si lo califica el docente) y clean (respuesta guardada a medio examen).
import { fail, text } from './http.js';

export const NEW_TYPES = ['truefalse', 'multi', 'fill', 'matching', 'ordering', 'essay', 'short', 'multishort', 'sigfig'];
const MAX_ANSWER = 300;
export const MAX_ESSAY = 10000;
const BLANK = /\[\[([^\]]{1,200})\]\]/g;

// ---- Utilidades ------------------------------------------------------------------------------------

/** Compara respuestas escritas: sin espacios de más y, salvo que se pida lo contrario, sin mayúsculas ni acentos. */
export function normalizeAnswer(value, exact = false) {
  const clean = String(value ?? '').trim().replace(/\s+/g, ' ');
  return exact ? clean : clean.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
const alternatives = (entry) => String(entry).split('|').map((x) => x.trim()).filter(Boolean);
const matches = (value, entry, exact) => alternatives(entry).some((alt) => normalizeAnswer(alt, exact) === normalizeAnswer(value, exact));

function shuffled(n, random) {
  const perm = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return perm;
}
/** Un orden al azar que no sea el original (para ordenar o relacionar no sirve que ya venga resuelto). */
function derange(n, random) {
  let perm = shuffled(n, random);
  for (let tries = 0; n > 1 && perm.every((v, i) => v === i) && tries < 5; tries++) perm = shuffled(n, random);
  if (n > 1 && perm.every((v, i) => v === i)) perm = perm.map((_, i) => (i + 1) % n);
  return perm;
}

function stringList(input, label, { min, max, what, length = 200 }) {
  if (!Array.isArray(input)) fail(`${label}: agrega ${what}.`);
  const list = input.map((x) => String(x ?? '').trim()).filter(Boolean);
  if (list.length < min || list.length > max) fail(`${label}: agrega de ${min} a ${max} ${what}.`);
  return list.map((x) => x.slice(0, length));
}

/** Cifras significativas de un número tal como se escribió ("0.0450" → 3, "1.20e3" → 3, "1200" → 2). */
export function significantFigures(raw) {
  const clean = String(raw ?? '').trim().replace(/\s+/g, '').replace(',', '.').replace(/^[-+]/, '');
  const mantissa = clean.split(/e/i)[0];
  if (!/^(\d+\.?\d*|\.\d+)$/.test(mantissa)) return 0;
  const hasPoint = mantissa.includes('.');
  let digits = mantissa.replace('.', '').replace(/^0+/, '');
  if (!hasPoint) digits = digits.replace(/0+$/, '');
  return digits.length || (/[1-9]/.test(mantissa) ? 0 : 1); // "0" o "0.0" cuentan como una
}

// ---- Validación -------------------------------------------------------------------------------------

/** Campos propios del tipo. `numericFields` valida fórmula, variables, tolerancia y unidad (lo comparte con «Aritmética»). */
export function validateNew(type, q, label, numericFields) {
  switch (type) {
    case 'truefalse':
      if (typeof q.correct !== 'boolean') fail(`${label}: marca si es verdadero o falso.`);
      return { correct: q.correct };
    case 'multi': {
      const options = stringList(q.options, label, { min: 2, max: 10, what: 'opciones', length: 1500 });
      const correct = Array.isArray(q.correct) ? [...new Set(q.correct.filter((k) => Number.isInteger(k) && k >= 0 && k < options.length))].sort((a, b) => a - b) : [];
      if (!correct.length) fail(`${label}: marca al menos una opción correcta.`);
      // 'each' (12.27, «respuestas correctas» de Brightspace): cada opción bien marcada o bien dejada sin marcar suma.
      return { options, correct, scoring: ['partial', 'each'].includes(q.scoring) ? q.scoring : 'all' };
    }
    case 'fill': {
      const blanks = [...String(q.text ?? '').matchAll(BLANK)];
      if (!blanks.length || blanks.length > 20) fail(`${label}: marca de 1 a 20 espacios con dobles corchetes, por ejemplo «La unidad de fuerza es el [[newton|N]]».`);
      if (blanks.some((b) => !alternatives(b[1]).length)) fail(`${label}: escribe la respuesta dentro de cada [[ ]].`);
      return { exact: q.exact === true };
    }
    case 'matching': {
      if (!Array.isArray(q.pairs)) fail(`${label}: agrega las parejas.`);
      const pairs = q.pairs.map((p) => ({ left: String(p?.left ?? '').trim().slice(0, 500), right: String(p?.right ?? '').trim().slice(0, 500) })).filter((p) => p.left || p.right);
      if (pairs.length < 2 || pairs.length > 10 || pairs.some((p) => !p.left || !p.right)) fail(`${label}: agrega de 2 a 10 parejas completas.`);
      const extra = Array.isArray(q.extra) ? q.extra.map((x) => String(x ?? '').trim().slice(0, 500)).filter(Boolean).slice(0, 5) : [];
      // `reuse` (12.27): una misma respuesta sirve para varios elementos (en Brightspace, varias «Choice» con el mismo
      // «Match»); el alumno la ve una sola vez. Solo se guarda si de verdad hay respuestas repetidas.
      const repeated = new Set(pairs.map((p) => p.right)).size < pairs.length;
      return { pairs, extra, scoring: q.scoring === 'all' ? 'all' : 'partial', ...(q.reuse === true && repeated ? { reuse: true } : {}) };
    }
    case 'ordering':
      return { items: stringList(q.items, label, { min: 2, max: 10, what: 'elementos para ordenar', length: 500 }), scoring: q.scoring === 'all' ? 'all' : 'partial' };
    case 'essay':
      return { guide: String(q.guide ?? '').trim().slice(0, 3000) };
    case 'short': {
      const answers = stringList(q.answers, label, { min: 1, max: 20, what: 'respuestas aceptadas' });
      // Tolerancia numérica (12.27, opcional): si la respuesta es un número, se acepta a esa distancia de uno aceptado.
      if (q.tolerance === undefined || q.tolerance === null || q.tolerance === '') return { answers, exact: q.exact === true };
      const tolerance = Number(q.tolerance);
      if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1e9) fail(`${label}: la tolerancia debe ser un número positivo.`);
      return { answers, exact: q.exact === true, tolerance };
    }
    case 'multishort': {
      const answers = stringList(q.answers, label, { min: 1, max: 20, what: 'respuestas aceptadas' });
      const boxes = Number(q.boxes);
      if (!Number.isInteger(boxes) || boxes < 1 || boxes > 10) fail(`${label}: el alumno escribe de 1 a 10 respuestas.`);
      if (boxes > answers.length) fail(`${label}: hay ${boxes} espacios pero solo ${answers.length} respuestas aceptadas.`);
      return { answers, boxes, exact: q.exact === true };
    }
    case 'sigfig': {
      const figures = Number(q.figures);
      const penalty = Number(q.penalty ?? 50);
      if (!Number.isInteger(figures) || figures < 1 || figures > 10) fail(`${label}: las cifras significativas van de 1 a 10.`);
      if (!Number.isFinite(penalty) || penalty < 0 || penalty > 100) fail(`${label}: el descuento por cifras equivocadas va de 0 a 100 %.`);
      return { ...numericFields(q, label), figures, penalty };
    }
  }
  fail(`${label}: tipo de pregunta no válido.`);
}

// ---- Lo que ve el alumno ------------------------------------------------------------------------------

/** Enunciado sin las respuestas de los espacios (para «Para completar»). */
export const maskBlanks = (textValue) => String(textValue).replace(BLANK, '_____');

/** Antes de empezar (y en la lista del curso): nada que delate la respuesta. */
export function publicNew(q) {
  const base = { type: q.type, text: q.type === 'fill' ? maskBlanks(q.text) : q.text, ...(q.image ? { image: q.image } : {}), ...(q.points ? { points: q.points } : {}) };
  if (q.type === 'multi') return { ...base, options: q.options };
  if (q.type === 'multishort') return { ...base, boxes: q.boxes };
  if (q.type === 'sigfig') return { ...base, unit: q.unit, figures: q.figures };
  return base;
}

/**
 * Pregunta de un intento. `random` es propio de la pregunta (no altera las instancias de evaluaciones anteriores) y
 * `values` los datos aleatorios ya calculados (cifras significativas).
 */
export function instanceNew(q, index, random, { shuffleOptions, values, shown }) {
  const base = { index, type: q.type, text: q.text, ...(q.image ? { image: q.image } : {}), ...(q.points ? { points: q.points } : {}) };
  switch (q.type) {
    case 'truefalse':
    case 'essay':
    case 'short':
      return base;
    case 'multi': {
      const perm = shuffleOptions ? shuffled(q.options.length, random) : q.options.map((_, i) => i);
      return { ...base, options: perm.map((i) => q.options[i]), key: { perm } };
    }
    case 'fill': {
      const parts = String(q.text).split(BLANK).filter((_, i) => i % 2 === 0);
      return { ...base, text: maskBlanks(q.text), parts };
    }
    case 'matching': {
      const all = [...q.pairs.map((p) => p.right), ...q.extra];
      // Con respuestas que se repiten (`reuse`), cada una aparece una sola vez.
      const rights = q.reuse ? [...new Set(all)] : all;
      const perm = derange(rights.length, random);
      return { ...base, lefts: q.pairs.map((p) => p.left), rights: perm.map((i) => rights[i]), key: { perm } };
    }
    case 'ordering': {
      const order = derange(q.items.length, random);
      return { ...base, items: order.map((i) => q.items[i]), key: { order } };
    }
    case 'multishort':
      return { ...base, boxes: q.boxes };
    case 'sigfig':
      return { ...base, text: shown, unit: q.unit, figures: q.figures, values };
  }
  return base;
}

// ---- Calificación ------------------------------------------------------------------------------------

const bad = () => fail('Respuesta no válida.');
const ints = (raw, n) => (Array.isArray(raw) && raw.length <= n && raw.every((x) => x === null || (Number.isInteger(x) && x >= 0 && x < n)) ? raw : bad());
const strings = (raw, n) => (Array.isArray(raw) && raw.length <= n ? raw.map((x) => String(x ?? '').slice(0, MAX_ANSWER)) : bad());
const fraction = (right, total) => (total ? right / total : 0);

/**
 * Crédito (0 a 1) de una respuesta. `evaluateAnswer(q, values)` da el valor esperado y `parseNumber` lee números
 * escritos por el alumno (los dos vienen de quizzes.js). La respuesta escrita queda para el docente (`manual`).
 */
export function gradeNew(q, item, raw, { evaluateAnswer, parseNumber, position }) {
  switch (q.type) {
    case 'truefalse': {
      if (raw !== 0 && raw !== 1) bad();
      return { answer: raw === 0, credit: (raw === 0) === q.correct ? 1 : 0 };
    }
    case 'multi': {
      const chosen = [...new Set(ints(raw, q.options.length).filter((x) => x !== null).map((j) => item.key.perm[j]))].sort((a, b) => a - b);
      const right = chosen.filter((k) => q.correct.includes(k)).length;
      const wrong = chosen.length - right;
      const exact = right === q.correct.length && !wrong;
      // Parcial: correctas elegidas menos incorrectas elegidas, sin bajar de cero. Por opción: cada opción en su
      // estado correcto (marcada si es correcta, sin marcar si no) vale lo mismo.
      const byOption = () => fraction(q.options.filter((_, k) => chosen.includes(k) === q.correct.includes(k)).length, q.options.length);
      const credit = exact ? 1 : q.scoring === 'partial' ? Math.max(0, (right - wrong) / q.correct.length) : q.scoring === 'each' ? byOption() : 0;
      return { answer: chosen, credit };
    }
    case 'fill': {
      const blanks = [...String(q.text).matchAll(BLANK)].map((b) => b[1]);
      const answer = strings(raw, blanks.length);
      const marks = blanks.map((entry, k) => matches(answer[k] ?? '', entry, q.exact));
      return { answer, credit: fraction(marks.filter(Boolean).length, blanks.length), marks };
    }
    case 'matching': {
      const answer = ints(raw, item.key.perm.length);
      // Con respuestas repetidas (`reuse`) se compara el texto: cualquiera de los elementos que la comparten acierta.
      const shown = q.reuse ? [...new Set([...q.pairs.map((p) => p.right), ...q.extra])] : null;
      const marks = q.pairs.map((p, i) =>
        answer[i] === null || answer[i] === undefined ? false : shown ? shown[item.key.perm[answer[i]]] === p.right : item.key.perm[answer[i]] === i,
      );
      const right = marks.filter(Boolean).length;
      return { answer: answer.map((j) => (j === null || j === undefined ? null : item.key.perm[j])), credit: q.scoring === 'all' ? (right === q.pairs.length ? 1 : 0) : fraction(right, q.pairs.length), marks };
    }
    case 'ordering': {
      // raw[j] = posición (0 = primero) que el alumno le dio al elemento que vio en el lugar j.
      const answer = ints(raw, q.items.length);
      const marks = item.key.order.map((original, j) => answer[j] === original);
      const right = marks.filter(Boolean).length;
      return { answer, credit: q.scoring === 'all' ? (right === q.items.length ? 1 : 0) : fraction(right, q.items.length), marks };
    }
    case 'essay': {
      if (typeof raw !== 'string') bad();
      return { answer: raw.slice(0, MAX_ESSAY), credit: 0, manual: true };
    }
    case 'short': {
      if (typeof raw !== 'string') bad();
      const value = parseNumber(raw);
      const near = q.tolerance !== undefined && Number.isFinite(value)
        ? q.answers.some((a) => alternatives(a).some((alt) => Number.isFinite(parseNumber(alt)) && Math.abs(parseNumber(alt) - value) <= q.tolerance + 1e-12))
        : false;
      return { answer: raw.slice(0, MAX_ANSWER), credit: near || q.answers.some((a) => matches(raw, a, q.exact)) ? 1 : 0 };
    }
    case 'multishort': {
      const answer = strings(raw, q.boxes);
      // Cada respuesta aceptada cuenta una sola vez (escribir dos veces la misma no suma).
      const used = new Set();
      const marks = answer.map((value) => {
        const k = q.answers.findIndex((a, i) => !used.has(i) && value.trim() && matches(value, a, q.exact));
        if (k < 0) return false;
        used.add(k);
        return true;
      });
      return { answer, credit: fraction(marks.filter(Boolean).length, q.boxes), marks };
    }
    case 'sigfig': {
      const value = parseNumber(raw);
      if (!Number.isFinite(value)) fail(`Escribe un número en la pregunta ${position} (por ejemplo 9.81 o 1.20e3).`);
      const expected = evaluateAnswer(q, item.values);
      const allowed = Math.max(Math.abs(expected) * (q.tolerance / 100), 1e-12);
      const close = Math.abs(value - expected) <= allowed;
      const figures = significantFigures(raw);
      const credit = !close ? 0 : figures === q.figures ? 1 : Math.max(0, 1 - q.penalty / 100);
      return { answer: String(raw).trim().slice(0, 60), credit, figures };
    }
  }
  return bad();
}

/** Respuesta guardada a medio examen (se valida de verdad al enviar): números, textos o listas cortas de ellos. */
export function cleanSaved(value) {
  if (Number.isInteger(value)) return value;
  if (typeof value === 'string') return value.trim() ? value.slice(0, MAX_ESSAY) : undefined;
  if (Array.isArray(value) && value.length <= 20) {
    return value.map((x) => (Number.isInteger(x) ? x : x === null ? null : String(x ?? '').slice(0, MAX_ANSWER)));
  }
  return undefined;
}
