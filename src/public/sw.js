/* Service worker de Enlace: permite instalar la app en el celular y abrirla sin conexión con la última versión vista,
 * y muestra las notificaciones (12.72).
 * NUNCA guarda en caché /api, /auth ni archivos de alumnos: esos datos siempre vienen del servidor. */
const CACHE = 'enlace-v2'; // v2 (12.37): logotipo e íconos nuevos; borra los guardados de la v1
// 12.72: tampoco las actividades H5P (llevan un token), las constancias ni las configuraciones de SEB.
const PRIVATE = /^\/(api|auth|salud|h5p|constancia|seb)(\/|$)/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || PRIVATE.test(url.pathname)) return;
  // Bibliotecas con versión en la ruta: primero la caché. Todo lo demás: primero la red (siempre la versión nueva).
  if (url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((res) => {
            if (res.ok) caches.open(CACHE).then((cache) => cache.put(event.request, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/'))),
  );
});

// ---- Notificaciones (12.72) ------------------------------------------------------------------------------
// El aviso llega cifrado desde Enlace ({ title, body, url, tag }). La misma etiqueta reemplaza al anterior sin volver
// a sonar (por ejemplo, varias entregas de la misma actividad).
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const url = typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/';
  event.waitUntil(
    self.registration.showNotification(String(data.title || 'Enlace').slice(0, 120), {
      body: String(data.body || '').slice(0, 240),
      tag: data.tag ? String(data.tag).slice(0, 120) : undefined,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      lang: 'es-MX',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = open.find((c) => new URL(c.url).origin === self.location.origin);
      if (client) {
        // Enlace ya está abierto: se va a la pantalla del aviso sin recargar.
        client.postMessage({ type: 'enlace-open', hash: target.hash });
        return client.focus();
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});

// El navegador renovó la suscripción: se registra la nueva con la sesión que haya en este navegador.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const key = await (await fetch('/api/push/key', { credentials: 'same-origin' })).json();
      if (!key.publicKey) return;
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key.publicKey });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Aula-Request': '1' },
        body: JSON.stringify(sub.toJSON()),
      });
    })().catch(() => {}),
  );
});
