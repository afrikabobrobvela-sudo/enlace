/* Notificaciones en el celular y la computadora (12.72; servidor en src/server/push.js, avisos en sw.js).
 * - «Mi perfil» → «Notificaciones en este dispositivo»: activar, probar y desactivar.
 * - En «Mis cursos», una invitación (una vez por dispositivo, se puede cerrar) para activarlas.
 * - En iPhone/iPad solo funcionan con Enlace agregado a la pantalla de inicio: se explica cómo.
 * - Al abrir Enlace con las notificaciones ya permitidas, la suscripción se liga a la sesión actual (syncPush). */

const PUSH_INVITE_KEY = 'enlace-avisos-invitacion';

function isAppleMobile() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return Boolean(globalThis.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone);
}

/** 'ok' | 'ios-install' (iPhone sin agregar a inicio) | 'unsupported' | 'denied' */
function pushSupport() {
  const capable = Boolean(globalThis.isSecureContext && navigator.serviceWorker && globalThis.PushManager && globalThis.Notification);
  if (!capable) return isAppleMobile() && !isStandalone() ? 'ios-install' : 'unsupported';
  return Notification.permission === 'denied' ? 'denied' : 'ok';
}

function keyBytes(base64url) {
  const text = atob(base64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((base64url.length + 3) % 4));
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

async function pushRegistration() {
  if (!navigator.serviceWorker.controller) await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

async function currentPushSubscription() {
  if (pushSupport() !== 'ok') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

const sameKey = (sub, key) => {
  const mine = sub?.options?.applicationServerKey;
  if (!mine) return true; // el navegador no la expone: se confía en la suscripción
  const a = new Uint8Array(mine);
  const b = keyBytes(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

/** Activa las notificaciones en este navegador (pide permiso; debe llamarse desde un clic). */
async function enablePush() {
  if (pushSupport() !== 'ok') throw new Error('Este navegador no permite notificaciones.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Bloqueaste las notificaciones de Enlace. Permítelas en la configuración del navegador (el candado junto a la dirección).' : 'No se activaron las notificaciones.');
  const reg = await pushRegistration();
  const { publicKey } = await request('/api/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, publicKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await request('/api/push/subscribe', sub.toJSON());
  try {
    localStorage.setItem(PUSH_INVITE_KEY, 'listo');
  } catch {
    /* sin almacenamiento: la invitación puede volver a salir */
  }
  return sub;
}

async function disablePush() {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await request('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

/** Al entrar: si ya hay permiso y suscripción, se liga a esta sesión (o se renueva si cambió la llave). Silencioso. */
async function syncPush() {
  try {
    if (pushSupport() !== 'ok' || Notification.permission !== 'granted') return;
    const sub = await currentPushSubscription();
    if (!sub) return;
    const state = await request(`/api/push/key?endpoint=${encodeURIComponent(sub.endpoint)}`);
    if (state.subscribed && sameKey(sub, state.publicKey)) return;
    let fresh = sub;
    if (!sameKey(sub, state.publicKey)) {
      await sub.unsubscribe();
      fresh = await (await pushRegistration()).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(state.publicKey) });
    }
    await request('/api/push/subscribe', fresh.toJSON());
  } catch {
    /* sin conexión o sin permiso: se intenta la próxima vez */
  }
}

// ---- «Mi perfil» -----------------------------------------------------------------------------------------

function iosInstallSteps() {
  return `<ol class="push-steps"><li>Abre Enlace en <strong>Safari</strong>.</li><li>Toca <strong>Compartir</strong> (el cuadro con la flecha hacia arriba).</li>
    <li>Elige <strong>Agregar a pantalla de inicio</strong> y luego <strong>Agregar</strong>.</li><li>Abre Enlace desde el nuevo ícono y vuelve aquí para activarlas.</li></ol>`;
}

function pushProfileHtml() {
  return `<section class="push-profile" aria-labelledby="pushProfileTitle"><h3 id="pushProfileTitle">Notificaciones en este dispositivo</h3><div id="pushProfileBody"><p class="muted">Revisando…</p></div></section>`;
}

const PUSH_WHAT = () =>
  me?.role !== 'student'
    ? 'Mensajes de tus alumnos y entregas nuevas en tus cursos.'
    : 'Calificaciones publicadas, mensajes de tus docentes, noticias urgentes, pase de lista abierto, inasistencias y actividades que vencen mañana.';

async function fillPushProfile() {
  const box = document.querySelector('#pushProfileBody');
  if (!box) return;
  const support = pushSupport();
  if (support === 'ios-install') {
    box.innerHTML = `<p>En iPhone y iPad, las notificaciones funcionan con Enlace agregado a la pantalla de inicio:</p>${iosInstallSteps()}`;
    return;
  }
  if (support === 'unsupported') {
    box.innerHTML = '<p class="muted">Este navegador no permite notificaciones. Prueba con Chrome, Edge, Firefox o Safari actualizados.</p>';
    return;
  }
  if (support === 'denied') {
    box.innerHTML = '<p class="muted">Las notificaciones de Enlace están bloqueadas en este navegador. Para activarlas, permítelas en la configuración del sitio (el candado junto a la dirección) y vuelve a abrir esta ventana.</p>';
    return;
  }
  const sub = await currentPushSubscription().catch(() => null);
  let on = false;
  if (sub && Notification.permission === 'granted') {
    const state = await request(`/api/push/key?endpoint=${encodeURIComponent(sub.endpoint)}`).catch(() => null);
    on = Boolean(state?.subscribed);
  }
  box.innerHTML = on
    ? `<p class="push-state is-on">Activadas. Te llegan: ${esc(PUSH_WHAT().charAt(0).toLowerCase() + PUSH_WHAT().slice(1))}</p>
       <p class="action-row"><button type="button" class="secondary" data-push-test>Enviar una de prueba</button><button type="button" class="text-btn" data-push-off>Desactivar en este dispositivo</button></p>`
    : `<p>Recibe avisos aunque Enlace esté cerrado: ${esc(PUSH_WHAT().charAt(0).toLowerCase() + PUSH_WHAT().slice(1))}</p>
       <p><button type="button" class="primary" data-push-on>Activar notificaciones</button></p>
       <p class="muted">El aviso dice qué pasó y en qué curso; nunca muestra calificaciones ni el texto de los mensajes. Al cerrar sesión en este dispositivo dejan de llegar.</p>`;
}

// ---- Invitación en «Mis cursos» -------------------------------------------------------------------------

function showPushInvite() {
  const support = pushSupport();
  if (support !== 'ok' && support !== 'ios-install') return;
  if (support === 'ok' && Notification.permission !== 'default') return;
  try {
    if (localStorage.getItem(PUSH_INVITE_KEY)) return;
  } catch {
    return; // sin almacenamiento no se puede recordar «Ahora no»: mejor no insistir
  }
  const row = document.querySelector('#main .home-title-row');
  if (!row || document.querySelector('.push-invite')) return;
  const ios = support === 'ios-install';
  row.insertAdjacentHTML(
    'afterend',
    `<section class="push-invite" aria-labelledby="pushInviteTitle">
      <div><h2 id="pushInviteTitle">Recibe los avisos en tu ${ios ? 'iPhone' : 'dispositivo'}</h2>
      <p>${ios ? 'Agrega Enlace a tu pantalla de inicio: Compartir → «Agregar a pantalla de inicio». Después ábrelo desde el ícono y activa las notificaciones en «Mi perfil».' : esc(PUSH_WHAT())}</p></div>
      <div class="action-row">${ios ? '' : '<button type="button" class="primary" data-push-on>Activar</button>'}<button type="button" class="text-btn" data-push-later>${ios ? 'Entendido' : 'Ahora no'}</button></div>
    </section>`,
  );
}

function hidePushInvite(remember) {
  document.querySelector('.push-invite')?.remove();
  if (!remember) return;
  try {
    localStorage.setItem(PUSH_INVITE_KEY, 'cerrada');
  } catch {
    /* sin almacenamiento */
  }
}

document.addEventListener('click', async (event) => {
  const on = event.target.closest('[data-push-on]');
  const off = event.target.closest('[data-push-off]');
  const test = event.target.closest('[data-push-test]');
  const later = event.target.closest('[data-push-later]');
  if (later) return hidePushInvite(true);
  if (!on && !off && !test) return;
  const button = on || off || test;
  button.disabled = true;
  try {
    if (on) {
      await enablePush();
      hidePushInvite(false);
      toast('Notificaciones activadas en este dispositivo.');
    } else if (off) {
      await disablePush();
      toast('Ya no recibirás notificaciones en este dispositivo.');
    } else {
      const sub = await currentPushSubscription();
      await request('/api/push/test', { endpoint: sub?.endpoint || '' });
      toast('Enviada. Debe llegar en unos segundos.');
    }
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    fillPushProfile();
  }
});

// Clic en una notificación con Enlace abierto: sw.js manda la ruta y se abre esa pantalla sin recargar.
navigator.serviceWorker?.addEventListener?.('message', (event) => {
  if (event.data?.type !== 'enlace-open' || typeof applyRoute !== 'function' || !me) return;
  const route = parseRoute(event.data.hash || '');
  if (route.c || route.h) applyRoute(route).catch((error) => toast(error.message));
});
