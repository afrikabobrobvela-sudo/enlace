/* Código para unirse a un curso (12.68; servidor en src/server/unirse.js).
 * - Docente: «Administración del curso → Código para unirse» (joinCodeModal): activa, cambia o quita el código y
 *   comparte el código, el enlace …/#unirse=CÓDIGO o su QR.
 * - Alumno: «Unirme a un curso» en Mis cursos, o el enlace (joinFromLink(), desde init(): también funciona después de
 *   iniciar sesión, porque el regreso conserva el #).
 * - 12.74: «Código QR para unirse» también está en el Listado de alumnos; con secciones, cada sección tiene su propio
 *   código (el selector del diálogo empieza en la sección filtrada) y quien se une con él queda en esa sección. */

const prettyJoinCode = (code) => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);
const joinLink = (code) => `${location.origin}/#unirse=${code}`;

/** Aviso para el alumno después de usar un código. */
function joinMessage(result) {
  const where = result.section ? ` (sección ${result.section})` : '';
  if (result.placed) return `Quedaste en la sección ${result.section} de «${result.name}».`;
  return result.already ? `Ya estabas en «${result.name}»${where}.` : `Te uniste a «${result.name}»${where}.`;
}

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
    toast(joinMessage(result));
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
      return joinMessage(result);
    },
    'Unirme',
  );
}

// ---- Docente ------------------------------------------------------------------------------------------

/** Texto de a dónde llega quien se une: el curso sin sección o la sección elegida. */
const joinTarget = (section) => (section ? `la sección ${sectionName(section)}` : courseSections().length ? 'el curso, sin sección (puedes asignarla después)' : 'el curso');

function joinCodeHtml(code, section = '') {
  if (!code)
    return `<p>Con un código, tus alumnos se inscriben solos: lo escriben en «Unirme a un curso», abren el enlace o escanean el QR. Quedan inscritos con el correo de su cuenta en ${esc(joinTarget(section))}.</p>
      <div class="action-row"><button type="button" class="primary" data-join-set="on">Activar código${section ? ' de la sección' : ''}</button></div>`;
  const link = joinLink(code);
  return `<div class="join-code-box" id="joinCodeShow">
      <div><p class="muted">Código${section ? ` · sección ${esc(sectionName(section))}` : ''}</p><p class="join-code">${esc(prettyJoinCode(code))}</p>
        <p class="muted">Enlace</p><p class="join-link"><a href="${esc(link)}">${esc(link)}</a></p>
        <div class="action-row"><button type="button" class="secondary" data-join-copy="${esc(link)}">Copiar enlace</button><button type="button" class="secondary" data-join-project>Proyectar</button></div></div>
      <div class="join-qr">${QR.svg(link, { label: 'Código QR para unirse' + (section ? ` a la sección ${sectionName(section)}` : ' al curso') })}</div>
    </div>
    <p class="muted">Quien se une con este código queda en ${esc(joinTarget(section))}. Cualquier persona con el código o el enlace puede inscribirse; si se compartió de más, cámbialo: el anterior deja de funcionar y los ya inscritos se quedan.</p>
    <div class="action-row"><button type="button" class="secondary" data-join-set="new">Cambiar código</button><button type="button" class="danger-link" data-join-set="off">Desactivar</button></div>`;
}

/** Sección con la que abre el diálogo: la que está filtrada si es solo una. */
function joinDefaultSection() {
  const chosen = selectedSections().filter((id) => id !== SECTION_NONE);
  return chosen.length === 1 && selectedSections().length === 1 ? chosen[0] : '';
}

async function joinCodeModal(section = joinDefaultSection()) {
  const course = current.course.id;
  const load = (id) => request(`/api/course/join-code?course=${encodeURIComponent(course)}${id ? `&section=${encodeURIComponent(id)}` : ''}`);
  const { code } = await load(section);
  const picker = courseSections().length
    ? `<label class="join-section">¿A qué sección se unen?<select id="joinSection">${[['', 'Todo el curso (sin sección)'], ...courseSections().map((x) => [x.id, x.name])]
        .map(([id, name]) => `<option value="${esc(id)}"${id === section ? ' selected' : ''}>${esc(name)}</option>`)
        .join('')}</select></label>`
    : '';
  modal('Código para unirse', `${picker}<div id="joinCodeBox">${joinCodeHtml(code, section)}</div>`, null);
  const box = document.querySelector('#joinCodeBox');
  document.querySelector('#joinSection')?.addEventListener('change', async (e) => {
    section = e.target.value;
    try {
      box.innerHTML = joinCodeHtml((await load(section)).code, section);
    } catch (error) {
      toast(error.message);
    }
  });
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
    if (e.target.closest('[data-join-project]')) {
      // Pantalla completa para el proyector del salón (Esc la cierra).
      document.querySelector('#joinCodeShow')?.requestFullscreen?.().catch(() => toast('Tu navegador no permitió la pantalla completa.'));
      return;
    }
    const set = e.target.closest('[data-join-set]')?.dataset.joinSet;
    if (!set) return;
    if (set === 'new' && !confirm('¿Cambiar el código? El anterior y su enlace dejarán de funcionar.')) return;
    try {
      const result = await request('/api/course/join-code', { course, section, enabled: set !== 'off', regenerate: set === 'new' });
      box.innerHTML = joinCodeHtml(result.code, section);
    } catch (error) {
      toast(error.message);
    }
  });
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-join-course]')) joinCourseModal();
  if (e.target.closest('[data-join-code]')) joinCodeModal().catch((error) => toast(error.message));
});
