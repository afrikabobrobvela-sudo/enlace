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
    ${backupPanel()}
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
      <p class="warning-note">Esto no se puede deshacer. Antes, descarga un respaldo de la base (<code>npm run respaldo</code>) y de los archivos (<em>Respaldar archivos</em>, arriba) y revisa la lista. Los archivos se vuelven a comprobar al borrarlos: si alguno se enlazó mientras tanto, se conserva.</p>
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

// ---- Respaldo de archivos (R2) en una carpeta de la computadora -----------------------------------
//
// El respaldo de la base no incluye los archivos. Aquí se copian a una carpeta elegida por la administración
// (showDirectoryPicker: Chrome o Edge en computadora): archivos/<llave> con el contenido tal cual, más indice.csv
// con nombre, curso y fecha de cada uno. Solo se descargan los que aún no están (mismo nombre y tamaño).
// Para restaurar, se preguntan al servidor cuáles faltan en R2 y solo esos se suben desde la carpeta.

const BACKUP_DIR = 'archivos';
const BACKUP_PARALLEL = 3;
const BACKUP_LAST_KEY = 'enlace-ultimo-respaldo-archivos';
let backupRunning = null; // AbortController del respaldo o restauración en curso

function backupPanel() {
  const supported = typeof globalThis.showDirectoryPicker === 'function';
  let last = null;
  try {
    last = localStorage.getItem(BACKUP_LAST_KEY);
  } catch {}
  return `<section class="panel admin-block" id="backupAdmin">
      <h2>Respaldo de archivos</h2>
      <p class="muted">El respaldo de la base de datos no incluye tareas, presentaciones ni evidencias. Elige una carpeta de tu computadora (de preferencia una que se sincronice con Google Drive o una memoria USB): Enlace copia ahí solo los archivos que todavía no tiene. Hazlo cada semana, junto con <code>npm run respaldo</code>.</p>
      ${last ? `<p class="real-status">Último respaldo desde este navegador: ${esc(fmt(last))}</p>` : ''}
      ${supported ? '' : '<p class="warning-note">Para respaldar o restaurar archivos abre Enlace en Chrome o Edge en una computadora.</p>'}
      <div class="action-row"><button class="primary" type="button" data-backup-files ${supported ? '' : 'disabled'}>Respaldar archivos…</button>
        <button class="secondary" type="button" data-restore-files ${supported ? '' : 'disabled'}>Restaurar archivos que falten…</button></div>
      <div id="backupResult" aria-live="polite"></div>
    </section>`;
}

/** Todos los archivos que Enlace tiene registrados (una fila por objeto de R2), en páginas de 1000. */
async function backupList() {
  const files = [];
  let after = '';
  do {
    const page = await request('/api/backup/files?after=' + encodeURIComponent(after));
    files.push(...page.files);
    after = page.next;
  } while (after);
  return files;
}

async function backupLocalSize(dir, key) {
  try {
    return (await (await dir.getFileHandle(key)).getFile()).size;
  } catch {
    return -1;
  }
}

async function backupWriteText(root, name, text) {
  const writable = await (await root.getFileHandle(name, { create: true })).createWritable();
  await writable.write(new Blob([text], { type: 'text/plain' }));
  await writable.close();
}

function backupIndexCsv(files, missing) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lost = new Set(missing.map((f) => f.key));
  const head = ['Archivo en la carpeta', 'Nombre original', 'Curso', 'Tipo', 'Bytes', 'Subido', 'Estado'];
  const rows = files.map((f) =>
    [`${BACKUP_DIR}/${f.key}`, f.name, f.course_name || 'Curso eliminado', f.scope === 'submission' ? 'Entrega' : 'Material', f.size, f.created, lost.has(f.key) ? 'Falta en Enlace' : 'Respaldado']
      .map(cell)
      .join(','),
  );
  return '\ufeff' + [head.map(cell).join(','), ...rows].join('\r\n');
}

const BACKUP_README = `Respaldo de archivos de Enlace
===============================

archivos/     Cada archivo con su llave de almacenamiento como nombre (sin extensión).
indice.csv    Nombre original, curso, tipo y fecha de cada archivo (se abre con Excel).

Para devolverlos a Enlace: Reportes → Respaldo de archivos → «Restaurar archivos que falten…»
y elige esta misma carpeta. Solo se suben los que falten; nunca se reemplaza uno que exista.
Si se perdió también la base de datos, primero restáurala (LEEME.md → Respaldos) y después los archivos.

Contiene trabajos de alumnos: guárdala en un lugar privado.
`;

/** Copia a `root` los archivos que aún no están. `onProgress` recibe el avance; `signal` permite cancelar. */
async function backupFiles(root, { onProgress, signal } = {}) {
  const dir = await root.getDirectoryHandle(BACKUP_DIR, { create: true });
  const files = await backupList();
  const result = { total: files.length, saved: 0, kept: 0, bytes: 0, missing: [], failed: [], pending: 0, done: 0, cancelled: false };
  const queue = [];
  for (const f of files) {
    if ((await backupLocalSize(dir, f.key)) === f.size) result.kept++;
    else queue.push(f);
  }
  result.pending = queue.length;
  onProgress?.(result);
  const worker = async () => {
    while (queue.length && !signal?.aborted) {
      const f = queue.shift();
      try {
        const r = await fetch('/api/backup/object?key=' + encodeURIComponent(f.key), { credentials: 'same-origin', signal });
        if (r.status === 410) result.missing.push(f);
        else if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
        else {
          const blob = await r.blob();
          if (blob.size !== f.size) throw new Error('Se descargó incompleto.');
          // createWritable escribe en un archivo temporal y lo reemplaza al cerrar: no quedan archivos a medias.
          const writable = await (await dir.getFileHandle(f.key, { create: true })).createWritable();
          try {
            await writable.write(blob);
            await writable.close();
          } catch (error) {
            await writable.abort?.().catch(() => {});
            throw error;
          }
          result.saved++;
          result.bytes += f.size;
        }
      } catch (error) {
        if (signal?.aborted) break;
        result.failed.push({ ...f, error: error.message });
      }
      result.done++;
      onProgress?.(result);
    }
  };
  await Promise.all(Array.from({ length: BACKUP_PARALLEL }, worker));
  result.cancelled = Boolean(signal?.aborted);
  await backupWriteText(root, 'indice.csv', backupIndexCsv(files, result.missing));
  await backupWriteText(root, 'LEEME.txt', BACKUP_README);
  return result;
}

/** Sube desde `root` los archivos que faltan en el almacenamiento de Enlace. */
async function restoreFiles(root, { onProgress, signal } = {}) {
  let dir;
  try {
    dir = await root.getDirectoryHandle(BACKUP_DIR);
  } catch {
    throw new Error('Esa carpeta no es un respaldo de Enlace: no tiene la carpeta «archivos».');
  }
  const files = await backupList();
  const result = { total: files.length, checked: 0, missing: 0, restored: 0, unavailable: [], failed: [], cancelled: false };
  const lost = [];
  for (let i = 0; i < files.length && !signal?.aborted; i += 40) {
    const batch = files.slice(i, i + 40);
    const { missing } = await request('/api/backup/missing', { keys: batch.map((f) => f.key) });
    lost.push(...batch.filter((f) => missing.includes(f.key)));
    result.checked += batch.length;
    result.missing = lost.length;
    onProgress?.(result);
  }
  for (const f of lost) {
    if (signal?.aborted) break;
    let file = null;
    try {
      file = await (await dir.getFileHandle(f.key)).getFile();
    } catch {}
    if (!file || file.size !== f.size) {
      result.unavailable.push(f);
      continue;
    }
    try {
      const r = await fetch('/api/backup/restore?key=' + encodeURIComponent(f.key), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Aula-Request': '1', 'Content-Type': 'application/octet-stream' },
        body: file,
        signal,
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
      result.restored++;
    } catch (error) {
      if (signal?.aborted) break;
      result.failed.push({ ...f, error: error.message });
    }
    onProgress?.(result);
  }
  result.cancelled = Boolean(signal?.aborted);
  return result;
}

const backupFileList = (list, label) =>
  list.length
    ? `<details class="backup-list"><summary>${label} (${list.length})</summary><ul>${list
        .slice(0, 200)
        .map((f) => `<li>${esc(f.name)} · ${esc(f.course_name || 'Curso eliminado')} · ${bytesText(f.size)}${f.error ? ` — ${esc(f.error)}` : ''}</li>`)
        .join('')}${list.length > 200 ? `<li class="muted">… y ${list.length - 200} más (ver indice.csv).</li>` : ''}</ul></details>`
    : '';

async function runBackup(mode) {
  if (backupRunning) return;
  const box = $('#backupResult');
  let root;
  try {
    root = await globalThis.showDirectoryPicker({ id: 'enlace-respaldo', mode: mode === 'backup' ? 'readwrite' : 'read' });
  } catch (error) {
    if (error?.name === 'AbortError') return; // cerró el selector sin elegir
    throw error;
  }
  backupRunning = new AbortController();
  const buttons = document.querySelectorAll('[data-backup-files],[data-restore-files]');
  buttons.forEach((b) => (b.disabled = true));
  const bar = (done, total) => `<progress max="${Math.max(total, 1)}" value="${done}"></progress>`;
  const cancel = '<button class="text-btn" type="button" data-backup-cancel>Cancelar</button>';
  box.innerHTML = `<p class="muted">Preparando… ${cancel}</p>`;
  // Salir de la página a media copia la interrumpe: se pide confirmación.
  const guard = (e) => {
    e.preventDefault();
    e.returnValue = '';
  };
  addEventListener('beforeunload', guard);
  try {
    if (mode === 'backup') {
      const r = await backupFiles(root, {
        signal: backupRunning.signal,
        onProgress: (p) => {
          box.innerHTML = `<p>${p.kept} de ${p.total} ya estaban en la carpeta. Descargando ${p.done} de ${p.pending} nuevos (${bytesText(p.bytes)})… ${cancel}</p>${bar(p.done, p.pending)}`;
        },
      });
      try {
        localStorage.setItem(BACKUP_LAST_KEY, new Date().toISOString());
      } catch {}
      box.innerHTML = `<p class="${r.failed.length || r.missing.length || r.cancelled ? 'warning-note' : 'success-note'}">${r.cancelled ? 'Respaldo cancelado. ' : 'Respaldo terminado. '}${r.saved} ${r.saved === 1 ? 'archivo nuevo' : 'archivos nuevos'} (${bytesText(r.bytes)}); ${r.kept} ya estaban. La carpeta tiene <code>indice.csv</code> con el nombre y curso de cada archivo.${r.failed.length ? ' Algunos no se pudieron descargar: vuelve a respaldar para reintentarlos.' : ''}</p>
        ${backupFileList(r.missing, 'Registrados en Enlace pero ya no están en el almacenamiento')}${backupFileList(r.failed, 'No se pudieron descargar')}`;
    } else {
      const r = await restoreFiles(root, {
        signal: backupRunning.signal,
        onProgress: (p) => {
          box.innerHTML =
            p.checked < p.total
              ? `<p>Revisando ${p.checked} de ${p.total} archivos… ${cancel}</p>${bar(p.checked, p.total)}`
              : `<p>Faltan ${p.missing}. Subiendo desde la carpeta: ${p.restored} restaurados… ${cancel}</p>${bar(p.restored + p.unavailable.length + p.failed.length, p.missing)}`;
        },
      });
      box.innerHTML = `<p class="${r.unavailable.length || r.failed.length || r.cancelled ? 'warning-note' : 'success-note'}">${
        r.missing ? `${r.cancelled ? 'Restauración cancelada. ' : ''}Faltaban ${r.missing} de ${r.total} archivos; se restauraron ${r.restored}.` : `No falta ningún archivo: los ${r.total} están en el almacenamiento.`
      }</p>${backupFileList(r.unavailable, 'Faltan y no están en esta carpeta')}${backupFileList(r.failed, 'No se pudieron restaurar')}`;
    }
  } catch (error) {
    box.innerHTML = `<p class="warning-note">${esc(error.message)}</p>`;
  } finally {
    removeEventListener('beforeunload', guard);
    backupRunning = null;
    buttons.forEach((b) => (b.disabled = false));
  }
}

document.addEventListener('click', async (e) => {
  const target = e.target.closest('[data-report-csv],[data-orphans-scan],[data-grade-history],[data-backup-files],[data-restore-files],[data-backup-cancel]');
  if (!target) return;
  try {
    if (target.matches('[data-report-csv]')) return reportCsv();
    if (target.matches('[data-orphans-scan]')) return await scanOrphans();
    if (target.matches('[data-backup-files]')) return await runBackup('backup');
    if (target.matches('[data-restore-files]')) return await runBackup('restore');
    if (target.matches('[data-backup-cancel]')) return backupRunning?.abort();
    if (target.matches('[data-grade-history]')) return await gradeHistoryModal(target.dataset.task, target.dataset.gradeHistory);
  } catch (error) {
    toast(error.message);
  }
});
