// Actividades interactivas H5P (12.71). El docente sube el archivo .h5p (un ZIP) como material; Enlace no lo descomprime:
// cada archivo que pide el reproductor se lee del ZIP en R2 con lecturas por rango (el directorio del final y luego
// solo esa entrada), y se descomprime con DecompressionStream, sin gastar CPU del Worker en el paquete completo.
//
// Seguridad: el contenido H5P trae su propio JavaScript. Por eso todo lo que se sirve bajo /h5p/ lleva la CSP
// `sandbox` (origen opaco: sin acceso a la sesión ni a la API de Enlace, aunque se abra la dirección directamente) y se
// llega a ello con un token firmado de corta duración que se emite solo a quien puede leer el archivo
// (assertCanReadFile, las mismas reglas que una descarga).
import { assertCanReadFile } from './api.js';
import { SECURITY_HEADERS, fail, json, one, signToken, verifyToken } from './http.js';

const TOKEN_HOURS = 6;
const PLAYER_VERSION = 'h5p-standalone-3.8.2';
const MAX_ENTRY_BYTES = 60 * 1024 * 1024;
const TYPES = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  vtt: 'text/vtt; charset=utf-8',
};

/**
 * CSP de todo lo que está bajo /h5p/: `sandbox` sin allow-same-origin da un origen opaco, así que ni el reproductor ni
 * un archivo del paquete abierto directamente pueden leer la sesión o llamar a la API de Enlace.
 */
const H5P_CSP =
  "sandbox allow-scripts allow-popups allow-forms allow-downloads; default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com https://s.ytimg.com; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; " +
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com; object-src 'none'; base-uri 'self'; form-action 'none'";

const headers = (type, extra = {}) => ({
  ...SECURITY_HEADERS,
  'Content-Type': type,
  'Content-Security-Policy': H5P_CSP,
  // El reproductor corre con origen opaco: sus fetch() a estas mismas direcciones son de otro origen.
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'private, max-age=3600',
  ...extra,
});

// ---- Lectura del ZIP en R2 por rangos ---------------------------------------------------------------

const directories = new Map(); // llave de R2 → entradas (memoria del aislamiento; se descarta sola)

async function zipDirectory(bucket, key) {
  if (directories.has(key)) return directories.get(key);
  const head = await bucket.head(key);
  if (!head) return null;
  const size = head.size;
  const tailLength = Math.min(size, 65557);
  const tail = new Uint8Array(await (await bucket.get(key, { range: { offset: size - tailLength, length: tailLength } })).arrayBuffer());
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset + cdSize > size) return null;
  const cd =
    cdOffset >= size - tailLength
      ? tail.subarray(cdOffset - (size - tailLength), cdOffset - (size - tailLength) + cdSize)
      : new Uint8Array(await (await bucket.get(key, { range: { offset: cdOffset, length: cdSize } })).arrayBuffer());
  const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries = new Map();
  const decoder = new TextDecoder();
  for (let p = 0; p + 46 <= cd.length && cv.getUint32(p, true) === 0x02014b50; ) {
    const nameLength = cv.getUint16(p + 28, true);
    const name = decoder.decode(cd.subarray(p + 46, p + 46 + nameLength));
    entries.set(name, {
      method: cv.getUint16(p + 10, true),
      compressed: cv.getUint32(p + 20, true),
      size: cv.getUint32(p + 24, true),
      offset: cv.getUint32(p + 42, true),
      nameLength,
    });
    p += 46 + nameLength + cv.getUint16(p + 30, true) + cv.getUint16(p + 32, true);
  }
  if (directories.size > 50) directories.delete(directories.keys().next().value);
  directories.set(key, entries);
  return entries;
}

/** El contenido de una entrada del ZIP como flujo (descomprimido si hace falta), o null si no existe. */
async function zipEntry(bucket, key, path) {
  const entries = await zipDirectory(bucket, key);
  const entry = entries?.get(path);
  if (!entry || entry.compressed > MAX_ENTRY_BYTES || entry.size > MAX_ENTRY_BYTES) return null;
  // El encabezado local puede traer un campo extra distinto al del directorio: se lee con holgura y se mide.
  const span = 30 + entry.nameLength + 1024 + entry.compressed;
  const raw = new Uint8Array(await (await bucket.get(key, { range: { offset: entry.offset, length: span } })).arrayBuffer());
  const lv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (lv.getUint32(0, true) !== 0x04034b50) return null;
  const start = 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
  const data = raw.subarray(start, start + entry.compressed);
  if (data.length !== entry.compressed) return null;
  if (entry.method === 0) return { body: data, size: entry.size };
  if (entry.method !== 8) return null;
  return { body: new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')), size: entry.size };
}

// ---- Rutas ----------------------------------------------------------------------------------------------

const isH5p = (file) => /\.h5p$/i.test(file?.name || '');

export const h5pRoutes = {
  /** Dirección firmada del reproductor para un material .h5p que esta persona puede leer. */
  async 'GET /api/h5p/token'({ db, env, user, url }) {
    const file = await one(db, 'SELECT * FROM aula_files WHERE id=? AND course=?', String(url.searchParams.get('file') || ''), String(url.searchParams.get('course') || ''));
    if (!file || !isH5p(file) || file.scope !== 'material') fail('Actividad no encontrada.', 404);
    await assertCanReadFile({ db, user, url: new URL('https://x/') }, file);
    const token = await signToken({ h5p: file.id, exp: Math.floor(Date.now() / 1000) + TOKEN_HOURS * 3600 }, env.SESSION_SECRET);
    return json({ url: `/h5p/${token}/` });
  },
};

const PLAYER_HTML = (base) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Actividad interactiva</title>
<link rel="stylesheet" href="/vendor/${PLAYER_VERSION}/styles/h5p.css">
<style>html,body{margin:0;background:#fff}body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif}#h5p{min-height:120px}.aviso{padding:16px;color:#3d4b5c}</style>
</head><body><div id="h5p" data-base="${base}" data-player="/vendor/${PLAYER_VERSION}/"></div>
<script src="/vendor/${PLAYER_VERSION}/main.bundle.js"></script><script src="/h5p-jugador.js"></script></body></html>`;

/** GET /h5p/<token>/ (el reproductor) y /h5p/<token>/c/<ruta> (un archivo del paquete). Sin sesión: manda el token. */
export async function serveH5p(env, token, rest) {
  const payload = await verifyToken(token, env.SESSION_SECRET);
  const notFound = (text = 'No encontrado') => new Response(text, { status: 404, headers: headers('text/plain; charset=utf-8') });
  if (!payload?.h5p) return notFound('El enlace de la actividad venció. Vuelve a abrirla desde Enlace.');
  const file = await env.DB.prepare("SELECT id, r2_key, name FROM aula_files WHERE id=? AND scope='material'").bind(payload.h5p).first();
  if (!file || !isH5p(file)) return notFound();
  if (rest === '') return new Response(PLAYER_HTML(`/h5p/${token}/c`), { headers: headers('text/html; charset=utf-8') });
  if (!rest.startsWith('c/')) return notFound();
  let path;
  try {
    path = decodeURIComponent(rest.slice(2));
  } catch {
    return notFound();
  }
  if (!path || path.includes('..') || path.startsWith('/') || path.includes('\\')) return notFound();
  const entry = await zipEntry(env.BUCKET, file.r2_key || file.id, path);
  if (!entry) return notFound();
  const type = TYPES[path.split('.').pop().toLowerCase()] || 'application/octet-stream';
  return new Response(entry.body, { headers: headers(type, entry.body instanceof Uint8Array ? { 'Content-Length': String(entry.size) } : {}) });
}
