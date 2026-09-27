/* Texto con formato para contenido, noticias, foros, instrucciones y comentarios.
 *
 * Se guarda como texto sencillo con marcas fáciles de leer (el mismo texto de siempre sigue viéndose bien):
 *   **negrita**   *cursiva*   # Título   ## Subtítulo   - lista   1. lista numerada   > cita   ---
 *   [texto](https://enlace)   ![descripción](archivo:ID)   y fórmulas $…$, $$…$$, \(…\), \[…\] (KaTeX, en math.js).
 *
 * Seguridad: todo el texto se escapa antes de dar formato; solo se generan etiquetas fijas, los enlaces
 * aceptan únicamente http/https y las imágenes solo archivos del propio elemento, servidos por Enlace.
 */

const RICH_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const richEsc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => RICH_ESCAPES[c]);

// Fórmulas: se apartan antes de dar formato para que * o _ dentro de LaTeX no se conviertan en cursivas.
const RICH_MATH = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\\)\$(?:\\.|[^$\\\n])+?\$/g;

/** Formato dentro de una línea. `text` llega sin escapar; `slots` guarda las fórmulas apartadas. */
function richInline(text, { fileIds, slots }) {
  const tokens = [];
  const keep = (html) => `\u0001${tokens.push(html) - 1}\u0001`;
  let out = richEsc(text);
  out = out.replace(/!\[([^\]\n]*)\]\(archivo:([A-Za-z0-9-]{1,64})\)/g, (_, alt, id) =>
    fileIds.includes(id)
      ? keep(`<img class="rich-image" src="/api/file/${id}?preview=1" alt="${alt}" loading="lazy">`)
      : keep(`<span class="muted">[imagen no disponible]</span>`),
  );
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) =>
    keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`),
  );
  out = out.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]]/g, (url) => keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
  out = out.replace(/\*\*(?=\S)([^*]+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*(?=\S)([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>');
  // Un enlace puede contener una imagen: se restauran los marcadores hasta que no quede ninguno.
  for (let pass = 0; pass < 3 && out.includes('\u0001'); pass++) out = out.replace(/\u0001(\d+)\u0001/g, (_, i) => tokens[i] ?? '');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => richEsc(slots[i]));
}

/**
 * Convierte el texto guardado en HTML seguro.
 * `fileIds`: archivos adjuntos al elemento (las únicas imágenes que se pueden mostrar).
 */
function richText(source, fileIds = []) {
  const slots = [];
  const text = String(source ?? '').replace(/[\u0000\u0001]/g, '').replace(RICH_MATH, (m) => `\u0000${slots.push(m) - 1}\u0000`);
  const ctx = { fileIds: Array.isArray(fileIds) ? fileIds : [], slots };
  const html = [];
  let paragraph = [];
  let list = null; // { tag, items }
  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${paragraph.map((l) => richInline(l, ctx)).join('<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) html.push(`<${list.tag}>${list.items.map((i) => `<li>${richInline(i, ctx)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };
  for (const line of text.split(/\r?\n/)) {
    let m;
    if (!line.trim()) {
      flush();
    } else if ((m = /^(#{1,3})\s+(.+)$/.exec(line))) {
      flush();
      const tag = ['h3', 'h4', 'h5'][m[1].length - 1];
      html.push(`<${tag}>${richInline(m[2], ctx)}</${tag}>`);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      html.push('<hr>');
    } else if ((m = /^\s*[-*•]\s+(.+)$/.exec(line)) || (m = /^\s*\d+[.)]\s+(.+)$/.exec(line))) {
      const tag = /^\s*\d/.test(line) ? 'ol' : 'ul';
      flushParagraph();
      if (list?.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push(m[1]);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flush();
      html.push(`<blockquote>${richInline(m[1], ctx)}</blockquote>`);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flush();
  return `<div class="body-text rich">${html.join('')}</div>`;
}

// ---- Editor --------------------------------------------------------------------------------------

const RICH_TOOLS = [
  ['bold', 'N', 'Negrita'],
  ['italic', 'C', 'Cursiva'],
  ['heading', 'Título', 'Título de sección'],
  ['ul', '• Lista', 'Lista con viñetas'],
  ['ol', '1. Lista', 'Lista numerada'],
  ['link', 'Enlace', 'Insertar enlace'],
  ['math', 'Fórmula', 'Insertar fórmula'],
  ['image', 'Imagen', 'Insertar imagen'],
];

/** Área de texto con barra de formato y vista previa. Con `images` agrega el botón para insertar fotos. */
function richTextarea(label, name, value = '', { required = false, images = false } = {}) {
  const tools = RICH_TOOLS.filter(([id]) => images || id !== 'image')
    .map(([id, text, title]) => `<button type="button" class="rich-tool rich-${id}" data-format="${id}" title="${title}" aria-label="${title}">${text}</button>`)
    .join('');
  return `<div class="rich-editor" data-rich-editor><span class="rich-label">${label}</span>
    <div class="rich-toolbar" role="toolbar" aria-label="Formato de ${richEsc(label.toLowerCase())}">${tools}
      <button type="button" class="rich-tool rich-preview-toggle" data-format="preview" aria-pressed="false">Vista previa</button></div>
    <textarea name="${name}" aria-label="${richEsc(label)}" ${required ? 'required' : ''}>${richEsc(value)}</textarea>
    <div class="rich-preview" data-rich-preview hidden></div>
    <p class="rich-hint muted">Selecciona texto y usa los botones, o escribe **negrita**, *cursiva*, - lista. Fórmulas: $v = v_0 + a t$.</p>
    ${images ? '<input type="file" accept="image/*" data-rich-image hidden>' : ''}</div>`;
}

/** Envuelve la selección (o inserta un ejemplo) y deja el cursor listo para seguir escribiendo. */
function richWrap(area, before, after = before, sample = 'texto') {
  const { selectionStart: start, selectionEnd: end, value } = area;
  const selected = value.slice(start, end) || sample;
  area.setRangeText(before + selected + after, start, end, 'end');
  area.setSelectionRange(start + before.length, start + before.length + selected.length);
  area.focus();
  area.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Inserta un bloque en su propia línea, después de la selección (sin reemplazarla). */
function richInsertBlock(area, text) {
  const at = area.selectionEnd;
  const before = area.value.slice(0, at);
  const block = (before && !before.endsWith('\n') ? '\n' : '') + text + '\n';
  area.setRangeText(block, at, at, 'end');
  area.focus();
  area.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Agrega un prefijo a cada línea seleccionada (listas y títulos). */
function richPrefix(area, prefix) {
  const { value } = area;
  const start = value.lastIndexOf('\n', area.selectionStart - 1) + 1;
  const endBreak = value.indexOf('\n', area.selectionEnd);
  const end = endBreak === -1 ? value.length : endBreak;
  const lines = (value.slice(start, end) || '').split('\n');
  const text = lines.map((l, i) => (typeof prefix === 'function' ? prefix(i) : prefix) + l.replace(/^(\s*([-*•]|\d+[.)]|#{1,3})\s+)/, '')).join('\n');
  area.setRangeText(text, start, end, 'end');
  area.focus();
  area.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Registro del gestor de adjuntos del formulario abierto, para que "Imagen" sume la foto a sus archivos. */
let richAttachments = null;

/** Archivos que el elemento en edición tendrá al guardar (para mostrar sus imágenes en la vista previa). */
const richCurrentFileIds = () => richAttachments?.ids?.() || [];

function richRefreshPreview(editor) {
  const preview = editor.querySelector('[data-rich-preview]');
  if (preview.hidden) return;
  preview.innerHTML = richText(editor.querySelector('textarea').value, richCurrentFileIds());
}

document.addEventListener('click', async (e) => {
  const tool = e.target.closest('[data-format]');
  const editor = tool?.closest('[data-rich-editor]');
  if (!editor) return;
  const area = editor.querySelector('textarea');
  switch (tool.dataset.format) {
    case 'bold':
      return richWrap(area, '**');
    case 'italic':
      return richWrap(area, '*');
    case 'heading':
      return richPrefix(area, '## ');
    case 'ul':
      return richPrefix(area, '- ');
    case 'ol':
      return richPrefix(area, (i) => `${i + 1}. `);
    case 'math':
      return richWrap(area, '$', '$', 'v = v_0 + a t');
    case 'link': {
      const url = prompt('Dirección del enlace (https://…)', 'https://');
      if (!url || !/^https?:\/\/\S+$/.test(url.trim())) return;
      return richWrap(area, '[', `](${url.trim()})`, 'texto del enlace');
    }
    case 'image':
      return editor.querySelector('[data-rich-image]')?.click();
    case 'preview': {
      const preview = editor.querySelector('[data-rich-preview]');
      preview.hidden = !preview.hidden;
      area.hidden = !preview.hidden;
      tool.setAttribute('aria-pressed', String(!preview.hidden));
      tool.textContent = preview.hidden ? 'Vista previa' : 'Seguir editando';
      editor.querySelectorAll('.rich-tool:not(.rich-preview-toggle)').forEach((b) => (b.disabled = !preview.hidden));
      return richRefreshPreview(editor);
    }
  }
});

document.addEventListener('change', async (e) => {
  const input = e.target.closest('[data-rich-image]');
  if (!input?.files.length) return;
  const editor = input.closest('[data-rich-editor]');
  const area = editor.querySelector('textarea');
  const file = input.files[0];
  input.value = '';
  if (!richAttachments) return toast('Guarda primero el elemento para poder insertar imágenes.');
  try {
    const item = await richAttachments.uploadNow(file);
    richInsertBlock(area, `![${file.name.replace(/\.[^.]+$/, '').replace(/[[\]]/g, '')}](archivo:${item.id})`);
  } catch (error) {
    toast(error.message);
  }
});
