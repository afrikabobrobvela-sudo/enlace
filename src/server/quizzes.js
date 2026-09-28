// Evaluaciones: preguntas de opción múltiple y numéricas (con tolerancia, unidades y datos aleatorios por alumno),
// varios intentos, tiempo límite y orden aleatorio. Todo se califica en el servidor.
import { fail, text } from './http.js';

export const MAX_QUESTIONS = 50;
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

/** Valida y normaliza las preguntas y la configuración de una evaluación. */
export function quizFields(input) {
  if (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > MAX_QUESTIONS) {
    fail(`Agrega de una a ${MAX_QUESTIONS} preguntas.`);
  }
  const questions = input.questions.map((q, n) => {
    const label = `Pregunta ${n + 1}`;
    const type = q.type === 'numeric' ? 'numeric' : 'choice';
    const prompt = text(q.text, 3000);
    if (type === 'choice') {
      const validOptions =
        Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 6 && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.options.length;
      if (!validOptions) fail(`${label}: agrega de 2 a 6 opciones y marca la correcta.`);
      return { type, text: prompt, options: q.options.map((o) => text(o, 1500)), correct: q.correct };
    }
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
    return { type, text: prompt, answer, tolerance, unit: String(q.unit ?? '').trim().slice(0, 30), variables };
  });
  const attempts = Number(input.settings?.attempts ?? 1);
  const timeLimit = Number(input.settings?.timeLimit ?? 0);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) fail('Los intentos van de 1 a 10.');
  if (!Number.isInteger(timeLimit) || timeLimit < 0 || timeLimit > 300) fail('El tiempo límite va de 0 (sin límite) a 300 minutos.');
  return { questions, settings: { attempts, timeLimit, shuffle: input.settings?.shuffle === true } };
}

/** Forma canónica de una pregunta (las de versiones anteriores no tienen `type`: son de opción múltiple). */
const canonical = (q) =>
  q.type === 'numeric'
    ? { type: 'numeric', text: q.text, answer: q.answer, tolerance: q.tolerance, unit: q.unit, variables: q.variables }
    : { type: 'choice', text: q.text, options: q.options, correct: q.correct };

/** ¿Son las mismas preguntas? (con intentos registrados no se permite cambiarlas). */
export const sameQuestions = (a, b) => JSON.stringify((a || []).map(canonical)) === JSON.stringify((b || []).map(canonical));

/** Lo que el alumno ve de las preguntas antes de empezar (sin respuestas ni fórmulas). */
export function publicQuestions(questions) {
  return questions.map((q) => (q.type === 'numeric' ? { type: q.type, text: q.text, unit: q.unit } : { type: 'choice', text: q.text, options: q.options }));
}

// ---- Intento de un alumno --------------------------------------------------------------------------

/** Preguntas de un intento: valores de las variables y orden, siempre iguales para el mismo alumno e intento. */
export function quizInstance(quiz, userId, attempt) {
  const random = generator(seedOf(`${quiz.id}:${userId}:${attempt}`));
  const questions = quiz.data.questions.map((q, index) => {
    if (q.type !== 'numeric') return { index, type: 'choice', text: q.text, options: q.options };
    const values = Object.fromEntries(
      (q.variables || []).map((v) => [v.name, Number((v.min + random() * (v.max - v.min)).toFixed(v.decimals))]),
    );
    const shown = q.text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (all, name) => (Object.hasOwn(values, name) ? String(values[name]) : all));
    return { index, type: 'numeric', text: shown, unit: q.unit, values };
  });
  if (quiz.data.settings?.shuffle) {
    for (let i = questions.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [questions[i], questions[j]] = [questions[j], questions[i]];
    }
  }
  return questions;
}

/** Acepta "9.8", "9,8", "1.2e3" o "-3". */
function parseNumber(value) {
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
  let correct = 0;
  const details = instance.map((item) => {
    const q = questions[item.index];
    const raw = byIndex[item.index];
    // Sin respuesta (por ejemplo, si se acabó el tiempo) cuenta como incorrecta.
    if (raw === undefined || raw === null || raw === '') return { index: item.index, answer: null, correct: false, values: item.values };
    if (q.type !== 'numeric') {
      if (!Number.isInteger(raw) || raw < 0 || raw >= q.options.length) fail('Respuesta no válida.');
      const ok = raw === q.correct;
      if (ok) correct++;
      return { index: item.index, answer: raw, correct: ok };
    }
    const value = parseNumber(raw);
    if (!Number.isFinite(value)) fail(`Escribe un número en la pregunta ${instance.indexOf(item) + 1} (por ejemplo 9.8).`);
    const expected = evaluate(q.answer, item.values);
    const allowed = Math.max(Math.abs(expected) * (q.tolerance / 100), 1e-9);
    const ok = Math.abs(value - expected) <= allowed;
    if (ok) correct++;
    return { index: item.index, answer: value, correct: ok, values: item.values };
  });
  return { correct, total: questions.length, score: (correct / questions.length) * 10, details };
}

/** ¿Sigue abierto el intento? Con tiempo límite, hasta el inicio + límite (+1 min de margen). */
export function deadlineOf(quiz, started) {
  const minutes = quiz.data.settings?.timeLimit || 0;
  return minutes ? new Date(Date.parse(started) + minutes * 60_000).toISOString() : null;
}

export function assertInTime(quiz, started) {
  const deadline = deadlineOf(quiz, started);
  if (deadline && Date.now() > Date.parse(deadline) + TIME_GRACE_MS) fail('Se terminó el tiempo de este intento.', 409);
}
