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
 * después del primer 40 % del texto), lo copiado de las instrucciones y del material de la actividad, y (12.85) el texto
 * que comparten muchas entregas: plantillas, el formato de la práctica o la marca de agua de una app de escaneo.
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
 * `instructions`: texto de la actividad y de su material (o ya preparado con simPrepare, para no repetirlo en cada
 * entrega); lo que el alumno copie de ahí (≥ minRun palabras) no cuenta.
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
  if (instructions && (typeof instructions === 'string' || instructions.n) && n) {
    const guide = typeof instructions === 'string' ? simPrepare(instructions, { quotes: false, bibliography: false, minRun }) : instructions;
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

/**
 * Categoría de equipos para no comparar a integrantes del mismo equipo (12.83). La de la actividad si es por equipo;
 * si no, la que agrupa a más de quienes entregaron (por ejemplo, los equipos de laboratorio de una actividad individual).
 * `groups`: [{ id, data: { category, members } }]; `members`: ids de inscripción de quienes entregaron.
 */
function simPickTeamCategory(groups, members, preferred = '') {
  const categories = [...new Set(groups.map((g) => g.data.category).filter(Boolean))];
  if (preferred && categories.includes(preferred)) return preferred;
  let best = '';
  let most = 1; // al menos dos alumnos con equipo, si no, no vale la pena
  for (const category of categories) {
    const inTeams = new Set(groups.filter((g) => g.data.category === category).flatMap((g) => g.data.members));
    const covered = members.filter((m) => inTeams.has(m)).length;
    if (covered > most) [best, most] = [category, covered];
  }
  return best;
}

/** Equipo de un alumno en una categoría (o null). */
function simTeamOf(groups, category, member) {
  return category ? groups.find((g) => g.data.category === category && g.data.members.includes(member)) || null : null;
}

/**
 * Pares de entregas que no se comparan (12.84): integrantes del mismo equipo de la categoría elegida y entregas con el
 * mismo archivo (en una actividad por equipo, cada integrante recibe la entrega del equipo). `entries`: [{ member, fileIds }].
 */
function simSkipper(entries, groups, category) {
  const team = entries.map((e) => simTeamOf(groups, category, e.member)?.id || null);
  const files = entries.map((e) => e.fileIds || []);
  return (i, j) => Boolean(team[i] && team[i] === team[j]) || files[i].some((id) => files[j].includes(id));
}

/** Unidades de trabajo: las entregas que no se comparan entre sí (un equipo, la misma entrega) cuentan como una. */
function simUnits(count, skip) {
  const root = Array.from({ length: count }, (_, i) => i);
  const find = (i) => (root[i] === i ? i : (root[i] = find(root[i])));
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) if (skip(i, j)) root[find(j)] = find(i);
  return root.map((_, i) => find(i));
}

/**
 * Texto común a muchas entregas (12.85): el formato o la guía de la práctica que todos llenan, una plantilla o la marca
 * de agua de una app de escaneo. Una secuencia de `minRun` palabras que aparece en `threshold` unidades o más (un equipo
 * cuenta una vez) no es copia entre alumnos y deja de contar; sin esto, toda la clase sale idéntica a toda la clase.
 * Devuelve el umbral y cuántas palabras se excluyeron en total.
 */
function simExcludeCommon(docs, { minRun = 8, units = docs.map((_, i) => i), share = 0.3, min = 5 } = {}) {
  const total = new Set(units).size;
  const threshold = Math.max(min, Math.ceil(total * share));
  if (total < threshold) return { threshold, words: 0 };
  // Por clave, cuántas unidades distintas la tienen: se recorren las entregas agrupadas por unidad y el valor guarda
  // conteo × 100000 + última unidad (un número por clave, sin conjuntos).
  const seen = new Map();
  const order = docs.map((_, i) => i).sort((a, b) => units[a] - units[b]);
  for (const d of order)
    for (const key of simWindows(docs[d], minRun)) {
      if (key === null) continue;
      const value = seen.get(key);
      if (value === undefined) seen.set(key, 100000 + units[d]);
      else if (value % 100000 !== units[d]) seen.set(key, (Math.floor(value / 100000) + 1) * 100000 + units[d]);
    }
  let words = 0;
  for (const doc of docs) {
    const mark = new Uint8Array(doc.n);
    simWindows(doc, minRun).forEach((key, x) => {
      if (key !== null && Math.floor(seen.get(key) / 100000) >= threshold) mark.fill(1, x, x + minRun);
    });
    let count = 0;
    for (let x = 0; x < doc.n; x++)
      if (mark[x] && !doc.reason[x]) {
        doc.reason[x] = 'común';
        count++;
      }
    if (!count) continue;
    doc.common = doc.eligible ? count / doc.eligible : 0; // parte de su texto que era común
    doc.eligible -= count;
    doc.windows = {};
    doc.sentences = undefined;
    words += count;
  }
  return { threshold, words };
}

/* ---------- Informes guardados (12.84) ---------- */

/** Huella corta de un texto (FNV-1a + longitud): el informe guarda posiciones de palabras y solo se dibuja sobre el mismo texto. */
function simHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36) + '.' + text.length.toString(36);
}

/** Huella del contenido de una entrega: cambia si se vuelve a entregar, no al calificarla. */
function simVersionOf(s) {
  return simHash([s.data.submitted || '', (s.data.fileIds || []).join(','), s.data.body || ''].join('|'));
}

/** Tramos seguidos de una cobertura (1 idéntico, 2 cercano): [[desde, hasta, tipo]]. */
function simRuns(cov) {
  const runs = [];
  for (let x = 0; cov && x < cov.length; ) {
    if (!cov[x]) {
      x++;
      continue;
    }
    let y = x;
    while (y + 1 < cov.length && cov[y + 1] === cov[x]) y++;
    runs.push([x, y + 1, cov[x]]);
    x = y + 1;
  }
  return runs;
}

const SIM_EXCLUDED = { cita: 'c', bibliografía: 'b', instrucciones: 'i', común: 'p' };
const SIM_MAX_REPORT = 280000; // caracteres del JSON de un informe (el servidor acepta 300 000)
const simRound = (x) => Math.round(x * 10000) / 10000;

/** Texto de la otra entrega entre las palabras `a` y `b` (para mostrar con qué coincide un bloque). */
function simSnippet(doc, a, b) {
  const text = doc.text.slice(doc.tokens[a].s, doc.tokens[b - 1].e).replace(/\s+/g, ' ').trim();
  return text.length > 300 ? text.slice(0, 299) + '…' : text;
}

/** Avisos de una entrega: archivos sin leer, comillas, caracteres que evaden la comparación. */
function simWarnings(notes, doc) {
  return [
    ...(notes || []),
    ...(doc.notes || []),
    ...(doc.obfuscation.invisible ? [`${doc.obfuscation.invisible} caracteres invisibles dentro de palabras`] : []),
    ...(doc.obfuscation.confusable ? [`${doc.obfuscation.confusable} letras de otro alfabeto que imitan a las latinas`] : []),
    ...(!doc.eligible ? ['Sin texto que comparar'] : doc.eligible < 50 ? [`Solo ${doc.eligible} palabras para comparar: el porcentaje no es confiable`] : []),
  ];
}

/**
 * Informe de cada entrega para guardarlo: porcentajes, fuentes (otras entregas, de mayor a menor) y, por fuente, los
 * bloques de palabras que coinciden, con el texto de la otra entrega con que coincide cada uno.
 * `items[i]` = { submission, member, version, notes } de `docs[i]`; `skip(i, j)` = el par no se comparó (mismo equipo).
 */
function simBuildReports(items, docs, result, { settings = {}, skip = () => false } = {}) {
  return items.map((item, i) => {
    const doc = docs[i];
    const r = result.docs[i];
    const blocks = [];
    const sources = r.sources.map((source, k) => {
      const view = simPairView(result, i, source.doc);
      let words = 0;
      let count = 0;
      for (const [from, to, type] of simRuns(view.mine)) {
        words += to - from;
        count++;
        let a = Infinity;
        let b = -1;
        for (const f of view.frags)
          if (f.mine[0] < to && f.mine[1] > from) {
            a = Math.min(a, f.theirs[0]);
            b = Math.max(b, f.theirs[1]);
          }
        blocks.push([k, from, to, type, b > a ? simSnippet(docs[source.doc], a, b) : '']);
      }
      return { submission: items[source.doc].submission, member: items[source.doc].member, pct: simRound(source.pct), literal: simRound(source.literal), words, blocks: count };
    });
    const excluded = [];
    for (let x = 0; x < doc.n; ) {
      if (!doc.reason[x]) {
        x++;
        continue;
      }
      let y = x;
      while (y + 1 < doc.n && doc.reason[y + 1] === doc.reason[x]) y++;
      excluded.push([x, y + 1, SIM_EXCLUDED[doc.reason[x]] || 'c']);
      x = y + 1;
    }
    let skipped = 0;
    for (let j = 0; j < docs.length; j++) if (j !== i && skip(Math.min(i, j), Math.max(i, j))) skipped++;
    const data = { v: 1, hash: simHash(doc.text), words: doc.n, eligible: doc.eligible, excluded: excluded.slice(0, 5000), blocks: blocks.slice(0, 2000) };
    // Un informe enorme (cientos de bloques): primero se recortan los fragmentos y, si no basta, los últimos bloques.
    if (JSON.stringify(data).length > SIM_MAX_REPORT) for (const b of data.blocks) b[4] = b[4].slice(0, 60);
    while (JSON.stringify(data).length > SIM_MAX_REPORT && data.blocks.length) data.blocks.length = Math.floor(data.blocks.length * 0.8);
    return {
      submission: item.submission,
      member: item.member,
      version: item.version,
      total: simRound(r.total),
      literal: simRound(r.literal),
      summary: { sources, notes: simWarnings(item.notes, doc).slice(0, 30), settings, compared: docs.length - 1 - skipped, skipped, commonShare: simRound(doc.common || 0) },
      data,
    };
  });
}

/**
 * Lo que se dibuja de un informe guardado. Cada palabra se atribuye a la fuente de mayor porcentaje que la cubre (como
 * Turnitin) y las excluidas (`hidden`) no cuentan; con `focus` solo se marcan los bloques completos de esa fuente.
 * Devuelve el total y el idéntico, por fuente sus bloques y palabras propias (`own`) y las que se le atribuyen
 * (`shown`), y las marcas `{ src, from, to, type, block, label }` en índices de palabra.
 */
function simReportView(data, count, { hidden = new Set(), focus = null } = {}) {
  const n = data.words;
  const owner = new Int32Array(n).fill(-1);
  const kind = new Uint8Array(n);
  const own = Array.from({ length: count }, () => ({ words: 0, blocks: 0 }));
  const firstBlock = new Int32Array(n).fill(-1); // bloque guardado de la fuente dueña en esa palabra
  data.blocks.forEach(([src, from, to, type], index) => {
    if (src >= count) return;
    own[src].words += to - from;
    own[src].blocks++;
    if (hidden.has(src)) return;
    for (let x = from; x < Math.min(to, n); x++)
      if (owner[x] < 0 || src < owner[x] || (src === owner[x] && type < kind[x])) {
        owner[x] = src;
        kind[x] = type;
        firstBlock[x] = index;
      }
  });
  const shown = Array.from({ length: count }, () => ({ words: 0, blocks: 0 }));
  let covered = 0;
  let literal = 0;
  const marks = [];
  for (let x = 0; x < n; ) {
    if (owner[x] < 0) {
      x++;
      continue;
    }
    const src = owner[x];
    let y = x;
    while (y + 1 < n && owner[y + 1] === src && kind[y + 1] === kind[x]) y++;
    const len = y + 1 - x;
    shown[src].words += len;
    covered += len;
    if (kind[x] === 1) literal += len;
    const joined = x > 0 && owner[x - 1] === src; // sigue el mismo bloque con otro tipo: no es un bloque nuevo
    if (!joined) shown[src].blocks++;
    if (focus === null) marks.push({ src, from: x, to: y + 1, type: kind[x], block: firstBlock[x], label: !joined });
    x = y + 1;
  }
  if (focus !== null)
    data.blocks.forEach(([src, from, to, type], index) => {
      if (src === focus) marks.push({ src, from, to: Math.min(to, n), type, block: index, label: true });
    });
  const eligible = data.eligible || 0;
  return { total: eligible ? covered / eligible : 0, literal: eligible ? literal / eligible : 0, own, shown, marks };
}

/* ---------- Interfaz (solo quien enseña) ---------- */

const simState = { task: null, live: null, reports: null, loading: false, busy: false, progress: '', saving: '', compare: null, pendingCompare: null, opts: { minRun: 8, quotes: true, bibliography: true, instructions: true, common: true, teams: '' } };
const simTextCache = new Map(); // entrega + huella → { text, notes, parts }
const simFileCache = new Map(); // archivo → texto leído (un archivo no cambia)
const simRunning = new Map(); // actividad → análisis en curso (la pantalla de similitud y la revisión comparten el mismo)
let simCompareRequest = null; // cotejo pedido desde un informe: [entrega, otra entrega]
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

/**
 * Texto de un archivo de entrega. Con `keep` (el informe), el PDF queda abierto para dibujar sus páginas y se guarda la
 * posición de cada trozo de texto (`items`, con desde/hasta dentro del texto) y el tamaño de cada página (`pages`).
 */
async function simFileText(id, keep = false) {
  if (!keep && simFileCache.has(id)) return simFileCache.get(id);
  const read = await simReadFile(id, keep);
  if (!keep && read.text) simFileCache.set(id, read);
  return read;
}

async function simReadFile(id, keep) {
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
      const pdf = await lib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, wasmUrl: PDFJS_BASE + 'wasm/' }).promise;
      let text = '';
      const items = [];
      const pages = [];
      try {
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          if (keep) {
            const vp = page.getViewport({ scale: 1 });
            pages.push({ width: vp.width, height: vp.height, vp });
          }
          const content = await page.getTextContent();
          for (const item of content.items) {
            if (keep && item.str) items.push({ page: p, from: text.length, to: text.length + item.str.length, str: item.str, font: content.styles[item.fontName]?.fontFamily || 'sans-serif', transform: item.transform, width: item.width, height: item.height });
            text += item.str + (item.hasEOL ? '\n' : ' ');
          }
          text += '\n';
        }
      } catch (error) {
        pdf.destroy();
        throw error;
      }
      if (!keep || !text.trim()) pdf.destroy();
      if (!text.trim()) return { note: `${name}: el PDF no tiene texto (¿es una foto o un escaneo?)` };
      // Un escaneo con app suele traer solo la marca de agua («Escaneado con…») como texto.
      const words = text.split(/\s+/).filter(Boolean).length;
      const note = words < 30 * pdf.numPages ? `${name}: casi no tiene texto (${words} palabras en ${pdf.numPages} ${pdf.numPages === 1 ? 'página' : 'páginas'}); si es un escaneo o una foto, lo escrito no se compara` : undefined;
      return keep ? { text, pdf, items, pages, note } : { text, note };
    }
    if (ext === 'docx') return { text: (await readDocxParagraphs(buffer)).map((p) => p.text).join('\n') };
    const text = new TextDecoder().decode(buffer);
    return { text: ext === 'html' || ext === 'htm' ? new DOMParser().parseFromString(text, 'text/html').body.textContent : text };
  } catch {
    return { note: `${name}: no se pudo leer el archivo` };
  }
}

/** Texto de una entrega (lo escrito en Enlace y cada archivo, separados por una línea en blanco) y dónde empieza cada parte. */
async function simSubmissionText(s, keep = false) {
  const key = s.id + ':' + simVersionOf(s);
  if (!keep && simTextCache.has(key)) return simTextCache.get(key);
  const parts = [];
  const notes = [];
  let text = '';
  const add = (part, value) => {
    if (text) text += '\n\n';
    parts.push({ ...part, from: text.length, to: text.length + value.length });
    text += value;
  };
  if (s.data.body) add({ kind: 'body' }, s.data.body);
  for (const id of s.data.fileIds || []) {
    const read = await simFileText(id, keep);
    if (read.text) add({ kind: 'file', id, pdf: read.pdf, items: read.items, pages: read.pages }, read.text);
    if (read.note) notes.push(read.note);
  }
  const value = { text: text.slice(0, SIM_MAX_TEXT), notes, parts };
  if (!keep) simTextCache.set(key, value);
  return value;
}

/** Opciones del análisis: las del último guardado o, si no hay, las de omisión con la categoría de equipos que convenga. */
function simOptsFor(t, rows) {
  const saved = rows?.find((r) => r.summary?.settings)?.summary.settings;
  if (saved) return { minRun: saved.minRun, quotes: saved.quotes, bibliography: saved.bibliography, instructions: saved.instructions, common: saved.common !== false, teams: saved.teams || '' };
  return { minRun: 8, quotes: true, bibliography: true, instructions: true, common: true, teams: simPickTeamCategory(records('group'), simSubmissions(t).map((s) => s.data.member), t.data.groupCategory) };
}

/**
 * Lee las entregas de la actividad, las compara y guarda un informe por entrega. Si ya hay un análisis en curso para la
 * actividad, devuelve ese. `onProgress(texto)` informa el avance.
 */
function simRun(t, opts, onProgress = () => {}) {
  if (simRunning.has(t.id)) return simRunning.get(t.id);
  const job = (async () => {
    const subs = simSubmissions(t);
    const entries = [];
    for (let k = 0; k < subs.length; k++) {
      onProgress(`Leyendo entrega ${k + 1} de ${subs.length}…`);
      entries.push({ submission: subs[k], member: subs[k].data.member, ...(await simSubmissionText(subs[k])) });
    }
    // Las instrucciones y el material de la actividad (por ejemplo, la guía de la práctica en PDF) se preparan una vez.
    let guide = null;
    if (opts.instructions) {
      const material = [];
      for (const id of t.data.fileIds || []) material.push((await simFileText(id)).text || '');
      const text = [t.data.body || '', ...material].filter(Boolean).join('\n\n');
      if (text) guide = simPrepare(text, { quotes: false, bibliography: false, minRun: opts.minRun });
    }
    onProgress('Comparando…');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const docs = entries.map((e) => simPrepare(e.text, { quotes: opts.quotes, bibliography: opts.bibliography, instructions: guide, minRun: opts.minRun }));
    // Integrantes de un mismo equipo trabajan juntos: no se comparan entre sí.
    const skip = simSkipper(entries.map((e) => ({ member: e.member, fileIds: e.submission.data.fileIds })), records('group'), opts.teams);
    if (opts.common !== false) simExcludeCommon(docs, { minRun: opts.minRun, units: simUnits(docs.length, skip) });
    let last = Date.now();
    const onStep = async (done, total) => {
      if (Date.now() - last < 60) return;
      onProgress(`Comparando… ${Math.round((done / total) * 100)} %`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      last = Date.now();
    };
    const result = await simAnalyze(docs, { minRun: opts.minRun, skip, onStep });
    const analyzedAt = new Date().toISOString();
    const items = entries.map((e) => ({ submission: e.submission.id, member: e.member, version: simVersionOf(e.submission), notes: e.notes }));
    const reports = simBuildReports(items, docs, result, { settings: { ...opts }, skip }).map((r) => ({ ...r, analyzedAt }));
    onProgress('Guardando los informes…');
    let saveError = '';
    try {
      await simSaveReports(t, reports);
    } catch (error) {
      saveError = error.message;
    }
    const live = { entries, docs, result };
    if (simState.task === t.id) Object.assign(simState, { live, reports, opts: { ...opts }, saving: saveError ? 'No se guardaron los informes: ' + saveError : '' });
    return { live, reports, saveError };
  })();
  simRunning.set(t.id, job);
  const done = () => simRunning.delete(t.id);
  job.then(done, done);
  return job;
}

function simProgress(text) {
  simState.progress = text;
  const box = document.getElementById('simProgress');
  if (box) box.textContent = text;
}

const simRefresh = (t) => {
  if (section === 'similarity' && detail === t.id) renderSimilarity();
};

async function runSimilarity(t) {
  if (simState.busy) return;
  simState.busy = true;
  simState.compare = null;
  simRefresh(t);
  try {
    const out = await simRun(t, { ...simState.opts }, simProgress);
    if (simState.task === t.id && simState.pendingCompare) {
      const [a, b] = simState.pendingCompare.map((id) => out.live.entries.findIndex((e) => e.submission.id === id));
      if (a >= 0 && b >= 0) simState.compare = [a, b];
    }
  } catch (error) {
    toast('No se pudo completar el análisis: ' + error.message);
  } finally {
    simState.busy = false;
    simState.progress = '';
    simState.pendingCompare = null;
    simRefresh(t);
    if (simState.compare) document.getElementById('simCompare')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

const simPct = (x) => `${Math.round(x * 100)} %`;
const simLevel = (x) => (x >= 0.4 ? 'sim-high' : x >= 0.15 ? 'sim-mid' : 'sim-low');

function simResultHtml() {
  const reports = simState.reports || [];
  if (!reports.length) return '<p class="empty">Todavía no hay entregas con texto o archivos en esta actividad.</p>';
  const groups = records('group');
  const order = [...reports].sort((a, b) => b.total - a.total || byName({ name: simName(a.member) }, { name: simName(b.member) }));
  const flagged = reports.filter((r) => r.total >= 0.15).length;
  const warned = reports.filter((r) => r.summary.notes.length).length;
  const latest = reports.reduce((at, r) => (r.analyzedAt > at ? r.analyzedAt : at), '');
  const common = reports.filter((r) => r.summary.commonShare > 0);
  const commonAvg = common.reduce((sum, r) => sum + r.summary.commonShare, 0) / (common.length || 1);
  const rows = order
    .map((r) => {
      const best = r.summary.sources[0];
      const team = simTeamOf(groups, r.summary.settings?.teams, r.member);
      const notes = r.summary.notes;
      return `<tr><td><b>${esc(simName(r.member))}</b>${team ? `<div class="table-subtext">Equipo: ${esc(team.data.title)}</div>` : ''}${courseSections().length ? `<div class="table-subtext">${esc(sectionName(current.members.find((m) => m.id === r.member)?.section) || 'Sin sección')}</div>` : ''}</td>
        <td><div class="sim-score ${simLevel(r.total)}"><span class="sim-bar"><i style="width:${Math.round(r.total * 100)}%"></i></span><b>${simPct(r.total)}</b></div><div class="table-subtext">${simPct(r.literal)} idéntico</div>${r.summary.commonShare ? `<div class="table-subtext">Sin contar ${simPct(r.summary.commonShare)} de formato común</div>` : ''}</td>
        <td>${best ? `${esc(simName(best.member))} <b>${simPct(best.pct)}</b>${r.summary.sources.length > 1 ? `<div class="table-subtext">y ${r.summary.sources.length - 1} más</div>` : ''}` : '<span class="muted">Ninguna</span>'}</td>
        <td>${notes.length ? `<ul class="sim-warn">${notes.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '<span class="muted">—</span>'}</td>
        <td class="sim-actions"><button type="button" class="table-link" data-simr-open="${esc(r.submission)}">Ver informe →</button>${best ? `<button type="button" class="text-btn" data-sim-compare="${esc(r.submission)}:${esc(best.submission)}">Cotejar</button>` : ''}</td></tr>`;
    })
    .join('');
  return `<div class="sim-summary"><span><b>${reports.length}</b> entregas analizadas</span><span><b>${flagged}</b> con 15 % o más</span>${warned ? `<span><b>${warned}</b> con avisos</span>` : ''}${latest ? `<span class="muted">Analizado ${esc(fmt(latest))}</span>` : ''}</div>
    ${common.length ? `<p class="sim-common">Se quitó el texto que comparten muchas entregas (el formato de la práctica, una plantilla o la marca de agua de un escaneo): en promedio, ${simPct(commonAvg)} de cada entrega. Lo que queda es lo que cada quien escribió.</p>` : ''}
    ${simState.saving ? `<p class="error">${esc(simState.saving)}</p>` : ''}
    <div class="table-wrap keep-table"><table class="sim-table"><caption class="sr-only">Similitud de cada entrega con las demás</caption><thead><tr><th scope="col">Alumno</th><th scope="col">Similitud total</th><th scope="col">Mayor coincidencia</th><th scope="col">Avisos</th><th scope="col">Informe</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div id="simCompare">${simState.compare && simState.live ? simCompareHtml() : ''}</div>`;
}

function simCompareHtml() {
  const { entries, docs, result } = simState.live;
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
  const count = simSubmissions(t).length;
  if (simState.task !== t.id || simCompareRequest) {
    // Al abrir la pantalla se muestran los informes guardados; si faltan o alguna entrega cambió, se vuelve a analizar.
    const sameTask = simState.task === t.id;
    const pending = simCompareRequest;
    simCompareRequest = null;
    if (sameTask && simState.live) {
      const [a, b] = pending.map((id) => simState.live.entries.findIndex((e) => e.submission.id === id));
      if (a >= 0 && b >= 0) simState.compare = [a, b];
      else if (!simState.busy) {
        simState.pendingCompare = pending;
        runSimilarity(t);
      }
    } else {
      Object.assign(simState, { task: t.id, live: null, reports: null, compare: null, pendingCompare: pending, saving: '', loading: true, opts: simOptsFor(t, null) });
      simLoadReports(t).then(
        (rows) => {
          if (simState.task !== t.id) return;
          simState.loading = false;
          if (rows.length) Object.assign(simState, { reports: rows, opts: simOptsFor(t, rows) });
          if (count && (!rows.length || !simReportsFresh(t, rows) || simState.pendingCompare)) return runSimilarity(t);
          simRefresh(t);
        },
        (error) => {
          if (simState.task !== t.id) return;
          simState.loading = false;
          toast(error.message);
          if (count) runSimilarity(t);
        },
      );
    }
  }
  const categories = [...new Set(records('group').map((g) => g.data.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const o = simState.opts;
  $('#main').innerHTML = `<div class="crumbs"><button data-section="tasks">Actividades</button><span>›</span>${button(esc(t.data.title), 'task', t.id, 'text-btn')}<span>›</span><span>Similitud</span></div>
    <h1>Similitud · ${esc(t.data.title)}</h1>
    <p class="sim-intro">Compara entre sí las entregas de esta actividad (de todas las secciones) para encontrar texto idéntico y reescrituras cercanas. Se calcula en tu navegador y el informe de cada entrega queda guardado en Enlace; los trabajos no salen de Enlace. Es un apoyo para revisar: confirma cada coincidencia antes de decidir; un porcentaje alto no prueba por sí solo una copia.</p>
    <form id="simOptions" class="sim-options">
      <label>Coincidencia mínima <select name="minRun">${[6, 8, 10, 12].map((n) => `<option value="${n}" ${o.minRun === n ? 'selected' : ''}>${n} palabras seguidas</option>`).join('')}</select></label>
      <label class="check-label"><input type="checkbox" name="quotes" ${o.quotes ? 'checked' : ''}> Excluir citas entre comillas</label>
      <label class="check-label"><input type="checkbox" name="bibliography" ${o.bibliography ? 'checked' : ''}> Excluir bibliografía</label>
      <label class="check-label"><input type="checkbox" name="instructions" ${o.instructions ? 'checked' : ''}> Excluir las instrucciones y el material de la actividad</label>
      <label class="check-label"><input type="checkbox" name="common" ${o.common !== false ? 'checked' : ''}> Excluir el texto que comparten muchas entregas (formato, plantilla)</label>
      ${categories.length ? `<label>Mismo equipo <select name="teams"><option value="">Comparar a todos</option>${categories.map((c) => `<option value="${esc(c)}" ${o.teams === c ? 'selected' : ''}>No comparar dentro de: ${esc(c)}</option>`).join('')}</select></label>` : ''}
      <button class="primary" type="submit" ${simState.busy || simState.loading || !count ? 'disabled' : ''}>${simState.reports ? 'Volver a analizar' : 'Analizar'} ${count} ${count === 1 ? 'entrega' : 'entregas'}</button>
    </form>
    <p id="simProgress" class="sim-progress" role="status">${esc(simState.loading ? 'Cargando los informes guardados…' : simState.progress)}</p>
    <div id="simResult">${!simState.busy && !simState.loading ? (simState.reports ? simResultHtml() : count ? '' : '<p class="empty">Todavía no hay entregas con texto o archivos en esta actividad.</p>') : ''}</div>
    <p class="sim-foot muted">Lee texto escrito en Enlace, PDF con texto, Word (.docx) y archivos de texto. No lee fotos ni PDF escaneados. Solo compara entregas de esta actividad: no busca en internet. Integrantes del mismo equipo, y entregas con el mismo archivo, no se comparan entre sí.</p>
    <p><button type="button" class="danger-link" data-similarity-disable="${esc(t.id)}">Dejar de revisar esta actividad con el detector</button></p>`;
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
    const ids = compare.dataset.simCompare.split(':');
    const [a, b] = ids.map((id) => simState.live?.entries.findIndex((x) => x.submission.id === id) ?? -1);
    if (a < 0 || b < 0) {
      // Los informes guardados no traen el texto de las dos entregas: se vuelve a leer y comparar.
      simState.pendingCompare = ids;
      const t = find(simState.task);
      return t && runSimilarity(t);
    }
    simState.compare = [a, b];
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
  simState.opts = { minRun: Number(f.get('minRun')) || 8, quotes: f.has('quotes'), bibliography: f.has('bibliography'), instructions: f.has('instructions'), common: f.has('common'), teams: String(f.get('teams') || '') };
  const t = find(detail);
  if (t) runSimilarity(t);
});
