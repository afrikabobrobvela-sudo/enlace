/* Acceso especial (12.22), como en Brightspace: a uno o varios alumnos se les da otro horario en una actividad
 * (desde, vence, cierre) o en una evaluación (se abre, se cierra, minutos extra, intentos adicionales), y la actividad
 * o evaluación puede ser solo para ellos. El servidor (src/server/especial.js) valida y aplica todo.
 */

/** Filas de acceso especial de una actividad (registros «extension») o de una evaluación (current.quizAccess). */
function specialGrants(kind, itemId) {
  if (kind === 'task') return records('extension').filter((e) => e.data.task === itemId).map((e) => ({ member: e.data.member, start: e.data.start, due: e.data.due, end: e.data.end, reason: e.data.reason }));
  return (current.quizAccess || [])
    .filter((g) => g.quiz === itemId)
    .map((g) => ({ member: g.member, start: g.start_at, end: g.end_at, extraMinutes: g.extra_minutes, extraAttempts: g.extra_attempts, reason: g.reason }));
}

/** ¿Tiene este alumno acceso especial? (para «solo con acceso especial» y la calificación). */
function hasSpecialAccess(record, member) {
  if (!member) return false;
  if (record.kind === 'task') return Boolean(extensionOf(record.id, member.id));
  return indexed(current.quizAccess, 'grants', (list) => new Set(list.map((g) => g.quiz + '|' + g.member))).has(record.id + '|' + member.id);
}

/** Resumen de un acceso especial en una línea («desde 3 oct, vence 5 oct · +10 min»). */
function specialSummary(g) {
  const parts = [];
  if (g.start) parts.push(`${g.due === undefined ? 'se abre' : 'desde'} ${fmt(g.start)}`);
  if (g.due) parts.push(`vence ${fmt(g.due)}`);
  if (g.end) parts.push(`${g.due === undefined ? 'se cierra' : 'cierra'} ${fmt(g.end)}`);
  if (g.extraMinutes) parts.push(`+${g.extraMinutes} min`);
  if (g.extraAttempts) parts.push(`+${g.extraAttempts} ${g.extraAttempts === 1 ? 'intento' : 'intentos'}`);
  return parts.join(' · ') || 'Solo puede verla';
}

/** Botón «Acceso especial (n)» de la página de una actividad o evaluación (para quien enseña). */
function specialAccessButton(kind, itemId) {
  const n = specialGrants(kind, itemId).length;
  return `<button type="button" class="secondary" data-special-access="${kind}" data-id="${esc(itemId)}">Acceso especial${n ? ` <span class="badge-count">${n}</span>` : ''}</button>`;
}

/** Pastilla «Solo acceso especial» junto al título (para quien enseña). */
const specialTag = (record) => (teaches() && record?.data?.specialOnly ? ' <span class="role-pill special-pill">Solo acceso especial</span>' : '');

let specialState = null; // ventana abierta: { kind, itemId, chosen: Set, filter, search }

/** Ventana de acceso especial de una actividad (`kind` 'task') o evaluación ('quiz'). `preselect`: un alumno. */
function specialAccessModal(kind, itemId, preselect = '') {
  const item = find(itemId);
  if (!item) return;
  const grants = specialGrants(kind, itemId);
  const editing = preselect ? grants.find((g) => g.member === preselect) : null;
  specialState = { kind, itemId, chosen: new Set(preselect ? [preselect] : []), filter: '', search: '' };
  const isTask = kind === 'task';
  const memberName = (id) => current.members.find((m) => m.id === id)?.name || 'Alumno';
  const current_ = grants
    .sort((x, y) => memberName(x.member).localeCompare(memberName(y.member), 'es'))
    .map(
      (g) => `<li class="special-row"><div><b>${esc(memberName(g.member))}</b>${courseSections().length ? ` <span class="muted">· ${esc(sectionName(current.members.find((m) => m.id === g.member)?.section) || 'Sin sección')}</span>` : ''}
        <div class="muted">${esc(specialSummary(g))}${g.reason ? ` · ${esc(g.reason)}` : ''}</div></div>
        <div class="row-actions"><button type="button" class="text-btn" data-special-edit="${esc(g.member)}">Editar</button><button type="button" class="danger-link" data-special-remove="${esc(g.member)}">Quitar</button></div></li>`,
    )
    .join('');
  const dt = (name, label, value) => `<label>${label}<input type="datetime-local" name="${name}" value="${esc(localDate(value))}"></label>`;
  const fields = isTask
    ? `<div class="quiz-grid special-dates">${dt('startAt', 'Disponible desde', editing?.start)}${dt('due', 'Vence', editing?.due)}${dt('endAt', 'Cierre de entregas', editing?.end)}</div>
       <p class="muted">Lo vacío usa la fecha de su sección o la general. Para volver a abrir una actividad cerrada, pon un nuevo cierre.</p>`
    : `<div class="quiz-grid special-dates">${dt('startAt', 'Se abre', editing?.start)}${dt('endAt', 'Se cierra', editing?.end)}
         <label>Minutos extra<input type="number" name="extraMinutes" min="0" max="600" step="5" value="${esc(editing?.extraMinutes || 0)}"></label>
         <label>Intentos adicionales<input type="number" name="extraAttempts" min="0" max="10" value="${esc(editing?.extraAttempts || 0)}"></label></div>
       <p class="muted">Lo vacío usa el horario de su sección o el general. Los minutos extra se suman al tiempo límite.</p>`;
  modal(
    `Acceso especial · ${item.data.title}`,
    `<label class="check-label special-only"><input type="checkbox" data-special-only ${item.data.specialOnly ? 'checked' : ''}> Solo los alumnos con acceso especial ven ${isTask ? 'esta actividad' : 'esta evaluación'}</label>
     <p class="muted">Útil para una reposición o un examen extemporáneo: los demás no la ven ni les cuenta en la calificación.</p>
     <section class="special-current"><h3>Con acceso especial (${grants.length})</h3>${current_ ? `<ul class="special-list">${current_}</ul>` : '<p class="muted">Nadie todavía.</p>'}</section>
     <section class="special-add"><h3>${editing ? `Cambiar el acceso de ${esc(memberName(preselect))}` : 'Dar acceso especial'}</h3>
       ${fields}
       <label>Motivo (opcional; solo lo ven los docentes)<input name="reason" maxlength="300" value="${esc(editing?.reason || '')}" placeholder="Por ejemplo: justificante médico"></label>
       <div class="special-picker" id="specialPicker"></div></section>`,
    async (f) => {
      const members = [...specialState.chosen];
      if (!members.length) throw new Error('Elige al menos un alumno.');
      const iso = (name) => (f.get(name) ? new Date(f.get(name)).toISOString() : '');
      const r = await request('/api/special-access', {
        course: current.course.id,
        kind,
        item: itemId,
        members,
        startAt: iso('startAt'),
        due: iso('due'),
        endAt: iso('endAt'),
        extraMinutes: Number(f.get('extraMinutes') || 0),
        extraAttempts: Number(f.get('extraAttempts') || 0),
        reason: f.get('reason') || '',
      });
      return `Acceso especial guardado para ${r.saved} ${r.saved === 1 ? 'alumno' : 'alumnos'}.`;
    },
    'Guardar acceso especial',
  );
  renderSpecialPicker();
}

/** Lista para elegir alumnos: filtro por sección, búsqueda y «todos los que se ven». */
function renderSpecialPicker() {
  const box = document.getElementById('specialPicker');
  if (!box || !specialState) return;
  const item = find(specialState.itemId);
  const has = new Set(specialGrants(specialState.kind, specialState.itemId).map((g) => g.member));
  const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const students = current.members
    .filter((m) => m.role === 'student' && itemAppliesToSection(item, m))
    .filter((m) => !specialState.filter || (specialState.filter === '-' ? !m.section : m.section === specialState.filter))
    .filter((m) => !specialState.search || plain(m.name + ' ' + (m.matricula || '') + ' ' + (m.email || '')).includes(plain(specialState.search)))
    .sort((x, y) => x.name.localeCompare(y.name, 'es'));
  const all = students.length > 0 && students.every((m) => specialState.chosen.has(m.id));
  box.innerHTML = `<div class="special-picker-top">
      ${courseSections().length ? `<select data-special-filter aria-label="Sección"><option value="">Todas las secciones</option>${courseSections().map((s) => `<option value="${esc(s.id)}" ${specialState.filter === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
      <input type="search" data-special-search placeholder="Buscar alumno…" aria-label="Buscar alumno" value="${esc(specialState.search)}">
      <span class="special-count">${specialState.chosen.size} ${specialState.chosen.size === 1 ? 'elegido' : 'elegidos'}</span></div>
    <div class="special-table"><label class="check-label special-all"><input type="checkbox" data-special-all ${all ? 'checked' : ''} ${students.length ? '' : 'disabled'}> <b>Alumno</b></label>
    ${students
      .map(
        (m) => `<label class="check-label special-student"><input type="checkbox" data-special-pick="${esc(m.id)}" ${specialState.chosen.has(m.id) ? 'checked' : ''}>
          <span class="person">${avatarHtml(m)}<span>${esc(m.name)}${m.matricula ? ` <span class="muted">${esc(m.matricula)}</span>` : ''}</span></span>
          ${has.has(m.id) ? '<span class="role-pill special-pill">Ya tiene</span>' : ''}</label>`,
      )
      .join('') || '<p class="muted">No hay alumnos con ese filtro.</p>'}</div>`;
}

/** Solo se da acceso a alumnos de las secciones a las que va dirigida (el servidor lo exige). */
const itemAppliesToSection = (record, member) => !record?.data?.sections?.length || record.data.sections.includes(member?.section);

document.addEventListener('change', async (e) => {
  if (!specialState || !e.target.closest('#modal')) return;
  if (e.target.matches('[data-special-pick]')) {
    if (e.target.checked) specialState.chosen.add(e.target.dataset.specialPick);
    else specialState.chosen.delete(e.target.dataset.specialPick);
    renderSpecialPicker();
  }
  if (e.target.matches('[data-special-all]')) {
    for (const input of document.querySelectorAll('#specialPicker [data-special-pick]')) {
      if (e.target.checked) specialState.chosen.add(input.dataset.specialPick);
      else specialState.chosen.delete(input.dataset.specialPick);
    }
    renderSpecialPicker();
  }
  if (e.target.matches('[data-special-filter]')) {
    specialState.filter = e.target.value;
    renderSpecialPicker();
  }
  if (e.target.matches('[data-special-only]')) {
    const box = e.target;
    box.disabled = true;
    try {
      await request('/api/special-access/only', { course: current.course.id, kind: specialState.kind, item: specialState.itemId, specialOnly: box.checked });
      await reload();
      toast(box.checked ? 'Ahora solo la ven los alumnos con acceso especial.' : 'Ahora la ven todos los alumnos a los que va dirigida.');
    } catch (error) {
      box.checked = !box.checked;
      toast(error.message);
    } finally {
      box.disabled = false;
    }
  }
});
document.addEventListener('input', (e) => {
  if (!specialState || !e.target.matches('#modal [data-special-search]')) return;
  specialState.search = e.target.value;
  const position = e.target.selectionStart;
  renderSpecialPicker();
  const input = document.querySelector('#specialPicker [data-special-search]');
  input?.focus();
  input?.setSelectionRange(position, position);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('#modal [data-special-search]')) e.preventDefault();
});
document.addEventListener('click', async (e) => {
  const open = e.target.closest('[data-special-access]');
  if (open) return specialAccessModal(open.dataset.specialAccess, open.dataset.id, open.dataset.member || '');
  if (!specialState || !e.target.closest('#modal')) return;
  const edit = e.target.closest('[data-special-edit]');
  if (edit) return specialAccessModal(specialState.kind, specialState.itemId, edit.dataset.specialEdit);
  const remove = e.target.closest('[data-special-remove]');
  if (!remove) return;
  if (!confirm('¿Quitar el acceso especial de este alumno? Vuelve a tener las fechas de su sección o las generales.')) return;
  try {
    await request('/api/special-access', { course: current.course.id, kind: specialState.kind, item: specialState.itemId, members: [remove.dataset.specialRemove] }, 'DELETE');
    await reload();
    specialAccessModal(specialState.kind, specialState.itemId);
    toast('Acceso especial quitado.');
  } catch (error) {
    toast(error.message);
  }
});
