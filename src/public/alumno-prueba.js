/* Alumno de prueba (12.92).
 * Quien enseña entra a su curso con una cuenta de alumno de verdad (la del curso, sin correo real) para contestar
 * evaluaciones y exámenes y entregar actividades exactamente como sus alumnos: se guarda, se bloquea al salir y sale
 * en el monitor. La «Vista de alumno» sigue sirviendo para mirar sin guardar nada.
 * - testStudentModal(): entrar aquí (vuelve con «Volver a mi cuenta») o en otro dispositivo (enlace de un solo uso
 *   y QR, para probar en el teléfono mientras se ve el monitor en la computadora); borrar lo que hizo o quitarlo.
 * - renderTestStudentBar(): la barra que se ve mientras se usa la cuenta de prueba. */

/** Como request(), pero también en la vista de alumno (que bloquea las escrituras de la API). */
async function testStudentCall(path, data) {
  const r = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Aula-Request': '1' },
    body: JSON.stringify(data),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(b.error || 'No se pudo completar la operación.'), { status: r.status });
  return b;
}

/** Abre el curso desde cero (la sesión cambió: se vuelven a pedir /api/me y los cursos). */
function reopenCourse(course) {
  history.replaceState(null, '', course ? '/#c=' + encodeURIComponent(course) : '/');
  location.reload();
}

function testStudentSummary(state) {
  if (!state.enrolled) return 'Todavía no se ha usado en este curso.';
  const parts = [];
  if (state.attempts) parts.push(`${state.attempts} ${state.attempts === 1 ? 'intento enviado' : 'intentos enviados'}`);
  if (state.running) parts.push(`${state.running} ${state.running === 1 ? 'intento en curso' : 'intentos en curso'}`);
  if (state.submissions) parts.push(`${state.submissions} ${state.submissions === 1 ? 'entrega' : 'entregas'}`);
  return parts.length ? `Tiene ${parts.join(', ')}.` : 'Está inscrito, sin intentos ni entregas.';
}

async function testStudentModal() {
  if (!current?.course) return;
  const course = current.course;
  if (course.archived_at) return toast('Este curso está archivado: ya no se contestan evaluaciones ni se entregan actividades.');
  let state = { enrolled: false, section: '', attempts: 0, running: 0, submissions: 0 };
  try {
    state = await request('/api/test-student?course=' + encodeURIComponent(course.id));
  } catch (e) {
    return toast(e.message);
  }
  const sections = typeof courseSections === 'function' ? courseSections() : [];
  const filtered = typeof selectedSections === 'function' ? selectedSections().filter((id) => sections.some((s) => s.id === id)) : [];
  const chosen = state.enrolled ? state.section : filtered.length === 1 ? filtered[0] : '';
  const sectionField = sections.length
    ? `<label>Sección del alumno de prueba<select name="section"><option value="">Sin sección</option>${sections
        .map((s) => `<option value="${esc(s.id)}" ${s.id === chosen ? 'selected' : ''}>${esc(s.name)}</option>`)
        .join('')}</select><small class="muted">Ve las fechas, los códigos y el contenido de esa sección.</small></label>`
    : '';
  modal(
    'Probar como alumno',
    `<p>Entra al curso con el <strong>alumno de prueba</strong>: una cuenta de alumno de este curso que solo usan quienes lo imparten. Contestas evaluaciones y exámenes y entregas actividades <strong>exactamente como tus alumnos</strong>: lo que hagas se guarda, el examen se bloquea si sales y aparece en tu monitor.</p>
     ${sectionField}
     <ul class="test-student-notes">
       <li>Solo ve lo que ya está publicado para su sección. Para probar una evaluación oculta, dale <strong>acceso especial</strong> o publícala.</li>
       <li>Sale en tu lista y en el libro como «Alumno de prueba». Cuando termines, puedes borrar lo que hizo o quitarlo del curso.</li>
     </ul>
     <div class="test-student-state"><p id="testStudentState">${esc(testStudentSummary(state))}</p>
       ${state.enrolled ? `<div class="action-row"><button type="button" class="secondary" data-test-reset>Borrar lo que hizo</button><button type="button" class="text-btn danger-link" data-test-remove>Quitarlo del curso</button></div>` : ''}</div>
     <div class="test-student-other"><button type="button" class="secondary" data-test-other>Abrir en otro dispositivo</button>
       <div id="testStudentLink" hidden></div></div>
     <p class="muted">Para regresar a tu cuenta de docente, usa «Volver a mi cuenta» en la barra amarilla de arriba.</p>`,
    async (form) => {
      const r = await testStudentCall('/auth/prueba/entrar', { course: course.id, section: form.get('section') || '', device: 'here' });
      reopenCourse(r.course);
      await new Promise(() => {}); // la página se vuelve a cargar con la sesión del alumno de prueba
    },
    'Entrar aquí como alumno',
  );
  const sectionOf = () => $('#fields select[name=section]')?.value || '';
  const other = $('#fields [data-test-other]');
  other.onclick = async () => {
    other.disabled = true;
    try {
      const r = await testStudentCall('/auth/prueba/entrar', { course: course.id, section: sectionOf(), device: 'other' });
      const box = $('#testStudentLink');
      box.hidden = false;
      box.innerHTML = `<p>Abre este enlace en el otro dispositivo (o escanea el código). Sirve <strong>una sola vez</strong> y vence en ${r.minutes} minutos; no dejes que lo vean tus alumnos.</p>
        ${typeof QR === 'object' ? `<div class="test-student-qr">${QR.svg(r.url, { label: 'Código QR para entrar como alumno de prueba' })}</div>` : ''}
        <div class="test-student-url"><input readonly value="${esc(r.url)}" aria-label="Enlace para entrar como alumno de prueba"><button type="button" class="secondary" data-test-copy>Copiar</button></div>`;
      box.querySelector('[data-test-copy]').onclick = async () => {
        try {
          await navigator.clipboard.writeText(r.url);
          toast('Enlace copiado.');
        } catch {
          box.querySelector('input').select();
        }
      };
      other.textContent = 'Generar otro enlace';
    } catch (e) {
      $('#formError').textContent = e.message;
    } finally {
      other.disabled = false;
    }
  };
  for (const [selector, remove] of [['[data-test-reset]', false], ['[data-test-remove]', true]]) {
    const b = $('#fields ' + selector);
    if (!b) continue;
    b.onclick = async () => {
      const question = remove
        ? '¿Quitar al alumno de prueba del curso? Se borran sus intentos, entregas, asistencia y mensajes, y se cierra su sesión en cualquier dispositivo. Puedes volver a usarlo cuando quieras.'
        : '¿Borrar lo que hizo el alumno de prueba? Se borran sus intentos, entregas, asistencia y mensajes para que puedas volver a probar desde cero.';
      if (!confirm(question)) return;
      b.disabled = true;
      try {
        const r = await testStudentCall('/api/test-student/reset', { course: course.id, remove });
        $('#modal').close();
        await reload();
        toast(remove ? 'Se quitó al alumno de prueba del curso.' : `Listo: se borraron ${r.attempts} ${r.attempts === 1 ? 'intento' : 'intentos'} y ${r.submissions} ${r.submissions === 1 ? 'entrega' : 'entregas'}.`);
      } catch (e) {
        $('#formError').textContent = e.message;
        b.disabled = false;
      }
    };
  }
}

/** Aviso en una evaluación vista desde la «Vista de alumno», donde nada se guarda. */
function testStudentHintHtml() {
  if (!previewAsStudent || !current?.canPreview || current.course?.archived_at) return '';
  return `<div class="test-student-hint"><p><strong>Aquí no se guarda nada.</strong> Para contestarla como un alumno de verdad (con bloqueo, monitor y calificación), entra como alumno de prueba.</p><button type="button" class="primary" data-action="test-student">Probar como alumno</button></div>`;
}

/** Barra fija mientras la sesión es la del alumno de prueba (oculta durante el examen, como la ven los alumnos). */
function renderTestStudentBar() {
  const info = me?.testStudent;
  let bar = $('#testStudentBar');
  if (!info) return bar?.remove();
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'testStudentBar';
    bar.className = 'test-student-bar';
    bar.setAttribute('role', 'status');
    document.querySelector('.shell')?.prepend(bar);
  }
  bar.innerHTML = `<span><strong>Alumno de prueba.</strong> Ves y haces todo como un alumno de este curso; lo que hagas se guarda.</span>
    <button type="button" class="secondary" data-test-return>${info.canReturn ? 'Volver a mi cuenta' : 'Salir'}</button>`;
  bar.querySelector('[data-test-return]').onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await testStudentCall('/auth/prueba/volver', {});
      reopenCourse(r.relogin ? null : r.course);
    } catch (error) {
      e.currentTarget.disabled = false;
      toast(error.message);
    }
  };
}
