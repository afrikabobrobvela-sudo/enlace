/* Reduce las fotos antes de subirlas, en el navegador del alumno o docente (no usa tiempo del servidor).
 *
 * Una foto de celular (4–8 MB) queda en unos cientos de KB con el lado mayor en 2000 px, suficiente para leer
 * un cuaderno o un reporte. Se conserva el formato y el nombre del archivo (así se respetan las extensiones
 * permitidas de cada actividad). Si el resultado no ahorra al menos 30 %, se sube el original.
 * Al redibujar la imagen también se quitan sus metadatos (por ejemplo, la ubicación GPS de la foto).
 */

const COMPRESS_MAX_SIDE = 2000;
const COMPRESS_QUALITY = 0.82;
const COMPRESS_MIN_BYTES = 300 * 1024;
const COMPRESS_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

async function compressImage(file) {
  if (!file || !COMPRESS_TYPES.includes(file.type) || file.size < COMPRESS_MIN_BYTES) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, COMPRESS_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, file.type, COMPRESS_QUALITY));
    // Algunos navegadores no generan WEBP y devuelven PNG: en ese caso se sube el original.
    if (!blob || blob.type !== file.type || blob.size > file.size * 0.7) return file;
    return new File([blob], file.name, { type: file.type, lastModified: file.lastModified });
  } catch {
    return file; // imagen que el navegador no puede leer: se sube tal cual
  }
}

// ---- Fotos a PDF -------------------------------------------------------------------------------
// Las fotos de una tarea hecha a mano se unen en un solo PDF (una página por foto), en el teléfono del alumno.
// Así la entrega cabe en el límite de archivos de la actividad y el docente la revisa como un documento.

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_PDF_PHOTOS = 30;
const isPhoto = (file) => PHOTO_TYPES.includes(file?.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file?.name || '');

/** Redibuja la foto como JPEG (lado mayor de hasta 2000 px, con fondo blanco) y devuelve sus bytes y medidas. */
async function photoToJpeg(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`Este teléfono no pudo leer la foto ${file.name}. Tómala de nuevo con la cámara desde «Tomar foto» o quítala.`);
  }
  const scale = Math.min(1, COMPRESS_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', COMPRESS_QUALITY));
  if (!blob) throw new Error(`No se pudo leer la foto ${file.name}.`);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
}

/**
 * Arma un PDF 1.4 con una imagen JPEG por página (la imagen va tal cual, con el filtro DCTDecode).
 * Cada página mide 595 puntos de ancho (A4) y el alto que corresponda a la foto.
 */
function jpegPagesToPdf(pages) {
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (part) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (number, ...parts) => {
    offsets[number] = length;
    push(`${number} 0 obj\n`);
    parts.forEach(push);
    push('\nendobj\n');
  };
  push('%PDF-1.4\n%âãÏÓ\n');
  const pageNumber = (i) => 3 + i * 3;
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageNumber(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((page, i) => {
    const width = 595;
    const height = Math.max(1, Math.round((595 * page.height) / page.width));
    const content = `q ${width} 0 0 ${height} 0 0 cm /Foto${i} Do Q`;
    object(pageNumber(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Foto${i} ${pageNumber(i) + 2} 0 R >> >> /Contents ${pageNumber(i) + 1} 0 R >>`);
    object(pageNumber(i) + 1, `<< /Length ${content.length} >>\nstream\n`, content, '\nendstream');
    object(
      pageNumber(i) + 2,
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`,
      page.bytes,
      '\nendstream',
    );
  });
  const count = 3 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

/** Une las fotos en un PDF (en el orden en que se agregaron). */
async function photosToPdf(files, name) {
  const pages = [];
  for (const file of files) pages.push(await photoToJpeg(file));
  return new File([jpegPagesToPdf(pages)], name, { type: 'application/pdf' });
}
