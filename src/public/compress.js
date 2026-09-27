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
