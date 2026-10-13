/* Texto con formato para contenido, noticias, foros, instrucciones y comentarios.
 *
 * Se guarda como texto sencillo con marcas fáciles de leer (el mismo texto de siempre sigue viéndose bien):
 *   **negrita**   *cursiva*   # Título   ## Subtítulo   - lista   1. lista numerada   > cita   ---
 *   [texto](https://enlace)   ![descripción](archivo:ID)   y fórmulas $…$, $$…$$, \(…\), \[…\] (KaTeX, en math.js).
 *   Un enlace de YouTube, Vimeo, Google Drive o Cloudflare Stream solo en su línea se muestra como video (12.66).
 *
 * Seguridad: todo el texto se escapa antes de dar formato; solo se generan etiquetas fijas, los enlaces
 * aceptan únicamente http/https y las imágenes solo archivos del propio elemento, servidos por Enlace.
 * Los videos nunca usan la dirección escrita: se extrae el identificador (validado con una expresión fija) y se
 * arma la dirección del reproductor de cada sitio; la CSP (frame-src en http.js) solo admite esos sitios.
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
  // Una URL nunca incluye marcadores internos (\u0000 fórmulas, \u0001 enlaces e imágenes ya convertidos).
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)\u0000\u0001]+)\)/g, (_, label, url) =>
    keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`),
  );
  out = out.replace(/\bhttps?:\/\/[^\s<\u0000\u0001]*[^\s<.,;:!?)\]\u0000\u0001]/g, (url) => keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
  out = out.replace(/\*\*(?=\S)([^*]+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*(?=\S)([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>');
  // Un enlace puede contener una imagen: se restauran los marcadores hasta que no quede ninguno.
  for (let pass = 0; pass < 3 && out.includes('\u0001'); pass++) out = out.replace(/\u0001(\d+)\u0001/g, (_, i) => tokens[i] ?? '');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => richEsc(slots[i]));
}

// ---- Videos (12.66) --------------------------------------------------------------------------------
// Cada sitio: expresión sobre la dirección completa → dirección del reproductor y nombre para el enlace de respaldo.
const RICH_VIDEO_SITES = [
  {
    name: 'YouTube',
    re: /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#][^\s]*)?$/,
    embed: (m, url) => {
      const start = /[?&#]t=(\d+)s?(?:&|$)/.exec(url)?.[1];
      return `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0${start ? '&start=' + start : ''}`;
    },
  },
  {
    name: 'Vimeo',
    re: /^https?:\/\/(?:www\.)?(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d{1,12})(?:\/([0-9a-f]{6,20}))?(?:[?#][^\s]*)?$/,
    embed: (m, url) => {
      const hash = m[2] || /[?&]h=([0-9a-f]{6,20})(?:&|$)/.exec(url)?.[1];
      return `https://player.vimeo.com/video/${m[1]}${hash ? '?h=' + hash : ''}`;
    },
  },
  {
    name: 'Google Drive',
    re: /^https?:\/\/drive\.google\.com\/(?:file\/d\/([A-Za-z0-9_-]{10,100})(?:\/(?:view|preview|edit))?|open\?id=([A-Za-z0-9_-]{10,100}))(?:[?&#][^\s]*)?$/,
    embed: (m) => `https://drive.google.com/file/d/${m[1] || m[2]}/preview`,
  },
  {
    name: 'Cloudflare Stream',
    re: /^https?:\/\/(customer-[a-z0-9]{1,40})\.cloudflarestream\.com\/([a-f0-9]{32})(?:\/(?:watch|iframe))?(?:[?#][^\s]*)?$/,
    embed: (m) => `https://${m[1]}.cloudflarestream.com/${m[2]}/iframe`,
  },
];

/** Si `url` es un video de un sitio admitido, devuelve { name, src } con la dirección del reproductor. */
function richVideo(url) {
  const clean = String(url ?? '').trim();
  for (const site of RICH_VIDEO_SITES) {
    const m = site.re.exec(clean);
    if (m) return { name: site.name, src: site.embed(m, clean) };
  }
  return null;
}

/** Reproductor incrustado con un enlace para abrirlo en el sitio original (por si la red lo bloquea). */
function richVideoHtml(video, url) {
  return `<figure class="rich-video"><div class="rich-video-frame"><iframe src="${richEsc(video.src)}" title="Video de ${video.name}" loading="lazy" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div><figcaption><a href="${richEsc(url)}" target="_blank" rel="noopener noreferrer">Abrir en ${video.name}</a></figcaption></figure>`;
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
    } else if ((m = /^\s*(https?:\/\/[^\s\u0000\u0001]+)\s*$/.exec(line)) && (m[2] = richVideo(m[1]))) {
      flush();
      html.push(richVideoHtml(m[2], m[1]));
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

// Barra al estilo Brightspace (12.76): estilo del párrafo, negrita/cursiva, listas, video, enlace, imagen, «+»,
// enlace rápido, vista previa y pantalla completa. Íconos SVG en línea (sin archivos ni fuentes de íconos).
const RICH_ICON = {
  ul: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="4.5" cy="6" r="1.5"/><circle cx="4.5" cy="12" r="1.5"/><circle cx="4.5" cy="18" r="1.5"/><path d="M9 6h12M9 12h12M9 18h12"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3.6-3.6a4 4 0 0 0-5.7-5.7L12 6.3"/><path d="M14 10a4 4 0 0 0-5.7 0l-3.6 3.6a4 4 0 0 0 5.7 5.7l1.6-1.6"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 4 4 3-3 4 4"/></svg>',
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
  full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
};
const RICH_TOOLS = [
  ['bold', '<b>B</b>', 'Negrita'],
  ['italic', '<i>I</i>', 'Cursiva'],
];

// Menú «+» (12.76, como el de Brightspace): ecuación en su línea, divisor, símbolos de matemáticas y física, y emojis.
const RICH_SYMBOLS = 'α β γ δ Δ ε θ λ μ ν π ρ σ τ φ ω Ω ° ± × ÷ ≈ ≠ ≤ ≥ ∞ √ ∑ ∫ ∂ ∇ → ⇒ ↔ ∝ ∈ ∀ ∃ ℏ Å · ² ³ ½'.split(' ');
const RICH_EMOJIS = '🙂 😀 👍 👏 🎉 ✅ ❌ ⚠️ 📌 📎 📅 ⏰ 📝 📚 🔬 🧪 💡 ⭐'.split(' ');
function richMoreHtml() {
  const grid = (items, label) => `<div class="rich-grid" role="group" aria-label="${label}">${items.map((x) => `<button type="button" class="rich-cell" data-rich-insert="${x}" aria-label="Insertar ${x}">${x}</button>`).join('')}</div>`;
  return `<details class="rich-more"><summary class="rich-tool" title="Insertar" aria-label="Insertar ecuación, divisor, símbolos o emoji">＋</summary><div class="rich-more-panel">
    <button type="button" class="rich-menu-item" data-format="equation"><span aria-hidden="true">Σ</span> Ecuación (en su propia línea)</button>
    <button type="button" class="rich-menu-item" data-format="math"><span aria-hidden="true">𝑥</span> Fórmula dentro del texto</button>
    <button type="button" class="rich-menu-item" data-format="divider"><span aria-hidden="true">—</span> Divisor</button>
    <p class="rich-menu-head"><span aria-hidden="true">Ω</span> Símbolos</p>${grid(RICH_SYMBOLS, 'Símbolos')}
    <p class="rich-menu-head"><span aria-hidden="true">🙂</span> Emoji</p>${grid(RICH_EMOJIS, 'Emoji')}</div></details>`;
}

// Enlace rápido (12.76): a un elemento del curso abierto (solo quien enseña). La dirección es la de Enlace (https), así
// que richText la acepta como cualquier enlace; se abre en otra pestaña directo en ese elemento.
function richQuickLinkHtml() {
  if (typeof current === 'undefined' || !current?.records || typeof teaches !== 'function' || !teaches()) return '';
  return `<details class="rich-more rich-quick"><summary class="rich-tool" title="Insertar enlace rápido a un elemento del curso">Enlace rápido</summary><div class="rich-more-panel" data-rich-quick></div></details>`;
}
function richQuickItems() {
  const c = current.course.id;
  const url = (q) => `${location.origin}/#c=${encodeURIComponent(c)}&${q}`;
  const live = (kind) => current.records.filter((r) => r.kind === kind && !r.deleted_at).sort((a, b) => String(a.data.title || '').localeCompare(String(b.data.title || ''), 'es'));
  return [
    ['Actividades', live('task').map((r) => [r.data.title, url(`s=task&d=${r.id}`)])],
    ['Contenido', [...live('module').map((r) => [r.data.title, url(`s=content&m=${r.id}`)]), ...live('material').map((r) => [r.data.title, url(`s=content${r.data.module ? `&m=${r.data.module}` : ''}`)])]],
    ['Evaluaciones', live('quiz').map((r) => [r.data.title, url(`s=quiz&d=${r.id}`)])],
    ['Foros', live('forum').map((r) => [r.data.title, url(`s=forum&d=${r.id}`)])],
  ].filter(([, items]) => items.length);
}

/** Área de texto con barra de formato y vista previa. Con `images` agrega el botón para insertar fotos. */
function richTextarea(label, name, value = '', { required = false, images = false } = {}) {
  const tool = (id, html, title) => `<button type="button" class="rich-tool rich-${id}" data-format="${id}" title="${title}" aria-label="${title}">${html}</button>`;
  const lists = `<details class="rich-more rich-lists"><summary class="rich-tool" title="Listas" aria-label="Listas">${RICH_ICON.ul}<span class="rich-caret" aria-hidden="true"></span></summary><div class="rich-more-panel">
    <button type="button" class="rich-menu-item" data-format="ul">• Lista con viñetas</button><button type="button" class="rich-menu-item" data-format="ol">1. Lista numerada</button></div></details>`;
  const tools = `<select class="rich-block" data-rich-block aria-label="Estilo del párrafo"><option value="">Párrafo</option><option value="# ">Título</option><option value="## ">Subtítulo</option><option value="> ">Cita</option></select>
    <span class="rich-sep"></span>${RICH_TOOLS.map(([id, html, title]) => tool(id, html, title)).join('')}<span class="rich-sep"></span>${lists}<span class="rich-sep"></span>
    ${tool('video', RICH_ICON.video, 'Insertar video de YouTube, Vimeo, Google Drive o Cloudflare Stream')}${tool('link', RICH_ICON.link, 'Insertar enlace')}${images ? tool('image', RICH_ICON.image, 'Insertar imagen') : ''}`;
  return `<div class="rich-editor" data-rich-editor><span class="rich-label">${label}</span>
    <div class="rich-toolbar" role="toolbar" aria-label="Formato de ${richEsc(label.toLowerCase())}">${tools}${richMoreHtml()}${richQuickLinkHtml()}<span class="rich-spacer"></span>
      <button type="button" class="rich-tool rich-preview-toggle" data-format="preview" aria-pressed="false">Vista previa</button>${tool('full', RICH_ICON.full, 'Pantalla completa')}</div>
    <textarea name="${name}" aria-label="${richEsc(label)}" ${required ? 'required' : ''}>${richEsc(value)}</textarea>
    <div class="rich-preview" data-rich-preview hidden></div>
    <p class="rich-hint muted">Selecciona texto y usa los botones, o escribe **negrita**, *cursiva*, - lista. Fórmulas: $v = v_0 + a t$. Un enlace de YouTube o Vimeo solo en su línea se ve como video.</p>
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
  const text = lines.map((l, i) => (typeof prefix === 'function' ? prefix(i) : prefix) + l.replace(/^(\s*([-*•>]|\d+[.)]|#{1,3})\s+)/, '')).join('\n');
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
      tool.closest('details')?.removeAttribute('open');
      return richPrefix(area, '- ');
    case 'ol':
      tool.closest('details')?.removeAttribute('open');
      return richPrefix(area, (i) => `${i + 1}. `);
    case 'math':
      tool.closest('details')?.removeAttribute('open');
      return richWrap(area, '$', '$', 'v = v_0 + a t');
    case 'full': {
      const on = editor.classList.toggle('rich-full');
      tool.setAttribute('aria-pressed', String(on));
      tool.title = on ? 'Salir de pantalla completa' : 'Pantalla completa';
      return area.focus();
    }
    case 'link': {
      const url = prompt('Dirección del enlace (https://…)', 'https://');
      if (!url || !/^https?:\/\/\S+$/.test(url.trim())) return;
      return richWrap(area, '[', `](${url.trim()})`, 'texto del enlace');
    }
    case 'image':
      return editor.querySelector('[data-rich-image]')?.click();
    case 'video': {
      const url = prompt('Pega el enlace del video (YouTube, Vimeo, Google Drive o Cloudflare Stream)', 'https://');
      if (!url || url.trim() === 'https://') return;
      if (!richVideo(url)) return toast('Ese enlace no es de un video de YouTube, Vimeo, Google Drive o Cloudflare Stream. Copia la dirección del video desde el botón «Compartir».');
      richInsertBlock(area, url.trim());
      return richRefreshPreview(editor);
    }
    case 'equation':
      richInsertBlock(area, '$$ F = m a $$');
      tool.closest('details').open = false;
      return richRefreshPreview(editor);
    case 'divider':
      richInsertBlock(area, '---');
      tool.closest('details').open = false;
      return richRefreshPreview(editor);
    case 'preview': {
      const preview = editor.querySelector('[data-rich-preview]');
      preview.hidden = !preview.hidden;
      area.hidden = !preview.hidden;
      tool.setAttribute('aria-pressed', String(!preview.hidden));
      tool.textContent = preview.hidden ? 'Vista previa' : 'Seguir editando';
      editor.querySelectorAll('.rich-tool:not(.rich-preview-toggle):not(.rich-full), .rich-block').forEach((b) => (b.disabled = !preview.hidden));
      return richRefreshPreview(editor);
    }
  }
});

// Estilo del párrafo: Título, Subtítulo o Cita en las líneas seleccionadas; «Párrafo» quita la marca.
document.addEventListener('change', (e) => {
  const select = e.target.closest('[data-rich-block]');
  if (!select) return;
  const editor = select.closest('[data-rich-editor]');
  richPrefix(editor.querySelector('textarea'), select.value);
  select.value = '';
  richRefreshPreview(editor);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const full = document.querySelector('.rich-editor.rich-full');
  if (!full) return;
  full.classList.remove('rich-full');
  full.querySelector('[data-format="full"]')?.setAttribute('aria-pressed', 'false');
});

// Símbolos, emojis y enlaces rápidos: se insertan donde está el cursor.
document.addEventListener('click', (e) => {
  const cell = e.target.closest('[data-rich-insert], [data-rich-link]');
  const editor = cell?.closest('[data-rich-editor]');
  if (!editor) return;
  const area = editor.querySelector('textarea');
  if (cell.dataset.richLink) {
    const title = cell.dataset.richTitle.replace(/[[\]]/g, '');
    richWrap(area, '[', `](${cell.dataset.richLink})`, title);
    cell.closest('details').open = false;
  } else {
    area.setRangeText(cell.dataset.richInsert, area.selectionStart, area.selectionEnd, 'end');
    area.focus();
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }
  richRefreshPreview(editor);
});
// La lista del enlace rápido se arma al abrirla (con los elementos que haya en ese momento).
document.addEventListener(
  'toggle',
  (e) => {
    const panel = e.target.matches?.('.rich-quick[open]') && e.target.querySelector('[data-rich-quick]');
    if (!panel) return;
    const groups = richQuickItems();
    panel.innerHTML = groups.length
      ? groups.map(([name, items]) => `<p class="rich-menu-head">${richEsc(name)}</p>${items.map(([title, href]) => `<button type="button" class="rich-menu-item" data-rich-link="${richEsc(href)}" data-rich-title="${richEsc(title || 'Sin título')}">${richEsc(title || 'Sin título')}</button>`).join('')}`).join('')
      : '<p class="muted">Todavía no hay actividades, contenido, evaluaciones ni foros en este curso.</p>';
  },
  true,
);

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
