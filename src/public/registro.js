/* Registro de docentes: solicitud para ser docente, academia y unidad de cada docente, y en el panel
 * Docentes las solicitudes pendientes y el catálogo de academias y unidades académicas. */

let catalogCache = null;
let classificationAsked = false; // la ventana "Completa tu registro" se abre sola una vez por visita

async function loadCatalog(force = false) {
  if (!catalogCache || force) {
    const data = await request('/api/catalog');
    catalogCache = { academies: data.academies || [], units: data.units || [] };
  }
  return catalogCache;
}

const catalogOptions = (items, selected, placeholder) =>
  `<option value="">${placeholder}</option>` +
  items.filter((i) => i.active !== 0 || i.id === selected).map((i) => `<option value="${esc(i.id)}" ${i.id === selected ? 'selected' : ''}>${esc(i.name)}</option>`).join('');

function classificationFields(catalog, academy = '', unit = '') {
  return `<label>Academia<select name="academy" required>${catalogOptions(catalog.academies, academy, 'Elige tu academia…')}</select></label>
    <label>Unidad académica<select name="unit" required>${catalogOptions(catalog.units, unit, 'Elige tu unidad…')}</select></label>`;
}

/** Aviso en "Mis cursos": solicitud para ser docente (alumnos con correo institucional) o registro pendiente (docentes). */
function registrationBanner() {
  if (!me) return '';
  if (me.needsClassification) {
    return `<section class="register-banner"><div><strong>Completa tu registro</strong><p>Indica tu academia y unidad académica para clasificar tus cursos.</p></div>
      <button class="primary" data-registro="classify">Completar registro</button></section>`;
  }
  const r = me.teacherRequest;
  if (me.role !== 'student') return '';
  if (r?.status === 'pending') {
    return `<section class="register-banner is-pending"><div><strong>Tu solicitud de docente está en revisión</strong>
      <p>La enviaste el ${esc(fmt(r.created))}. Cuando la administración la apruebe podrás crear tus cursos; no necesitas volver a entrar.</p></div></section>`;
  }
  if (!me.canRequestTeacher) return '';
  const rejected = r?.status === 'rejected'
    ? `<p class="register-reason">Tu solicitud anterior no se aprobó: ${esc(r.reason)}</p>`
    : '';
  return `<section class="register-banner"><div><strong>¿Eres docente de la BUAP?</strong>
    <p>Solicita acceso para crear tus cursos. La administración revisa cada solicitud.</p>${rejected}</div>
    <button class="primary" data-registro="request">${rejected ? 'Enviar otra solicitud' : 'Solicitar acceso de docente'}</button></section>`;
}

/** Abre sola la ventana de registro para docentes sin academia (una vez por visita). */
function maybeAskClassification() {
  if (me?.needsClassification && !classificationAsked && !current) {
    classificationAsked = true;
    classificationModal();
  }
}

async function classificationModal() {
  const catalog = await loadCatalog();
  modal(
    'Completa tu registro',
    `<p>Para organizar la plataforma por academias, indica a cuáles perteneces. Tus cursos nuevos quedarán clasificados así.</p>${classificationFields(catalog, me.academyId || '', me.unitId || '')}`,
    async (f) => {
      await request('/api/profile/classification', { academy: f.get('academy'), unit: f.get('unit') });
      me = await request('/api/me');
      return 'Registro completo. ¡Gracias!';
    },
    'Guardar',
  );
}

async function teacherRequestModal() {
  const catalog = await loadCatalog(true);
  modal(
    'Solicitar acceso de docente',
    `<p>Entraste como <strong>${esc(me.email)}</strong>. La administración revisará tu solicitud.</p>
     ${field('Nombre completo', 'name', me.name, 'text', 'required maxlength="150"')}
     ${classificationFields(catalog)}
     ${field('Materias que impartes', 'subjects', '', 'text', 'maxlength="500" placeholder="Por ejemplo: Física I, Física II"')}
     <label>Comentario (opcional)<textarea name="message" maxlength="1000" placeholder="Cualquier dato que ayude a la administración a identificarte."></textarea></label>`,
    async (f) => {
      await request('/api/teacher-request', {
        name: f.get('name'),
        academy: f.get('academy'),
        unit: f.get('unit'),
        subjects: f.get('subjects'),
        message: f.get('message'),
      });
      me = await request('/api/me');
      return 'Solicitud enviada. Te avisaremos aquí cuando se revise.';
    },
    'Enviar solicitud',
  );
}

// ---- Panel Docentes (administración) ----------------------------------------------------------

async function renderTeacherRequests(box) {
  let requests;
  try {
    requests = (await request('/api/teacher-requests')).requests || [];
  } catch (error) {
    box.innerHTML = `<p class="error">${esc(error.message)}</p>`;
    return;
  }
  const pending = requests.filter((r) => r.status === 'pending');
  const decided = requests.filter((r) => r.status !== 'pending');
  const card = (r) => `<article class="request-card">
      <div class="request-main"><strong>${esc(r.name)}</strong><span class="muted">${esc(r.email)}</span>
        <div class="request-tags"><span class="category-pill">${esc(r.academy)}</span><span class="category-pill">${esc(r.unit)}</span></div>
        ${r.subjects ? `<p><span class="muted">Materias:</span> ${esc(r.subjects)}</p>` : ''}
        ${r.message ? `<p class="request-message">${esc(r.message)}</p>` : ''}
        <p class="muted">Enviada el ${esc(fmt(r.created))}</p></div>
      <div class="request-actions">
        <button class="primary" data-registro="approve" data-id="${esc(r.id)}" data-name="${esc(r.name)}">Aprobar</button>
        <button class="secondary" data-registro="reject" data-id="${esc(r.id)}" data-name="${esc(r.name)}">Rechazar</button></div>
    </article>`;
  box.innerHTML = `<div class="panel-head"><h2>Solicitudes de docentes ${pending.length ? `<span class="badge-count">${pending.length}</span>` : ''}</h2></div>
    ${pending.map(card).join('') || '<p class="muted">No hay solicitudes pendientes.</p>'}
    ${decided.length ? `<details class="request-history"><summary>Revisadas en los últimos 30 días (${decided.length})</summary><ul>${decided
      .map((r) => `<li><strong>${esc(r.name)}</strong> · ${esc(r.email)} · ${r.status === 'approved' ? 'Aprobada' : `Rechazada: ${esc(r.reason)}`}${r.decided_by ? ` · por ${esc(r.decided_by)}` : ''}</li>`)
      .join('')}</ul></details>` : ''}`;
}

async function renderCatalogAdmin(box) {
  let catalog;
  try {
    catalog = await loadCatalog(true);
  } catch (error) {
    box.innerHTML = `<p class="error">${esc(error.message)}</p>`;
    return;
  }
  const list = (kind, items, title, empty) => `<div class="catalog-column"><div class="panel-head"><h3>${title}</h3>
      <button class="text-btn" data-registro="catalog-bulk" data-kind="${kind}">＋ Agregar</button></div>
      <ul class="catalog-list">${items
        .map((i) => `<li class="${i.active ? '' : 'is-inactive'}"><span>${esc(i.name)}${i.active ? '' : ' <small class="muted">(desactivada)</small>'}</span>
          <span class="row-actions"><button class="table-link" data-registro="catalog-rename" data-kind="${kind}" data-id="${esc(i.id)}" data-name="${esc(i.name)}">Cambiar nombre</button>
          <button class="table-link" data-registro="catalog-toggle" data-kind="${kind}" data-id="${esc(i.id)}" data-name="${esc(i.name)}" data-active="${i.active}">${i.active ? 'Desactivar' : 'Activar'}</button></span></li>`)
        .join('') || `<li class="muted">${empty}</li>`}</ul></div>`;
  box.innerHTML = `<div class="panel-head"><h2>Academias y unidades académicas</h2></div>
    <p class="muted">Son las opciones que eligen los docentes al registrarse. Desactivar oculta una opción sin afectar a quien ya la tiene.</p>
    <div class="catalog-grid">${list('academy', catalog.academies, 'Academias', 'Agrega las academias (por ejemplo, Física, Matemáticas).')}
    ${list('unit', catalog.units, 'Unidades académicas', 'Agrega las unidades académicas del complejo regional.')}</div>`;
}

function catalogBulkModal(kind) {
  const label = kind === 'academy' ? 'academias' : 'unidades académicas';
  modal(
    `Agregar ${label}`,
    `<label>Un nombre por renglón (puedes pegarlos desde Excel)<textarea name="names" required rows="8"></textarea></label>
     <p class="muted">Los nombres que ya existen se omiten, sin importar mayúsculas ni acentos.</p>`,
    async (f) => {
      const { created, existing } = await request('/api/catalog/bulk', { kind, names: String(f.get('names')).split(/\r?\n/) });
      catalogCache = null;
      return `Se agregaron ${created}${existing ? `; ${existing} ya existían` : ''}.`;
    },
    'Agregar',
  );
}

function catalogRenameModal(dataset) {
  modal(
    'Cambiar nombre',
    field('Nombre', 'name', dataset.name, 'text', 'required maxlength="150"'),
    async (f) => {
      await request('/api/catalog', { kind: dataset.kind, id: dataset.id, name: f.get('name'), active: true });
      catalogCache = null;
      return 'Nombre actualizado.';
    },
  );
}

function rejectRequestModal(dataset) {
  modal(
    'Rechazar solicitud',
    `<p>¿Rechazar la solicitud de <strong>${esc(dataset.name)}</strong>? La persona verá el motivo y podrá enviar otra.</p>
     <label>Motivo<textarea name="reason" required maxlength="500" placeholder="Por ejemplo: no encontramos tu registro en la unidad indicada."></textarea></label>`,
    async (f) => {
      await request('/api/teacher-requests/decide', { id: dataset.id, approve: false, reason: f.get('reason') });
      return 'Solicitud rechazada.';
    },
    'Rechazar',
  );
  $('#formSave').classList.add('danger-button');
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-registro]');
  if (!b || busy) return;
  const d = b.dataset;
  try {
    switch (d.registro) {
      case 'classify':
        return await classificationModal();
      case 'request':
        return await teacherRequestModal();
      case 'approve':
        if (!confirm(`¿Aprobar a ${d.name} como docente? Podrá crear cursos de inmediato.`)) return;
        await request('/api/teacher-requests/decide', { id: d.id, approve: true });
        toast(`${d.name} ya es docente.`);
        me = await request('/api/me');
        return render();
      case 'reject':
        return rejectRequestModal(d);
      case 'catalog-bulk':
        return catalogBulkModal(d.kind);
      case 'catalog-rename':
        return catalogRenameModal(d);
      case 'catalog-toggle':
        await request('/api/catalog', { kind: d.kind, id: d.id, name: d.name, active: d.active !== '1' });
        catalogCache = null;
        return renderCatalogAdmin($('#catalogAdmin'));
    }
  } catch (error) {
    toast(error.message);
  }
});
