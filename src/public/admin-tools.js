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
