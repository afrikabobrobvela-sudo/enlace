/* Importar el CSV de la biblioteca de preguntas de Brightspace (D2L), 12.27.
 * Adaptado del lector del paquete de integración (evaluaciones/d2l-csv.ts): en vez de un formato propio, cada pregunta
 * sale ya con la forma de Enlace (la misma que valida questionFields() en el servidor), así sirve igual para el banco,
 * para una evaluación y para las preguntas al azar por grupo. Todo se lee en el navegador (el servidor no procesa archivos).
 *
 *   MC  → Elección múltiple (con crédito parcial por opción)    TF → Verdadero o falso
 *   MS  → Selección múltiple (todo o nada, parcial o por opción) M  → Coincidencia (con respuestas repetidas)
 *   O   → Ordenamiento                                            SA → Respuesta corta
 *   FIB → Para completar                                          WR → Respuesta escrita
 */

/** Renglones de un CSV (RFC 4180: comillas, comas y saltos de línea dentro de comillas). */
function d2lCsvRows(input) {
  const text = String(input).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((s) => s.trim()));
}

/** ¿Es un CSV de Brightspace? (empieza con «NewQuestion,…») */
const isD2LCsv = (text) => d2lCsvRows(String(text).slice(0, 4000)).some((r) => String(r[0] || '').toLowerCase() === 'newquestion');

const D2L_SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎' };
const D2L_SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ' };
const D2L_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', deg: '°', middot: '·', times: '×', divide: '÷', plusmn: '±', minus: '−', le: '≤', ge: '≥', ne: '≠', rarr: '→', larr: '←', harr: '↔', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', psi: 'ψ', omega: 'ω', Omega: 'Ω', iquest: '¿', iexcl: '¡', laquo: '«', raquo: '»' };

/**
 * Texto de una celda: Brightspace puede traer HTML (<p>, <br>, <sub>, <sup>, &aacute;…). Se convierte a texto plano
 * (Enlace nunca inserta HTML de un archivo): subíndices y superíndices a sus caracteres Unicode (H₂O, ψ²).
 */
function d2lText(value) {
  let s = String(value ?? '');
  if (/[<&]/.test(s)) {
    const script = (map) => (_, inner) => {
      const plain = inner.replace(/<[^>]*>/g, '');
      return [...plain].every((ch) => map[ch]) ? [...plain].map((ch) => map[ch]).join('') : plain;
    };
    s = s
      .replace(/<sub>([\s\S]*?)<\/sub>/gi, script(D2L_SUB))
      .replace(/<sup>([\s\S]*?)<\/sup>/gi, script(D2L_SUP))
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => {
        if (code[0] === '#') {
          const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
          return Number.isInteger(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
        }
        return D2L_ENTITIES[code] ?? all;
      });
  }
  return s
    .normalize('NFC')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const d2lNumber = (value, fallback = 0) => {
  const n = parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
};
const D2L_SCORING = { allornothing: 'all', rightanswers: 'each', correctanswers: 'each', rightminuswrong: 'partial', equallyweighted: 'partial' };
// En «para completar» los corchetes y la barra separan respuestas: dentro de una respuesta se quitan.
const fillAnswer = (value) => d2lText(value).replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim();

/** Grupo sugerido a partir del ID de la pregunta («QUIM-P01-07» → «QUIM-P01»). */
const d2lGroupOf = (id) => {
  const clean = String(id || '').trim();
  const cut = clean.search(/[-_.\s][^-_.\s]*$/);
  return cut > 0 ? clean.slice(0, cut) : '';
};

/** Convierte un bloque (de «NewQuestion» a la siguiente) a una pregunta de Enlace. `warnings` avisa lo que no se pudo conservar. */
function d2lQuestion(block) {
  const type = String(block[0][1] || '').trim().toUpperCase();
  const key = (r) => String(r[0] || '').trim().toLowerCase();
  const get = (k) => block.find((r) => key(r) === k.toLowerCase());
  const all = (k) => block.filter((r) => key(r) === k.toLowerCase());
  const warnings = [];
  const text = d2lText(get('QuestionText')?.[1]);
  if (!text && type !== 'FIB') throw new Error('No tiene enunciado (QuestionText).');
  const rawPoints = d2lNumber(get('Points')?.[1], 1);
  const points = Math.min(Math.max(rawPoints || 1, 0.1), 100);
  if (rawPoints > 100) warnings.push('valía más de 100 puntos: queda en 100');
  const extra = {};
  if (points !== 1) extra.points = Math.round(points * 100) / 100;
  const feedback = d2lText(get('Feedback')?.[1]);
  if (feedback) extra.explanation = feedback.slice(0, 3000);
  const hint = d2lText(get('Hint')?.[1]);
  if (hint) extra.hint = hint.slice(0, 1000);
  if (get('Image')?.[1]) warnings.push('la imagen no se importa: agrégala en el editor');
  const scoringOf = (fallback) => D2L_SCORING[String(get('Scoring')?.[1] || '').toLowerCase().replace(/[^a-z]/g, '')] || fallback;

  switch (type) {
    case 'MC': {
      const rows = all('Option');
      if (rows.length < 2) throw new Error('Elección múltiple con menos de 2 opciones.');
      if (rows.length > 6) throw new Error(`Elección múltiple con ${rows.length} opciones: Enlace admite hasta 6.`);
      const weights = rows.map((r) => Math.min(Math.max(d2lNumber(r[1]), 0), 100));
      const best = Math.max(...weights);
      if (best <= 0) throw new Error('Ninguna opción es correcta (todas valen 0).');
      const correct = weights.indexOf(best);
      const notes = rows.map((r) => d2lText(r[4]).slice(0, 1000));
      const partial = weights.some((w, k) => k !== correct && w > 0);
      if (best < 100) warnings.push(`la mejor opción valía ${best} %: queda como correcta (100 %)`);
      return {
        warnings,
        question: {
          type: 'choice',
          text,
          options: rows.map((r) => d2lText(r[2]).slice(0, 1500)),
          correct,
          ...(partial ? { weights: weights.map((w, k) => (k === correct ? 100 : w)) } : {}),
          ...extra,
          ...(notes.some(Boolean) ? { optionFeedback: notes } : {}),
        },
      };
    }
    case 'TF': {
      const t = get('TRUE');
      const f = get('FALSE');
      if (!t || !f) throw new Error('Verdadero o falso sin los renglones TRUE y FALSE.');
      const notes = [t[2] ? `Verdadero: ${d2lText(t[2])}` : '', f[2] ? `Falso: ${d2lText(f[2])}` : ''].filter(Boolean);
      if (notes.length) extra.explanation = [extra.explanation, ...notes].filter(Boolean).join('\n').slice(0, 3000);
      return { warnings, question: { type: 'truefalse', text, correct: d2lNumber(t[1]) > d2lNumber(f[1]), ...extra } };
    }
    case 'MS': {
      const rows = all('Option');
      if (rows.length < 2 || rows.length > 10) throw new Error('Selección múltiple con menos de 2 o más de 10 opciones.');
      const correct = rows.map((r, k) => (d2lNumber(r[1]) > 0 ? k : -1)).filter((k) => k >= 0);
      if (!correct.length) throw new Error('Selección múltiple sin opciones correctas.');
      const notes = rows.map((r) => d2lText(r[4]).slice(0, 1000));
      return {
        warnings,
        question: { type: 'multi', text, options: rows.map((r) => d2lText(r[2]).slice(0, 1500)), correct, scoring: scoringOf('each'), ...extra, ...(notes.some(Boolean) ? { optionFeedback: notes } : {}) },
      };
    }
    case 'M': {
      const choices = all('Choice');
      const matchRows = all('Match');
      // Varias «Choice» pueden apuntar al mismo número de «Match».
      const byNumber = new Map();
      for (const r of matchRows) if (!byNumber.has(r[1])) byNumber.set(r[1], d2lText(r[2]).slice(0, 500));
      const pairs = choices.map((r) => {
        if (!byNumber.has(r[1])) throw new Error(`Coincidencia: el elemento «${d2lText(r[2])}» apunta a la pareja ${r[1]}, que no existe.`);
        return { left: d2lText(r[2]).slice(0, 500), right: byNumber.get(r[1]) };
      });
      if (pairs.length < 2 || pairs.length > 10) throw new Error('Coincidencia con menos de 2 o más de 10 elementos.');
      const used = new Set(choices.map((r) => r[1]));
      const distractors = [...byNumber.entries()].filter(([n]) => !used.has(n)).map(([, v]) => v);
      if (distractors.length > 5) warnings.push('tenía más de 5 respuestas de más: se conservan 5');
      const repeated = new Set(pairs.map((p) => p.right)).size < pairs.length;
      return {
        warnings,
        question: { type: 'matching', text, pairs, extra: distractors.slice(0, 5), scoring: scoringOf('partial') === 'all' ? 'all' : 'partial', ...(repeated ? { reuse: true } : {}), ...extra },
      };
    }
    case 'O': {
      const items = all('Item').map((r) => d2lText(r[1]).slice(0, 500)).filter(Boolean);
      if (items.length < 2 || items.length > 10) throw new Error('Ordenamiento con menos de 2 o más de 10 elementos.');
      return { warnings, question: { type: 'ordering', text, items, scoring: scoringOf('partial') === 'all' ? 'all' : 'partial', ...extra } };
    }
    case 'SA': {
      const rows = all('Answer');
      if (!rows.length) throw new Error('Respuesta corta sin respuestas (Answer).');
      // Las expresiones regulares no se importan: una expresión mal hecha puede trabar la calificación.
      const literal = rows.filter((r) => String(r[3] || '').toLowerCase() !== 'regexp');
      if (literal.length < rows.length) warnings.push('las respuestas con expresión regular no se importan');
      const best = Math.max(0, ...literal.map((r) => d2lNumber(r[1], 100)));
      const answers = literal.filter((r) => d2lNumber(r[1], 100) === best && best > 0).map((r) => d2lText(r[2]).slice(0, 200)).filter(Boolean);
      if (!answers.length) throw new Error('Respuesta corta sin una respuesta aceptada.');
      if (literal.some((r) => d2lNumber(r[1], 100) > 0 && d2lNumber(r[1], 100) < best)) warnings.push('las respuestas con crédito parcial no se importan');
      return { warnings, question: { type: 'short', text, answers: answers.slice(0, 20), exact: false, ...extra } };
    }
    case 'FIB': {
      let body = text ? `${text}\n` : '';
      let blanks = 0;
      for (const r of block) {
        const k = key(r);
        if (k === 'text') body += d2lText(r[1]);
        if (k === 'blank') {
          // El orden de Brightspace es «Blank,respuesta,peso»; también se acepta «Blank,peso,respuesta».
          const isWeight = (v) => /^\d+(\.\d+)?$/.test(String(v ?? '').trim()) && Number(v) <= 100;
          const answer = isWeight(r[2]) || !isWeight(r[1]) ? r[1] : r[2];
          const clean = fillAnswer(answer);
          if (!clean) throw new Error('Para completar con un espacio sin respuesta.');
          body += ` [[${clean}]] `;
          blanks++;
        }
      }
      if (!blanks) throw new Error('Para completar sin espacios (Blank).');
      if (blanks > 20) throw new Error('Para completar con más de 20 espacios.');
      return { warnings, question: { type: 'fill', text: body.replace(/[ \t]+/g, ' ').trim().slice(0, 3000), exact: false, ...extra } };
    }
    case 'WR':
      return { warnings, question: { type: 'essay', text, guide: d2lText(get('AnswerKey')?.[1]).slice(0, 3000), ...extra } };
  }
  throw new Error(`El tipo «${type || '?'}» de Brightspace no se puede importar (se importan MC, TF, MS, M, O, SA, FIB y WR).`);
}

/**
 * Lee un CSV de Brightspace: [{ question?, error?, warnings, line, source, id, group }]. `line` es el renglón donde
 * empieza la pregunta en el archivo; `group` es el grupo sugerido por su ID.
 */
function parseD2LCsv(text) {
  const rows = d2lCsvRows(text);
  const blocks = [];
  rows.forEach((r, n) => {
    if (!r.some((c) => c !== '')) return;
    if (String(r[0]).toLowerCase() === 'newquestion') blocks.push({ line: n + 1, rows: [r] });
    else if (blocks.length) blocks.at(-1).rows.push(r);
  });
  return blocks.map(({ line, rows: block }) => {
    const id = String(block.find((r) => String(r[0]).toLowerCase() === 'id')?.[1] || '').trim();
    const title = String(block.find((r) => String(r[0]).toLowerCase() === 'title')?.[1] || '').trim();
    const source = (d2lText(block.find((r) => String(r[0]).toLowerCase() === 'questiontext')?.[1]) || title || id || 'Pregunta').split('\n')[0].slice(0, 160);
    try {
      const { question, warnings } = d2lQuestion(block);
      return { question, warnings, line, source, id, group: d2lGroupOf(id) };
    } catch (error) {
      return { error: error.message, warnings: [], line, source, id, group: d2lGroupOf(id) };
    }
  });
}

/**
 * Grupo (o tema del banco) de cada pregunta importada. `mode`: 'auto', 'file' (uno por archivo), 'id' (por el ID de
 * Brightspace, «QUIM-P01-07» → «QUIM-P01») o 'none'. En 'auto': por ID si el archivo trae varios grupos; si no, por
 * archivo cuando se importan varios (o siempre, con `perFile`, como en el banco, donde el tema hace falta).
 * `results` es [{ file, items }].
 */
function assignImportGroups(results, mode = 'auto', perFile = false) {
  for (const { file, items } of results) {
    const name = String(file || '').replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim().slice(0, 80) || 'Importadas';
    const ids = new Set(items.map((r) => r.group).filter(Boolean));
    const byId = mode === 'id' || (mode === 'auto' && ids.size > 1);
    const byFile = mode === 'file' || (mode === 'auto' && (perFile || results.length > 1));
    for (const r of items) {
      if (!r.question) continue;
      const group = mode === 'none' ? '' : byId ? r.group || name : byFile ? name : '';
      if (group) r.question.pool = group.slice(0, 80);
      else delete r.question.pool;
    }
  }
  return results;
}
