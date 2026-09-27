/* Fórmulas con KaTeX en todo el contenido del curso.
   Delimitadores: $…$ y \(…\) en línea; $$…$$ y \[…\] en bloque. Para un signo de pesos literal, escribe \$. */
(function () {
  const OPTIONS = {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false },
      { left: '$', right: '$', display: false },
    ],
    throwOnError: false,
    // Nunca dentro de campos de edición, código ni controles: ahí se ve el texto tal cual.
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option', 'select', 'button'],
    ignoredClasses: ['no-math', 'viewer'],
  };
  let scheduled = false;

  function renderAll() {
    scheduled = false;
    if (typeof renderMathInElement !== 'function') return;
    for (const root of document.querySelectorAll('#main, #fields, #toast')) renderMathInElement(root, OPTIONS);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(renderAll);
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Enlace vuelve a dibujar cada pantalla con innerHTML; se reprocesa al cambiar el contenido.
    // Tras dibujar las fórmulas ya no quedan delimitadores, así que el ciclo se detiene solo.
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    schedule();
  });
})();
