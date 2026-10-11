/* Anotar entregas (12.69; servidor en src/server/anotaciones.js).
 * El docente abre un PDF o una imagen de la entrega («Anotar» en la pantalla de revisión) y marca con pluma, resaltado
 * y comentarios numerados; al guardar, el alumno los ve («Ver correcciones» en su entrega) cuando la calificación está
 * publicada, y ambos pueden descargar el archivo con las correcciones en PDF.
 * Cada página lleva un SVG encima del dibujo de la página; sus unidades son milésimas del ancho (viewBox 0 0 1000 alto),
 * y se guardan divididas entre 1000 para dibujarse igual a cualquier tamaño. */

const ANN_COLOR = '#c0183f';
const ANN_HIGHLIGHT = 'rgba(255, 196, 20, 0.38)';
const ANN_MAX_PAGES = 60;
const ANN_RENDER_WIDTH = 1400; // píxeles del dibujo de cada página (nitidez al ampliar y al descargar)
let ann = null; // { fileId, file, editable, data, pages: [{ canvas, ratio }], tool, dirty, history }

const annotatedIds = () => new Set((current?.annotated || []).map((a) => a.file_id));
const annKind = (name) => (typeof previewKind === 'function' ? previewKind(name) : null);

/** Botones para la pantalla de revisión (docente) o para la entrega del alumno. */
function annotateButtonsHtml(fileIds = [], editable = false) {
  const marked = annotatedIds();
  const files = fileIds.map((id) => current.files.find((f) => f.id === id)).filter((f) => f && ['pdf', 'image'].includes(annKind(f.name)));
  const shown = editable ? files : files.filter((f) => marked.has(f.id));
  if (!shown.length) return '';
  return `<div class="annotate-actions">${shown
    .map((f) =>
      editable
        ? `<button type="button" class="secondary" data-annotate="${esc(f.id)}" data-edit="1">${marked.has(f.id) ? 'Ver y editar correcciones' : 'Anotar'}: ${esc(f.name)}</button>`
        : `<button type="button" class="primary" data-annotate="${esc(f.id)}">Ver correcciones: ${esc(f.name)}</button>`,
    )
    .join('')}</div>`;
}

function annDialog() {
  let dialog = document.getElementById('annotator');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'annotator';
    dialog.className = 'annotator';
    dialog.setAttribute('aria-label', 'Correcciones de la entrega');
    dialog.addEventListener('cancel', (e) => {
      if (ann?.dirty && !confirm('Tienes correcciones sin guardar. ¿Cerrar de todos modos?')) e.preventDefault();
    });
    dialog.addEventListener('close', () => {
      ann = null;
      dialog.replaceChildren();
    });
    document.body.append(dialog);
  }
  return dialog;
}

/** Dibuja las páginas del archivo (PDF con pdf.js o imagen) en lienzos. */
async function annLoadPages(file) {
  const url = `/api/file/${encodeURIComponent(file.id)}?preview=1`;
  if (annKind(file.name) === 'image') {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, ANN_RENDER_WIDTH / img.naturalWidth) || 1;
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return [{ canvas, ratio: canvas.height / canvas.width }];
  }
  const lib = await loadPdfjs();
  const pdf = await lib.getDocument({ url, isEvalSupported: false, wasmUrl: PDFJS_BASE + 'wasm/' }).promise;
  const pages = [];
  try {
    for (let n = 1; n <= Math.min(pdf.numPages, ANN_MAX_PAGES); n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: ANN_RENDER_WIDTH / page.getViewport({ scale: 1 }).width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      pages.push({ canvas, ratio: canvas.height / canvas.width });
    }
  } finally {
    pdf.destroy();
  }
  if (pdf.numPages > ANN_MAX_PAGES) toast(`Solo se pueden anotar las primeras ${ANN_MAX_PAGES} páginas.`);
  return pages;
}

const annItems = (n) => (ann.data.pages[n] ||= []);
const annNumberOf = (n, item) => annItems(n).filter((i) => i.t === 'text').indexOf(item) + 1;

function annItemSvg(n, item, i) {
  const k = 1000;
  if (item.t === 'pen') return `<path data-i="${i}" d="M${item.pts.map(([x, y]) => `${(x * k).toFixed(1)} ${(y * k).toFixed(1)}`).join(' L')}" fill="none" stroke="${item.c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (item.t === 'box') return `<rect data-i="${i}" x="${item.x * k}" y="${item.y * k}" width="${item.w * k}" height="${item.h * k}" fill="${ANN_HIGHLIGHT}"/>`;
  const num = annNumberOf(n, item);
  return `<g data-i="${i}" class="ann-marker"><circle cx="${item.x * k}" cy="${item.y * k}" r="15" fill="${ANN_COLOR}"/><text x="${item.x * k}" y="${item.y * k + 6}" text-anchor="middle" font-size="17" font-weight="700" fill="#fff">${num}</text><title>${esc(item.s)}</title></g>`;
}

function annDrawPage(n) {
  const slot = document.querySelector(`#annotator .ann-page[data-page="${n}"]`);
  if (!slot) return;
  slot.querySelector('svg').innerHTML = annItems(n).map((item, i) => annItemSvg(n, item, i)).join('');
  const notes = annItems(n).filter((i) => i.t === 'text');
  slot.querySelector('.ann-notes').innerHTML = notes.length
    ? `<h3>Comentarios de la página ${n}</h3><ol>${notes.map((i) => `<li>${esc(i.s)}</li>`).join('')}</ol>`
    : '';
}

function annSnapshot() {
  ann.history.push(JSON.stringify(ann.data));
  if (ann.history.length > 60) ann.history.shift();
  ann.dirty = true;
  annSyncToolbar();
}

function annSyncToolbar() {
  const dialog = document.getElementById('annotator');
  dialog?.querySelectorAll('[data-ann-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.annTool === ann.tool)));
  const undo = dialog?.querySelector('[data-ann="undo"]');
  if (undo) undo.disabled = !ann.history.length;
  const save = dialog?.querySelector('[data-ann="save"]');
  if (save) save.textContent = ann.dirty ? 'Guardar' : 'Guardado';
  dialog?.querySelector('.ann-pages')?.setAttribute('data-tool', ann.tool);
}

/** Punto del puntero en unidades del SVG de la página. */
function annPoint(svg, event) {
  const box = svg.getBoundingClientRect();
  const height = Number(svg.dataset.height);
  return [Math.min(1000, Math.max(0, ((event.clientX - box.left) / box.width) * 1000)), Math.min(height, Math.max(0, ((event.clientY - box.top) / box.height) * height))];
}

function annBindPage(slot) {
  const n = slot.dataset.page;
  const svg = slot.querySelector('svg');
  let drawing = null;
  svg.addEventListener('pointerdown', (event) => {
    if (!ann.editable || event.button > 0) return;
    const [x, y] = annPoint(svg, event);
    if (ann.tool === 'erase') {
      const target = event.target.closest('[data-i]');
      if (!target) return;
      annSnapshot();
      annItems(n).splice(Number(target.dataset.i), 1);
      return annDrawPage(n);
    }
    if (ann.tool === 'text') {
      const text = prompt('Comentario para el alumno (aparece con un número en la página):');
      if (!text?.trim()) return;
      annSnapshot();
      annItems(n).push({ t: 'text', x: x / 1000, y: y / 1000, s: text.trim().slice(0, 500) });
      return annDrawPage(n);
    }
    if (ann.tool !== 'pen' && ann.tool !== 'box') return;
    event.preventDefault();
    svg.setPointerCapture(event.pointerId);
    drawing = { start: [x, y], pts: [[x, y]], el: null };
    drawing.el = document.createElementNS('http://www.w3.org/2000/svg', ann.tool === 'pen' ? 'path' : 'rect');
    if (ann.tool === 'pen') drawing.el.setAttribute('fill', 'none'), drawing.el.setAttribute('stroke', ANN_COLOR), drawing.el.setAttribute('stroke-width', '3'), drawing.el.setAttribute('stroke-linecap', 'round');
    else drawing.el.setAttribute('fill', ANN_HIGHLIGHT);
    svg.append(drawing.el);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    const [x, y] = annPoint(svg, event);
    if (ann.tool === 'pen') {
      const [lx, ly] = drawing.pts[drawing.pts.length - 1];
      if (Math.hypot(x - lx, y - ly) < 1.5 || drawing.pts.length >= 1400) return;
      drawing.pts.push([x, y]);
      drawing.el.setAttribute('d', 'M' + drawing.pts.map((p) => p.join(' ')).join(' L'));
    } else {
      const [sx, sy] = drawing.start;
      drawing.el.setAttribute('x', Math.min(sx, x));
      drawing.el.setAttribute('y', Math.min(sy, y));
      drawing.el.setAttribute('width', Math.abs(x - sx));
      drawing.el.setAttribute('height', Math.abs(y - sy));
      drawing.end = [x, y];
    }
  });
  const finish = () => {
    if (!drawing) return;
    const d = drawing;
    drawing = null;
    if (ann.tool === 'pen' && d.pts.length >= 2) {
      annSnapshot();
      annItems(n).push({ t: 'pen', c: ANN_COLOR, pts: d.pts.map(([x, y]) => [x / 1000, y / 1000]) });
    } else if (ann.tool === 'box' && d.end && Math.abs(d.end[0] - d.start[0]) > 4 && Math.abs(d.end[1] - d.start[1]) > 4) {
      annSnapshot();
      const [sx, sy] = d.start;
      const [ex, ey] = d.end;
      annItems(n).push({ t: 'box', x: Math.min(sx, ex) / 1000, y: Math.min(sy, ey) / 1000, w: Math.abs(ex - sx) / 1000, h: Math.abs(ey - sy) / 1000 });
    }
    annDrawPage(n);
  };
  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointercancel', finish);
}

async function openAnnotator(fileId, editable = false) {
  const file = current.files.find((f) => f.id === fileId);
  if (!file) return toast('Ese archivo ya no está disponible.');
  const dialog = annDialog();
  dialog.innerHTML = '<p class="viewer-loading">Abriendo el archivo…</p>';
  if (!dialog.open) dialog.showModal();
  let data;
  let pages;
  try {
    [data, pages] = await Promise.all([
      request(`/api/annotation?course=${encodeURIComponent(current.course.id)}&file=${encodeURIComponent(fileId)}`).then((r) => r.data),
      annLoadPages(file),
    ]);
  } catch (error) {
    dialog.innerHTML = `<div class="viewer-message"><p>${esc(error.message || 'No se pudo abrir el archivo.')}</p><button type="button" class="secondary" data-ann="close">Cerrar</button></div>`;
    return;
  }
  ann = { fileId, file, editable, data: { v: 1, pages: data.pages || {} }, pages, tool: 'pen', dirty: false, history: [] };
  const tools = editable
    ? `<span class="ann-group" role="group" aria-label="Herramienta">
        <button type="button" class="viewer-btn" data-ann-tool="pen" aria-pressed="true">Pluma</button>
        <button type="button" class="viewer-btn" data-ann-tool="box" aria-pressed="false">Resaltar</button>
        <button type="button" class="viewer-btn" data-ann-tool="text" aria-pressed="false">Comentario</button>
        <button type="button" class="viewer-btn" data-ann-tool="erase" aria-pressed="false">Borrar</button>
        <button type="button" class="viewer-btn" data-ann-tool="move" aria-pressed="false">Desplazar</button>
      </span>
      <span class="ann-group"><button type="button" class="viewer-btn" data-ann="undo" disabled>Deshacer</button><button type="button" class="primary" data-ann="save">Guardado</button></span>`
    : '';
  dialog.innerHTML = `<div class="viewer-toolbar ann-toolbar"><span class="viewer-name" title="${esc(file.name)}">${editable ? 'Anotar' : 'Correcciones'}: ${esc(file.name)}</span>${tools}
      <span class="ann-group"><button type="button" class="viewer-btn" data-ann="pdf">Descargar con correcciones</button><button type="button" class="viewer-btn viewer-close" data-ann="close" aria-label="Cerrar">×</button></span></div>
    ${editable ? '<p class="ann-help">Pluma: dibuja sobre la página. Resaltar: arrastra un recuadro. Comentario: toca donde va el número. Borrar: toca una marca. En el celular, «Desplazar» para mover la página.</p>' : ''}
    <div class="ann-pages" data-tool="${editable ? 'pen' : 'view'}">${pages
      .map(
        (p, i) => `<section class="ann-page" data-page="${i + 1}" aria-label="Página ${i + 1} de ${pages.length}">
          <div class="ann-sheet"><svg viewBox="0 0 1000 ${(1000 * p.ratio).toFixed(1)}" data-height="${(1000 * p.ratio).toFixed(1)}" preserveAspectRatio="none" role="img" aria-label="Correcciones de la página ${i + 1}"></svg></div>
          <div class="ann-notes"></div></section>`,
      )
      .join('')}</div>`;
  dialog.querySelectorAll('.ann-page').forEach((slot, i) => {
    const canvas = pages[i].canvas;
    canvas.className = 'ann-canvas';
    slot.querySelector('.ann-sheet').prepend(canvas);
    annDrawPage(String(i + 1));
    annBindPage(slot);
  });
  annSyncToolbar();
}

/** PDF con cada página y sus marcas (y los comentarios abajo), para descargar. */
async function annDownload() {
  const out = [];
  for (const [i, page] of ann.pages.entries()) {
    const n = String(i + 1);
    const items = ann.data.pages[n] || [];
    const notes = items.filter((it) => it.t === 'text');
    const W = page.canvas.width;
    const s = W / 1000;
    const lineH = Math.round(30 * s * 0.9);
    const ctxProbe = document.createElement('canvas').getContext('2d');
    ctxProbe.font = `${Math.round(22 * s * 0.9)}px Archivo, sans-serif`;
    const lines = notes.flatMap((note, k) => certLines(ctxProbe, `${k + 1}. ${note.s}`, W - 80 * s));
    const extra = notes.length ? 60 * s + lines.length * lineH : 0;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = page.canvas.height + Math.round(extra);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(page.canvas, 0, 0);
    for (const it of items) {
      if (it.t === 'pen') {
        ctx.strokeStyle = it.c;
        ctx.lineWidth = 3 * s;
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.beginPath();
        it.pts.forEach(([x, y], k) => (k ? ctx.lineTo(x * W, y * W) : ctx.moveTo(x * W, y * W)));
        ctx.stroke();
      } else if (it.t === 'box') {
        ctx.fillStyle = ANN_HIGHLIGHT;
        ctx.fillRect(it.x * W, it.y * W, it.w * W, it.h * W);
      }
    }
    notes.forEach((it, k) => {
      ctx.fillStyle = ANN_COLOR;
      ctx.beginPath();
      ctx.arc(it.x * W, it.y * W, 15 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.round(17 * s)}px Archivo, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(String(k + 1), it.x * W, it.y * W + 6 * s);
    });
    if (notes.length) {
      const top = page.canvas.height;
      ctx.fillStyle = '#fbe7ec';
      ctx.fillRect(0, top, W, extra);
      ctx.fillStyle = '#86102c';
      ctx.textAlign = 'left';
      ctx.font = `700 ${Math.round(22 * s)}px Archivo, sans-serif`;
      ctx.fillText(`Comentarios de la página ${n}`, 40 * s, top + 36 * s);
      ctx.fillStyle = '#111a2e';
      ctx.font = `${Math.round(22 * s * 0.9)}px Archivo, sans-serif`;
      lines.forEach((line, k) => ctx.fillText(line, 40 * s, top + 36 * s + (k + 1) * lineH));
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    out.push({ bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height });
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(jpegPagesToPdf(out));
  link.download = `corregido-${ann.file.name.replace(/\.[^.]+$/, '')}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

async function annSave() {
  const button = document.querySelector('#annotator [data-ann="save"]');
  if (button) button.disabled = true;
  try {
    const result = await request('/api/annotation', { course: current.course.id, file: ann.fileId, data: ann.data });
    ann.dirty = false;
    const list = (current.annotated || []).filter((a) => a.file_id !== ann.fileId);
    current.annotated = result.updated ? [...list, { file_id: ann.fileId, updated: result.updated }] : list;
    toast('Correcciones guardadas. El alumno las verá cuando la calificación esté publicada.');
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) button.disabled = false;
    annSyncToolbar();
  }
}

document.addEventListener('click', async (event) => {
  const open = event.target.closest('[data-annotate]');
  if (open) return openAnnotator(open.dataset.annotate, open.dataset.edit === '1').catch((e) => toast(e.message));
  if (!event.target.closest('#annotator')) return;
  const tool = event.target.closest('[data-ann-tool]')?.dataset.annTool;
  if (tool && ann) {
    ann.tool = tool;
    return annSyncToolbar();
  }
  const action = event.target.closest('[data-ann]')?.dataset.ann;
  if (action === 'close') {
    if (ann?.dirty && !confirm('Tienes correcciones sin guardar. ¿Cerrar de todos modos?')) return;
    document.getElementById('annotator').close();
  }
  if (!ann) return;
  if (action === 'undo' && ann.history.length) {
    ann.data = JSON.parse(ann.history.pop());
    ann.pages.forEach((_, i) => annDrawPage(String(i + 1)));
    annSyncToolbar();
  }
  if (action === 'save') await annSave();
  if (action === 'pdf') annDownload().catch((e) => toast(e.message));
});
