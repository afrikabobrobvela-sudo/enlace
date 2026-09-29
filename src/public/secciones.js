/* Secciones de un curso (por ejemplo 5AV, 5BV y 5CV de Física I): un solo curso con el mismo contenido y, para quien
 * enseña, un filtro por sección en alumnos, calificaciones, entregas, asistencia, progreso y exámenes. También las
 * fechas por sección de actividades y evaluaciones. Todo se valida en el servidor (sections.js). */

const courseSections = () => current?.sections || [];
const sectionName = (id) => courseSections().find((s) => s.id === id)?.name || '';
const SECTION_NONE = 'none';

function sectionStorageKey() {
  return 'enlace-seccion-' + (current?.course?.id || '');
}

/** Sección elegida en el filtro: '' (todas), 'none' (sin sección) o el id de una sección. Se recuerda por curso. */
function selectedSection() {
  if (!current || !teaches() || !courseSections().length) return '';
  let value = '';
  try {
    value = localStorage.getItem(sectionStorageKey()) || '';
  } catch {
    value = '';
  }
  return value === SECTION_NONE || courseSections().some((s) => s.id === value) ? value : '';
}

function setSelectedSection(value) {
  try {
    if (value) localStorage.setItem(sectionStorageKey(), value);
    else localStorage.removeItem(sectionStorageKey());
  } catch {
    // Sin almacenamiento (ventana privada): el filtro dura hasta recargar.
  }
}

/** ¿Este alumno está en la sección elegida? */
function inSelectedSection(member) {
  const chosen = selectedSection();
  if (!chosen) return true;
  return chosen === SECTION_NONE ? !member?.section : member?.section === chosen;
}

/** Alumnos que se ven con el filtro de sección actual (para quien enseña). */
function studentsInView() {
  return current.members.filter((m) => m.role === 'student' && inSelectedSection(m));
}

/** ¿La clase es para este alumno? (las de todo el curso son para todos). */
const sessionApplies = (session, member) => !session.section || session.section === member?.section;

/** Clases que se ven con el filtro de sección: las de esa sección y las de todo el curso. */
function sessionsInView(sessions) {
  const chosen = selectedSection();
  if (!chosen) return sessions;
  return sessions.filter((s) => !s.section || (chosen !== SECTION_NONE && s.section === chosen));
}

/** Filtro de sección para las pantallas de quien enseña (nada si el curso no tiene secciones). */
function sectionFilterHtml() {
  if (!teaches() || !courseSections().length) return '';
  const chosen = selectedSection();
  const count = (id) => current.members.filter((m) => m.role === 'student' && (id === SECTION_NONE ? !m.section : m.section === id)).length;
  const none = count(SECTION_NONE);
  return `<label class="section-filter"><span>Sección</span><select data-section-filter aria-label="Filtrar por sección">
    <option value="">Todas (${current.members.filter((m) => m.role === 'student').length})</option>
    ${courseSections().map((s) => `<option value="${esc(s.id)}" ${chosen === s.id ? 'selected' : ''}>${esc(s.name)} (${count(s.id)})</option>`).join('')}
    ${none ? `<option value="${SECTION_NONE}" ${chosen === SECTION_NONE ? 'selected' : ''}>Sin sección (${none})</option>` : ''}
  </select></label>`;
}

document.addEventListener('change', (e) => {
  if (!e.target.matches('[data-section-filter]')) return;
  setSelectedSection(e.target.value);
  render();
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
  }));
}

/** Guarda las fechas por sección de un elemento recién guardado (solo si el curso tiene secciones). */
async function saveSectionDates(kind, itemId, dates) {
  if (!courseSections().length || !itemId) return;
  const had = (current.sectionDates || []).some((d) => d.item === itemId);
  const has = dates.some((d) => d.startAt || d.due || d.endAt);
  if (!had && !has) return;
  await request('/api/sections/dates', { course: current.course.id, kind, item: itemId, dates });
}

/** Resumen de las fechas por sección de una actividad (en la página de envíos). */
function sectionDatesSummary(itemId) {
  const dates = (current.sectionDates || []).filter((d) => d.item === itemId);
  if (!dates.length) return '';
  return `<p class="section-dates-note">Fechas por sección: ${dates
    .map((d) => `<b>${esc(sectionName(d.section))}</b> ${[d.start_at ? 'desde ' + fmt(d.start_at) : '', d.due ? 'vence ' + fmt(d.due) : '', d.end_at ? 'cierra ' + fmt(d.end_at) : ''].filter(Boolean).map(esc).join(', ')}`)
    .join(' · ')}</p>`;
}
