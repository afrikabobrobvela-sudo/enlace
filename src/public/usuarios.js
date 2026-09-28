/* Usuarios (solo administración): buscar a cualquier persona, ver su ficha (cuentas, sesiones, cursos que imparte
 * o cursa y registro), suspender o reactivar su acceso, transferir sus cursos y abrir lo que ve un alumno.
 * Todo lo delicado queda en el registro de acciones del servidor (aula_audit).
 */

const USER_ROLES = { student: 'Alumno', teacher: 'Docente', admin: 'Administración' };
const AUDIT_LABELS = {
  ver_alumno: 'Consultó la vista de un alumno',
  suspender: 'Suspendió el acceso',
  reactivar: 'Reactivó el acceso',
  transferir_curso: 'Transfirió un curso',
};
const PROVIDER_LABELS = { google: 'Google', microsoft: 'Microsoft', email: 'Enlace por correo' };
let usersState = { q: '', role: '', status: '', list: [], next: null, counts: null, tab: 'users' };
let usersTimer = null;

const usersQuery = (after = '') =>
  '/api/users?' + new URLSearchParams({ q: usersState.q, role: usersState.role, status: usersState.status, ...(after ? { after } : {}) }).toString();

async function renderUsers() {
  if (usersState.tab === 'audit') return renderAuditLog();
  $('#main').innerHTML = '<p class="empty">Cargando usuarios…</p>';
  try {
    const page = await request(usersQuery());
    Object.assign(usersState, { list: page.users, next: page.next, counts: page.counts });
  } catch (e) {
    $('#main').innerHTML = `<section class="error"><h2>No se pudo cargar el directorio</h2><p>${esc(e.message)}</p>${button('Volver a mis cursos', 'home', '', 'secondary')}</section>`;
    return;
  }
  if (current || homeView !== 'users') return; // la persona ya navegó a otra pantalla
  const { counts } = usersState;
  const tile = (value, label) => `<div class="stat-tile"><strong>${value ?? 0}</strong><span>${label}</span></div>`;
  const option = (value, label, selected) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`;
  $('#main').innerHTML = `
    <button class="back" data-action="home">❮ Volver a mis cursos</button>
    <div class="home-title-row"><div><h1>Usuarios</h1><p class="muted">Todas las personas que han entrado a Enlace: alumnos, docentes y administración.</p></div>
      <div class="action-row"><button class="secondary" type="button" data-users-tab="audit">Registro de acciones</button></div></div>
    <div class="stat-tiles">${tile(counts.total, 'personas')}${tile(counts.students, 'alumnos')}${tile(counts.staff, 'docentes y administración')}${tile(counts.suspended, 'con acceso suspendido')}</div>
    <div class="workspace-filterbar users-filters">
      <label class="search-control"><span class="sr-only">Buscar por nombre o correo</span><input type="search" data-users-search placeholder="Buscar por nombre o correo…" value="${esc(usersState.q)}" autocomplete="off"></label>
      <label class="filter-control">Rol<select data-users-role>${option('', 'Todos', usersState.role)}${option('student', 'Alumnos', usersState.role)}${option('teacher', 'Docentes', usersState.role)}${option('admin', 'Administración', usersState.role)}</select></label>
      <label class="filter-control">Estado<select data-users-status>${option('', 'Todos', usersState.status)}${option('suspended', 'Suspendidos', usersState.status)}</select></label>
    </div>
    <div id="usersTable">${usersTableHtml()}</div>
    <p class="real-status">Solo aparecen quienes ya entraron alguna vez. Suspender cierra sus sesiones y le impide entrar, sin borrar cursos, entregas ni calificaciones.</p>`;
}

function usersTableHtml() {
  const { list, next } = usersState;
  const rows = list
    .map(
      (u) => `<tr>
        <td class="sticky-name"><strong>${esc(u.name)}</strong>${u.suspended_at ? ' <span class="role-pill suspended-pill">Suspendido</span>' : ''}</td>
        <td>${esc(u.email)}</td>
        <td>${USER_ROLES[u.role] || esc(u.role)}</td>
        <td>${[u.owned ? `Imparte ${u.owned}` : '', u.enrolled ? `Cursa ${u.enrolled}` : ''].filter(Boolean).join(' · ') || '<span class="muted">Ninguno</span>'}</td>
        <td>${u.last_login ? esc(fmt(u.last_login)) : '<span class="muted">Sin registro</span>'}</td>
        <td><button class="table-link" type="button" data-user-detail="${esc(u.id)}">Ver ficha</button></td>
      </tr>`,
    )
    .join('');
  return `<div class="table-wrap"><table class="users-table"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Cursos</th><th>Último acceso</th><th><span class="sr-only">Acciones</span></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="empty">Nadie coincide con la búsqueda.</td></tr>'}</tbody></table></div>
    ${next ? '<div class="form-actions"><button class="secondary" type="button" data-users-more>Mostrar más</button></div>' : ''}`;
}

async function refreshUsersTable() {
  const page = await request(usersQuery());
  Object.assign(usersState, { list: page.users, next: page.next, counts: page.counts });
  const box = $('#usersTable');
  if (box) box.innerHTML = usersTableHtml();
}

// ---- Ficha de una persona ---------------------------------------------------------------------

async function userDetailModal(id) {
  const d = await request('/api/users/detail?id=' + encodeURIComponent(id));
  const u = d.user;
  const status = u.suspended_at
    ? `<p class="warning-note"><strong>Acceso suspendido</strong> desde ${esc(fmt(u.suspended_at))}${u.suspended_by ? ` por ${esc(u.suspended_by)}` : ''}. Motivo: ${esc(u.suspended_reason || '—')}</p>`
    : '';
  const identities = d.identities.map((i) => `<li>${esc(PROVIDER_LABELS[i.provider] || i.provider)} · ${esc(i.email)} · último acceso ${esc(fmt(i.last_login))}</li>`).join('');
  const owned = d.owned
    .map(
      (c) => `<li><div><strong>${esc(c.name)}</strong> <span class="muted">${esc(c.group_name)}${c.period ? ' · ' + esc(c.period) : ''} · ${c.students} alumnos${c.archived_at ? ' · archivado' : ''}</span></div>
        <button class="table-link" type="button" data-user-transfer="${esc(c.id)}" data-course-name="${esc(c.name)}" data-owner="${esc(u.name)}">Transferir…</button></li>`,
    )
    .join('');
  const roleLabel = { student: 'Alumno', teacher: 'Co-docente', removed: 'Retirado' };
  const memberships = d.memberships
    .map(
      (m) => `<li><div><strong>${esc(m.name)}</strong> <span class="muted">${esc(m.group_name)}${m.period ? ' · ' + esc(m.period) : ''} · ${roleLabel[m.role] || esc(m.role)}${m.owner_name ? ' · docente: ' + esc(m.owner_name) : ''}</span></div>
        ${m.role === 'student' ? `<button class="table-link" type="button" data-user-view="${esc(m.member)}" data-course="${esc(m.course)}">Ver lo que ve</button>` : ''}</li>`,
    )
    .join('');
  const log = d.log.map((l) => `<li>${esc(fmt(l.created))} · ${auditText(l)}</li>`).join('');
  const actions = u.principal
    ? '<p class="muted">Cuenta principal de administración: no se puede suspender.</p>'
    : u.id === me.id
      ? ''
      : u.suspended_at
        ? `<button class="primary" type="button" data-user-reactivate="${esc(u.id)}">Reactivar acceso</button>`
        : `<button class="danger-button primary" type="button" data-user-suspend="${esc(u.id)}" data-name="${esc(u.name)}">Suspender acceso…</button>`;
  modal(
    u.name,
    `<div class="user-detail">
      ${status}
      <p>${esc(u.email)} · ${USER_ROLES[u.role] || esc(u.role)}${u.principal ? ' (cuenta principal)' : ''}</p>
      <p class="muted">${d.sessions === 1 ? '1 sesión abierta' : `${d.sessions} sesiones abiertas`}${u.privacy_accepted_at ? ` · aceptó el aviso de privacidad el ${esc(fmt(u.privacy_accepted_at))}` : ''}</p>
      <h3>Cuentas con las que entra</h3><ul class="user-list">${identities || '<li class="muted">Ninguna</li>'}</ul>
      ${owned ? `<h3>Cursos que imparte</h3><ul class="user-list">${owned}</ul>` : ''}
      ${memberships ? `<h3>Cursos en los que está inscrito</h3><ul class="user-list">${memberships}</ul>` : ''}
      <h3>Registro</h3><ul class="user-list user-log">${log || '<li class="muted">Sin acciones registradas.</li>'}</ul>
      <div class="form-actions">${actions}</div>
    </div>`,
    null,
  );
}

// Los alumnos sin cuenta (por ejemplo, los del curso de ejemplo) no tienen usuario: su nombre viene en el detalle.
const auditPerson = (l) => l.target_name || (l.action === 'ver_alumno' ? l.detail.match(/^Consultó la vista de (.*) \([^)]*\)$/)?.[1] : '') || '';

function auditText(l) {
  const what = AUDIT_LABELS[l.action] || esc(l.action);
  const who = l.actor_name ? esc(l.actor_name) : 'Alguien';
  const target = auditPerson(l) ? ` · ${esc(auditPerson(l))}` : '';
  const course = l.course_name ? ` · ${esc(l.course_name)}` : '';
  const detail = l.detail && l.action !== 'ver_alumno' ? ` — ${esc(l.detail)}` : '';
  return `<strong>${who}</strong>: ${what}${target}${course}${detail}`;
}

function suspendUserModal(id, name) {
  modal(
    'Suspender acceso',
    `<p>Se cerrarán todas las sesiones de <strong>${esc(name)}</strong> y no podrá entrar a Enlace hasta que reactives su acceso.</p>
     <p class="muted">No se borra nada: sus cursos, entregas, calificaciones y asistencia se conservan, y sus docentes lo siguen viendo en sus listas.</p>` +
      textarea('Motivo (queda en el registro)', 'reason', '', true),
    async (f) => {
      await request('/api/users/suspend', { user: id, reason: f.get('reason') });
      return 'Acceso suspendido.';
    },
    'Suspender acceso',
  );
  $('#formSave').classList.add('danger-button');
}

async function transferCourseModal(courseId, courseName, ownerName) {
  const teachers = await request('/api/teachers').catch(() => []);
  modal(
    'Transferir curso',
    `<p>El curso <strong>${esc(courseName)}</strong> pasará de ${esc(ownerName)} al docente que indiques. Alumnos, contenido, entregas, calificaciones y asistencia no cambian.</p>
     <label>Correo del nuevo docente<input name="email" type="email" required list="transferTeachers" autocomplete="off"></label>
     <datalist id="transferTeachers">${teachers.filter((t) => t.user_id).map((t) => `<option value="${esc(t.email)}">${esc(t.name)}</option>`).join('')}</datalist>
     <label class="check-label"><input type="checkbox" name="keep" checked> ${esc(ownerName)} se queda como co-docente</label>
     <label>Escribe el nombre exacto del curso para confirmar<input name="confirm" required autocomplete="off"></label>`,
    async (f) => {
      await request('/api/course/transfer', { course: courseId, email: f.get('email'), keepPrevious: f.get('keep') === 'on', confirm: f.get('confirm') });
      return 'Curso transferido.';
    },
    'Transferir',
  );
}

// ---- Registro de acciones ---------------------------------------------------------------------

async function renderAuditLog() {
  $('#main').innerHTML = '<p class="empty">Cargando registro…</p>';
  const filter = usersState.auditAction || '';
  const { log } = await request('/api/audit' + (filter ? '?action=' + filter : ''));
  if (current || homeView !== 'users') return;
  const option = (value, label) => `<option value="${value}" ${filter === value ? 'selected' : ''}>${label}</option>`;
  $('#main').innerHTML = `
    <button class="back" type="button" data-users-tab="users">❮ Usuarios</button>
    <div class="home-title-row"><div><h1>Registro de acciones</h1><p class="muted">Las últimas 200 acciones delicadas: quién consultó lo que ve un alumno, suspendió o reactivó un acceso o transfirió un curso.</p></div></div>
    <div class="workspace-filterbar"><label class="filter-control">Acción<select data-audit-action>${option('', 'Todas')}${Object.entries(AUDIT_LABELS)
      .map(([k, v]) => option(k, v))
      .join('')}</select></label></div>
    <div class="table-wrap"><table class="users-table"><thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Persona</th><th>Curso</th><th>Detalle</th></tr></thead><tbody>${
      log
        .map(
          (l) => `<tr><td>${esc(fmt(l.created))}</td><td>${esc(l.actor_name || '—')}</td><td>${AUDIT_LABELS[l.action] || esc(l.action)}</td><td>${
            l.target_user ? `<button class="table-link" type="button" data-user-detail="${esc(l.target_user)}">${esc(l.target_name || 'Ver ficha')}</button>` : esc(auditPerson(l) || '—')
          }</td><td>${esc(l.course_name || '—')}</td><td>${l.action === 'ver_alumno' ? '' : esc(l.detail)}</td></tr>`,
        )
        .join('') || '<tr><td colspan="6" class="empty">Todavía no hay acciones registradas.</td></tr>'
    }</tbody></table></div>`;
}

// ---- Eventos ----------------------------------------------------------------------------------

document.addEventListener('input', (e) => {
  if (!e.target.matches?.('[data-users-search]')) return;
  clearTimeout(usersTimer);
  usersTimer = setTimeout(() => {
    usersState.q = e.target.value.trim();
    refreshUsersTable().catch((error) => toast(error.message));
  }, 300);
});

document.addEventListener('change', (e) => {
  if (e.target.matches?.('[data-users-role]')) usersState.role = e.target.value;
  else if (e.target.matches?.('[data-users-status]')) usersState.status = e.target.value;
  else if (e.target.matches?.('[data-audit-action]')) {
    usersState.auditAction = e.target.value;
    return renderAuditLog().catch((error) => toast(error.message));
  } else return;
  refreshUsersTable().catch((error) => toast(error.message));
});

document.addEventListener('click', async (e) => {
  const t = e.target.closest?.('[data-user-detail],[data-users-more],[data-users-tab],[data-user-suspend],[data-user-reactivate],[data-user-transfer],[data-user-view]');
  if (!t) return;
  const dialog = $('#modal');
  try {
    if (t.dataset.userDetail) {
      if (dialog.open) return closeDialogThen(dialog, () => userDetailModal(t.dataset.userDetail).catch((error) => toast(error.message)));
      return await userDetailModal(t.dataset.userDetail);
    }
    if (t.matches('[data-users-more]')) {
      const page = await request(usersQuery(usersState.next));
      usersState.list.push(...page.users);
      usersState.next = page.next;
      $('#usersTable').innerHTML = usersTableHtml();
      return;
    }
    if (t.dataset.usersTab) {
      usersState.tab = t.dataset.usersTab;
      return await renderUsers();
    }
    if (t.dataset.userSuspend) return closeDialogThen(dialog, () => suspendUserModal(t.dataset.userSuspend, t.dataset.name));
    if (t.dataset.userReactivate) {
      if (!confirm('¿Reactivar el acceso? Podrá volver a entrar de inmediato.')) return;
      await request('/api/users/reactivate', { user: t.dataset.userReactivate });
      toast('Acceso reactivado.');
      return closeDialogThen(dialog, () => userDetailModal(t.dataset.userReactivate).catch((error) => toast(error.message)));
    }
    if (t.dataset.userTransfer) return closeDialogThen(dialog, () => transferCourseModal(t.dataset.userTransfer, t.dataset.courseName, t.dataset.owner).catch((error) => toast(error.message)));
    if (t.dataset.userView) {
      // Abre el curso en la vista de ese alumno (solo lectura; el servidor registra la consulta).
      return closeDialogThen(dialog, async () => {
        try {
          homeView = 'courses';
          await openCourse(t.dataset.course, t.dataset.userView);
          toast(`Ves lo mismo que ${current.viewing?.name || 'el alumno'}. La consulta queda registrada.`);
        } catch (error) {
          toast(error.message);
        }
      });
    }
  } catch (error) {
    toast(error.message);
  }
});
