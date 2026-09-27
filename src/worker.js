// Punto de entrada del Worker de Cloudflare.
// /api/*  → API (requiere sesión)
// /auth/* → inicio y cierre de sesión
// resto   → interfaz (src/public, incrustada por scripts/build.mjs)

import { api } from './server/api.js';
import { auth } from './server/auth.js';
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from './server/http.js';
import { assets } from './generated/assets.js';

const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  wasm: 'application/wasm',
  woff2: 'font/woff2',
};
const decoded = new Map(); // base64 → bytes, una sola vez por instancia

function body(name) {
  const asset = assets[name];
  if (asset.text !== undefined) return asset.text;
  if (!decoded.has(name)) decoded.set(name, Uint8Array.from(atob(asset.base64), (c) => c.charCodeAt(0)));
  return decoded.get(name);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return api(request, env);
    if (url.pathname.startsWith('/auth/')) return auth(request, env);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });

    const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    if (!Object.hasOwn(assets, name)) return new Response('Not found', { status: 404 });
    // Las bibliotecas llevan su versión en la ruta, así que pueden guardarse en caché de forma permanente.
    const cache = name.startsWith('vendor/') ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {};
    return new Response(request.method === 'HEAD' ? null : body(name), {
      headers: {
        'Content-Type': TYPES[name.split('.').pop()] || 'application/octet-stream',
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        ...SECURITY_HEADERS,
        ...cache,
      },
    });
  },
};
