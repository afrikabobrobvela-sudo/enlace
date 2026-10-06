/* Papelera del curso: eliminar sin perder datos y restaurar. Solo el personal docente del curso la ve. */

const TRASH_KINDS = {
  module: 'Unidad',
  material: 'Material',
  notice: 'Noticia',
  forum: 'Foro',
  post: 'Publicación de foro',
  quiz: 'Evaluación',
  task: 'Actividad',
};

/** Botón "Eliminar" para cualquier elemento que va a la papelera. */
function trashButton(kind, id, label = 'Eliminar') {
  return `<button type="button" class="danger-link" data-action="trash" data-kind="${esc(kind)}" data-id="${esc(id)}">${label}</button>`;
}

function trashConfirmText(kind, id) {
  if (kind === 'task') {
    // Con el nombre y cuántas calificaciones tiene, para no eliminar otra por error (por ejemplo, desde el libro).
    const task = id ? find(id) : null;
    const graded = task ? records('submission').filter((s) => s.data.task === id && s.data.grade !== null && s.data.grade !== undefined).length : 0;
    return `¿Eliminar ${task ? `«${task.data.title}»` : 'esta actividad'}?${graded ? ` Tiene ${graded} ${graded === 1 ? 'calificación' : 'calificaciones'}.` : ''} Sus entregas y calificaciones se conservan en la papelera y vuelven si la restauras.`;
  }
  if (kind === 'quiz') return '¿Eliminar esta evaluación? Los intentos de los alumnos se conservan y vuelven si la restauras.';
  if (kind === 'forum') return '¿Eliminar este foro? Sus publicaciones dejan de verse hasta que lo restaures.';
  if (kind === 'post') return teaches() ? '¿Eliminar esta publicación del foro?' : '¿Eliminar tu publicación?';
  return `¿Eliminar ${TRASH_KINDS[kind]?.toLowerCase() || 'este elemento'}? Podrás restaurarlo desde Administración del curso → Papelera.`;
}

async function trashItem(kind, id) {
  // Actividad compartida con otras secciones y el libro filtrado a una sola (12.45): primero se ofrece quitarla
  // solo de esa sección, para no borrar la de los demás grupos.
  if (kind === 'task') {
    const only = typeof selectedSection === 'function' ? selectedSection() : '';
    const task = find(id);
    const all = courseSections().map((x) => x.id);
    const mine = task?.data.sections?.length ? task.data.sections : all;
    if (only && mine.includes(only) && mine.length > 1) {
      const others = mine.filter((x) => x !== only).map(sectionName).join(', ');
      if (confirm(`«${task.data.title}» también es de: ${others}.\n\n¿Quitarla solo de ${sectionName(only)}? Las otras secciones la conservan con sus entregas y calificaciones.\n\n(Cancelar = ver la opción de eliminarla para todas)`)) {
        await request('/api/task/unshare', { course: current.course.id, id, section: only });
        toast(`Se quitó de ${sectionName(only)}; sigue en ${others}.`);
        return 'unshared';
      }
      if (!confirm(`¿Eliminar «${task.data.title}» para TODAS sus secciones (${mine.map(sectionName).join(', ')})? Va a la papelera.`)) return false;
      await request('/api/record', { course: current.course.id, kind, id }, 'DELETE');
      return true;
    }
  }
  if (!confirm(trashConfirmText(kind, id))) return false;
  await request('/api/record', { course: current.course.id, kind, id }, 'DELETE');
  return true;
}

async function renderTrash() {
  const courseId = current.course.id;
  $('#main').innerHTML = '<p class="empty">Cargando papelera…</p>';
  let items;
  try {
    ({ items } = await request('/api/trash?course=' + encodeURIComponent(courseId)));
  } catch (error) {
    $('#main').innerHTML = `<section class="error"><h2>No se pudo cargar la papelera</h2><p>${esc(error.message)}</p></section>`;
    return;
  }
  if (section !== 'trash' || current?.course.id !== courseId) return;
  const when = (iso) => new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  $('#main').innerHTML = `<button class="back" data-section="admin">❮ Administración del curso</button>
    <div class="page-heading"><div><h1>Papelera</h1>
    <p class="muted">Lo eliminado no se borra: deja de verse y puedes restaurarlo con todo su contenido, entregas y calificaciones.</p></div></div>
    <div class="table-wrap"><table><caption class="sr-only">Elementos eliminados</caption>
    <thead><tr><th scope="col">Elemento</th><th scope="col">Tipo</th><th scope="col">Eliminado</th><th scope="col">Acción</th></tr></thead>
    <tbody>${
      items
        .map(
          (item) => `<tr><td><strong>${esc(item.title || 'Sin título')}</strong>${
            item.kind === 'task' && item.submissions ? `<p class="table-subtext">${item.submissions} entregas o calificaciones guardadas</p>` : ''
          }</td><td>${esc(TRASH_KINDS[item.kind] || item.kind)}</td><td>${esc(when(item.deletedAt))}${item.deletedBy ? `<p class="table-subtext">por ${esc(item.deletedBy)}</p>` : ''}</td>
          <td><button type="button" class="text-btn" data-action="restore" data-kind="${esc(item.kind)}" data-id="${esc(item.id)}">Restaurar</button></td></tr>`,
        )
        .join('') || '<tr><td colspan="4" class="empty">La papelera está vacía.</td></tr>'
    }</tbody></table></div>`;
}

async function restoreItem(kind, id) {
  await request('/api/trash/restore', { course: current.course.id, kind, id });
  current = await request('/api/course?id=' + encodeURIComponent(current.course.id) + viewSuffix());
  await renderTrash();
  toast('Elemento restaurado.');
}
