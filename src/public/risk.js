/* Progreso y alumnos en riesgo: junta asistencia, actividades vencidas sin entregar y promedio parcial. */

const RISK_PASSING = 6;
let progressOnlyRisk = true;
let lastRiskReport = [];

/** Criterios: asistencia bajo el mínimo, 2 o más actividades vencidas sin entregar, promedio menor a 6. */
function riskReport({ students, tasks, submissions, averages, attendance, now = Date.now(), dueOf = (task) => task.data.due }) {
  return students
    .map((member) => {
      // Vencidas para este alumno (con su prórroga, si la tiene).
      const overdue = tasks.filter((t) => t.data.visible !== false && dueOf(t, member.id) && Date.parse(dueOf(t, member.id)) < now);
      const mine = submissions.filter((s) => s.data.member === member.id);
      const done = (task) => mine.some((s) => s.data.task === task.id && (s.data.submitted || (s.data.grade !== null && s.data.grade !== undefined)));
      const missing = overdue.filter((task) => !done(task));
      const summary = attendance?.get(member.id) || null;
      const average = averages.get(member.id) ?? null;
      const flags = [];
      if (summary?.low) flags.push('asistencia');
      if (missing.length >= 2) flags.push('entregas');
      if (average !== null && average < RISK_PASSING) flags.push('promedio');
      return {
        member,
        attendance: summary,
        missing,
        average,
        delivered: mine.filter((s) => s.data.submitted).length,
        flags,
        level: flags.length >= 2 ? 'alto' : flags.length === 1 ? 'medio' : '',
      };
    })
    .sort((a, b) => b.flags.length - a.flags.length || a.member.name.localeCompare(b.member.name, 'es'));
}

async function renderProgress() {
  const courseId = current.course.id;
  if (!attendanceData || attendanceData.course !== courseId) {
    $('#main').innerHTML = '<p class="empty">Cargando progreso…</p>';
    try {
      attendanceData = { course: courseId, ...(await request('/api/attendance?course=' + encodeURIComponent(courseId))) };
      attendanceLoadedAt = Date.now();
    } catch {
      attendanceData = null; // sin asistencia, el panel usa los otros dos criterios
    }
    if (section !== 'progress' || current?.course.id !== courseId) return;
  }
  const students = current.members.filter((m) => m.role === 'student');
  const tasks = records('task');
  const settings = attendanceData?.settings;
  const attendance = attendanceData?.sessions.length
    ? new Map(
        students.map((m) => [
          m.id,
          attendanceSummary(attendanceData.sessions.map((s) => attendanceRecord(s.id, m.id)?.status).filter(Boolean), settings),
        ]),
      )
    : null;
  lastRiskReport = riskReport({
    dueOf: (task, memberId) => dueFor(task, memberId),
    students,
    tasks,
    submissions: records('submission'),
    averages: new Map(students.map((m) => [m.id, average(m.id)])),
    attendance,
  });
  const atRisk = lastRiskReport.filter((r) => r.level);
  // Contenido completado (seguimiento por unidad): materiales dentro de unidades.
  const contentTotal = records('material').filter((x) => x.data.module).length;
  const contentDone = (memberId) => records('material').filter((x) => x.data.module && progressOf(memberId, x.id)?.completed_at).length;
  const shown = progressOnlyRisk ? atRisk : lastRiskReport;
  const rows = shown
    .map((r) => `<tr data-search-row>
      <td>${esc(r.member.name)}<div class="muted">${esc(r.member.matricula || '')}</div></td>
      <td>${r.level ? `<span class="risk-pill ${r.level}">${r.level === 'alto' ? 'Alto' : 'Medio'}</span>` : '<span class="muted">Sin alertas</span>'}</td>
      <td>${r.attendance && r.attendance.percent !== null ? percentPill(r.attendance, settings.min_percent) : '—'}</td>
      <td>${r.missing.length ? `<strong>${r.missing.length}</strong><div class="muted">${r.missing.map((t) => esc(t.data.title)).join(', ')}</div>` : '0'}</td>
      <td><progress value="${r.delivered}" max="${Math.max(tasks.length, 1)}"></progress> ${r.delivered} de ${tasks.length}</td>
      <td>${contentTotal ? `<progress value="${contentDone(r.member.id)}" max="${contentTotal}"></progress> ${contentDone(r.member.id)} de ${contentTotal}` : '—'}</td>
      <td class="${r.average === null ? '' : r.average >= RISK_PASSING ? 'grade-pass' : 'grade-low'}">${r.average === null ? '—' : r.average.toFixed(2)}</td>
    </tr>`)
    .join('');
  $('#main').innerHTML = `<div class="page-heading"><div><h1>Progreso y alumnos en riesgo</h1>
      <p class="muted">${atRisk.length ? `${atRisk.length} de ${students.length} ${atRisk.length === 1 ? 'alumno requiere' : 'alumnos requieren'} atención.` : 'Ningún alumno cumple hoy los criterios de riesgo.'}</p></div>
      <div class="action-row"><button type="button" class="secondary" data-risk="export">Exportar a Excel</button></div></div>
    <p class="real-status">Criterios: asistencia debajo del mínimo del curso${settings ? ` (${settings.min_percent} %)` : ''}, dos o más actividades vencidas sin entregar, o promedio parcial menor a ${RISK_PASSING}. Riesgo alto: dos o más criterios a la vez.</p>
    <div class="toolbar"><input data-search type="search" placeholder="Buscar alumno…" aria-label="Buscar alumno">
      <label class="review-filter"><input type="checkbox" data-risk="only" ${progressOnlyRisk ? 'checked' : ''}> Solo alumnos en riesgo</label></div>
    <div class="table-wrap"><table><thead><tr><th>Alumno</th><th>Riesgo</th><th>Asistencia</th><th>Vencidas sin entregar</th><th>Entregas</th><th>Contenido completado</th><th>Promedio parcial</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="7" class="empty">${progressOnlyRisk && students.length ? 'Nadie está en riesgo. Desmarca el filtro para ver a todo el grupo.' : 'No hay alumnos inscritos.'}</td></tr>`}</tbody></table></div>`;
}

function exportRisk() {
  const header = ['Matrícula', 'Alumno', 'Riesgo', 'Asistencia (%)', 'Vencidas sin entregar', 'Actividades faltantes', 'Entregas', 'Materiales completados', 'Promedio parcial'];
  const contentDone = (memberId) => records('material').filter((x) => x.data.module && progressOf(memberId, x.id)?.completed_at).length;
  const rows = lastRiskReport.map((r) => [
    r.member.matricula,
    r.member.name,
    r.level === 'alto' ? 'Alto' : r.level === 'medio' ? 'Medio' : '',
    r.attendance?.percent == null ? '' : r.attendance.percent.toFixed(1),
    r.missing.length,
    r.missing.map((t) => t.data.title).join('; '),
    r.delivered,
    contentDone(r.member.id),
    r.average === null ? '' : r.average.toFixed(2),
  ]);
  download(`riesgo-${current.course.name}.csv`, '\uFEFF' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-risk="export"]') && current) exportRisk();
});
document.addEventListener('change', (event) => {
  if (!event.target.matches('[data-risk="only"]')) return;
  progressOnlyRisk = event.target.checked;
  renderProgress();
});
