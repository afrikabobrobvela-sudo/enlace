/* Archivos de Office en el navegador (12.23), sin librerías: leer un .xlsx o .docx (son ZIP con XML) para importar
 * preguntas y escribir un .xlsx para exportar resultados. Todo se hace aquí y no en el servidor (el Worker no tiene
 * tiempo de procesador para archivos grandes). Para escribir se usa zipParts() de zip.js (ZIP sin compresión, que
 * Excel acepta). */

const OFFICE_MAX_BYTES = 15 * 1024 * 1024;

/** Imágenes que se pueden importar con las preguntas (12.33): las que muestran todos los navegadores. */
const IMPORT_IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const importImageType = (path) => IMPORT_IMAGE_TYPES[String(path).toLowerCase().split('.').pop()] || null;

/**
 * Una imagen dentro de un ZIP o de un .docx: se descomprime solo cuando se va a mostrar o a subir. `key` distingue
 * archivos con la misma ruta en dos documentos (dos Word traen su propio word/media/image1.png).
 */
let zipImageScope = 0;
const zipImage = (entries, path, scope) => ({ key: `${scope}:${path}`, name: path.split('/').pop(), type: importImageType(path), read: entries.get(path) });

/** Entradas de un ZIP: nombre → función que devuelve su contenido (se descomprime solo lo que se pide). */
function unzipEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('El archivo no es un documento de Office válido (.xlsx o .docx).');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map();
  for (let n = 0; n < count && at + 46 <= bytes.length; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, async () => {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return data;
      if (method !== 8) throw new Error('El documento usa una compresión que no se puede leer.');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function zipText(entries, name) {
  const read = entries.get(name);
  return read ? new TextDecoder().decode(await read()) : null;
}

/** Texto de un fragmento de XML (entidades incluidas). */
function xmlText(value) {
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, code) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[code.toLowerCase()];
    if (named) return named;
    const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
}
const xmlAttr = (attrs, name) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1];

/** Índice de columna (A = 0) de una referencia como «C12». */
function columnIndex(ref) {
  const letters = /^[A-Z]+/i.exec(ref || '')?.[0].toUpperCase() || 'A';
  return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

/** Filas (arreglos de textos) de la primera hoja de un .xlsx. */
async function readXlsxRows(buffer) {
  const entries = unzipEntries(buffer);
  const workbook = (await zipText(entries, 'xl/workbook.xml')) || '';
  const rels = (await zipText(entries, 'xl/_rels/workbook.xml.rels')) || '';
  const firstId = xmlAttr(/<sheet\b([^>]*)\/?>/.exec(workbook)?.[1] || '', 'r:id');
  const target = [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => m[1]).find((a) => xmlAttr(a, 'Id') === firstId);
  const path = target ? `xl/${xmlAttr(target, 'Target').replace(/^\/?xl\//, '').replace(/^\//, '')}` : 'xl/worksheets/sheet1.xml';
  const sheet = (await zipText(entries, path)) || (await zipText(entries, 'xl/worksheets/sheet1.xml'));
  if (!sheet) throw new Error('No se encontró la hoja del libro de Excel.');
  const shared = [...((await zipText(entries, 'xl/sharedStrings.xml')) || '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1])).join(''),
  );
  const rows = [];
  for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1];
      const inner = cell[2] || '';
      const type = xmlAttr(attrs, 't');
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1])).join('');
      else if (type === 'b') value = raw === '1' ? 'VERDADERO' : 'FALSO';
      else value = xmlText(raw ?? '');
      const ref = xmlAttr(attrs, 'r');
      cells[ref ? columnIndex(ref) : cells.length] = value;
    }
    rows.push(Array.from(cells, (v) => String(v ?? '').trim()));
  }
  return rows.filter((r) => r.some(Boolean));
}

/**
 * Párrafos de un .docx: texto, nivel y número de lista (0, 1… o null si no es lista), si todo está en negritas y sus
 * imágenes (12.33, `images`; un párrafo con solo una imagen también cuenta).
 * Con listas automáticas de Word, los números y letras no forman parte del texto: el nivel dice qué es cada renglón.
 */
async function readDocxParagraphs(buffer) {
  const entries = unzipEntries(buffer);
  const xml = await zipText(entries, 'word/document.xml');
  if (!xml) throw new Error('El archivo no es un documento de Word (.docx).');
  // Estilos con numeración («Lista con números», «Lista con números 2»…): la lista puede venir del estilo del párrafo.
  const styles = new Map();
  for (const m of ((await zipText(entries, 'word/styles.xml')) || '').matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const id = xmlAttr(m[1], 'w:styleId');
    if (id) styles.set(id, { numPr: /<w:numPr>([\s\S]*?)<\/w:numPr>/.exec(m[2])?.[1] || '', basedOn: /<w:basedOn w:val="([^"]+)"/.exec(m[2])?.[1] });
  }
  const styleNumPr = (id) => {
    for (let n = 0; id && n < 10; n++) {
      const style = styles.get(id);
      if (!style) return '';
      if (style.numPr) return style.numPr;
      id = style.basedOn;
    }
    return '';
  };
  // Imágenes: la relación (rId) de cada una apunta a su archivo dentro del .docx (word/media/…).
  const media = new Map();
  const scope = `docx${++zipImageScope}`;
  for (const m of ((await zipText(entries, 'word/_rels/document.xml.rels')) || '').matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const target = xmlAttr(m[1], 'Target');
    if (!target || xmlAttr(m[1], 'TargetMode') === 'External') continue;
    const path = target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\//, '')}`;
    if (entries.has(path) && importImageType(path)) media.set(xmlAttr(m[1], 'Id'), path);
  }
  const paragraphs = [];
  for (const p of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const body = p[1];
    const numPr = /<w:numPr>([\s\S]*?)<\/w:numPr>/.exec(body)?.[1] || styleNumPr(/<w:pStyle w:val="([^"]+)"/.exec(body)?.[1]);
    const level = numPr ? /<w:ilvl w:val="(\d+)"/.exec(numPr) || [null, '0'] : null;
    const numId = /<w:numId w:val="(\d+)"/.exec(numPr)?.[1] ?? null;
    let text = '';
    let bold = true;
    let any = false;
    for (const r of body.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) {
      const run = r[1]
        .replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, '')
        .replace(/<w:tab\/>/g, '<w:t>\t</w:t>')
        .replace(/<w:br\/>/g, '<w:t>\n</w:t>');
      const piece = [...run.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((t) => xmlText(t[1])).join('');
      if (!piece) continue;
      text += piece;
      if (piece.trim()) {
        any = true;
        const props = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(r[1])?.[1] || '';
        if (!/<w:b(?:\s+w:val="(?:1|true|on)")?\s*\/>/.test(props)) bold = false;
      }
    }
    // numId "0" quita la numeración heredada del estilo.
    const listed = level && numId !== '0';
    const images = [...body.matchAll(/<a:blip\b[^>]*?\br:embed="([^"]+)"|<v:imagedata\b[^>]*?\br:id="([^"]+)"/g)]
      .map((m) => media.get(m[1] || m[2]))
      .filter(Boolean)
      .map((path) => zipImage(entries, path, scope));
    paragraphs.push({ text: text.trim(), level: listed ? Number(level[1]) : null, numId: listed ? numId : null, bold: any && bold, ...(images.length ? { images } : {}) });
  }
  return paragraphs.filter((p) => p.text || p.images);
}

// ---- Escribir un .xlsx ----------------------------------------------------------------------------------

const xmlEscape = (value) =>
  String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const columnName = (n) => (n < 26 ? String.fromCharCode(65 + n) : columnName(Math.floor(n / 26) - 1) + String.fromCharCode(65 + (n % 26)));

function sheetXml({ rows, widths = [] }) {
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const body = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .map((value, c) => {
            const ref = `${columnName(c)}${r + 1}`;
            if (value === null || value === undefined || value === '') return '';
            if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${Number.isInteger(value) ? '' : ' s="2"'}><v>${value}</v></c>`;
            return `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
          })
          .join('')}</row>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
}

/** Libro de Excel con una o varias hojas: [{ name, rows: [[celda…]], widths? }]. La primera fila va en negritas. */
function xlsxBlob(sheets) {
  const names = sheets.map((s, i) => (String(s.name || `Hoja ${i + 1}`).replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Hoja ${i + 1}`));
  const encoder = new TextEncoder();
  const files = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}</Types>`,
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
        .map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    [
      'xl/styles.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    ],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  const now = new Date();
  return new Blob(zipParts(files.map(([name, text]) => ({ name, data: encoder.encode(text), date: now }))), {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Descarga un libro de Excel. */
function downloadXlsx(name, sheets) {
  const blob = xlsxBlob(sheets);
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: asciiFileName(name) });
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
