/* "Mis pendientes" en la pantalla de inicio, avisos (campana del encabezado) y comprobante de entrega. */

let noticesTimer = null;

function relativeDue(iso) {
  const days = Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
  if (days < -1) return `venció hace ${-days} días`;
  if (days === -1) return 'venció ayer';
  if (days === 0) return Date.parse(iso) < Date.now() ? 'venció hoy' : 'vence hoy';
  if (days === 1) return 'vence mañana';
  return `vence en ${days} días`;
}

const openItemAttrs = (course, type, id) => `data-open-course="${esc(course)}" data-open-type="${esc(type)}" data-open-id="${esc(id || '')}"`;

/** Panel de inicio: por entregar, calificaciones nuevas y (docentes) entregas por calificar. */
async function renderHomeDashboard() {
  const box = $('#homeDashboard');
  if (!box) return;
  let data;
  try {
    data = await request('/api/dashboard');
  } catch {
    box.hidden = true;
    return;
  }
  if (!$('#homeDashboard') || current) return; // la persona ya navegó a otra pantalla
  const pending = data.pending.map(
    (p) => `<li><button class="dash-item ${p.overdue ? 'is-overdue' : ''}" ${openItemAttrs(p.course, 'task', p.id)}>
      <span class="dash-title">${esc(p.title)}</span><span class="dash-meta">${esc(p.course_name)} · ${esc(relativeDue(p.due))}${p.extended ? ' · con prórroga' : ''}</span></button></li>`,
  );
  const grades = data.grades.map(
    (g) => `<li><button class="dash-item" ${openItemAttrs(g.course, 'task', g.id)}><span class="dash-title">${esc(g.title)}</span>
      <span class="dash-meta">${esc(g.course_name)} · calificación <b>${esc(g.grade)}</b></span></button></li>`,
  );
  const toGrade = data.toGrade.map(
    (t) => `<li><button class="dash-item" ${openItemAttrs(t.course, 'tasks')}><span class="dash-title">${esc(t.course_name)}</span>
      <span class="dash-meta">${t.count} ${t.count === 1 ? 'entrega' : 'entregas'} por calificar</span></button></li>`,
  );
  const card = (title, items, empty) => `<section class="dash-card"><h2>${title}</h2>${items.length ? `<ul>${items.join('')}</ul>` : `<p class="muted">${empty}</p>`}</section>`;
  const cards = [];
  if (toGrade.length || me.role !== 'student') cards.push(card('Por calificar', toGrade, 'No tienes entregas pendientes de calificar.'));
  if (pending.length || me.role === 'student') cards.push(card('Por entregar', pending, 'No tienes actividades próximas. ¡Vas al día!'));
  if (grades.length) cards.push(card('Calificaciones nuevas', grades, ''));
  box.innerHTML = cards.join('');
  box.hidden = !cards.length;
}

// ---- Avisos -------------------------------------------------------------------------------------

const NOTICE_LABELS = {
  notice: 'Noticia',
  material: 'Material nuevo',
  quiz: 'Evaluación',
  task: 'Actividad',
  grade: 'Calificación publicada',
  submission: 'Entregas nuevas',
  post: 'Foro: publicaciones nuevas',
};
const NOTICE_TARGET = { notice: 'notices', material: 'content', quiz: 'quiz', task: 'task', grade: 'task', submission: 'task', post: 'thread' };
let noticesCache = null;
let noticesLoadedAt = 0;
const NOTICES_EVERY = 5 * 60_000;

/**
 * Campana (12.30, límite gratuito de D1): cada 5 minutos solo si la pestaña está a la vista; al volver a ella, si ya
 * pasaron 5 minutos. Con un examen abierto no se pide (el servidor solo atiende el examen). Antes cada pestaña abierta
 * la pedía cada 5 minutos todo el día, aunque estuviera oculta.
 */
async function loadNotices({ force = true } = {}) {
  const bell = $('#bell');
  if (!bell || !me || me.activeExam) return;
  if (!force && (document.visibilityState === 'hidden' || Date.now() - noticesLoadedAt < NOTICES_EVERY - 5000)) return;
  noticesLoadedAt = Date.now();
  try {
    noticesCache = await request('/api/notifications');
  } catch {
    return;
  }
  bell.hidden = false;
  updateBellBadge();
}

function startNotices() {
  loadNotices();
  clearInterval(noticesTimer);
  noticesTimer = setInterval(() => loadNotices({ force: false }), NOTICES_EVERY);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && noticesTimer) loadNotices({ force: false });
});

// Filtros de los avisos (panel e historial): curso y "solo sin leer".
let noticeFilter = { course: '', unread: false };

function noticeListHtml(items) {
  const shown = items.filter((i) => (!noticeFilter.course || i.course === noticeFilter.course) && (!noticeFilter.unread || i.fresh));
  if (!shown.length) return `<p class="muted bell-empty">${items.length ? 'Ningún aviso coincide con el filtro.' : 'No hay avisos recientes.'}</p>`;
  return `<ul class="notice-list">${shown
    .map(
      (i) => `<li><button class="bell-item ${i.fresh ? 'is-new' : ''}" data-notice-key="${esc(i.key || '')}" ${openItemAttrs(i.course, NOTICE_TARGET[i.type], i.id)}>
        <span class="bell-kind">${i.fresh ? '<span class="unread-dot" aria-label="Sin leer"></span>' : ''}${NOTICE_LABELS[i.type] || ''}${i.count > 1 ? ` (${i.count})` : ''}</span>
        <span class="bell-title">${esc(i.title || 'Sin título')}</span>
        <span class="bell-meta">${esc(i.course_name)} · ${esc(fmt(i.at))}</span></button></li>`,
    )
    .join('')}</ul>`;
}

function noticeFiltersHtml(items) {
  const courses = [...new Map(items.map((i) => [i.course, i.course_name])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  if (noticeFilter.course && !courses.some(([id]) => id === noticeFilter.course)) noticeFilter.course = '';
  return `<div class="notice-filters">
    ${courses.length > 1 ? `<label class="sr-only" for="noticeCourse">Curso</label><select id="noticeCourse" data-notice-course><option value="">Todos los cursos</option>${courses
      .map(([id, name]) => `<option value="${esc(id)}" ${noticeFilter.course === id ? 'selected' : ''}>${esc(name)}</option>`)
      .join('')}</select>` : ''}
    <label class="check-label"><input type="checkbox" data-notice-unread ${noticeFilter.unread ? 'checked' : ''}> Solo sin leer</label>
  </div>`;
}

function updateBellBadge() {
  const badge = $('#bell .badge-count');
  if (!badge || !noticesCache) return;
  badge.textContent = noticesCache.unread > 9 ? '9+' : String(noticesCache.unread);
  badge.hidden = !noticesCache.unread;
  $('#bell').setAttribute('aria-label', noticesCache.unread ? `Avisos: ${noticesCache.unread} nuevos` : 'Avisos');
}

function drawNoticesPanel() {
  const panel = $('#bellPanel');
  const items = noticesCache?.items || [];
  panel.innerHTML = `<div class="bell-head"><strong>Avisos</strong>${
    noticesCache?.unread ? '<button type="button" class="text-btn" data-notices-all-read>Marcar todo como leído</button>' : '<span class="muted">Últimos 14 días</span>'
  }</div>${items.length ? noticeFiltersHtml(items) : ''}${noticeListHtml(items)}
  <div class="bell-foot"><button type="button" class="text-btn" data-notices-history>Ver historial (60 días)</button></div>`;
}

async function toggleNoticesPanel() {
  const panel = $('#bellPanel');
  if (!panel.hidden) return (panel.hidden = true);
  if (!noticesCache) await loadNotices();
  drawNoticesPanel();
  panel.hidden = false;
}

/** Marca un aviso como leído en el servidor y en pantalla (sin esperar la respuesta). */
function markNoticeRead(key) {
  if (!key) return;
  for (const list of [noticesCache?.items, noticesHistory?.items]) {
    const item = list?.find((i) => i.key === key && i.fresh);
    if (!item) continue;
    item.fresh = false;
    if (list === noticesCache?.items) noticesCache.unread = Math.max(0, noticesCache.unread - 1);
  }
  updateBellBadge();
  request('/api/notifications/read', { items: [key] }).catch(() => {});
}

async function markAllNoticesRead() {
  await request('/api/notifications/seen', {});
  for (const list of [noticesCache?.items, noticesHistory?.items]) list?.forEach((i) => (i.fresh = false));
  if (noticesCache) noticesCache.unread = 0;
  updateBellBadge();
}

// ---- Historial de avisos (pantalla completa, 60 días) -----------------------------------------------

let noticesHistory = null;

async function renderNoticesPage() {
  $('#main').innerHTML = '<p class="empty">Cargando avisos…</p>';
  try {
    noticesHistory = await request('/api/notifications?days=60');
  } catch (e) {
    $('#main').innerHTML = `<section class="error"><h2>No se pudieron cargar los avisos</h2><p>${esc(e.message)}</p>${button('Volver a mis cursos', 'home', '', 'secondary')}</section>`;
    return;
  }
  if (current || homeView !== 'avisos') return;
  drawNoticesPage();
}

function drawNoticesPage() {
  const items = noticesHistory.items;
  const unread = items.filter((i) => i.fresh).length;
  $('#main').innerHTML = `<button class="back" data-action="home">❮ Volver a mis cursos</button>
    <div class="home-title-row"><div><h1>Avisos</h1><p class="muted">Lo publicado en tus cursos en los últimos 60 días. ${unread ? `${unread} sin leer.` : 'Todo leído.'}</p></div>
      ${unread ? '<div class="action-row"><button class="secondary" type="button" data-notices-all-read>Marcar todo como leído</button></div>' : ''}</div>
    <section class="panel notices-page">${items.length ? noticeFiltersHtml(items) : ''}<div id="noticesPageList">${noticeListHtml(items)}</div></section>`;
}

function redrawNotices() {
  if (!$('#bellPanel').hidden) drawNoticesPanel();
  if (!current && homeView === 'avisos' && noticesHistory) drawNoticesPage();
}

/** Abre un curso en la sección que corresponde al aviso o pendiente. */
async function openFromNotice(dataset) {
  $('#bellPanel') && ($('#bellPanel').hidden = true);
  // Desde una ventana (por ejemplo, los eventos de un día del calendario): primero se cierra.
  const dialog = $('#modal');
  if (dialog?.open) return closeDialogThen(dialog, () => openFromNotice(dataset).catch((error) => toast(error.message)));
  if (current?.course.id !== dataset.openCourse) await openCourse(dataset.openCourse);
  const type = dataset.openType;
  if (type === 'task' || type === 'quiz' || type === 'thread') {
    section = type;
    detail = dataset.openId;
  } else {
    section = type || 'hub';
    detail = null;
  }
  render();
  window.scrollTo?.(0, 0);
}

// ---- Comprobante de entrega ----------------------------------------------------------------------

async function receiptModal(submissionId) {
  const r = await request(`/api/receipt?course=${encodeURIComponent(current.course.id)}&id=${encodeURIComponent(submissionId)}`);
  const size = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB');
  modal(
    'Comprobante de entrega',
    `<div class="receipt">
      <p class="receipt-folio">Folio <strong>${esc(r.folio)}</strong></p>
      <dl>
        <dt>Alumno</dt><dd>${esc(r.student)}</dd>
        <dt>Curso</dt><dd>${esc(r.course)} · ${esc(r.group)}</dd>
        <dt>Actividad</dt><dd>${esc(r.task)}</dd>
        <dt>Entregada</dt><dd>${esc(new Date(r.submitted).toLocaleString('es-MX', { dateStyle: 'full', timeStyle: 'medium' }))}${r.late ? ' (tardía)' : ''}</dd>
        <dt>Contenido</dt><dd>${r.text ? `Texto de ${r.text} caracteres` : 'Sin texto'}${r.files.length ? `; archivos: ${r.files.map((f) => `${esc(f.name)} (${size(f.size)})`).join(', ')}` : ''}</dd>
      </dl>
      <p class="muted">El folio lo genera Enlace a partir de la entrega. Tu docente puede verificarlo: si la entrega cambia, el folio cambia.</p>
      <button type="button" class="secondary" data-receipt-print>Imprimir o guardar como PDF</button>
    </div>`,
    null,
  );
}

document.addEventListener('change', (e) => {
  if (e.target.matches?.('[data-notice-course]')) noticeFilter.course = e.target.value;
  else if (e.target.matches?.('[data-notice-unread]')) noticeFilter.unread = e.target.checked;
  else return;
  redrawNotices();
});

document.addEventListener('click', async (e) => {
  const allRead = e.target.closest('[data-notices-all-read]');
  const history = e.target.closest('[data-notices-history]');
  try {
    if (allRead) {
      await markAllNoticesRead();
      return redrawNotices();
    }
    if (history) {
      $('#bellPanel').hidden = true;
      current = null;
      previewAsStudent = false;
      previewMember = null;
      homeView = 'avisos';
      return render();
    }
  } catch (error) {
    return toast(error.message);
  }
  const noticeKey = e.target.closest('[data-notice-key]')?.dataset.noticeKey;
  if (noticeKey) markNoticeRead(noticeKey);
  const open = e.target.closest('[data-open-course]');
  const bell = e.target.closest('#bell');
  const receipt = e.target.closest('[data-receipt]');
  const print = e.target.closest('[data-receipt-print]');
  try {
    if (bell) return await toggleNoticesPanel();
    if (open) return await openFromNotice(open.dataset);
    if (receipt) return await receiptModal(receipt.dataset.receipt);
    if (print) return window.print();
    if ($('#bellPanel') && !$('#bellPanel').hidden && !e.target.closest('#bellPanel')) $('#bellPanel').hidden = true;
  } catch (error) {
    toast(error.message);
  }
});
