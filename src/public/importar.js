/* Importar preguntas (12.23) desde texto pegado, Word (.docx), Excel (.xlsx), CSV o .txt, dentro del editor de la
 * evaluación. Todo se interpreta en el navegador; el servidor valida cada pregunta al guardar la evaluación.
 *
 * Formato de texto (y de Word):
 *   1. ¿Cuál es la unidad de fuerza?      ← pregunta numerada (1. o 1) o una lista automática de Word)
 *   a) Joule
 *   *b) Newton                           ← la correcta lleva * (o «(correcta)» al final, o va en negritas en Word)
 *   Comentario: Es la unidad del SI.     ← (opcional) comentario para la opción de arriba
 *   Respuesta: b                         ← en lugar del *, la letra, o la respuesta de una pregunta abierta
 *   Retroalimentación: F = m a            ← (opcional) explicación que ve el alumno al revisar
 *   Puntos: 2                             ← (opcional)
 * Sin opciones: «Respuesta: Verdadero/Falso» → verdadero o falso; un número → aritmética (exacto si es entero,
 * 1 % si tiene decimales, o «Tolerancia: 2»); texto → respuesta corta
 * (varias aceptadas con |); sin respuesta → respuesta escrita. Con [[ ]] en el enunciado → para completar.
 * El CSV de la biblioteca de preguntas de Brightspace (NewQuestion,…) se reconoce solo (12.27, d2l.js), y se pueden
 * elegir varios archivos: cada uno (o cada grupo de IDs de Brightspace) queda como un grupo para sortear.
 */

const IMPORT_MAX_QUESTIONS = 300;
const importNorm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
const TRUE_WORDS = ['verdadero', 'v', 'cierto', 'true', 't', 'si'];
const FALSE_WORDS = ['falso', 'f', 'false', 'no'];
const IMPORT_TYPES = {
  choice: ['eleccion multiple', 'opcion multiple', 'opcion unica', 'om'],
  truefalse: ['verdadero o falso', 'verdadero/falso', 'v/f', 'vf', 'v o f'],
  multi: ['seleccion multiple', 'varias correctas', 'multiple'],
  fill: ['para completar', 'completar', 'completa'],
  matching: ['coincidencia', 'relacionar', 'relacion de columnas', 'emparejar'],
  ordering: ['ordenamiento', 'ordenar', 'orden'],
  essay: ['respuesta escrita', 'ensayo', 'abierta', 'desarrollo'],
  short: ['respuesta corta', 'corta'],
  numeric: ['aritmetica', 'numerica', 'numero', 'calculo'],
};
const importTypeOf = (value) => {
  const n = importNorm(value);
  if (!n) return null;
  return Object.entries(IMPORT_TYPES).find(([, names]) => names.includes(n))?.[0] || QUESTION_TYPES.find(([, label]) => importNorm(label) === n)?.[0] || 'unknown';
};

// «1. …», «1) …», «Pregunta 1: …» o «P1. …».
const Q_START = /^(?:(?:pregunta|p)\s*\d{1,3}\s*[.):\-–]|\d{1,3}\s*[.)])\s+(.+)$/i;
const OPTION_LINE = /^(\*\s*)?([a-j])\s*[.)]\s+(.+)$/i;
const META_LINE = /^(respuestas?|answer|clave|correcta|retroalimentaci[oó]n|explicaci[oó]n|feedback|puntos|valor|points|tipo|tolerancia|comentario)\s*[:=]\s*(.*)$/i;
const CORRECT_MARK = /\s*(\*|\(correcta\)|\(x\)|✓|✔)\s*$/i;

function newBlock(stem, line) {
  return { stem, options: [], answer: null, feedback: '', points: null, type: null, tolerance: null, line };
}

function applyMeta(b, key, value) {
  const k = importNorm(key);
  if (k.startsWith('respuesta') || k === 'answer' || k === 'clave' || k === 'correcta') b.answer = value;
  else if (k.startsWith('retroalimentacion') || k.startsWith('explicacion') || k === 'feedback') b.feedback = b.feedback ? `${b.feedback}\n${value}` : value;
  else if (k === 'puntos' || k === 'valor' || k === 'points') b.points = Number(String(value).replace(',', '.'));
  else if (k === 'tipo') b.type = importTypeOf(value);
  else if (k === 'tolerancia') b.tolerance = Number(String(value).replace('%', '').replace(',', '.').trim());
  else if (k === 'comentario' && b.options.length) b.options.at(-1).feedback = value;
}

function pushOption(b, text, bold = false, marked = false) {
  let clean = text.trim();
  if (CORRECT_MARK.test(clean)) {
    marked = true;
    clean = clean.replace(CORRECT_MARK, '').trim();
  }
  if (clean.startsWith('*')) {
    marked = true;
    clean = clean.slice(1).trim();
  }
  b.options.push({ text: clean, marked, bold });
}

/**
 * Renglones → bloques de pregunta. Cada renglón: { text, level?, numId?, bold? } (level/numId/bold vienen de Word).
 * Si ningún renglón está numerado, cada pregunta va separada por un renglón en blanco.
 */
function importBlocks(lines) {
  const blocks = [];
  const numbered = lines.some((l) => Q_START.test(l.text.trim()) || l.level === 0);
  let b = null;
  let gap = false;
  lines.forEach((l, n) => {
    const t = l.text.trim();
    if (!t) {
      gap = true;
      return;
    }
    const meta = META_LINE.exec(t);
    if (meta && b) {
      applyMeta(b, meta[1], meta[2].trim());
      gap = false;
      return;
    }
    const q = Q_START.exec(t);
    const opt = OPTION_LINE.exec(t);
    const listed = l.level !== null && l.level !== undefined;
    // Lista automática de Word: el nivel 0 de la lista de las preguntas es una pregunta; los subniveles, o una
    // lista distinta dentro de la pregunta (a, b, c), son sus opciones. Si las preguntas se numeraron a mano, las
    // listas son opciones.
    const wordQuestion = listed && !opt && l.level === 0 && (!b || (b.numId !== undefined && b.numId === l.numId));
    if ((q && !opt) || wordQuestion) {
      b = newBlock(q ? q[1] : t, n + 1);
      if (wordQuestion) b.numId = l.numId;
      blocks.push(b);
    } else if (b && (opt || listed)) {
      pushOption(b, opt ? opt[3] : t, Boolean(l.bold), Boolean(opt?.[1]));
    } else if (!numbered && (!b || gap)) {
      b = newBlock(t, n + 1);
      blocks.push(b);
    } else if (b && !b.options.length && b.answer === null) b.stem += `\n${t}`;
    else if (b?.options.length) b.options.at(-1).text += ` ${t}`;
    gap = false;
  });
  return blocks;
}

/** Filas de Excel o CSV → bloques. Con encabezados (Tipo, Pregunta, A…J, Respuesta, Puntos, Retroalimentación) o sin ellos. */
function importRowBlocks(rows) {
  const head = (rows[0] || []).map(importNorm);
  const hasHeader = head.some((h) => h === 'pregunta' || h === 'enunciado');
  const blocks = [];
  if (hasHeader) {
    const col = (...names) => head.findIndex((h) => names.includes(h));
    const cText = col('pregunta', 'enunciado');
    const cType = col('tipo');
    const cAnswer = col('respuesta', 'respuestas', 'correcta', 'clave');
    const cPoints = col('puntos', 'valor');
    const cFeedback = col('retroalimentacion', 'explicacion', 'feedback');
    const cOptions = head.map((h, i) => (/^(opcion\s*)?[a-j]$/.test(h) ? i : -1)).filter((i) => i >= 0);
    rows.slice(1).forEach((row, n) => {
      if (!String(row[cText] ?? '').trim()) return;
      const b = newBlock(String(row[cText]).trim(), n + 2);
      for (const i of cOptions) if (String(row[i] ?? '').trim()) pushOption(b, String(row[i]));
      if (cAnswer >= 0 && String(row[cAnswer] ?? '').trim()) b.answer = String(row[cAnswer]).trim();
      if (cPoints >= 0 && String(row[cPoints] ?? '').trim()) b.points = Number(String(row[cPoints]).replace(',', '.'));
      if (cFeedback >= 0) b.feedback = String(row[cFeedback] ?? '').trim();
      if (cType >= 0) b.type = importTypeOf(row[cType]);
      blocks.push(b);
    });
    return blocks;
  }
  // Sin encabezados: pregunta, opciones… y la última columna con la respuesta.
  rows.forEach((row, n) => {
    const cells = row.map((c) => String(c ?? '').trim());
    while (cells.length && !cells.at(-1)) cells.pop();
    if (!cells[0]) return;
    const b = newBlock(cells[0], n + 1);
    if (cells.length > 1) b.answer = cells.at(-1);
    for (const c of cells.slice(1, -1)) if (c) pushOption(b, c);
    blocks.push(b);
  });
  return blocks;
}

const isTrueWord = (x) => TRUE_WORDS.includes(importNorm(x));
const isFalseWord = (x) => FALSE_WORDS.includes(importNorm(x));

/** Índices de las opciones correctas: marcadas, por la letra o el texto de «Respuesta:», o en negritas (Word). */
function importCorrect(b) {
  let marked = b.options.map((o, i) => (o.marked ? i : -1)).filter((i) => i >= 0);
  if (!marked.length && b.answer) {
    const tokens = b.answer.split(/\s*(?:,|;|\s+y\s+|\s+and\s+|&|\s)\s*/i).filter(Boolean);
    if (tokens.length && tokens.every((x) => /^[a-j]$/i.test(x) && x.toLowerCase().charCodeAt(0) - 97 < b.options.length)) {
      marked = [...new Set(tokens.map((x) => x.toLowerCase().charCodeAt(0) - 97))];
    } else {
      const k = b.options.findIndex((o) => importNorm(o.text) === importNorm(b.answer));
      if (k >= 0) marked = [k];
    }
  }
  if (!marked.length) {
    const bold = b.options.map((o, i) => (o.bold ? i : -1)).filter((i) => i >= 0);
    if (bold.length && bold.length < b.options.length) marked = bold;
  }
  return marked.sort((x, y) => x - y);
}

/** Bloque → pregunta con la forma del editor (o un error que explica qué falta). */
function importQuestion(b) {
  const text = b.stem.trim();
  if (!text) return { error: 'Falta el enunciado.' };
  if (b.type === 'unknown') return { error: 'Tipo de pregunta no reconocido.' };
  const extra = {};
  if (b.points !== null && b.points !== undefined && !Number.isNaN(b.points)) {
    if (b.points < 0.1 || b.points > 100) return { error: 'Los puntos van de 0.1 a 100.' };
    if (b.points !== 1) extra.points = b.points;
  }
  if (b.feedback) extra.explanation = b.feedback.slice(0, 3000);
  const options = b.options.filter((o) => o.text);
  const notes = options.map((o) => o.feedback || '');
  const withNotes = notes.some(Boolean) ? { optionFeedback: notes } : {};
  const tf = options.length === 2 && options.every((o) => isTrueWord(o.text) || isFalseWord(o.text)) && isTrueWord(options[0].text) !== isTrueWord(options[1].text);
  let type = b.type;
  if (!type) {
    if (/\[\[[^\]]+\]\]/.test(text)) type = 'fill';
    else if (options.length && options.every((o) => /\s(?:->|→|=)\s/.test(o.text))) type = 'matching';
    else if (tf) type = 'truefalse';
    else if (options.length) type = importCorrect({ ...b, options }).length > 1 || options.length > 6 ? 'multi' : 'choice';
    else if (b.answer === null || b.answer === '') type = 'essay';
    else if (isTrueWord(b.answer) || isFalseWord(b.answer)) type = 'truefalse';
    else if (/^[-+]?\d*[.,]?\d+(?:e[-+]?\d+)?(?:\s+\S.{0,29})?$/i.test(b.answer.trim())) type = 'numeric';
    else type = 'short';
  }
  switch (type) {
    case 'choice':
    case 'multi': {
      if (options.length < 2) return { error: 'Necesita al menos dos opciones.' };
      if (options.length > (type === 'choice' ? 6 : 10)) return { error: `Máximo ${type === 'choice' ? 6 : 10} opciones.` };
      const correct = importCorrect({ ...b, options });
      if (!correct.length) return { error: 'Marca la opción correcta con * (o escribe «Respuesta: b»).' };
      if (type === 'choice' && correct.length > 1) return { error: 'Tiene varias correctas: usa «Tipo: Selección múltiple».' };
      return { question: type === 'choice' ? { type, text, options: options.map((o) => o.text), correct: correct[0], ...extra, ...withNotes } : { type, text, options: options.map((o) => o.text), correct, scoring: 'all', ...extra, ...withNotes } };
    }
    case 'truefalse': {
      let value = null;
      if (tf) {
        const k = importCorrect({ ...b, options });
        if (k.length === 1) value = isTrueWord(options[k[0]].text);
      } else if (b.answer) value = isTrueWord(b.answer) ? true : isFalseWord(b.answer) ? false : null;
      if (value === null) return { error: 'Indica si es verdadero o falso («Respuesta: Verdadero»).' };
      return { question: { type, text, correct: value, ...extra } };
    }
    case 'fill':
      if (!/\[\[[^\]]+\]\]/.test(text)) return { error: 'Escribe cada espacio con su respuesta entre [[ ]].' };
      return { question: { type, text, exact: false, ...extra } };
    case 'matching': {
      const pairs = options.map((o) => o.text.split(/\s+(?:->|→|=)\s+/)).filter((p) => p.length === 2 && p[0].trim() && p[1].trim());
      if (pairs.length < 2 || pairs.length !== options.length) return { error: 'Escribe cada pareja como «Elemento -> Su pareja».' };
      return { question: { type, text, pairs: pairs.map(([left, right]) => ({ left: left.trim(), right: right.trim() })), extra: [], scoring: 'partial', ...extra } };
    }
    case 'ordering':
      if (options.length < 2) return { error: 'Escribe los elementos en el orden correcto como opciones.' };
      return { question: { type, text, items: options.map((o) => o.text), scoring: 'partial', ...extra } };
    case 'essay':
      return { question: { type, text, guide: b.answer || '', ...extra } };
    case 'short': {
      const answers = String(b.answer || '').split(/\s*[|;]\s*/).filter(Boolean);
      if (!answers.length) return { error: 'Escribe la respuesta aceptada («Respuesta: …»).' };
      return { question: { type, text, answers, exact: false, ...extra } };
    }
    case 'numeric': {
      const m = /^([-+]?\d*[.,]?\d+(?:e[-+]?\d+)?)\s*(.*)$/i.exec(String(b.answer || '').trim());
      if (!m) return { error: 'La respuesta debe ser un número.' };
      // Un entero se califica exacto (por ejemplo, un año); con decimales, 1 % de tolerancia.
      const tolerance = b.tolerance !== null && Number.isFinite(b.tolerance) ? b.tolerance : /[.,e]/i.test(m[1]) ? 1 : 0;
      return { question: { type, text, answer: m[1].replace(',', '.'), tolerance, unit: m[2].slice(0, 30), variables: [], ...extra } };
    }
  }
  return { error: 'Este tipo de pregunta no se puede importar; créala en el editor.' };
}

/** Separa texto en filas (CSV con comas, punto y coma o tabuladores; con comillas). */
function parseDelimited(text) {
  const first = text.split(/\r?\n/, 1)[0];
  const sep = ['\t', ';', ','].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** Resultado para la vista previa: [{ question?, error?, line, source }]. */
function importFromBlocks(blocks) {
  return blocks.slice(0, IMPORT_MAX_QUESTIONS).map((b) => ({ ...importQuestion(b), line: b.line, source: b.stem.split('\n')[0].slice(0, 160) }));
}
function importFromText(text) {
  const clean = String(text || '').replace(/\r\n?/g, '\n');
  if (isD2LCsv(clean)) return parseD2LCsv(clean).slice(0, IMPORT_MAX_QUESTIONS);
  // Pegado desde Excel: columnas separadas por tabulador.
  const lines = clean.split('\n');
  if (lines.filter((l) => l.trim()).length && lines.filter((l) => l.includes('\t')).length >= Math.max(1, lines.filter((l) => l.trim()).length / 2)) {
    return importFromBlocks(importRowBlocks(parseDelimited(clean)));
  }
  return importFromBlocks(importBlocks(lines.map((t) => ({ text: t }))));
}

async function importFromFile(file) {
  if (file.size > OFFICE_MAX_BYTES) throw new Error('El archivo pesa más de 15 MB.');
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) return importFromBlocks(importBlocks(await readDocxParagraphs(await file.arrayBuffer())));
  if (name.endsWith('.xlsx')) return importFromBlocks(importRowBlocks(await readXlsxRows(await file.arrayBuffer())));
  if (name.endsWith('.csv')) {
    const text = await file.text();
    // Biblioteca de preguntas de Brightspace (12.27).
    if (isD2LCsv(text)) return parseD2LCsv(text).slice(0, IMPORT_MAX_QUESTIONS);
    return importFromBlocks(importRowBlocks(parseDelimited(text)));
  }
  if (name.endsWith('.txt') || file.type.startsWith('text/')) return importFromText(await file.text());
  if (name.endsWith('.doc') || name.endsWith('.xls')) throw new Error('Guarda el archivo en el formato nuevo (.docx o .xlsx) y vuelve a intentarlo.');
  throw new Error('Elige un archivo .docx, .xlsx, .csv o .txt.');
}

// ---- Panel en el editor de la evaluación ----------------------------------------------------------------

let importResult = [];
let importFiles = []; // [{ file, items }]: lo leído, por archivo (para los grupos)
let importGroupMode = 'auto';

/** Aplica el modo de grupos a lo leído y deja la lista plana para la vista previa. */
function applyImportGroups() {
  assignImportGroups(importFiles, importGroupMode);
  importResult = importFiles.flatMap(({ file, items }) => items.map((r) => ({ ...r, file })));
}

/** Lee uno o varios archivos (Word, Excel, CSV —también de Brightspace— o texto). */
async function readImportFiles(files) {
  const read = [];
  for (const file of files) read.push({ file: file.name, items: await importFromFile(file) });
  return read;
}

/** Aviso y error de un renglón de la vista previa (con el archivo si se eligieron varios). */
const importWhere = (r) => `${importFiles.length > 1 && r.file ? `${r.file}, renglón` : 'Renglón'} ${r.line}`;

const quizImportHtml = () => `<details class="quiz-import" id="quizImport"><summary>＋ Importar preguntas (Word, Excel o texto)</summary>
  <div class="quiz-import-body">
    <p class="muted">Pega tus preguntas o elige un archivo <b>.docx</b>, <b>.xlsx</b>, <b>.csv</b> o <b>.txt</b>. Antes de agregarlas verás cómo se entendió cada una.</p>
    <details class="quiz-import-help"><summary>Cómo escribirlas</summary>
      <pre>1. ¿Cuál es la unidad de fuerza?
a) Joule
*b) Newton
c) Watt
Retroalimentación: La fuerza se mide en newtons (N).
Puntos: 2

2. La luz es una onda electromagnética.
Respuesta: Verdadero

3. ¿Cuántos segundos hay en una hora?
Respuesta: 3600

4. La unidad de carga es el [[coulomb|C]].

5. Explica la primera ley de Newton.</pre>
      <p class="muted">La correcta lleva <b>*</b> (en Word también sirve ponerla en negritas). Varias con * → selección múltiple. Sin opciones: «Verdadero/Falso», un número (aritmética: exacto si es entero, 1 % de tolerancia si tiene decimales, o «Tolerancia: 2»), un texto (respuesta corta; varias aceptadas con |) o nada (respuesta escrita). Otros tipos con «Tipo: Coincidencia» (opciones «Elemento -&gt; Pareja») o «Tipo: Ordenamiento» (opciones en el orden correcto). En Excel: columnas Tipo, Pregunta, A a F, Respuesta, Puntos y Retroalimentación.</p>
      <button type="button" class="text-btn" data-import-template>Descargar plantilla de Excel</button>
    </details>
    <textarea data-import-text rows="7" aria-label="Preguntas para importar" placeholder="1. ¿Cuál es la unidad de fuerza?&#10;a) Joule&#10;*b) Newton&#10;c) Watt"></textarea>
    <div class="quiz-import-actions"><button type="button" class="secondary" data-import-read>Revisar lo pegado</button>
      <label class="secondary file-button">Elegir archivos<input type="file" accept=".docx,.xlsx,.csv,.txt" data-import-file multiple hidden></label></div>
    <p class="muted">¿Vienes de Brightspace? Exporta la biblioteca de preguntas como CSV y elígelo aquí (uno o varios archivos): se reconocen sus 8 tipos de pregunta y sus grupos.</p>
    <div data-import-preview></div>
  </div></details>`;

function renderImportPreview() {
  const box = document.querySelector('#quizImport [data-import-preview]');
  if (!box) return;
  if (!importResult.length) {
    box.innerHTML = '<p class="warning-note">No se encontraron preguntas. Revisa el formato en «Cómo escribirlas».</p>';
    return;
  }
  const ok = importResult.filter((r) => r.question).length;
  const groups = new Set(importResult.map((r) => r.question?.pool).filter(Boolean));
  const canGroup = importFiles.length > 1 || importResult.some((r) => r.group);
  box.innerHTML = `<p class="real-status">${ok} de ${importResult.length} ${importResult.length === 1 ? 'pregunta se entendió' : 'preguntas se entendieron'}${
    groups.size ? `, en ${groups.size} ${groups.size === 1 ? 'grupo' : 'grupos'}` : ''
  }. Quita la marca de las que no quieras agregar.</p>
    ${
      canGroup
        ? `<label class="import-groups">Grupos para sortear<select data-import-groups>${[
            ['auto', 'Automático'],
            ['file', 'Uno por archivo'],
            ['id', 'Por el ID de Brightspace (QUIM-P01-…)'],
            ['none', 'Sin grupos (todas le tocan a todos)'],
          ]
            .map(([v, l]) => `<option value="${v}" ${importGroupMode === v ? 'selected' : ''}>${l}</option>`)
            .join('')}</select></label>`
        : ''
    }
    <ul class="import-list">${importResult
      .map(
        (r, i) => `<li class="${r.error ? 'has-error' : ''}"><label class="check-label"><input type="checkbox" data-import-pick="${i}" ${r.question ? 'checked' : 'disabled'}>
          <span>${r.question ? `<span class="quiz-type-tag">${QUESTION_TYPE_NAME[r.question.type]}</span>${pointsTag(r.question)}${poolTag(r.question)} ` : ''}${esc(r.source)}${
            r.question ? `<br><span class="muted">${esc(importSummary(r.question))}</span>` : `<br><span class="error">${esc(importWhere(r))}: ${esc(r.error)}</span>`
          }${r.question && r.warnings?.length ? `<br><span class="warning-text">${esc(importWhere(r))}: ${esc(r.warnings.join('; '))}.</span>` : ''}</span></label></li>`,
      )
      .join('')}</ul>
    <p class="bank-pick-actions"><button type="button" class="primary" data-import-add ${ok ? '' : 'disabled'}>Agregar ${ok} ${ok === 1 ? 'pregunta' : 'preguntas'}</button></p>`;
}

function importSummary(q) {
  switch (q.type) {
    case 'choice':
      return `Correcta: ${QUIZ_LETTERS[q.correct]}) ${q.options[q.correct]} · ${q.options.length} opciones`;
    case 'multi':
      return `Correctas: ${q.correct.map((k) => MULTI_LETTERS[k]).join(', ')} · ${q.options.length} opciones`;
    case 'truefalse':
      return `Respuesta: ${q.correct ? 'Verdadero' : 'Falso'}`;
    case 'numeric':
      return `Respuesta: ${q.answer}${q.unit ? ` ${q.unit}` : ''} · tolerancia ${q.tolerance} %`;
    case 'short':
      return `Se acepta: ${q.answers.join(' · ')}`;
    case 'fill':
      return `${[...q.text.matchAll(/\[\[([^\]]+)\]\]/g)].length} espacios`;
    case 'matching':
      return `${q.pairs.length} parejas`;
    case 'ordering':
      return `${q.items.length} elementos`;
    case 'essay':
      return 'Respuesta escrita: la calificas tú';
  }
  return '';
}

function importTemplate() {
  downloadXlsx('plantilla-preguntas.xlsx', [
    {
      name: 'Preguntas',
      widths: [20, 50, 18, 18, 18, 18, 16, 8, 40],
      rows: [
        ['Tipo', 'Pregunta', 'A', 'B', 'C', 'D', 'Respuesta', 'Puntos', 'Retroalimentación'],
        ['Elección múltiple', '¿Cuál es la unidad de fuerza en el SI?', 'Joule', 'Newton', 'Watt', 'Pascal', 'B', 1, 'F = m a se mide en newtons.'],
        ['Selección múltiple', '¿Cuáles son magnitudes vectoriales?', 'Velocidad', 'Masa', 'Fuerza', 'Tiempo', 'A, C', 2, ''],
        ['Verdadero o falso', 'La luz es una onda electromagnética.', '', '', '', '', 'Verdadero', 1, ''],
        ['Aritmética', '¿Cuántos segundos hay en una hora?', '', '', '', '', '3600', 1, ''],
        ['Respuesta corta', '¿Qué letra representa la aceleración de la gravedad?', '', '', '', '', 'g', 1, ''],
        ['Para completar', 'La unidad de carga es el [[coulomb|C]].', '', '', '', '', '', 1, ''],
        ['Respuesta escrita', 'Explica la primera ley de Newton con un ejemplo.', '', '', '', '', '', 3, ''],
      ],
    },
  ]);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#quizImport')) return;
  if (e.target.closest('[data-import-template]')) return importTemplate();
  if (e.target.closest('[data-import-read]')) {
    importFiles = [{ file: '', items: importFromText(document.querySelector('#quizImport [data-import-text]').value) }];
    applyImportGroups();
    return renderImportPreview();
  }
  const add = e.target.closest('[data-import-add]');
  if (!add) return;
  const chosen = [...document.querySelectorAll('#quizImport [data-import-pick]:checked')].map((x) => importResult[Number(x.dataset.importPick)]?.question).filter(Boolean);
  if (!chosen.length) return toast('Elige al menos una pregunta.');
  quizDraft = readQuizQuestions();
  if (quizDraft.length === 1 && !quizDraft[0].text.trim()) quizDraft = [];
  const room = QUIZ_MAX_QUESTIONS - quizDraft.length;
  quizDraft.push(...structuredClone(chosen.slice(0, room)));
  renderQuizQuestions();
  dirty = true;
  importResult = [];
  importFiles = [];
  const panel = document.getElementById('quizImport');
  panel.open = false;
  panel.querySelector('[data-import-text]').value = '';
  panel.querySelector('[data-import-preview]').innerHTML = '';
  const groups = new Set(chosen.slice(0, room).map((q) => q.pool).filter(Boolean)).size;
  toast(
    chosen.length > room
      ? `Se agregaron ${room}: una evaluación tiene como máximo ${QUIZ_MAX_QUESTIONS} preguntas.`
      : `Se ${chosen.length === 1 ? 'agregó 1 pregunta' : `agregaron ${chosen.length} preguntas`}${
          groups ? ` en ${groups} ${groups === 1 ? 'grupo' : 'grupos'}: en «Preguntas al azar» elige cuántas recibe cada alumno de cada grupo y cuánto vale cada una` : ''
        }. Revísalas y guarda la evaluación.`,
  );
  if (groups) document.getElementById('quizDrawBox')?.scrollIntoView?.({ block: 'center' });
});

document.addEventListener('change', async (e) => {
  if (e.target.matches('#quizImport [data-import-groups]')) {
    importGroupMode = e.target.value;
    applyImportGroups();
    return renderImportPreview();
  }
  if (!e.target.matches('#quizImport [data-import-file]')) return;
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length) return;
  const box = document.querySelector('#quizImport [data-import-preview]');
  box.innerHTML = `<p class="muted">Leyendo ${files.length === 1 ? 'el archivo' : `${files.length} archivos`}…</p>`;
  try {
    importFiles = await readImportFiles(files);
    importGroupMode = 'auto';
    applyImportGroups();
    // Examen nuevo sin título: se usa el nombre del archivo.
    const title = document.querySelector('#modal[open] input[name="title"]');
    if (title && !title.value.trim()) title.value = files[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 200);
    renderImportPreview();
  } catch (error) {
    box.innerHTML = `<p class="form-error error">${esc(error.message || 'No se pudo leer el archivo.')}</p>`;
  }
});

/** «Importar examen» desde la lista de evaluaciones: una evaluación nueva con el importador abierto. */
function importQuizModal() {
  quizModal();
  const panel = document.getElementById('quizImport');
  if (!panel) return;
  panel.open = true;
  panel.scrollIntoView?.({ block: 'start' });
  toast('Elige tus archivos (CSV de Brightspace, Word, Excel o texto) o pega las preguntas; después revisa y guarda.');
}
