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
};
const NOTICE_TARGET = { notice: 'notices', material: 'content', quiz: 'quiz', task: 'task', grade: 'task', submission: 'task' };
let noticesCache = null;

async function loadNotices() {
  const bell = $('#bell');
  if (!bell || !me) return;
  try {
    noticesCache = await request('/api/notifications');
  } catch {
    return;
  }
  bell.hidden = false;
  const badge = bell.querySelector('.badge-count');
  badge.textContent = noticesCache.unread > 9 ? '9+' : String(noticesCache.unread);
  badge.hidden = !noticesCache.unread;
  bell.setAttribute('aria-label', noticesCache.unread ? `Avisos: ${noticesCache.unread} nuevos` : 'Avisos');
}

function startNotices() {
  loadNotices();
  clearInterval(noticesTimer);
  noticesTimer = setInterval(loadNotices, 5 * 60_000);
}

async function toggleNoticesPanel() {
  const panel = $('#bellPanel');
  if (!panel.hidden) return (panel.hidden = true);
  if (!noticesCache) await loadNotices();
  const items = noticesCache?.items || [];
  panel.innerHTML = `<div class="bell-head"><strong>Avisos</strong><span class="muted">Últimos 14 días</span></div>${
    items.length
      ? `<ul>${items
          .map(
            (i) => `<li><button class="bell-item ${i.fresh ? 'is-new' : ''}" ${openItemAttrs(i.course, NOTICE_TARGET[i.type], i.id)}>
              <span class="bell-kind">${NOTICE_LABELS[i.type] || ''}${i.count > 1 ? ` (${i.count})` : ''}</span>
              <span class="bell-title">${esc(i.title || 'Sin título')}</span>
              <span class="bell-meta">${esc(i.course_name)} · ${esc(fmt(i.at))}</span></button></li>`,
          )
          .join('')}</ul>`
      : '<p class="muted bell-empty">No hay avisos recientes.</p>'
  }`;
  panel.hidden = false;
  if (noticesCache?.unread) {
    request('/api/notifications/seen', {}).catch(() => {});
    noticesCache.unread = 0;
    noticesCache.items.forEach((i) => (i.fresh = false));
    const badge = $('#bell .badge-count');
    if (badge) badge.hidden = true;
  }
}

/** Abre un curso en la sección que corresponde al aviso o pendiente. */
async function openFromNotice(dataset) {
  $('#bellPanel') && ($('#bellPanel').hidden = true);
  if (current?.course.id !== dataset.openCourse) await openCourse(dataset.openCourse);
  const type = dataset.openType;
  if (type === 'task' || type === 'quiz') {
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

document.addEventListener('click', async (e) => {
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
