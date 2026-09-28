/* Navegación con el botón «Atrás» del teléfono y del navegador.
 *
 * - Cada pantalla tiene su dirección (#c=curso&s=sección&d=elemento…): al recargar, Enlace vuelve a la misma
 *   pantalla y «Atrás» regresa a la anterior en lugar de salir de la aplicación.
 * - Con una ventana abierta (formulario, menú «Más», vista previa), «Atrás» la cierra.
 * La ruta se calcula del estado de la interfaz (current, section, detail…) cada vez que cambia #main: no hay que
 * registrar cada pantalla a mano. Los ids solo se usan para buscar registros; nunca se insertan como HTML.
 */

const ROUTE_KEYS = ['c', 's', 'd', 'm', 'a', 'r', 'h'];
const ROUTE_DETAIL = ['task', 'forum', 'quiz', 'review', 'editor'];
let routeReady = false; // se activa al terminar de abrir la pantalla inicial
let routeApplying = false; // aplicando una entrada del historial: se reemplaza, no se agrega otra
let pendingBack = 0; // history.back() pedidos al cerrar una ventana con el botón de la ventana
let syncAfterBack = false;
let afterBack = null; // qué hacer cuando termine de cerrarse la ventana (por ejemplo, ir a otra sección)
const dialogStack = [];
const closedByBack = new Set();

function routeNow() {
  if (!current) return homeView && homeView !== 'courses' ? { h: homeView } : {};
  const route = { c: current.course.id, s: section || 'hub' };
  if (detail && ROUTE_DETAIL.includes(section)) route.d = detail;
  if (section === 'content' && moduleId) route.m = moduleId;
  if (section === 'attendance' && typeof attendanceSessionId !== 'undefined' && attendanceSessionId) route.a = attendanceSessionId;
  if (section === 'review' && reviewMember) route.r = reviewMember;
  return route;
}

function routeHash(route) {
  const params = new URLSearchParams();
  for (const key of ROUTE_KEYS) if (route?.[key]) params.set(key, route[key]);
  const text = params.toString();
  return text ? '#' + text : '';
}

function parseRoute(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const route = {};
  for (const key of ROUTE_KEYS) {
    const value = params.get(key);
    if (value && value.length <= 200) route[key] = value;
  }
  return route;
}

const routeUrl = (route) => location.pathname + location.search + routeHash(route);
const sameRoute = (a, b) => routeHash(a) === routeHash(b);

/** Registra la pantalla actual en el historial (una entrada nueva solo si cambió de pantalla). */
function syncRoute() {
  if (!routeReady || !globalThis.history?.pushState) return;
  if (pendingBack) {
    syncAfterBack = true; // se hace al terminar de cerrar la ventana
    return;
  }
  if (history.state?.dialog) return; // con una ventana abierta, la pantalla de fondo no cambia de entrada
  const route = routeNow();
  const known = history.state?.route;
  if (routeApplying || !known) history.replaceState({ route }, '', routeUrl(route));
  else if (!sameRoute(route, known)) history.pushState({ route }, '', routeUrl(route));
}

/** ¿Se puede salir de la pantalla actual? (cambios sin guardar o examen en curso). */
function canLeaveScreen() {
  if (typeof examState !== 'undefined' && examState) {
    if (!confirm('Estás contestando un examen. ¿Salir? Tus respuestas quedan guardadas, pero el tiempo sigue corriendo.')) return false;
    stopExam();
  }
  if (dirty) {
    if (!confirm('Hay cambios sin guardar. ¿Quieres salir de esta pantalla?')) return false;
    dirty = false;
  }
  return true;
}

/** Muestra la pantalla de una entrada del historial o de una dirección (#…). */
async function applyRoute(route) {
  routeApplying = true;
  try {
    if (!route.c) {
      if (current) {
        current = null;
        previewAsStudent = false;
        previewMember = null;
        courses = await request('/api/courses');
      }
      // Calendario e historial de avisos son de todos; las demás vistas de inicio, solo de la administración.
      homeView = ['calendar', 'avisos'].includes(route.h) || (route.h && me?.role === 'admin') ? route.h : 'courses';
      section = 'hub';
      detail = null;
      render();
    } else {
      if (current?.course.id !== route.c) await openCourse(route.c);
      section = route.s || 'hub';
      detail = route.d || null;
      moduleId = route.m || null;
      if (typeof attendanceSessionId !== 'undefined') attendanceSessionId = route.a || null;
      reviewMember = route.r || null;
      render();
    }
    syncRoute();
  } catch (error) {
    // Curso eliminado o sin acceso: se regresa a Mis cursos.
    current = null;
    homeView = 'courses';
    courses = await request('/api/courses').catch(() => courses);
    render();
    syncRoute();
    toast(error.message);
  } finally {
    routeApplying = false;
  }
}

/** Primera pantalla: la de la dirección (#…) si se puede abrir; si no, Mis cursos. */
async function openStartRoute() {
  const route = parseRoute(location.hash);
  if (route.c || route.h) await applyRoute(route);
  else render();
  startRoutes();
}

/** A partir de aquí cada cambio de pantalla queda en el historial. */
function startRoutes() {
  routeReady = true;
  if (globalThis.history?.replaceState) history.replaceState({ route: routeNow() }, '', routeUrl(routeNow()));
}

// ---- Ventanas (formularios, menú «Más», vista previa) ----------------------------------------------

/**
 * Cierra una ventana y después ejecuta `then` (por ejemplo, ir a otra sección o abrir otra ventana).
 * Si la ventana tenía su entrada en el historial, `then` espera a que el historial termine de regresar:
 * así la nueva pantalla no queda detrás de la entrada de la ventana.
 */
function closeDialogThen(dialog, then) {
  const waits = Boolean(routeReady && dialog?.open && dialogStack.includes(dialog) && history.state?.dialog);
  if (dialog?.open) dialog.close();
  if (waits) afterBack = then || null;
  else then?.();
}

function dialogOpened(dialog) {
  if (dialogStack.includes(dialog)) return;
  dialogStack.push(dialog);
  dialog.dataset.changed = '';
  if (routeReady && globalThis.history?.pushState) history.pushState({ route: routeNow(), dialog: dialogStack.length }, '', location.href);
}

function dialogClosed(dialog) {
  const index = dialogStack.indexOf(dialog);
  if (index < 0) return;
  dialogStack.splice(index, 1);
  if (closedByBack.delete(dialog)) return; // la cerró el botón «Atrás»: su entrada ya salió del historial
  if (routeReady && history.state?.dialog) {
    pendingBack++;
    history.back();
  }
}

globalThis.addEventListener?.('popstate', async (event) => {
  // Antes de terminar de entrar (acceso, aviso de privacidad) el historial no cambia de pantalla.
  if (!routeReady) return;
  if (pendingBack) {
    // Regreso provocado al cerrar una ventana con su botón: no cambia de pantalla.
    pendingBack--;
    if (!pendingBack) {
      const next = afterBack;
      afterBack = null;
      if (syncAfterBack) {
        syncAfterBack = false;
        syncRoute();
      }
      next?.();
    }
    return;
  }
  const top = dialogStack.at(-1);
  if (top) {
    if (top.dataset.changed && !confirm('¿Cerrar sin guardar lo que escribiste?')) {
      history.pushState({ route: routeNow(), dialog: dialogStack.length }, '', location.href);
      return;
    }
    closedByBack.add(top);
    top.close();
    return;
  }
  const target = event.state?.route || parseRoute(location.hash);
  if (sameRoute(target, routeNow())) return;
  if (!canLeaveScreen()) {
    history.pushState({ route: routeNow() }, '', routeUrl(routeNow()));
    return;
  }
  await applyRoute(target);
});

if (typeof MutationObserver === 'function' && document.getElementById?.('main')) {
  // Cada vez que se dibuja otra pantalla en #main se actualiza la dirección.
  new MutationObserver(() => queueMicrotask(syncRoute)).observe(document.getElementById('main'), { childList: true });
  // Ventanas: al abrirse agregan una entrada al historial para que «Atrás» las cierre.
  new MutationObserver((changes) => {
    for (const change of changes) {
      const dialog = change.target;
      if (dialog.tagName !== 'DIALOG') continue;
      if (dialog.open) dialogOpened(dialog);
      else dialogClosed(dialog);
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  // Si se escribió algo en una ventana, «Atrás» pregunta antes de cerrarla.
  document.addEventListener('input', (event) => {
    const dialog = event.target.closest?.('dialog');
    if (dialog) dialog.dataset.changed = '1';
  });
}
