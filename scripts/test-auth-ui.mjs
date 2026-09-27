// La pantalla de acceso aparece cuando no hay sesión, sin rutas de ChatGPT y sin ciclos de reintento.
import assert from 'node:assert/strict';
import { fakeBrowser } from './lib/fake-dom.mjs';

async function boot({ search = '', login }) {
  let calls = 0;
  const browser = fakeBrowser({
    search,
    fetch: async () => {
      calls++;
      return { ok: false, status: 401, json: async () => ({ error: 'Inicia sesión para continuar.', login }) };
    },
  });
  browser.load('richtext.js', 'trash.js', 'login.js', 'app.js');
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { ...browser, html: browser.elements.get('#main').innerHTML, calls: () => calls };
}

// Solo Google, regresando de un intento rechazado por dominio.
const google = await boot({ search: '?login_error=domain&curso=abc', login: { google: true, email: false } });
assert.match(google.html, /href="\/auth\/google\/start\?return_to=%2F%3Fcurso%3Dabc"/, 'Regresa a donde estaba, sin el código de error');
assert.match(google.html, />Continuar con Google</);
assert.match(google.html, /Entra con tu correo institucional de la BUAP\./);
assert.doesNotMatch(google.html, /chatgpt/i);
assert.doesNotMatch(google.html, /loginEmail/, 'Sin formulario de correo si no está configurado');
assert.equal(google.location.search, '?curso=abc', 'El código de error se retira de la barra de direcciones');
assert(google.classes.has('signed-out'), 'Se ocultan perfil y navegación');
assert.equal(google.calls(), 1, 'Una sola solicitud: sin ciclos de reintento');
assert.equal(google.elements.get('#logoutButton')?.hidden ?? true, true, 'Sin sesión no se muestra "Salir"');

// Google y enlace por correo.
const both = await boot({ login: { google: true, email: true } });
assert.match(both.html, /id="loginEmail"/);
assert.match(both.html, /O recibe un enlace de acceso en tu correo/);
assert.doesNotMatch(both.html, /login-alert/, 'Sin error, no hay aviso');

// Sin ningún método configurado: mensaje claro en lugar de un botón que no funciona.
const none = await boot({ login: { google: false, email: false } });
assert.match(none.html, /No hay un método de acceso configurado/);
assert.doesNotMatch(none.html, /auth\/google\/start/);

console.log('PASS: pantalla de acceso con Google/correo, errores legibles, regreso a la página previa y sin rutas de ChatGPT.');
