const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));
let homeView = 'courses';
/** Vista como alumno: el docente ve el curso con los filtros de un alumno (solo lectura). */
let previewAsStudent = false;
// Vista de un alumno concreto (id de su inscripción): lo que ve esa persona, en solo lectura y con registro.
let previewMember = null;
const viewSuffix = () => (previewMember ? '&as=m:' + encodeURIComponent(previewMember) : previewAsStudent ? '&as=student' : '');
/** Quién es "el alumno" en las pantallas de alumno: la persona que entró o, en la vista de un alumno, ese alumno. */
const viewerKey = () => (current?.viewing ? current.viewing.key : me?.id);
const myMember = () => (current?.viewing ? current.members.find((m) => m.id === current.viewing.id) : current?.members.find((m) => m.user_id === me?.id));
const PREVIEW_READONLY = 'Estás en la vista de alumno: aquí no se guardan cambios. Vuelve a la vista de docente para editar.';
let me = null, courses = [], current = null, section = 'hub', detail = null, moduleId = null, gradeTab = 'entry', busy = false, dirty = false;
const records = kind => current?.records.filter(r => r.kind === kind) || [], find = id => current?.records.find(r => r.id === id), teaches = () => !!current?.canTeach;
/** Vencimiento de una actividad para un alumno, con su prórroga si la tiene (solo el docente recibe las prórrogas). */
/**
 * Índices sobre los registros del curso: se arman una vez por cada carga (current.records se reemplaza completo al
 * recargar, nunca se modifica en su lugar) en vez de recorrer todo el curso en cada celda de las tablas.
 */
const recordIndexes = new WeakMap();
function indexed(source, name, build) {
  if (!source) return new Map();
  let bucket = recordIndexes.get(source);
  if (!bucket)
    recordIndexes.set(source, bucket = {});
  return bucket[name] ||= build(source);
}
const extensionOf = (taskId, memberId) => indexed(current?.records, 'extension', recs => new Map(recs.filter(r => r.kind === 'extension').map(r => [r.data.task + '|' + r.data.member, r]))).get(taskId + '|' + memberId);
const dueFor = (task, memberId) => extensionOf(task.id, memberId)?.data.due || sectionDateOf(task.id, memberId)?.due || task.data.due;
const fmt = v => v ? new Date(v).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'Sin fecha límite';
const localDate = v => {
  if (!v)
    return '';
  const d = new Date(v);
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const iso = v => v ? new Date(v).toISOString() : '';
const field = (label, name, value = '', type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const textarea = (label, name, value = '', required = true) => `<label>${label}<textarea name="${name}" ${required ? 'required' : ''}>${esc(value)}</textarea></label>`;
/** Interruptor para mostrar u ocultar un elemento a los alumnos con un toque. */
const visibilityToggle = (kind, r) => {
  const on = r.data.visible !== false;
  const later = scheduledFor(r);
  if (later) return `<button type="button" class="visibility-toggle is-scheduled" data-action="toggle-visible" data-kind="${kind}" data-id="${esc(r.id)}" aria-pressed="true" title="Toca para ocultarlo; se publicará en la fecha indicada si lo vuelves a mostrar">Programado · ${esc(fmt(later))}</button>`;
  return `<button type="button" class="visibility-toggle ${on ? '' : 'is-hidden'}" data-action="toggle-visible" data-kind="${kind}" data-id="${esc(r.id)}" aria-pressed="${on}" title="Toca para ${on ? 'ocultarlo a' : 'mostrarlo a'} los alumnos">${on ? 'Visible para alumnos' : 'Oculto para alumnos'}</button>`;
};
// Con `publishAt` (aunque sea vacío) agrega la publicación programada: visible, pero solo a partir de esa fecha.
const visible = (v, publishAt, sections = [], chooser = true) => `<label class="check-label"><input name="visible" type="checkbox" ${v !== false ? 'checked' : ''}> Visible para alumnos</label>${
  publishAt === undefined ? '' : `<label>Publicar a partir de (opcional)<input name="publishAt" type="datetime-local" value="${esc(localDate(publishAt))}"><small class="muted">Vacío = en cuanto esté visible. Con fecha, los alumnos lo ven (y reciben el aviso) desde ese momento.</small></label>`
}${chooser && typeof sectionChooserHtml === 'function' ? sectionChooserHtml(sections || []) : ''}`;
/** ¿Está programado para más adelante? (visible, pero su fecha de publicación aún no llega). */
const scheduledFor = (r) => (r?.data.visible !== false && r?.data.publishAt && Date.parse(r.data.publishAt) > Date.now() ? r.data.publishAt : '');
const button = (label, action, id = '', style = 'primary') => `<button class="${style}" data-action="${action}" ${id ? `data-id="${esc(id)}"` : ''}>${label}</button>`;
function toast(t) {
  $('#toast').textContent = t;
  $('#toast').style.display = 'block';
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => $('#toast').style.display = 'none', 5000);
}
async function request(path, data, method = 'POST') {
  if (previewAsStudent && data !== undefined && path.startsWith('/api/'))
    throw new Error(PREVIEW_READONLY);
  const r = await fetch(path, {
    method: data === undefined ? 'GET' : method,
    credentials: 'same-origin',
    headers: data === undefined ? {} : { 'Content-Type': 'application/json', 'X-Aula-Request': '1' },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const b = await r.json();
  // Examen abierto que bloquea la plataforma: cualquier otra pantalla lleva de vuelta al examen.
  if (r.status === 423 && b.activeExam && typeof goToActiveExam === 'function')
    goToActiveExam(b.activeExam).catch(() => {});
  // Alumno sin foto de perfil (por ejemplo, su docente se la quitó): se le pide tomarse otra.
  if (r.status === 428 && b.needsPhoto && typeof renderPhotoGate === 'function' && !document.querySelector('.photo-gate'))
    renderPhotoGate();
  if (!r.ok)
    throw Object.assign(new Error(b.error || 'No se pudo completar la operación.'), { status: r.status, login: b.login, data: b });
  return b;
}
async function reload() {
  if (current) {
    const next = await request('/api/course?id=' + encodeURIComponent(current.course.id) + viewSuffix());
    current = next;
  }
  else
    courses = await request('/api/courses');
  render();
}
async function openCourse(id, member = null) {
  // Al cambiar de curso se sale de la vista de alumno; `member` abre directamente la vista de ese alumno.
  if (current?.course.id !== id || member) {
    previewMember = member;
    previewAsStudent = Boolean(member);
  }
  const next = await request('/api/course?id=' + encodeURIComponent(id) + viewSuffix());
  current = next;
  section = 'hub';
  detail = null;
  moduleId = null;
  gradeTab = 'entry';
  render();
}
function nav() {
  return workspaceNav();
}
function empty(title, text, action = '', label = '') {
  return `<section class="empty-start"><h1>${title}</h1><p>${text}</p>${action ? button(label, action) : ''}</section>`;
}
function render() {
  richAttachments = null;
  nav();
  if (!current)
    return me?.role === 'admin' && homeView === 'teachers' ? renderTeachers() : me?.role === 'admin' && homeView === 'reports' ? renderReports() : me?.role === 'admin' && homeView === 'users' ? renderUsers() : homeView === 'calendar' ? renderCalendar() : homeView === 'avisos' ? renderNoticesPage() : renderHome();
  const routes = {
    hub: renderHub,
    content: renderContent,
    tasks: renderTasks,
    task: renderTask,
    editor: renderEditor,
    forums: renderForums,
    forum: renderForum,
    thread: renderThread,
    quizzes: renderQuizzes,
    quiz: renderQuiz,
    bank: renderBank,
    groups: renderGroups,
    grades: renderGrades,
    review: renderReview,
    members: renderMembers,
    access: renderAccess,
    attendance: renderAttendance,
    progress: renderProgress,
    admin: renderAdmin,
    trash: renderTrash,
    notices: renderNotices
  };
  (routes[section] || renderHub)();
}
function renderHome() {
  return workspaceHome();
}
function renderHub() {
  const c = current.course;
  $('#main').innerHTML = `<section class="hub-banner ${c.cover_updated ? 'has-cover' : ''}" data-theme="${courseThemeOf(c)}"${coverStyle(c)}><p class="hub-eyebrow">Grupo ${esc(c.group_name)}</p><h1>${esc(c.name)}</h1>${teaches() && !previewAsStudent ? button('✎ Editar curso y portada', 'edit-course', '', 'hub-edit') : ''}</section><div class="hub-grid"><div class="hub-side"><section class="panel hub-info ${c.intro ? '' : 'is-empty'}"><h2>Información del curso</h2><p class="muted">${esc(c.group_name)}</p>${richText(c.intro)}</section><section class="panel"><h2>Actividades</h2>${records('task').slice(-4).map(t => `<div class="task-row"><div><b>${esc(t.data.title)}</b><p class="deadline">${fmt(t.data.due)}</p>${button('Abrir →', 'task', t.id, 'text-btn')}</div></div>`).join('') || '<p class="muted">No hay actividades publicadas.</p>'}</section></div><div>${continueCardHtml()}<section class="panel"><div class="panel-head"><h2>Noticias</h2>${teaches() ? button('Crear publicación', 'new-notice', '', 'text-btn') : ''}</div>${noticeCards()}</section><section class="panel"><div class="panel-head"><h2>Contenido del curso</h2>${teaches() ? button('Nueva unidad', 'new-module', '', 'text-btn') : ''}</div><div class="module-cards">${records('module').map(m => `<button class="module-card" data-action="module" data-id="${m.id}"><div class="module-cover">${esc(m.data.title)}</div><span class="module-label">${m.data.visible === false ? 'Oculta' : teaches() ? (scheduledFor(m) ? 'Programada' : 'Abrir unidad') : myMember() && materialsOf(m.id).length ? `${unitProgress(m.id, myMember().id).done} de ${materialsOf(m.id).length} completados` : 'Abrir unidad'}</span></button>`).join('')}</div>${!records('module').length ? '<p class="muted">Agrega unidades para organizar los materiales.</p>' : ''}</section></div></div>`;
}
function fileLinks(ids = []) {
  return `<div class="file-list">${ids.map(id => {
    const f = current.files.find(f => f.id === id);
    if (!f)
      return '';
    const preview = previewKind(f.name) ? `<button type="button" class="preview-btn" data-preview="${esc(id)}" data-files="${esc(ids.join(','))}">Vista previa</button>` : '';
    return `<span class="file-item"><a href="/api/file/${encodeURIComponent(id)}">↓ ${esc(f.name)} · ${(f.size / 1024).toFixed(0)} KB</a>${preview}</span>`;
  }).join('')}</div>`;
}
function renderContent() {
  return workspaceContent();
}
function renderTasks() {
  return workspaceTasks();
}
function renderTask() {
  const t = find(detail);
  if (!t)
    return renderTasks();
  const subs = records('submission').filter(s => s.data.task === t.id), own = subs.find(s => s.data.member === myMember()?.id) || subs.find(s => s.author === viewerKey());
  $('#main').innerHTML = `<div class="crumbs"><button data-section="tasks">Actividades</button><span>›</span><span>${teaches() ? 'Envíos en carpeta' : 'Entrega'}</span></div><h1>${esc(t.data.title)}${sectionTag(t)}</h1><p class="deadline">Vence: ${fmt(t.data.due)}</p>${t.data.forum ? forumTaskNote(t) : ''}${t.data.extended ? `<p class="extension-note">Tienes acceso especial en esta actividad: ${esc([t.data.start && Date.parse(t.data.start) > Date.now() ? 'disponible desde ' + fmt(t.data.start) : '', t.data.due ? 'vence ' + fmt(t.data.due) : '', t.data.end ? 'cierra ' + fmt(t.data.end) : ''].filter(Boolean).join(', ') || 'puedes verla y entregarla')}.</p>` : ''}${!teaches() && t.data.groupCategory ? teamBannerHtml(t) : ''}${richText(t.data.body, t.data.fileIds)}<section class="task-materials"><div class="panel-head"><h2>Material del docente</h2>${teaches() ? button('＋ Subir archivos o presentaciones', 'task-files', t.id) : ''}</div>${fileLinks(t.data.fileIds)}${!t.data.fileIds?.length ? '<p class="muted">No hay archivos adjuntos a esta actividad.</p>' : ''}</section>${teaches() ? `<div class="toolbar">${button('Editar actividad', 'edit-task', t.id, 'secondary')}${button('Descargar entregas (ZIP)', 'zip-task', t.id, 'secondary')}${specialAccessButton('task', t.id)}${sectionFilterHtml()}</div>${sectionDatesSummary(t.id)}<div class="table-wrap"><table><thead><tr><th>Alumno</th>${courseSections().length ? '<th>Sección</th>' : ''}<th>Estado</th><th>Calificación</th><th>Acción</th></tr></thead><tbody>${studentsInView().filter(m => itemApplies(t, m)).map(m => {
    const s = subs.find(s => s.data.member === m.id);
    const ext = extensionOf(t.id, m.id);
    return `<tr><td><span class="person">${avatarHtml(m)}<span>${esc(m.name)}</span></span>${ext ? `<div class="table-subtext special-note">Acceso especial: ${esc(specialSummary({ start: ext.data.start, due: ext.data.due, end: ext.data.end }))}</div>` : ''}</td>${courseSections().length ? `<td>${esc(sectionName(m.section) || '—')}</td>` : ''}<td>${s ? s.data.manual ? 'Captura manual' : s.data.late ? 'Entrega tardía' : 'Entregado' : 'Sin entrega'}</td><td>${s?.data.grade ?? '—'}</td><td><button class="table-link" data-action="review" data-id="${t.id}" data-member="${m.id}">Evaluar →</button> <button type="button" class="text-btn" data-special-access="task" data-id="${esc(t.id)}" data-member="${esc(m.id)}">${ext ? 'Cambiar acceso' : 'Acceso especial'}</button></td></tr>`;
  }).join('') || '<tr><td colspan="4">Inscribe alumnos para revisar sus entregas.</td></tr>'}</tbody></table></div>` : `${own ? `<section class="panel"><h2>Tu entrega</h2><p class="deadline">${fmt(own.data.submitted)}${own.data.submitted ? ` <button type="button" class="text-btn" data-receipt="${esc(own.id)}">Comprobante</button>` : ''}</p>${richText(own.data.body)}${fileLinks(own.data.fileIds)}<p>Calificación: <b>${own.data.grade ?? 'Pendiente'}</b></p>${richText(own.data.feedback)}${rubricResultHtml(own.data.rubricScores)}</section>` : ''}${t.data.forum ? '' : `<div class="toolbar">${button(own ? 'Actualizar entrega' : 'Realizar entrega', 'submit', t.id)}</div>`}`}`;
}
function noticeCards() {
  // Una noticia programada lleva la fecha en que se publica (así la ven los alumnos) y, para el docente, la marca.
  const shownAt = n => (n.data.publishAt && n.data.publishAt > n.created ? n.data.publishAt : n.created);
  return records('notice').map(n => `<article class="notice"><h3>${esc(n.data.title)}${sectionTag(n)}${teaches() && n.data.visible === false ? ' <span class="role-pill">Oculta</span>' : teaches() && scheduledFor(n) ? ' <span class="role-pill scheduled-pill">Programada</span>' : ''}${teaches() && n.data.emailedAt ? ' <span class="role-pill">Enviada por correo</span>' : ''}</h3><p class="deadline">${fmt(shownAt(n))}</p>${richText(n.data.body)}${teaches() ? button('Editar', 'edit-notice', n.id, 'text-btn') : ''}</article>`).join('') || '<p class="muted">No hay noticias publicadas.</p>';
}
function renderNotices() {
  $('#main').innerHTML = `<div class="heading"><h1>Noticias</h1>${teaches() ? button('Crear publicación', 'new-notice') : ''}</div><section class="panel">${noticeCards()}</section>`;
}
function renderQuizzes() {
  $('#main').innerHTML = `<h1>Evaluaciones</h1><div class="home-tabs"><button class="active">${teaches() ? 'Administrar evaluaciones' : 'Mis evaluaciones'}</button>${teaches() ? '<button data-section="bank">Banco de preguntas</button>' : ''}</div><div class="toolbar">${teaches() ? button('Nueva evaluación', 'new-quiz') + button('Importar examen (Word, Excel o texto)', 'import-quiz', '', 'secondary') : ''}</div><div class="table-wrap"><table><thead><tr><th>Evaluación</th><th>Preguntas</th><th>Estado</th></tr></thead><tbody>${records('quiz').map(q => `<tr><td>${button(esc(q.data.title), 'quiz', q.id, 'table-link')}${sectionTag(q)}</td><td>${questionCountOf(q.data) < q.data.questions.length ? `${questionCountOf(q.data)} de ${q.data.questions.length} (al azar)` : questionCountOf(q.data)}</td><td>${teaches() ? (q.data.visible ? (scheduledFor(q) ? 'Programada · ' + esc(fmt(scheduledFor(q))) : 'Publicada') : 'Oculta') : esc(quizStudentStatus(q))}</td></tr>`).join('') || '<tr><td colspan="3">No hay evaluaciones.</td></tr>'}</tbody></table></div>`;
}
function gradeOf(member, task) {
  return records('submission').find(s => s.data.member === member && s.data.task === task);
}
function average(member) {
  return studentGrade(member).value;
}
function renderGrades() {
  const ts = records('task'), members = teaches() ? studentsInView() : [myMember()].filter(Boolean), w = records('weights')[0];
  // Columnas: con el filtro de secciones, solo las actividades que les tocan a esos alumnos.
  const cols = teaches() ? ts.filter(t => !t.data.sections?.length || members.some(m => itemApplies(t, m))) : ts;
  const grading = gradingSettings(), cats = grading.scheme === 'categories' ? grading.categories : [];
  ensureAttendanceForGrades();
  if (!teaches()) {
    $('#main').innerHTML = myGradesHtml();
    return;
  }
  $('#main').innerHTML = `<div class="home-tabs"><button data-grade-tab="entry" class="${gradeTab === 'entry' ? 'active' : ''}">${teaches() ? 'Ingresar calificaciones' : 'Mis calificaciones'}</button>${teaches() ? `<button data-grade-tab="manage" class="${gradeTab === 'manage' ? 'active' : ''}">Administrar calificaciones</button>` : ''}</div>${gradeTab === 'manage' && teaches() ? gradingManageHtml(`<h2 class="grading-subtitle">Pesos por actividad</h2><p class="real-status">Los pesos de todas las actividades deben sumar 100 %. Si agregas una nueva actividad, se usará el promedio simple hasta que vuelvas a guardar los pesos.</p><form id="weights" class="real-form"><div class="table-wrap"><table><thead><tr><th>Actividad</th><th>Peso (%)</th></tr></thead><tbody>${ts.map((t, i) => `<tr><td>${esc(t.data.title)}</td><td><input type="number" name="w_${t.id}" required min="0" max="100" step="0.01" class="grade-input" value="${w?.data.weights[t.id] ?? (i === ts.length - 1 ? 100 - Math.floor(10000 / ts.length) / 100 * (ts.length - 1) : Math.floor(10000 / ts.length) / 100).toFixed(2)}" aria-label="Peso de ${esc(t.data.title)}"></td></tr>`).join('')}</tbody></table></div><p class="form-error error" hidden></p>${ts.length ? '<div class="form-actions"><button class="primary">Guardar ponderaciones</button></div>' : '<p>Primero crea actividades.</p>'}</form>`) : `<div class="toolbar">${teaches() ? button('Exportar calificaciones', 'export-grades', '', 'secondary') + button('Importar calificaciones', 'import-grades', '', 'secondary') : ''}<input data-search type="search" placeholder="Buscar alumno…" aria-label="Buscar alumno">${sectionFilterHtml()}</div><p class="grade-note">${cats.length ? 'Promedio parcial por categorías' : `Promedio parcial ${w && ts.every(t => Number.isFinite(w.data.weights[t.id])) ? 'ponderado' : 'simple'}`}, de 0 a 10.${teaches() ? ` La calificación final aplica las reglas del curso (mínima aprobatoria ${grading.final.passing}).` : ''} Se excluyen las actividades sin calificar y se normalizan los pesos restantes.${countedQuizzes().length ? ` Incluye ${countedQuizzes().length === 1 ? 'una evaluación' : countedQuizzes().length + ' evaluaciones'} en línea dentro de su categoría.` : ' Las evaluaciones en línea y los foros cuentan cuando se les asigna una categoría (en Administrar calificaciones o al editarlos).'}</p><p class="grade-note">Escribe la calificación directamente en la tabla (Enter pasa al siguiente alumno). El ícono de documento abre la entrega del alumno; ⌄ junto a cada actividad tiene más opciones.</p><div class="table-wrap gradebook"><table><thead><tr><th class="sticky-name">Estudiante</th><th>Promedio parcial</th>${teaches() ? '<th>Calificación final</th><th>Asistencia</th>' : ''}${(grading.terms || []).filter(() => cats.length).map(t => `<th class="category-col term-col">${esc(t.name)}<div class="muted">${t.weight} % de la final</div></th>`).join('')}${cats.map(c => `<th class="category-col">${esc(categoryLabel(c, grading))}<div class="muted">${c.weight} %${c.term ? ' del parcial' : ''}</div></th>`).join('')}${cols.map(t => {
    const drafts = teaches() ? records('submission').filter(r => r.data.task === t.id && r.data.published === false).length : 0;
    return `<th class="gb-task-col"><div class="gb-col-head"><span>${esc(t.data.title)}${sectionTag(t)}</span>${gradebookColumnMenu(t)}</div>${drafts ? `<button class="table-link" data-action="publish-task" data-id="${t.id}">Publicar ${drafts} ${drafts === 1 ? 'borrador' : 'borradores'}</button>` : ''}</th>`;
  }).join('')}</tr></thead><tbody>${members.map(m => {
    const result = studentGrade(m.id), avg = result.value, fin = teaches() ? finalGrade(studentGrade(m.id, { final: true }).value, grading.final) : null;
    const pct = teaches() ? attendancePercentFor(m.id) : null;
    return `<tr data-search-row><td class="sticky-name"><span class="person">${avatarHtml(m)}<span>${esc(m.name)}<div class="muted">${esc(m.matricula || '')}</div></span></span></td><td class="${avg === null ? '' : avg >= grading.final.passing ? 'grade-pass' : 'grade-low'}">${avg === null ? '—' : avg.toFixed(2)}</td>${teaches() ? `<td class="final-grade ${fin === null ? '' : fin.passed ? 'grade-pass' : 'grade-low'}">${fin === null ? '—' : formatGrade(fin.value, grading.final.decimals)}</td><td class="gb-attendance ${pct === null ? '' : pct < (attendanceData?.settings?.min_percent ?? 0) ? 'grade-low' : 'grade-pass'}">${pct === null ? '—' : pct.toFixed(1) + ' %'}</td>` : ''}${(result.terms || []).map(t => `<td class="category-col term-col">${formatGrade(t.value)}</td>`).join('')}${result.categories.map(c => `<td class="category-col">${formatGrade(c.value)}</td>`).join('')}${cols.map(t => {
      const s = gradeOf(m.id, t.id);
      if (!itemApplies(t, m))
        return '<td class="grade-na" title="No es para su sección">—</td>';
      return `<td class="gb-cell">${teaches() ? gradebookCellHtml(t, m, s) : `${s?.data.grade ?? 'Pendiente'}${s?.data.feedback ? `<p class="grade-feedback">${esc(s.data.feedback)}</p>` : ''}`}</td>`;
    }).join('')}</tr>`;
  }).join('') || '<tr><td>No hay alumnos inscritos.</td></tr>'}</tbody></table></div>`}`;
  if ($('#weights'))
    bindForm('#weights', async (f) => {
      await save('weights', { weights: Object.fromEntries(ts.map(t => [t.id, Number(f.get('w_' + t.id))])) }, w);
      gradeTab = 'entry';
    });
  if (gradeTab === 'manage' && teaches())
    bindGradingManage();
}
let reviewMember = null;
let reviewOnlyPending = false;
const PUBLISH_KEY = 'enlace:publicar-al-guardar';
function reviewPublishNow() {
  try {
    return localStorage.getItem(PUBLISH_KEY) !== 'no';
  }
  catch {
    return true;
  }
}
function prefetchPreview(taskId, memberId) {
  const file = (gradeOf(memberId, taskId)?.data.fileIds || []).map(id => current.files.find(f => f.id === id)).find(f => f && previewKind(f.name));
  if (!file || document.querySelector(`link[data-prefetch="${file.id}"]`))
    return;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = `/api/file/${encodeURIComponent(file.id)}?preview=1`;
  link.dataset.prefetch = file.id;
  document.head.append(link);
}
function renderReview() {
  const t = find(detail), m = current.members.find(m => m.id === reviewMember), s = gradeOf(reviewMember, detail);
  if (!t || !m)
    return renderGrades();
  const students = studentsInView().some(x => x.id === m.id) ? studentsInView() : current.members.filter(x => x.role === 'student');
  const hasGrade = x => {
    const g = gradeOf(x.id, t.id)?.data.grade;
    return g !== null && g !== undefined;
  };
  const needsGrade = x => Boolean(gradeOf(x.id, t.id)?.data.submitted) && !hasGrade(x);
  const queue = reviewOnlyPending ? students.filter(x => x.id === m.id || needsGrade(x)) : students;
  const index = queue.findIndex(x => x.id === m.id), prev = queue[index - 1], next = queue[index + 1];
  const files = s?.data.fileIds || [];
  const previewable = files.filter(id => previewKind(current.files.find(f => f.id === id)?.name));
  const team = teamFor(t, m.id);
  $('#main').innerHTML = `<div class="review-bar"><button class="back" data-section="grades">❮ Volver a calificaciones</button>
    <div class="review-nav" role="navigation" aria-label="Cambiar de alumno">
      <button class="secondary" data-action="review" data-id="${t.id}" data-member="${prev?.id || ''}" ${prev ? '' : 'disabled'}>‹ Anterior</button>
      <select id="reviewJump" aria-label="Ir a otro alumno">${queue.map((x, i) => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>${i + 1}. ${esc(x.name)}${needsGrade(x) ? ' (sin calificar)' : ''}</option>`).join('')}</select>
      <button class="secondary" data-action="review" data-id="${t.id}" data-member="${next?.id || ''}" ${next ? '' : 'disabled'}>Siguiente ›</button>
    </div>
    <label class="review-filter"><input type="checkbox" id="reviewPending" ${reviewOnlyPending ? 'checked' : ''}> Solo entregas sin calificar</label></div>
    <h1>${esc(m.name)}</h1><p class="muted">${esc(t.data.title)}. ${students.filter(hasGrade).length} de ${students.length} calificados.</p>
    <div class="review-grid"><section class="submission-preview"><h2>Material enviado</h2>
      <p class="deadline">${s?.data.submitted ? fmt(s.data.submitted) : 'Sin entrega registrada'}${s?.data.late ? ' · Tardía' : ''}</p>
      ${previewable.length ? '<div class="inline-preview" id="inlinePreview"></div>' : ''}
      ${s?.data.body || !s?.data.submitted ? `<p class="submitted-text">${esc(s?.data.body || 'Puedes registrar una calificación manual, por ejemplo, de un examen escrito.')}</p>` : ''}
      ${s?.data.submitted ? `<p><button type="button" class="text-btn" data-receipt="${esc(s.id)}">Ver comprobante y folio</button></p>` : ''}
      ${fileLinks(files)}</section>
    <form class="review-panel real-form" id="reviewForm"><h2>Evaluación</h2>
      ${s && s.data.published === false ? '<p class="draft-note">Borrador: el alumno todavía no ve esta calificación.</p>' : ''}
      ${rubricWidgetHtml(t, s)}${field('Calificación / 10', 'grade', s?.data.grade ?? '', 'number', 'min="0" max="10" step="0.01" required')}
      ${textarea('Comentarios generales', 'feedback', s?.data.feedback || '', false)}
      ${team ? `<label class="check-row"><input type="checkbox" name="team" checked> Aplicar a todo el equipo (${esc(team.data.title)}: ${esc(teamNames(team))})</label>` : ''}<label class="check-row"><input type="checkbox" name="publish" ${reviewPublishNow() ? 'checked' : ''}> Publicar al guardar (el alumno la verá de inmediato)</label>
      <p class="form-error error" hidden></p>
      <div class="review-actions">${next ? '<button class="primary" type="submit" value="next">Guardar y siguiente</button><button class="secondary" type="submit" value="stay">Guardar</button>' : '<button class="primary" type="submit" value="stay">Guardar</button>'}</div>
      ${s ? `<p><button type="button" class="text-btn" data-grade-history="${esc(m.id)}" data-task="${esc(t.id)}">Ver historial de esta calificación</button></p>` : ''}
      <p class="muted review-keys">Con teclado: ← y → cambian de alumno cuando no estás escribiendo.</p></form></div>`;
  mountInlinePreview(previewable.length ? $('#inlinePreview') : null, previewable[0], previewable);
  if (next)
    prefetchPreview(t.id, next.id);
  $('#reviewJump').onchange = e => {
    if (dirty && !confirm('Hay cambios sin guardar. ¿Quieres salir de esta pantalla?')) {
      e.target.value = m.id;
      return;
    }
    dirty = false;
    reviewMember = e.target.value;
    render();
  };
  $('#reviewPending').onchange = e => {
    reviewOnlyPending = e.target.checked;
    render();
  };
  bindForm('#reviewForm', async (f, submitter) => {
    const publish = f.get('publish') === 'on';
    try {
      localStorage.setItem(PUBLISH_KEY, publish ? 'si' : 'no');
    }
    catch { }
    await request('/api/grade', {
      course: current.course.id,
      task: t.id,
      member: m.id,
      revision: s?.revision,
      grade: Number(f.get('grade')),
      feedback: f.get('feedback'),
      publish,
      rubric: collectRubric(),
      team: f.get('team') === 'on'
    });
    const goNext = submitter?.value === 'next' && next;
    if (goNext)
      reviewMember = next.id;
    section = 'review';
    return `${publish ? 'Calificación publicada' : 'Borrador guardado'}.${goNext ? ` Sigue ${next.name}.` : ''}`;
  });
}
document.addEventListener('keydown', e => {
  if (section !== 'review' || e.altKey || e.ctrlKey || e.metaKey || !['ArrowLeft', 'ArrowRight'].includes(e.key))
    return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]'))
    return;
  const buttons = document.querySelectorAll('.review-nav button');
  const target = e.key === 'ArrowLeft' ? buttons[0] : buttons[buttons.length - 1];
  if (target && !target.disabled) {
    e.preventDefault();
    target.click();
  }
});
function renderGroups() {
  return workspaceGroups();
}
function renderMembers() {
  $('#main').innerHTML = `<h1>Listado de alumnos</h1><div class="toolbar">${teaches() ? button('Inscribir alumno', 'new-member') + button('Importar lista', 'bulk-members', '', 'secondary') + button(courseSections().length ? 'Secciones' : 'Crear secciones', 'sections', '', 'secondary') + '<button class="secondary" type="button" data-section="access">Accesos</button>' : ''}<input data-search type="search" placeholder="Buscar…" aria-label="Buscar alumno">${sectionFilterHtml()}</div>${teaches() ? '<p class="real-status">La inscripción vincula el curso al correo del alumno: verá el curso cuando entre con ese mismo correo (su cuenta de Microsoft o de Google). No se envían invitaciones. «Ver lo que ve» muestra el curso exactamente como lo ve ese alumno (solo lectura; la consulta queda registrada).</p>' : ''}${coTeachersPanel()}<div class="table-wrap"><table><thead><tr><th>Nombre</th>${teaches() ? `<th>Matrícula</th>${courseSections().length ? '<th>Sección</th>' : ''}<th>Correo</th><th>Estado</th><th>Acción</th>` : courseSections().length ? '<th>Sección</th>' : ''}</tr></thead><tbody>${(teaches() ? studentsInView() : current.members.filter(m => m.role === 'student')).map(m => `<tr data-search-row><td>${teaches() ? `<span class="person">${avatarHtml(m)}<span>${esc(m.name)}</span></span>` : esc(m.name)}</td>${!teaches() && courseSections().length ? `<td>${esc(sectionName(m.section) || '—')}</td>` : ''}${teaches() ? `<td>${esc(m.matricula)}</td>${courseSections().length ? `<td>${memberSectionSelect(m)}</td>` : ''}<td>${esc(m.email)}</td><td>${m.user_id ? 'Cuenta vinculada' : 'Pendiente de ingreso'}</td><td><div class="row-actions">${button('Editar', 'edit-member', m.id, 'text-btn')}${button('Ver lo que ve', 'view-member', m.id, 'text-btn')}${button('Retirar', 'remove-member', m.id, 'text-btn')}${m.photo ? `<button type="button" class="text-btn" data-member-photo-delete="${esc(m.id)}">Quitar foto</button>` : ''}</div></td>` : ''}</tr>`).join('') || '<tr><td>No hay alumnos inscritos.</td></tr>'}</tbody></table></div>`;
}
// ---- Accesos (12.20): inicios de sesión durante el curso e ingresos al curso de alumnos y docentes ----
let accessData = null;
let accessSort = 'name';
const accessWhen = v => v ? fmt(v) : '—';
async function renderAccess() {
  const courseId = current.course.id;
  if (!accessData || accessData.course !== courseId || Date.now() - accessData.at > 60000) {
    $('#main').innerHTML = '<p class="empty">Cargando accesos…</p>';
    try {
      accessData = { course: courseId, at: Date.now(), ...(await request('/api/course/access?id=' + encodeURIComponent(courseId))) };
    }
    catch (error) {
      $('#main').innerHTML = `<section class="error"><h2>No se pudieron cargar los accesos</h2><p>${esc(error.message)}</p></section>`;
      return;
    }
    if (section !== 'access' || current?.course.id !== courseId)
      return;
  }
  const inView = new Set(studentsInView().map(m => m.id));
  const teachers = accessData.people.filter(p => p.role === 'teacher');
  const order = {
    name: (a, b) => a.name.localeCompare(b.name, 'es'),
    fewest: (a, b) => a.visits - b.visits || a.logins - b.logins || a.name.localeCompare(b.name, 'es'),
    most: (a, b) => b.visits - a.visits || b.logins - a.logins || a.name.localeCompare(b.name, 'es'),
    recent: (a, b) => String(b.lastVisit || '').localeCompare(String(a.lastVisit || '')) || a.name.localeCompare(b.name, 'es')
  }[accessSort] || ((a, b) => a.name.localeCompare(b.name, 'es'));
  const students = accessData.people.filter(p => p.role === 'student' && inView.has(p.member)).sort(order);
  const never = students.filter(p => !p.visits).length;
  const week = students.filter(p => p.lastVisit && Date.now() - Date.parse(p.lastVisit) < 7 * 86400000).length;
  const cells = p => `<td>${p.account ? p.logins : '<span class="muted">Sin cuenta</span>'}</td><td>${accessWhen(p.lastLogin)}</td><td>${p.visits}</td><td>${accessWhen(p.lastVisit)}</td>`;
  const head = first => `<thead><tr><th>${first}</th>${courseSections().length && first === 'Alumno' ? '<th>Sección</th>' : ''}<th>Inicios de sesión</th><th>Último inicio</th><th>Ingresos al curso</th><th>Último ingreso</th></tr></thead>`;
  const tile = (value, label) => `<div class="stat-tile"><strong>${value}</strong><span>${label}</span></div>`;
  $('#main').innerHTML = `<button class="back" data-section="members">❮ Listado de alumnos</button>
    <div class="home-title-row"><div><h1>Accesos</h1><p class="muted">Desde que se creó el curso (${esc(fmt(accessData.since))})${accessData.until ? ` hasta que se archivó (${esc(fmt(accessData.until))})` : ' hasta hoy'}.</p></div>
      <div class="action-row"><button class="secondary" type="button" data-access-csv>Descargar CSV</button></div></div>
    <div class="stat-tiles">${tile(students.length, 'alumnos')}${tile(week, 'entraron al curso en los últimos 7 días')}${tile(never, 'nunca han entrado al curso')}</div>
    <p class="real-status"><b>Inicios de sesión</b>: veces que la persona entró a Enlace con su cuenta (Google o Microsoft) mientras el curso ha estado activo; cada sesión dura 14 días en ese dispositivo, así que quien no cierra sesión tiene pocos inicios aunque entre a diario. <b>Ingresos al curso</b>: veces que abrió este curso (volver después de 30 minutos cuenta como otro ingreso).</p>
    <section class="panel"><h2>Docentes</h2><div class="table-wrap"><table>${head('Docente')}<tbody>${teachers.map(p => `<tr><td>${esc(p.name)}${p.owner ? ' <span class="role-pill">Titular</span>' : ''}</td>${cells(p)}</tr>`).join('')}</tbody></table></div></section>
    <section class="panel"><h2>Alumnos</h2><div class="toolbar"><input data-search type="search" placeholder="Buscar alumno…" aria-label="Buscar alumno">${sectionFilterHtml()}
      <label class="inline-label">Ordenar <select data-access-sort>${[['name', 'Por nombre'], ['fewest', 'Menos ingresos primero'], ['most', 'Más ingresos primero'], ['recent', 'Ingreso más reciente']].map(([v, l]) => `<option value="${v}" ${accessSort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="table-wrap"><table>${head('Alumno')}<tbody>${students.map(p => {
        const m = current.members.find(x => x.id === p.member);
        return `<tr data-search-row${p.visits ? '' : ' class="access-never"'}><td><span class="person">${m ? avatarHtml(m) : ''}<span>${esc(p.name)}</span></span></td>${courseSections().length ? `<td>${esc(sectionName(p.section) || '—')}</td>` : ''}${cells(p)}</tr>`;
      }).join('') || '<tr><td colspan="6">No hay alumnos en esta vista.</td></tr>'}</tbody></table></div></section>`;
}
function accessCsv() {
  const inView = new Set(studentsInView().map(m => m.id));
  const rows = [['Nombre', 'Rol', 'Sección', 'Inicios de sesión durante el curso', 'Último inicio de sesión', 'Ingresos al curso', 'Primer ingreso', 'Último ingreso']];
  for (const p of accessData.people.filter(p => p.role === 'teacher' || inView.has(p.member)))
    rows.push([p.name, p.role === 'teacher' ? (p.owner ? 'Docente titular' : 'Co-docente') : 'Alumno', sectionName(p.section), p.account ? p.logins : 'Sin cuenta', accessWhen(p.lastLogin), p.visits, accessWhen(p.firstVisit), accessWhen(p.lastVisit)]);
  download(`accesos-${current.course.name}-${current.course.group_name}.csv`, '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
document.addEventListener('change', e => {
  if (!e.target.matches('[data-access-sort]'))
    return;
  accessSort = e.target.value;
  render();
});
document.addEventListener('click', e => {
  if (e.target.closest('[data-access-csv]') && accessData)
    accessCsv();
});
function renderAdmin() {
  $('#main').innerHTML = `<h1>Administración del curso</h1><section class="admin-section"><h2>Configuración</h2><div class="admin-links">${button('Información del curso', 'edit-course', '', 'table-link')}${button('Copiar a un nuevo periodo', 'copy-course', '', 'table-link')}${current.canDelete ? button(current.course.archived_at ? 'Desarchivar curso' : 'Archivar curso', 'archive-course', '', 'table-link') : ''}${button('Exportar respaldo del curso', 'backup', '', 'table-link')}${current.canDelete ? button('Eliminar curso / grupo', 'delete-course', current.course.id, 'danger-link') : ''}</div></section><section class="admin-section"><h2>Administración de estudiantes</h2><div class="admin-links"><button class="table-link" data-section="members">Listado de alumnos</button><button class="table-link" data-section="groups">Equipos de trabajo</button><button class="table-link" data-section="progress">Progreso de la clase</button><button class="table-link" data-section="access">Accesos de alumnos y docentes</button></div></section><section class="admin-section"><h2>Evaluación</h2><div class="admin-links"><button class="table-link" data-section="tasks">Actividades</button><button class="table-link" data-section="grades">Calificaciones</button><button class="table-link" data-section="quizzes">Evaluaciones</button></div></section><section class="admin-section"><h2>Papelera</h2><div class="admin-links"><button class="table-link" data-section="trash">Elementos eliminados</button></div><p class="muted">Lo que eliminas del curso se puede restaurar desde aquí con todo su contenido, entregas y calificaciones.</p></section><p class="real-status">El respaldo exporta registros y metadatos en JSON. Descarga los archivos adjuntos por separado. Conserva copias periódicas fuera de la plataforma.</p>`;
}
async function save(kind, data, old) {
  // «¿Para qué secciones?» del editor abierto (si el curso tiene secciones).
  const chooser = document.querySelector('#modal[open] [data-section-chooser], #taskEditor [data-section-chooser]');
  if (chooser && data.sections === undefined) data = { ...data, sections: readSectionChooser(chooser) };
  // Condiciones de liberación (12.23) del editor abierto.
  if (data.conditions === undefined && typeof readConditions === 'function') {
    const conditions = readConditions();
    if (conditions !== undefined) data = { ...data, conditions };
  }
  return request('/api/record', {
    course: current.course.id,
    kind,
    data,
    id: old?.id,
    revision: old?.revision
  });
}
function bindForm(selector, handler) {
  const form = $(selector);
  form.addEventListener('input', () => dirty = true);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (busy)
      return;
    const submit = form.querySelector('button[type=submit],button.primary'), err = form.querySelector('.form-error');
    busy = true;
    if (submit)
      submit.disabled = true;
    if (err)
      err.hidden = true;
    try {
      const message = await handler(new FormData(form), e.submitter);
      dirty = false;
      await reload();
      toast(typeof message === 'string' ? message : 'Guardado correctamente.');
    }
    catch (e) {
      if (err) {
        err.textContent = e.message;
        err.hidden = false;
      }
      else
        toast(e.message);
    }
    finally {
      busy = false;
      if (submit)
        submit.disabled = false;
    }
  };
}
function modal(title, html, handler, saveLabel = 'Guardar') {
  richAttachments = null;
  $('#formSave').classList.remove('danger-button');
  $('#modalTitle').textContent = title;
  $('#fields').innerHTML = `<div class="real-form">${html}</div>`;
  $('#formError').textContent = '';
  $('#formSave').hidden = !handler;
  $('#formSave').textContent = saveLabel;
  $('#form').onsubmit = async (e) => {
    e.preventDefault();
    if (!handler || busy)
      return;
    busy = true;
    $('#formSave').disabled = true;
    $('#formError').textContent = '';
    try {
      const message = await handler(new FormData(e.target));
      $('#modal').close();
      await reload();
      toast(typeof message === 'string' ? message : 'Guardado correctamente.');
    }
    catch (e) {
      $('#formError').textContent = e.message;
    }
    finally {
      busy = false;
      $('#formSave').disabled = false;
    }
  };
  $('#modal').showModal();
}
/** «Mi perfil»: recibir (o no) el resumen diario por correo. Solo si la administración configuró el correo. */
function emailDigestHtml() {
  if (!me.mailEnabled)
    return '';
  return `<label class="check-label email-digest"><input type="checkbox" data-email-digest ${me.emailDigest ? 'checked' : ''}> Recibir por correo un resumen diario de lo nuevo (noticias, actividades, calificaciones y lo que vence pronto)</label>`;
}
document.addEventListener('change', async (e) => {
  if (!e.target.matches('[data-email-digest]'))
    return;
  const box = e.target;
  box.disabled = true;
  try {
    const r = await request('/api/profile/notifications', { digest: box.checked });
    me.emailDigest = r.digest;
    toast(r.digest ? 'Recibirás el resumen diario en ' + me.email + '.' : 'Ya no recibirás el resumen por correo.');
  }
  catch (error) {
    box.checked = !box.checked;
    toast(error.message);
  }
  finally {
    box.disabled = false;
  }
});
/** Noticia: enviarla también por correo en ese momento (una sola vez). */
function noticeEmailHtml(old) {
  if (!me.mailEnabled)
    return '';
  if (old?.data.emailedAt)
    return `<p class="real-status">Enviada por correo a los alumnos el ${esc(fmt(old.data.emailedAt))}.</p>`;
  return `<label class="check-label"><input type="checkbox" name="emailNow"> Enviar también por correo ahora a los alumnos a los que va dirigida</label><p class="muted">Úsalo solo para avisos urgentes (cambio de salón, clase suspendida): se envía una sola vez. Lo demás llega en el resumen diario.</p>`;
}
async function emailNotice(saved) {
  try {
    const r = await request('/api/notice/email', { course: current.course.id, id: saved.id });
    return r.error && !r.sent ? `Guardada, pero no se envió por correo: ${r.error}` : `Guardada y enviada por correo a ${r.sent} ${r.sent === 1 ? 'alumno' : 'alumnos'}.${r.skipped ? ` ${r.skipped} quedaron sin enviar: ${r.error || ''}` : ''}`;
  }
  catch (error) {
    return `Guardada, pero no se envió por correo: ${error.message}`;
  }
}
function simpleRecord(kind, old) {
  const names = {
    module: 'unidad',
    notice: 'publicación',
    forum: 'foro'
  };
  // Las unidades llevan archivos (programa, presentaciones, imágenes dentro del texto); noticias y foros, solo texto.
  const withFiles = kind === 'module';
  let files = null;
  modal(`${old ? 'Editar' : 'Crear'} ${names[kind]}`, field('Título', 'title', old?.data.title || '', 'text', 'required maxlength="200"') + richTextarea(kind === 'module' ? 'Descripción de la unidad' : 'Contenido', 'body', old?.data.body || '', { images: withFiles }) + (withFiles ? attachmentPanel(true, 'la unidad') : '') + visible(old?.data.visible, old?.data.publishAt || '', old?.data.sections) + (kind === 'module' ? conditionsEditorHtml(old) : '') + (kind === 'notice' ? noticeEmailHtml(old) : '') + (old ? `<p class="modal-danger">${trashButton(kind, old.id, 'Eliminar ' + names[kind])}</p>` : ''), async (f) => {
    const data = {
      title: f.get('title'),
      body: f.get('body'),
      visible: f.get('visible') === 'on',
      publishAt: iso(f.get('publishAt'))
    };
    if (files)
      data.fileIds = await files.upload();
    const saved = await save(kind, data, old);
    dirty = false;
    if (f.get('emailNow') === 'on')
      return emailNotice(saved);
  });
  if (withFiles)
    richAttachments = files = attachmentManager($('#fields'), old?.data.fileIds || [], 'material');
}
function materialModal(old) {
  const d = old?.data || {};
  let files = null;
  modal(old ? 'Editar material' : 'Agregar material', field('Título', 'title', d.title || '', 'text', 'required') + `<label>Unidad<select name="module"><option value="">Sin unidad</option>${records('module').map(m => `<option value="${m.id}" ${(d.module || moduleId) === m.id ? 'selected' : ''}>${esc(m.data.title)}</option>`).join('')}</select></label>` + richTextarea('Descripción', 'body', d.body || '', { images: true }) + field('Enlace (opcional)', 'url', d.url || '', 'url') + attachmentPanel(true, 'este material') + visible(d.visible, d.publishAt || '', d.sections) + conditionsEditorHtml(old) + (old ? `<p class="modal-danger">${trashButton('material', old.id, 'Eliminar material')}</p>` : ''), async (f) => {
    await save('material', {
      title: f.get('title'),
      body: f.get('body'),
      url: f.get('url'),
      module: f.get('module') || null,
      visible: f.get('visible') === 'on',
      publishAt: iso(f.get('publishAt')),
      fileIds: await files.upload()
    }, old);
    dirty = false;
  });
  richAttachments = files = attachmentManager($('#fields'), d.fileIds || [], 'material');
}
function groupModal(old) {
  modal(old ? 'Editar grupo' : 'Nuevo grupo', field('Nombre', 'title', old?.data.title || '', 'text', 'required') + field('Categoría', 'category', old?.data.category || 'Equipos de trabajo', 'text', 'required') + `<fieldset class="member-list"><legend>Integrantes</legend>${current.members.filter(m => m.role === 'student').map(m => `<label><input type="checkbox" name="m_${m.id}" ${old?.data.members.includes(m.id) ? 'checked' : ''}> ${esc(m.name)}</label>`).join('')}</fieldset>`, f => save('group', {
    title: f.get('title'),
    category: f.get('category'),
    members: current.members.filter(m => f.get('m_' + m.id) === 'on').map(m => m.id),
    visible: true
  }, old));
}
function courseModal(edit = false) {
  const c = edit ? current.course : null;
  const theme = c?.theme || 0;
  const swatches = `<fieldset class="theme-picker"><legend>Color de la portada</legend><div class="theme-swatches">${[0, 1, 2, 3, 4, 5, 6]
    .map((n) => `<label class="theme-swatch" data-theme="${n || (c ? courseTheme(c.id) : 1)}" title="${n ? 'Color ' + n : 'Automático'}"><input type="radio" name="theme" value="${n}" ${theme === n ? 'checked' : ''}><span>${n ? '' : 'Auto'}</span></label>`)
    .join('')}</div></fieldset>`;
  const cover = `<fieldset class="cover-picker"><legend>Imagen de portada (opcional)</legend>
    <div class="cover-preview ${c?.cover_updated ? 'has-cover' : ''}" data-theme="${c ? courseThemeOf(c) : 1}"${c ? coverStyle(c) : ''} id="coverPreview"><span>${esc(c?.name || 'Tu curso')}</span></div>
    <div class="action-row"><label class="secondary file-button">${c?.cover_updated ? 'Cambiar imagen' : 'Elegir imagen'}<input type="file" accept="image/jpeg,image/png,image/webp" name="coverFile" hidden></label>
    ${c?.cover_updated ? '<label class="check-label"><input type="checkbox" name="coverRemove"> Quitar la imagen</label>' : ''}</div>
    <p class="muted">Una foto horizontal se ve mejor (por ejemplo, 1600 × 600). Se reduce en tu dispositivo antes de subirla.</p></fieldset>`;
  modal(edit ? 'Editar curso' : 'Crear curso', field('Nombre de la materia', 'name', c?.name || '', 'text', 'required maxlength="150"') + field('Grupo', 'group', c?.group_name || '', 'text', 'required maxlength="100"') + field('Periodo', 'period', c?.period || '', 'text', 'maxlength="60" placeholder="Por ejemplo: Otoño 2026"') + (edit ? '' : field('Secciones (opcional)', 'sections', '', 'text', 'maxlength="300" placeholder="Por ejemplo: 5AV, 5BV, 5CV"') + '<p class="muted">¿La misma materia con varios grupos? Crea un solo curso y escribe aquí sus secciones: el contenido es el mismo para todos y en cada pantalla filtras por sección.</p>') + textarea('Presentación', 'intro', c?.intro || '', false) + swatches + cover, async f => {
    const result = await request(edit ? '/api/course' : '/api/courses', {
      course: c?.id,
      name: f.get('name'),
      group: f.get('group'),
      period: f.get('period'),
      intro: f.get('intro'),
      theme: Number(f.get('theme') || 0)
    });
    const courseId = edit ? c.id : result.id;
    const file = f.get('coverFile');
    if (file && file.size) await uploadCourseCover(courseId, file);
    else if (f.get('coverRemove') === 'on') await request('/api/course/cover/delete', { course: courseId });
    const names = edit ? [] : String(f.get('sections') || '').split(',').map(x => x.trim()).filter(Boolean);
    for (const name of names) await request('/api/sections', { course: courseId, name });
    return names.length ? `Curso creado con ${names.length} ${names.length === 1 ? 'sección' : 'secciones'}.` : edit ? 'Curso actualizado.' : undefined;
  });
}
/** Color del curso: el que eligió el docente o uno automático por su id. */
const courseThemeOf = (c) => c?.theme || courseTheme(c?.id);
/** Estilo con la imagen de portada del curso (si tiene). */
const coverStyle = (c) => (c?.cover_updated ? ` style="--cover:url('/api/course-cover/${encodeURIComponent(c.id)}?v=${encodeURIComponent(c.cover_updated)}')"` : '');
/** Sube la portada ya reducida en el navegador (máx. 1.5 MB). */
async function uploadCourseCover(courseId, file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Usa una imagen JPG, PNG o WEBP.');
  const blob = await compressImage(file);
  if (blob.size > 1.5 * 1024 * 1024) throw new Error('La imagen sigue siendo muy grande (máximo 1.5 MB). Elige otra más ligera.');
  const r = await fetch('/api/course/cover?course=' + encodeURIComponent(courseId), { method: 'POST', credentials: 'same-origin', headers: { 'X-Aula-Request': '1', 'content-type': blob.type || file.type }, body: blob });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'No se pudo subir la portada.');
  return data;
}
/** Corregir los datos de un alumno inscrito. */
function memberModal(m) {
  if (!m) return;
  const sections = courseSections();
  modal('Editar alumno', field('Nombre completo', 'name', m.name, 'text', 'required maxlength="150"') + field('Matrícula', 'matricula', m.matricula || '', 'text', 'maxlength="50"') + field('Correo de su cuenta', 'email', m.email || '', 'email', 'required') + (sections.length ? `<label>Sección<select name="section"><option value="">Sin sección</option>${sections.map(x => `<option value="${esc(x.id)}" ${m.section === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : '') + `<p class="muted">${m.user_id ? 'Ya entró con su cuenta. Si cambias el correo, tendrá que entrar con el correo nuevo; sus entregas y calificaciones se conservan.' : 'Todavía no entra: verá el curso cuando inicie sesión con este correo.'}</p>`, async f => {
    await request('/api/member/update', {
      course: current.course.id,
      id: m.id,
      name: f.get('name'),
      matricula: f.get('matricula'),
      email: f.get('email'),
      ...(sections.length ? { section: f.get('section') || '' } : {})
    });
    return 'Datos del alumno actualizados.';
  });
}
/** Co-docentes del curso: los ve todo el curso; el propietario o la administración los agregan y retiran. */
function coTeachersPanel() {
  const list = current.members.filter(m => m.role === 'teacher');
  if (!list.length && !current.canDelete)
    return '';
  return `<section class="panel coteachers"><div class="panel-head"><h2>Docentes del curso</h2>${current.canDelete ? button('＋ Agregar co-docente', 'add-coteacher', '', 'text-btn') : ''}</div>${list.map(m => `<div class="coteacher-row"><strong>${esc(m.name)}</strong>${m.email ? `<span class="muted">${esc(m.email)}</span>` : ''}${current.canDelete ? button('Retirar', 'remove-coteacher', m.id, 'danger-link') : ''}</div>`).join('') || '<p class="muted">Comparte el curso con otro docente (por ejemplo, titular y adjunto, o teoría y laboratorio): podrá editar el contenido, calificar y pasar lista, pero no borrar el curso.</p>'}</section>`;
}
/** Copia la estructura del curso actual a un curso nuevo (siguiente periodo) y lo abre. */
function copyCourseModal() {
  const c = current.course;
  modal('Copiar a un nuevo periodo', `<p>Se crea un curso nuevo con las unidades, materiales, noticias, foros, evaluaciones, actividades, categorías y reglas de calificación y de asistencia de <strong>${esc(c.name)}</strong>. No se copian alumnos, entregas, calificaciones, publicaciones de foro ni equipos. Los archivos se comparten: no ocupan espacio extra.</p>` + field('Nombre de la materia', 'name', c.name, 'text', 'required maxlength="150"') + field('Grupo', 'group', c.group_name, 'text', 'required maxlength="100"') + field('Periodo', 'period', '', 'text', 'maxlength="60" placeholder="Por ejemplo: Primavera 2027"') + '<label class="check-label"><input type="checkbox" name="keepDates"> Conservar las fechas de las actividades (normalmente se dejan vacías para el nuevo periodo)</label>', async (f) => {
    const { id, copied } = await request('/api/course/copy', { course: c.id, name: f.get('name'), group: f.get('group'), period: f.get('period'), keepDates: f.get('keepDates') === 'on' });
    await openCourse(id);
    return `Curso copiado: ${copied.content} elementos de contenido y ${copied.tasks} actividades. Revisa las fechas e inscribe a tus alumnos.`;
  }, 'Copiar curso');
}
async function toggleArchive() {
  const archived = !current.course.archived_at;
  if (archived && !confirm('¿Archivar este curso? Quedará de solo lectura para todos: se puede consultar y descargar, pero no hacer entregas ni cambios. Puedes desarchivarlo cuando quieras.'))
    return;
  await request('/api/course/archive', { course: current.course.id, archived });
  await reload();
  toast(archived ? 'Curso archivado.' : 'El curso vuelve a estar activo.');
}
/** Nombre del archivo descargado sin acentos: con acentos, Chromium descarta el nombre y guarda "download". */
function asciiFileName(name) {
  return String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.()\- ]+/g, '_').replace(/\s+/g, ' ').trim() || 'archivo';
}
function download(name, text, type) {
  const a = document.createElement('a'), url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url;
  a.download = asciiFileName(name);
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function exportGrades() {
  const grading = gradingSettings(), cats = grading.scheme === 'categories' ? grading.categories : [];
  const ts = records('task'), quote = v => {
    let s = String(v ?? '');
    if (/^[=+@\-]/.test(s))
      s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const rows = [['Matrícula', 'Alumno', ...(courseSections().length ? ['Sección'] : []), 'Promedio parcial', 'Calificación final', ...(cats.length ? grading.terms || [] : []).map(t => `${t.name} (${t.weight} %)`), ...cats.map(c => `${categoryLabel(c, grading)} (${c.weight} %)`), ...ts.map(t => t.data.title)], ...studentsInView().map(m => { const result = studentGrade(m.id); return [m.matricula, m.name, ...(courseSections().length ? [sectionName(m.section)] : []), result.value?.toFixed(2) || '', finalGrade(studentGrade(m.id, { final: true }).value, grading.final)?.value.toFixed(grading.final.decimals) ?? '', ...[...(result.terms || []), ...result.categories].map(c => c.value === null ? '' : c.value.toFixed(2)), ...ts.map(t => itemApplies(t, m) ? gradeOf(m.id, t.id)?.data.grade ?? '' : 'n/a')]; })];
  download('calificaciones.csv', '\uFEFF' + rows.map(r => r.map(quote).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b || busy)
    return;
  try {
    if (b.dataset.section || ['home', 'teachers', 'reports', 'users', 'calendar', 'course', 'hub', 'task', 'edit-task', 'new-task', 'review'].includes(b.dataset.action)) {
      if (dirty && !confirm('Hay cambios sin guardar. ¿Quieres salir de esta pantalla?'))
        return;
      dirty = false;
    }
    if (b.dataset.section) {
      section = b.dataset.section;
      detail = null;
      attendanceSessionId = null;
      render();
      return;
    }
    if (b.dataset.gradeTab) {
      gradeTab = b.dataset.gradeTab;
      render();
      return;
    }
    const id = b.dataset.id, r = find(id);
    document.querySelectorAll('details.more-menu,details.course-picker,details.card-actions').forEach(d => d.open = false);
    switch (b.dataset.action) {
      case 'delete-group':
        deleteGroupModal(r);
        break;
      case 'delete-course':
        deleteCourseModal(id);
        break;
      case 'create-guide':
        busy = true;
        try {
          await createCourseGuide();
        }
        finally {
          busy = false;
        }
        break;
      case 'home':
        current = null;
        previewAsStudent = false;
        previewMember = null;
        homeView = 'courses';
        courses = await request('/api/courses');
        render();
        break;
      case 'course':
        await openCourse(id);
        break;
      case 'hub':
        if (current) {
          section = 'hub';
          render();
        }
        break;
      case 'close':
        $('#modal').close();
        break;
      case 'new-course':
        courseModal();
        break;
      case 'edit-course':
        courseModal(true);
        break;
      case 'edit-course-card':
        await openCourse(id);
        courseModal(true);
        break;
      case 'edit-member':
        memberModal(current.members.find(x => x.id === id));
        break;
      case 'demo-course':
        // Materia completa con alumnos ficticios para conocer la plataforma (se crea en el servidor, src/server/demo.js).
        modal('Crear curso de ejemplo', `<p>Se creará <strong>Mecánica clásica (curso de ejemplo)</strong> a tu nombre, con todo lo que hace Enlace ya en uso:</p>
          <ul class="demo-list"><li>18 alumnos ficticios, sin cuenta (nadie más ve el curso)</li><li>Temario en 4 unidades con apuntes, fórmulas y simuladores</li><li>Noticias, foros con participación y equipos de laboratorio</li><li>Actividades entregadas y calificadas, con rúbrica, borradores y pendientes por calificar</li><li>Evaluación con resultados y seis semanas de pases de lista</li></ul>
          <p class="muted">Puedes calificar, pasar lista o editarlo sin afectar a nadie, y eliminarlo cuando quieras.</p>`, async () => {
          const { id } = await request('/api/demo-course', {});
          await openCourse(id);
          return 'Curso de ejemplo creado.';
        }, 'Crear curso de ejemplo');
        break;
      case 'add-coteacher':
        modal('Agregar co-docente', field('Correo del docente', 'email', '', 'email', 'required') + '<p class="muted">Debe estar registrado como docente en Enlace. Verá el curso la próxima vez que entre.</p>', async f => {
          await request('/api/course/teachers', { course: current.course.id, email: f.get('email') });
          return 'Co-docente agregado.';
        }, 'Agregar');
        break;
      case 'remove-coteacher':
        if (!confirm('¿Retirar a este co-docente del curso? Su trabajo (calificaciones, contenido) se conserva.'))
          return;
        await request('/api/course/teachers', { course: current.course.id, id }, 'DELETE');
        await reload();
        toast('Co-docente retirado.');
        break;
      case 'copy-course':
        copyCourseModal();
        break;
      case 'archive-course':
        await toggleArchive();
        break;
      case 'new-module':
        simpleRecord('module');
        break;
      case 'edit-module':
        simpleRecord('module', r);
        break;
      case 'module': {
        moduleId = id || null;
        section = 'content';
        render();
        // «Continuar donde te quedaste»: abre el material pendiente y lo muestra.
        const focus = b.dataset.focusMaterial && document.querySelector(`[data-material="${CSS.escape(b.dataset.focusMaterial)}"]`);
        if (focus) {
          focus.querySelector('details').open = true;
          focus.scrollIntoView({ block: 'center' });
        }
        break;
      }
      case 'new-material':
        materialModal();
        break;
      case 'edit-material':
        materialModal(r);
        break;
      case 'task':
        detail = id;
        section = 'task';
        render();
        break;
      case 'new-task':
        detail = null;
        section = 'editor';
        render();
        break;
      case 'edit-task':
        detail = id;
        section = 'editor';
        render();
        break;
      case 'task-files':
        teacherFilesModal(r);
        break;
      case 'submit':
        submissionModal(r);
        break;
      case 'review':
        detail = id;
        reviewMember = b.dataset.member;
        section = 'review';
        render();
        break;
      case 'new-notice':
        simpleRecord('notice');
        break;
      case 'edit-notice':
        simpleRecord('notice', r);
        break;
      case 'new-forum':
        forumModal();
        break;
      case 'edit-forum':
        forumModal(r);
        break;
      case 'forum':
        detail = id;
        section = 'forum';
        render();
        break;
      case 'new-post':
        newThreadModal(id);
        break;
      case 'import-grades':
        importGradesModal();
        break;
      case 'new-quiz':
        quizModal();
        break;
      case 'import-quiz':
        importQuizModal();
        break;
      case 'edit-quiz':
        quizModal(r);
        break;
      case 'quiz':
        detail = id;
        section = 'quiz';
        render();
        break;
      case 'new-group':
        groupModal();
        break;
      case 'edit-group':
        groupModal(r);
        break;
      case 'new-member':
        modal('Inscribir alumno', field('Nombre completo', 'name', '', 'text', 'required') + field('Matrícula', 'matricula') + field('Correo de su cuenta', 'email', '', 'email', 'required') + (courseSections().length ? `<label>Sección<select name="section"><option value="">Sin sección</option>${courseSections().map(x => `<option value="${esc(x.id)}" ${selectedSection() === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : '') + '<p class="pending-message">La inscripción no envía una invitación. Comparte el enlace del sitio y pide que entre con este mismo correo.</p>', f => request('/api/member', {
          course: current.course.id,
          name: f.get('name'),
          matricula: f.get('matricula'),
          email: f.get('email'),
          section: f.get('section') || ''
        }));
        break;
      case 'remove-member':
        if (confirm('¿Retirar a este alumno del curso? Sus entregas se conservarán, pero perderá acceso al curso.')) {
          await request('/api/member', { course: current.course.id, id }, 'DELETE');
          await reload();
        }
        break;
      case 'add-teacher':
        addTeacherModal();
        break;
      case 'edit-teacher':
        editTeacherModal(b.dataset);
        break;
      case 'remove-teacher':
        removeTeacherModal(b.dataset);
        break;
      case 'teachers':
      case 'reports':
      case 'users':
      case 'calendar':
        current = null;
        homeView = b.dataset.action;
        render();
        break;
      case 'bulk-members':
        bulkMembersModal();
        break;
      case 'sections':
        sectionsModal();
        break;
      case 'bulk-teams':
        bulkTeamsModal();
        break;
      case 'zip-task':
        await downloadTaskZip(id);
        break;
      case 'delete-category':
        deleteCategoryModal(document.querySelector('[data-group-category]')?.value);
        break;
      case 'publish-task': {
        const { published } = await request('/api/grades/publish', { course: current.course.id, task: id });
        await reload();
        toast(published === 1 ? 'Se publicó 1 calificación.' : `Se publicaron ${published} calificaciones.`);
        break;
      }
      case 'view-member':
      case 'toggle-preview': {
        // Mismos datos que recibe un alumno, filtrados por el servidor. Las pantallas solo de docente vuelven al inicio.
        // «Ver lo que ve» (view-member) muestra a un alumno concreto; salir de cualquier vista regresa a la de docente.
        if (b.dataset.action === 'view-member') {
          previewMember = id;
          previewAsStudent = true;
        } else {
          previewAsStudent = !previewAsStudent && !previewMember;
          previewMember = null;
        }
        attendanceData = null;
        current = await request('/api/course?id=' + encodeURIComponent(current.course.id) + viewSuffix());
        if (['progress', 'admin', 'trash', 'editor', 'review'].includes(section)) {
          section = 'hub';
          detail = null;
        }
        render();
        window.scrollTo?.(0, 0);
        toast(current.viewing ? `Ves lo mismo que ${current.viewing.name}. La consulta queda registrada.` : previewAsStudent ? 'Vista de alumno: así ven el curso tus alumnos.' : 'De vuelta en la vista de docente.');
        break;
      }
      case 'toggle-visible': {
        const target = find(id);
        if (!target)
          return;
        const show = target.data.visible === false;
        await request('/api/record/visibility', { course: current.course.id, kind: b.dataset.kind, id, visible: show });
        await reload();
        toast(show ? 'Ahora lo ven tus alumnos.' : 'Oculto: solo lo ven los docentes.');
        break;
      }
      case 'trash': {
        const kind = b.dataset.kind;
        if (!(await trashItem(kind, id)))
          return;
        if ($('#modal').open)
          $('#modal').close();
        // Si se eliminó lo que estaba abierto, vuelve a la lista correspondiente.
        const back = { task: ['task', 'editor', 'review', 'tasks'], forum: ['forum', 'forums'], quiz: ['quiz', 'quizzes'] }[kind];
        if (back?.includes(section)) {
          section = back[back.length - 1];
          detail = null;
        }
        dirty = false;
        await reload();
        toast(kind === 'post' ? 'Publicación eliminada.' : 'Se movió a la papelera. Puedes restaurarlo desde Administración del curso → Papelera.');
        break;
      }
      case 'restore':
        await restoreItem(b.dataset.kind, id);
        break;
      case 'logout':
        await request('/auth/logout', {});
        location.href = '/';
        break;
      case 'logout-all':
        if (!confirm('Se cerrará tu sesión en todos tus dispositivos, incluido este. ¿Continuar?'))
          return;
        await request('/api/logout-all', {});
        location.href = '/';
        break;
      case 'profile':
        if (!me)
          return;
        modal('Mi perfil', profilePhotoHtml() + (me.role === 'student' ? `<p><strong>${esc(me.name)}</strong></p>` : field('Nombre', 'name', me.name, 'text', 'required')) + `<p>${esc(me.email)}</p>${emailDigestHtml()}<p>Enlace no guarda contraseñas: entras con este correo a través de Microsoft o de Google.</p><p><button type="button" class="secondary" data-action="logout">Cerrar sesión</button></p><p>¿Perdiste un teléfono o entraste en una computadora ajena? <button type="button" class="text-btn" data-action="logout-all">Cerrar sesión en todos mis dispositivos</button></p>`, me.role === 'student' ? null : async (f) => {
          await request('/api/profile', { name: f.get('name') });
          me = await request('/api/me');
        });
        break;
      case 'export-grades':
        exportGrades();
        break;
      case 'backup':
        download('respaldo-curso.json', JSON.stringify({ exported: new Date().toISOString(), ...current }, null, 2), 'application/json');
        break;
    }
  }
  catch (e) {
    toast(e.message);
  }
});
document.addEventListener('input', e => {
  if (e.target.matches('[data-search]'))
    document.querySelectorAll('[data-search-row]').forEach(r => r.hidden = !r.textContent.toLowerCase().includes(e.target.value.toLowerCase()));
});
window.addEventListener('beforeunload', e => {
  if (dirty || busy) {
    e.preventDefault();
    e.returnValue = '';
  }
});
window.addEventListener('offline', () => {
  $('#connection').hidden = false;
  $('#connection').textContent = 'Sin conexión. Conserva esta pantalla abierta y vuelve a intentar el guardado cuando se restablezca.';
});
window.addEventListener('online', () => {
  $('#connection').hidden = true;
});
async function init() {
  try {
    me = await request('/api/me');
    // Sin foto de perfil, el servidor no entrega nada más: primero la cámara.
    courses = me.needsPhoto ? [] : await request('/api/courses');
    document.body.classList.remove('signed-out');
    $('#logoutButton').hidden = false;
    // Aviso de privacidad: antes de usar Enlace (y cada vez que cambie su versión).
    if (me.privacyAccepted === false)
      return renderPrivacyGate();
    // Con un examen abierto que bloquea el resto de Enlace, se entra directo a él (en cualquier pestaña o sesión).
    if (me.activeExam) {
      await goToActiveExam(me.activeExam);
      return startRoutes();
    }
    // Foto de perfil obligatoria: el alumno se la toma antes de ver lo demás.
    if (me.needsPhoto)
      return renderPhotoGate();
    startNotices();
    if (new URLSearchParams(location.search).has('a')) {
      nav();
      await startCheckinFromLink();
      return startRoutes();
    }
    await openStartRoute();
  }
  catch (e) {
    if (e.status === 401) {
      renderLogin(e.login || { google: true, email: false });
      return;
    }
    $('#main').innerHTML = `<section class="error"><h2>No se pudo cargar tu espacio</h2><p>${esc(e.message)}</p><button class="secondary" id="retry">Volver a intentar</button></section>`;
    $('#retry').onclick = init;
  }
}
// App instalable (PWA): el service worker nunca guarda datos de la API.
if (globalThis.navigator?.serviceWorker && location.protocol === 'https:')
  navigator.serviceWorker.register('/sw.js').catch(() => {});
/** Pantalla de aceptación del aviso de privacidad; al aceptar continúa donde iba la persona. */
function renderPrivacyGate() {
  nav();
  $('#main').innerHTML = `<section class="panel privacy-gate">
    <h1>Aviso de privacidad</h1>
    <p>Antes de continuar, revisa cómo Enlace usa tus datos: tu nombre, correo y matrícula, tus entregas, calificaciones y asistencia se usan solo para tus cursos; tus compañeros ven únicamente tu nombre, y no se usan con fines comerciales.</p>
    <p><a href="/privacidad" target="_blank" rel="noopener">Leer el aviso de privacidad completo ↗</a></p>
    <label class="check-label"><input type="checkbox" id="privacyCheck"> He leído el aviso de privacidad y acepto el tratamiento de mis datos para las finalidades descritas.</label>
    <div class="form-actions"><button class="primary" id="privacyAccept" disabled>Aceptar y continuar</button></div>
  </section>`;
  $('#privacyCheck').onchange = (e) => ($('#privacyAccept').disabled = !e.target.checked);
  $('#privacyAccept').onclick = async () => {
    $('#privacyAccept').disabled = true;
    try {
      await request('/api/privacy/accept', {});
      await init();
    }
    catch (e) {
      toast(e.message);
      $('#privacyAccept').disabled = false;
    }
  };
}
init();
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  const register = tool => {
    try {
      Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {
      });
    }
    catch {
    }
  };
  register({
    name: 'list_my_courses',
    description: 'Lista los cursos accesibles para la cuenta actual. No modifica datos.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute() {
      return (await request('/api/courses')).map(c => ({
        id: c.id,
        name: c.name,
        group: c.group_name,
        canTeach: c.canTeach
      }));
    }
  });
  register({
    name: 'open_course',
    description: 'Abre un curso en la interfaz. No crea ni modifica registros.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input) {
      if (!input || typeof input.id !== 'string' || !input.id)
        throw new Error('Se requiere el identificador del curso.');
      if (busy || dirty || $('#modal').open)
        throw new Error('Termina o cancela la edición actual antes de navegar.');
      await openCourse(input.id);
      return {
        id: current.course.id,
        name: current.course.name,
        section
      };
    }
  });
}
// Vista previa de la portada y del color en el editor del curso (12.25).
document.addEventListener('change', (e) => {
  const preview = document.getElementById('coverPreview');
  if (!preview) return;
  if (e.target.matches('#modal input[name="theme"]')) {
    const n = Number(e.target.value);
    preview.dataset.theme = n || courseTheme(current?.course?.id || '');
  }
  if (e.target.matches('#modal input[name="coverFile"]') && e.target.files?.[0]) {
    const url = URL.createObjectURL(e.target.files[0]);
    preview.classList.add('has-cover');
    preview.style.setProperty('--cover', `url('${url}')`);
  }
  if (e.target.matches('#modal input[name="coverRemove"]')) preview.classList.toggle('has-cover', !e.target.checked);
});
