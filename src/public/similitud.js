/* Detector de similitud (12.82). El docente elige con un botón qué actividades se revisan (aula_tasks.similarity) y
 * aquí se comparan entre sí las entregas de la actividad. Todo se calcula en el navegador de quien enseña: los
 * trabajos no salen de Enlace y el Worker no gasta tiempo de procesador.
 *
 * Capas (cada una se muestra por separado; ninguna es una «probabilidad de plagio»):
 * - Texto idéntico: secuencias de al menos `minRun` palabras iguales tras normalizar mayúsculas, acentos (la ñ se
 *   conserva), puntuación, caracteres invisibles y letras cirílicas o griegas que imitan a las latinas.
 * - Reescritura cercana: oraciones con el mismo vocabulario (raíces, sinónimos frecuentes y peso por rareza de cada
 *   palabra en el grupo) aunque cambie el orden o algunas palabras.
 * Se excluyen del cálculo las citas entre comillas (si no cubren más de la mitad del texto), la bibliografía (solo
 * después del primer 40 % del texto) y lo copiado de las instrucciones de la actividad.
 * Las funciones `sim*` sin DOM son puras y se prueban en scripts/test-similitud.mjs. */

const SIM_STOP = new Set(
  'a al algo algun alguna algunas alguno algunos ante antes aqui asi aun bajo bien cada como con contra cual cuales cuando de del desde donde dos el ella ellas ellos en entre era eran es esa esas ese eso esos esta estaba estado estan estar estas este esto estos fue fueron ha habia han hasta hay hace la las le les lo los mas me mi mis mucho muy nada ni no nos o otra otras otro otros para pero poco por porque pues que quien se sea segun ser si sido siempre sin sobre solo son su sus tambien tan tanto te tiene tienen todo todos tras tu tus un una unas uno unos y ya yo'.split(' '),
);
// Letras cirílicas y griegas que se ven igual que las latinas (ya en minúscula): cambiarlas es una forma de evadir.
const SIM_CONFUSABLES = { а: 'a', в: 'b', е: 'e', ѕ: 's', і: 'i', ј: 'j', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', ԁ: 'd', һ: 'h', ӏ: 'l', ԛ: 'q', ԝ: 'w', α: 'a', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't' };
const SIM_WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}\p{Cf}]*/gu;
const SIM_SUFFIXES = 'amientos imientos aciones iciones aremos eremos iremos abamos amiento imiento idades mente acion icion ancias encias ables ibles istas ismos ancia encia antes entes iendo ieron iamos idad able ible ista ismo ante ente ando ados idos adas idas aron aban aran eran iran amos emos imos ado ido ada ida ian ara era ira ar er ir an en os as es o a e s'.split(' ');
const SIM_GROUPS = [
  'alumno estudiante aprendiz', 'docente profesor maestro', 'mejorar incrementar aumentar elevar potenciar optimizar',
  'reducir disminuir bajar minimizar', 'aprendizaje aprender ensenanza educacion formacion', 'rendimiento desempeno resultado',
  'emplear utilizar usar aplicar', 'investigacion indagacion analisis', 'demostrar evidenciar mostrar revelar probar',
  'importante relevante significativo fundamental esencial', 'herramienta recurso instrumento', 'digital tecnologico tecnologia informatico',
  'colaboracion cooperacion colaborativo cooperativo', 'evaluar valorar medir evaluacion', 'permitir posibilitar facilitar',
  'comprender entender comprension entendimiento', 'metodo metodologia procedimiento estrategia tecnica', 'autonomo independiente autonomia independencia',
  'problema dificultad obstaculo', 'objetivo meta proposito finalidad', 'causa origen motivo razon', 'efecto consecuencia impacto',
  'grande amplio extenso enorme', 'pequeno chico minimo', 'rapido veloz agil', 'obtener conseguir lograr alcanzar',
  'explicar describir exponer', 'concluir finalizar terminar', 'observar notar percibir', 'necesario indispensable imprescindible',
];

/** Forma comparable de una palabra: sin invisibles, minúsculas, sin acentos (salvo la ñ) y con letras latinas. */
function simCanon(word) {
  const lower = String(word).replace(/\p{Cf}/gu, '').normalize('NFKC').toLowerCase();
  const plain = lower.normalize('NFD').replace(/ñ/g, 'ñ').replace(/\p{M}/gu, '');
  let out = '';
  for (const c of plain) out += SIM_CONFUSABLES[c] || c;
  return out;
}

/** Raíz aproximada en español (sin acentos): basta para agrupar «evaluación/evaluar/evaluaciones». */
function simStem(word) {
  if (word.length <= 4) return word;
  for (const suffix of SIM_SUFFIXES) if (word.length - suffix.length >= 4 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
  return word;
}

const SIM_CONCEPTS = new Map(SIM_GROUPS.flatMap((group, i) => group.split(' ').map((w) => [simStem(w), 'c' + i])));
const simTerm = (value) => {
  const stem = simStem(value);
  return SIM_CONCEPTS.get(stem) || stem;
};

/** Palabras del texto con su posición original (para resaltar) y su forma comparable. */
function simTokens(text) {
  const out = [];
  for (const m of String(text).matchAll(SIM_WORD)) out.push({ v: simCanon(m[0]), s: m.index, e: m.index + m[0].length });
  return out;
}

/** Caracteres que parecen un intento de engañar a la comparación literal. */
function simObfuscation(text) {
  let invisible = 0;
  let confusable = 0;
  for (const m of String(text).matchAll(SIM_WORD)) {
    const word = m[0];
    invisible += (word.match(/\p{Cf}/gu) || []).length;
    const lower = word.toLowerCase();
    if (/[a-z]/.test(lower)) for (const c of lower) if (SIM_CONFUSABLES[c]) confusable++;
  }
  return { invisible, confusable };
}

/**
 * Prepara un documento: palabras, cuáles cuentan (no excluidas) y por qué se excluyeron las demás.
 * `instructions`: texto de la actividad; lo que el alumno copie de ahí (≥ minRun palabras) no cuenta.
 */
function simPrepare(text, { quotes = true, bibliography = true, instructions = '', minRun = 8 } = {}) {
  text = String(text || '');
  const tokens = simTokens(text);
  const n = tokens.length;
  const reason = new Array(n).fill('');
  const notes = [];
  const within = (ranges, label) => {
    for (let i = 0; i < n; i++) if (!reason[i] && ranges.some((r) => tokens[i].s >= r.start && tokens[i].e <= r.end)) reason[i] = label;
  };
  if (quotes && n) {
    const ranges = [];
    for (const pattern of [/"[^"\n]+"/g, /“[^”]+”/g, /«[^»]+»/g]) for (const m of text.matchAll(pattern)) ranges.push({ start: m.index, end: m.index + m[0].length });
    const inside = tokens.filter((t) => ranges.some((r) => t.s >= r.start && t.e <= r.end)).length;
    // Una «cita» que cubre más de la mitad del texto no se excluye: sería una forma de esconder una copia completa.
    if (inside / n > 0.5) notes.push(`El ${Math.round((inside / n) * 100)} % del texto está entre comillas; no se excluyó para que no oculte una copia.`);
    else within(ranges, 'cita');
  }
  if (bibliography && n) {
    // Solo un encabezado después del primer 40 % del texto cuenta como bibliografía (uno al inicio escondería todo).
    const head = [...text.matchAll(/^[ \t]*(?:referencias(?: bibliogr[aá]ficas)?|bibliograf[ií]a|fuentes consultadas)[ \t]*:?[ \t]*$/gim)].find((m) => m.index >= text.length * 0.4);
    if (head) within([{ start: head.index, end: text.length }], 'bibliografía');
  }
  const doc = { text, tokens, reason, notes, n, obfuscation: simObfuscation(text) };
  if (instructions && n) {
    const guide = simPrepare(instructions, { quotes: false, bibliography: false, minRun });
    for (const run of simLiteralRuns(doc, guide, minRun)) for (let i = run.a; i < run.a + run.len; i++) if (!reason[i]) reason[i] = 'instrucciones';
    doc.windows = {}; // las ventanas se calcularon antes de excluir las instrucciones
  }
  doc.eligible = reason.filter((r) => !r).length;
  return doc;
}

/** Ventanas de `k` palabras sin exclusiones: clave por posición (o null). */
function simWindows(doc, k) {
  doc.windows ??= {};
  if (doc.windows[k]) return doc.windows[k];
  const keys = new Array(doc.n).fill(null);
  let blocked = 0; // exclusiones dentro de la ventana actual
  for (let i = 0; i < doc.n; i++) {
    if (doc.reason[i]) blocked++;
    if (i >= k && doc.reason[i - k]) blocked--;
    if (i >= k - 1 && !blocked) {
      let key = doc.tokens[i - k + 1].v;
      for (let j = i - k + 2; j <= i; j++) key += '\u0001' + doc.tokens[j].v;
      keys[i - k + 1] = key;
    }
  }
  return (doc.windows[k] = keys);
}

/** Secuencias idénticas máximas entre dos documentos ({ a, b, len } en índices de palabra). */
function simLiteralRuns(a, b, minRun) {
  const index = new Map();
  simWindows(b, minRun).forEach((key, p) => {
    if (key === null) return;
    const list = index.get(key);
    if (!list) index.set(key, [p]);
    else if (list.length < 50) list.push(p);
  });
  const runs = [];
  simWindows(a, minRun).forEach((key, i) => {
    if (key === null) return;
    for (const p of index.get(key) || []) {
      // Solo el inicio de cada secuencia: si la palabra anterior también coincide, ya se contó.
      if (i > 0 && p > 0 && !a.reason[i - 1] && !b.reason[p - 1] && a.tokens[i - 1].v === b.tokens[p - 1].v) continue;
      let len = minRun;
      while (i + len < a.n && p + len < b.n && !a.reason[i + len] && !b.reason[p + len] && a.tokens[i + len].v === b.tokens[p + len].v) len++;
      runs.push({ a: i, b: p, len });
    }
  });
  return runs;
}

/** Oraciones con su vector de términos (raíz o concepto). Solo las de al menos 6 términos de contenido. */
function simSentences(doc) {
  if (doc.sentences) return doc.sentences;
  const out = [];
  let from = 0;
  const close = (to) => {
    const counts = new Map();
    let terms = 0;
    for (let i = from; i < to; i++) {
      const v = doc.tokens[i].v;
      if (doc.reason[i] || v.length < 3 || SIM_STOP.has(v) || /^\d+$/.test(v)) continue;
      const term = simTerm(v);
      counts.set(term, (counts.get(term) || 0) + 1);
      terms++;
    }
    if (terms >= 6) out.push({ from, to, counts });
    from = to;
  };
  for (let i = 0; i < doc.n; i++) {
    const next = doc.tokens[i + 1];
    if (!next || /[.!?;\n]/.test(doc.text.slice(doc.tokens[i].e, next.s))) close(i + 1);
  }
  return (doc.sentences = out);
}

/**
 * Compara todos los documentos entre sí. `skip(i, j)` excluye un par (por ejemplo, integrantes del mismo equipo).
 * Devuelve por documento: % total, % idéntico, fuentes ordenadas; y por par, los fragmentos para el cotejo.
 * `onStep(hechos, total)` se espera entre documentos: la interfaz lo usa para mostrar el avance sin congelarse.
 */
async function simAnalyze(docs, { minRun = 8, nearThreshold = 0.75, skip = () => false, onStep = null } = {}) {
  const pairs = new Map(); // 'i:j' (i < j) → { covA, covB, frags: [{ a: [from, to], b: [from, to], type }] }
  const pairOf = (i, j) => {
    const key = i + ':' + j;
    if (!pairs.has(key)) pairs.set(key, { covA: new Uint8Array(docs[i].n), covB: new Uint8Array(docs[j].n), frags: [] });
    return pairs.get(key);
  };
  const steps = docs.length * 2;
  // Texto idéntico: un solo índice de ventanas de `minRun` palabras para todas las entregas.
  const index = new Map(); // clave → [documento, posición, documento, posición…]
  docs.forEach((doc, d) =>
    simWindows(doc, minRun).forEach((key, p) => {
      if (key === null) return;
      const list = index.get(key);
      if (!list) index.set(key, [d, p]);
      else if (list.length < 400) list.push(d, p);
    }),
  );
  for (let i = 0; i < docs.length; i++) {
    const a = docs[i];
    const windows = simWindows(a, minRun);
    for (let x = 0; x < a.n; x++) {
      if (windows[x] === null) continue;
      const list = index.get(windows[x]);
      for (let k = 0; k < list.length; k += 2) {
        const d = list[k];
        if (d <= i || skip(i, d)) continue;
        const b = docs[d];
        const p = list[k + 1];
        // Solo el inicio de cada secuencia: si la palabra anterior también coincide, ya se contó.
        if (x > 0 && p > 0 && !a.reason[x - 1] && !b.reason[p - 1] && a.tokens[x - 1].v === b.tokens[p - 1].v) continue;
        let len = minRun;
        while (x + len < a.n && p + len < b.n && !a.reason[x + len] && !b.reason[p + len] && a.tokens[x + len].v === b.tokens[p + len].v) len++;
        const pair = pairOf(i, d);
        pair.covA.fill(1, x, x + len);
        pair.covB.fill(1, p, p + len);
        pair.frags.push({ a: [x, x + len], b: [p, p + len], type: 'lit' });
      }
    }
    if (onStep) await onStep(i + 1, steps);
  }
  // Reescritura cercana: coseno entre oraciones con peso por rareza del término en el grupo (los términos del tema,
  // que todos usan, pesan poco).
  const sentences = docs.map(simSentences);
  const df = new Map();
  for (const list of sentences) {
    const seen = new Set();
    for (const s of list) for (const term of s.counts.keys()) seen.add(term);
    for (const term of seen) df.set(term, (df.get(term) || 0) + 1);
  }
  const idf = (term) => Math.log((docs.length + 1) / ((df.get(term) || 0) + 1)) + 1;
  for (const list of sentences)
    for (const s of list) {
      s.weights = new Map();
      let norm = 0;
      for (const [term, count] of s.counts) {
        const w = count * idf(term);
        s.weights.set(term, w);
        norm += w * w;
      }
      s.norm = Math.sqrt(norm);
    }
  // Las candidatas se buscan solo por términos que no usa casi todo el grupo (los del tema estarían en todas las
  // oraciones y volverían cuadrático el cálculo); el coseno de cada candidata sí cuenta todos los términos.
  const common = Math.max(4, docs.length * 0.4);
  const postings = new Map(); // término → [documento, oración, documento, oración…]
  sentences.forEach((list, d) =>
    list.forEach((s, k) =>
      s.weights.forEach((_, term) => {
        if (df.get(term) <= common) (postings.get(term) || postings.set(term, []).get(term)).push(d, k);
      }),
    ),
  );
  for (let i = 0; i < sentences.length; i++) {
    for (const s of sentences[i]) {
      const candidates = new Set(); // documento × 1e6 + oración
      for (const term of s.weights.keys()) {
        const list = postings.get(term);
        if (list) for (let x = 0; x < list.length; x += 2) if (list[x] > i) candidates.add(list[x] * 1e6 + list[x + 1]);
      }
      for (const key of candidates) {
        const d = Math.floor(key / 1e6);
        if (skip(i, d)) continue;
        const t = sentences[d][key % 1e6];
        const [small, large] = s.weights.size <= t.weights.size ? [s.weights, t.weights] : [t.weights, s.weights];
        let dot = 0;
        for (const [term, w] of small) dot += w * (large.get(term) || 0);
        if (dot / (s.norm * t.norm) < nearThreshold) continue;
        const pair = pairOf(i, d);
        // Si la oración ya es casi toda idéntica, no se cuenta dos veces.
        let literal = 0;
        for (let x = s.from; x < s.to; x++) literal += pair.covA[x] === 1;
        if (literal / (s.to - s.from) > 0.6) continue;
        for (let x = s.from; x < s.to; x++) if (!docs[i].reason[x] && !pair.covA[x]) pair.covA[x] = 2;
        for (let x = t.from; x < t.to; x++) if (!docs[d].reason[x] && !pair.covB[x]) pair.covB[x] = 2;
        pair.frags.push({ a: [s.from, s.to], b: [t.from, t.to], type: 'near' });
      }
    }
    if (onStep) await onStep(docs.length + i + 1, steps);
  }
  // Porcentajes por documento.
  const results = docs.map((doc) => ({ any: new Uint8Array(doc.n), sources: [] }));
  const share = (doc, cov, which) => {
    let count = 0;
    for (let x = 0; x < doc.n; x++) if (!doc.reason[x] && (which ? cov[x] === which : cov[x])) count++;
    return doc.eligible ? count / doc.eligible : 0;
  };
  for (const [key, pair] of pairs) {
    const [i, j] = key.split(':').map(Number);
    for (const [me, other, cov] of [[i, j, pair.covA], [j, i, pair.covB]]) {
      const doc = docs[me];
      for (let x = 0; x < doc.n; x++) if (cov[x] && !doc.reason[x]) results[me].any[x] = Math.max(results[me].any[x], cov[x] === 1 ? 2 : 1);
      results[me].sources.push({ doc: other, pct: share(doc, cov), literal: share(doc, cov, 1) });
    }
  }
  return {
    docs: docs.map((doc, i) => {
      const r = results[i];
      r.sources.sort((x, y) => y.pct - x.pct);
      const covered = r.any.reduce((sum, v) => sum + (v ? 1 : 0), 0);
      const literal = r.any.reduce((sum, v) => sum + (v === 2 ? 1 : 0), 0);
      return { total: doc.eligible ? covered / doc.eligible : 0, literal: doc.eligible ? literal / doc.eligible : 0, sources: r.sources.filter((s) => s.pct > 0) };
    }),
    pairs,
  };
}

/** Fragmentos de un par vistos desde `me` (los de `pair` están guardados como i < j). */
function simPairView(result, me, other) {
  const [i, j] = me < other ? [me, other] : [other, me];
  const pair = result.pairs.get(i + ':' + j);
  if (!pair) return { mine: null, theirs: null, frags: [] };
  const flip = me > other;
  return {
    mine: flip ? pair.covB : pair.covA,
    theirs: flip ? pair.covA : pair.covB,
    frags: pair.frags.map((f) => ({ mine: flip ? f.b : f.a, theirs: flip ? f.a : f.b, type: f.type })),
  };
}

/** HTML del texto con lo coincidente resaltado (`cov`: 1 idéntico, 2 cercano) y lo excluido atenuado. */
function simHighlightHtml(doc, cov, frags, side) {
  const fragOf = new Int32Array(doc.n).fill(-1);
  frags.forEach((f, k) => {
    const [from, to] = f[side];
    for (let x = from; x < to; x++) if (fragOf[x] < 0) fragOf[x] = k;
  });
  const cls = (x) => (doc.reason[x] ? 'ex:' + doc.reason[x] : cov?.[x] === 1 ? 'lit:' + fragOf[x] : cov?.[x] === 2 ? 'near:' + fragOf[x] : '');
  let html = '';
  let at = 0;
  for (let x = 0; x < doc.n; ) {
    const c = cls(x);
    if (!c) {
      x++;
      continue;
    }
    let y = x;
    while (y + 1 < doc.n && cls(y + 1) === c) y++;
    const [kind, extra] = c.split(':');
    html += esc(doc.text.slice(at, doc.tokens[x].s));
    const inner = esc(doc.text.slice(doc.tokens[x].s, doc.tokens[y].e));
    html +=
      kind === 'ex'
        ? `<span class="sim-ex" title="Excluido: ${esc(extra)}">${inner}</span>`
        : `<mark class="sim-${kind}" data-sim-frag="${extra}" title="${kind === 'lit' ? 'Texto idéntico' : 'Reescritura cercana'}">${inner}</mark>`;
    at = doc.tokens[y].e;
    x = y + 1;
  }
  return html + esc(doc.text.slice(at));
}

/* ---------- Interfaz (solo quien enseña) ---------- */

const simState = { task: null, docs: null, result: null, entries: null, busy: false, progress: '', compare: null, opts: { minRun: 8, quotes: true, bibliography: true, instructions: true } };
const simTextCache = new Map(); // entrega + revisión → { text, notes }
const SIM_MAX_FILE = 20 * 1024 * 1024;
const SIM_MAX_TEXT = 300000;

/** Pastilla junto al título (para quien enseña). */
function similarityTag(record) {
  return teaches() && record?.kind === 'task' && record.data.similarity ? ' <span class="role-pill sim-pill">Similitud</span>' : '';
}

/** Botón de la página de la actividad: activar la revisión o abrir el análisis. */
function similarityToolbarHtml(t) {
  if (!teaches() || t.data.forum) return '';
  return t.data.similarity
    ? `<button type="button" class="secondary" data-similarity-open="${esc(t.id)}">Similitud</button>`
    : `<button type="button" class="secondary" data-similarity-enable="${esc(t.id)}" title="Compara entre sí las entregas para encontrar texto copiado">Revisar similitud</button>`;
}

/** Aviso para el alumno: sabe que su entrega se compara con las de sus compañeros. */
function similarityStudentNote(t) {
  return !teaches() && t.data.similarity ? '<p class="muted sim-note">Las entregas de esta actividad se comparan entre sí con el detector de similitud de Enlace.</p>' : '';
}

const simName = (memberId) => current.members.find((m) => m.id === memberId)?.name || 'Alumno retirado';

/** Entregas con contenido de la actividad (no las capturas manuales). */
function simSubmissions(t) {
  return records('submission').filter((s) => s.data.task === t.id && !s.data.manual && (s.data.body || s.data.fileIds?.length));
}

async function simFileText(id) {
  const file = current.files.find((f) => f.id === id);
  const name = file?.name || 'archivo';
  const ext = name.toLowerCase().split('.').pop();
  if (!['pdf', 'docx', 'txt', 'md', 'csv', 'html', 'htm', 'rtf'].includes(ext)) return { note: `${name}: no se puede leer (solo PDF, Word .docx o texto)` };
  if (file?.size > SIM_MAX_FILE) return { note: `${name}: muy grande para analizarse (más de 20 MB)` };
  const response = await fetch('/api/file/' + encodeURIComponent(id), { credentials: 'same-origin' });
  if (!response.ok) return { note: `${name}: no se pudo descargar` };
  const buffer = await response.arrayBuffer();
  try {
    if (ext === 'pdf') {
      const lib = await loadPdfjs();
      const pdf = await lib.getDocument({ data: new Uint8Array(buffer) }).promise;
      let text = '';
      for (let p = 1; p <= pdf.numPages; p++) {
        const content = await (await pdf.getPage(p)).getTextContent();
        text += content.items.map((item) => item.str + (item.hasEOL ? '\n' : ' ')).join('') + '\n';
      }
      pdf.destroy?.();
      return text.trim() ? { text } : { note: `${name}: el PDF no tiene texto (¿es una foto o un escaneo?)` };
    }
    if (ext === 'docx') return { text: (await readDocxParagraphs(buffer)).map((p) => p.text).join('\n') };
    const text = new TextDecoder().decode(buffer);
    return { text: ext === 'html' || ext === 'htm' ? new DOMParser().parseFromString(text, 'text/html').body.textContent : text };
  } catch {
    return { note: `${name}: no se pudo leer el archivo` };
  }
}

async function simSubmissionText(s) {
  const key = s.id + ':' + s.revision;
  if (simTextCache.has(key)) return simTextCache.get(key);
  const parts = [];
  const notes = [];
  if (s.data.body) parts.push(s.data.body);
  for (const id of s.data.fileIds || []) {
    const read = await simFileText(id);
    if (read.text) parts.push(read.text);
    if (read.note) notes.push(read.note);
  }
  const value = { text: parts.join('\n\n').slice(0, SIM_MAX_TEXT), notes };
  simTextCache.set(key, value);
  return value;
}

function simProgress(text) {
  simState.progress = text;
  const box = document.getElementById('simProgress');
  if (box) box.textContent = text;
}

async function runSimilarity(t) {
  if (simState.busy) return;
  simState.busy = true;
  simState.compare = null;
  renderSimilarity();
  try {
    const subs = simSubmissions(t);
    const entries = [];
    for (let k = 0; k < subs.length; k++) {
      simProgress(`Leyendo entrega ${k + 1} de ${subs.length}…`);
      const s = subs[k];
      entries.push({ submission: s, member: s.data.member, ...(await simSubmissionText(s)) });
    }
    simProgress('Comparando…');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const opts = simState.opts;
    const docs = entries.map((e) => simPrepare(e.text, { quotes: opts.quotes, bibliography: opts.bibliography, instructions: opts.instructions ? t.data.body : '', minRun: opts.minRun }));
    // Integrantes de un mismo equipo entregan lo mismo: no se comparan entre sí.
    const team = entries.map((e) => (typeof teamFor === 'function' ? teamFor(t, e.member)?.id : null) || null);
    let last = Date.now();
    const onStep = async (done, total) => {
      if (Date.now() - last < 60) return;
      simProgress(`Comparando… ${Math.round((done / total) * 100)} %`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      last = Date.now();
    };
    const result = await simAnalyze(docs, { minRun: opts.minRun, skip: (i, j) => Boolean(team[i] && team[i] === team[j]), onStep });
    Object.assign(simState, { task: t.id, entries, docs, result, analyzedAt: new Date() });
  } catch (error) {
    toast('No se pudo completar el análisis: ' + error.message);
  } finally {
    simState.busy = false;
    simState.progress = '';
    if (section === 'similarity' && detail === t.id) renderSimilarity();
  }
}

const simPct = (x) => `${Math.round(x * 100)} %`;
const simLevel = (x) => (x >= 0.4 ? 'sim-high' : x >= 0.15 ? 'sim-mid' : 'sim-low');

function simResultHtml() {
  const { entries, docs, result } = simState;
  if (!entries.length) return '<p class="empty">Todavía no hay entregas con texto o archivos en esta actividad.</p>';
  const order = entries.map((_, i) => i).sort((a, b) => result.docs[b].total - result.docs[a].total || byName({ name: simName(entries[a].member) }, { name: simName(entries[b].member) }));
  const unread = entries.reduce((sum, e) => sum + e.notes.length, 0);
  const flagged = result.docs.filter((d) => d.total >= 0.15).length;
  const rows = order
    .map((i) => {
      const e = entries[i];
      const r = result.docs[i];
      const best = r.sources[0];
      const warn = [
        ...e.notes,
        ...(docs[i].notes || []),
        ...(docs[i].obfuscation.invisible ? [`${docs[i].obfuscation.invisible} caracteres invisibles dentro de palabras`] : []),
        ...(docs[i].obfuscation.confusable ? [`${docs[i].obfuscation.confusable} letras de otro alfabeto que imitan a las latinas`] : []),
        ...(!docs[i].eligible ? ['Sin texto que comparar'] : []),
      ];
      return `<tr><td><b>${esc(simName(e.member))}</b>${courseSections().length ? `<div class="table-subtext">${esc(sectionName(current.members.find((m) => m.id === e.member)?.section) || 'Sin sección')}</div>` : ''}</td>
        <td><div class="sim-score ${simLevel(r.total)}"><span class="sim-bar"><i style="width:${Math.round(r.total * 100)}%"></i></span><b>${simPct(r.total)}</b></div><div class="table-subtext">${simPct(r.literal)} idéntico</div></td>
        <td>${best ? `${esc(simName(entries[best.doc].member))} <b>${simPct(best.pct)}</b>${r.sources.length > 1 ? `<div class="table-subtext">y ${r.sources.length - 1} más</div>` : ''}` : '<span class="muted">Ninguna</span>'}</td>
        <td>${warn.length ? `<ul class="sim-warn">${warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '<span class="muted">—</span>'}</td>
        <td>${best ? `<button type="button" class="table-link" data-sim-compare="${i}:${best.doc}">Comparar →</button>` : ''}</td></tr>`;
    })
    .join('');
  return `<div class="sim-summary"><span><b>${entries.length}</b> entregas analizadas</span><span><b>${flagged}</b> con 15 % o más</span>${unread ? `<span><b>${unread}</b> ${unread === 1 ? 'archivo sin leer' : 'archivos sin leer'}</span>` : ''}<span class="muted">Analizado ${esc(simState.analyzedAt.toLocaleTimeString('es-MX', { timeStyle: 'short' }))}</span></div>
    <div class="table-wrap keep-table"><table class="sim-table"><caption class="sr-only">Similitud de cada entrega con las demás</caption><thead><tr><th scope="col">Alumno</th><th scope="col">Similitud total</th><th scope="col">Mayor coincidencia</th><th scope="col">Avisos</th><th scope="col">Cotejo</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div id="simCompare">${simState.compare ? simCompareHtml() : ''}</div>`;
}

function simCompareHtml() {
  const { entries, docs, result } = simState;
  const [me, other] = simState.compare;
  const view = simPairView(result, me, other);
  const source = result.docs[me].sources.find((s) => s.doc === other);
  const back = result.docs[other].sources.find((s) => s.doc === me);
  const options = result.docs[me].sources.map((s) => `<option value="${s.doc}" ${s.doc === other ? 'selected' : ''}>${esc(simName(entries[s.doc].member))} · ${simPct(s.pct)}</option>`).join('');
  return `<section class="sim-compare" aria-label="Cotejo de dos entregas">
    <div class="panel-head"><h2>${esc(simName(entries[me].member))} y ${esc(simName(entries[other].member))}</h2><button type="button" class="text-btn" data-sim-close>Cerrar cotejo</button></div>
    <div class="sim-compare-bar"><label>Comparar con <select data-sim-other="${me}">${options}</select></label>
      <span class="sim-legend"><mark class="sim-lit">Texto idéntico</mark> <mark class="sim-near">Reescritura cercana</mark> <span class="sim-ex">Excluido</span></span></div>
    <p class="muted">${esc(simName(entries[me].member))}: ${simPct(source?.pct || 0)} de su texto coincide con ${esc(simName(entries[other].member))}. ${esc(simName(entries[other].member))}: ${simPct(back?.pct || 0)} coincide con ${esc(simName(entries[me].member))}. Toca un fragmento resaltado para ver su pareja.</p>
    <div class="sim-columns">
      <article class="sim-doc" data-sim-side="mine"><h3>${esc(simName(entries[me].member))}</h3><div class="sim-text">${simHighlightHtml(docs[me], view.mine, view.frags, 'mine')}</div></article>
      <article class="sim-doc" data-sim-side="theirs"><h3>${esc(simName(entries[other].member))}</h3><div class="sim-text">${simHighlightHtml(docs[other], view.theirs, view.frags, 'theirs')}</div></article>
    </div></section>`;
}

function renderSimilarity() {
  const t = find(detail);
  if (!t || !teaches()) {
    section = 'tasks';
    return renderTasks();
  }
  if (simState.task !== t.id) Object.assign(simState, { task: t.id, entries: null, docs: null, result: null, compare: null });
  const count = simSubmissions(t).length;
  const o = simState.opts;
  $('#main').innerHTML = `<div class="crumbs"><button data-section="tasks">Actividades</button><span>›</span>${button(esc(t.data.title), 'task', t.id, 'text-btn')}<span>›</span><span>Similitud</span></div>
    <h1>Similitud · ${esc(t.data.title)}</h1>
    <p class="sim-intro">Compara entre sí las entregas de esta actividad (de todas las secciones) para encontrar texto idéntico y reescrituras cercanas. Se calcula en tu navegador: los trabajos no salen de Enlace. Es un apoyo para revisar: confirma cada coincidencia antes de decidir; un porcentaje alto no prueba por sí solo una copia.</p>
    <form id="simOptions" class="sim-options">
      <label>Coincidencia mínima <select name="minRun">${[6, 8, 10, 12].map((n) => `<option value="${n}" ${o.minRun === n ? 'selected' : ''}>${n} palabras seguidas</option>`).join('')}</select></label>
      <label class="check-label"><input type="checkbox" name="quotes" ${o.quotes ? 'checked' : ''}> Excluir citas entre comillas</label>
      <label class="check-label"><input type="checkbox" name="bibliography" ${o.bibliography ? 'checked' : ''}> Excluir bibliografía</label>
      <label class="check-label"><input type="checkbox" name="instructions" ${o.instructions ? 'checked' : ''}> Excluir el texto de las instrucciones</label>
      <button class="primary" type="submit" ${simState.busy || !count ? 'disabled' : ''}>${simState.result ? 'Volver a analizar' : 'Analizar'} ${count} ${count === 1 ? 'entrega' : 'entregas'}</button>
    </form>
    <p id="simProgress" class="sim-progress" role="status">${esc(simState.progress)}</p>
    <div id="simResult">${simState.result && !simState.busy ? simResultHtml() : ''}</div>
    <p class="sim-foot muted">Lee texto escrito en Enlace, PDF con texto, Word (.docx) y archivos de texto. No lee fotos ni PDF escaneados. Solo compara entregas de esta actividad: no busca en internet.</p>
    <p><button type="button" class="danger-link" data-similarity-disable="${esc(t.id)}">Dejar de revisar esta actividad con el detector</button></p>`;
  if (!simState.result && !simState.busy && count) runSimilarity(t);
}

async function setSimilarity(id, enabled) {
  await request('/api/task/similarity', { course: current.course.id, id, enabled });
  await reload();
}

document.addEventListener('click', async (e) => {
  const enable = e.target.closest('[data-similarity-enable]');
  const open = e.target.closest('[data-similarity-open]');
  const disable = e.target.closest('[data-similarity-disable]');
  try {
    if (enable) {
      await setSimilarity(enable.dataset.similarityEnable, true);
      toast('Las entregas de esta actividad se revisarán con el detector de similitud.');
    }
    if (enable || open) {
      section = 'similarity';
      detail = (enable || open).dataset[enable ? 'similarityEnable' : 'similarityOpen'];
      return render();
    }
    if (disable) {
      if (!confirm('¿Dejar de revisar esta actividad con el detector de similitud? Puedes volver a activarlo cuando quieras.')) return;
      const id = disable.dataset.similarityDisable;
      await setSimilarity(id, false);
      section = 'task';
      detail = id;
      render();
      return toast('La actividad ya no se revisa con el detector.');
    }
  } catch (error) {
    return toast(error.message);
  }
  const compare = e.target.closest('[data-sim-compare]');
  if (compare) {
    simState.compare = compare.dataset.simCompare.split(':').map(Number);
    document.getElementById('simCompare').innerHTML = simCompareHtml();
    return document.getElementById('simCompare').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (e.target.closest('[data-sim-close]')) {
    simState.compare = null;
    return (document.getElementById('simCompare').innerHTML = '');
  }
  const mark = e.target.closest('.sim-compare mark[data-sim-frag]');
  if (mark) {
    const side = mark.closest('[data-sim-side]').dataset.simSide === 'mine' ? 'theirs' : 'mine';
    const twin = document.querySelector(`.sim-compare [data-sim-side="${side}"] mark[data-sim-frag="${mark.dataset.simFrag}"]`);
    document.querySelectorAll('.sim-compare mark.is-active').forEach((m) => m.classList.remove('is-active'));
    document.querySelectorAll(`.sim-compare mark[data-sim-frag="${mark.dataset.simFrag}"]`).forEach((m) => m.classList.add('is-active'));
    twin?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});
document.addEventListener('change', (e) => {
  const other = e.target.closest('[data-sim-other]');
  if (!other) return;
  simState.compare = [Number(other.dataset.simOther), Number(other.value)];
  document.getElementById('simCompare').innerHTML = simCompareHtml();
});
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'simOptions') return;
  e.preventDefault();
  const f = new FormData(e.target);
  simState.opts = { minRun: Number(f.get('minRun')) || 8, quotes: f.has('quotes'), bibliography: f.has('bibliography'), instructions: f.has('instructions') };
  const t = find(detail);
  if (t) runSimilarity(t);
});
