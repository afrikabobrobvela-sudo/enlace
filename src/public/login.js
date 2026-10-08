/* Pantalla de acceso. Se muestra cuando la API responde 401 (no hay sesión válida). */

const LOGIN_ERRORS = {
  cancelled: 'Cancelaste el inicio de sesión. Puedes intentarlo de nuevo.',
  expired: 'El intento de inicio de sesión expiró. Vuelve a intentarlo.',
  google: 'Google no confirmó tu identidad. Vuelve a intentarlo.',
  unverified: 'Tu cuenta de Google no tiene el correo verificado. Verifícalo en Google y vuelve a intentarlo.',
  domain: 'Entra con tu correo institucional de la BUAP.',
  link: 'Ese enlace ya se usó o venció. Pide uno nuevo.',
  google_disabled: 'El acceso con Google todavía no está configurado en este servidor. Avisa a la coordinación.',
  microsoft: 'Microsoft no confirmó tu identidad. Entra con tu cuenta institucional y vuelve a intentarlo.',
  server: 'No se pudo completar el acceso por un error del servidor. Vuelve a intentarlo en un momento; si continúa, avisa a la administración.',
  suspended: 'Tu acceso a Enlace está suspendido. Si crees que es un error, comunícate con la administración de tu academia.',
  microsoft_disabled: 'El acceso con Microsoft todavía no está configurado en este servidor. Avisa a la coordinación.',
};

function currentLoginError() {
  const params = new URLSearchParams(globalThis.location?.search || '');
  const code = params.get('login_error');
  if (code && globalThis.history?.replaceState) {
    params.delete('login_error');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : ''));
  }
  return LOGIN_ERRORS[code] || '';
}

function currentReturnPath() {
  const loc = globalThis.location;
  // Con la pantalla (#c=…&s=quiz&d=…): así, al entrar desde Safe Exam Browser (12.28) o desde un enlace a una
  // evaluación, se regresa a esa pantalla y no al inicio.
  const path = loc ? loc.pathname + loc.search + (loc.hash || '') : '/';
  return path.length < 500 ? path : loc.pathname;
}

function renderLogin(methods = { google: true, email: false }) {
  document.body.classList.add('signed-out');
  const error = currentLoginError();
  const returnTo = encodeURIComponent(currentReturnPath());
  // Microsoft primero: es la cuenta institucional (correo BUAP en Microsoft 365).
  const microsoft = methods.microsoft
    ? `<a class="primary login-microsoft" href="/auth/microsoft/start?return_to=${returnTo}"><svg viewBox="0 0 21 21" aria-hidden="true" width="18" height="18"><rect width="10" height="10" fill="#f25022"/><rect x="11" width="10" height="10" fill="#7fba00"/><rect y="11" width="10" height="10" fill="#00a4ef"/><rect x="11" y="11" width="10" height="10" fill="#ffb900"/></svg>Continuar con Microsoft (correo BUAP)</a>`
    : '';
  // Con Microsoft activo, la pantalla solo ofrece el correo institucional. Google sigue funcionando para quien
  // lo necesite (por ejemplo, la cuenta de administración con Gmail) entrando por /?acceso=google.
  const googleOnRequest = new URLSearchParams(globalThis.location?.search || '').get('acceso') === 'google';
  const google = methods.google && (!methods.microsoft || googleOnRequest)
    ? `<a class="${methods.microsoft ? 'secondary' : 'primary'} login-google" href="/auth/google/start?return_to=${returnTo}">Continuar con Google</a>`
    : '';
  const email = methods.email
    ? `<form class="login-email" id="loginEmail" novalidate>
         <label for="loginEmailInput">${google || microsoft ? 'O recibe un enlace de acceso en tu correo' : 'Recibe un enlace de acceso en tu correo'}</label>
         <div class="login-email-row">
           <input id="loginEmailInput" name="email" type="email" autocomplete="email" required placeholder="nombre@alumno.buap.mx">
           <button type="submit" class="secondary">Enviar enlace</button>
         </div>
         <p class="login-note" id="loginEmailStatus" role="status"></p>
       </form>`
    : '';
  const unavailable =
    !methods.google && !methods.microsoft && !methods.email
      ? '<p class="login-alert">No hay un método de acceso configurado en este servidor. Avisa a la coordinación.</p>'
      : '';
  $('#main').innerHTML = `
    <div class="login-layout">
    <div class="login-brand">
      <div>
        <div class="login-brand-title">
          <img class="login-brand-icon" src="/icons/enlace_icon_light.png" alt="Enlace" width="1024" height="1024">
          <h2>Tu aula virtual</h2>
        </div>
        <p>Para docentes y alumnos de cualquier academia: materiales, actividades, calificaciones y asistencia en un solo lugar.</p>
      </div>
      <ul>
        <li>Materiales, fórmulas e imágenes en cada unidad</li>
        <li>Entregas desde tu celular</li>
        <li>Calificaciones y asistencia al día</li>
      </ul>
    </div>
    <section class="login-panel" aria-labelledby="loginTitle">
      <h1 id="loginTitle">Entra a tu aula</h1>
      <p class="login-lead">Usa el mismo correo con el que tu docente te inscribió. Si eres docente, usa el correo que registró la coordinación.</p>
      ${error ? `<p class="login-alert" role="alert">${esc(error)}</p>` : ''}
      ${unavailable}
      <div class="login-buttons">${microsoft}${google}</div>
      ${email}
      <p class="login-note">Enlace no guarda contraseñas. Al terminar, regresarás a la página donde estabas.</p>
    </section>
    </div>`;

  const form = $('#loginEmail');
  if (form && form.addEventListener) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = $('#loginEmailStatus');
      const button = form.querySelector('button');
      button.disabled = true;
      status.textContent = 'Enviando…';
      try {
        await request('/auth/email/start', { email: form.email.value, return_to: currentReturnPath() });
        status.textContent = 'Revisa tu correo: te enviamos un enlace que vence en 20 minutos.';
      } catch (e) {
        status.textContent = e.message;
      } finally {
        button.disabled = false;
      }
    });
  }
}
