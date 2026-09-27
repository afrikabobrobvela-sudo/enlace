/* Asistencia: resumen del periodo, pasar lista y vista del alumno.
   Cada toque se guarda solo; si no hay internet, los cambios esperan en este dispositivo y se envían al reconectar. */

const ATT_STATUS = {
  present: { label: 'Presente', short: 'P' },
  late: { label: 'Retardo', short: 'R' },
  absent: { label: 'Falta', short: 'F' },
  excused: { label: 'Justificada', short: 'J' },
};
const ATT_QUEUE_KEY = 'enlace:asistencia:pendientes';
const WEEKDAYS = [[1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [0, 'Dom']];
let attendanceData = null;
let attendanceLoadedAt = 0;
let attendanceSessionId = null;
let attendanceSyncing = false;

/** Porcentaje de asistencia según las reglas del curso. Solo cuentan las sesiones con registro. */
function attendanceSummary(statuses, settings) {
  const counts = { present: 0, late: 0, absent: 0, excused: 0 };
  for (const status of statuses) if (status in counts) counts[status]++;
  let total = counts.present + counts.late + counts.absent + counts.excused;
  let attended = counts.present + counts.late;
  if (settings.excused_counts === 'present') attended += counts.excused;
  else total -= counts.excused;
  if (settings.lates_per_absence > 0) attended -= Math.floor(counts.late / settings.lates_per_absence);
  const percent = total ? (Math.max(0, attended) / total) * 100 : null;
  return { ...counts, total, percent, low: percent !== null && percent < settings.min_percent };
}

function localToday() {
  return new Date().toLocaleDateString('en-CA'); // AAAA-MM-DD en la zona horaria del dispositivo
}

function sessionLabel(session, style = 'short') {
  const date = new Date(session.date + 'T12:00:00');
  const text =
    style === 'long'
      ? date.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : date.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
  return session.start_time ? `${text}, ${session.start_time}` : text;
}

/** Encabezado compacto: día de la semana y fecha (y la hora solo si hay dos sesiones el mismo día). */
function columnLabel(session, sessions) {
  const date = new Date(session.date + 'T12:00:00');
  const weekday = date.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', '');
  const shared = sessions.filter((s) => s.date === session.date).length > 1;
  return `<span class="att-day">${esc(weekday)}</span><span>${session.date.slice(8)}/${session.date.slice(5, 7)}</span>${
    shared && session.start_time ? `<span class="att-day">${esc(session.start_time)}</span>` : ''
  }`;
}

function attendanceStudents() {
  return current.members.filter((m) => m.role === 'student');
}

function attendanceRecord(sessionId, memberId) {
  return attendanceData.records.find((r) => r.session === sessionId && r.member === memberId) || null;
}

function percentPill(summary, min) {
  if (summary.percent === null) return '<span class="att-pill">—</span>';
  const value = `${Math.round(summary.percent)} %`;
  return summary.low
    ? `<span class="att-pill low" title="Debajo del mínimo de ${min} %">${value} <span aria-hidden="true">⚠</span><span class="sr-only">, debajo del mínimo</span></span>`
    : `<span class="att-pill ok">${value}</span>`;
}

// ---- Cola de cambios pendientes (funciona sin conexión) ---------------------------------------

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(ATT_QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  try {
    localStorage.setItem(ATT_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* modo privado: la cola vive solo en memoria de esta pestaña */
  }
}

function applyQueued() {
  for (const item of readQueue()) {
    if (item.course !== attendanceData.course) continue;
    const existing = attendanceRecord(item.session, item.member);
    if (existing) Object.assign(existing, { status: item.status, note: item.note });
    else attendanceData.records.push({ session: item.session, member: item.member, status: item.status, note: item.note });
  }
}

function showSyncState(text) {
  const box = document.getElementById('attSync');
  if (box) box.textContent = text;
}

async function flushAttendance() {
  if (attendanceSyncing) return;
  const queue = readQueue();
  if (!queue.length) return showSyncState('');
  attendanceSyncing = true;
  showSyncState('Guardando…');
  const batch = queue.filter((item) => item.course === queue[0].course && item.session === queue[0].session);
  try {
    await request('/api/attendance/mark', {
      course: batch[0].course,
      session: batch[0].session,
      marks: batch.map(({ member, status, note }) => ({ member, status, note })),
    });
    const sent = new Set(batch.map((item) => item.key));
    writeQueue(readQueue().filter((item) => !sent.has(item.key)));
    attendanceSyncing = false;
    showSyncState('Guardado');
    if (readQueue().length) return flushAttendance();
  } catch (error) {
    attendanceSyncing = false;
    if (error.status) {
      // El servidor rechazó el cambio (por ejemplo, la sesión se borró en otro dispositivo): no se reintenta.
      const sent = new Set(batch.map((item) => item.key));
      writeQueue(readQueue().filter((item) => !sent.has(item.key)));
      toast(error.message);
      attendanceData = null;
      if (section === 'attendance') renderAttendance();
    } else {
      const pending = readQueue().length;
      showSyncState(`Sin conexión: ${pending} ${pending === 1 ? 'cambio se enviará' : 'cambios se enviarán'} al reconectar.`);
    }
  }
}

function markAttendance(sessionId, memberIds, status, note) {
  const queue = readQueue();
  for (const member of memberIds) {
    const record = attendanceRecord(sessionId, member);
    const text = note ?? record?.note ?? '';
    if (record) Object.assign(record, { status, note: text });
    else attendanceData.records.push({ session: sessionId, member, status, note: text });
    queue.push({ key: crypto.randomUUID(), course: attendanceData.course, session: sessionId, member, status, note: text });
  }
  writeQueue(queue);
  flushAttendance();
}

window.addEventListener('online', () => flushAttendance());

// ---- Pantallas -------------------------------------------------------------------------------

async function renderAttendance() {
  const courseId = current.course.id;
  if (!attendanceData || attendanceData.course !== courseId || Date.now() - attendanceLoadedAt > 30000) {
    if (!attendanceData || attendanceData.course !== courseId) $('#main').innerHTML = '<p class="empty">Cargando asistencia…</p>';
    try {
      const data = await request('/api/attendance?course=' + encodeURIComponent(courseId));
      attendanceData = { course: courseId, ...data };
      attendanceLoadedAt = Date.now();
    } catch (error) {
      if (!attendanceData || attendanceData.course !== courseId) {
        $('#main').innerHTML = `<section class="error"><h2>No se pudo cargar la asistencia</h2><p>${esc(error.message)}</p></section>`;
        return;
      }
    }
    if (section !== 'attendance' || current?.course.id !== courseId) return;
  }
  applyQueued();
  if (!attendanceData.canTeach) return renderMyAttendance();
  if (checkinState && checkinState.course === courseId && checkinState.session === attendanceSessionId) return renderCheckinScreen();
  if (attendanceSessionId && attendanceData.sessions.some((s) => s.id === attendanceSessionId)) return renderRollCall();
  attendanceSessionId = null;
  renderAttendanceGrid();
  flushAttendance();
}

function renderAttendanceGrid() {
  const { sessions, settings } = attendanceData;
  const students = attendanceStudents();
  const actions = `<div class="action-row">
      <button class="primary" data-att="today">Pasar lista de hoy</button>
      <button class="secondary" data-att="new">Nueva sesión</button>
      <button class="secondary" data-att="generate">Generar calendario</button>
      <button class="secondary" data-att="settings">Reglas</button>
      ${sessions.length ? '<button class="secondary" data-att="export">Exportar a Excel</button>' : ''}
    </div>`;
  const rules = `Mínimo requerido: ${settings.min_percent} %. ${
    settings.lates_per_absence ? `${settings.lates_per_absence} retardos equivalen a una falta. ` : 'Los retardos cuentan como asistencia. '
  }${settings.excused_counts === 'present' ? 'Las faltas justificadas cuentan como asistencia.' : 'Las faltas justificadas no se toman en cuenta.'}`;
  if (!sessions.length) {
    $('#main').innerHTML = `<div class="page-heading"><div><h1>Asistencia</h1><p class="muted">${rules}</p></div></div>
      <section class="empty-state"><h2>Todavía no hay sesiones</h2>
      <p>Genera las fechas del semestre a partir de tus días de clase, o pasa lista de hoy.</p>${actions}</section>`;
    return;
  }
  const rows = students
    .map((m) => {
      const statuses = sessions.map((s) => attendanceRecord(s.id, m.id)?.status);
      const summary = attendanceSummary(statuses.filter(Boolean), settings);
      return `<tr data-search-row><td class="sticky-name"><div class="att-who"><span>${esc(m.name)}</span>${percentPill(summary, settings.min_percent)}</div><div class="muted">${esc(m.matricula || '')}</div></td>
        ${statuses.map((st) => (st ? `<td><span class="att-mark ${st}" title="${ATT_STATUS[st].label}">${ATT_STATUS[st].short}</span></td>` : '<td><span class="att-mark none" title="Sin registro">·</span></td>')).join('')}</tr>`;
    })
    .join('');
  $('#main').innerHTML = `<div class="page-heading"><div><h1>Asistencia</h1><p class="muted">${rules}</p></div>${actions}</div>
    <p id="attSync" class="att-sync" role="status"></p>
    <div class="toolbar"><input data-search type="search" placeholder="Buscar alumno…" aria-label="Buscar alumno"></div>
    <p class="att-legend">P presente, R retardo, F falta, J justificada. Toca una fecha para pasar lista o corregirla.</p>
    <div class="table-wrap gradebook att-grid"><table><thead><tr><th class="sticky-name">Alumno y asistencia</th>
      ${sessions.map((s) => `<th><button class="table-link" data-att="open" data-id="${s.id}" aria-label="Pasar lista del ${esc(sessionLabel(s, 'long'))}">${columnLabel(s, sessions)}</button></th>`).join('')}
    </tr></thead><tbody>${rows || '<tr><td>No hay alumnos inscritos.</td></tr>'}</tbody></table></div>`;
  const wrap = document.querySelector('.att-grid');
  if (wrap) wrap.scrollLeft = wrap.scrollWidth; // las fechas más recientes a la vista
}

function renderRollCall() {
  const session = attendanceData.sessions.find((s) => s.id === attendanceSessionId);
  const students = attendanceStudents();
  const records = students.map((m) => attendanceRecord(session.id, m.id));
  const counts = attendanceSummary(records.filter(Boolean).map((r) => r.status), attendanceData.settings);
  const missing = records.filter((r) => !r).length;
  $('#main').innerHTML = `<button class="back" data-att="back">❮ Resumen de asistencia</button>
    <div class="page-heading"><div><h1>Pasar lista</h1><p class="muted">${esc(sessionLabel(session, 'long'))}${session.topic ? `. ${esc(session.topic)}` : ''}</p></div>
      <div class="action-row">${missing ? `<button class="primary" data-att="all-present">${missing === students.length ? 'Todos presentes' : `Marcar ${missing} sin registro como presentes`}</button>` : ''}
      <button class="secondary" data-att="qr">Registro con QR</button>
      <button class="danger-link" data-att="delete" data-id="${session.id}">Eliminar sesión</button></div></div>
    <p class="att-counts">${counts.present} presentes, ${counts.late} retardos, ${counts.absent} faltas, ${counts.excused} justificadas${missing ? `, ${missing} sin registro` : ''}.</p>
    <p id="attSync" class="att-sync" role="status"></p>
    <div class="toolbar"><input data-search type="search" placeholder="Buscar alumno…" aria-label="Buscar alumno"></div>
    <ul class="att-list">${students
      .map((m, i) => {
        const record = records[i];
        return `<li data-search-row class="${record ? '' : 'att-missing'}">
          <div class="att-name">${esc(m.name)}<small>${esc(m.matricula || '')}</small></div>
          <div class="att-states" role="group" aria-label="Asistencia de ${esc(m.name)}">${Object.entries(ATT_STATUS)
            .map(([status, info]) => `<button type="button" class="att-state ${status}" data-att="mark" data-member="${m.id}" data-status="${status}" aria-pressed="${record?.status === status}">${info.label}</button>`)
            .join('')}</div>
          ${record && (record.status !== 'present' || record.note) ? `<input class="att-note" data-att-note data-member="${m.id}" value="${esc(record.note || '')}" placeholder="Nota (opcional), por ejemplo: llegó 7:15 o constancia médica" aria-label="Nota para ${esc(m.name)}" maxlength="500">` : ''}
        </li>`;
      })
      .join('')}</ul>`;
  flushAttendance();
}

/** Vuelve a dibujar la lista sin perder la búsqueda, la posición ni el foco. */
function redrawRollCall(focusSelector) {
  const search = document.querySelector('[data-search]')?.value || '';
  const y = window.scrollY;
  renderRollCall();
  const input = document.querySelector('[data-search]');
  if (search && input) {
    input.value = search;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  window.scrollTo(0, y);
  if (focusSelector) document.querySelector(focusSelector)?.focus({ preventScroll: true });
}

function renderMyAttendance() {
  const { sessions, records, settings } = attendanceData;
  const mine = new Map(records.map((r) => [r.session, r]));
  const summary = attendanceSummary(records.map((r) => r.status), settings);
  const today = localToday();
  const past = sessions.filter((s) => s.date <= today).reverse();
  $('#main').innerHTML = `<h1>Mi asistencia</h1>
    <section class="att-mine"><p class="att-mine-value">${percentPill(summary, settings.min_percent)}</p>
      <p>${summary.present} asistencias, ${summary.late} retardos, ${summary.absent} faltas y ${summary.excused} justificadas. El mínimo requerido es ${settings.min_percent} %.</p></section>
    <ul class="att-history">${past
      .map((s) => {
        const record = mine.get(s.id);
        return `<li><span>${esc(sessionLabel(s, 'long'))}</span>${
          record ? `<span class="att-mark ${record.status}">${ATT_STATUS[record.status].label}</span>` : '<span class="muted">Sin registro</span>'
        }${record?.note ? `<p class="muted">${esc(record.note)}</p>` : ''}</li>`;
      })
      .join('') || '<li class="muted">Todavía no hay clases registradas.</li>'}</ul>`;
}

// ---- Acciones --------------------------------------------------------------------------------

function refreshAttendance(message) {
  attendanceData = null;
  return message;
}

function newSessionModal(date = localToday()) {
  modal(
    'Nueva sesión',
    field('Fecha', 'date', date, 'date', 'required') + field('Hora (opcional)', 'start_time', '', 'time') + field('Tema (opcional)', 'topic', '', 'text', 'maxlength="200"'),
    async (f) => {
      const { id } = await request('/api/attendance/session', {
        course: current.course.id,
        date: f.get('date'),
        start_time: f.get('start_time'),
        topic: f.get('topic'),
      });
      attendanceSessionId = id;
      return refreshAttendance('Sesión creada.');
    },
    'Crear sesión',
  );
}

function generateSessionsModal() {
  modal(
    'Generar calendario',
    `<p>Crea una sesión por cada día de clase del periodo. Las fechas que ya existen no se duplican.</p>` +
      field('Desde', 'from', localToday(), 'date', 'required') +
      field('Hasta', 'to', '', 'date', 'required') +
      `<fieldset class="att-weekdays"><legend>Días de clase</legend>${WEEKDAYS.map(([value, label]) => `<label><input type="checkbox" name="d${value}"> ${label}</label>`).join('')}</fieldset>` +
      field('Hora (opcional)', 'start_time', '', 'time') +
      `<label>Días sin clase (opcional)<textarea name="skip" placeholder="2026-11-02&#10;2026-11-16"></textarea></label>
       <p class="muted">Una fecha por línea con el formato AAAA-MM-DD. También puedes borrar sesiones después.</p>`,
    async (f) => {
      const weekdays = WEEKDAYS.map(([value]) => value).filter((value) => f.get('d' + value) === 'on');
      const skip = String(f.get('skip') || '').split(/[\s,;]+/).filter(Boolean);
      const result = await request('/api/attendance/generate', {
        course: current.course.id,
        from: f.get('from'),
        to: f.get('to'),
        weekdays,
        start_time: f.get('start_time'),
        skip,
      });
      return refreshAttendance(
        `Se ${result.created === 1 ? 'creó 1 sesión' : `crearon ${result.created} sesiones`}${result.existing ? ` (${result.existing} ya existían)` : ''}.`,
      );
    },
    'Generar sesiones',
  );
}

function attendanceSettingsModal() {
  const s = attendanceData.settings;
  modal(
    'Reglas de asistencia',
    field('Asistencia mínima (%)', 'min_percent', s.min_percent, 'number', 'min="0" max="100" step="1" required') +
      `<label>Retardos que equivalen a una falta<select name="lates_per_absence">${[0, 2, 3, 4, 5]
        .map((n) => `<option value="${n}" ${s.lates_per_absence === n ? 'selected' : ''}>${n ? n + ' retardos' : 'Ninguno: el retardo cuenta como asistencia'}</option>`)
        .join('')}</select></label>
       <label>Faltas justificadas<select name="excused_counts">
         <option value="present" ${s.excused_counts === 'present' ? 'selected' : ''}>Cuentan como asistencia</option>
         <option value="excluded" ${s.excused_counts === 'excluded' ? 'selected' : ''}>No se toman en cuenta en el porcentaje</option>
       </select></label>`,
    async (f) => {
      await request('/api/attendance/settings', {
        course: current.course.id,
        min_percent: Number(f.get('min_percent')),
        lates_per_absence: Number(f.get('lates_per_absence')),
        excused_counts: f.get('excused_counts'),
      });
      return refreshAttendance('Reglas guardadas.');
    },
    'Guardar reglas',
  );
}

function deleteSessionModal(id) {
  const session = attendanceData.sessions.find((s) => s.id === id);
  const count = attendanceData.records.filter((r) => r.session === id).length;
  modal(
    'Eliminar sesión',
    `<p>Se eliminará la sesión del ${esc(sessionLabel(session, 'long'))}${count ? ` y sus ${count} registros de asistencia` : ''}. Esta acción no se puede deshacer.</p>`,
    async () => {
      await request('/api/attendance/session', { course: current.course.id, id }, 'DELETE');
      attendanceSessionId = null;
      return refreshAttendance('Sesión eliminada.');
    },
    'Eliminar sesión',
  );
  $('#formSave').classList.add('danger-button');
}

function exportAttendance() {
  const { sessions, settings } = attendanceData;
  const cell = (value) => {
    let text = String(value ?? '');
    if (/^[=+@\-]/.test(text)) text = "'" + text; // evita que Excel lo interprete como fórmula
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const header = ['Matrícula', 'Alumno', ...sessions.map((s) => s.date + (s.start_time ? ' ' + s.start_time : '')), 'Asistencias', 'Retardos', 'Faltas', 'Justificadas', 'Porcentaje'];
  const rows = attendanceStudents().map((m) => {
    const statuses = sessions.map((s) => attendanceRecord(s.id, m.id)?.status);
    const summary = attendanceSummary(statuses.filter(Boolean), settings);
    return [
      m.matricula,
      m.name,
      ...statuses.map((st) => (st ? ATT_STATUS[st].short : '')),
      summary.present,
      summary.late,
      summary.absent,
      summary.excused,
      summary.percent === null ? '' : summary.percent.toFixed(1),
    ];
  });
  download(`asistencia-${current.course.name}.csv`, '\uFEFF' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}

async function openTodaySession() {
  const today = attendanceData.sessions.find((s) => s.date === localToday());
  if (today) {
    attendanceSessionId = today.id;
    return renderAttendance();
  }
  try {
    const { id } = await request('/api/attendance/session', { course: current.course.id, date: localToday() });
    attendanceSessionId = id;
    attendanceData = null;
    renderAttendance();
  } catch (error) {
    toast(error.message);
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-att]');
  if (!button || !attendanceData) return;
  const action = button.dataset.att;
  if (action === 'today') openTodaySession();
  if (action === 'qr') startCheckin();
  if (action === 'new') newSessionModal();
  if (action === 'generate') generateSessionsModal();
  if (action === 'settings') attendanceSettingsModal();
  if (action === 'export') exportAttendance();
  if (action === 'delete') deleteSessionModal(button.dataset.id);
  if (action === 'open') {
    attendanceSessionId = button.dataset.id;
    renderAttendance();
  }
  if (action === 'back') {
    attendanceSessionId = null;
    renderAttendance();
  }
  if (action === 'mark') {
    markAttendance(attendanceSessionId, [button.dataset.member], button.dataset.status);
    redrawRollCall(`[data-member="${button.dataset.member}"][data-status="${button.dataset.status}"]`);
  }
  if (action === 'all-present') {
    const missing = attendanceStudents().filter((m) => !attendanceRecord(attendanceSessionId, m.id)).map((m) => m.id);
    markAttendance(attendanceSessionId, missing, 'present');
    redrawRollCall();
  }
});

document.addEventListener('change', (event) => {
  const input = event.target.closest('[data-att-note]');
  if (!input || !attendanceData || !attendanceSessionId) return;
  const record = attendanceRecord(attendanceSessionId, input.dataset.member);
  markAttendance(attendanceSessionId, [input.dataset.member], record?.status || 'present', input.value.trim());
});
