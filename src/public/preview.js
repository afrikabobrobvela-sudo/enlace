/* Vista previa de archivos: PDF (pdf.js), imágenes con zoom y giro, audio y video.
   Word, Excel y PowerPoint solo se descargan por ahora. */

const PDFJS_BASE = '/vendor/pdfjs-5.6.205/';
const PREVIEW_KINDS = {
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', heic: 'image',
  mp3: 'audio', m4a: 'audio', wav: 'audio', ogg: 'audio', aac: 'audio',
  mp4: 'video', m4v: 'video', mov: 'video', webm: 'video',
};
let pdfjsLibPromise = null;
let dialogPreview = null;
let inlinePreview = null;

function previewKind(name) {
  return PREVIEW_KINDS[String(name || '').split('.').pop().toLowerCase()] || null;
}

function previewFileInfo(id) {
  return current?.files.find((f) => f.id === id) || null;
}

function loadPdfjs() {
  pdfjsLibPromise ??= import(PDFJS_BASE + 'pdf.min.mjs').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.mjs';
    return lib;
  });
  return pdfjsLibPromise;
}

/**
 * Monta la vista previa de `fileId` dentro de `target`. `siblings` son los archivos entre los que
 * se puede avanzar. Devuelve un objeto con destroy() para liberar memoria (documentos PDF).
 */
function mountPreview(target, fileId, siblings = [fileId], { inline = false } = {}) {
  const list = siblings.filter((id) => previewFileInfo(id));
  let index = Math.max(0, list.indexOf(fileId));
  let zoom = 1;
  let rotation = 0;
  let cleanup = () => {};
  let destroyed = false;

  const toolbar = document.createElement('div');
  toolbar.className = 'viewer-toolbar';
  const stage = document.createElement('div');
  stage.className = 'viewer-stage';
  target.replaceChildren(toolbar, stage);

  function controls(kind, file) {
    const count = list.length > 1
      ? `<button type="button" class="viewer-btn" data-viewer="prev" aria-label="Archivo anterior" ${index ? '' : 'disabled'}>‹</button>
         <span class="viewer-count">${index + 1} de ${list.length}</span>
         <button type="button" class="viewer-btn" data-viewer="next" aria-label="Archivo siguiente" ${index < list.length - 1 ? '' : 'disabled'}>›</button>`
      : '';
    const zoomable = kind === 'pdf' || kind === 'image';
    toolbar.innerHTML = `
      <span class="viewer-name" title="${esc(file.name)}">${esc(file.name)}</span>
      <span class="viewer-group">${count}</span>
      <span class="viewer-group">
        ${zoomable ? `<button type="button" class="viewer-btn" data-viewer="out" aria-label="Alejar">−</button>
          <button type="button" class="viewer-btn viewer-fit" data-viewer="fit">Ajustar</button>
          <button type="button" class="viewer-btn" data-viewer="in" aria-label="Acercar">+</button>` : ''}
        ${kind === 'image' ? '<button type="button" class="viewer-btn" data-viewer="rotate">Girar</button>' : ''}
        ${inline ? '<button type="button" class="viewer-btn" data-viewer="expand">Ampliar</button>' : ''}
        <a class="viewer-btn" href="/api/file/${encodeURIComponent(file.id)}">Descargar</a>
        ${inline ? '' : '<button type="button" class="viewer-btn viewer-close" data-viewer="close" aria-label="Cerrar vista previa">×</button>'}
      </span>`;
  }

  function message(text, file) {
    stage.innerHTML = `<div class="viewer-message"><p>${esc(text)}</p><a class="primary" href="/api/file/${encodeURIComponent(file.id)}">Descargar ${esc(file.name)}</a></div>`;
  }

  async function show() {
    cleanup();
    cleanup = () => {};
    zoom = 1;
    rotation = 0;
    const file = previewFileInfo(list[index]);
    const kind = previewKind(file.name);
    const url = `/api/file/${encodeURIComponent(file.id)}?preview=1`;
    controls(kind, file);
    stage.className = 'viewer-stage viewer-' + (kind || 'none');
    if (kind === 'pdf') return showPdf(url, file);
    if (kind === 'image') return showImage(url, file);
    if (kind === 'audio' || kind === 'video') {
      const media = document.createElement(kind);
      media.controls = true;
      media.preload = 'metadata';
      if (kind === 'video') media.playsInline = true;
      media.src = url;
      media.onerror = () =>
        message(
          kind === 'video'
            ? 'Este navegador no puede reproducir este video. Los videos .mov de iPhone a veces solo se reproducen en Safari.'
            : 'Este navegador no puede reproducir este audio.',
          file,
        );
      stage.replaceChildren(media);
      cleanup = () => media.removeAttribute('src');
      return;
    }
    message('La vista previa de este tipo de archivo todavía no está disponible.', file);
  }

  function showImage(url, file) {
    stage.innerHTML = '<div class="image-frame"><img alt=""></div>';
    const frame = stage.firstElementChild;
    const img = frame.firstElementChild;
    img.alt = file.name;
    const layout = () => {
      if (!img.naturalWidth) return;
      const turned = rotation % 180 !== 0;
      const w = turned ? img.naturalHeight : img.naturalWidth;
      const h = turned ? img.naturalWidth : img.naturalHeight;
      const fit = Math.min((stage.clientWidth - 16) / w, (stage.clientHeight - 16) / h, 1);
      const scale = fit * zoom;
      frame.style.width = w * scale + 'px';
      frame.style.height = h * scale + 'px';
      img.style.width = img.naturalWidth * scale + 'px';
      img.style.height = img.naturalHeight * scale + 'px';
      img.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
    };
    img.onload = layout;
    img.onerror = () =>
      message(
        file.name.toLowerCase().endsWith('.heic')
          ? 'Este navegador no muestra fotos HEIC de iPhone. Descárgala, ábrela en Safari o pide la foto en JPG.'
          : 'No se pudo mostrar la imagen.',
        file,
      );
    img.ondblclick = () => {
      zoom = zoom === 1 ? 2 : 1;
      layout();
    };
    img.src = url;
    const onResize = () => layout();
    window.addEventListener('resize', onResize);
    stage.onwheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return; // pellizco en trackpad o Ctrl + rueda
      event.preventDefault();
      zoom = Math.min(6, Math.max(0.25, zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
      layout();
    };
    stage.relayout = layout;
    cleanup = () => {
      window.removeEventListener('resize', onResize);
      stage.onwheel = null;
    };
  }

  async function showPdf(url, file) {
    stage.innerHTML = '<p class="viewer-loading">Abriendo PDF…</p>';
    let pdf;
    try {
      const lib = await loadPdfjs();
      const task = lib.getDocument({ url, isEvalSupported: false, wasmUrl: PDFJS_BASE + 'wasm/' });
      cleanup = () => task.destroy();
      pdf = await task.promise;
    } catch (error) {
      if (!destroyed) message(error?.status === 415 ? 'Este archivo no es un PDF válido.' : 'No se pudo abrir el PDF. Puedes descargarlo.', file);
      return;
    }
    if (destroyed) return pdf.destroy();
    const first = await pdf.getPage(1);
    const base = first.getViewport({ scale: 1 });
    const pages = document.createElement('div');
    pages.className = 'pdf-pages';
    const counter = document.createElement('p');
    counter.className = 'pdf-counter';
    counter.setAttribute('aria-live', 'polite');
    stage.replaceChildren(counter, pages);
    const slots = [];
    const rendered = new Map();
    const width = () => Math.max(200, (stage.clientWidth - 24) * zoom);
    for (let n = 1; n <= pdf.numPages; n++) {
      const slot = document.createElement('div');
      slot.className = 'pdf-page';
      slot.dataset.page = n;
      slot.setAttribute('aria-label', `Página ${n} de ${pdf.numPages}`);
      pages.append(slot);
      slots.push(slot);
    }
    const size = () => {
      for (const slot of slots) {
        slot.style.width = width() + 'px';
        slot.style.height = (width() * base.height) / base.width + 'px';
      }
    };
    async function draw(slot) {
      const n = Number(slot.dataset.page);
      const key = n + ':' + zoom;
      if (rendered.get(n) === key) return;
      rendered.set(n, key);
      const page = await pdf.getPage(n);
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: (width() / page.getViewport({ scale: 1 }).width) * ratio });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      if (rendered.get(n) === key) slot.replaceChildren(canvas);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) draw(entry.target).catch(() => {});
        const visible = slots.find((s) => s.getBoundingClientRect().bottom > stage.getBoundingClientRect().top + 40);
        counter.textContent = `Página ${visible ? visible.dataset.page : 1} de ${pdf.numPages}`;
      },
      { root: stage, rootMargin: '600px 0px' },
    );
    size();
    slots.forEach((s) => observer.observe(s));
    stage.relayout = () => {
      size();
      rendered.clear();
      slots.forEach((s) => {
        observer.unobserve(s);
        observer.observe(s);
      });
    };
    cleanup = () => {
      observer.disconnect();
      pdf.destroy();
    };
  }

  toolbar.addEventListener('click', (event) => {
    const action = event.target.closest('[data-viewer]')?.dataset.viewer;
    if (!action) return;
    if (action === 'prev' && index > 0) (index--, show());
    if (action === 'next' && index < list.length - 1) (index++, show());
    if (action === 'in') zoom = Math.min(6, zoom * 1.25);
    if (action === 'out') zoom = Math.max(0.25, zoom / 1.25);
    if (action === 'fit') zoom = 1;
    if (action === 'rotate') rotation = (rotation + 90) % 360;
    if (['in', 'out', 'fit', 'rotate'].includes(action)) stage.relayout?.();
    if (action === 'expand') openPreview(list[index], list);
    if (action === 'close') closePreview();
  });

  show();
  return {
    step(delta) {
      const nextIndex = index + delta;
      if (nextIndex >= 0 && nextIndex < list.length) {
        index = nextIndex;
        show();
      }
    },
    destroy() {
      destroyed = true;
      cleanup();
    },
  };
}

// ---- Diálogo a pantalla completa ----------------------------------------------------------------

function viewerDialog() {
  let dialog = document.getElementById('viewer');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'viewer';
    dialog.className = 'viewer';
    dialog.setAttribute('aria-label', 'Vista previa');
    dialog.addEventListener('close', () => {
      dialogPreview?.destroy();
      dialogPreview = null;
      dialog.replaceChildren();
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') dialogPreview?.step(-1);
      if (event.key === 'ArrowRight') dialogPreview?.step(1);
    });
    document.body.append(dialog);
  }
  return dialog;
}

function openPreview(fileId, siblings) {
  const dialog = viewerDialog();
  dialogPreview?.destroy();
  const previewable = (siblings || [fileId]).filter((id) => previewKind(previewFileInfo(id)?.name));
  dialogPreview = mountPreview(dialog, fileId, previewable.length ? previewable : [fileId]);
  if (!dialog.open) dialog.showModal();
}

function closePreview() {
  const dialog = document.getElementById('viewer');
  if (dialog?.open) dialog.close();
}

/** Vista previa incrustada (pantalla de revisión). Libera la anterior antes de montar otra. */
function mountInlinePreview(target, fileId, siblings) {
  inlinePreview?.destroy();
  inlinePreview = target ? mountPreview(target, fileId, siblings, { inline: true }) : null;
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-preview]');
  if (!button) return;
  event.preventDefault();
  openPreview(button.dataset.preview, (button.dataset.files || button.dataset.preview).split(','));
});
