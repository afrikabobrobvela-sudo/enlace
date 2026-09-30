// Evaluaciones: preguntas de opción múltiple y numéricas (con tolerancia, unidades y datos aleatorios por alumno),
// varios intentos, tiempo límite y orden aleatorio. Todo se califica en el servidor.
import { distanceMeters } from './attendance.js';
import { NEW_TYPES, gradeNew, instanceNew, publicNew, validateNew } from './reactivos.js';
import { fail, isoDate, text } from './http.js';

// 12.27: un banco de Brightspace completo (121 preguntas en 12 grupos) cabe en una sola evaluación.
export const MAX_QUESTIONS = 300;
const MAX_POOL_NAME = 80;
const TIME_GRACE_MS = 60_000; // margen para la conexión al enviar
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]{0,15}$/;

// ---- Fórmulas seguras (sin eval) ------------------------------------------------------------------
// Números, variables, + - * / ^, paréntesis y funciones comunes. Se usa para la respuesta de las preguntas numéricas.

const FUNCTIONS = {
  sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
  atan: Math.atan, exp: Math.exp, ln: Math.log, log: Math.log10, round: Math.round,
};
const CONSTANTS = { pi: Math.PI, e: Math.E, g: 9.81 };

function tokenize(source) {
  const tokens = [];
  const re = /\s*(?:(\d+(?:[.,]\d+)?(?:e[+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|[-+*/^(),]))/iy;
  let pos = 0;
  const input = String(source);
  while (pos < input.length) {
    if (/^\s*$/.test(input.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(input);
    if (!m) throw new Error(`Símbolo no válido cerca de "${input.slice(pos, pos + 8)}"`);
    pos = re.lastIndex;
    if (m[1] !== undefined) tokens.push({ t: 'num', v: Number(m[1].replace(',', '.')) });
    else if (m[2] !== undefined) tokens.push({ t: 'id', v: m[2] });
    else tokens.push({ t: 'op', v: m[3] === '**' ? '^' : m[3] });
  }
  return tokens;
}

/** Evalúa una fórmula con las variables dadas. Lanza Error con un mensaje en español si no es válida. */
export function evaluate(formula, vars = {}) {
  const tokens = tokenize(formula);
  if (tokens.length > 200) throw new Error('La fórmula es demasiado larga.');
  let i = 0;
  const peek = () => tokens[i];
  const take = (v) => (tokens[i]?.v === v ? tokens[i++] : null);
  const expression = () => {
    let value = term();
    for (let op; (op = take('+') || take('-')); ) value = op.v === '+' ? value + term() : value - term();
    return value;
  };
  const term = () => {
    let value = unary();
    for (let op; (op = take('*') || take('/')); ) value = op.v === '*' ? value * unary() : value / unary();
    return value;
  };
  const unary = () => (take('-') ? -unary() : take('+') ? unary() : power());
  const power = () => {
    const base = primary();
    return take('^') ? base ** unary() : base; // asociativa a la derecha: 2^3^2 = 2^9
  };
  const primary = () => {
    const token = tokens[i++];
    if (!token) throw new Error('La fórmula está incompleta.');
    if (token.t === 'num') return token.v;
    if (token.t === 'op' && token.v === '(') {
      const value = expression();
      if (!take(')')) throw new Error('Falta cerrar un paréntesis.');
      return value;
    }
    if (token.t === 'id') {
      const name = token.v;
      if (take('(')) {
        const fn = FUNCTIONS[name.toLowerCase()];
        if (!fn) throw new Error(`Función desconocida: ${name}`);
        const arg = expression();
        if (!take(')')) throw new Error('Falta cerrar un paréntesis.');
        return fn(arg);
      }
      if (Object.hasOwn(vars, name)) return vars[name];
      if (Object.hasOwn(CONSTANTS, name)) return CONSTANTS[name];
      throw new Error(`Variable desconocida: ${name}`);
    }
    throw new Error(`Símbolo inesperado: ${token.v}`);
  };
  const value = expression();
  if (i < tokens.length) throw new Error(`Símbolo inesperado: ${peek().v}`);
  if (!Number.isFinite(value)) throw new Error('La fórmula no da un número (¿división entre cero?).');
  return value;
}

// ---- Azar reproducible por alumno e intento ------------------------------------------------------

function seedOf(value) {
  let h = 2166136261;
  for (const ch of String(value)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function generator(seed) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Validación al guardar -------------------------------------------------------------------------

function validVariables(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 8) fail('Usa como máximo 8 variables por pregunta.');
  const names = new Set();
  return input.map((v) => {
    const name = String(v?.name ?? '').trim();
    if (!VARIABLE.test(name) || Object.hasOwn(CONSTANTS, name)) fail(`Nombre de variable no válido: "${name}". Usa letras y números, por ejemplo v0.`);
    if (names.has(name)) fail(`La variable ${name} está repetida.`);
    names.add(name);
    const min = Number(v.min);
    const max = Number(v.max);
    const decimals = Number(v.decimals ?? 0);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) fail(`Revisa el rango de ${name}: mínimo y máximo.`);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 4) fail(`Los decimales de ${name} van de 0 a 4.`);
    return { name, min, max, decimals };
  });
}

/**
 * Valida y normaliza una pregunta (de una evaluación o del banco). `pool` es el grupo del que se sortean preguntas
 * («tomar 3 de las 10 de Cinemática»); en el banco no se guarda (ahí el tema hace ese papel).
 */
export function questionFields(q, label) {
  if (!q || typeof q !== 'object') fail(`${label}: pregunta no válida.`);
  const type = NEW_TYPES.includes(q.type) ? q.type : q.type === 'numeric' ? 'numeric' : 'choice';
  const prompt = text(q.text, 3000);
  // Imagen de la pregunta (archivo del docente en el curso; el servidor comprueba que exista al guardar).
  const image = typeof q.image === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(q.image) ? { image: q.image } : {};
  const poolName = String(q.pool ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_POOL_NAME);
  const pool = poolName ? { pool: poolName } : {};
  let fields;
  if (type === 'choice') {
    const validOptions =
      Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 6 && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.options.length;
    if (!validOptions) fail(`${label}: agrega de 2 a 6 opciones y marca la correcta.`);
    fields = { options: q.options.map((o) => text(o, 1500)), correct: q.correct, ...choiceWeights(q, label) };
  } else if (type !== 'numeric') fields = validateNew(type, q, label, numericFields);
  else fields = numericFields(q, label);
  return { type, text: prompt, ...fields, ...extraFields(q, label, fields.options), ...image, ...pool };
}

/**
 * Crédito parcial por opción (12.27, como los «pesos» de Brightspace): `weights[k]` es el % que vale elegir la opción k.
 * La marcada como correcta siempre vale 100 %. Solo se guarda si alguna otra opción da crédito.
 */
function choiceWeights(q, label) {
  if (!Array.isArray(q.weights)) return {};
  if (q.weights.length !== q.options.length) fail(`${label}: indica el crédito de cada opción.`);
  const weights = q.weights.map((w) => {
    const n = Number(w ?? 0);
    if (!Number.isFinite(n) || n < 0 || n > 100) fail(`${label}: el crédito de cada opción va de 0 a 100 %.`);
    return Math.round(n * 100) / 100;
  });
  weights[q.correct] = 100;
  return weights.some((w, k) => k !== q.correct && w > 0) ? { weights } : {};
}

/**
 * Lo opcional de cualquier pregunta (12.23): su valor en puntos (1 si no se indica: así todas valen lo mismo, como
 * antes), la retroalimentación que ve el alumno al revisar y, en opción y selección múltiple, un comentario por opción.
 */
function extraFields(q, label, options) {
  const extra = {};
  if (q.points !== undefined && q.points !== null && q.points !== '') {
    const points = Number(q.points);
    if (!Number.isFinite(points) || points < 0.1 || points > 100) fail(`${label}: el valor de la pregunta va de 0.1 a 100 puntos.`);
    if (points !== 1) extra.points = Math.round(points * 100) / 100;
  }
  const explanation = String(q.explanation ?? '').trim().slice(0, 3000);
  if (explanation) extra.explanation = explanation;
  // Pista (12.27): la ve el alumno mientras contesta, si la abre.
  const hint = String(q.hint ?? '').trim().slice(0, 1000);
  if (hint) extra.hint = hint;
  if (options && Array.isArray(q.optionFeedback)) {
    const notes = options.map((_, i) => String(q.optionFeedback[i] ?? '').trim().slice(0, 1000));
    if (notes.some(Boolean)) extra.optionFeedback = notes;
  }
  return extra;
}

/** Respuesta con fórmula, datos aleatorios, tolerancia y unidad («Aritmética» y «Cifras significativas»). */
function numericFields(q, label) {
  const variables = validVariables(q.variables);
  const answer = text(String(q.answer ?? ''), 300);
  const tolerance = Number(q.tolerance ?? 1);
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 50) fail(`${label}: la tolerancia va de 0 a 50 %.`);
  // La fórmula debe dar un número en los extremos del rango de las variables.
  for (const pick of ['min', 'max']) {
    const vars = Object.fromEntries(variables.map((v) => [v.name, v[pick]]));
    try {
      evaluate(answer, vars);
    } catch (error) {
      fail(`${label}: la respuesta no se puede calcular (${error.message}).`);
    }
  }
  return { answer, tolerance, unit: String(q.unit ?? '').trim().slice(0, 30), variables };
}

/**
 * Preguntas al azar: de cada grupo, cada alumno recibe `count` preguntas (distintas para cada alumno e intento).
 * Solo se guardan los grupos que existen y en los que se toman menos de las que hay.
 */
function drawFields(input, questions) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 20) fail('Revisa las preguntas al azar.');
  const sizes = new Map();
  for (const q of questions) if (q.pool) sizes.set(q.pool, (sizes.get(q.pool) || 0) + 1);
  const seen = new Set();
  const draw = [];
  for (const entry of input) {
    const pool = String(entry?.pool ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_POOL_NAME);
    const count = Number(entry?.count);
    if (!pool || seen.has(pool)) continue;
    seen.add(pool);
    const size = sizes.get(pool);
    if (!size) fail(`No hay preguntas en el grupo «${pool}».`);
    if (!Number.isInteger(count) || count < 1) fail(`Grupo «${pool}»: toma al menos una pregunta.`);
    if (count < size) draw.push({ pool, count });
  }
  return draw;
}

/** Cuántas preguntas recibe cada alumno (con preguntas al azar, menos que las de la evaluación). */
export function questionCount(data) {
  const questions = data?.questions || [];
  let n = questions.length;
  for (const { pool, count } of data?.settings?.draw || []) n -= questions.filter((q) => q.pool === pool).length - count;
  return n;
}

/** Valida y normaliza las preguntas y la configuración de una evaluación. */
export function quizFields(input) {
  if (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > MAX_QUESTIONS) {
    fail(`Agrega de una a ${MAX_QUESTIONS} preguntas.`);
  }
  const questions = input.questions.map((q, n) => questionFields(q, `Pregunta ${n + 1}`));
  const draw = drawFields(input.settings?.draw, questions);
  const attempts = Number(input.settings?.attempts ?? 1);
  const timeLimit = Number(input.settings?.timeLimit ?? 0);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) fail('Los intentos van de 1 a 10.');
  if (!Number.isInteger(timeLimit) || timeLimit < 0 || timeLimit > 300) fail('El tiempo límite va de 0 (sin límite) a 300 minutos.');
  // Disponibilidad: desde cuándo se puede empezar y hasta cuándo (al cerrar, termina también lo que esté en curso).
  const opensAt = isoDate(input.settings?.opensAt || '');
  const closesAt = isoDate(input.settings?.closesAt || '');
  if (opensAt && closesAt && closesAt <= opensAt) fail('La fecha final debe ser posterior a la de inicio.');
  // Temporizador: por intento (desde que cada alumno empieza) o fijo (desde la hora de inicio, igual para todos).
  const timerMode = input.settings?.timerMode === 'fixed' ? 'fixed' : 'attempt';
  if (timerMode === 'fixed' && (!opensAt || !timeLimit)) fail('Para que el tiempo empiece a la hora de inicio, indica la fecha de inicio y el tiempo límite.');
  // Qué ve el alumno al terminar: su calificación (o «pendiente») y si acertó cada pregunta.
  // `releaseAt`: hasta esa fecha el alumno no ve nada (ni calificación ni aciertos), por ejemplo mientras otros
  // grupos aún no presentan; después, lo que indiquen las casillas.
  // Preguntas por página (12.27; 0 = todas juntas). En el modo examen «una pregunta a la vez» manda.
  const perPage = Number(input.settings?.perPage ?? 0);
  if (!Number.isInteger(perPage) || perPage < 0 || perPage > 50) fail('Las preguntas por página van de 0 (todas juntas) a 50.');
  const releaseAt = isoDate(input.settings?.results?.releaseAt || '');
  const results = {
    score: input.settings?.results?.score !== false,
    review: input.settings?.results?.review === 'none' ? 'none' : 'marks',
    ...(releaseAt ? { releaseAt } : {}),
  };
  return {
    questions,
    settings: {
      attempts,
      timeLimit,
      shuffle: input.settings?.shuffle === true,
      // Cada alumno ve las opciones de cada pregunta en otro orden (se califica con el orden original).
      shuffleOptions: input.settings?.shuffleOptions === true,
      ...(draw.length ? { draw } : {}),
      ...(opensAt ? { opensAt } : {}),
      ...(closesAt ? { closesAt } : {}),
      timerMode,
      ...(perPage ? { perPage } : {}),
      results,
      exam: examFields(input.settings?.exam),
      ...sebFields(input.settings?.seb),
    },
  };
}

// ---- Safe Exam Browser (12.27; 12.28: con un solo botón) ---------------------------------------------------
// Enlace arma la configuración de SEB de la evaluación y la revisa (seb.js). Opcionalmente, el docente puede además
// aceptar las Config Keys de su propio archivo .seb. Las llaves nunca llegan al alumno.

const SEB_KEY = /^[0-9a-f]{64}$/;

/** `{ seb: { required, keys } }` si la evaluación exige Safe Exam Browser. */
function sebFields(input) {
  if (!input || input.required !== true) return {};
  const keys = [...new Set((Array.isArray(input.keys) ? input.keys : String(input.keys ?? '').split(/[\s,;]+/)).map((k) => String(k).trim().toLowerCase()).filter(Boolean))];
  if (keys.length > 10 || keys.some((k) => !SEB_KEY.test(k))) fail('Cada llave de Safe Exam Browser tiene 64 caracteres hexadecimales (0-9 y a-f). Puedes pegar hasta 10, o dejarlo vacío para usar la configuración de Enlace.');
  return { seb: { required: true, ...(keys.length ? { keys } : {}) } };
}

// ---- Modo examen ---------------------------------------------------------------------------------

export const EXAM_RADII = [100, 150, 300, 500];
// Bloqueo al salir: segundos fuera de la página que se toleran (una notificación, un toque sin querer).
export const LOCK_GRACES = [0, 5, 15, 30];
export const MAX_UNLOCK_FAILURES = 5;
export const MAX_PASSWORD_FAILURES = 10;
const EVENT_KINDS = ['left', 'fullscreen', 'copy', 'capture'];
const MAX_EVENTS = 200;

/** Configuración del modo examen (null si está desactivado). La contraseña y el salón nunca llegan al alumno. */
function examFields(input) {
  if (!input || input.enabled !== true) return null;
  const password = String(input.password ?? '').trim();
  if (password && (password.length < 4 || password.length > 30)) fail('La contraseña del examen debe tener de 4 a 30 caracteres.');
  let place = null;
  if (input.place) {
    const lat = Number(input.place.lat);
    const lng = Number(input.place.lng);
    const radius = Number(input.place.radius);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) fail('Ubicación del salón no válida.');
    if (!EXAM_RADII.includes(radius)) fail('Distancia máxima no válida.');
    const accuracy = Math.min(Math.max(Number(input.place.accuracy) || 0, 0), 5000);
    place = { lat, lng, accuracy, radius };
  }
  const oneByOne = input.oneByOne === true;
  const lockOnLeave = input.lockOnLeave === true;
  const lockGrace = LOCK_GRACES.includes(Number(input.lockGrace)) ? Number(input.lockGrace) : 5;
  // lockPlatform: mientras contesta, Enlace solo le responde el examen (ni otros cursos ni materiales).
  return { enabled: true, password, oneByOne, noBack: oneByOne && input.noBack === true, place, lockOnLeave, lockGrace: lockOnLeave ? lockGrace : 0, lockPlatform: input.lockPlatform === true };
}

/** Lo que el alumno sabe del modo examen: si pide contraseña o ubicación, pero no cuáles son. */
export function publicSettings(settings) {
  if (!settings) return settings;
  // El código de la sección del alumno (startCode) tampoco llega: solo se avisa que hace falta uno.
  const { startCode, seb, ...rest } = settings;
  // Safe Exam Browser: el alumno sabe que se exige, no las llaves.
  if (seb) rest.needsSeb = true;
  if (!rest.exam) return startCode ? { ...rest, needsCode: true } : rest;
  const { password, place, ...exam } = rest.exam;
  return { ...rest, ...(startCode || password ? { needsCode: true } : {}), exam: { ...exam, needsPassword: Boolean(startCode || password), checksLocation: Boolean(place) } };
}

/** Código que el alumno debe escribir para empezar: el de su sección o, si no hay, la contraseña del modo examen. */
export const startCodeOf = (settings) => settings?.startCode || settings?.exam?.password || '';

/** Eventos que envía el navegador durante el examen (salir de la pantalla, de pantalla completa, copiar o pegar, captura de pantalla). */
export function validEvents(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 20).map((e) => {
    if (!EVENT_KINDS.includes(e?.kind)) fail('Evento no válido.');
    const seconds = Math.round(Number(e.seconds ?? 0));
    return { kind: e.kind, seconds: Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0), 86_400) : 0, at: new Date().toISOString() };
  });
}

export const MAX_EXAM_EVENTS = MAX_EVENTS;

const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

/** Revisa la ubicación del alumno al empezar contra la del salón. Solo marca para revisar; nunca impide el examen. */
export function examPlaceCheck(quiz, location, locationError) {
  const place = quiz.data.settings?.exam?.place;
  if (!place) return { flag: '', distance: null };
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  const accuracy = Number(location?.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { flag: locationError === 'denied' ? 'no permitió ver su ubicación' : 'no se obtuvo su ubicación', distance: null };
  }
  const acc = Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : 1000;
  if (acc > 2000) return { flag: `ubicación muy imprecisa (±${km(acc)})`, distance: null };
  const distance = distanceMeters(place, { lat, lng });
  const margin = Math.min(acc, 250) + Math.min(place.accuracy || 0, 250);
  return { flag: distance > place.radius + margin ? `a ${km(distance)} del salón` : '', distance: Math.round(distance) };
}

/** Resumen para el docente: cuántas veces salió, cuánto tiempo, y el motivo de revisión de la ubicación. */
export function integritySummary(start) {
  if (!start) return null;
  let events = [];
  try {
    events = JSON.parse(start.events || '[]');
  } catch {
    events = [];
  }
  const left = events.filter((e) => e.kind === 'left');
  return {
    exits: left.length,
    awaySeconds: left.reduce((n, e) => n + (e.seconds || 0), 0),
    fullscreenExits: events.filter((e) => e.kind === 'fullscreen').length,
    copyAttempts: events.filter((e) => e.kind === 'copy').length,
    captures: events.filter((e) => e.kind === 'capture').length,
    locks: events.filter((e) => e.kind === 'locked').length,
    flag: start.flag || '',
    distance: start.distance ?? null,
    events: events.slice(-50),
  };
}

/**
 * Respuestas finales. Si el examen es "sin regresar", las preguntas que ya se dejaron atrás conservan lo guardado
 * al avanzar: no se pueden cambiar al final.
 */
export function finalAnswers(quiz, instance, start, submitted) {
  const answers = submitted && typeof submitted === 'object' ? { ...submitted } : {};
  if (!quiz.data.settings?.exam?.noBack || !start) return answers;
  let saved = {};
  try {
    saved = JSON.parse(start.progress || '{}') || {};
  } catch {
    saved = {};
  }
  instance.slice(0, start.position).forEach((q) => {
    if (Object.hasOwn(saved, q.index)) answers[q.index] = saved[q.index];
    else delete answers[q.index];
  });
  return answers;
}

/** Forma canónica de una pregunta (las de versiones anteriores no tienen `type`: son de opción múltiple). */
const canonical = (q) => {
  if (NEW_TYPES.includes(q.type)) {
    const { image: _image, points: _p, explanation: _e, optionFeedback: _o, hint: _h, ...rest } = q;
    return rest;
  }
  return canonicalOld(q);
};
const canonicalOld = (q) => ({
  ...(q.type === 'numeric'
    ? { type: 'numeric', text: q.text, answer: q.answer, tolerance: q.tolerance, unit: q.unit, variables: q.variables }
    : { type: 'choice', text: q.text, options: q.options, correct: q.correct, ...(q.weights ? { weights: q.weights } : {}) }),
  ...(q.pool ? { pool: q.pool } : {}),
});

/**
 * Lo que se puede corregir aunque ya haya intentos (12.23): la clave (respuesta correcta, respuestas aceptadas,
 * tolerancia, forma de calificar), el valor en puntos y la retroalimentación. Lo demás (enunciado, opciones, datos,
 * parejas…) es lo que el alumno vio: no cambia. En «Para completar», las respuestas van dentro de [[ ]] del enunciado.
 */
const KEY_FIELDS = ['correct', 'answer', 'answers', 'tolerance', 'scoring', 'exact', 'figures', 'penalty', 'points', 'explanation', 'optionFeedback', 'image', 'guide', 'hint', 'weights'];
/** JSON con las llaves ordenadas (las preguntas de versiones anteriores guardan sus campos en otro orden). */
const stable = (value) =>
  Array.isArray(value)
    ? `[${value.map(stable).join(',')}]`
    : value && typeof value === 'object'
    ? `{${Object.keys(value)
        .filter((k) => value[k] !== undefined)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
        .join(',')}}`
    : JSON.stringify(value);
/** Lo que vio el alumno de una pregunta (sin la clave). Las de versiones anteriores no tienen `type`: son de opción múltiple. */
function structureOf(q) {
  const type = q.type || 'choice';
  if (type === 'choice') return { type, text: q.text, options: q.options, pool: q.pool || '' };
  if (type === 'numeric') return { type, text: q.text, unit: q.unit || '', variables: q.variables || [], pool: q.pool || '' };
  const base = { ...q, type, pool: q.pool || '' };
  for (const key of KEY_FIELDS) delete base[key];
  if (type === 'fill') base.text = String(base.text).replace(/\[\[[^\]]{1,200}\]\]/g, '[[ ]]');
  return base;
}
/** La clave con la que se califica (y los puntos). */
function keyOf(q) {
  const type = q.type || 'choice';
  const points = q.points || 1;
  if (type === 'choice') return { correct: q.correct, points, ...(q.weights ? { weights: q.weights } : {}) };
  if (type === 'numeric') return { answer: q.answer, tolerance: q.tolerance, points };
  const { explanation: _e, optionFeedback: _o, image: _i, guide: _g, hint: _h, ...rest } = q;
  return { ...rest, type, points };
}

/** ¿Es la misma evaluación para lo que el alumno vio? (con intentos solo se permite corregir la clave y los puntos). */
export const sameStructure = (a, b) => stable((a || []).map(structureOf)) === stable((b || []).map(structureOf));

/** ¿Cambió algo que afecta la calificación? (clave o puntos): entonces se recalifican los intentos. */
export const keyChanged = (a, b) => stable((a || []).map(keyOf)) !== stable((b || []).map(keyOf));

/**
 * ¿Se arma igual cada intento? Con intentos registrados no se permite cambiar las preguntas al azar ni el orden
 * aleatorio de preguntas u opciones: así cada intento se puede volver a calificar con lo que vio el alumno.
 */
export const sameDraw = (a, b) =>
  JSON.stringify([a?.draw || [], Boolean(a?.shuffle), Boolean(a?.shuffleOptions)]) === JSON.stringify([b?.draw || [], Boolean(b?.shuffle), Boolean(b?.shuffleOptions)]);

/** La respuesta guardada de una pregunta, como la contestó el alumno (posiciones en su pantalla). */
function rawAnswer(q, d, item) {
  const type = q.type || 'choice';
  if (type === 'choice') return item?.perm ? item.perm.indexOf(d.answer) : d.answer;
  if (type === 'truefalse') return d.answer === true ? 0 : 1;
  if (type === 'multi') return d.answer.map((o) => item.key.perm.indexOf(o));
  if (type === 'matching') return d.answer.map((o) => (o === null || o === undefined ? null : item.key.perm.indexOf(o)));
  return d.answer;
}

/**
 * Vuelve a calificar un intento con la clave actual (después de que el docente la corrige). Lo calificado a mano
 * (respuestas escritas revisadas y ajustes del docente) se conserva. Devuelve null si el intento no se puede recalificar.
 */
export function regradeAttempt(quiz, row) {
  let details;
  try {
    details = JSON.parse(row.details || 'null');
  } catch {
    return null;
  }
  if (!Array.isArray(details)) return null;
  const instance = quizInstance(quiz, row.user_id, row.attempt || 1);
  const items = new Map(instance.map((item) => [item.index, item]));
  if (details.some((d) => !items.has(d.index) || !quiz.data.questions[d.index])) return null;
  const answers = {};
  for (const d of details) if (d.answer !== null && d.answer !== undefined) answers[d.index] = rawAnswer(quiz.data.questions[d.index], d, items.get(d.index));
  let graded;
  try {
    graded = gradeAttempt(quiz, details.map((d) => items.get(d.index)), answers);
  } catch {
    return null;
  }
  const merged = graded.details.map((nd) => {
    const od = details.find((d) => d.index === nd.index);
    if (od && (od.overridden || (od.manual && od.reviewed))) {
      return { ...nd, credit: od.credit, correct: od.correct, reviewed: od.reviewed, feedback: od.feedback, ...(od.overridden ? { overridden: true } : {}) };
    }
    return od?.feedback ? { ...nd, feedback: od.feedback } : nd;
  });
  return { details: merged, ...scoreOf(merged, quiz.data.questions) };
}

/** Huella de una pregunta del banco (sin imagen ni grupo): la misma pregunta no se guarda dos veces. */
export const questionFingerprint = async (q) => {
  const { pool: _pool, ...rest } = canonical(q);
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rest))));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Lo que el alumno ve de las preguntas antes de empezar (sin respuestas ni fórmulas). */
export function publicQuestions(questions) {
  const image = (q) => ({ ...(q.image ? { image: q.image } : {}), ...(q.points ? { points: q.points } : {}) });
  return questions.map((q) =>
    NEW_TYPES.includes(q.type) ? publicNew(q) : q.type === 'numeric' ? { type: q.type, text: q.text, unit: q.unit, ...image(q) } : { type: 'choice', text: q.text, options: q.options, ...image(q) },
  );
}

// ---- Intento de un alumno --------------------------------------------------------------------------

/** Preguntas de un intento: valores de las variables y orden, siempre iguales para el mismo alumno e intento. */
export function quizInstance(quiz, userId, attempt) {
  const random = generator(seedOf(`${quiz.id}:${userId}:${attempt}`));
  const valuesOf = (q, rnd) => Object.fromEntries((q.variables || []).map((v) => [v.name, Number((v.min + rnd() * (v.max - v.min)).toFixed(v.decimals))]));
  const showValues = (q, values) => q.text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (all, name) => (Object.hasOwn(values, name) ? String(values[name]) : all));
  const withHint = (item, q) => (q.hint ? { ...item, hint: q.hint } : item);
  const questions = quiz.data.questions.map((q, index) => withHint(instanceOf(q, index), q));
  function instanceOf(q, index) {
    if (NEW_TYPES.includes(q.type)) {
      // Azar propio de cada pregunta: así las evaluaciones de antes (solo opción múltiple y aritmética) conservan sus instancias.
      const own = generator(seedOf(`${quiz.id}:${userId}:${attempt}:q${index}`));
      const values = q.type === 'sigfig' ? valuesOf(q, own) : undefined;
      return instanceNew(q, index, own, { shuffleOptions: quiz.data.settings?.shuffleOptions, values, shown: values ? showValues(q, values) : q.text });
    }
    const points = q.points ? { points: q.points } : {};
    if (q.type !== 'numeric') return { index, type: 'choice', text: q.text, options: q.options, ...points, ...(q.image ? { image: q.image } : {}) };
    const values = valuesOf(q, random);
    return { index, type: 'numeric', text: showValues(q, values), unit: q.unit, values, ...points, ...(q.image ? { image: q.image } : {}) };
  }
  if (quiz.data.settings?.shuffle) {
    for (let i = questions.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [questions[i], questions[j]] = [questions[j], questions[i]];
    }
  }
  // Opciones en otro orden: `perm[j]` es la opción original que el alumno ve en la posición j. Se genera después
  // del orden de preguntas, así las evaluaciones sin esta opción conservan exactamente sus instancias anteriores.
  if (quiz.data.settings?.shuffleOptions) {
    for (const item of questions) {
      if (item.type !== 'choice') continue;
      const perm = item.options.map((_, i) => i);
      for (let i = perm.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }
      item.perm = perm;
      item.options = perm.map((i) => item.options[i]);
    }
  }
  // Preguntas al azar: de cada grupo se quedan `count` (se sortea al final, así las evaluaciones sin grupos
  // conservan exactamente sus instancias anteriores). Las que quedan mantienen su orden.
  const draw = quiz.data.settings?.draw || [];
  if (draw.length) {
    const drop = new Set();
    for (const { pool, count } of draw) {
      const members = questions.filter((item) => quiz.data.questions[item.index].pool === pool).map((item) => item.index);
      for (let i = members.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [members[i], members[j]] = [members[j], members[i]];
      }
      for (const index of members.slice(count)) drop.add(index);
    }
    return questions.filter((item) => !drop.has(item.index));
  }
  return questions;
}

/** Acepta "9.8", "9,8", "1.2e3" o "-3". */
export function parseNumber(value) {
  if (typeof value === 'number') return value;
  const clean = String(value ?? '').trim().replace(/\s+/g, '').replace(',', '.');
  return /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(clean) ? Number(clean) : NaN;
}

/**
 * Califica un intento. `answers` es un objeto { índice original: respuesta } (o un arreglo, como en la versión 8).
 * Devuelve aciertos, total, calificación de 0 a 10 y el detalle por pregunta (para mostrar ✓/✗).
 */
export function gradeAttempt(quiz, instance, answers) {
  const byIndex = Array.isArray(answers) ? Object.fromEntries(answers.map((a, i) => [i, a])) : answers && typeof answers === 'object' ? answers : null;
  if (!byIndex) fail('Responde la evaluación.');
  const questions = quiz.data.questions;
  const details = instance.map((item, n) => {
    const q = questions[item.index];
    const raw = byIndex[item.index];
    const values = item.values ? { values: item.values } : {};
    // Sin respuesta (por ejemplo, si se acabó el tiempo) cuenta como incorrecta.
    const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.every((x) => x === null || x === ''));
    if (empty) return { index: item.index, answer: null, correct: false, credit: 0, ...values };
    if (NEW_TYPES.includes(q.type)) {
      const r = gradeNew(q, item, raw, { evaluateAnswer: (x, v) => evaluate(x.answer, v), parseNumber, position: n + 1 });
      const credit = r.credit;
      return { index: item.index, ...r, credit, correct: credit === 1, ...(r.manual ? { reviewed: false } : {}), ...values };
    }
    if (q.type !== 'numeric') {
      if (!Number.isInteger(raw) || raw < 0 || raw >= q.options.length) fail('Respuesta no válida.');
      // El alumno responde con la posición que vio; con opciones mezcladas se traduce a la opción original.
      const original = item.perm ? item.perm[raw] : raw;
      const ok = original === q.correct;
      // Con crédito parcial por opción (12.27), otra opción puede valer una parte.
      const credit = ok ? 1 : q.weights ? (q.weights[original] || 0) / 100 : 0;
      return { index: item.index, answer: original, correct: ok, credit };
    }
    const value = parseNumber(raw);
    if (!Number.isFinite(value)) fail(`Escribe un número en la pregunta ${n + 1} (por ejemplo 9.8).`);
    const expected = evaluate(q.answer, item.values);
    const allowed = Math.max(Math.abs(expected) * (q.tolerance / 100), 1e-9);
    const ok = Math.abs(value - expected) <= allowed;
    return { index: item.index, answer: value, correct: ok, credit: ok ? 1 : 0, ...values };
  });
  return { ...scoreOf(details, questions), details };
}

/**
 * Aciertos y calificación a partir del detalle: cada pregunta vale sus puntos (1 si no se indica, 12.23) y da
 * crédito parcial (0 a 1). Con
 * preguntas al azar, el total es lo que recibió el alumno. Las respuestas escritas sin revisar cuentan 0 y quedan
 * en `pending` hasta que el docente las califique.
 */
export function scoreOf(details, questions = []) {
  const weight = (d) => questions[d.index]?.points || 1;
  const credit = details.reduce((sum, d) => sum + weight(d) * (typeof d.credit === 'number' ? d.credit : d.correct ? 1 : 0), 0);
  const possible = details.reduce((sum, d) => sum + weight(d), 0);
  return {
    correct: details.filter((d) => d.correct).length,
    total: details.length,
    score: possible ? (credit / possible) * 10 : 0,
    pending: details.filter((d) => d.manual && !d.reviewed).length,
  };
}

/** ¿Sigue abierto el intento? Con tiempo límite, hasta el inicio + límite (+1 min de margen). */
export function deadlineOf(quiz, started) {
  const settings = quiz.data.settings || {};
  const minutes = settings.timeLimit || 0;
  // Con temporizador fijo cuenta desde la hora de inicio (igual para todos); si no, desde que empezó el alumno.
  const from = settings.timerMode === 'fixed' && settings.opensAt ? settings.opensAt : started;
  let deadline = minutes ? new Date(Date.parse(from) + minutes * 60_000).toISOString() : null;
  // La fecha final corta cualquier intento en curso.
  if (settings.closesAt && (!deadline || settings.closesAt < deadline)) deadline = settings.closesAt;
  return deadline;
}

/** ¿Se puede empezar un intento ahora? (fechas de disponibilidad) */
export function assertOpen(quiz, now = Date.now()) {
  const { opensAt, closesAt } = quiz.data.settings || {};
  const when = (iso) => new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' });
  if (opensAt && now < Date.parse(opensAt)) fail(`Esta evaluación se abre el ${when(opensAt)}.`, 403);
  if (closesAt && now > Date.parse(closesAt)) fail(`Esta evaluación cerró el ${when(closesAt)}.`, 403);
}

/**
 * Lo que el alumno recibe de sus intentos según «qué ve al terminar»: sin calificación (pendiente de publicar) y/o
 * sin el detalle de qué preguntas acertó. El docente siempre recibe todo.
 */
export function studentAttemptView(record, quiz, now = Date.now()) {
  const results = quiz?.data.settings?.results || { score: true, review: 'marks' };
  const data = { ...record.data };
  if (results.releaseAt && now < Date.parse(results.releaseAt)) {
    Object.assign(data, { score: null, correct: null, hidden: true, releaseAt: results.releaseAt, details: null, answers: null });
    return { ...record, data };
  }
  if (results.score === false) Object.assign(data, { score: null, correct: null, hidden: true, pending: undefined });
  if (results.review === 'none' || results.score === false) {
    // Sin «qué preguntas acertó», los comentarios del docente (respuestas escritas) sí llegan, si se ve la calificación.
    const feedback = results.score === false ? [] : (data.details || []).filter((d) => d.feedback).map((d) => ({ index: d.index, credit: d.credit, feedback: d.feedback }));
    Object.assign(data, { details: null, answers: null, ...(feedback.length ? { feedback } : {}) });
  } else if (data.details && quiz) {
    // Con «qué preguntas acertó»: la retroalimentación de cada pregunta y la de las opciones que eligió (12.23).
    data.details = data.details.map((d) => {
      const q = quiz.data.questions[d.index];
      if (!q) return d;
      const extra = {};
      if (q.explanation) extra.explanation = q.explanation;
      if (q.optionFeedback) {
        const chosen = Array.isArray(d.answer) ? d.answer : [d.answer];
        const notes = chosen.filter((i) => Number.isInteger(i) && q.optionFeedback[i]).map((i) => q.optionFeedback[i]);
        if (notes.length) extra.optionNotes = notes;
      }
      return { ...d, ...extra };
    });
  }
  return { ...record, data };
}

export function assertInTime(quiz, started) {
  const deadline = deadlineOf(quiz, started);
  if (deadline && Date.now() > Date.parse(deadline) + TIME_GRACE_MS) fail('Se terminó el tiempo de este intento.', 409);
}
