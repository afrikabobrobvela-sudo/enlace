/* Vista previa de Word, PowerPoint, Excel, CSV y texto (12.89), dentro de Enlace y sin descargar el archivo.
   Todo se lee en el navegador: los archivos de alumnos nunca se mandan a visores de terceros.
   - Word (.docx): docx-preview (vendor/docx-preview-0.4.1), que se carga solo al abrir el primero. Después de
     dibujarlo se limpian enlaces y direcciones (solo http(s), correo, # y las imágenes blob: que crea la biblioteca).
   - PowerPoint (.pptx): lector propio (readPptxDeck): cuadros de texto con su formato heredado del diseño y del
     patrón, imágenes, tablas, formas sencillas, fondos y SmartArt (su dibujo guardado). Las gráficas se indican.
   - Excel (.xlsx) y CSV: todas las hojas visibles como tablas, con fechas, porcentajes y celdas combinadas.
   - Texto y código: tal cual, escapado.
   Los formatos binarios antiguos (.doc, .ppt, .xls) no se pueden leer en el navegador: se descargan. */

const DOCX_BASE = '/vendor/docx-preview-0.4.1/';
const PREVIEW_OFFICE_MAX_BYTES = 60 * 1024 * 1024;
const TEXT_MAX_BYTES = 2 * 1024 * 1024;
const SHEET_MAX_ROWS = 2000;
const SHEET_MAX_COLS = 60;
const PPTX_MAX_SLIDES = 400;
let docxLibPromise = null;

// ---- XML en árbol (nombres sin prefijo: p:sp, dsp:sp y a:xfrm/p:xfrm se leen igual) --------------------------------

function xmlTree(text) {
  const root = { name: '#root', attrs: {}, kids: [], text: '' };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<[?!][^>]*>|<(\/?)([\w:.-]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of String(text || '').matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[6] !== undefined) top.text += xmlText(m[6]);
    else if (m[3] !== undefined) {
      const name = m[3].includes(':') ? m[3].slice(m[3].indexOf(':') + 1) : m[3];
      if (m[2]) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs = {};
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        // Con y sin prefijo: `r:embed` también se lee como `embed`, salvo que exista el atributo sin prefijo
        // (sldId trae `id` y `r:id`).
        const value = xmlText(a[2] ?? a[3]);
        attrs[a[1]] = value;
        const local = a[1].slice(a[1].indexOf(':') + 1);
        if (a[1].includes(':') && !a[1].startsWith('xmlns')) attrs[local] ??= value;
      }
      const node = { name, attrs, kids: [], text: '' };
      top.kids.push(node);
      if (!m[5]) stack.push(node);
    }
  }
  return root;
}
const xkid = (node, name) => node?.kids.find((k) => k.name === name) || null;
const xkids = (node, name) => (node ? node.kids.filter((k) => k.name === name) : []);
const xat = (node, path) => path.split('/').reduce((n, p) => xkid(n, p), node);
const xnum = (value, fallback = null) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

/** Ruta de un destino relativo (`../media/image1.png`) desde la carpeta de una parte (`ppt/slides/`). */
function zipResolve(base, target) {
  if (!target) return '';
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').filter(Boolean);
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece && piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

/** Relaciones de una parte del paquete: Map id → { type, path, external }. */
async function zipRels(entries, part) {
  const dir = part.slice(0, part.lastIndexOf('/') + 1);
  const rels = new Map();
  const xml = await zipText(entries, `${dir}_rels/${part.slice(dir.length)}.rels`);
  for (const r of xkids(xmlTree(xml), 'Relationships').flatMap((n) => xkids(n, 'Relationship'))) {
    const external = r.attrs.TargetMode === 'External';
    rels.set(r.attrs.Id, { type: String(r.attrs.Type || '').split('/').pop(), path: external ? r.attrs.Target : zipResolve(dir, r.attrs.Target), external });
  }
  return rels;
}

// ---- Colores de Office ------------------------------------------------------------------------------------------

const PRESET_COLORS = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', darkGray: 'A9A9A9', lightGray: 'D3D3D3', orange: 'FFA500', navy: '000080' };
const SCHEME_ALIASES = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };

function hexRgb(hex) {
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslRgb([h, s, l]) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p);
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

/**
 * Color CSS de un nodo que contiene un color de DrawingML (srgbClr, schemeClr, sysClr, prstClr) con sus ajustes
 * (lumMod, lumOff, tint, shade, alpha). `ctx` = { theme, map } (esquema del tema y clrMap del patrón).
 */
function officeColor(node, ctx, placeholder = null) {
  const c = node?.kids.find((k) => ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr'].includes(k.name));
  if (!c) return null;
  let hex = null;
  if (c.name === 'srgbClr') hex = c.attrs.val;
  else if (c.name === 'sysClr') hex = c.attrs.lastClr || (c.attrs.val === 'window' ? 'FFFFFF' : '000000');
  else if (c.name === 'prstClr') hex = PRESET_COLORS[c.attrs.val] || '000000';
  else if (c.name === 'scrgbClr') hex = [c.attrs.r, c.attrs.g, c.attrs.b].map((v) => Math.round(Math.min(1, Math.max(0, xnum(v, 0) / 100000)) * 255).toString(16).padStart(2, '0')).join('');
  else if (c.attrs.val === 'phClr') return placeholder;
  else {
    const name = ctx?.map?.[c.attrs.val] || SCHEME_ALIASES[c.attrs.val] || c.attrs.val;
    hex = ctx?.theme?.[name] || null;
  }
  if (!/^[0-9a-f]{6}$/i.test(hex || '')) return null;
  let rgb = hexRgb(hex);
  let alpha = 1;
  for (const mod of c.kids) {
    const v = xnum(mod.attrs.val, 100000) / 100000;
    if (mod.name === 'lumMod' || mod.name === 'lumOff') {
      const hsl = rgbHsl(rgb);
      hsl[2] = Math.min(1, Math.max(0, mod.name === 'lumMod' ? hsl[2] * v : hsl[2] + v));
      rgb = hslRgb(hsl);
    } else if (mod.name === 'tint') rgb = rgb.map((x) => x + (255 - x) * (1 - v));
    else if (mod.name === 'shade') rgb = rgb.map((x) => x * v);
    else if (mod.name === 'alpha') alpha = v;
  }
  const [r, g, b] = rgb.map((x) => Math.round(Math.min(255, Math.max(0, x))));
  return alpha < 1 ? `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})` : '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Relleno CSS (color o degradado) de un nodo con solidFill/gradFill/noFill. undefined = no lo define. */
function officeFill(node, ctx, placeholder = null) {
  if (!node) return undefined;
  if (xkid(node, 'noFill')) return null;
  const solid = xkid(node, 'solidFill');
  if (solid) return officeColor(solid, ctx, placeholder);
  const grad = xkid(node, 'gradFill');
  if (grad) {
    const stops = xkids(xkid(grad, 'gsLst'), 'gs')
      .map((gs) => ({ pos: xnum(gs.attrs.pos, 0) / 1000, color: officeColor(gs, ctx, placeholder) }))
      .filter((s) => s.color)
      .sort((a, b) => a.pos - b.pos);
    if (!stops.length) return null;
    if (stops.length === 1) return stops[0].color;
    const angle = xnum(xkid(grad, 'lin')?.attrs.ang, 0) / 60000;
    return `linear-gradient(${Math.round(angle + 90)}deg, ${stops.map((s) => `${s.color} ${Math.round(s.pos)}%`).join(', ')})`;
  }
  return undefined;
}

// ---- PowerPoint (.pptx) -----------------------------------------------------------------------------------------

const EMU_PER_PT = 12700;
const PPTX_IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff' };
const AUTONUM = {
  arabic: (n) => String(n),
  alphaLc: (n) => String.fromCharCode(96 + ((n - 1) % 26) + 1),
  alphaUc: (n) => String.fromCharCode(64 + ((n - 1) % 26) + 1),
  romanLc: (n) => romanNumeral(n).toLowerCase(),
  romanUc: (n) => romanNumeral(n),
};
function romanNumeral(n) {
  let out = '';
  for (const [v, s] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']])
    for (; n >= v; n -= v) out += s;
  return out;
}
function autoNumber(scheme, n) {
  const m = /^(arabic|alphaLc|alphaUc|romanLc|romanUc)(Period|ParenR|ParenBoth|Plain)/.exec(scheme || 'arabicPeriod') || [0, 'arabic', 'Period'];
  const v = AUTONUM[m[1]](n);
  return m[2] === 'ParenR' ? v + ')' : m[2] === 'ParenBoth' ? `(${v})` : m[2] === 'Plain' ? v : v + '.';
}
/** Viñetas de fuentes de símbolos (Wingdings, Symbol) que no existen en la web. */
function bulletChar(char) {
  const code = char?.codePointAt(0) || 0x2022;
  if (code >= 0xf000 && code <= 0xf0ff) return { 0xf0a7: '▪', 0xf0d8: '➢', 0xf0fc: '✓', 0xf076: '❖', 0xf0b7: '•', 0xf06e: '■', 0xf071: '❑' }[code] || '•';
  return char;
}
const placeholderKind = (type) => (type === 'title' || type === 'ctrTitle' ? 'title' : ['dt', 'ftr', 'sldNum', 'hdr'].includes(type) ? type : 'body');

/** Datos de una parte (diapositiva, diseño o patrón): árbol, relaciones y marcadores de posición. */
async function pptxPart(entries, path) {
  const tree = xmlTree(await zipText(entries, path));
  const rels = await zipRels(entries, path);
  const root = tree.kids[0] || null;
  const shapes = xat(root, 'cSld/spTree');
  const placeholders = [];
  const visit = (node) => {
    for (const k of node?.kids || []) {
      if (k.name === 'grpSp') visit(k);
      const ph = xat(k, 'nvSpPr/nvPr/ph') || xat(k, 'nvPicPr/nvPr/ph');
      if (ph) placeholders.push({ type: ph.attrs.type || '', idx: ph.attrs.idx ?? null, node: k });
    }
  };
  visit(shapes);
  return { path, root, rels, shapes, placeholders };
}
function findPlaceholder(part, type, idx) {
  if (!part) return null;
  const kind = placeholderKind(type);
  if (idx !== null && idx !== undefined) {
    const byIdx = part.placeholders.find((p) => p.idx === idx);
    if (byIdx) return byIdx.node;
  }
  return (part.placeholders.find((p) => (p.type || 'body') === (type || 'body')) || part.placeholders.find((p) => placeholderKind(p.type) === kind))?.node || null;
}

/**
 * Presentación lista para dibujar: { width, height (pt), slides: [{ number, background, items }] }.
 * Elementos: shape (x, y, w, h como fracción de la diapositiva; fill, line, geometry, rotation, text), image (path),
 * table (columns, rows) y chart. Las imágenes se leen después con `deck.media(path)`.
 */
async function readPptxDeck(buffer) {
  const entries = unzipEntries(buffer);
  const presentation = xmlTree(await zipText(entries, 'ppt/presentation.xml')).kids[0];
  if (!presentation) throw new Error('El archivo no es una presentación de PowerPoint (.pptx).');
  const presRels = await zipRels(entries, 'ppt/presentation.xml');
  const size = xkid(presentation, 'sldSz');
  const cx = xnum(size?.attrs.cx, 12192000), cy = xnum(size?.attrs.cy, 6858000);
  const defaultText = xkid(presentation, 'defaultTextStyle');
  const cache = new Map();
  const part = (path) => {
    if (!path) return Promise.resolve(null);
    if (!cache.has(path)) cache.set(path, pptxPart(entries, path).catch(() => null));
    return cache.get(path);
  };
  const themes = new Map();
  const themeOf = async (master) => {
    const path = [...(master?.rels.values() || [])].find((r) => r.type === 'theme')?.path;
    if (!themes.has(path)) {
      const t = xmlTree(await zipText(entries, path || 'ppt/theme/theme1.xml'));
      const scheme = xat(t, 'theme/themeElements/clrScheme');
      const colors = {};
      for (const k of scheme?.kids || []) colors[k.name] = xkid(k, 'srgbClr')?.attrs.val || xkid(k, 'sysClr')?.attrs.lastClr || null;
      const fonts = xat(t, 'theme/themeElements/fontScheme');
      themes.set(path, {
        colors,
        major: xat(fonts, 'majorFont/latin')?.attrs.typeface || '',
        minor: xat(fonts, 'minorFont/latin')?.attrs.typeface || '',
      });
    }
    return themes.get(path);
  };

  const slides = [];
  const order = xkids(xkid(presentation, 'sldIdLst'), 'sldId');
  for (const [n, sld] of order.entries()) {
    if (slides.length >= PPTX_MAX_SLIDES) break;
    const slide = await part(presRels.get(sld.attrs['r:id'])?.path);
    if (!slide?.root) continue;
    if (slide.root.attrs.show === '0') continue; // diapositiva oculta
    const layout = await part([...slide.rels.values()].find((r) => r.type === 'slideLayout')?.path);
    const master = await part([...(layout?.rels.values() || [])].find((r) => r.type === 'slideMaster')?.path);
    const theme = await themeOf(master);
    const ctx = {
      cx, cy, entries, defaultText, slide, layout, master, theme,
      color: { theme: theme.colors, map: { ...(xkid(master?.root, 'clrMap')?.attrs || {}), ...(xat(slide.root, 'clrMapOvr/overrideClrMapping')?.attrs || {}) } },
    };
    const items = [];
    const showMaster = slide.root.attrs.showMasterSp !== '0' && layout?.root?.attrs.showMasterSp !== '0';
    if (master && showMaster) await pptxShapes(master.shapes, master, ctx, items, null, true);
    if (layout && slide.root.attrs.showMasterSp !== '0') await pptxShapes(layout.shapes, layout, ctx, items, null, true);
    await pptxShapes(slide.shapes, slide, ctx, items, null, false);
    slides.push({ number: n + 1, background: pptxBackground([slide, layout, master], ctx), items });
  }
  return {
    width: cx / EMU_PER_PT,
    height: cy / EMU_PER_PT,
    slides,
    total: order.length,
    media: async (path) => {
      const read = entries.get(path);
      return read ? read() : null;
    },
  };
}

function pptxBackground(parts, ctx) {
  for (const p of parts) {
    const bg = xat(p?.root, 'cSld/bg');
    if (!bg) continue;
    const pr = xkid(bg, 'bgPr');
    if (pr) {
      const blip = xat(pr, 'blipFill/blip');
      const image = blip ? p.rels.get(blip.attrs.embed)?.path : null;
      if (image) return { image };
      const fill = officeFill(pr, ctx.color);
      if (fill) return { fill };
    }
    const ref = xkid(bg, 'bgRef');
    if (ref) {
      const fill = officeColor(ref, ctx.color);
      if (fill) return { fill };
    }
  }
  return { fill: '#ffffff' };
}

/** Posición en fracciones de la diapositiva, aplicando los grupos (`tf` convierte coordenadas hijas). */
function pptxBox(xfrm, tf) {
  const off = xkid(xfrm, 'off'), ext = xkid(xfrm, 'ext');
  if (!off || !ext) return null;
  const [x, y] = tf(xnum(off.attrs.x, 0), xnum(off.attrs.y, 0));
  const [x2, y2] = tf(xnum(off.attrs.x, 0) + xnum(ext.attrs.cx, 0), xnum(off.attrs.y, 0) + xnum(ext.attrs.cy, 0));
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y), rotation: xnum(xfrm.attrs.rot, 0) / 60000, flipH: xfrm.attrs.flipH === '1', flipV: xfrm.attrs.flipV === '1' };
}

async function pptxShapes(tree, part, ctx, items, tf, onlyDecoration) {
  tf ??= (x, y) => [x / ctx.cx, y / ctx.cy];
  for (const node of tree?.kids || []) {
    if (node.name === 'AlternateContent') {
      const pick = xkid(node, 'Fallback') || xkid(node, 'Choice');
      if (pick) await pptxShapes(pick, part, ctx, items, tf, onlyDecoration);
      continue;
    }
    if (node.name === 'grpSp') {
      const xfrm = xat(node, 'grpSpPr/xfrm');
      const off = xkid(xfrm, 'off'), ext = xkid(xfrm, 'ext'), chOff = xkid(xfrm, 'chOff'), chExt = xkid(xfrm, 'chExt');
      let inner = tf;
      if (off && ext && chOff && chExt) {
        const sx = xnum(ext.attrs.cx, 1) / (xnum(chExt.attrs.cx, 1) || 1), sy = xnum(ext.attrs.cy, 1) / (xnum(chExt.attrs.cy, 1) || 1);
        inner = (x, y) => tf(xnum(off.attrs.x, 0) + (x - xnum(chOff.attrs.x, 0)) * sx, xnum(off.attrs.y, 0) + (y - xnum(chOff.attrs.y, 0)) * sy);
      }
      await pptxShapes(node, part, ctx, items, inner, onlyDecoration);
      continue;
    }
    const ph = xat(node, 'nvSpPr/nvPr/ph') || xat(node, 'nvPicPr/nvPr/ph') || xat(node, 'nvGraphicFramePr/nvPr/ph');
    if (onlyDecoration && ph) continue; // los marcadores del diseño y del patrón solo dan formato
    const type = ph?.attrs.type || '';
    const idx = ph?.attrs.idx ?? null;
    const inherited = ph && part === ctx.slide ? [findPlaceholder(ctx.layout, type, idx), findPlaceholder(ctx.master, type, idx)] : ph && part === ctx.layout ? [null, findPlaceholder(ctx.master, type, idx)] : [null, null];
    const xfrmOf = (n) => xat(n, 'spPr/xfrm') || xat(n, 'xfrm');
    const xfrm = [node, ...inherited].map(xfrmOf).find((x) => xkid(x, 'off')) || null;
    const box = xfrm ? pptxBox(xfrm, tf) : null;
    if (!box) continue;

    if (node.name === 'pic') {
      const blip = xat(node, 'blipFill/blip');
      const path = part.rels.get(blip?.attrs.embed)?.path;
      const src = xat(node, 'blipFill/srcRect');
      if (path) items.push({ type: 'image', ...box, path, crop: src ? ['l', 't', 'r', 'b'].map((k) => xnum(src.attrs[k], 0) / 100000) : null });
      continue;
    }
    if (node.name === 'graphicFrame') {
      const data = xat(node, 'graphic/graphicData');
      const uri = data?.attrs.uri || '';
      const table = xkid(data, 'tbl');
      if (table) items.push({ type: 'table', ...box, ...pptxTable(table, ctx) });
      else if (uri.endsWith('/diagram')) {
        // El dibujo guardado del SmartArt se enlaza desde su parte de datos (dataModelExt relId).
        const dm = part.rels.get(xkid(data, 'relIds')?.attrs.dm);
        const relId = dm ? /relId="([^"]+)"/.exec((await zipText(ctx.entries, dm.path)) || '')?.[1] : null;
        const drawing = part.rels.get(relId) || null;
        const dpart = drawing ? await pptxPart(ctx.entries, drawing.path).catch(() => null) : null;
        const shapes = dpart?.root ? xkid(dpart.root, 'spTree') : null;
        if (shapes) {
          const ox = xnum(xkid(xfrm, 'off')?.attrs.x, 0), oy = xnum(xkid(xfrm, 'off')?.attrs.y, 0);
          await pptxShapes(shapes, dpart, ctx, items, (x, y) => tf(ox + x, oy + y), false);
        } else items.push({ type: 'chart', ...box, label: 'Diagrama' });
      } else if (uri.endsWith('/chart')) items.push({ type: 'chart', ...box, label: 'Gráfica' });
      continue;
    }
    if (node.name !== 'sp' && node.name !== 'cxnSp') continue;

    const spPr = xkid(node, 'spPr');
    const style = xkid(node, 'style');
    const inheritedPr = inherited.map((n) => xkid(n, 'spPr'));
    let fill = officeFill(spPr, ctx.color);
    for (const p of inheritedPr) if (fill === undefined) fill = officeFill(p, ctx.color);
    if (fill === undefined) {
      const ref = xkid(style, 'fillRef');
      fill = ref && xnum(ref.attrs.idx, 0) > 0 ? officeColor(ref, ctx.color) : null;
    }
    const blipFill = xat(spPr, 'blipFill/blip');
    const imagePath = blipFill ? part.rels.get(blipFill.attrs.embed)?.path : null;
    const ln = xkid(spPr, 'ln');
    let line = null;
    if (ln && !xkid(ln, 'noFill')) {
      const color = officeFill(ln, ctx.color) ?? (xkid(style, 'lnRef') ? officeColor(xkid(style, 'lnRef'), ctx.color) : null);
      if (color && !color.startsWith('linear')) line = { color, width: xnum(ln.attrs.w, 12700) / EMU_PER_PT };
    } else if (!ln && xkid(style, 'lnRef') && xnum(xkid(style, 'lnRef').attrs.idx, 0) > 0) {
      const color = officeColor(xkid(style, 'lnRef'), ctx.color);
      if (color) line = { color, width: 1 };
    }
    const geometry = xat(spPr, 'prstGeom')?.attrs.prst || (node.name === 'cxnSp' ? 'line' : 'rect');
    const fontColor = xkid(style, 'fontRef') ? officeColor(xkid(style, 'fontRef'), ctx.color) : null;
    const text = xkid(node, 'txBody') ? pptxText(xkid(node, 'txBody'), inherited.map((n) => xkid(n, 'txBody')), type, ph, ctx, fontColor) : null;
    if (fill === null && !line && !imagePath && !text) continue;
    items.push({ type: 'shape', ...box, geometry, fill, line, image: imagePath, text });
  }
}

/** Cadena de propiedades de un nivel de párrafo: del párrafo al estilo del patrón (la primera que defina algo gana). */
function pptxLevelChain(level, own, lists, styleRoot) {
  const lvl = `lvl${level + 1}pPr`;
  return [own, ...lists.map((l) => xkid(l, lvl)), xkid(styleRoot, lvl)].filter(Boolean);
}

function pptxText(body, inheritedBodies, type, ph, ctx, fontColor) {
  const kind = ph ? placeholderKind(type) : 'other';
  const masterStyles = xat(ctx.master?.root, 'txStyles');
  const styleRoot = !ph ? ctx.defaultText : kind === 'title' ? xkid(masterStyles, 'titleStyle') : kind === 'body' ? xkid(masterStyles, 'bodyStyle') : xkid(masterStyles, 'otherStyle');
  const lists = [xkid(body, 'lstStyle'), ...inheritedBodies.map((b) => xkid(b, 'lstStyle'))];
  const bodyPrs = [xkid(body, 'bodyPr'), ...inheritedBodies.map((b) => xkid(b, 'bodyPr'))].filter(Boolean);
  const bodyAttr = (name) => bodyPrs.map((b) => b.attrs[name]).find((v) => v !== undefined);
  const autofit = bodyPrs.map((b) => xkid(b, 'normAutofit')).find(Boolean);
  const scale = xnum(autofit?.attrs.fontScale, 100000) / 100000;
  const spacingScale = 1 - xnum(autofit?.attrs.lnSpcReduction, 0) / 100000;
  const counters = [];
  const paragraphs = [];
  for (const p of xkids(body, 'p')) {
    const pPr = xkid(p, 'pPr');
    const level = Math.min(8, xnum(pPr?.attrs.lvl, 0));
    const chain = pptxLevelChain(level, pPr, lists, styleRoot);
    const pick = (attr) => chain.map((n) => n.attrs[attr]).find((v) => v !== undefined);
    const bulletNode = chain.map((n) => n.kids.find((k) => ['buNone', 'buChar', 'buAutoNum', 'buBlip'].includes(k.name))).find(Boolean);
    const runProps = (rPr) => [rPr, ...chain.map((n) => xkid(n, 'defRPr'))].filter(Boolean);
    const runStyle = (rPr) => {
      const props = runProps(rPr);
      const first = (attr) => props.map((n) => n.attrs[attr]).find((v) => v !== undefined);
      const colorNode = props.find((n) => xkid(n, 'solidFill'));
      const latin = props.map((n) => xkid(n, 'latin')?.attrs.typeface).find(Boolean) || '';
      const font = latin === '+mj-lt' ? ctx.theme.major : latin === '+mn-lt' ? ctx.theme.minor : latin || (kind === 'title' ? ctx.theme.major : ctx.theme.minor);
      return {
        size: (xnum(first('sz'), kind === 'title' ? 4400 : 1800) / 100) * scale,
        bold: first('b') === '1' || first('b') === 'true',
        italic: first('i') === '1' || first('i') === 'true',
        underline: Boolean(first('u') && first('u') !== 'none'),
        strike: Boolean(first('strike') && first('strike') !== 'noStrike'),
        baseline: xnum(first('baseline'), 0),
        color: (rPr && xkid(rPr, 'solidFill') ? officeColor(xkid(rPr, 'solidFill'), ctx.color) : null) || fontColor || (colorNode ? officeColor(xkid(colorNode, 'solidFill'), ctx.color) : null) || null,
        font: String(font || '').replace(/[^\w \-]/g, '').slice(0, 60),
      };
    };
    const runs = [];
    for (const r of p.kids) {
      if (r.name === 'r' || r.name === 'fld') runs.push({ text: xkid(r, 't')?.text || '', ...runStyle(xkid(r, 'rPr')) });
      else if (r.name === 'br') runs.push({ br: true, ...runStyle(xkid(r, 'rPr')) });
    }
    const end = runStyle(xkid(p, 'endParaRPr'));
    let bullet = null;
    const hasText = runs.some((r) => r.text?.trim());
    if (bulletNode?.name === 'buAutoNum') {
      counters.length = level + 1;
      counters[level] = (counters[level] || xnum(bulletNode.attrs.startAt, 1) - 1) + 1;
      if (hasText) bullet = autoNumber(bulletNode.attrs.type, counters[level]);
    } else {
      counters.length = level;
      if (bulletNode?.name === 'buChar' && hasText) bullet = bulletChar(bulletNode.attrs.char || '•');
    }
    const spacing = (node) => {
      const pct = xat(node, 'spcPct')?.attrs.val, pts = xat(node, 'spcPts')?.attrs.val;
      return pct !== undefined ? { pct: xnum(pct, 100000) / 100000 } : pts !== undefined ? { pt: xnum(pts, 0) / 100 } : null;
    };
    const chainSpacing = (name) => chain.map((n) => spacing(xkid(n, name))).find(Boolean) || null;
    const line = chainSpacing('lnSpc');
    paragraphs.push({
      level,
      align: { ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }[pick('algn')] || 'left',
      marginLeft: xnum(pick('marL'), 0) / EMU_PER_PT,
      indent: xnum(pick('indent'), 0) / EMU_PER_PT,
      bullet,
      lineHeight: line?.pct ? line.pct * spacingScale : null,
      lineHeightPt: line?.pt ?? null,
      before: chainSpacing('spcBef'),
      after: chainSpacing('spcAft'),
      runs,
      endSize: end.size,
    });
  }
  if (!paragraphs.some((p) => p.runs.some((r) => r.text?.trim()))) return null;
  const inset = (name, fallback) => xnum(bodyAttr(name), fallback) / EMU_PER_PT;
  return {
    anchor: { ctr: 'center', b: 'end' }[bodyAttr('anchor')] || 'start',
    wrap: bodyAttr('wrap') !== 'none',
    vertical: /vert/.test(bodyAttr('vert') || '') && bodyAttr('vert') !== 'horz',
    insets: [inset('lIns', 91440), inset('tIns', 45720), inset('rIns', 91440), inset('bIns', 45720)],
    paragraphs,
  };
}

function pptxTable(table, ctx) {
  const columns = xkids(xkid(table, 'tblGrid'), 'gridCol').map((c) => xnum(c.attrs.w, 0));
  const total = columns.reduce((a, b) => a + b, 0) || 1;
  const tblPr = xkid(table, 'tblPr');
  const header = tblPr?.attrs.firstRow === '1';
  const banded = tblPr?.attrs.bandRow === '1';
  const accent = ctx.color.theme.accent1 ? '#' + ctx.color.theme.accent1 : '#4472c4';
  const rows = xkids(table, 'tr').map((tr, r) =>
    xkids(tr, 'tc').map((tc) => {
      const fill = officeFill(xkid(tc, 'tcPr'), ctx.color);
      const isHeader = header && r === 0;
      const body = xkid(tc, 'txBody');
      const text = body ? pptxText(body, [], '', null, ctx, isHeader && fill === undefined ? '#ffffff' : null) : null;
      if (text && isHeader) for (const p of text.paragraphs) for (const run of p.runs) run.bold = true;
      return {
        span: xnum(tc.attrs.gridSpan, 1),
        rowSpan: xnum(tc.attrs.rowSpan, 1),
        merged: tc.attrs.hMerge === '1' || tc.attrs.vMerge === '1',
        fill: fill !== undefined ? fill : isHeader ? accent : banded && (header ? r : r + 1) % 2 === 1 ? 'rgba(68, 114, 196, 0.16)' : null,
        text,
      };
    }),
  );
  return { columns: columns.map((w) => w / total), rows };
}

// ---- Excel (.xlsx) y CSV ------------------------------------------------------------------------------------------

const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 57, 58]);
const TIME_FORMAT_IDS = new Set([18, 19, 20, 21, 45, 46, 47]);

function excelDate(serial, withTime, onlyTime) {
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return String(serial);
  const pad = (n) => String(n).padStart(2, '0');
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (onlyTime) return time;
  const date = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  return withTime && (d.getUTCHours() || d.getUTCMinutes()) ? `${date} ${time}` : date;
}

/** Texto de una celda numérica según su formato (fechas, porcentajes, decimales fijos; lo demás, «General»). */
function excelNumber(raw, format) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return String(raw);
  const { id, code } = format || {};
  const clean = String(code || '').replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
  const hasTime = TIME_FORMAT_IDS.has(id) || id === 22 || /[hs]/i.test(clean);
  const hasDate = DATE_FORMAT_IDS.has(id) || /[dy]/i.test(clean) || (/m/i.test(clean) && !/[hs]/i.test(clean));
  if (hasDate || hasTime) return excelDate(n, hasTime, !hasDate);
  const decimals = (/0\.(0+)/.exec(clean)?.[1] || '').length;
  const grouped = /#,##0|0,0/.test(clean) || id === 3 || id === 4;
  const fixed = /0\.0/.test(clean) || id === 2 || id === 4 || id === 10;
  if (id === 9 || id === 10 || clean.includes('%')) return (n * 100).toLocaleString('es-MX', { minimumFractionDigits: id === 10 ? 2 : decimals, maximumFractionDigits: id === 10 ? 2 : decimals }) + '%';
  if (fixed || grouped || id === 1) {
    const value = n.toLocaleString('es-MX', { minimumFractionDigits: id === 2 || id === 4 ? 2 : decimals, maximumFractionDigits: id === 2 || id === 4 ? 2 : decimals, useGrouping: grouped });
    return (/\$/.test(code || '') ? '$' : '') + value;
  }
  return String(Number(n.toPrecision(11)));
}

/** Hojas visibles de un .xlsx: [{ name, rows: [[{ v, bold, number }]], merges, truncated }]. */
async function readXlsxSheets(buffer, { maxRows = SHEET_MAX_ROWS, maxCols = SHEET_MAX_COLS } = {}) {
  const entries = unzipEntries(buffer);
  const workbook = xmlTree(await zipText(entries, 'xl/workbook.xml'));
  const sheetsNode = xat(workbook, 'workbook/sheets');
  if (!sheetsNode) throw new Error('El archivo no es un libro de Excel (.xlsx).');
  const rels = await zipRels(entries, 'xl/workbook.xml');
  const shared = xkids(xat(xmlTree(await zipText(entries, 'xl/sharedStrings.xml')), 'sst'), 'si').map((si) => {
    const parts = [];
    const walk = (n) => n.kids.forEach((k) => (k.name === 't' ? parts.push(k.text) : k.name !== 'rPh' && walk(k)));
    walk(si);
    return parts.join('');
  });
  const styles = xat(xmlTree(await zipText(entries, 'xl/styles.xml')), 'styleSheet');
  const customFormats = new Map(xkids(xkid(styles, 'numFmts'), 'numFmt').map((f) => [xnum(f.attrs.numFmtId), f.attrs.formatCode]));
  const fonts = xkids(xkid(styles, 'fonts'), 'font').map((f) => Boolean(xkid(f, 'b')) && xkid(f, 'b').attrs.val !== '0');
  const xfs = xkids(xkid(styles, 'cellXfs'), 'xf').map((xf) => {
    const id = xnum(xf.attrs.numFmtId, 0);
    return { format: { id, code: customFormats.get(id) || '' }, bold: fonts[xnum(xf.attrs.fontId, 0)] || false };
  });
  const sheets = [];
  for (const s of xkids(sheetsNode, 'sheet')) {
    if (s.attrs.state === 'hidden' || s.attrs.state === 'veryHidden') continue;
    const path = rels.get(s.attrs['r:id'])?.path;
    const xml = path ? await zipText(entries, path) : null;
    if (!xml) continue;
    const rows = [];
    let truncated = false;
    let width = 0;
    // Las hojas pueden ser enormes: se leen renglón por renglón con expresiones (sin armar el árbol completo).
    for (const row of xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
      const r = (xnum(xmlAttr(row[1], 'r'), rows.length + 1) || rows.length + 1) - 1;
      if (r >= maxRows) {
        truncated = true;
        break;
      }
      const cells = [];
      for (const cell of (row[2] || '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const ref = xmlAttr(cell[1], 'r');
        const col = ref ? columnIndex(ref) : cells.length;
        if (col >= maxCols) {
          truncated = true;
          continue;
        }
        const type = xmlAttr(cell[1], 't');
        const style = xfs[xnum(xmlAttr(cell[1], 's'), 0)] || { format: { id: 0 }, bold: false };
        const inner = cell[2] || '';
        const raw = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1];
        let v = '';
        let number = false;
        if (type === 's') v = shared[xnum(raw, -1)] ?? '';
        else if (type === 'inlineStr') v = [...inner.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((t) => xmlText(t[1])).join('');
        else if (type === 'b') v = raw === '1' ? 'VERDADERO' : 'FALSO';
        else if (type === 'str' || type === 'e') v = xmlText(raw ?? '');
        else if (raw !== undefined) {
          v = excelNumber(xmlText(raw), style.format);
          number = true;
        }
        if (v !== '') cells[col] = { v, bold: style.bold, number };
      }
      rows[r] = cells;
      width = Math.max(width, cells.length);
    }
    const merges = [...xml.matchAll(/<(?:\w+:)?mergeCell\b[^>]*\bref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/gi)]
      .map((m) => ({ r: Number(m[2]) - 1, c: columnIndex(m[1]), r2: Number(m[4]) - 1, c2: columnIndex(m[3]) }))
      .filter((m) => m.r < maxRows && m.c < maxCols);
    while (rows.length && !rows[rows.length - 1]?.some((c) => c?.v)) rows.pop();
    sheets.push({ name: s.attrs.name || `Hoja ${sheets.length + 1}`, rows: Array.from(rows, (r) => r || []), width, merges, truncated });
  }
  return sheets;
}

/** Renglones de un CSV con el separador más probable (coma, punto y coma o tabulador). */
function csvRowsAuto(text, maxRows = SHEET_MAX_ROWS) {
  text = String(text).replace(/^﻿/, '');
  const first = text.slice(0, text.search(/\r?\n/) >>> 0 || text.length);
  const sep = [',', ';', '\t'].map((s) => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"', i++);
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) (row.push(field), (field = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      (row = []), (field = '');
    } else field += c;
  }
  if ((field !== '' || row.length) && rows.length < maxRows) rows.push([...row, field]);
  return rows;
}

/** Texto de un archivo: UTF-8 y, si no lo es, Windows-1252 (los CSV que guarda Excel en español). */
function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// ---- Dibujo en la vista previa --------------------------------------------------------------------------------------

async function fetchPreviewBytes(file, signal, max = PREVIEW_OFFICE_MAX_BYTES) {
  if (file.size > max) throw Object.assign(new Error('grande'), { tooBig: true });
  const response = await fetch(`/api/file/${encodeURIComponent(file.id)}`, { signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error('No se pudo leer el archivo.');
  return response.arrayBuffer();
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('No se pudo cargar el lector de Word.'));
    document.head.append(script);
  });
}
function loadDocxPreview() {
  docxLibPromise ??= loadScriptOnce(DOCX_BASE + 'jszip.min.js')
    .then(() => loadScriptOnce(DOCX_BASE + 'docx-preview.min.js'))
    .then(() => window.docx)
    .catch((error) => {
      docxLibPromise = null;
      throw error;
    });
  return docxLibPromise;
}

/** Quita direcciones peligrosas del HTML que arma docx-preview a partir del documento (que puede venir de cualquiera). */
function sanitizeDocxOutput(root) {
  root.querySelectorAll('script, iframe, object, embed, form, input, button, textarea, select, link, meta, base').forEach((n) => n.remove());
  for (const el of root.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if (name === 'href' || name === 'xlink:href' || name === 'src' || name === 'srcset' || name === 'action' || name === 'formaction') {
        const value = attr.value.trim();
        const ok = el.tagName === 'A' ? /^(https?:|mailto:|#)/i.test(value) : /^(blob:|data:image\/(png|jpe?g|gif|webp|bmp);|#)/i.test(value);
        if (!ok) el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === 'A' && /^https?:/i.test(el.getAttribute('href') || '')) {
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    }
  }
}

async function renderDocxPreview(stage, buffer, view) {
  const lib = await loadDocxPreview();
  if (view.destroyed) return;
  const styles = document.createElement('div');
  const body = document.createElement('div');
  body.className = 'docx-frame';
  stage.replaceChildren(styles, body);
  await lib.renderAsync(buffer, body, styles, {
    className: 'docx',
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    ignoreFonts: true,
    breakPages: true,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    renderComments: false,
    renderAltChunks: false,
    useBase64URL: false,
    experimental: false,
    debug: false,
  });
  sanitizeDocxOutput(body);
  const wrapper = body.firstElementChild;
  const fit = () => {
    if (!wrapper) return;
    wrapper.style.zoom = '';
    const width = Math.max(...[...wrapper.children].map((s) => s.offsetWidth), 1) + 32;
    wrapper.style.zoom = String(Math.min(1, (stage.clientWidth - 8) / width) * view.zoom);
  };
  fit();
  return fit;
}

const cssFont = (font) => (font ? `'${font}', ` : '');
function pptxParagraphHtml(p) {
  const runs = p.runs
    .map((r) => {
      if (r.br) return '<br>';
      const style = [
        `font-size:calc(${r.size.toFixed(2)} * var(--pp-pt))`,
        r.color ? `color:${r.color}` : '',
        r.bold ? 'font-weight:700' : '',
        r.italic ? 'font-style:italic' : '',
        r.underline || r.strike ? `text-decoration:${[r.underline ? 'underline' : '', r.strike ? 'line-through' : ''].join(' ').trim()}` : '',
        r.baseline ? `vertical-align:${r.baseline > 0 ? 'super' : 'sub'};font-size:calc(${(r.size * 0.65).toFixed(2)} * var(--pp-pt))` : '',
        `font-family:${cssFont(r.font)}var(--pp-font)`,
      ].filter(Boolean).join(';');
      return `<span style="${style}">${esc(r.text)}</span>`;
    })
    .join('');
  const first = p.runs.find((r) => !r.br) || { size: p.endSize, color: null };
  const space = (s, size) => (s ? (s.pt !== undefined ? s.pt : s.pct * size * 1.2) : 0);
  const style = [
    `text-align:${p.align}`,
    `padding-left:calc(${(p.marginLeft || 0).toFixed(2)} * var(--pp-pt))`,
    p.bullet ? `text-indent:calc(${Math.min(0, p.indent).toFixed(2)} * var(--pp-pt))` : p.indent ? `text-indent:calc(${p.indent.toFixed(2)} * var(--pp-pt))` : '',
    `font-size:calc(${(first.size || p.endSize).toFixed(2)} * var(--pp-pt))`,
    p.lineHeight ? `line-height:${(p.lineHeight * 1.2).toFixed(3)}` : p.lineHeightPt ? `line-height:calc(${p.lineHeightPt} * var(--pp-pt))` : '',
    `margin-top:calc(${space(p.before, first.size || p.endSize).toFixed(2)} * var(--pp-pt))`,
    `margin-bottom:calc(${space(p.after, first.size || p.endSize).toFixed(2)} * var(--pp-pt))`,
  ].filter(Boolean).join(';');
  const bullet = p.bullet
    ? `<span class="pp-bullet" style="min-width:calc(${Math.max(0, -p.indent).toFixed(2)} * var(--pp-pt));${first.color ? `color:${first.color}` : ''}">${esc(p.bullet)}</span>`
    : '';
  return `<p style="${style}">${bullet}${runs || '&nbsp;'}</p>`;
}

function pptxTextHtml(text) {
  const [l, t, r, b] = text.insets;
  return `<div class="pp-text${text.wrap ? '' : ' pp-nowrap'}${text.vertical ? ' pp-vertical' : ''}" style="justify-content:${text.anchor};padding:calc(${t.toFixed(2)} * var(--pp-pt)) calc(${r.toFixed(2)} * var(--pp-pt)) calc(${b.toFixed(2)} * var(--pp-pt)) calc(${l.toFixed(2)} * var(--pp-pt))">${text.paragraphs.map(pptxParagraphHtml).join('')}</div>`;
}

const pct = (v) => (v * 100).toFixed(3) + '%';
function pptxItemHtml(item, urls) {
  const transform = [item.rotation ? `rotate(${item.rotation}deg)` : '', item.flipH ? 'scaleX(-1)' : '', item.flipV ? 'scaleY(-1)' : ''].filter(Boolean).join(' ');
  const base = `left:${pct(item.x)};top:${pct(item.y)};width:${pct(item.w)};height:${pct(item.h)};${transform ? `transform:${transform};` : ''}`;
  if (item.type === 'image') {
    const url = urls.get(item.path);
    if (!url) return '';
    const [l, t, r, b] = item.crop || [0, 0, 0, 0];
    const w = 1 / Math.max(0.05, 1 - l - r), h = 1 / Math.max(0.05, 1 - t - b);
    return `<div class="pp-item pp-image" style="${base}"><img src="${esc(url)}" alt="" loading="lazy" style="left:${pct(-l * w)};top:${pct(-t * h)};width:${pct(w)};height:${pct(h)}"></div>`;
  }
  if (item.type === 'chart') return `<div class="pp-item pp-chart" style="${base}"><span>${esc(item.label)}: descarga el archivo para verla completa</span></div>`;
  if (item.type === 'table') {
    const cols = item.columns.map((w) => `<col style="width:${pct(w)}">`).join('');
    const rows = item.rows
      .map((row) => `<tr>${row.filter((c) => !c.merged).map((c) => `<td${c.span > 1 ? ` colspan="${c.span}"` : ''}${c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : ''}${c.fill ? ` style="background:${c.fill}"` : ''}>${c.text ? c.text.paragraphs.map(pptxParagraphHtml).join('') : ''}</td>`).join('')}</tr>`)
      .join('');
    return `<div class="pp-item pp-table" style="${base}"><table><colgroup>${cols}</colgroup>${rows}</table></div>`;
  }
  const geometry = item.geometry === 'ellipse' ? 'border-radius:50%;' : /^round/.test(item.geometry) ? 'border-radius:calc(8 * var(--pp-pt));' : '';
  const isLine = item.geometry === 'line' || item.geometry === 'straightConnector1';
  const image = item.image && urls.get(item.image) ? `background-image:url('${urls.get(item.image)}');background-size:cover;background-position:center;` : '';
  const fill = !isLine && item.fill ? (item.fill.startsWith('linear') ? `background-image:${item.fill};` : `background-color:${item.fill};`) : '';
  const line = item.line ? (isLine ? `border-top:calc(${Math.max(0.75, item.line.width).toFixed(2)} * var(--pp-pt)) solid ${item.line.color};` : `box-shadow:inset 0 0 0 calc(${Math.max(0.5, item.line.width).toFixed(2)} * var(--pp-pt)) ${item.line.color};`) : '';
  return `<div class="pp-item" style="${base}${geometry}${fill}${image}${line}">${item.text ? pptxTextHtml(item.text) : ''}</div>`;
}

async function renderPptxPreview(stage, buffer, view) {
  const deck = await readPptxDeck(buffer);
  if (view.destroyed) return;
  if (!deck.slides.length) throw new Error('La presentación no tiene diapositivas visibles.');
  const urls = new Map();
  const paths = new Set(deck.slides.flatMap((s) => [s.background.image, ...s.items.flatMap((i) => [i.path, i.image])]).filter(Boolean));
  for (const path of paths) {
    const type = PPTX_IMAGE_TYPES[path.split('.').pop().toLowerCase()];
    if (!type) continue; // .emf/.wmf: los navegadores no los dibujan
    const bytes = await deck.media(path).catch(() => null);
    if (bytes) urls.set(path, URL.createObjectURL(new Blob([bytes], { type })));
  }
  view.onCleanup(() => urls.forEach((url) => URL.revokeObjectURL(url)));
  const html = deck.slides
    .map((s) => {
      const bg = s.background.image && urls.get(s.background.image)
        ? `background:url('${urls.get(s.background.image)}') center / cover`
        : `background:${s.background.fill || '#fff'}`;
      return `<figure class="pp-slide-wrap"><div class="pp-slide" role="img" aria-label="Diapositiva ${s.number}" style="aspect-ratio:${deck.width.toFixed(2)} / ${deck.height.toFixed(2)};--pp-pt:calc(100cqw / ${deck.width.toFixed(3)});${bg}">${s.items.map((i) => pptxItemHtml(i, urls)).join('')}</div><figcaption>Diapositiva ${s.number}</figcaption></figure>`;
    })
    .join('');
  stage.innerHTML = `<div class="pp-deck">${html}</div>`;
  const deckEl = stage.firstElementChild;
  const fit = () => {
    // Con «Ajustar», una diapositiva completa cabe en la pantalla (a lo ancho en el teléfono, a lo alto en la computadora).
    const fitWidth = Math.min(stage.clientWidth - 24, (stage.clientHeight - 48) * (deck.width / deck.height));
    deckEl.style.width = Math.max(220, fitWidth * view.zoom) + 'px';
  };
  fit();
  return fit;
}

function sheetTableHtml(sheet) {
  const covered = new Set();
  const spans = new Map();
  for (const m of sheet.merges || []) {
    spans.set(`${m.r}:${m.c}`, { rows: m.r2 - m.r + 1, cols: m.c2 - m.c + 1 });
    for (let r = m.r; r <= m.r2; r++) for (let c = m.c; c <= m.c2; c++) if (r !== m.r || c !== m.c) covered.add(`${r}:${c}`);
  }
  const width = Math.max(1, sheet.width || Math.max(0, ...sheet.rows.map((r) => r.length)));
  const letters = (n) => {
    let s = '';
    for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  const head = `<thead><tr><th class="sheet-corner"></th>${Array.from({ length: width }, (_, c) => `<th scope="col">${letters(c)}</th>`).join('')}</tr></thead>`;
  const body = sheet.rows
    .map((row, r) => {
      const cells = [];
      for (let c = 0; c < width; c++) {
        if (covered.has(`${r}:${c}`)) continue;
        const cell = row[c];
        const span = spans.get(`${r}:${c}`);
        const cls = [cell?.number ? 'num' : '', cell?.bold ? 'bold' : ''].filter(Boolean).join(' ');
        const text = String(cell?.v ?? '');
        // La tabla mide lo que su contenido; un texto largo se parte a 40 caracteres en lugar de ensanchar la columna.
        cells.push(`<td${cls ? ` class="${cls}"` : ''}${span?.cols > 1 ? ` colspan="${span.cols}"` : ''}${span?.rows > 1 ? ` rowspan="${span.rows}"` : ''}>${text.length > 40 ? `<div class="sheet-long">${esc(text)}</div>` : esc(text)}</td>`);
      }
      return `<tr><th scope="row">${r + 1}</th>${cells.join('')}</tr>`;
    })
    .join('');
  return `<table class="sheet-table">${head}<tbody>${body}</tbody></table>`;
}

function renderSheetsPreview(stage, sheets) {
  if (!sheets.length) throw new Error('El libro no tiene hojas visibles.');
  let active = 0;
  const draw = () => {
    const sheet = sheets[active];
    stage.innerHTML = `${sheets.length > 1 ? `<div class="sheet-tabs" role="tablist" aria-label="Hojas">${sheets.map((s, i) => `<button type="button" role="tab" aria-selected="${i === active}" data-sheet="${i}">${esc(s.name)}</button>`).join('')}</div>` : ''}
      ${sheet.truncated ? `<p class="sheet-note">Se muestran las primeras ${SHEET_MAX_ROWS} filas y ${SHEET_MAX_COLS} columnas. Descarga el archivo para verlo completo.</p>` : ''}
      <div class="sheet-scroll" tabindex="0" aria-label="${esc(sheet.name)}">${sheet.rows.length ? sheetTableHtml(sheet) : '<p class="sheet-note">Esta hoja está vacía.</p>'}</div>`;
  };
  stage.onclick = (event) => {
    const tab = event.target.closest('[data-sheet]');
    if (!tab) return;
    active = Number(tab.dataset.sheet);
    draw();
    stage.querySelector(`[data-sheet="${active}"]`)?.focus();
  };
  draw();
}

/**
 * Vista previa de un documento de oficina o de texto dentro de `stage`. `view` = { zoom, destroyed, signal,
 * onCleanup(fn) } (lo arma mountPreview). Devuelve la función para volver a acomodar al cambiar el acercamiento.
 */
async function showOfficePreview(kind, stage, file, view) {
  stage.innerHTML = '<p class="viewer-loading">Abriendo el archivo…</p>';
  const buffer = await fetchPreviewBytes(file, view.signal, kind === 'text' || kind === 'csv' ? TEXT_MAX_BYTES * 4 : PREVIEW_OFFICE_MAX_BYTES);
  if (view.destroyed) return null;
  if (kind === 'docx') return renderDocxPreview(stage, buffer, view);
  if (kind === 'slides') return renderPptxPreview(stage, buffer, view);
  if (kind === 'sheet') {
    renderSheetsPreview(stage, await readXlsxSheets(buffer));
    return null;
  }
  const text = decodeText(new Uint8Array(buffer));
  if (kind === 'csv') {
    const rows = csvRowsAuto(text).map((r) => r.map((v) => ({ v, number: /^-?[\d.,]+%?$/.test(v.trim()) && /\d/.test(v) })));
    renderSheetsPreview(stage, [{ name: file.name, rows, width: Math.min(SHEET_MAX_COLS, Math.max(0, ...rows.map((r) => r.length))), merges: [], truncated: rows.length >= SHEET_MAX_ROWS }]);
    return null;
  }
  const shown = text.length > TEXT_MAX_BYTES ? text.slice(0, TEXT_MAX_BYTES) : text;
  stage.innerHTML = `${shown.length < text.length ? '<p class="sheet-note">El archivo es muy largo: se muestra solo el principio.</p>' : ''}<pre class="viewer-text"></pre>`;
  stage.querySelector('pre').textContent = shown;
  return null;
}
