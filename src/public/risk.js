/* Participación y alumnos en riesgo (12.73; antes «Progreso»): junta en una sola pantalla el último ingreso al curso,
 * la asistencia, las actividades vencidas sin entregar, el contenido completado y el promedio parcial. Los contadores
 * de arriba filtran la lista y desde aquí se escribe a los alumnos elegidos (mensajes directos, 12.70). */

const RISK_PASSING = 6;
const INACTIVE_DAYS = 7;
const DAY_MS = 86_400_000;
let progressFilter = 'riesgo'; // 'riesgo' | 'ingreso' | 'entregas' | 'asistencia' | 'promedio' | 'todos'
let lastRiskReport = [];
const progressChosen = new Set(); // alumnos elegidos para escribirles

/**
 * Criterios: sin entrar al curso en 7 días (si se da `lastSeen`), asistencia bajo el mínimo, 2 o más actividades
 * vencidas sin entregar y promedio menor a 6. Riesgo alto: dos o más a la vez.
 * `lastSeen`: Map alumno → último ingreso (ISO) o null (nunca entró); `since`: desde cuándo se cuenta (creación del curso).
 */
function riskReport({ students, tasks, submissions, averages, attendance, now = Date.now(), dueOf = (task) => task.data.due, lastSeen = null, since = null }) {
  const applies = (task, member) =>
    typeof itemApplies === 'function' ? itemApplies(task, member) : !task.data.sections?.length || task.data.sections.includes(member.section);
  return students
    .map((member) => {
      // Vencidas para este alumno (con su prórroga y la fecha de su sección), solo las que van dirigidas a él.
      const overdue = tasks.filter((t) => t.data.visible !== false && !t.data.forum && applies(t, member) && dueOf(t, member.id) && Date.parse(dueOf(t, member.id)) < now);
      const mine = submissions.filter((s) => s.data.member === member.id);
      const done = (task) => mine.some((s) => s.data.task === task.id && (s.data.submitted || (s.data.grade !== null && s.data.grade !== undefined)));
      const missing = overdue.filter((task) => !done(task));
      const summary = attendance?.get(member.id) || null;
      const average = averages.get(member.id) ?? null;
      const seen = lastSeen ? (lastSeen.get(member.id) ?? null) : undefined;
      // Sin ingresos se cuenta desde que se creó el curso (un curso nuevo no marca a nadie el primer día).
      const reference = seen || since;
      const idleDays = lastSeen && reference ? Math.floor((now - Date.parse(reference)) / DAY_MS) : null;
      const flags = [];
      if (idleDays !== null && idleDays >= INACTIVE_DAYS) flags.push('ingreso');
      if (summary?.low) flags.push('asistencia');
      if (missing.length >= 2) flags.push('entregas');
      if (average !== null && average < RISK_PASSING) flags.push('promedio');
      return {
        member,
        attendance: summary,
        missing,
        average,
        lastSeen: seen,
        idleDays,
        delivered: mine.filter((s) => s.data.submitted).length,
        flags,
        level: flags.length >= 2 ? 'alto' : flags.length === 1 ? 'medio' : '',
      };
    })
    .sort((a, b) => b.flags.length - a.flags.length || a.member.name.localeCompare(b.member.name, 'es'));
}

const RISK_LABELS = {
  ingreso: `Sin entrar en ${INACTIVE_DAYS} días`,
  asistencia: 'Asistencia baja',
  entregas: '2 o más vencidas sin entregar',
  promedio: `Promedio menor a ${RISK_PASSING}`,
};

/** Texto inicial del mensaje según el filtro (el docente lo cambia antes de enviar). */
const RISK_MESSAGES = {
  ingreso: (course) => `Hola. Hace varios días que no entras a ${course} en Enlace. Revisa las actividades y los materiales nuevos y, si tienes algún problema para seguir el curso, escríbeme por aquí.`,
  entregas: (course) => `Hola. Tienes actividades vencidas sin entregar en ${course}. Revísalas en «Actividades» y, si necesitas apoyo o más tiempo, escríbeme por aquí.`,
  asistencia: (course) => `Hola. Tu asistencia en ${course} está por debajo del mínimo. Si hay algo que te impida asistir, escríbeme por aquí para buscar una solución.`,
  promedio: (course) => `Hola. Tu promedio parcial en ${course} va por debajo de ${RISK_PASSING}. Todavía estás a tiempo: revisa tus calificaciones y escríbeme si quieres que lo platiquemos.`,
};

function lastSeenText(r) {
  if (!accessData) return '—';
  if (!r.member.user_id && r.lastSeen === null) return '<span class="risk-idle">Todavía sin cuenta</span>';
  if (!r.lastSeen) return '<span class="risk-idle">Nunca ha entrado</span>';
  const days = Math.floor((Date.now() - Date.parse(r.lastSeen)) / DAY_MS);
  const text = days <= 0 ? 'Hoy' : days === 1 ? 'Ayer' : `Hace ${days} días`;
  return `<span class="${days >= INACTIVE_DAYS ? 'risk-idle' : ''}" title="${esc(fmt(r.lastSeen))}">${text}</span>`;
}

async function loadProgressData(courseId) {
  const fresh = (loadedAt) => loadedAt && Date.now() - loadedAt < 120_000;
  const tasks = [];
  if (!attendanceData || attendanceData.course !== courseId)
    tasks.push(
      request('/api/attendance?course=' + encodeURIComponent(courseId))
        .then((data) => {
          attendanceData = { course: courseId, ...data };
          attendanceLoadedAt = Date.now();
        })
        .catch(() => {
          attendanceData = null; // sin asistencia, el panel usa los otros criterios
        }),
    );
  // accessData (app.js) es la misma caché de la pantalla de Accesos: { course, at, since, until, people }.
  if (!accessData || accessData.course !== courseId || !fresh(accessData.at))
    tasks.push(
      request('/api/course/access?id=' + encodeURIComponent(courseId))
        .then((data) => {
          accessData = { course: courseId, at: Date.now(), ...data };
        })
        .catch(() => {
          accessData = null; // sin ingresos, el panel usa los otros criterios
        }),
    );
  await Promise.all(tasks);
}

async function renderProgress() {
  const courseId = current.course.id;
  if (!attendanceData || attendanceData.course !== courseId || !accessData || accessData.course !== courseId) {
    $('#main').innerHTML = '<p class="empty">Cargando participación…</p>';
    await loadProgressData(courseId);
    if (section !== 'progress' || current?.course.id !== courseId) return;
  }
  const students = studentsInView();
  const tasks = records('task');
  const settings = attendanceData?.settings;
  const attendance = attendanceData?.sessions.length
    ? new Map(
        students.map((m) => [
          m.id,
          attendanceSummary(attendanceData.sessions.filter((s) => sessionApplies(s, m)).map((s) => attendanceRecord(s.id, m.id)?.status).filter(Boolean), settings),
        ]),
      )
    : null;
  const lastSeen = accessData ? new Map(accessData.people.filter((p) => p.member).map((p) => [p.member, p.lastVisit || null])) : null;
  lastRiskReport = riskReport({
    dueOf: (task, memberId) => dueFor(task, memberId),
    students,
    tasks,
    submissions: records('submission'),
    averages: new Map(students.map((m) => [m.id, average(m.id)])),
    attendance,
    lastSeen,
    since: current.course.created,
  });
  const atRisk = lastRiskReport.filter((r) => r.level);
  const count = (flag) => lastRiskReport.filter((r) => r.flags.includes(flag)).length;
  const shown = progressFilter === 'todos' ? lastRiskReport : progressFilter === 'riesgo' ? atRisk : lastRiskReport.filter((r) => r.flags.includes(progressFilter));
  // Los elegidos que ya no se ven (otro filtro u otra sección) dejan de estarlo.
  const visibleIds = new Set(shown.map((r) => r.member.id));
  for (const id of [...progressChosen]) if (!visibleIds.has(id)) progressChosen.delete(id);
  // Contenido completado (seguimiento por unidad): materiales dentro de unidades.
  const contentTotal = records('material').filter((x) => x.data.module).length;
  const contentDone = (memberId) => records('material').filter((x) => x.data.module && progressOf(memberId, x.id)?.completed_at).length;
  const tile = (key, number, label, note = '') =>
    `<button type="button" class="risk-tile ${progressFilter === key ? 'is-on' : ''} ${number && key !== 'todos' ? 'has-alert' : ''}" data-risk-filter="${key}" aria-pressed="${progressFilter === key}">
      <strong>${number}</strong><span>${label}</span>${note ? `<small>${note}</small>` : ''}</button>`;
  const rows = shown
    .map(
      (r) => `<tr data-search-row>
      <td class="risk-pick"><input type="checkbox" data-risk-pick="${esc(r.member.id)}" ${progressChosen.has(r.member.id) ? 'checked' : ''} aria-label="Elegir a ${esc(r.member.name)}"></td>
      <td class="risk-name">${esc(r.member.name)}<div class="muted">${esc(r.member.matricula || '')}</div></td>
      <td>${r.level ? `<span class="risk-pill ${r.level}">${r.level === 'alto' ? 'Alto' : 'Medio'}</span><div class="risk-why">${r.flags.map((f) => esc(RISK_LABELS[f])).join(' · ')}</div>` : '<span class="muted">Sin alertas</span>'}</td>
      <td>${lastSeenText(r)}</td>
      <td>${r.attendance && r.attendance.percent !== null ? percentPill(r.attendance, settings.min_percent) : '—'}</td>
      <td class="risk-missing">${r.missing.length ? `<strong>${r.missing.length}</strong><div class="risk-list">${r.missing.map((t) => esc(t.data.title)).join(' · ')}</div>` : '0'}</td>
      <td><span class="risk-bar"><progress value="${r.delivered}" max="${Math.max(tasks.length, 1)}"></progress><span>${r.delivered} de ${tasks.length}</span></span></td>
      <td>${contentTotal ? `<span class="risk-bar"><progress value="${contentDone(r.member.id)}" max="${contentTotal}"></progress><span>${contentDone(r.member.id)} de ${contentTotal}</span></span>` : '—'}</td>
      <td class="${r.average === null ? '' : r.average >= RISK_PASSING ? 'grade-pass' : 'grade-low'}">${r.average === null ? '—' : r.average.toFixed(2)}</td>
      <td><button type="button" class="text-btn" data-message-thread="${esc(r.member.id)}" aria-label="Escribir a ${esc(r.member.name)}">Escribir</button></td>
    </tr>`,
    )
    .join('');
  const empty =
    !students.length ? 'No hay alumnos inscritos.' : progressFilter === 'riesgo' ? 'Nadie está en riesgo. Elige «Todo el grupo» para ver a todos.' : 'Ningún alumno cumple este criterio.';
  $('#main').innerHTML = `<div class="page-heading"><div><h1>Participación y alumnos en riesgo</h1>
      <p class="muted">${atRisk.length ? `${atRisk.length} de ${students.length} ${atRisk.length === 1 ? 'alumno requiere' : 'alumnos requieren'} atención.` : 'Ningún alumno cumple hoy los criterios de riesgo.'}</p></div>
      <div class="action-row"><button type="button" class="secondary" data-risk="export">Exportar a Excel</button></div></div>
    <div class="risk-tiles" role="group" aria-label="Filtrar alumnos">
      ${tile('riesgo', atRisk.length, 'Requieren atención', 'uno o más criterios')}
      ${accessData ? tile('ingreso', count('ingreso'), RISK_LABELS.ingreso) : ''}
      ${tile('entregas', count('entregas'), RISK_LABELS.entregas)}
      ${attendance ? tile('asistencia', count('asistencia'), RISK_LABELS.asistencia, settings ? `mínimo ${settings.min_percent} %` : '') : ''}
      ${tile('promedio', count('promedio'), RISK_LABELS.promedio)}
      ${tile('todos', students.length, 'Todo el grupo')}
    </div>
    <div class="toolbar"><input data-search type="search" placeholder="Buscar alumno…" aria-label="Buscar alumno">${sectionFilterHtml()}</div>
    <div class="risk-actions" ${shown.length ? '' : 'hidden'}>
      <label class="check-label"><input type="checkbox" data-risk-all ${shown.length && shown.every((r) => progressChosen.has(r.member.id)) ? 'checked' : ''}> Elegir a todos los de la lista</label>
      <button type="button" class="primary" data-risk-write ${progressChosen.size ? '' : 'disabled'}>Escribir a ${progressChosen.size ? `${progressChosen.size} ${progressChosen.size === 1 ? 'alumno' : 'alumnos'}` : 'los elegidos'}</button>
    </div>
    <div class="table-wrap"><table class="risk-table"><thead><tr><th><span class="sr-only">Elegir</span></th><th>Alumno</th><th>Riesgo</th><th>Último ingreso</th><th>Asistencia</th><th>Vencidas sin entregar</th><th>Entregas</th><th>Contenido completado</th><th>Promedio parcial</th><th><span class="sr-only">Mensaje</span></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="10" class="empty">${empty}</td></tr>`}</tbody></table></div>
    <p class="muted risk-criteria">Riesgo alto: dos o más criterios a la vez. «Último ingreso» es la última vez que el alumno abrió este curso (no cuenta la vista como alumno del docente). Un alumno «todavía sin cuenta» no ha entrado nunca a Enlace con el correo con el que lo inscribiste.</p>`;
}

function exportRisk() {
  const header = ['Matrícula', 'Alumno', 'Riesgo', 'Motivos', 'Último ingreso', 'Asistencia (%)', 'Vencidas sin entregar', 'Actividades faltantes', 'Entregas', 'Materiales completados', 'Promedio parcial'];
  const contentDone = (memberId) => records('material').filter((x) => x.data.module && progressOf(memberId, x.id)?.completed_at).length;
  const rows = lastRiskReport.map((r) => [
    r.member.matricula,
    r.member.name,
    r.level === 'alto' ? 'Alto' : r.level === 'medio' ? 'Medio' : '',
    r.flags.map((f) => RISK_LABELS[f]).join('; '),
    r.lastSeen ? new Date(r.lastSeen).toLocaleString('es-MX') : accessData ? 'Nunca' : '',
    r.attendance?.percent == null ? '' : r.attendance.percent.toFixed(1),
    r.missing.length,
    r.missing.map((t) => t.data.title).join('; '),
    r.delivered,
    contentDone(r.member.id),
    r.average === null ? '' : r.average.toFixed(2),
  ]);
  download(`participacion-${current.course.name}.csv`, '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}

function writeToChosen() {
  const ids = [...progressChosen];
  if (!ids.length || typeof newMessageModal !== 'function') return;
  const template = RISK_MESSAGES[progressFilter];
  newMessageModal(ids, template ? template(current.course.name) : '');
}

document.addEventListener('click', (event) => {
  if (!current) return;
  if (event.target.closest('[data-risk="export"]')) return exportRisk();
  const filter = event.target.closest('[data-risk-filter]');
  if (filter) {
    progressFilter = filter.dataset.riskFilter;
    progressChosen.clear();
    return renderProgress();
  }
  if (event.target.closest('[data-risk-write]')) writeToChosen();
});
document.addEventListener('change', (event) => {
  const pick = event.target.closest?.('[data-risk-pick]');
  const all = event.target.closest?.('[data-risk-all]');
  if (!pick && !all) return;
  if (pick) {
    if (pick.checked) progressChosen.add(pick.dataset.riskPick);
    else progressChosen.delete(pick.dataset.riskPick);
  } else {
    // Solo los que se ven (también con la búsqueda).
    for (const box of document.querySelectorAll('[data-risk-pick]')) {
      if (box.closest('tr')?.hidden) continue;
      box.checked = all.checked;
      if (all.checked) progressChosen.add(box.dataset.riskPick);
      else progressChosen.delete(box.dataset.riskPick);
    }
  }
  const button = document.querySelector('[data-risk-write]');
  if (button) {
    button.disabled = !progressChosen.size;
    button.textContent = `Escribir a ${progressChosen.size ? `${progressChosen.size} ${progressChosen.size === 1 ? 'alumno' : 'alumnos'}` : 'los elegidos'}`;
  }
});
