/* Secciones de un curso (por ejemplo 5AV, 5BV y 5CV de Física I): un solo curso con el mismo contenido y, para quien
 * enseña, un filtro por sección en alumnos, calificaciones, entregas, asistencia, progreso y exámenes. También las
 * fechas por sección de actividades y evaluaciones. Todo se valida en el servidor (sections.js). */

const courseSections = () => current?.sections || [];
const sectionName = (id) => courseSections().find((s) => s.id === id)?.name || '';
const SECTION_NONE = 'none';

function sectionStorageKey() {
  return 'enlace-seccion-' + (current?.course?.id || '');
}

/**
 * Secciones elegidas en el filtro (varias a la vez, como en Brightspace): [] = todas; 'none' = alumnos sin sección.
 * Se recuerdan por curso en este navegador.
 */
function selectedSections() {
  if (!current || !teaches() || !courseSections().length) return [];
  let value = [];
  try {
    const raw = localStorage.getItem(sectionStorageKey()) || '[]';
    value = raw.startsWith('[') ? JSON.parse(raw) : [raw]; // versiones anteriores guardaban una sola
  } catch {
    value = [];
  }
  const valid = new Set([SECTION_NONE, ...courseSections().map((x) => x.id)]);
  return (Array.isArray(value) ? value : []).filter((id) => valid.has(id));
}

/** La sección elegida si es exactamente una (para proponerla al crear una clase o inscribir), si no ''. */
function selectedSection() {
  const chosen = selectedSections();
  return chosen.length === 1 && chosen[0] !== SECTION_NONE ? chosen[0] : '';
}

function setSelectedSections(list) {
  try {
    if (list.length) localStorage.setItem(sectionStorageKey(), JSON.stringify(list));
    else localStorage.removeItem(sectionStorageKey());
  } catch {
    // Sin almacenamiento (ventana privada): el filtro dura hasta recargar.
  }
}

/** ¿Este alumno está en alguna de las secciones elegidas? */
function inSelectedSection(member) {
  const chosen = selectedSections();
  if (!chosen.length) return true;
  return chosen.includes(member?.section || SECTION_NONE);
}

/** Alumnos que se ven con el filtro de sección actual (para quien enseña). */
function studentsInView() {
  return current.members.filter((m) => m.role === 'student' && inSelectedSection(m));
}

/** ¿La clase es para este alumno? (las de todo el curso son para todos). */
const sessionApplies = (session, member) => !session.section || session.section === member?.section;

/** Clases que se ven con el filtro de sección: las de las secciones elegidas y las de todo el curso. */
function sessionsInView(sessions) {
  const chosen = selectedSections();
  if (!chosen.length) return sessions;
  return sessions.filter((s) => !s.section || chosen.includes(s.section));
}

/** ¿Un elemento (actividad, evaluación…) va dirigido a la sección de este alumno? Vacío = a todas. */
const itemApplies = (record, member) =>
  (!record?.data?.sections?.length || record.data.sections.includes(member?.section)) &&
  // «Solo con acceso especial»: quien enseña ve a todos y cuenta solo a quienes lo tienen (al alumno ya le llega filtrado).
  (!record?.data?.specialOnly || !teaches() || (typeof hasSpecialAccess === 'function' && hasSpecialAccess(record, member)));

// Equipos por sección (12.63): un equipo es de una sola sección.

/** Sección del equipo: la guardada o, en equipos anteriores, la de su primer integrante ('' = sin sección). */
function groupSection(group) {
  if (typeof group?.data?.section === 'string') return group.data.section;
  const first = current.members.find((m) => group?.data?.members?.includes(m.id) && m.role === 'student');
  return first?.section || '';
}

/** ¿Un equipo anterior junta alumnos de varias secciones? */
function groupMixesSections(group) {
  const sections = new Set(current.members.filter((m) => m.role === 'student' && group.data.members.includes(m.id)).map((m) => m.section || ''));
  return courseSections().length > 0 && sections.size > 1;
}

/** ¿El equipo se ve con el filtro de secciones? */
function groupInView(group) {
  const chosen = selectedSections();
  return !chosen.length || chosen.includes(groupSection(group) || SECTION_NONE);
}

/** Filtro de secciones para las pantallas de quien enseña (nada si el curso no tiene secciones). */
function sectionFilterHtml() {
  if (!teaches() || !courseSections().length) return '';
  const chosen = selectedSections();
  const students = current.members.filter((m) => m.role === 'student');
  const count = (id) => students.filter((m) => (id === SECTION_NONE ? !m.section : m.section === id)).length;
  const options = [...courseSections().map((x) => [x.id, x.name]), ...(count(SECTION_NONE) ? [[SECTION_NONE, 'Sin sección']] : [])];
  const label = !chosen.length ? 'Todas' : chosen.length === 1 ? (chosen[0] === SECTION_NONE ? 'Sin sección' : sectionName(chosen[0])) : `${chosen.length} secciones`;
  return `<details class="section-filter" data-section-picker>
    <summary><span class="muted">Secciones:</span> <b>${esc(label)}</b>${chosen.length ? ` <span class="badge-count">${chosen.length}</span>` : ''}</summary>
    <div class="section-filter-panel" role="group" aria-label="Filtrar por secciones">
      <div class="section-filter-top"><button type="button" class="secondary" data-section-clear>Borrar</button>
        <input type="search" data-section-search placeholder="Buscar…" aria-label="Buscar sección"></div>
      <p class="muted">${chosen.length ? `${chosen.length} ${chosen.length === 1 ? 'seleccionada' : 'seleccionadas'}` : `Todas las secciones (${students.length} alumnos)`}</p>
      <ul>${options
        .map(([id, name]) => `<li data-section-option="${esc(name.toLowerCase())}"><label class="check-label"><input type="checkbox" value="${esc(id)}" ${chosen.includes(id) ? 'checked' : ''}> ${esc(name)} <span class="muted">(${count(id)})</span></label></li>`)
        .join('')}</ul>
      <button type="button" class="primary" data-section-apply>Aplicar</button>
    </div></details>`;
}

document.addEventListener('click', (e) => {
  const picker = e.target.closest('[data-section-picker]');
  if (!picker) return;
  if (e.target.closest('[data-section-clear]')) {
    setSelectedSections([]);
    return render();
  }
  if (e.target.closest('[data-section-apply]')) {
    setSelectedSections([...picker.querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value));
    render();
  }
});
document.addEventListener('input', (e) => {
  if (!e.target.matches('[data-section-search]')) return;
  const term = e.target.value.trim().toLowerCase();
  e.target.closest('[data-section-picker]').querySelectorAll('[data-section-option]').forEach((li) => (li.hidden = Boolean(term) && !li.dataset.sectionOption.includes(term)));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('[data-section-search]')) e.preventDefault();
});

/** Fechas de un elemento para la sección de un alumno (quien enseña recibe todas en `current.sectionDates`). */
function sectionDateOf(itemId, memberId) {
  const member = current.members.find((m) => m.id === memberId);
  if (!member?.section) return null;
  return (current.sectionDates || []).find((d) => d.item === itemId && d.section === member.section) || null;
}

// ---- Administrar secciones (desde el listado de alumnos) ----------------------------------------------

function sectionsModal() {
  const sections = courseSections();
  const count = (id) => current.members.filter((m) => m.role === 'student' && m.section === id).length;
  modal(
    'Secciones del curso',
    `<p class="muted">Un solo curso para varios grupos (por ejemplo 5AV, 5BV y 5CV): el contenido, las actividades y los exámenes son los mismos, y en cada pantalla filtras por sección. Cada sección puede tener sus propias fechas de entrega y de examen, y sus clases en la asistencia.</p>
      ${
        sections.length
          ? `<div class="section-rows">${sections
              .map(
                (s) => `<div class="section-row"><label>Nombre<input name="name_${esc(s.id)}" value="${esc(s.name)}" maxlength="40" required></label>
                  <span class="muted">${count(s.id)} ${count(s.id) === 1 ? 'alumno' : 'alumnos'}</span>
                  <button type="button" class="danger-link" data-section-delete="${esc(s.id)}">Eliminar</button></div>`,
              )
              .join('')}</div>`
          : '<p>Este curso todavía no tiene secciones.</p>'
      }
      <label>Nueva sección (opcional)<input name="newSection" maxlength="200" placeholder="Por ejemplo: 5AV, 5BV, 5CV"></label>
      <p class="muted">Puedes escribir varias separadas por comas. Después, en el listado, elige la sección de cada alumno, o importa la lista con una columna «Sección».</p>
      <p><button type="button" class="secondary" data-section-merge>Traer alumnos de otro curso como sección…</button></p>`,
    async (f) => {
      for (const s of sections) {
        const name = String(f.get('name_' + s.id) || '').trim();
        if (name && name !== s.name) await request('/api/sections/update', { course: current.course.id, id: s.id, name });
      }
      const names = String(f.get('newSection') || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      for (const name of names) await request('/api/sections', { course: current.course.id, name });
      return names.length ? `Se crearon ${names.length} ${names.length === 1 ? 'sección' : 'secciones'}.` : 'Secciones guardadas.';
    },
  );
}

async function mergeCourseModal() {
  const list = (await request('/api/courses')).filter((c) => c.id !== current.course.id && c.canTeach && !c.archived_at);
  modal(
    'Traer alumnos de otro curso',
    `<p>Si habías creado un curso aparte para cada grupo (por ejemplo «Física I · 5CV»), aquí traes su lista de alumnos a este curso como una sección.</p>
      <label>Curso<select name="from" required><option value="">Elige un curso…</option>${list
        .map((c) => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.group_name || '')}</option>`)
        .join('')}</select></label>
      <label>Sección<select name="section"><option value="">Nueva, con el nombre del grupo del otro curso</option>${courseSections()
        .map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`)
        .join('')}</select></label>
      <p class="pending-message">Solo se copia la lista. Las entregas, calificaciones y asistencia de ese curso se quedan en él (puedes archivarlo después para conservarlas).</p>`,
    async (f) => {
      if (!f.get('from')) throw new Error('Elige el curso.');
      const r = await request('/api/sections/import', { course: current.course.id, from: f.get('from'), section: f.get('section') || '' });
      return `Se agregaron ${r.imported} ${r.imported === 1 ? 'alumno' : 'alumnos'} a la sección ${sectionName(r.section) || 'nueva'}.`;
    },
    'Traer alumnos',
  );
}

document.addEventListener('click', async (e) => {
  try {
    const del = e.target.closest('[data-section-delete]');
    if (del) {
      if (!confirm(`¿Eliminar la sección ${sectionName(del.dataset.sectionDelete)}? Solo se puede si no tiene alumnos ni clases.`)) return;
      await request('/api/sections/delete', { course: current.course.id, id: del.dataset.sectionDelete });
      await reload();
      toast('Sección eliminada.');
      return sectionsModal();
    }
    if (e.target.closest('[data-section-merge]')) return await mergeCourseModal();
  } catch (error) {
    toast(error.message);
  }
});

// Cambiar la sección de un alumno desde el listado.
document.addEventListener('change', async (e) => {
  if (!e.target.matches('[data-member-section]')) return;
  const select = e.target;
  select.disabled = true;
  try {
    await request('/api/sections/assign', { course: current.course.id, section: select.value, members: [select.dataset.memberSection] });
    const member = current.members.find((m) => m.id === select.dataset.memberSection);
    if (member) member.section = select.value;
    toast(select.value ? `Pasó a la sección ${sectionName(select.value)}.` : 'Quedó sin sección.');
  } catch (error) {
    toast(error.message);
  } finally {
    select.disabled = false;
  }
});

/** Selector de sección de un alumno en el listado (quien enseña). */
function memberSectionSelect(m) {
  return `<select data-member-section="${esc(m.id)}" aria-label="Sección de ${esc(m.name)}"><option value="">Sin sección</option>${courseSections()
    .map((s) => `<option value="${esc(s.id)}" ${m.section === s.id ? 'selected' : ''}>${esc(s.name)}</option>`)
    .join('')}</select>`;
}

// ---- Fechas por sección en los editores de actividades y evaluaciones ----------------------------------

/**
 * Campos de fechas por sección. `kind` 'task': inicio, vencimiento y cierre; 'quiz': se abre y se cierra.
 * Vacío = la fecha general del elemento.
 */
function sectionDatesHtml(itemId, kind) {
  if (!courseSections().length) return '';
  const dates = (current.sectionDates || []).filter((d) => d.item === itemId);
  const rows = courseSections()
    .map((s) => {
      const d = dates.find((x) => x.section === s.id) || {};
      const input = (name, label, value) => `<label>${label}<input type="datetime-local" name="sd_${name}_${esc(s.id)}" value="${esc(localDate(value))}"></label>`;
      return `<div class="section-dates-row"><strong>${esc(s.name)}</strong>${
        kind === 'task'
          ? input('start', 'Disponible desde', d.start_at) + input('due', 'Vence', d.due) + input('end', 'Cierra', d.end_at)
          : input('start', 'Se abre', d.start_at) + input('end', 'Se cierra', d.end_at)
      }</div>`;
    })
    .join('');
  const open = dates.length ? 'open' : '';
  return `<details class="quiz-settings section-dates" ${open}><summary>Fechas por sección${dates.length ? ` (${dates.length})` : ''}</summary>
    <p class="muted">${kind === 'task' ? 'Si cada grupo entrega en otra fecha, ponla aquí. Lo vacío usa la fecha general. Una prórroga individual sigue mandando.' : 'Si cada grupo presenta a otra hora, pon aquí su horario. Lo vacío usa las fechas generales de arriba. Pon «Mostrar resultados a partir de» después de que termine el último grupo.'}</p>
    ${rows}</details>`;
}

function readSectionDates(f) {
  return courseSections().map((s) => ({
    section: s.id,
    startAt: iso(f.get('sd_start_' + s.id)),
    due: iso(f.get('sd_due_' + s.id)),
    endAt: iso(f.get('sd_end_' + s.id)),
    code: String(f.get('sd_code_' + s.id) || '').trim(),
  }));
}

// ---- Evaluaciones: qué secciones la presentan, a qué hora y con qué código (un solo bloque en el editor) ----------

/** Bloque «Secciones y horarios» del editor de evaluaciones. Nada si el curso no tiene secciones. */
function quizSectionsHtml(old) {
  if (!courseSections().length) return '';
  const chosen = old?.data.sections || [];
  const dates = (current.sectionDates || []).filter((d) => d.item === old?.id);
  const rows = courseSections()
    .map((s) => {
      const d = dates.find((x) => x.section === s.id) || {};
      const on = !chosen.length || chosen.includes(s.id);
      return `<div class="quiz-section-row" data-quiz-section-row ${on ? '' : 'data-off'}>
        <label class="check-label quiz-section-name"><input type="checkbox" name="quizSection" value="${esc(s.id)}" ${on ? 'checked' : ''}> ${esc(s.name)}</label>
        <label>Se abre<input type="datetime-local" name="sd_start_${esc(s.id)}" value="${esc(localDate(d.start_at))}"></label>
        <label>Se cierra<input type="datetime-local" name="sd_end_${esc(s.id)}" value="${esc(localDate(d.end_at))}"></label>
        <label>Código para empezar<span class="quiz-code-input"><input name="sd_code_${esc(s.id)}" value="${esc(d.code || '')}" maxlength="30" autocomplete="off" placeholder="Opcional"><button type="button" class="text-btn" data-code-generate="${esc(s.id)}">Generar</button></span></label>
      </div>`;
    })
    .join('');
  return `<fieldset class="quiz-settings quiz-sections"><legend>Secciones y horarios</legend>
    <p class="muted">Marca las secciones que presentan esta evaluación; las demás no la ven ni les cuenta en la calificación. Si cada sección presenta a otra hora, pon su horario (lo vacío usa las fechas generales). Con un código, el alumno solo puede empezar si escribe el que tú le das en el salón; cada sección puede tener el suyo.</p>
    ${rows}</fieldset>`;
}

/** Secciones marcadas en el bloque: [] = todas. */
function readQuizSections(f) {
  const ids = f.getAll('quizSection');
  if (!ids.length) throw new Error('Marca al menos una sección que presente la evaluación.');
  return ids.length === courseSections().length ? [] : ids;
}

/** Horarios y códigos por sección; las secciones que no presentan se quedan sin nada. */
function readQuizSectionDates(f) {
  const on = new Set(f.getAll('quizSection'));
  return readSectionDates(f).map((d) => (on.has(d.section) ? d : { section: d.section, startAt: '', due: '', endAt: '', code: '' }));
}

document.addEventListener('change', (e) => {
  if (!e.target.matches('input[name="quizSection"]')) return;
  e.target.closest('[data-quiz-section-row]').toggleAttribute('data-off', !e.target.checked);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-code-generate]');
  if (!b) return;
  // Sin letras que se confunden al dictarlas (0/O, 1/I/L).
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const random = crypto.getRandomValues(new Uint32Array(6));
  b.previousElementSibling.value = [...random].map((n) => letters[n % letters.length]).join('');
  dirty = true;
});

/** Guarda las fechas por sección de un elemento recién guardado (solo si el curso tiene secciones). */
async function saveSectionDates(kind, itemId, dates) {
  if (!courseSections().length || !itemId) return;
  const had = (current.sectionDates || []).some((d) => d.item === itemId);
  const has = dates.some((d) => d.startAt || d.due || d.endAt || d.code);
  if (!had && !has) return;
  await request('/api/sections/dates', { course: current.course.id, kind, item: itemId, dates });
}

/** Resumen de las fechas por sección de una actividad (en la página de envíos). */
function sectionDatesSummary(itemId) {
  const dates = (current.sectionDates || []).filter((d) => d.item === itemId);
  if (!dates.length) return '';
  return `<p class="section-dates-note">Por sección: ${dates
    .map((d) => `<b>${esc(sectionName(d.section))}</b> ${[d.start_at ? 'desde ' + fmt(d.start_at) : '', d.due ? 'vence ' + fmt(d.due) : '', d.end_at ? 'cierra ' + fmt(d.end_at) : '', d.code ? 'código ' + d.code : ''].filter(Boolean).map(esc).join(', ')}`)
    .join(' · ')}</p>`;
}

// ---- ¿Para qué secciones es? (unidades, materiales, noticias, foros, actividades y evaluaciones) ----------------

/** Selector en los editores (junto a «Visible para alumnos»). Nada si el curso no tiene secciones. */
function sectionChooserHtml(sections = []) {
  if (!teaches() || !courseSections().length) return '';
  const some = sections.length > 0;
  return `<fieldset class="section-chooser" data-section-chooser><legend>¿Para qué secciones?</legend>
    <label class="check-label"><input type="radio" name="sectionsMode" value="all" ${some ? '' : 'checked'}> Para todas las secciones</label>
    <label class="check-label"><input type="radio" name="sectionsMode" value="some" ${some ? 'checked' : ''}> Solo para algunas:</label>
    <div class="section-chooser-list" ${some ? '' : 'hidden'}>${courseSections()
      .map((x) => `<label class="check-label"><input type="checkbox" name="forSection" value="${esc(x.id)}" ${sections.includes(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`)
      .join('')}</div>
    <p class="muted">Los alumnos de otras secciones no lo ven, no les llega el aviso y no les cuenta en la calificación.</p></fieldset>`;
}

/** Lee el selector: [] = todas. */
function readSectionChooser(box) {
  if (box.querySelector('input[name="sectionsMode"]:checked')?.value !== 'some') return [];
  const ids = [...box.querySelectorAll('input[name="forSection"]:checked')].map((x) => x.value);
  if (!ids.length) throw new Error('Elige al menos una sección, o marca «Para todas las secciones».');
  return ids;
}

document.addEventListener('change', (e) => {
  if (!e.target.matches('[data-section-chooser] input[name="sectionsMode"]')) return;
  const list = e.target.closest('[data-section-chooser]').querySelector('.section-chooser-list');
  list.hidden = e.target.value !== 'some';
});

/** Etiqueta «Solo 5AV, 5BV» para quien enseña en listas y encabezados. */
function sectionTag(record) {
  const sections = record?.data?.sections || [];
  const special = (typeof specialTag === 'function' ? specialTag(record) : '') + (typeof conditionsTag === 'function' ? conditionsTag(record) : '');
  if (!teaches() || !sections.length) return special;
  return ` <span class="role-pill section-pill">Solo ${esc(sections.map(sectionName).filter(Boolean).join(', '))}</span>${special}`;
}
