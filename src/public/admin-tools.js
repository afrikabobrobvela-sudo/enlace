/* Herramientas de administración: lista de docentes e inscripción masiva de alumnos. */

const ROLE_LABELS = { teacher: 'Docente', admin: 'Administración' };

// ---- Docentes ------------------------------------------------------------------------------

async function renderTeachers() {
  $('#main').innerHTML = '<p class="empty">Cargando docentes…</p>';
  let teachers;
  try {
    teachers = await request('/api/teachers');
  } catch (e) {
    $('#main').innerHTML = `<section class="error"><h2>No se pudo cargar la lista de docentes</h2><p>${esc(e.message)}</p>${button('Volver a mis cursos', 'home', '', 'secondary')}</section>`;
    return;
  }
  if (current || homeView !== 'teachers') return; // la persona ya navegó a otra pantalla
  const lastLogin = (t) => (t.lastLogin ? fmt(t.lastLogin) : t.user_id ? 'Sin registro' : 'Aún no entra');
  const rows = teachers
    .map(
      (t) => `<tr data-search-row>
        <td class="sticky-name">${esc(t.name)}${t.owner ? '<div class="muted">Cuenta principal</div>' : ''}</td>
        <td>${esc(t.email)}</td>
        <td>${ROLE_LABELS[t.role] || esc(t.role)}</td>
        <td>${t.academy ? esc(t.academy) : '<span class="muted">Sin registrar</span>'}${t.unit ? `<div class="table-subtext">${esc(t.unit)}</div>` : ''}</td>
        <td>${t.courses}</td>
        <td>${lastLogin(t)}</td>
        <td class="row-actions">${
          t.owner || t.email === me.email
            ? '<span class="muted">—</span>'
            : `<button class="table-link" data-action="edit-teacher" data-email="${esc(t.email)}" data-name="${esc(t.name)}" data-role="${esc(t.role)}">Cambiar rol</button>
               <button class="danger-link" data-action="remove-teacher" data-email="${esc(t.email)}" data-name="${esc(t.name)}" data-courses="${t.courses}">Retirar</button>`
        }</td>
      </tr>`,
    )
    .join('');
  $('#main').innerHTML = `
    <button class="back" data-action="home">❮ Volver a mis cursos</button>
    <div class="home-title-row">
      <div>
        <h1>Docentes</h1>
        <p class="muted">Quién puede crear cursos en Enlace. Los cambios aplican de inmediato.</p>
      </div>
      <div class="action-row">${button('Agregar docente', 'add-teacher')}</div>
    </div>
    <section class="panel admin-block" id="teacherRequests"><p class="muted">Cargando solicitudes…</p></section>
    <div class="toolbar"><input data-search type="search" placeholder="Buscar por nombre, correo, academia o unidad…" aria-label="Buscar docente"></div>
    <div class="table-wrap">
      <table class="teachers-table">
        <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Academia y unidad</th><th>Cursos</th><th>Último acceso</th><th><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7">Todavía no hay docentes. Agrega el primero con su correo de Google.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="real-status">Administración puede crear cursos, ver todos los cursos y gestionar esta lista. Docente puede crear y gestionar sus propios cursos.</p>
    <section class="panel admin-block" id="catalogAdmin"><p class="muted">Cargando catálogo…</p></section>`;
  renderTeacherRequests($('#teacherRequests'));
  renderCatalogAdmin($('#catalogAdmin'));
}

function teacherFields({ name = '', email = '', role = 'teacher' } = {}, editing = false) {
  return (
    field('Nombre', 'name', name, 'text', 'required maxlength="150"') +
    (editing
      ? `<p><strong>${esc(email)}</strong></p><input type="hidden" name="email" value="${esc(email)}">`
      : field('Correo de su cuenta de Google', 'email', email, 'email', 'required')) +
    `<label>Rol<select name="role">
       <option value="teacher" ${role === 'teacher' ? 'selected' : ''}>Docente — crea y gestiona sus propios cursos</option>
       <option value="admin" ${role === 'admin' ? 'selected' : ''}>Administración — ve todos los cursos y gestiona docentes</option>
     </select></label>`
  );
}

function addTeacherModal() {
  modal(
    'Agregar docente',
    teacherFields() + '<p class="pending-message">No se envía invitación: comparte el enlace del sitio y pide que entre con ese mismo correo.</p>',
    async (f) => {
      await request('/api/teachers', { name: f.get('name'), email: f.get('email'), role: f.get('role') });
      return 'Docente agregado.';
    },
    'Agregar docente',
  );
}

function editTeacherModal(dataset) {
  modal(
    'Cambiar rol',
    teacherFields({ name: dataset.name, email: dataset.email, role: dataset.role }, true),
    async (f) => {
      await request('/api/teachers', { name: f.get('name'), email: f.get('email'), role: f.get('role') });
      return 'Rol actualizado.';
    },
    'Guardar cambios',
  );
}

function removeTeacherModal(dataset) {
  const courses = Number(dataset.courses || 0);
  modal(
    'Retirar docente',
    `<p>¿Retirar a <strong>${esc(dataset.name)}</strong> (${esc(dataset.email)}) de la lista de docentes?</p>
     <p>Se cerrarán sus sesiones abiertas y ya no podrá crear cursos. ${
       courses
         ? `Perderá el acceso a ${courses === 1 ? 'el curso que creó' : `los ${courses} cursos que creó`}. No se borra nada: la administración sigue viéndolos con todas sus entregas y calificaciones, y si vuelves a darle de alta lo recupera.`
         : 'No tiene cursos propios.'
     }</p>`,
    async () => {
      await request('/api/teachers', { email: dataset.email }, 'DELETE');
      return 'Docente retirado. Sus cursos se conservan para la administración.';
    },
    'Retirar docente',
  );
  $('#formSave').classList.add('danger-button');
}

// ---- Inscripción masiva ------------------------------------------------------------------------

/**
 * Interpreta una lista pegada desde Excel (columnas separadas por tabulador) o un CSV (comas o punto y coma).
 * Reconoce las columnas por su contenido: el correo por la @, la matrícula por ser solo dígitos y el
 * nombre como el texto restante. Si la primera fila es un encabezado, la ignora.
 */
function parseRoster(textValue) {
  const students = [];
  const errors = [];
  const lines = String(textValue || '').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const cells = line
      .split(line.includes('\t') ? '\t' : /[;,]/)
      .map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim())
      .filter(Boolean);
    if (index === 0 && cells.some((c) => /^(correo|e-?mail|nombre|matr[ií]cula)$/i.test(c))) return;
    const email = cells.find((c) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c));
    const matricula = cells.find((c) => c !== email && /^\d{5,12}$/.test(c)) || '';
    const name = cells.filter((c) => c !== email && c !== matricula).join(' ');
    if (!email || !name) errors.push({ line: index + 1, text: line.trim().slice(0, 80) });
    else students.push({ name, email: email.toLowerCase(), matricula });
  });
  return { students, errors };
}

function bulkMembersModal() {
  modal(
    'Importar lista de alumnos',
    `<p>Pega la lista desde Excel o un archivo CSV: una fila por alumno con <strong>nombre</strong>, <strong>correo</strong> y, si la tienes, <strong>matrícula</strong>, en cualquier orden.</p>
     <label>Lista<textarea name="roster" required spellcheck="false" placeholder="Ana Pérez López	202612345	ana.perez@alumno.buap.mx"></textarea></label>
     <p class="roster-preview" id="rosterPreview" role="status">Aún no hay filas.</p>
     <p class="pending-message">Si un correo ya está inscrito, se actualizan su nombre y matrícula. No se envían invitaciones.</p>`,
    async (f) => {
      const { students, errors } = parseRoster(f.get('roster'));
      if (errors.length) throw new Error(`Revisa la fila ${errors[0].line}: falta el nombre o el correo.`);
      if (!students.length) throw new Error('Pega al menos una fila con nombre y correo.');
      const result = await request('/api/members/bulk', { course: current.course.id, students });
      return `Lista importada: ${result.created} ${result.created === 1 ? 'alumno nuevo' : 'alumnos nuevos'}, ${result.updated} ${result.updated === 1 ? 'actualizado' : 'actualizados'}.`;
    },
    'Importar alumnos',
  );
  const area = $('#fields textarea');
  const preview = $('#rosterPreview');
  area.addEventListener('input', () => {
    const { students, errors } = parseRoster(area.value);
    preview.classList.toggle('has-errors', errors.length > 0);
    preview.textContent = !students.length && !errors.length
      ? 'Aún no hay filas.'
      : `${students.length} ${students.length === 1 ? 'alumno listo' : 'alumnos listos'} para importar` +
        '.' +
        (errors.length ? ` ${errors.length} ${errors.length === 1 ? 'fila' : 'filas'} sin nombre o correo (primera: fila ${errors[0].line}).` : '');
  });
}

// ---- Reportes por academia y unidad, y limpieza de archivos ----------------------------------

const bytesText = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB');
let reportCache = null;

async function renderReports() {
  $('#main').innerHTML = '<p class="empty">Cargando reportes…</p>';
  try {
    reportCache = await request('/api/reports');
  } catch (e) {
    $('#main').innerHTML = `<section class="error"><h2>No se pudieron cargar los reportes</h2><p>${esc(e.message)}</p>${button('Volver a mis cursos', 'home', '', 'secondary')}</section>`;
    return;
  }
  if (current || homeView !== 'reports') return;
  const { totals, groups, courses } = reportCache;
  const tile = (value, label) => `<div class="stat-tile"><strong>${value}</strong><span>${label}</span></div>`;
  const quota = 9 * 1073741824;
  const groupRows = groups
    .map(
      (g) => `<tr data-search-row><td class="sticky-name">${esc(g.academy)}</td><td>${esc(g.unit)}</td><td>${g.courses}${g.active < g.courses ? ` <span class="table-subtext">${g.courses - g.active} archivados</span>` : ''}</td>
        <td>${g.teachers}</td><td>${g.students}</td><td>${g.tasks}</td><td>${g.submissions}</td><td>${bytesText(g.bytes)}</td></tr>`,
    )
    .join('');
  $('#main').innerHTML = `
    <button class="back" data-action="home">❮ Volver a mis cursos</button>
    <div class="home-title-row"><div><h1>Reportes</h1><p class="muted">Uso de Enlace por academia y unidad académica (cursos no eliminados).</p></div>
      <div class="action-row"><button class="secondary" type="button" data-report-csv>Descargar CSV por curso</button></div></div>
    <div class="stat-tiles">
      ${tile(totals.active, 'cursos activos')}${tile(totals.courses - totals.active, 'cursos archivados')}${tile(totals.teachers, 'docentes con cursos')}
      ${tile(totals.students, 'inscripciones de alumnos')}${tile(bytesText(totals.bytes), `de ${bytesText(quota)} de archivos (${((totals.bytes / quota) * 100).toFixed(1)} %)`)}
    </div>
    <div class="toolbar"><input data-search type="search" placeholder="Buscar academia o unidad…" aria-label="Buscar academia o unidad"></div>
    <div class="table-wrap"><table class="report-table">
      <thead><tr><th>Academia</th><th>Unidad</th><th>Cursos</th><th>Docentes</th><th>Alumnos</th><th>Actividades</th><th>Entregas</th><th>Archivos</th></tr></thead>
      <tbody>${groupRows || '<tr><td colspan="8">Todavía no hay cursos.</td></tr>'}</tbody></table></div>
    <p class="real-status">La academia y unidad de cada curso son las de quien lo creó. ${courses.length} cursos en total; el CSV incluye el detalle de cada uno.</p>
    <section class="panel admin-block" id="storageAdmin">
      <h2>Archivos sin usar</h2>
      <p class="muted">Archivos subidos hace más de 7 días que ningún contenido, actividad o entrega enlaza (por ejemplo, de formularios que no se guardaron o de elementos que se reemplazaron). Lo que está en la papelera se conserva.</p>
      <button class="secondary" type="button" data-orphans-scan>Buscar archivos sin usar</button>
      <div id="orphanResult"></div>
    </section>`;
}

function reportCsv() {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Academia', 'Unidad', 'Curso', 'Grupo', 'Periodo', 'Docente', 'Estado', 'Alumnos', 'Actividades', 'Entregas', 'MB de archivos', 'Creado'];
  const lines = reportCache.courses.map((c) =>
    [c.academy, c.unit, c.name, c.group_name, c.period, c.owner, c.archived_at ? 'Archivado' : 'Activo', c.students, c.tasks, c.submissions, (c.bytes / 1048576).toFixed(2), c.created.slice(0, 10)]
      .map(cell)
      .join(','),
  );
  const blob = new Blob(['﻿' + [head.map(cell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `enlace-reporte-${new Date().toISOString().slice(0, 10)}.csv` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

let orphanCache = null;
async function scanOrphans() {
  const box = $('#orphanResult');
  box.innerHTML = '<p class="muted">Buscando…</p>';
  orphanCache = await request('/api/storage/orphans');
  const { files, bytes, confirmation } = orphanCache;
  if (!files.length) return (box.innerHTML = '<p class="success-note">No hay archivos sin usar. Todo lo guardado está enlazado.</p>');
  box.innerHTML = `
    <p><strong>${files.length} ${files.length === 1 ? 'archivo' : 'archivos'}</strong> sin usar ${files.length === 1 ? 'ocupa' : 'ocupan'} <strong>${bytesText(bytes)}</strong>${files.length >= 500 ? ' (se muestran los 500 más grandes; repite la limpieza para seguir)' : ''}.</p>
    <div class="table-wrap"><table class="report-table"><thead><tr><th>Archivo</th><th>Curso</th><th>Tipo</th><th>Tamaño</th><th>Subido</th></tr></thead><tbody>
      ${files
        .slice(0, 100)
        .map((f) => `<tr><td>${esc(f.name)}</td><td>${esc(f.course_name || 'Curso eliminado')}</td><td>${f.scope === 'submission' ? 'Entrega' : 'Material'}</td><td>${bytesText(f.size)}</td><td>${esc(fmt(f.created))}</td></tr>`)
        .join('')}
      ${files.length > 100 ? `<tr><td colspan="5" class="muted">… y ${files.length - 100} más.</td></tr>` : ''}</tbody></table></div>
    <form class="real-form orphan-form" id="orphanForm">
      <p class="warning-note">Esto no se puede deshacer. Antes, descarga un respaldo (<code>node scripts/respaldo.mjs</code>) y revisa la lista. Los archivos se vuelven a comprobar al borrarlos: si alguno se enlazó mientras tanto, se conserva.</p>
      <label>Escribe <strong>${esc(confirmation)}</strong> para confirmar<input name="confirm" autocomplete="off" required></label>
      <p class="form-error error" hidden></p>
      <button class="primary danger-button" type="submit">Borrar ${files.length === 1 ? 'el archivo' : `${files.length} archivos`}</button>
    </form>`;
  $('#orphanForm').onsubmit = async (e) => {
    e.preventDefault();
    const error = e.target.querySelector('.form-error');
    try {
      const r = await request('/api/storage/cleanup', { ids: orphanCache.files.map((f) => f.id), confirm: new FormData(e.target).get('confirm') });
      box.innerHTML = `<p class="success-note">${r.deleted === 1 ? 'Se borró 1 archivo' : `Se borraron ${r.deleted} archivos`} (${bytesText(r.bytes)} liberados).</p>`;
      toast('Limpieza terminada.');
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  };
}

// Historial de una calificación (pantalla de revisión).
async function gradeHistoryModal(taskId, memberId) {
  const { history } = await request(`/api/grade-history?course=${encodeURIComponent(current.course.id)}&task=${encodeURIComponent(taskId)}&member=${encodeURIComponent(memberId)}`);
  const grade = (v) => (v === null || v === undefined ? '—' : esc(v));
  const what = (h) => {
    if (h.reason === 'nueva entrega') return `El alumno entregó de nuevo; se quitó la calificación ${grade(h.old_grade)}`;
    if (h.reason === 'publicación') return `Se publicó la calificación ${grade(h.new_grade)}`;
    const parts = [];
    if (h.old_grade !== h.new_grade) parts.push(`${grade(h.old_grade)} → <strong>${grade(h.new_grade)}</strong>`);
    if (h.feedback_changed) parts.push('comentarios');
    if (h.old_published !== h.new_published) parts.push(h.new_published ? 'publicada' : 'como borrador');
    return (h.reason === 'calificación de equipo' ? 'Calificación de equipo: ' : 'Calificación: ') + (parts.join(' · ') || 'sin cambios');
  };
  modal(
    'Historial de la calificación',
    history.length
      ? `<ol class="history-list">${history.map((h) => `<li><span>${what(h)}</span><span class="muted">${esc(fmt(h.changed_at))} · ${esc(h.changed_by || 'Persona retirada')}</span></li>`).join('')}</ol>`
      : '<p class="muted">Todavía no hay cambios registrados. El historial empezó con la versión 12.6.</p>',
    null,
  );
}

document.addEventListener('click', async (e) => {
  const target = e.target.closest('[data-report-csv],[data-orphans-scan],[data-grade-history]');
  if (!target) return;
  try {
    if (target.matches('[data-report-csv]')) return reportCsv();
    if (target.matches('[data-orphans-scan]')) return await scanOrphans();
    if (target.matches('[data-grade-history]')) return await gradeHistoryModal(target.dataset.task, target.dataset.gradeHistory);
  } catch (error) {
    toast(error.message);
  }
});
