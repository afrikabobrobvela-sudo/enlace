/* Código para unirse a un curso (12.68; servidor en src/server/unirse.js).
 * - Docente: «Administración del curso → Código para unirse» (joinCodeModal): activa, cambia o quita el código y
 *   comparte el código, el enlace …/#unirse=CÓDIGO o su QR.
 * - Alumno: «Unirme a un curso» en Mis cursos, o el enlace (joinFromLink(), desde init(): también funciona después de
 *   iniciar sesión, porque el regreso conserva el #). */

const prettyJoinCode = (code) => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);
const joinLink = (code) => `${location.origin}/#unirse=${code}`;

/** Inscribe con el código y deja la ruta lista para abrir el curso. */
async function joinWithCode(code) {
  const result = await request('/api/join', { code });
  courses = await request('/api/courses');
  return result;
}

/** Si la página se abrió con …/#unirse=CÓDIGO, inscribe y cambia la ruta al curso (openStartRoute() lo abre). */
async function joinFromLink() {
  const params = new URLSearchParams((location.hash || '').slice(1));
  const code = params.get('unirse');
  if (!code) return;
  try {
    const result = await joinWithCode(code);
    history.replaceState(null, '', `${location.pathname}${location.search}#c=${encodeURIComponent(result.course)}`);
    toast(result.already ? `Ya estabas en «${result.name}».` : `Te uniste a «${result.name}».`);
  } catch (error) {
    history.replaceState(null, '', location.pathname + location.search);
    toast(error.message);
  }
}

function joinCourseModal() {
  modal(
    'Unirme a un curso',
    `<label>Código del curso<input name="code" required autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="Por ejemplo, ABCD-2345"></label>
     <p class="muted">Tu docente te da el código o un enlace. Quedarás inscrito con tu cuenta (${esc(me.email)}).</p>`,
    async (form) => {
      const result = await joinWithCode(form.get('code'));
      await openCourse(result.course); // modal() recarga después el curso abierto
      return result.already ? `Ya estabas en «${result.name}».` : `Te uniste a «${result.name}».`;
    },
    'Unirme',
  );
}

// ---- Docente ------------------------------------------------------------------------------------------

function joinCodeHtml(code) {
  if (!code)
    return `<p>Con un código, tus alumnos se inscriben solos: lo escriben en «Unirme a un curso» o abren el enlace. Quedan inscritos con el correo de su cuenta y sin sección (puedes asignarla después).</p>
      <div class="action-row"><button type="button" class="primary" data-join-set="on">Activar código</button></div>`;
  const link = joinLink(code);
  return `<div class="join-code-box">
      <div><p class="muted">Código</p><p class="join-code">${esc(prettyJoinCode(code))}</p>
        <p class="muted">Enlace</p><p class="join-link"><a href="${esc(link)}">${esc(link)}</a></p>
        <div class="action-row"><button type="button" class="secondary" data-join-copy="${esc(link)}">Copiar enlace</button></div></div>
      <div class="join-qr">${QR.svg(link, { label: 'Código QR para unirse al curso' })}</div>
    </div>
    <p class="muted">Cualquier persona con el código o el enlace puede inscribirse. Si se compartió de más, cámbialo: el anterior deja de funcionar y los ya inscritos se quedan.</p>
    <div class="action-row"><button type="button" class="secondary" data-join-set="new">Cambiar código</button><button type="button" class="danger-link" data-join-set="off">Desactivar</button></div>`;
}

async function joinCodeModal() {
  const course = current.course.id;
  const { code } = await request(`/api/course/join-code?course=${encodeURIComponent(course)}`);
  modal('Código para unirse', `<div id="joinCodeBox">${joinCodeHtml(code)}</div>`, null);
  const box = document.querySelector('#joinCodeBox');
  box.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-join-copy]');
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.joinCopy);
        toast('Enlace copiado.');
      } catch {
        toast('No se pudo copiar; selecciona el enlace y cópialo.');
      }
      return;
    }
    const set = e.target.closest('[data-join-set]')?.dataset.joinSet;
    if (!set) return;
    if (set === 'new' && !confirm('¿Cambiar el código? El anterior y su enlace dejarán de funcionar.')) return;
    try {
      const result = await request('/api/course/join-code', { course, enabled: set !== 'off', regenerate: set === 'new' });
      box.innerHTML = joinCodeHtml(result.code);
    } catch (error) {
      toast(error.message);
    }
  });
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-join-course]')) joinCourseModal();
  if (e.target.closest('[data-join-code]')) joinCodeModal().catch((error) => toast(error.message));
});
