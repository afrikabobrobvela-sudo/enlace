/* Informe de similitud (12.84), al estilo del de Turnitin en Brightspace. El detector (similitud.js) guarda un informe
 * por entrega (src/server/similitud.js); aquí se muestran:
 * - el porcentaje bajo los archivos de la entrega (revisión) y en la tabla de la actividad;
 * - el informe: el documento del alumno (las páginas del PDF o el texto) con cada coincidencia del color de su fuente y
 *   numerada, y a un lado la similitud total y las fuentes (otras entregas) con sus bloques, el texto de la otra entrega
 *   con que coincide cada bloque, «Excluir» y «Mostrar las fuentes solapadas».
 * Solo para quien enseña. Las posiciones se guardan en palabras del texto leído; si el texto que se lee al abrir no es
 * el mismo (otra huella), se muestran las fuentes sin marcas en el documento. */

const SIM_COLORS = ['#c42b3c', '#7b3fa0', '#1d7a46', '#1f5fa8', '#b25400', '#0b7a75', '#a3306e', '#5d6b12', '#8a4b2a', '#3d5a99'];
const simColor = (k) => SIM_COLORS[k % SIM_COLORS.length];
const SIMR_EXCLUDED = { c: 'cita entre comillas', b: 'bibliografía', i: 'instrucciones o material de la actividad', p: 'texto que comparten muchas entregas (formato o plantilla)' };
const SIMR_MAX_PAGES = 120; // por archivo
const simReportsCache = new Map(); // curso:actividad → { at, promise }
let simrViewer = null; // informe abierto: { state, destroy() }

/** Informes guardados de una actividad (sin bloques). Se guardan un minuto en memoria. */
function simLoadReports(t, force = false) {
  const key = current.course.id + ':' + t.id;
  const hit = simReportsCache.get(key);
  if (hit && !force && Date.now() - hit.at < 60000) return hit.promise;
  const promise = request(`/api/similarity?course=${encodeURIComponent(current.course.id)}&task=${encodeURIComponent(t.id)}`).then((r) => r.reports);
  simReportsCache.set(key, { at: Date.now(), promise });
  promise.catch(() => simReportsCache.delete(key));
  return promise;
}

/** Guarda los informes en partes de menos de 1 MB (el servidor los escribe con una sola instrucción por parte). */
async function simSaveReports(t, reports) {
  const encoder = new TextEncoder();
  let chunk = [];
  let size = 0;
  const send = async () => {
    if (chunk.length) await request('/api/similarity', { course: current.course.id, task: t.id, reports: chunk });
    chunk = [];
    size = 0;
  };
  for (const r of reports) {
    const item = { submission: r.submission, version: r.version, total: r.total, literal: r.literal, summary: r.summary, data: r.data };
    const bytes = encoder.encode(JSON.stringify(item)).length + 1;
    if (chunk.length && (size + bytes > 900000 || chunk.length >= 100)) await send();
    chunk.push(item);
    size += bytes;
  }
  await send();
  const rows = reports.map(({ data, ...row }) => row);
  simReportsCache.set(current.course.id + ':' + t.id, { at: Date.now(), promise: Promise.resolve(rows) });
}

/** Informes guardados antes de 12.85 (sin la opción de texto común): el análisis de ahora es distinto. */
const simReportsOld = (rows) => rows.some((r) => !('common' in (r.summary?.settings || {})));

/** ¿Todas las entregas de la actividad tienen informe de su contenido actual, hecho con el detector de ahora? */
function simReportsFresh(t, rows) {
  return !simReportsOld(rows) && simSubmissions(t).every((s) => rows.some((r) => r.submission === s.id && r.version === simVersionOf(s)));
}

/* ---------- Porcentaje en la revisión y en la tabla de la actividad ---------- */

const simHasContent = (s) => Boolean(s && !s.data.manual && (s.data.body || s.data.fileIds?.length));

/** Lugar del informe bajo los archivos de la entrega (revisión). Se llena con simFillBadges(). */
function simReviewBadgeHtml(t, s) {
  if (!teaches() || !t.data.similarity || !simHasContent(s)) return '';
  return `<div class="simr-badge" data-simr-badge="${esc(s.id)}"><p class="simr-badge-busy">Buscando el informe de similitud…</p></div>`;
}

/** Celda de la tabla de la actividad. */
function simTaskCellHtml(t, s) {
  if (!t.data.similarity) return '';
  return simHasContent(s) ? `<td data-simr-cell="${esc(s.id)}"><span class="muted">…</span></td>` : '<td><span class="muted">—</span></td>';
}

function simBadgeInner(t, id, rows, fresh) {
  if (simRunning.has(t.id)) return '<p class="simr-badge-busy" role="status">Generando el informe de similitud…</p>';
  if (!rows) return '<p class="muted">No se pudo cargar el informe de similitud.</p>';
  const s = records('submission').find((x) => x.id === id);
  const r = rows.find((x) => x.submission === id);
  if (!r)
    return `<div class="simr-badge-empty"><div><b>Informe de similitud</b><small>Esta entrega todavía no se compara con las demás de la actividad.</small></div><button type="button" class="secondary" data-simr-generate="${esc(t.id)}">Generar informe</button></div>`;
  const best = r.summary.sources[0];
  const stale = s && r.version !== simVersionOf(s);
  return `<button type="button" class="simr-badge-card" data-simr-open="${esc(id)}"><span class="simr-badge-pct ${simLevel(r.total)}">${simPct(r.total)}</span><span class="simr-badge-text"><b>Informe de similitud de Enlace</b><small>${best ? `Mayor coincidencia: ${esc(simName(best.member))} (${simPct(best.pct)})` : 'Sin coincidencias con otras entregas'}</small></span><span class="simr-badge-go" aria-hidden="true"></span></button>${
    stale || !fresh ? `<p class="simr-badge-stale">${stale ? 'La entrega cambió después del análisis.' : simReportsOld(rows) ? 'El detector mejoró desde este análisis.' : 'Hay entregas nuevas o corregidas desde el análisis.'} <button type="button" class="text-btn" data-simr-generate="${esc(t.id)}">Actualizar</button></p>` : ''
  }`;
}

function simCellInner(id, rows) {
  const r = rows?.find((x) => x.submission === id);
  if (!r) return '<span class="muted">Sin informe</span>';
  const s = records('submission').find((x) => x.id === id);
  const stale = s && r.version !== simVersionOf(s);
  return `<button type="button" class="simr-chip ${simLevel(r.total)}${stale ? ' is-stale' : ''}" data-simr-open="${esc(id)}" title="${stale ? 'La entrega cambió después del análisis. ' : ''}Ver el informe de similitud">${simPct(r.total)}</button>`;
}

/** Llena los lugares del informe en la pantalla actual (revisión o tabla de la actividad). */
async function simFillBadges(t) {
  if (!teaches() || !t?.data.similarity || !document.querySelector('#main [data-simr-badge], #main [data-simr-cell]')) return;
  let rows = null;
  try {
    rows = await simLoadReports(t);
  } catch {
    rows = null;
  }
  const fresh = rows ? simReportsFresh(t, rows) : false;
  document.querySelectorAll('#main [data-simr-badge]').forEach((el) => (el.innerHTML = simBadgeInner(t, el.dataset.simrBadge, rows, fresh)));
  document.querySelectorAll('#main [data-simr-cell]').forEach((el) => (el.innerHTML = simCellInner(el.dataset.simrCell, rows)));
}

/** Analiza la actividad desde la revisión o el informe (sin abrir la pantalla de similitud). */
async function simGenerate(t) {
  let rows = null;
  try {
    rows = await simLoadReports(t);
  } catch {
    rows = null;
  }
  const progress = (text) => document.querySelectorAll('#main [data-simr-badge], #main .simr-empty .simr-progress').forEach((el) => (el.innerHTML = `<p class="simr-badge-busy" role="status">${esc(text)}</p>`));
  try {
    const out = await simRun(t, simOptsFor(t, rows), progress);
    if (out.saveError) toast('No se guardaron los informes: ' + out.saveError);
  } catch (error) {
    toast('No se pudo completar el análisis: ' + error.message);
  }
  if (section === 'simreport') render();
  else simFillBadges(t);
}

/* ---------- Informe ---------- */

function renderSimReport() {
  const s = records('submission').find((x) => x.id === detail);
  const t = s && find(s.data.task);
  if (!s || !t || !teaches()) {
    section = 'tasks';
    return renderTasks();
  }
  simrViewer?.destroy();
  simrViewer = null;
  const subs = simSubmissions(t).sort((a, b) => byName({ name: simName(a.data.member) }, { name: simName(b.data.member) }));
  const at = subs.findIndex((x) => x.id === s.id);
  const prev = subs[at - 1];
  const next = subs[at + 1];
  $('#main').innerHTML = `<div class="crumbs"><button data-section="tasks">Actividades</button><span>›</span>${button(esc(t.data.title), 'task', t.id, 'text-btn')}<span>›</span><button type="button" class="text-btn" data-similarity-open="${esc(t.id)}">Similitud</button><span>›</span><span>${esc(simName(s.data.member))}</span></div>
    <div class="simr-head"><div><h1>Informe de similitud</h1><p class="simr-who"><b>${esc(simName(s.data.member))}</b> · ${esc(t.data.title)}${s.data.submitted ? ` · entregó ${esc(fmt(s.data.submitted))}` : ''}</p></div>
      <div class="simr-head-actions" role="group" aria-label="Otras entregas">
        <button type="button" class="secondary" data-simr-open="${esc(prev?.id || '')}" ${prev ? '' : 'disabled'}>‹ Anterior</button>
        <button type="button" class="secondary" data-simr-open="${esc(next?.id || '')}" ${next ? '' : 'disabled'}>Siguiente ›</button>
        <button type="button" class="primary" data-action="review" data-id="${esc(t.id)}" data-member="${esc(s.data.member)}">Evaluar</button>
      </div></div>
    <div id="simReport" class="simr" aria-busy="true"><p class="simr-loading" role="status">Abriendo el informe…</p></div>`;
  simrMount(t, s);
}

async function simrMount(t, s) {
  const root = $('#simReport');
  const show = (html) => {
    if (!root.isConnected) return false;
    root.innerHTML = html;
    return true;
  };
  let report;
  try {
    report = (await request(`/api/similarity/report?course=${encodeURIComponent(current.course.id)}&submission=${encodeURIComponent(s.id)}`)).report;
  } catch (error) {
    root.removeAttribute('aria-busy');
    if (error.status !== 404) return show(`<p class="error">${esc(error.message)}</p>`);
    return show(
      `<div class="simr-empty"><h2>Esta entrega todavía no tiene informe</h2><p>El informe se genera al comparar entre sí las entregas de la actividad (${simSubmissions(t).length}). Tarda unos segundos.</p><div class="simr-progress"><button type="button" class="primary" data-simr-generate="${esc(t.id)}">Generar informe</button></div></div>`,
    );
  }
  if (!show('<p class="simr-loading" role="status">Leyendo la entrega…</p>')) return;
  let read;
  try {
    read = await simSubmissionText(s, true);
  } catch (error) {
    return show(`<p class="error">No se pudo leer la entrega: ${esc(error.message)}</p>`);
  }
  const viewer = {
    pdfs: read.parts.map((p) => p.pdf).filter(Boolean),
    destroy() {
      this.observer?.disconnect();
      this.watch?.disconnect();
      this.pdfs.forEach((pdf) => pdf.destroy());
      this.pdfs = [];
    },
  };
  if (!root.isConnected) return viewer.destroy();
  simrViewer?.destroy();
  simrViewer = viewer;
  // Al salir del informe (cambia la pantalla) se liberan los PDF abiertos.
  viewer.watch = new MutationObserver(() => {
    if (root.isConnected) return;
    viewer.destroy();
    if (simrViewer === viewer) simrViewer = null;
  });
  viewer.watch.observe($('#main'), { childList: true });
  const tokens = simTokens(read.text);
  const st = { t, s, report, read, tokens, matches: simHash(read.text) === report.data.hash && tokens.length === report.data.words, hidden: new Set(), focus: null, overlap: false, open: null, active: null };
  viewer.state = st;
  const stale = report.version !== simVersionOf(s);
  root.removeAttribute('aria-busy');
  root.innerHTML = `<section class="simr-side" id="simrSide" aria-label="Similitud y fuentes"></section>
    <div class="simr-doc" id="simrDoc">
      ${stale ? `<p class="simr-banner">La entrega cambió después del análisis. <button type="button" class="text-btn" data-simr-generate="${esc(t.id)}">Volver a analizar</button></p>` : ''}
      ${!st.matches && !stale ? `<p class="simr-banner">El texto que se leyó ahora no es igual al analizado, así que no se marcan las coincidencias en el documento. <button type="button" class="text-btn" data-simr-generate="${esc(t.id)}">Volver a analizar</button></p>` : ''}
      ${read.notes.length ? `<ul class="simr-unread">${read.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${simrDocHtml(st)}
    </div>`;
  simrPaint(st);
  simrObservePages(st, viewer);
}

function simrDocHtml(st) {
  if (!st.read.parts.length) return '<p class="empty">No hay texto que mostrar en esta entrega.</p>';
  return st.read.parts
    .map((part, k) => {
      const file = part.kind === 'file' ? current.files.find((f) => f.id === part.id) : null;
      const head = `<h2 class="simr-part">${esc(part.kind === 'body' ? 'Texto escrito en Enlace' : file?.name || 'Archivo')}</h2>`;
      if (part.from >= st.read.text.length) return head + '<p class="muted">El análisis llega hasta aquí (el texto de la entrega es muy largo).</p>';
      if (!part.pdf) return `${head}<div class="simr-page simr-textpage"><div class="simr-text" data-part="${k}"></div></div>`;
      const pages = part.pages.slice(0, SIMR_MAX_PAGES);
      return (
        head +
        pages
          .map((p, n) => `<div class="simr-page simr-pdf" data-part="${k}" data-page="${n + 1}" style="aspect-ratio:${p.width.toFixed(2)} / ${p.height.toFixed(2)}" role="img" aria-label="Página ${n + 1} de ${part.pages.length}"><div class="simr-canvas"></div><div class="simr-overlay" data-part="${k}" data-page="${n + 1}"></div></div>`)
          .join('') +
        (part.pages.length > pages.length ? `<p class="muted">Se muestran las primeras ${pages.length} páginas.</p>` : '')
      );
    })
    .join('');
}

/** Dibuja las páginas del PDF cuando se acercan a la pantalla (las marcas ya están encima). */
function simrObservePages(st, viewer) {
  const slots = [...document.querySelectorAll('#simrDoc .simr-pdf')];
  if (!slots.length) return;
  viewer.observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.target.dataset.drawn) continue;
        entry.target.dataset.drawn = '1';
        viewer.observer.unobserve(entry.target);
        simrDrawPage(st, entry.target).catch(() => (entry.target.querySelector('.simr-canvas').textContent = 'No se pudo dibujar esta página.'));
      }
    },
    { rootMargin: '900px 0px' },
  );
  slots.forEach((slot) => viewer.observer.observe(slot));
}

async function simrDrawPage(st, slot) {
  const part = st.read.parts[Number(slot.dataset.part)];
  if (!part?.pdf || !simrViewer?.pdfs.includes(part.pdf)) return;
  const page = await part.pdf.getPage(Number(slot.dataset.page));
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(320, slot.clientWidth) * ratio;
  const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, viewport }).promise;
  slot.querySelector('.simr-canvas').replaceChildren(canvas);
}

let simrMeasure = null;
/** Ancho de `text` en la fuente del trozo (proporción del ancho del trozo completo): así la marca empieza donde va. */
function simrWidthShare(item, chars) {
  if (chars <= 0) return 0;
  if (chars >= item.str.length) return 1;
  simrMeasure ??= document.createElement('canvas').getContext('2d');
  simrMeasure.font = `100px ${item.font}`;
  const full = simrMeasure.measureText(item.str).width;
  return full > 0 ? simrMeasure.measureText(item.str.slice(0, chars)).width / full : chars / item.str.length;
}

/** Rectángulo (en % de la página) del texto entre `a` y `b` dentro de un trozo de texto del PDF. */
function simrItemRect(item, a, b, page) {
  const [, , c, d, x, y] = item.transform;
  const size = Math.hypot(c, d) || item.height || 10;
  const x0 = x + item.width * simrWidthShare(item, a - item.from);
  const x1 = x + item.width * simrWidthShare(item, b - item.from);
  const [p, q, r, s] = page.vp.convertToViewportRectangle([x0, y - size * 0.24, x1, y + size * 0.9]);
  const w = Math.abs(r - p);
  const h = Math.abs(s - q);
  if (!(w > 0.5 && h > 0.5)) return null;
  return { left: (Math.min(p, r) / page.width) * 100, top: (Math.min(q, s) / page.height) * 100, width: (w / page.width) * 100, height: (h / page.height) * 100 };
}
const simrPlace = (r) => `left:${r.left.toFixed(3)}%;top:${r.top.toFixed(3)}%;width:${r.width.toFixed(3)}%;height:${r.height.toFixed(3)}%`;

/** Tramos que se dibujan (marcas y excluidos) en posiciones del texto, ordenados. */
function simrSpans(st, view) {
  if (!st.matches) return [];
  const { tokens } = st;
  const spans = view.marks.map((m, i) => ({ s: tokens[m.from].s, e: tokens[m.to - 1].e, m, i }));
  for (const [from, to, code] of st.report.data.excluded) spans.push({ s: tokens[from].s, e: tokens[to - 1].e, ex: code });
  return spans.sort((a, b) => a.s - b.s);
}

/** Atributos de una marca: color y número de su fuente, bloque guardado y descripción. `box` = rectángulo sobre un PDF. */
function simrMarkAttrs(st, x, box = '') {
  const source = st.report.summary.sources[x.m.src];
  const cls = `${box ? 'simr-box ' : ''}simr-mark${x.m.type === 2 ? ' is-near' : ''}${st.active === x.m.block ? ' is-active' : ''}`;
  return `class="${cls}" style="${box ? box + ';' : ''}--src:${simColor(x.m.src)}" data-simr-mark="${x.m.src}" data-simr-block="${x.m.block}" title="Fuente ${x.m.src + 1}: ${esc(simName(source?.member))} · ${x.m.type === 1 ? 'texto idéntico' : 'reescritura cercana'}"`;
}

function simrTextHtml(st, spans, part) {
  const { text } = st.read;
  const end = Math.min(part.to, text.length);
  let html = '';
  let at = part.from;
  for (const x of spans) {
    const from = Math.max(x.s, at);
    const to = Math.min(x.e, end);
    if (to <= from) continue;
    html += esc(text.slice(at, from));
    const inner = esc(text.slice(from, to));
    html += x.ex
      ? `<span class="simr-ex" title="Excluido: ${SIMR_EXCLUDED[x.ex]}">${inner}</span>`
      : `<mark ${simrMarkAttrs(st, x)}>${x.m.label && from === x.s ? `<span class="simr-num" aria-hidden="true">${x.m.src + 1}</span>` : ''}${inner}</mark>`;
    at = to;
  }
  return html + esc(text.slice(at, end));
}

/**
 * Marcas sobre las páginas de un PDF: un rectángulo por trozo de texto. El número de la fuente va en el margen izquierdo,
 * a la altura de la línea donde empieza el bloque (sobre el texto taparía letras).
 */
function simrPdfMarks(st, spans, part) {
  const out = new Map();
  const numbers = new Map(); // página → alturas con número (para no encimarlos)
  const items = part.items;
  for (const x of spans) {
    const s = x.s - part.from;
    const e = x.e - part.from;
    if (e <= 0 || s >= part.to - part.from) continue;
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid].to <= s) lo = mid + 1;
      else hi = mid;
    }
    let first = true;
    for (let k = lo; k < items.length && items[k].from < e; k++) {
      const item = items[k];
      const a = Math.max(s, item.from);
      const b = Math.min(e, item.to);
      const page = part.pages[item.page - 1];
      const rect = b > a && item.page <= SIMR_MAX_PAGES && simrItemRect(item, a, b, page);
      if (!rect) continue;
      let html = x.ex ? `<span class="simr-box simr-box-ex" style="${simrPlace(rect)}" title="Excluido: ${SIMR_EXCLUDED[x.ex]}"></span>` : `<span ${simrMarkAttrs(st, x, simrPlace(rect))}></span>`;
      if (!x.ex && first && x.m.label) {
        const middle = rect.top + rect.height / 2;
        const used = numbers.get(item.page) || [];
        const beside = used.filter((top) => Math.abs(top - middle) < 1.2).length;
        used.push(middle);
        numbers.set(item.page, used);
        html += `<b class="simr-num simr-margin-num" style="top:${middle.toFixed(3)}%;left:${(1.2 + beside * 3.2).toFixed(1)}%;--src:${simColor(x.m.src)}" data-simr-mark="${x.m.src}" data-simr-block="${x.m.block}" aria-hidden="true">${x.m.src + 1}</b>`;
      }
      out.set(item.page, (out.get(item.page) || '') + html);
      first = false;
    }
  }
  return out;
}

function simrView(st) {
  return simReportView(st.report.data, st.report.summary.sources.length, { hidden: st.hidden, focus: st.focus });
}

/** Vuelve a dibujar las marcas del documento y la columna de fuentes. */
function simrPaint(st) {
  const view = simrView(st);
  const spans = simrSpans(st, view);
  st.read.parts.forEach((part, k) => {
    if (part.pdf) {
      const marks = simrPdfMarks(st, spans, part);
      document.querySelectorAll(`#simrDoc .simr-overlay[data-part="${k}"]`).forEach((el) => (el.innerHTML = marks.get(Number(el.dataset.page)) || ''));
    } else {
      const box = document.querySelector(`#simrDoc .simr-text[data-part="${k}"]`);
      if (box) box.innerHTML = simrTextHtml(st, spans, part);
    }
  });
  simrPaintSide(st, view);
}

function simrPaintSide(st, view = simrView(st)) {
  const side = document.getElementById('simrSide');
  if (!side) return;
  const { report, t, s } = st;
  const { summary, data } = report;
  const eligible = data.eligible || 0;
  const share = (words) => simPct(eligible ? words / eligible : 0);
  const listed = summary.sources.map((src, k) => ({ src, k })).filter(({ k }) => st.overlap || view.shown[k].words > 0 || st.hidden.has(k) || st.focus === k);
  const covered = summary.sources.length - listed.length;
  const settings = summary.settings || {};
  const items = listed
    .map(({ src, k }) => {
      const stats = st.overlap || st.hidden.has(k) ? view.own[k] : view.shown[k];
      const open = st.open === k;
      const blocks = data.blocks.map((b, i) => [b, i]).filter(([b]) => b[0] === k);
      const name = esc(simName(src.member));
      return `<li class="simr-source${st.hidden.has(k) ? ' is-excluded' : ''}${open ? ' is-open' : ''}${st.focus === k ? ' is-focus' : ''}" style="--src:${simColor(k)}">
        <button type="button" class="simr-source-main" data-simr-source="${k}" aria-expanded="${open}">
          <span class="simr-num">${k + 1}</span>
          <span class="simr-source-text"><b>${name}</b><small>Entrega de un compañero</small><small>${stats.blocks} ${stats.blocks === 1 ? 'bloque de texto' : 'bloques de texto'} · ${stats.words} ${stats.words === 1 ? 'palabra coincidente' : 'palabras coincidentes'}</small></span>
          <span class="simr-source-pct">${st.hidden.has(k) ? 'Excluida' : share(stats.words)}</span>
        </button>
        <label class="simr-exclude"><input type="checkbox" data-simr-exclude="${k}" ${st.hidden.has(k) ? 'checked' : ''}> Excluir esta fuente</label>
        ${
          open
            ? `<ol class="simr-blocks">${blocks
                .map(
                  ([b, i]) =>
                    `<li><button type="button" class="simr-block${st.active === i ? ' is-active' : ''}" data-simr-goto="${i}"><span class="simr-block-head">${b[3] === 1 ? 'Texto idéntico' : 'Reescritura cercana'} · ${b[2] - b[1]} ${b[2] - b[1] === 1 ? 'palabra' : 'palabras'}</span>${b[4] ? `<span class="simr-snippet">En su entrega: «${esc(b[4])}»</span>` : ''}</button></li>`,
                )
                .join('')}</ol>
            <p class="simr-source-links"><button type="button" class="text-btn" data-simr-focus="${k}">${st.focus === k ? 'Marcar todas las fuentes' : 'Marcar solo esta fuente'}</button><button type="button" class="text-btn" data-simr-compare="${esc(t.id)}:${esc(s.id)}:${esc(src.submission)}">Cotejar lado a lado</button><button type="button" class="text-btn" data-simr-open="${esc(src.submission)}">Su informe</button></p>`
            : ''
        }
      </li>`;
    })
    .join('');
  const notes = summary.notes || [];
  const yes = (on) => (on ? 'excluido' : 'incluido');
  side.innerHTML = `<div class="simr-score ${simLevel(view.total)}"><span class="simr-score-pct">${simPct(view.total)}</span><span class="simr-score-label">Similitud</span></div>
    <p class="simr-score-sub">${simPct(view.literal)} es texto idéntico. Comparada con ${summary.compared} ${summary.compared === 1 ? 'entrega' : 'entregas'} de la actividad${summary.skipped ? `; no con ${summary.skipped} del mismo equipo` : ''}.</p>
    ${summary.commonShare ? `<p class="simr-side-note">No cuenta el ${simPct(summary.commonShare)} de esta entrega que comparten muchas otras (formato de la práctica, plantilla o marca de agua).</p>` : ''}
    ${st.hidden.size ? `<p class="simr-hidden-note">${st.hidden.size === 1 ? 'Una fuente excluida' : `${st.hidden.size} fuentes excluidas`}. <button type="button" class="text-btn" data-simr-include-all>Incluirlas</button></p>` : ''}
    <div class="simr-side-head"><h2>Fuentes <span class="simr-count">${listed.length}</span></h2>
      <label class="simr-switch"><input type="checkbox" role="switch" data-simr-overlap ${st.overlap ? 'checked' : ''}> Mostrar las fuentes solapadas</label></div>
    ${!st.overlap && covered > 0 ? `<p class="simr-side-note">${covered === 1 ? 'Una fuente más coincide' : `${covered} fuentes más coinciden`} solo con texto que ya cubre otra de mayor porcentaje.</p>` : ''}
    ${st.focus !== null ? `<p class="simr-side-note">En el documento se marca solo la fuente ${st.focus + 1}. <button type="button" class="text-btn" data-simr-focus="${st.focus}">Marcar todas</button></p>` : ''}
    ${items ? `<ol class="simr-sources">${items}</ol>` : '<p class="simr-none">No coincide con ninguna otra entrega de la actividad.</p>'}
    <p class="simr-legend"><span><i class="simr-key"></i>Texto idéntico</span><span><i class="simr-key is-near"></i>Reescritura cercana</span><span><i class="simr-key is-ex"></i>Excluido</span></p>
    <details class="simr-flags"${notes.length ? ' open' : ''}><summary>Marcas de alerta <span class="simr-count">${notes.length}</span></summary>${notes.length ? `<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p>Ninguna: no hay caracteres ocultos, letras de otro alfabeto ni archivos sin leer.</p>'}</details>
    <details class="simr-settings"><summary>Cómo se analizó</summary><ul>
      <li>Coincidencia mínima: ${settings.minRun || 8} palabras seguidas</li>
      <li>Citas entre comillas: ${yes(settings.quotes)}</li><li>Bibliografía: ${yes(settings.bibliography)}</li><li>Instrucciones y material de la actividad: ${yes(settings.instructions)}</li><li>Texto que comparten muchas entregas: ${yes(settings.common !== false)}</li>
      <li>${settings.teams ? `No se compara dentro de los equipos de «${esc(settings.teams)}»` : 'Se compara con todas las entregas'}</li>
      <li>Analizado ${esc(fmt(report.analyzedAt))}</li></ul>
      <p>Para cambiar estas opciones, vuelve a analizar en <button type="button" class="text-btn" data-similarity-open="${esc(t.id)}">Similitud</button>.</p></details>`;
}

/** Lleva el documento al bloque `index` (si la fuente lo tiene cubierto por otra, se marca solo esa fuente). */
function simrGoTo(st, index) {
  const block = st.report.data.blocks[index];
  if (!block) return;
  st.open = block[0];
  st.active = index;
  let target = document.querySelector(`#simrDoc [data-simr-block="${index}"]`);
  if (!target) {
    st.focus = block[0];
    simrPaint(st);
    target = document.querySelector(`#simrDoc [data-simr-block="${index}"]`);
  } else simrMarkActive(st);
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function simrMarkActive(st) {
  document.querySelectorAll('#simrDoc .is-active').forEach((el) => el.classList.remove('is-active'));
  document.querySelectorAll(`#simrDoc [data-simr-block="${st.active}"]`).forEach((el) => el.classList.add('is-active'));
  simrPaintSide(st);
}

document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-simr-open]');
  if (open) {
    if (!open.dataset.simrOpen) return;
    section = 'simreport';
    detail = open.dataset.simrOpen;
    return render();
  }
  const generate = e.target.closest('[data-simr-generate]');
  if (generate) {
    const t = find(generate.dataset.simrGenerate);
    return t && simGenerate(t);
  }
  const compare = e.target.closest('[data-simr-compare]');
  if (compare) {
    const [task, a, b] = compare.dataset.simrCompare.split(':');
    simCompareRequest = [a, b];
    section = 'similarity';
    detail = task;
    return render();
  }
  const st = simrViewer?.state;
  if (!st || !e.target.closest('#simReport')) return;
  const source = e.target.closest('[data-simr-source]');
  if (source) {
    const k = Number(source.dataset.simrSource);
    st.open = st.open === k ? null : k;
    return simrPaintSide(st);
  }
  const goto = e.target.closest('[data-simr-goto]');
  if (goto) return simrGoTo(st, Number(goto.dataset.simrGoto));
  const focus = e.target.closest('[data-simr-focus]');
  if (focus) {
    const k = Number(focus.dataset.simrFocus);
    st.focus = st.focus === k ? null : k;
    return simrPaint(st);
  }
  if (e.target.closest('[data-simr-include-all]')) {
    st.hidden.clear();
    return simrPaint(st);
  }
  const mark = e.target.closest('#simrDoc [data-simr-block]');
  if (mark) {
    st.open = Number(mark.dataset.simrMark);
    st.active = Number(mark.dataset.simrBlock);
    simrMarkActive(st);
    document.querySelector('#simrSide .simr-block.is-active')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});
document.addEventListener('change', (e) => {
  const st = simrViewer?.state;
  if (!st) return;
  const exclude = e.target.closest('[data-simr-exclude]');
  if (exclude) {
    const k = Number(exclude.dataset.simrExclude);
    if (exclude.checked) st.hidden.add(k);
    else st.hidden.delete(k);
    if (st.focus === k) st.focus = null;
    return simrPaint(st);
  }
  if (e.target.closest('[data-simr-overlap]')) {
    st.overlap = e.target.checked;
    simrPaintSide(st);
  }
});
