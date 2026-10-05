/* Service worker de Enlace: permite instalar la app en el celular y abrirla sin conexión con la última versión vista.
 * NUNCA guarda en caché /api, /auth ni archivos de alumnos: esos datos siempre vienen del servidor. */
const CACHE = 'enlace-v2'; // v2 (12.37): logotipo e íconos nuevos; borra los guardados de la v1
const PRIVATE = /^\/(api|auth|salud)(\/|$)/;

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
