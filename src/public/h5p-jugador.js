/* Reproductor H5P (12.71). Corre dentro de /h5p/<token>/, aislado con la CSP `sandbox` (origen opaco): no ve la sesión
 * ni la API de Enlace. Solo avisa a la página de Enlace, con postMessage, el resultado al terminar y su altura. */
(function () {
  // Con origen opaco, leer localStorage o sessionStorage lanza un error y H5P los usa al arrancar: se sustituyen por
  // almacenes en memoria (el avance dentro de la actividad no se guarda entre visitas; el resultado sí, en Enlace).
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      window[name].getItem('x');
    } catch {
      const data = new Map();
      const store = {
        getItem: (k) => (data.has(String(k)) ? data.get(String(k)) : null),
        setItem: (k, v) => data.set(String(k), String(v)),
        removeItem: (k) => data.delete(String(k)),
        clear: () => data.clear(),
        key: (i) => [...data.keys()][i] ?? null,
        get length() {
          return data.size;
        },
      };
      Object.defineProperty(window, name, { value: store, configurable: true });
    }
  }
  const box = document.getElementById('h5p');
  const send = (data) => parent.postMessage({ enlaceH5p: true, ...data }, '*');
  new H5PStandalone.H5P(box, {
    h5pJsonPath: box.dataset.base,
    frameJs: box.dataset.player + 'frame.bundle.js',
    frameCss: box.dataset.player + 'styles/h5p.css',
    // Sin marco interno: dentro de un documento aislado, un iframe hijo tendría otro origen opaco y el reproductor no
    // podría escribir en él. `embedType` no aparece en el README de h5p-standalone, pero main.bundle.js lo lee.
    embedType: 'div',
    fullScreen: true,
    icon: false,
  })
    .then(() => {
      window.H5P.externalDispatcher.on('xAPI', (event) => {
        const statement = event?.data?.statement;
        const result = statement?.result;
        // Solo el resultado de la actividad completa (no el de cada pregunta de una presentación o un libro).
        if (!result?.score || statement.context?.contextActivities?.parent) return;
        if (!/\/(completed|answered|passed|failed)$/.test(String(statement.verb?.id || ''))) return;
        const { scaled, raw, max } = result.score;
        const fraction = typeof scaled === 'number' ? scaled : max ? raw / max : null;
        if (fraction === null || !Number.isFinite(fraction)) return;
        send({ type: 'score', score: Math.round(Math.min(1, Math.max(0, fraction)) * 1000) / 100 });
      });
    })
    .catch((error) => {
      console.error('Enlace H5P:', error);
      box.innerHTML = '<p class="aviso">No se pudo abrir la actividad. Pide a tu docente que revise el archivo .h5p.</p>';
    });
  const report = () => send({ type: 'height', height: Math.ceil(document.documentElement.scrollHeight) });
  new ResizeObserver(report).observe(document.body);
  report();
})();
