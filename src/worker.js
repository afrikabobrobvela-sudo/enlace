// Punto de entrada del Worker de Cloudflare.
// /api/*  → API (requiere sesión)
// /auth/* → inicio y cierre de sesión
// resto   → interfaz (src/public, incrustada por scripts/build.mjs)

import { api } from './server/api.js';
import { auth } from './server/auth.js';
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from './server/http.js';
import { assets } from './generated/assets.js';
import { runDigest } from './server/digest.js';

const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  wasm: 'application/wasm',
  woff2: 'font/woff2',
  png: 'image/png',
  webmanifest: 'application/manifest+json; charset=utf-8',
};
const decoded = new Map(); // base64 → bytes, una sola vez por instancia

function body(name) {
  const asset = assets[name];
  if (asset.text !== undefined) return asset.text;
  if (!decoded.has(name)) decoded.set(name, Uint8Array.from(atob(asset.base64), (c) => c.charCodeAt(0)));
  return decoded.get(name);
}

export default {
  // Resumen diario de avisos por correo (el horario está en [triggers] de wrangler.toml).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDigest(env.DB, env).catch((error) => console.error('aula-mail resumen', error)));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return api(request, env);
    if (url.pathname.startsWith('/auth/')) return auth(request, env);
    // Vigilancia: confirma que el Worker y la base responden. No expone datos.
    if (url.pathname === '/salud') {
      try {
        // Además de responder, la base debe tener las tablas: se informa la última migración aplicada.
        const last = await env.DB.prepare('SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1')
          .first()
          .catch(() => null);
        await env.DB.prepare('SELECT 1 FROM aula_users LIMIT 1').first();
        // Publicado con el correo de ejemplo de wrangler.toml: nadie tendría la cuenta de administración.
        if (!env.AULA_OWNER_EMAIL || env.AULA_OWNER_EMAIL === 'tu-correo@gmail.com') {
          return new Response(JSON.stringify({ ok: false, problema: 'AULA_OWNER_EMAIL tiene el correo de ejemplo. Publica con npm run configurar.' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
          });
        }
        return new Response(JSON.stringify({ ok: true, migracion: last?.name || null }), { headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS } });
      } catch (error) {
        console.error('aula-salud', error);
        return new Response(JSON.stringify({ ok: false }), { status: 503, headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS } });
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });

    let name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    // Páginas públicas sin extensión, por ejemplo /privacidad → privacidad.html.
    if (!Object.hasOwn(assets, name) && Object.hasOwn(assets, name + '.html')) name += '.html';
    if (!Object.hasOwn(assets, name)) return new Response('Not found', { status: 404 });
    // Las bibliotecas llevan su versión en la ruta, así que pueden guardarse en caché de forma permanente. Lo demás
    // (la interfaz) se revalida en cada visita con su huella (ETag): si no cambió, 304 sin cuerpo; si hay versión
    // nueva, se descarga. Así siempre se ve la última versión sin bajar todo cada vez.
    const cache = name.startsWith('vendor/') ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : { 'Cache-Control': 'no-cache' };
    const headers = {
      'Content-Type': TYPES[name.split('.').pop()] || 'application/octet-stream',
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      ...SECURITY_HEADERS,
      ...cache,
      ...(assets[name].etag ? { ETag: assets[name].etag } : {}),
    };
    const known = request.headers.get('If-None-Match');
    if (known && assets[name].etag && known.split(',').some((tag) => tag.trim().replace(/^W\//, '') === assets[name].etag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(request.method === 'HEAD' ? null : body(name), { headers });
  },
};
