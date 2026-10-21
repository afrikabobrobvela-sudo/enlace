/* Errores de la interfaz (12.88): un fallo de JavaScript en el navegador de alguien se reporta a Enlace
 * (POST /api/client-error) para verlo en Reportes → Errores antes de que la persona lo cuente. Se carga primero.
 * Como máximo 5 por página y sin repetir el mismo; sin sesión no se reporta (la API lo rechaza). Se ignora lo que no
 * viene de Enlace (extensiones del navegador) y los errores de la API, que el servidor ya registró. */
(() => {
  const sent = new Set();
  let count = 0;
  const page = () => location.pathname + location.hash.replace(/(unirse=)[^&]*/, '$1…');
  function report(info) {
    if (count >= 5 || !info.message) return;
    const key = `${info.message}|${info.source}|${info.line}`;
    if (sent.has(key)) return;
    sent.add(key);
    count++;
    fetch('/api/client-error', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', 'X-Aula-Request': '1' },
      body: JSON.stringify({ ...info, page: page() }),
    }).catch(() => {});
  }
  const ours = (source) => !source || source.startsWith(location.origin);
  window.addEventListener('error', (event) => {
    if (!event.message || event.message === 'Script error.' || /ResizeObserver loop/.test(event.message)) return;
    if (!ours(event.filename)) return;
    report({ message: event.message, source: event.filename || '', line: event.lineno, column: event.colno, stack: event.error?.stack || '' });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    // Un error de la API trae `status`: el servidor ya lo registró (o es un aviso normal, como un 403).
    if (reason && typeof reason === 'object' && 'status' in reason) return;
    if (reason?.name === 'AbortError') return;
    const stack = reason?.stack || '';
    if (stack && !stack.includes(location.origin) && /chrome-extension|moz-extension|safari-extension/.test(stack)) return;
    report({ message: `Promesa sin atender: ${reason?.message || String(reason)}`, stack });
  });
})();
