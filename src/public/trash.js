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

function trashConfirmText(kind) {
  if (kind === 'task') return '¿Eliminar esta actividad? Sus entregas y calificaciones se conservan en la papelera y vuelven si la restauras.';
  if (kind === 'quiz') return '¿Eliminar esta evaluación? Los intentos de los alumnos se conservan y vuelven si la restauras.';
  if (kind === 'forum') return '¿Eliminar este foro? Sus publicaciones dejan de verse hasta que lo restaures.';
  if (kind === 'post') return teaches() ? '¿Eliminar esta publicación del foro?' : '¿Eliminar tu publicación?';
  return `¿Eliminar ${TRASH_KINDS[kind]?.toLowerCase() || 'este elemento'}? Podrás restaurarlo desde Administración del curso → Papelera.`;
}

async function trashItem(kind, id) {
  if (!confirm(trashConfirmText(kind))) return false;
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
