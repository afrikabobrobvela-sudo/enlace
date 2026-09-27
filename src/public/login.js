/* Pantalla de acceso. Se muestra cuando la API responde 401 (no hay sesión válida). */

const LOGIN_ERRORS = {
  cancelled: 'Cancelaste el inicio de sesión. Puedes intentarlo de nuevo.',
  expired: 'El intento de inicio de sesión expiró. Vuelve a intentarlo.',
  google: 'Google no confirmó tu identidad. Vuelve a intentarlo.',
  unverified: 'Tu cuenta de Google no tiene el correo verificado. Verifícalo en Google y vuelve a intentarlo.',
  domain: 'Entra con tu correo institucional de la BUAP.',
  link: 'Ese enlace ya se usó o venció. Pide uno nuevo.',
  google_disabled: 'El acceso con Google todavía no está configurado en este servidor. Avisa a la coordinación.',
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
  return loc ? loc.pathname + loc.search : '/';
}

function renderLogin(methods = { google: true, email: false }) {
  document.body.classList.add('signed-out');
  const error = currentLoginError();
  const returnTo = encodeURIComponent(currentReturnPath());
  const google = methods.google
    ? `<a class="primary login-google" href="/auth/google/start?return_to=${returnTo}">Continuar con Google</a>`
    : '';
  const email = methods.email
    ? `<form class="login-email" id="loginEmail" novalidate>
         <label for="loginEmailInput">${methods.google ? 'O recibe un enlace de acceso en tu correo' : 'Recibe un enlace de acceso en tu correo'}</label>
         <div class="login-email-row">
           <input id="loginEmailInput" name="email" type="email" autocomplete="email" required placeholder="nombre@alumno.buap.mx">
           <button type="submit" class="secondary">Enviar enlace</button>
         </div>
         <p class="login-note" id="loginEmailStatus" role="status"></p>
       </form>`
    : '';
  const unavailable =
    !methods.google && !methods.email
      ? '<p class="login-alert">No hay un método de acceso configurado en este servidor. Avisa a la coordinación.</p>'
      : '';
  $('#main').innerHTML = `
    <div class="login-layout">
    <div class="login-brand">
      <div>
        <svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="10" fill="#ffffff" fill-opacity=".14"/><ellipse cx="20" cy="20" rx="14" ry="5.5" fill="none" stroke="#7fe3f0" stroke-width="2" transform="rotate(-30 20 20)"/><ellipse cx="20" cy="20" rx="14" ry="5.5" fill="none" stroke="#ffffff" stroke-width="2" transform="rotate(30 20 20)"/><circle cx="20" cy="20" r="3.4" fill="#7fe3f0"/></svg>
        <h2>Tu aula virtual</h2>
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
      ${google}
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
