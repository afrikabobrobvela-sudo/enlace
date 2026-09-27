// Utilidades compartidas por la API y la autenticación.
// Todo lo que valida datos de entrada vive aquí para que las reglas sean las mismas en todas las rutas.

export const SECURITY_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

// 'wasm-unsafe-eval' solo permite compilar WebAssembly (decodificadores de imágenes de pdf.js); no habilita eval de JavaScript.
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'";

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extraHeaders },
  });
}

/** Lanza un error que la API convierte en respuesta JSON con el código indicado. */
export function fail(message, status = 400, extra = undefined) {
  throw Object.assign(new Error(message), { status, extra });
}

export function text(value, max = 5000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('Texto inválido o demasiado largo.');
  return value.trim();
}

export function optionalText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

export function email(value) {
  const normalized = text(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) fail('Correo no válido.');
  return normalized;
}

export function isoDate(value) {
  if (!value) return '';
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('Fecha no válida.');
  return new Date(value).toISOString();
}

export const nowIso = () => new Date().toISOString();

const MAX_BODY_BYTES = 180_000;

export async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  if (Number(request.headers.get('content-length')) > maxBytes) fail('Solicitud demasiado grande.', 413);
  const raw = await request.text();
  if (raw.length > maxBytes) fail('Solicitud demasiado grande.', 413);
  try {
    return JSON.parse(raw);
  } catch {
    fail('Datos no válidos.');
  }
}

/**
 * Protección CSRF para cualquier método que modifique datos:
 * el navegador debe enviar el mismo origen y una cabecera que un formulario externo no puede poner.
 */
export function requireSameOrigin(request, { customHeader = true } = {}) {
  const url = new URL(request.url);
  if (request.headers.get('origin') !== url.origin) fail('Origen no autorizado.', 403);
  if (customHeader && request.headers.get('x-aula-request') !== '1') fail('Solicitud no autorizada.', 403);
}

// ---- D1 ----------------------------------------------------------------------------------------

// D1 rechaza `undefined` como parámetro (error 500). Se convierte a NULL para que la consulta
// simplemente no encuentre nada y la ruta responda con su 404/400 habitual.
const bindable = (params) => params.map((p) => (p === undefined ? null : p));
export const one = (db, sql, ...params) => db.prepare(sql).bind(...bindable(params)).first();
export const all = async (db, sql, ...params) => (await db.prepare(sql).bind(...bindable(params)).all()).results;
export const run = (db, sql, ...params) => db.prepare(sql).bind(...bindable(params)).run();
export const parseJson = (value, fallback) => {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
};

// ---- Tokens firmados (cookies de sesión y de OAuth) -------------------------------------------

const encoder = new TextEncoder();

export function base64url(bytes) {
  let binary = '';
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(value) {
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hmacKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    fail('Falta configurar SESSION_SECRET (mínimo 32 caracteres) en el servidor.', 503);
  }
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** Firma un objeto con HMAC-SHA256. El resultado es `payload.firma`, ambos en base64url. */
export async function signToken(payload, secret) {
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return body + '.' + base64url(signature);
}

/** Devuelve el objeto firmado o null si la firma no coincide o el token expiró (campo `exp`, en segundos). */
export async function verifyToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  let valid = false;
  try {
    valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64url(signature), encoder.encode(body));
  } catch (error) {
    if (error.status) throw error; // secreto mal configurado: que se vea el 503
    return null;
  }
  if (!valid) return null;
  const payload = parseJson(new TextDecoder().decode(fromBase64url(body)), null);
  if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
  return payload;
}

export function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

/**
 * Cookie `__Host-`: el navegador exige HTTPS, Path=/ y ningún Domain, así que no puede
 * compartirse con otros subdominios de workers.dev.
 */
export function cookie(name, value, maxAgeSeconds) {
  return `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

/** Acepta solo rutas internas (`/algo`), nunca `//otro-sitio` ni URLs absolutas. */
export function safeReturnPath(value) {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) && value.length < 500 ? value : '/';
}
