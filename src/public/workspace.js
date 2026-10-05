/** Color e ilustración de cada curso (1 a 6), siempre el mismo para el mismo curso. */
function courseTheme(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 6) + 1;
}
/* Course workspace: all counts and content come from the authenticated API. */
function workspaceNav() {
  const c = current?.course;
  $('#crumb').textContent = c ? c.name : 'Mis cursos';
  // La tinta del tomo abierto (12.37) tiñe la barra, las pestañas y la acción principal (coleccion.css).
  if (document.body?.dataset) document.body.dataset.tomo = c && typeof courseThemeOf === 'function' ? courseThemeOf(c) : '';
  if (typeof renderProfileButton === 'function') renderProfileButton();
  else $('#profile').textContent = (me?.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
  $('#roleLabel').textContent = me?.role === 'admin' ? 'Administrador' : me?.role === 'teacher' ? 'Docente' : 'Alumno';
  const active = section === 'task' || section === 'editor' || section === 'review' ? 'tasks' : section === 'forum' || section === 'thread' ? 'forums' : section === 'quiz' || section === 'bank' ? 'quizzes' : section;
  const item = ([id, label]) => `<button data-section="${id}" class="${active === id ? 'active' : ''}" ${active === id ? 'aria-current="page"' : ''}>${label}</button>`;
  $('#topnav').innerHTML = c ? [['hub', 'Inicio'], ['content', 'Contenido'], ['tasks', 'Actividades'], ['forums', 'Foros'], ['quizzes', 'Evaluaciones'], ['grades', 'Calificaciones']].map(item).join('') + `<details class="more-menu"><summary>Más</summary><div class="menu-panel">${[['groups', 'Grupos'], ['members', 'Alumnos'], ['attendance', 'Asistencia'], ['notices', 'Noticias'], ...(teaches() ? [['progress', 'Progreso'], ['admin', 'Administración del curso']] : [])].map(item).join('')}</div></details>` : '';
  // Vista como alumno: el docente alterna entre su vista y la que reciben sus alumnos.
  if (c && current.canPreview)
    $('#topnav').insertAdjacentHTML('beforeend', `<button type="button" class="view-toggle ${current.preview ? 'is-on' : ''}" data-action="toggle-preview" aria-pressed="${!!current.preview}">${current.preview ? 'Salir de la vista de alumno' : 'Ver como alumno'}</button>`);
  const bar = $('#previewBar');
  if (bar) {
    const archived = c && c.archived_at && !current.preview;
    bar.hidden = !current?.preview && !archived;
    bar.classList.toggle('is-archived', Boolean(archived));
    bar.innerHTML = archived
      ? `<span><strong>Curso archivado${c.period ? ' · ' + esc(c.period) : ''}.</strong> Solo lectura: se puede consultar y descargar, pero no hacer entregas ni cambios.</span>${current.canDelete ? '<button type="button" class="secondary" data-action="archive-course">Desarchivar</button>' : ''}`
      : current?.viewing ? `<span><strong>Vista de ${esc(current.viewing.name)}.</strong> Ves exactamente lo que ve este alumno: sus entregas, calificaciones publicadas, intentos y asistencia. Nada se guarda en esta vista y la consulta queda registrada.</span><button type="button" class="secondary" data-action="toggle-preview">Volver a vista de docente</button>`
      : current?.preview ? '<span><strong>Vista de alumno.</strong> Así ven este curso tus alumnos: solo lo visible, sin respuestas correctas ni datos de otros alumnos. Nada se guarda en esta vista.</span><button type="button" class="secondary" data-action="toggle-preview">Volver a vista de docente</button>' : '';
  }
  const picker = $('#coursePickerList');
  if (picker)
    picker.innerHTML = `${button('Todos mis cursos', 'home', '', 'text-btn')}${courses.map(x => button(esc(x.name) + ' <small>' + esc(x.group_name) + '</small>', 'course', x.id, 'text-btn')).join('')}`;
  document.body.classList.toggle('page-white', !!c && section !== 'hub');
  document.body.classList.toggle('in-course', !!c);
  renderBottomNav();
}
function workspaceHome() {
  $('#main').innerHTML = `<section class="home-courses"><div class="home-title-row"><div><p class="workspace-eyebrow">ENLACE · BUAP</p><h1>Mis cursos</h1><p class="muted">Tus materias, grupos y espacios de aprendizaje.</p></div><div class="action-row">${courses.some(c => !c.canTeach && !c.archived_at) ? '<button class="primary" data-checkin-code>Registrar asistencia</button>' : ''}${courses.length ? button('Calendario', 'calendar', '', 'secondary') : ''}${['admin', 'teacher'].includes(me.role) ? button('Curso de ejemplo', 'demo-course', '', 'secondary') : ''}${me.role === 'admin' ? button('Docentes' + (me.pendingTeacherRequests ? ` <span class="badge-count" aria-label="${me.pendingTeacherRequests} solicitudes pendientes">${me.pendingTeacherRequests}</span>` : ''), 'teachers', '', 'secondary') + button('Usuarios', 'users', '', 'secondary') + button('Reportes', 'reports', '', 'secondary') : ''}${['admin', 'teacher'].includes(me.role) ? button('＋ Crear curso', 'new-course') : ''}</div></div>${registrationBanner()}<div id="homeDashboard" class="home-dashboard" hidden></div><div class="workspace-filterbar"><label class="search-control"><span class="sr-only">Buscar por materia o grupo</span><input type="search" data-course-search placeholder="Buscar por materia o grupo…"></label><label class="filter-control">Mostrar<select data-course-filter><option value="all">Cursos activos</option><option value="teach">Cursos que imparto</option><option value="learn">Cursos en los que estoy inscrito</option><option value="archived">Cursos archivados</option></select></label><span class="muted" id="courseCount">${courses.length} cursos</span></div><div class="cards">${courses.map(c => `<article class="course ${c.archived_at ? 'is-archived' : ''}" data-theme="${courseThemeOf(c)}" data-archived="${c.archived_at ? 'yes' : 'no'}" data-course-card data-teach="${c.canTeach ? 'yes' : 'no'}" data-search-text="${esc((c.name + ' ' + c.group_name).toLowerCase())}"><div class="course-cover ${c.cover_updated ? 'has-cover' : ''}"${coverStyle(c)}><span class="code">${esc(c.group_name)}</span><h2>${button(esc(c.name), 'course', c.id, 'course-title-link')}</h2>${c.canTeach && !c.archived_at || c.canDelete ? `<details class="card-actions"><summary aria-label="Opciones de ${esc(c.name)}">⋯</summary><div class="card-menu">${c.canTeach && !c.archived_at ? button('Editar curso y portada', 'edit-course-card', c.id, 'table-link') : ''}${c.canDelete ? button('Eliminar curso / grupo', 'delete-course', c.id, 'danger-link') : ''}</div></details>` : ''}</div><div class="course-content"><span class="role-pill">${c.canTeach ? 'Docente' : 'Alumno'}</span>${c.period ? `<span class="role-pill period-pill">${esc(c.period)}</span>` : ''}${c.archived_at ? '<span class="role-pill archived-pill">Archivado</span>' : ''}<div class="course-card-footer">${button('Abrir curso →', 'course', c.id, 'text-btn')}</div></div></article>`).join('')}</div>${!courses.length ? empty('Tu espacio está listo', me.role === 'student' ? 'Cuando tu docente te inscriba con el correo de tu cuenta, tus cursos aparecerán aquí.' : 'Crea una materia, asigna su grupo y organiza el contenido para tus alumnos.') : '<p class="empty" id="noCourseResults" hidden>No hay cursos que coincidan con tu búsqueda.</p>'}</section>`;
  filterCourses(); // oculta los archivados en la vista inicial
  renderHomeDashboard();
  maybeAskClassification();
}
function filterCourses() {
  const query = ($('[data-course-search]')?.value || '').toLowerCase(), type = $('[data-course-filter]')?.value || 'all';
  let count = 0;
  document.querySelectorAll('[data-course-card]').forEach(card => {
    // Los archivados solo aparecen con el filtro "Cursos archivados".
    const archived = card.dataset.archived === 'yes';
    const show = card.dataset.searchText.includes(query) && (type === 'archived' ? archived : !archived && (type === 'all' || (type === 'teach') === (card.dataset.teach === 'yes')));
    card.hidden = !show;
    if (show)
      count++;
  });
  $('#courseCount').textContent = count + ' ' + (count === 1 ? 'curso' : 'cursos');
  if ($('#noCourseResults'))
    $('#noCourseResults').hidden = count > 0;
}
function guideSections() {
  const name = current.course.name;
  return [
    { title: '01 · Presentación de la materia', body: `GUÍA EDITABLE · Sustituye los campos entre corchetes.\n\nBienvenidas y bienvenidos a ${name}. En esta materia estudiaremos [objeto de estudio] y su relación con [situaciones de la vida cotidiana o del campo profesional]. Al concluir, podrás [aplicación principal].\n\nDocente: [nombre completo]\nGrupo y periodo: ${current.course.group_name}\nModalidad: [presencial, mixta o en línea]\nHorario y aula: [días, horas y lugar]\nContacto y asesorías: [correo, medio y horario]\n\nAntes de comenzar: revisa el temario, consulta los criterios de evaluación y participa en [actividad de bienvenida].` },
    { title: '02 · Objetivos y resultados de aprendizaje', body: `GUÍA EDITABLE · Usa verbos observables: identificar, explicar, aplicar, resolver, analizar o diseñar.\n\nObjetivo general\nAl finalizar ${name}, el estudiante será capaz de [verbo + habilidad] mediante [método o actividad], para [propósito o aplicación].\n\nResultados de aprendizaje — ejemplos de estructura\n1. Explicar [concepto] mediante [esquema, exposición o escrito].\n2. Aplicar [procedimiento] para resolver [tipo de problema], justificando cada paso.\n3. Analizar [caso o datos] y elaborar [producto] con base en [criterios].\n\nComprueba que cada resultado tenga al menos una actividad y un criterio de evaluación relacionados.` },
    { title: '03 · Metodología y acuerdos de trabajo', body: `GUÍA EDITABLE · Describe cómo se trabajará realmente en tu grupo.\n\nAntes de clase: revisar [lectura, video o guía] y preparar [preguntas o ejercicios].\nDurante la clase: explicación breve, resolución de ejemplos y [práctica, discusión o trabajo colaborativo].\nDespués de clase: completar [actividad] y entregar la evidencia en la sección Actividades.\n\nAcuerdos por definir\n• Asistencia y participación: [criterios].\n• Entregas y retrasos: [fechas, formatos y condiciones].\n• Trabajo en equipo: [responsabilidades y tamaño de equipo].\n• Integridad académica y uso de IA: [usos permitidos, restricciones y cómo declararlos].\n• Comunicación y tiempo de respuesta: [medio y plazo].\n• En laboratorio, cuando corresponda: [equipo de protección y reglas de seguridad].` },
    { title: '04 · Temario por unidades', body: `EJEMPLO DE ESTRUCTURA · Reemplaza estos temas generales con el programa oficial de ${name}.\n\nUNIDAD 1. Fundamentos de [área]\n1.1 Conceptos y definiciones esenciales.\n1.2 Principios y relaciones fundamentales.\n1.3 Ejemplos y aplicaciones iniciales.\nResultado esperado: [qué podrá hacer el alumno].\nEvidencia: [cuestionario, ejercicios o mapa conceptual].\nDuración: [número de semanas].\n\nUNIDAD 2. Métodos y aplicaciones de [tema]\n2.1 Procedimientos y técnicas.\n2.2 Resolución de problemas o estudio de casos.\n2.3 Interpretación de resultados.\nResultado esperado: [habilidad observable].\nEvidencia: [práctica, reporte o problema resuelto].\nDuración: [número de semanas].\n\nUNIDAD 3. Integración de conocimientos\n3.1 Análisis de una situación integradora.\n3.2 Desarrollo de un proyecto o producto.\n3.3 Presentación y reflexión final.\nResultado esperado: [aplicación integral].\nEvidencia: [proyecto, exposición o evaluación].\nDuración: [número de semanas].\n\nAñade o elimina unidades según tu programa; después crea una unidad de Contenido para cada una.` },
    { title: '05 · Evaluación y criterios', body: `EJEMPLO ORIENTATIVO · Ajusta los porcentajes al programa aprobado.\n\nActividades y ejercicios: 20 %\nPrácticas o reportes: 30 %\nProyecto integrador: 20 %\nEvaluaciones: 30 %\nTOTAL: 100 %\n\nPara cada actividad indica: producto esperado, modalidad individual o en equipo, fecha límite, formato del archivo y criterios de la rúbrica.\n\nEscala y acreditación: [reglas aplicables].\nRetroalimentación: [medio y plazo].\nEntregas extemporáneas y recuperación: [condiciones].\n\nEste texto solo explica tu esquema. Los porcentajes escritos aquí NO configuran automáticamente el libro de calificaciones; ajústalos también en Calificaciones y verifica qué evidencias incluye.` },
    { title: '06 · Calendario de trabajo', body: `EJEMPLO ORIENTATIVO · Sustituye semanas y fechas por tu calendario real.\n\nSemana 1 · Presentación, acuerdos y diagnóstico. Evidencia: [actividad]. Fecha: [dd/mm].\nSemanas [2–4] · Unidad 1. Evidencia: [producto]. Fecha: [dd/mm].\nSemanas [5–8] · Unidad 2. Evidencia: [producto]. Fecha: [dd/mm].\nSemanas [9–12] · Unidad 3. Evidencia: [producto]. Fecha: [dd/mm].\nSemana [final] · Presentaciones, evaluación y cierre.\n\nIncluye las prácticas, evaluaciones parciales, días sin clase y entregas principales. Las fechas de entrega efectivas deben configurarse también en cada actividad.` },
    { title: '07 · Bibliografía y recursos', body: `GUÍA EDITABLE · Agrega fuentes reales y comprueba los enlaces.\n\nBibliografía básica\n[Apellido, Inicial. (Año). Título de la obra (edición). Editorial.]\n\nBibliografía complementaria\n[Referencia completa y capítulos que se utilizarán.]\n\nRecursos digitales\n[Nombre del recurso] — [URL] — [para qué lo usaremos].\n[Video, simulador o repositorio] — [URL] — [unidad relacionada].\n\nMateriales para el curso\n[Calculadora, cuaderno, software, equipo de laboratorio u otros.]\n\nAdjunta aquí el programa, las guías y las presentaciones mediante Editar → Adjuntar archivos. Usa materiales que tengas autorización para compartir.` }
  ];
}
function guidePanel() {
  if (!teaches())
    return '';
  const existing = records('module').find(m => m.id === 'courseguide:' + current.course.id);
  return `<details class="course-guide"><summary><span><strong>Guía para preparar tu materia</strong><small>Ejemplos editables: desde la presentación hasta el temario y la evaluación.</small></span><span aria-hidden="true">⌄</span></summary><div class="guide-body"><p>Crea siete apartados como borradores. Adapta los ejemplos y los campos entre corchetes; después activa «Visible para alumnos» en la unidad y en cada apartado.</p><ol class="guide-outline">${guideSections().map(x => `<li><details><summary>${esc(x.title.slice(5))}</summary>${richText(x.body)}</details></li>`).join('')}</ol>${existing ? button('Abrir mis borradores', 'module', existing.id) : button('Crear guía editable en este curso', 'create-guide')}<p class="muted">${existing ? 'Tu guía ya está creada. Puedes seguir editándola.' : 'No reemplaza el contenido existente ni se muestra a los alumnos al crearla.'}</p></div></details>`;
}
/** Ícono según el tipo de material (12.36): enlace o simulador, archivos o solo texto. */
const MATERIAL_ICONS = {
  link: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  file: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  text: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 6h14M5 10h14M5 14h10M5 18h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};
function materialIcon(x) {
  const kind = x.data.url ? 'link' : x.data.fileIds?.length ? 'file' : 'text';
  return `<span class="document-mark is-${kind}" aria-hidden="true">${MATERIAL_ICONS[kind]}</span>`;
}

/** Línea bajo el título de un material: archivos (solo si tiene), enlace externo y estado. */
function materialMeta(x) {
  const files = x.data.fileIds?.length || 0;
  const parts = [files ? `${files} ${files === 1 ? 'archivo' : 'archivos'}` : '', x.data.url ? 'Enlace externo' : '', x.data.visible === false ? 'Borrador' : scheduledFor(x) ? 'Programado' : ''].filter(Boolean);
  return parts.length ? `<small>${parts.join(' · ')}</small>` : '';
}
function workspaceContent() {
  const ms = records('module');
  if (moduleId && !ms.some(m => m.id === moduleId))
    moduleId = null;
  const m = find(moduleId), mats = records('material').filter(x => !moduleId || x.data.module === moduleId);
  $('#main').innerHTML = `<div class="content-layout ${m ? 'has-unit' : ''}"><section class="content-tree" aria-label="Unidades del curso"><h2>Contenido del curso</h2><button class="toc-all ${!moduleId ? 'selected' : ''}" data-action="module">Tabla de contenidos <span>${records('material').length}</span></button>${ms.map(u => `<div class="tree-unit"><button data-action="module" data-id="${u.id}" class="${moduleId === u.id ? 'active' : ''}"><span>${esc(u.data.title)}</span><small>${!teaches() && myMember() ? `${unitProgress(u.id, myMember().id).done} de ${materialsOf(u.id).length} completados` : `${materialsOf(u.id).length} ${materialsOf(u.id).length === 1 ? 'material' : 'materiales'}`}${u.data.visible === false ? ' · Borrador' : scheduledFor(u) ? ' · Programada' : ''}</small></button></div>`).join('')}${teaches() ? button('＋ Nueva unidad', 'new-module', '', 'secondary') : ''}</section><section class="content-detail"><div class="crumbs"><button data-action="hub">Inicio del curso</button><span>›</span>${m ? '<button data-action="module">Contenido</button><span>›</span><span>Unidad</span>' : '<span>Contenido</span>'}</div><div class="panel-head"><h1>${esc(m?.data.title || 'Tabla de contenidos')}${m ? conditionsTag(m) : ''}</h1>${teaches() && m ? button('Editar unidad', 'edit-module', m.id, 'secondary') : ''}</div>${m ? `${teaches() ? visibilityToggle('module', m) : myMember() ? progressBar(unitProgress(m.id, myMember().id).done, materialsOf(m.id).length, `Tu avance: ${unitProgress(m.id, myMember().id).done} de ${materialsOf(m.id).length} materiales`) : ''}${richText(m.data.body, m.data.fileIds)}${fileLinks(m.data.fileIds)}` : ''}${guidePanel()}<div class="panel-head content-toolbar"><h2>${m ? 'Materiales de la unidad' : 'Todos los materiales'} <span class="count-pill">${mats.length}</span></h2>${teaches() ? button('＋ Agregar material', 'new-material') : ''}</div>${mats.map(x => `<article class="material-entry ${!teaches() && myMember() && progressOf(myMember().id, x.id)?.completed_at ? 'is-completed' : ''}" data-material="${esc(x.id)}"><details><summary>${materialIcon(x)}<span><strong>${esc(x.data.title)}</strong>${sectionTag(x)}${materialMeta(x)}</span><span class="expand-mark" aria-hidden="true">⌄</span></summary><div class="material-entry-body">${richText(x.data.body, x.data.fileIds)}${x.data.url ? `<a href="${esc(x.data.url)}" target="_blank" rel="noopener noreferrer">Abrir recurso ↗</a>` : ''}${fileLinks(x.data.fileIds)}</div></details>${teaches() ? '' : materialProgressHtml(x)}${teaches() ? `<div class="material-actions material-edit">${materialProgressHtml(x)}${visibilityToggle('material', x)}${x.data.visible !== false && find(x.data.module)?.data.visible === false ? '<span class="visibility-note">Su unidad está oculta</span>' : ''}${button('Editar', 'edit-material', x.id, 'text-btn')}</div>` : ''}</article>`).join('') || '<div class="empty-materials"><h3>Organiza aquí tus materiales</h3><p class="muted">' + (teaches() ? 'Crea una unidad y agrega documentos, presentaciones, enlaces e instrucciones. También puedes comenzar con la guía editable.' : 'Tu docente publicará aquí los materiales del curso.') + '</p></div>'}</section></div>`;
}
function workspaceGroups() {
  const groups = records('group'), cats = [...new Set(groups.map(g => g.data.category))];
  $('#main').innerHTML = `<div class="page-heading"><div><p class="workspace-eyebrow">ORGANIZACIÓN DEL CURSO</p><h1>Grupos de trabajo</h1><p class="muted">Equipos e integrantes de ${esc(current.course.name)}.</p></div>${teaches() ? `<div class="action-row">${button('Crear equipos en lote', 'bulk-teams', '', 'secondary')}${button('＋ Nuevo grupo', 'new-group')}</div>` : ''}</div><div class="workspace-filterbar"><input type="search" data-group-search placeholder="Buscar grupo o integrante…" aria-label="Buscar grupo"><label class="filter-control">Categoría<select data-group-category><option value="">Todas las categorías</option>${cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></label>${teaches() && cats.length ? button('Eliminar categoría', 'delete-category', '', 'danger-link') : ''}<span id="groupCount" class="muted">${groups.length} grupos</span></div><div class="table-wrap"><table><caption class="sr-only">Grupos de trabajo e integrantes</caption><thead><tr><th scope="col">Grupo</th><th scope="col">Categoría</th><th scope="col">Integrantes</th>${teaches() ? '<th scope="col">Acciones</th>' : ''}</tr></thead><tbody>${groups.map(g => `<tr data-group-row data-category="${esc(g.data.category)}"><td><strong>${esc(g.data.title)}</strong><p class="table-subtext">${g.data.members.length} integrantes</p></td><td><span class="category-pill">${esc(g.data.category)}</span></td><td><div class="member-chips">${g.data.members.map(id => `<span>${esc(current.members.find(m => m.id === id)?.name || 'Alumno retirado')}</span>`).join('') || '<span class="muted">Sin integrantes</span>'}</div></td>${teaches() ? `<td><div class="row-actions">${button('Editar', 'edit-group', g.id, 'text-btn')}${button('Eliminar', 'delete-group', g.id, 'danger-link')}</div></td>` : ''}</tr>`).join('') || `<tr><td colspan="${teaches() ? 4 : 3}" class="empty">Todavía no hay grupos de trabajo.</td></tr>`}</tbody></table></div><p id="noGroupResults" class="empty" hidden>No hay grupos que coincidan con los filtros.</p><p class="table-footnote">Eliminar un equipo no retira a sus integrantes del curso ni borra sus entregas o calificaciones.</p>`;
}
function filterGroups() {
  const q = ($('[data-group-search]')?.value || '').toLowerCase(), cat = $('[data-group-category]')?.value || '';
  let count = 0;
  document.querySelectorAll('[data-group-row]').forEach(row => {
    row.hidden = !row.textContent.toLowerCase().includes(q) || !!cat && row.dataset.category !== cat;
    if (!row.hidden)
      count++;
  });
  $('#groupCount').textContent = count + ' grupos';
  $('#noGroupResults').hidden = count > 0 || !records('group').length;
}
/** Estado de una actividad para el alumno (12.36): entregada, por entregar, vencida o calificada sin entrega. */
function studentTaskState(t, mine) {
  if (t.data.forum) return { order: 3, html: '<span class="status-pill">Participación en foro</span>' };
  if (mine && !mine.data.manual && mine.data.submitted) return { order: 2, html: '<span class="status-pill">Entregada</span>' };
  if (mine?.data.grade != null) return { order: 2, html: '<span class="status-pill">Calificada sin entrega en línea</span>' };
  const due = Date.parse(dueFor(t, myMember()?.id) || '');
  if (!Number.isFinite(due)) return { order: 0, due: Infinity, html: '<span class="status-pill draft">Por entregar</span>' };
  if (due < Date.now()) return { order: 1, due: -due, html: `<span class="status-pill is-late">Venció el ${esc(fmt(new Date(due).toISOString()))}</span>` };
  return { order: 0, due, html: `<span class="status-pill is-due">Por entregar · ${esc(typeof relativeDue === 'function' ? relativeDue(new Date(due).toISOString()) : 'vence ' + fmt(new Date(due).toISOString()))}</span>` };
}

function workspaceTasks() {
  let ts = records('task');
  if (!teaches()) {
    // Lo próximo primero (12.36): por entregar (la más cercana arriba), vencidas (la más reciente arriba), entregadas.
    const subs = records('submission');
    const stateOf = new Map(ts.map((t) => [t.id, studentTaskState(t, subs.find((s) => s.data.task === t.id && s.author === viewerKey()))]));
    ts = [...ts].sort((a, b) => stateOf.get(a.id).order - stateOf.get(b.id).order || (stateOf.get(a.id).due ?? 0) - (stateOf.get(b.id).due ?? 0));
  }
  $('#main').innerHTML = `<div class="page-heading"><div><p class="workspace-eyebrow">ENSEÑANZA Y EVALUACIÓN</p><h1>Actividades</h1></div>${teaches() ? button('＋ Nueva actividad', 'new-task') : ''}</div><div class="workspace-filterbar"><input type="search" data-task-search placeholder="Buscar actividades…" aria-label="Buscar actividades"><label class="filter-control">Estado<select data-task-filter><option value="all">Todas</option>${teaches() ? '<option value="visible">Visibles para alumnos</option><option value="draft">Borradores</option><option value="pending">Por calificar</option>' : '<option value="pending">Sin entregar</option><option value="done">Entregadas</option>'}</select></label><span class="muted" id="taskCount">${ts.length} actividades</span></div><div class="table-wrap"><table><caption class="sr-only">Actividades, entregas y calificaciones</caption><thead><tr><th scope="col">Actividad y disponibilidad</th><th scope="col">${teaches() ? 'Entregas' : 'Estado'}</th><th scope="col">Evaluación</th>${teaches() ? '<th scope="col">Acciones</th>' : ''}</tr></thead><tbody>${ts.map(t => {
    const ss = records('submission').filter(s => s.data.task === t.id), mine = ss.find(s => s.author === viewerKey()), sent = ss.filter(s => !s.data.manual), pending = sent.filter(s => s.data.grade == null).length;
    return `<tr data-task-row data-visibility="${t.data.visible === false ? 'draft' : 'visible'}" data-pending="${teaches() ? pending > 0 : !t.data.forum && (!mine || mine.data.manual)}" data-done="${!!mine && !mine.data.manual}"><td>${button(esc(t.data.title), 'task', t.id, 'assignment-title')}${sectionTag(t)}<p class="assignment-date">Fecha límite: ${fmt(t.data.due)}</p><div class="task-meta">${teaches() ? visibilityToggle('task', t) : ''}${t.data.fileIds?.length ? '<span>' + t.data.fileIds.length + ' archivos del docente</span>' : ''}</div></td><td>${teaches() ? button(sent.length + (sent.length === 1 ? ' entrega' : ' entregas'), 'task', t.id, 'table-link') : studentTaskState(t, mine).html}</td><td>${teaches() ? `<span class="cell-pair"><strong>${ss.filter(s => s.data.grade != null).length}</strong> calificadas</span>${pending ? `<p class="pending-grade">${pending} por calificar</p>` : ''}` : mine?.data.grade == null ? (t.data.forum || mine?.data.submitted ? 'Sin calificar' : '—') : mine.data.grade + ' / 10'}</td>${teaches() ? `<td><div class="row-actions vertical">${button('Editar actividad', 'edit-task', t.id, 'text-btn')}${button('Adjuntar material', 'task-files', t.id, 'text-btn')}</div></td>` : ''}</tr>`;
  }).join('') || '<tr><td colspan="4" class="empty">No hay actividades publicadas.</td></tr>'}</tbody></table></div><p id="noTaskResults" class="empty" hidden>No hay actividades que coincidan con los filtros.</p>`;
}
function filterTasks() {
  const q = ($('[data-task-search]')?.value || '').toLowerCase(), type = $('[data-task-filter]')?.value || 'all';
  let count = 0;
  document.querySelectorAll('[data-task-row]').forEach(row => {
    row.hidden = !row.textContent.toLowerCase().includes(q) || !(type === 'all' || row.dataset.visibility === type || type === 'pending' && row.dataset.pending === 'true' || type === 'done' && row.dataset.done === 'true');
    if (!row.hidden)
      count++;
  });
  $('#taskCount').textContent = count + ' actividades';
  $('#noTaskResults').hidden = count > 0 || !records('task').length;
}
function deleteGroupModal(g) {
  if (!teaches() || !g)
    return;
  modal('Eliminar grupo de trabajo', `<p>Vas a eliminar el equipo <strong>${esc(g.data.title)}</strong> (${g.data.members.length} integrantes).</p><p>Los alumnos seguirán inscritos. Sus entregas y calificaciones se conservarán. El equipo se eliminará de forma permanente.</p>` + field('Escribe el nombre exacto del equipo', 'confirm', '', 'text', 'required autocomplete="off"'), async (f) => {
    await request('/api/group', {
      course: current.course.id,
      id: g.id,
      revision: g.revision,
      confirm: f.get('confirm')
    }, 'DELETE');
  }, 'Eliminar grupo');
  $('#formSave').classList.add('danger-button');
}
function deleteCourseModal(id) {
  const c = courses.find(x => x.id === id) || (current?.course.id === id ? { ...current.course, canDelete: current.canDelete } : null);
  if (!c?.canDelete)
    return;
  modal('Eliminar curso / grupo', `<p>Vas a retirar <strong>${esc(c.name)}</strong>, grupo <strong>${esc(c.group_name)}</strong>.</p><p>Desaparecerá de Mis cursos para docentes y alumnos. Se bloqueará el acceso a su contenido. Los registros y archivos se conservarán para evitar pérdida de información; no se borran las cuentas de los alumnos.</p>` + field('Escribe el nombre exacto de la materia', 'confirm', '', 'text', 'required autocomplete="off"'), async (f) => {
    await request('/api/course', { course: c.id, confirm: f.get('confirm') }, 'DELETE');
    if (current?.course.id === c.id)
      current = null;
    courses = await request('/api/courses');
  }, 'Eliminar curso');
  $('#formSave').classList.add('danger-button');
}
async function createCourseGuide() {
  if (!teaches())
    return;
  const result = await request('/api/course-guide', { course: current.course.id, sections: guideSections() });
  moduleId = result.module;
  await reload();
  toast('Guía creada como borrador. Edita los apartados antes de publicarlos.');
}
document.addEventListener('input', e => {
  if (e.target.matches('[data-course-search]'))
    filterCourses();
  if (e.target.matches('[data-group-search]'))
    filterGroups();
  if (e.target.matches('[data-task-search]'))
    filterTasks();
});
document.addEventListener('change', e => {
  if (e.target.matches('[data-course-filter]'))
    filterCourses();
  if (e.target.matches('[data-group-category]'))
    filterGroups();
  if (e.target.matches('[data-task-filter]'))
    filterTasks();
});

// ---- Seguimiento del contenido (12.14) ------------------------------------------------------------
// El alumno marca cada material como completado; abrirlo queda anotado solo. El docente ve cuántos lo completaron.
const progressOf = (memberId, recordId) => (current.progress || []).find((p) => p.member === memberId && p.record === recordId);
const materialsOf = (unitId) => records('material').filter((x) => x.data.module === unitId);
function unitProgress(unitId, memberId) {
  const mats = materialsOf(unitId);
  return { done: mats.filter((x) => progressOf(memberId, x.id)?.completed_at).length, total: mats.length };
}
/** Primer material sin completar, en el orden de las unidades (para «Continuar donde te quedaste»). */
function nextMaterial(memberId) {
  for (const unit of records('module')) {
    const pending = materialsOf(unit.id).find((x) => !progressOf(memberId, x.id)?.completed_at);
    if (pending) return { unit, material: pending };
  }
  return null;
}
const progressBar = (done, total, label) =>
  total ? `<div class="unit-progress" role="img" aria-label="${esc(label)}"><div class="unit-progress-bar"><span style="width:${Math.round((done / total) * 100)}%"></span></div><small>${esc(label)}</small></div>` : '';
/** Tarjeta del inicio del curso para el alumno: dónde continuar y cuánto lleva. */
function continueCardHtml() {
  const member = teaches() ? null : myMember();
  if (!member || !records('material').length) return '';
  const all = records('material').filter((x) => x.data.module && find(x.data.module));
  const done = all.filter((x) => progressOf(member.id, x.id)?.completed_at).length;
  const next = nextMaterial(member.id);
  return `<section class="panel continue-card"><h2>${next ? 'Continuar donde te quedaste' : '¡Completaste todo el contenido!'}</h2>${progressBar(done, all.length, `${done} de ${all.length} materiales completados`)}${
    next ? `<button class="primary" data-action="module" data-id="${esc(next.unit.id)}" data-focus-material="${esc(next.material.id)}">${esc(next.unit.data.title)} · ${esc(next.material.data.title)} →</button>` : ''
  }</section>`;
}
/** Botón del alumno o conteo del docente en cada material. */
function materialProgressHtml(x) {
  if (teaches()) {
    const students = studentsInView();
    if (!students.length) return '';
    const rows = (current.progress || []).filter((p) => p.record === x.id);
    const done = rows.filter((p) => p.completed_at).length;
    return `<span class="material-progress-count">Completado por ${done} de ${students.length} · abierto por ${rows.length}</span>`;
  }
  const member = myMember();
  if (!member) return '';
  const p = progressOf(member.id, x.id);
  return `<div class="material-progress"><button type="button" class="progress-toggle ${p?.completed_at ? 'is-done' : ''}" data-progress-toggle="${esc(x.id)}" aria-pressed="${Boolean(p?.completed_at)}">${
    p?.completed_at ? '✓ Completado' : 'Marcar como completado'
  }</button>${!p?.completed_at && p?.opened_at ? '<span class="muted">Ya lo abriste</span>' : ''}</div>`;
}
async function sendProgress(recordId, action) {
  const member = myMember();
  if (!member || teaches() || previewAsStudent) return null;
  const r = await request('/api/progress', { course: current.course.id, record: recordId, action });
  current.progress ||= [];
  let row = progressOf(member.id, recordId);
  if (!row) current.progress.push((row = { member: member.id, record: recordId, opened_at: r.opened_at, completed_at: null }));
  if (action !== 'open') row.completed_at = r.completed_at;
  return row;
}
// Abrir un material (desplegarlo) queda anotado una sola vez. «toggle» no burbujea: se escucha en captura.
document.addEventListener(
  'toggle',
  (e) => {
    const entry = e.target.closest?.('[data-material]');
    if (!entry || !e.target.open || !current || teaches() || previewAsStudent) return;
    const member = myMember();
    if (member && !progressOf(member.id, entry.dataset.material)) sendProgress(entry.dataset.material, 'open').catch(() => {});
  },
  true,
);
document.addEventListener('click', async (e) => {
  const t = e.target.closest?.('[data-progress-toggle]');
  if (!t) return;
  try {
    const member = myMember();
    const done = progressOf(member?.id, t.dataset.progressToggle)?.completed_at;
    if (previewAsStudent) return toast(PREVIEW_READONLY);
    await sendProgress(t.dataset.progressToggle, done ? 'undo' : 'complete');
    render();
  } catch (error) {
    toast(error.message);
  }
});
