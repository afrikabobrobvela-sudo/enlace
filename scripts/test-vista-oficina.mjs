// Pruebas de la 12.89: vista previa de PowerPoint, Excel, CSV y texto en el navegador (vista-oficina.js). Los lectores
// son funciones puras: aquí se corren con los archivos de scripts/fixtures/vista-previa.* (generados con python-pptx,
// python-docx y openpyxl: la misma estructura que guardan PowerPoint y Excel) y se revisa el HTML que arman.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

let checks = 0;
const ok = (value, message) => {
  assert(value, message);
  checks++;
};
const ctx = vm.createContext({ console, TextEncoder, TextDecoder, Blob, Response, DecompressionStream, URL });
for (const file of ['zip.js', 'oficina.js', 'preview.js', 'vista-oficina.js']) {
  try {
    vm.runInContext(readFileSync('src/public/' + file, 'utf8').replace(/\ndocument\.addEventListener\([\s\S]*$/, ''), ctx);
  } catch (error) {
    throw error;
  }
}
if (!vm.runInContext('typeof esc', ctx).startsWith('f'))
  vm.runInContext(`function esc(v) { return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }`, ctx);
const g = (name) => vm.runInContext(name, ctx);
const J = (value) => JSON.parse(JSON.stringify(value));
const fixture = (name) => {
  const b = readFileSync('scripts/fixtures/' + name);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

// ---- Qué se puede ver ----------------------------------------------------------------------------------------
const kind = g('previewKind');
ok(kind('Reporte.DOCX') === 'docx' && kind('clase.pptx') === 'slides' && kind('datos.xlsx') === 'sheet', 'Word, PowerPoint y Excel tienen vista previa');
ok(kind('lista.csv') === 'csv' && kind('notas.txt') === 'text' && kind('programa.py') === 'text', 'CSV, texto y código también');
ok(kind('viejo.doc') === null && kind('viejo.ppt') === null && kind('viejo.xls') === null, 'Los formatos binarios antiguos se descargan');

// ---- XML ------------------------------------------------------------------------------------------------------
const tree = g('xmlTree')('<?xml version="1.0"?><p:sldId xmlns:r="x" id="256" r:id="rId2"><a:t>A &amp; B &#x2014;<![CDATA[<c>]]></a:t></p:sldId>');
const sld = tree.kids[0];
ok(sld.name === 'sldId' && sld.attrs.id === '256' && sld.attrs['r:id'] === 'rId2', 'El atributo sin prefijo no se pierde (id y r:id)');
ok(sld.kids[0].text === 'A & B —<c>', 'Entidades y CDATA en el texto');
ok(g('zipResolve')('ppt/slides/', '../media/image1.png') === 'ppt/media/image1.png', 'Rutas relativas del paquete');

// ---- Colores --------------------------------------------------------------------------------------------------
const color = (xml, c = { theme: { accent1: '4472C4', dk1: '000000', lt1: 'FFFFFF' }, map: { tx1: 'dk1', bg1: 'lt1' } }) => g('officeColor')(g('xmlTree')(`<f>${xml}</f>`).kids[0], c);
ok(color('<a:srgbClr val="C00000"/>') === '#c00000', 'Color RGB');
ok(color('<a:schemeClr val="tx1"/>') === '#000000' && color('<a:schemeClr val="accent1"/>') === '#4472c4', 'Colores del tema con clrMap');
ok(color('<a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr>') === '#203864', 'lumMod oscurece como PowerPoint');
ok(/^rgba\(255, 0, 0, 0\.5\)$/.test(color('<a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr>')), 'Transparencia');

// ---- PowerPoint -------------------------------------------------------------------------------------------------
const deck = await g('readPptxDeck')(fixture('vista-previa.pptx'));
ok(deck.slides.length === 3 && deck.total === 4, 'La diapositiva oculta no se muestra');
ok(Math.round(deck.width) === 720 && Math.round(deck.height) === 540, 'Tamaño 4:3 en puntos');
const texts = (slide) => J(slide.items.filter((i) => i.text).map((i) => i.text.paragraphs.map((p) => p.runs.map((r) => r.text ?? '').join('')).join('|')));
ok(J(texts(deck.slides[0])).join(' / ') === 'Movimiento rectilíneo / Física I · Unidad 2', 'Título y subtítulo de la portada');
const title = deck.slides[0].items.find((i) => i.text);
ok(title.x > 0.05 && title.w > 0.5 && title.y > 0.2 && title.y < 0.5, 'El título toma su posición del diseño (no la trae la diapositiva)');
ok(title.text.paragraphs[0].align === 'center' && Math.round(title.text.paragraphs[0].runs[0].size) === 44, 'Alineación y tamaño heredados del patrón');
const body = deck.slides[1].items.filter((i) => i.text)[1].text.paragraphs;
ok(body[0].bullet === '•' && body[1].level === 1 && body[1].bullet, 'Viñetas del patrón y segundo nivel');
ok(body[1].marginLeft > body[0].marginLeft, 'El segundo nivel tiene más sangría');
const red = body[2].runs[0];
ok(red.bold && red.color === '#c00000' && red.size === 28, 'Formato propio del texto');
const third = deck.slides[2].items;
const table = third.find((i) => i.type === 'table');
ok(table && J(table.rows.map((r) => r.map((c) => c.text?.paragraphs[0].runs[0]?.text))).join() === 't (s),x (m),0,0,1,4.9', 'Tabla con sus celdas');
ok(table.rows[0][0].fill && table.rows[0][0].text.paragraphs[0].runs[0].bold, 'Encabezado de la tabla resaltado');
const image = third.find((i) => i.type === 'image');
ok(image?.path === 'ppt/media/image1.png' && (await deck.media(image.path))[1] === 0x50, 'Imagen con su ruta en el paquete');
const grouped = third.find((i) => i.type === 'shape' && i.geometry === 'roundRect');
ok(grouped && grouped.fill && Math.abs(grouped.x - 1 / 10) < 0.01 && grouped.text.anchor === 'center', 'Forma dentro de un grupo, con relleno y texto centrado del estilo');

const html = g('pptxItemHtml')({ type: 'shape', x: 0, y: 0, w: 0.5, h: 0.5, geometry: 'rect', fill: '#fff', line: null, text: { anchor: 'start', wrap: true, insets: [7, 3, 7, 3], paragraphs: [{ align: 'left', marginLeft: 0, indent: 0, bullet: null, runs: [{ text: '<img src=x onerror=alert(1)>', size: 18, font: "Ar'ial" }], endSize: 18 }] } }, new Map());
ok(html.includes('&lt;img src=x onerror=alert(1)&gt;') && !html.includes('<img'), 'El texto de la diapositiva se escapa');

// ---- Excel --------------------------------------------------------------------------------------------------------
const sheets = await g('readXlsxSheets')(fixture('vista-previa.xlsx'));
ok(J(sheets.map((s) => s.name)).join() === 'Datos,Resumen', 'Hojas visibles (la oculta no sale)');
const [datos] = sheets;
const v = (r, c) => datos.rows[r]?.[c]?.v;
ok(v(0, 0) === 'Lista de alumnos' && datos.rows[0][0].bold, 'Negritas');
ok(J(datos.merges)[0].c2 === 2, 'Celdas combinadas');
ok(v(2, 1) === '14/09/2026', 'Fecha con formato de México');
ok(v(2, 2) === '87.5%', 'Porcentaje con un decimal');
ok(v(3, 2) === '1,234.50' && v(3, 1) === '3.14159' && datos.rows[3][1].number, 'Números con separador de miles y «General»');
const tableHtml = g('sheetTableHtml')(datos);
ok(tableHtml.includes('colspan="3"') && tableHtml.includes('Beto &lt;b&gt;') && tableHtml.includes('<th scope="col">C</th>'), 'Tabla con combinadas, escapada y con letras de columna');
ok(g('excelNumber')('46279.5', { id: 22 }) === '14/09/2026 12:00' && g('excelNumber')('0.75', { id: 20 }) === '18:00', 'Fecha con hora y solo hora');

// ---- CSV y texto ---------------------------------------------------------------------------------------------------
ok(J(g('csvRowsAuto')('Nombre;Calificación\r\n"Pérez; Ana";9,5\n')).join('|') === 'Nombre,Calificación|Pérez; Ana,9,5', 'CSV con punto y coma y comillas');
ok(J(g('csvRowsAuto')('a\tb\n1\t2')).join('|') === 'a,b|1,2', 'CSV con tabuladores');
ok(g('decodeText')(new Uint8Array([0x41, 0xf1, 0x6f])) === 'Año', 'Texto en Windows-1252 (CSV de Excel en español)');
ok(g('decodeText')(new TextEncoder().encode('Ñandú')) === 'Ñandú', 'Texto en UTF-8');

// ---- Word: el lector incluido ---------------------------------------------------------------------------------------
const docxLib = readFileSync('src/public/vendor/docx-preview-0.4.1/docx-preview.min.js', 'utf8');
ok(docxLib.includes('renderAsync') && readFileSync('src/public/vendor/docx-preview-0.4.1/jszip.min.js', 'utf8').includes('JSZip v3.10.2'), 'docx-preview y JSZip están en vendor');
ok(readFileSync('src/public/index.html', 'utf8').includes('<script src="/vista-oficina.js" defer></script>'), 'vista-oficina.js se carga en la página');

console.log(`Vista previa de documentos: ${checks} comprobaciones correctas.`);
