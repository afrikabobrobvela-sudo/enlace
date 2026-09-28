/* Calendario: actividades (con la fecha de cada alumno, incluidas prórrogas) y clases de todos los cursos, en una
 * vista de mes o como agenda. Se filtra por curso y se puede descargar como .ics para Google Calendar o Outlook.
 * En el teléfono empieza en la agenda (el mes completo no cabe bien a 360 px).
 */

const CAL_DAY = 86_400_000;
const CAL_WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const CAL_STATUS = {
  pending: 'Por entregar',
  missing: 'Sin entregar',
  submitted: 'Entregada',
  graded: 'Calificada',
};
const CAL_ATTENDANCE = { present: 'Asistencia', late: 'Retardo', absent: 'Falta', excused: 'Justificada' };
let calState = { month: null, view: null, course: '', data: null, range: null };

const calPad = (n) => String(n).padStart(2, '0');
/** AAAA-MM-DD en la hora local del navegador. */
const calDayKey = (d) => `${d.getFullYear()}-${calPad(d.getMonth() + 1)}-${calPad(d.getDate())}`;
const calStartOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
// Solo la primera letra en mayúscula («Septiembre de 2026», «Lunes, 28 de septiembre»).
const calCapital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const calMonthName = (d) => calCapital(d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }));

/** Primer lunes de la cuadrícula del mes y el día siguiente al último domingo (6 semanas como máximo). */
function calGridRange(month) {
  const first = calStartOfMonth(month);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (7 - ((last.getDay() + 6) % 7)));
  return { start, end };
}

/** Día (local) y hora de un evento: las actividades vienen en ISO; las clases, con fecha y hora locales. */
function calWhen(e) {
  if (e.type === 'session') return { day: e.date, time: e.time || '', sort: `${e.date}T${e.time || '00:00'}` };
  const d = new Date(e.at);
  return { day: calDayKey(d), time: `${calPad(d.getHours())}:${calPad(d.getMinutes())}`, sort: `${calDayKey(d)}T${calPad(d.getHours())}:${calPad(d.getMinutes())}` };
}

function calCourseName(id) {
  const c = calState.data?.courses.find((x) => x.id === id);
  return c ? `${c.name}${c.group_name ? ' · ' + c.group_name : ''}` : '';
}

function calEventLabel(e) {
  if (e.type === 'session') return e.attendance ? CAL_ATTENDANCE[e.attendance] : 'Clase';
  if (e.role === 'teacher') return e.hidden ? 'Actividad oculta' : e.toGrade ? `${e.toGrade} por calificar` : `${e.submitted} ${e.submitted === 1 ? 'entrega' : 'entregas'}`;
  return CAL_STATUS[e.status] + (e.extended ? ' · con prórroga' : '');
}

const calEventClass = (e) => (e.type === 'session' ? 'is-session' : e.role === 'teacher' ? 'is-teaching' : `is-${e.status}`);
const calOpenAttrs = (e) => (e.type === 'session' ? openItemAttrs(e.course, 'attendance') : openItemAttrs(e.course, 'task', e.id));

function calEvents() {
  return (calState.data?.events || [])
    .filter((e) => !calState.course || e.course === calState.course)
    .map((e) => ({ ...e, when: calWhen(e) }))
    .sort((a, b) => (a.when.sort < b.when.sort ? -1 : 1));
}

async function renderCalendar() {
  const phone = globalThis.matchMedia?.('(max-width: 720px)').matches;
  calState.view ??= phone ? 'agenda' : 'month';
  calState.month ??= calStartOfMonth(new Date());
  // Mes: la cuadrícula completa. Agenda: desde hoy (o el mes elegido) y 60 días.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isThisMonth = calDayKey(calState.month).slice(0, 7) === calDayKey(today).slice(0, 7);
  const range =
    calState.view === 'month'
      ? calGridRange(calState.month)
      : { start: isThisMonth ? today : calState.month, end: new Date(+(isThisMonth ? today : calState.month) + 60 * CAL_DAY) };
  $('#main').innerHTML = '<p class="empty">Cargando calendario…</p>';
  try {
    calState.data = await request(`/api/calendar?from=${encodeURIComponent(range.start.toISOString())}&to=${encodeURIComponent(range.end.toISOString())}`);
    calState.range = range;
  } catch (e) {
    $('#main').innerHTML = `<section class="error"><h2>No se pudo cargar el calendario</h2><p>${esc(e.message)}</p>${button('Volver a mis cursos', 'home', '', 'secondary')}</section>`;
    return;
  }
  if (current || homeView !== 'calendar') return;
  drawCalendar();
}

function drawCalendar() {
  const { data, view, month } = calState;
  const courses = data.courses;
  if (calState.course && !courses.some((c) => c.id === calState.course)) calState.course = '';
  const tab = (id, label) => `<button type="button" class="${view === id ? 'active' : ''}" aria-pressed="${view === id}" data-cal-view="${id}">${label}</button>`;
  $('#main').innerHTML = `<button class="back" data-action="home">❮ Volver a mis cursos</button>
    <div class="home-title-row"><div><h1>Calendario</h1><p class="muted">Entregas y clases de todos tus cursos. Las fechas de actividades ya incluyen tus prórrogas.</p></div>
      <div class="action-row"><button type="button" class="secondary" data-cal-ics>Descargar para mi calendario (.ics)</button></div></div>
    <div class="cal-toolbar">
      <div class="cal-nav"><button type="button" class="secondary" data-cal-move="-1" aria-label="Mes anterior">‹</button>
        <strong class="cal-title">${esc(calMonthName(month))}</strong>
        <button type="button" class="secondary" data-cal-move="1" aria-label="Mes siguiente">›</button>
        <button type="button" class="text-btn" data-cal-today>Hoy</button></div>
      <div class="cal-tabs" role="group" aria-label="Vista">${tab('month', 'Mes')}${tab('agenda', 'Agenda')}</div>
      ${courses.length > 1 ? `<label class="filter-control">Curso<select data-cal-course><option value="">Todos</option>${courses.map((c) => `<option value="${esc(c.id)}" ${calState.course === c.id ? 'selected' : ''}>${esc(c.name)}${c.group_name ? ' · ' + esc(c.group_name) : ''}</option>`).join('')}</select></label>` : ''}
    </div>
    <div class="cal-legend" aria-hidden="true">${[['pending', 'Por entregar'], ['missing', 'Sin entregar'], ['submitted', 'Entregada o calificada'], ['session', 'Clase'], ...(courses.some((c) => c.role === 'teacher') ? [['teaching', 'Actividad que impartes']] : [])]
      .map(([k, label]) => `<span class="cal-key"><span class="cal-dot is-${k}"></span>${label}</span>`)
      .join('')}</div>
    ${view === 'month' ? calMonthHtml() : calAgendaHtml()}`;
}

function calChip(e) {
  return `<button type="button" class="cal-chip ${calEventClass(e)}" ${calOpenAttrs(e)} title="${esc(`${e.title} · ${calCourseName(e.course)} · ${calEventLabel(e)}`)}">
    <span class="cal-time">${esc(e.when.time)}</span> ${esc(e.title)}</button>`;
}

function calMonthHtml() {
  const { start, end } = calState.range;
  const byDay = new Map();
  for (const e of calEvents()) byDay.set(e.when.day, [...(byDay.get(e.when.day) || []), e]);
  const today = calDayKey(new Date());
  const cells = [];
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const key = calDayKey(d);
    const events = byDay.get(key) || [];
    const outside = d.getMonth() !== calState.month.getMonth();
    cells.push(`<div class="cal-cell ${outside ? 'is-outside' : ''} ${key === today ? 'is-today' : ''}"><span class="cal-daynum">${d.getDate()}</span>
      ${events.slice(0, 3).map(calChip).join('')}${events.length > 3 ? `<button type="button" class="cal-more" data-cal-day="${key}">+${events.length - 3} más</button>` : ''}</div>`);
  }
  return `<div class="cal-grid" role="grid" aria-label="${esc(calMonthName(calState.month))}">${CAL_WEEKDAYS.map((w) => `<div class="cal-weekday">${w}</div>`).join('')}${cells.join('')}</div>`;
}

function calAgendaHtml(onlyDay = null) {
  const events = calEvents().filter((e) => !onlyDay || e.when.day === onlyDay);
  if (!events.length) return `<p class="empty">No hay entregas ni clases en este periodo.</p>`;
  const groups = new Map();
  for (const e of events) groups.set(e.when.day, [...(groups.get(e.when.day) || []), e]);
  const today = calDayKey(new Date());
  return `<div class="cal-agenda">${[...groups]
    .map(([day, list]) => {
      const date = new Date(day + 'T12:00:00');
      const label = calCapital(date.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }));
      return `<section class="cal-day ${day === today ? 'is-today' : ''}"><h2>${day === today ? 'Hoy · ' : ''}${esc(day === today ? label.toLowerCase() : label)}</h2><ul>${list
        .map(
          (e) => `<li><button type="button" class="cal-item ${calEventClass(e)}" ${calOpenAttrs(e)}>
            <span class="cal-dot ${calEventClass(e)}"></span><span class="cal-item-time">${esc(e.when.time || 'Todo el día')}</span>
            <span class="cal-item-body"><strong>${esc(e.title)}</strong><span class="muted">${esc(calCourseName(e.course))} · ${esc(calEventLabel(e))}</span></span></button></li>`,
        )
        .join('')}</ul></section>`;
    })
    .join('')}</div>`;
}

// ---- Exportar (.ics) ------------------------------------------------------------------------------

const icsText = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => '\\' + c);
const icsUtc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Archivo iCalendar con los eventos que se ven (actividades en UTC; clases en hora local, de 1 hora). */
function calendarIcs(events, stamp = new Date()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Enlace//Calendario//ES', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Enlace'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.type}-${e.id}@enlace`, `DTSTAMP:${icsUtc(stamp)}`);
    if (e.type === 'session') {
      const [y, m, d] = e.date.split('-');
      if (e.time) {
        const [h, min] = e.time.split(':');
        const endH = calPad((Number(h) + 1) % 24);
        lines.push(`DTSTART:${y}${m}${d}T${h}${min}00`, `DTEND:${y}${m}${d}T${endH}${min}00`);
      } else lines.push(`DTSTART;VALUE=DATE:${y}${m}${d}`);
      lines.push(`SUMMARY:${icsText(`Clase: ${e.title}`)}`);
    } else {
      const due = new Date(e.at);
      lines.push(`DTSTART:${icsUtc(new Date(+due - 30 * 60_000))}`, `DTEND:${icsUtc(due)}`, `SUMMARY:${icsText(`Entrega: ${e.title}`)}`);
    }
    lines.push(`DESCRIPTION:${icsText(`${calCourseName(e.course)} · ${calEventLabel(e)}`)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/** Líneas de máximo 75 octetos en UTF-8 (RFC 5545): se doblan con salto y un espacio, sin partir letras. */
function icsFold(line) {
  const out = [];
  let chunk = '';
  let bytes = 0;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    if (bytes + size > (out.length ? 74 : 75)) {
      out.push(chunk);
      chunk = '';
      bytes = 0;
    }
    chunk += ch;
    bytes += size;
  }
  out.push(chunk);
  return out.join('\r\n ');
}

function downloadCalendarIcs() {
  const events = calEvents();
  if (!events.length) return toast('No hay eventos en este periodo para descargar.');
  const blob = new Blob([calendarIcs(events)], { type: 'text/calendar;charset=utf-8' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `enlace-calendario-${calDayKey(calState.range.start)}.ics` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast(`Se descargaron ${events.length} ${events.length === 1 ? 'evento' : 'eventos'}. Ábrelo con tu calendario para agregarlos.`);
}

// ---- Eventos -----------------------------------------------------------------------------------------

document.addEventListener('change', (e) => {
  if (!e.target.matches?.('[data-cal-course]')) return;
  calState.course = e.target.value;
  drawCalendar();
});

document.addEventListener('click', async (e) => {
  const t = e.target.closest?.('[data-cal-move],[data-cal-today],[data-cal-view],[data-cal-ics],[data-cal-day]');
  if (!t) return;
  try {
    if (t.dataset.calMove) {
      calState.month = new Date(calState.month.getFullYear(), calState.month.getMonth() + Number(t.dataset.calMove), 1);
      return await renderCalendar();
    }
    if (t.matches('[data-cal-today]')) {
      calState.month = calStartOfMonth(new Date());
      return await renderCalendar();
    }
    if (t.dataset.calView) {
      calState.view = t.dataset.calView;
      return await renderCalendar();
    }
    if (t.matches('[data-cal-ics]')) return downloadCalendarIcs();
    if (t.dataset.calDay) {
      const date = calCapital(new Date(t.dataset.calDay + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }));
      modal(date, calAgendaHtml(t.dataset.calDay), null);
    }
  } catch (error) {
    toast(error.message);
  }
});
