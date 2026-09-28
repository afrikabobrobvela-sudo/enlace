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
const viewSuffix = () => (previewAsStudent ? '&as=student' : '');
const PREVIEW_READONLY = 'Estás en la vista de alumno: aquí no se guardan cambios. Vuelve a la vista de docente para editar.';
let me = null, courses = [], current = null, section = 'hub', detail = null, moduleId = null, gradeTab = 'entry', busy = false, dirty = false;
const records = kind => current?.records.filter(r => r.kind === kind) || [], find = id => current?.records.find(r => r.id === id), teaches = () => !!current?.canTeach;
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
  return `<button type="button" class="visibility-toggle ${on ? '' : 'is-hidden'}" data-action="toggle-visible" data-kind="${kind}" data-id="${esc(r.id)}" aria-pressed="${on}" title="Toca para ${on ? 'ocultarlo a' : 'mostrarlo a'} los alumnos">${on ? 'Visible para alumnos' : 'Oculto para alumnos'}</button>`;
};
const visible = v => `<label class="check-label"><input name="visible" type="checkbox" ${v !== false ? 'checked' : ''}> Visible para alumnos</label>`;
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
  if (!r.ok)
    throw Object.assign(new Error(b.error || 'No se pudo completar la operación.'), { status: r.status, login: b.login });
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
async function openCourse(id) {
  if (current?.course.id !== id)
    previewAsStudent = false;
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
    return homeView === 'teachers' && me?.role === 'admin' ? renderTeachers() : renderHome();
  const routes = {
    hub: renderHub,
    content: renderContent,
    tasks: renderTasks,
    task: renderTask,
    editor: renderEditor,
    forums: renderForums,
    forum: renderForum,
    quizzes: renderQuizzes,
    quiz: renderQuiz,
    groups: renderGroups,
    grades: renderGrades,
    review: renderReview,
    members: renderMembers,
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
  $('#main').innerHTML = `<section class="hub-banner" data-theme="${courseTheme(c.id)}"><p class="hub-eyebrow">Grupo ${esc(c.group_name)}</p><h1>${esc(c.name)}</h1></section><div class="hub-grid"><div class="hub-side"><section class="panel"><h2>Información del curso</h2><p class="muted">${esc(c.group_name)}</p>${richText(c.intro)}</section><section class="panel"><h2>Actividades</h2>${records('task').slice(-4).map(t => `<div class="task-row"><div><b>${esc(t.data.title)}</b><p class="deadline">${fmt(t.data.due)}</p>${button('Abrir →', 'task', t.id, 'text-btn')}</div></div>`).join('') || '<p class="muted">No hay actividades publicadas.</p>'}</section></div><div><section class="panel"><div class="panel-head"><h2>Noticias</h2>${teaches() ? button('Crear publicación', 'new-notice', '', 'text-btn') : ''}</div>${noticeCards()}</section><section class="panel"><div class="panel-head"><h2>Contenido del curso</h2>${teaches() ? button('Nueva unidad', 'new-module', '', 'text-btn') : ''}</div><div class="module-cards">${records('module').map(m => `<button class="module-card" data-action="module" data-id="${m.id}"><div class="module-cover">${esc(m.data.title)}</div><span class="module-label">${m.data.visible ? 'Abrir unidad' : 'Oculta'}</span></button>`).join('')}</div>${!records('module').length ? '<p class="muted">Agrega unidades para organizar los materiales.</p>' : ''}</section></div></div>`;
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
  const subs = records('submission').filter(s => s.data.task === t.id), own = subs.find(s => s.data.member === current.members.find(m => m.user_id === me.id)?.id) || subs.find(s => s.author === me.id);
  $('#main').innerHTML = `<div class="crumbs"><button data-section="tasks">Actividades</button><span>›</span><span>${teaches() ? 'Envíos en carpeta' : 'Entrega'}</span></div><h1>${esc(t.data.title)}</h1><p class="deadline">Vence: ${fmt(t.data.due)}</p>${!teaches() && t.data.groupCategory ? teamBannerHtml(t) : ''}${richText(t.data.body, t.data.fileIds)}<section class="task-materials"><div class="panel-head"><h2>Material del docente</h2>${teaches() ? button('＋ Subir archivos o presentaciones', 'task-files', t.id) : ''}</div>${fileLinks(t.data.fileIds)}${!t.data.fileIds?.length ? '<p class="muted">No hay archivos adjuntos a esta actividad.</p>' : ''}</section>${teaches() ? `<div class="toolbar">${button('Editar actividad', 'edit-task', t.id, 'secondary')}${button('Descargar entregas (ZIP)', 'zip-task', t.id, 'secondary')}</div><div class="table-wrap"><table><thead><tr><th>Alumno</th><th>Estado</th><th>Calificación</th><th>Acción</th></tr></thead><tbody>${current.members.filter(m => m.role === 'student').map(m => {
    const s = subs.find(s => s.data.member === m.id);
    return `<tr><td>${esc(m.name)}</td><td>${s ? s.data.manual ? 'Captura manual' : s.data.late ? 'Entrega tardía' : 'Entregado' : 'Sin entrega'}</td><td>${s?.data.grade ?? '—'}</td><td><button class="table-link" data-action="review" data-id="${t.id}" data-member="${m.id}">Evaluar →</button></td></tr>`;
  }).join('') || '<tr><td colspan="4">Inscribe alumnos para revisar sus entregas.</td></tr>'}</tbody></table></div>` : `${own ? `<section class="panel"><h2>Tu entrega</h2><p class="deadline">${fmt(own.data.submitted)}</p>${richText(own.data.body)}${fileLinks(own.data.fileIds)}<p>Calificación: <b>${own.data.grade ?? 'Pendiente'}</b></p>${richText(own.data.feedback)}${rubricResultHtml(own.data.rubricScores)}</section>` : ''}<div class="toolbar">${button(own ? 'Actualizar entrega' : 'Realizar entrega', 'submit', t.id)}</div>`}`;
}
function noticeCards() {
  return records('notice').map(n => `<article class="notice"><h3>${esc(n.data.title)}</h3><p class="deadline">${fmt(n.created)}</p>${richText(n.data.body)}${teaches() ? button('Editar', 'edit-notice', n.id, 'text-btn') : ''}</article>`).join('') || '<p class="muted">No hay noticias publicadas.</p>';
}
function renderNotices() {
  $('#main').innerHTML = `<div class="heading"><h1>Noticias</h1>${teaches() ? button('Crear publicación', 'new-notice') : ''}</div><section class="panel">${noticeCards()}</section>`;
}
function renderForums() {
  $('#main').innerHTML = `<h1>Foros</h1><div class="home-tabs"><button class="active">Lista de foros</button></div><div class="toolbar">${teaches() ? button('Nuevo foro', 'new-forum') : ''}</div>${records('forum').map(f => `<section class="forum-block"><h2>${esc(f.data.title)}${f.data.visible ? '' : ' · Oculto'}</h2>${richText(f.data.body)}<div class="table-wrap"><table><thead><tr><th>Tema</th><th>Publicaciones</th>${teaches() ? '<th>Editar</th>' : ''}</tr></thead><tbody><tr><td>${button(esc(f.data.title), 'forum', f.id, 'table-link')}</td><td>${records('post').filter(p => p.data.forum === f.id).length}</td>${teaches() ? `<td>${button('Editar', 'edit-forum', f.id, 'text-btn')}</td>` : ''}</tr></tbody></table></div></section>`).join('') || '<p class="empty">No hay foros.</p>'}`;
}
function renderForum() {
  const f = find(detail);
  if (!f)
    return renderForums();
  $('#main').innerHTML = `<button class="back" data-section="forums">❮ Lista de foros</button><h1>${esc(f.data.title)}</h1>${richText(f.data.body)}<div class="toolbar">${button('Publicar mensaje', 'new-post', f.id)}</div>${records('post').filter(p => p.data.forum === f.id).map(p => `<article class="forum-post"><h2>${esc(p.data.title)}</h2><p class="muted">${esc(p.data.name)} · ${fmt(p.created)}</p>${richText(p.data.body)}${teaches() || p.author === me.id ? trashButton('post', p.id) : ''}</article>`).join('') || '<p class="empty">Todavía no hay publicaciones.</p>'}`;
}
function renderQuizzes() {
  $('#main').innerHTML = `<h1>Evaluaciones</h1><div class="home-tabs"><button class="active">${teaches() ? 'Administrar evaluaciones' : 'Mis evaluaciones'}</button></div><div class="toolbar">${teaches() ? button('Nueva evaluación', 'new-quiz') : ''}</div><div class="table-wrap"><table><thead><tr><th>Evaluación</th><th>Preguntas</th><th>Estado</th></tr></thead><tbody>${records('quiz').map(q => `<tr><td>${button(esc(q.data.title), 'quiz', q.id, 'table-link')}</td><td>${q.data.questions.length}</td><td>${q.data.visible ? 'Publicada' : 'Oculta'}</td></tr>`).join('') || '<tr><td colspan="3">No hay evaluaciones.</td></tr>'}</tbody></table></div>`;
}
function renderQuiz() {
  const q = find(detail);
  if (!q)
    return renderQuizzes();
  const attempts = records('attempt').filter(a => a.data.quiz === q.id), own = attempts.find(a => a.author === me.id);
  $('#main').innerHTML = `<button class="back" data-section="quizzes">❮ Evaluaciones</button><h1>${esc(q.data.title)}</h1>${richText(q.data.body)}${teaches() ? `<div class="toolbar">${button('Editar evaluación', 'edit-quiz', q.id, 'secondary')}</div><p class="real-status">Se permite un intento por alumno. Las respuestas se califican en el servidor. Los resultados se consultan aquí, separados del promedio de actividades.</p>${q.data.questions.map((x, i) => `<section class="quiz-question"><h3>${i + 1}. ${esc(x.text)}</h3><ol type="A">${x.options.map((o, j) => `<li>${esc(o)} ${j === x.correct ? '✓' : ''}</li>`).join('')}</ol></section>`).join('')}<h2>Resultados</h2><div class="table-wrap"><table><thead><tr><th>Alumno</th><th>Calificación</th><th>Fecha</th></tr></thead><tbody>${attempts.map(a => `<tr><td>${esc(a.data.name)}</td><td>${a.data.score.toFixed(2)} / 10</td><td>${fmt(a.created)}</td></tr>`).join('') || '<tr><td colspan="3">No hay intentos registrados.</td></tr>'}</tbody></table></div>` : own ? `<div class="quiz-result">Resultado: <b>${own.data.score.toFixed(2)} / 10</b><p>${own.data.correct} de ${own.data.total} respuestas correctas.</p><p>Enviado el ${fmt(own.created)}</p></div>` : `<p class="real-status">Un intento. Revisa todas tus respuestas antes de enviar.</p><form id="quizAttempt">${q.data.questions.map((x, i) => `<fieldset class="quiz-question"><legend>${i + 1}. ${esc(x.text)}</legend>${x.options.map((o, j) => `<label><input type="radio" required name="q_${i}" value="${j}"> ${esc(o)}</label>`).join('')}</fieldset>`).join('')}<p class="form-error error" hidden></p><button class="primary">Enviar evaluación</button></form>`}`;
  if ($('#quizAttempt'))
    bindForm('#quizAttempt', f => request('/api/attempt', {
      course: current.course.id,
      quiz: q.id,
      answers: q.data.questions.map((_, i) => Number(f.get('q_' + i)))
    }));
}
function gradeOf(member, task) {
  return records('submission').find(s => s.data.member === member && s.data.task === task);
}
function average(member) {
  return studentGrade(member).value;
}
function renderGrades() {
  const ts = records('task'), members = teaches() ? current.members.filter(m => m.role === 'student') : current.members.filter(m => m.user_id === me.id), w = records('weights')[0];
  const grading = gradingSettings(), cats = grading.scheme === 'categories' ? grading.categories : [];
  ensureAttendanceForGrades();
  $('#main').innerHTML = `<div class="home-tabs"><button data-grade-tab="entry" class="${gradeTab === 'entry' ? 'active' : ''}">${teaches() ? 'Ingresar calificaciones' : 'Mis calificaciones'}</button>${teaches() ? `<button data-grade-tab="manage" class="${gradeTab === 'manage' ? 'active' : ''}">Administrar calificaciones</button>` : ''}</div>${gradeTab === 'manage' && teaches() ? gradingManageHtml(`<h2 class="grading-subtitle">Pesos por actividad</h2><p class="real-status">Los pesos de todas las actividades deben sumar 100 %. Si agregas una nueva actividad, se usará el promedio simple hasta que vuelvas a guardar los pesos.</p><form id="weights" class="real-form"><div class="table-wrap"><table><thead><tr><th>Actividad</th><th>Peso (%)</th></tr></thead><tbody>${ts.map((t, i) => `<tr><td>${esc(t.data.title)}</td><td><input type="number" name="w_${t.id}" required min="0" max="100" step="0.01" class="grade-input" value="${w?.data.weights[t.id] ?? (i === ts.length - 1 ? 100 - Math.floor(10000 / ts.length) / 100 * (ts.length - 1) : Math.floor(10000 / ts.length) / 100).toFixed(2)}" aria-label="Peso de ${esc(t.data.title)}"></td></tr>`).join('')}</tbody></table></div><p class="form-error error" hidden></p>${ts.length ? '<div class="form-actions"><button class="primary">Guardar ponderaciones</button></div>' : '<p>Primero crea actividades.</p>'}</form>`) : `<div class="toolbar">${teaches() ? button('Exportar calificaciones', 'export-grades', '', 'secondary') : ''}<input data-search type="search" placeholder="Buscar alumno…" aria-label="Buscar alumno"></div><p class="grade-note">${cats.length ? 'Promedio parcial por categorías' : `Promedio parcial ${w && ts.every(t => Number.isFinite(w.data.weights[t.id])) ? 'ponderado' : 'simple'}`}, de 0 a 10.${teaches() ? ` La calificación final aplica las reglas del curso (mínima aprobatoria ${grading.final.passing}).` : ''} Se excluyen las actividades sin calificar y se normalizan los pesos restantes. Los resultados de evaluaciones automáticas se consultan en Evaluaciones.</p><div class="table-wrap gradebook"><table><thead><tr><th class="sticky-name">Estudiante</th><th>Promedio parcial</th>${teaches() ? '<th>Calificación final</th>' : ''}${cats.map(c => `<th class="category-col">${esc(c.name)}<div class="muted">${c.weight} %</div></th>`).join('')}${ts.map(t => {
    const drafts = teaches() ? records('submission').filter(r => r.data.task === t.id && r.data.published === false).length : 0;
    return `<th>${esc(t.data.title)}${drafts ? `<br><button class="table-link" data-action="publish-task" data-id="${t.id}">Publicar ${drafts} ${drafts === 1 ? 'borrador' : 'borradores'}</button>` : ''}</th>`;
  }).join('')}</tr></thead><tbody>${members.map(m => {
    const result = studentGrade(m.id), avg = result.value, fin = teaches() ? finalGrade(studentGrade(m.id, { final: true }).value, grading.final) : null;
    return `<tr data-search-row><td class="sticky-name">${esc(m.name)}<div class="muted">${esc(m.matricula || '')}</div></td><td class="${avg === null ? '' : avg >= grading.final.passing ? 'grade-pass' : 'grade-low'}">${avg === null ? '—' : avg.toFixed(2)}</td>${teaches() ? `<td class="final-grade ${fin === null ? '' : fin.passed ? 'grade-pass' : 'grade-low'}">${fin === null ? '—' : formatGrade(fin.value, grading.final.decimals)}</td>` : ''}${result.categories.map(c => `<td class="category-col">${formatGrade(c.value)}</td>`).join('')}${ts.map(t => {
      const s = gradeOf(m.id, t.id);
      return `<td>${teaches() ? `<button class="table-link" data-action="review" data-id="${t.id}" data-member="${m.id}">${s?.data.grade ?? 'Calificar'}</button>${s && s.data.published === false ? '<span class="draft-tag">borrador</span>' : ''}` : `${s?.data.grade ?? 'Pendiente'}${s?.data.feedback ? `<p class="grade-feedback">${esc(s.data.feedback)}</p>` : ''}`}</td>`;
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
  const students = current.members.filter(x => x.role === 'student');
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
      ${fileLinks(files)}</section>
    <form class="review-panel real-form" id="reviewForm"><h2>Evaluación</h2>
      ${s && s.data.published === false ? '<p class="draft-note">Borrador: el alumno todavía no ve esta calificación.</p>' : ''}
      ${rubricWidgetHtml(t, s)}${field('Calificación / 10', 'grade', s?.data.grade ?? '', 'number', 'min="0" max="10" step="0.01" required')}
      ${textarea('Comentarios generales', 'feedback', s?.data.feedback || '', false)}
      ${team ? `<label class="check-row"><input type="checkbox" name="team" checked> Aplicar a todo el equipo (${esc(team.data.title)}: ${esc(teamNames(team))})</label>` : ''}<label class="check-row"><input type="checkbox" name="publish" ${reviewPublishNow() ? 'checked' : ''}> Publicar al guardar (el alumno la verá de inmediato)</label>
      <p class="form-error error" hidden></p>
      <div class="review-actions">${next ? '<button class="primary" type="submit" value="next">Guardar y siguiente</button><button class="secondary" type="submit" value="stay">Guardar</button>' : '<button class="primary" type="submit" value="stay">Guardar</button>'}</div>
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
  $('#main').innerHTML = `<h1>Listado de alumnos</h1><div class="toolbar">${teaches() ? button('Inscribir alumno', 'new-member') + button('Importar lista', 'bulk-members', '', 'secondary') : ''}<input data-search type="search" placeholder="Buscar…" aria-label="Buscar alumno"></div>${teaches() ? '<p class="real-status">La inscripción vincula el curso al correo del alumno: verá el curso cuando entre con ese mismo correo (su cuenta de Microsoft o de Google). No se envían invitaciones.</p>' : ''}${coTeachersPanel()}<div class="table-wrap"><table><thead><tr><th>Nombre</th>${teaches() ? '<th>Matrícula</th><th>Correo</th><th>Estado</th><th>Acción</th>' : ''}</tr></thead><tbody>${current.members.filter(m => m.role === 'student').map(m => `<tr data-search-row><td>${esc(m.name)}</td>${teaches() ? `<td>${esc(m.matricula)}</td><td>${esc(m.email)}</td><td>${m.user_id ? 'Cuenta vinculada' : 'Pendiente de ingreso'}</td><td>${button('Retirar', 'remove-member', m.id, 'text-btn')}</td>` : ''}</tr>`).join('') || '<tr><td>No hay alumnos inscritos.</td></tr>'}</tbody></table></div>`;
}
function renderAdmin() {
  $('#main').innerHTML = `<h1>Administración del curso</h1><section class="admin-section"><h2>Configuración</h2><div class="admin-links">${button('Información del curso', 'edit-course', '', 'table-link')}${button('Copiar a un nuevo periodo', 'copy-course', '', 'table-link')}${current.canDelete ? button(current.course.archived_at ? 'Desarchivar curso' : 'Archivar curso', 'archive-course', '', 'table-link') : ''}${button('Exportar respaldo del curso', 'backup', '', 'table-link')}${current.canDelete ? button('Eliminar curso / grupo', 'delete-course', current.course.id, 'danger-link') : ''}</div></section><section class="admin-section"><h2>Administración de estudiantes</h2><div class="admin-links"><button class="table-link" data-section="members">Listado de alumnos</button><button class="table-link" data-section="groups">Equipos de trabajo</button><button class="table-link" data-section="progress">Progreso de la clase</button></div></section><section class="admin-section"><h2>Evaluación</h2><div class="admin-links"><button class="table-link" data-section="tasks">Actividades</button><button class="table-link" data-section="grades">Calificaciones</button><button class="table-link" data-section="quizzes">Evaluaciones</button></div></section><section class="admin-section"><h2>Papelera</h2><div class="admin-links"><button class="table-link" data-section="trash">Elementos eliminados</button></div><p class="muted">Lo que eliminas del curso se puede restaurar desde aquí con todo su contenido, entregas y calificaciones.</p></section><p class="real-status">El respaldo exporta registros y metadatos en JSON. Descarga los archivos adjuntos por separado. Conserva copias periódicas fuera de la plataforma.</p>`;
}
async function save(kind, data, old) {
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
function simpleRecord(kind, old) {
  const names = {
    module: 'unidad',
    notice: 'publicación',
    forum: 'foro'
  };
  // Las unidades llevan archivos (programa, presentaciones, imágenes dentro del texto); noticias y foros, solo texto.
  const withFiles = kind === 'module';
  let files = null;
  modal(`${old ? 'Editar' : 'Crear'} ${names[kind]}`, field('Título', 'title', old?.data.title || '', 'text', 'required maxlength="200"') + richTextarea(kind === 'module' ? 'Descripción de la unidad' : 'Contenido', 'body', old?.data.body || '', { images: withFiles }) + (withFiles ? attachmentPanel(true, 'la unidad') : '') + visible(old?.data.visible) + (old ? `<p class="modal-danger">${trashButton(kind, old.id, 'Eliminar ' + names[kind])}</p>` : ''), async (f) => {
    const data = {
      title: f.get('title'),
      body: f.get('body'),
      visible: f.get('visible') === 'on'
    };
    if (files)
      data.fileIds = await files.upload();
    await save(kind, data, old);
    dirty = false;
  });
  if (withFiles)
    richAttachments = files = attachmentManager($('#fields'), old?.data.fileIds || [], 'material');
}
function materialModal(old) {
  const d = old?.data || {};
  let files = null;
  modal(old ? 'Editar material' : 'Agregar material', field('Título', 'title', d.title || '', 'text', 'required') + `<label>Unidad<select name="module"><option value="">Sin unidad</option>${records('module').map(m => `<option value="${m.id}" ${(d.module || moduleId) === m.id ? 'selected' : ''}>${esc(m.data.title)}</option>`).join('')}</select></label>` + richTextarea('Descripción', 'body', d.body || '', { images: true }) + field('Enlace (opcional)', 'url', d.url || '', 'url') + attachmentPanel(true, 'este material') + visible(d.visible) + (old ? `<p class="modal-danger">${trashButton('material', old.id, 'Eliminar material')}</p>` : ''), async (f) => {
    await save('material', {
      title: f.get('title'),
      body: f.get('body'),
      url: f.get('url'),
      module: f.get('module') || null,
      visible: f.get('visible') === 'on',
      fileIds: await files.upload()
    }, old);
    dirty = false;
  });
  richAttachments = files = attachmentManager($('#fields'), d.fileIds || [], 'material');
}
function quizFields(q, i) {
  return `<fieldset class="quiz-edit-question" data-question><legend>Pregunta ${i + 1}</legend>${textarea('Enunciado', 'question_' + i, q?.text || '')}${[0, 1, 2].map(j => field('Opción ' + String.fromCharCode(65 + j), `option_${i}_${j}`, q?.options[j] || '', 'text', 'required')).join('')}<label>Respuesta correcta<select name="correct_${i}">${[0, 1, 2].map(j => `<option value="${j}" ${q?.correct === j ? 'selected' : ''}>${String.fromCharCode(65 + j)}</option>`).join('')}</select></label></fieldset>`;
}
function quizModal(old) {
  let count = old?.data.questions.length || 1;
  modal(old ? 'Editar evaluación' : 'Nueva evaluación', field('Título', 'title', old?.data.title || '', 'text', 'required') + richTextarea('Instrucciones', 'body', old?.data.body || '') + visible(old?.data.visible ?? false) + `<div id="questions">${Array.from({ length: count }, (_, i) => quizFields(old?.data.questions[i], i)).join('')}</div><button type="button" class="secondary" id="addQuestion">＋ Agregar pregunta</button><p class="pending-message">Un intento por alumno. Una evaluación con respuestas recibidas no permite modificar las preguntas.</p>` + (old ? `<p class="modal-danger">${trashButton('quiz', old.id, 'Eliminar evaluación')}</p>` : ''), f => save('quiz', {
    title: f.get('title'),
    body: f.get('body'),
    visible: f.get('visible') === 'on',
    questions: Array.from({ length: count }, (_, i) => ({
      text: f.get('question_' + i),
      options: [0, 1, 2].map(j => f.get(`option_${i}_${j}`)),
      correct: Number(f.get('correct_' + i))
    }))
  }, old));
  $('#addQuestion').onclick = () => {
    if (count >= 50)
      return;
    $('#questions').insertAdjacentHTML('beforeend', quizFields(null, count));
    count++;
  };
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
  modal(edit ? 'Información del curso' : 'Crear curso', field('Nombre de la materia', 'name', c?.name || '', 'text', 'required maxlength="150"') + field('Grupo', 'group', c?.group_name || '', 'text', 'required maxlength="100"') + field('Periodo', 'period', c?.period || '', 'text', 'maxlength="60" placeholder="Por ejemplo: Otoño 2026"') + textarea('Presentación', 'intro', c?.intro || '', false), f => request(edit ? '/api/course' : '/api/courses', {
    course: c?.id,
    name: f.get('name'),
    group: f.get('group'),
    period: f.get('period'),
    intro: f.get('intro')
  }));
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
  const rows = [['Matrícula', 'Alumno', 'Promedio parcial', 'Calificación final', ...cats.map(c => `${c.name} (${c.weight} %)`), ...ts.map(t => t.data.title)], ...current.members.filter(m => m.role === 'student').map(m => [m.matricula, m.name, average(m.id)?.toFixed(2) || '', finalGrade(studentGrade(m.id, { final: true }).value, grading.final)?.value.toFixed(grading.final.decimals) ?? '', ...studentGrade(m.id).categories.map(c => c.value === null ? '' : c.value.toFixed(2)), ...ts.map(t => gradeOf(m.id, t.id)?.data.grade ?? '')])];
  download('calificaciones.csv', '\uFEFF' + rows.map(r => r.map(quote).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b || busy)
    return;
  try {
    if (b.dataset.section || ['home', 'teachers', 'course', 'hub', 'task', 'edit-task', 'new-task', 'review'].includes(b.dataset.action)) {
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
      case 'module':
        moduleId = id || null;
        section = 'content';
        render();
        break;
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
        simpleRecord('forum');
        break;
      case 'edit-forum':
        simpleRecord('forum', r);
        break;
      case 'forum':
        detail = id;
        section = 'forum';
        render();
        break;
      case 'new-post':
        modal('Publicar mensaje', field('Título', 'title', '', 'text', 'required') + textarea('Mensaje', 'body'), f => save('post', {
          forum: id,
          title: f.get('title'),
          body: f.get('body')
        }));
        break;
      case 'new-quiz':
        quizModal();
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
        modal('Inscribir alumno', field('Nombre completo', 'name', '', 'text', 'required') + field('Matrícula', 'matricula') + field('Correo de su cuenta', 'email', '', 'email', 'required') + '<p class="pending-message">La inscripción no envía una invitación. Comparte el enlace del sitio y pide que entre con este mismo correo.</p>', f => request('/api/member', {
          course: current.course.id,
          name: f.get('name'),
          matricula: f.get('matricula'),
          email: f.get('email')
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
        current = null;
        homeView = 'teachers';
        render();
        break;
      case 'bulk-members':
        bulkMembersModal();
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
      case 'toggle-preview': {
        // Mismos datos que recibe un alumno, filtrados por el servidor. Las pantallas solo de docente vuelven al inicio.
        previewAsStudent = !previewAsStudent;
        attendanceData = null;
        current = await request('/api/course?id=' + encodeURIComponent(current.course.id) + viewSuffix());
        if (['progress', 'admin', 'trash', 'editor', 'review'].includes(section)) {
          section = 'hub';
          detail = null;
        }
        render();
        window.scrollTo?.(0, 0);
        toast(previewAsStudent ? 'Vista de alumno: así ven el curso tus alumnos.' : 'De vuelta en la vista de docente.');
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
        modal('Mi perfil', (me.role === 'student' ? `<p><strong>${esc(me.name)}</strong></p>` : field('Nombre', 'name', me.name, 'text', 'required')) + `<p>${esc(me.email)}</p><p>Enlace no guarda contraseñas: entras con este correo a través de Google o de un enlace de acceso.</p><p>¿Perdiste un teléfono o entraste en una computadora ajena? <button type="button" class="text-btn" data-action="logout-all">Cerrar sesión en todos mis dispositivos</button></p>`, me.role === 'student' ? null : async (f) => {
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
    courses = await request('/api/courses');
    document.body.classList.remove('signed-out');
    $('#logoutButton').hidden = false;
    // Aviso de privacidad: antes de usar Enlace (y cada vez que cambie su versión).
    if (me.privacyAccepted === false)
      return renderPrivacyGate();
    if (new URLSearchParams(location.search).has('a')) {
      nav();
      return startCheckinFromLink();
    }
    render();
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
