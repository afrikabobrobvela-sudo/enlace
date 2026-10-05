/* Importar pase de lista y calificaciones de actividades (12.24) desde Excel (.xlsx), CSV o texto pegado de Excel.
 * Se reconoce a cada alumno por matrícula, correo o nombre (en cualquier orden: «Aguado Beltrán, Fabián» es
 * «Fabián Aguado Beltrán»). Antes de guardar se muestra qué se entendió. Lee los archivos con oficina.js. */

const importNormal = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@._ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const nameKey = (s) => importNormal(s).replace(/[@._]/g, ' ').split(' ').filter(Boolean).sort().join(' ');
const idKey = (s) => String(s ?? '').replace(/^#/, '').replace(/[^0-9a-z]/gi, '').toLowerCase();

const STUDENT_HEADERS = {
  id: ['matricula', 'matrícula', 'orgdefinedid', 'id', 'id alumno', 'numero de cuenta', 'cuenta', 'username', 'usuario', 'nombre de usuario'],
  email: ['correo', 'correo electronico', 'correo electrónico', 'email', 'e-mail', 'mail'],
  name: ['alumno', 'estudiante', 'nombre completo', 'nombre del alumno', 'name', 'student'],
  last: ['apellidos', 'apellido', 'last name', 'apellido paterno'],
  first: ['nombre', 'nombres', 'nombre(s)', 'first name'],
};

/** Lee las filas de un archivo (xlsx, csv o txt). */
async function tableRows(file) {
  if (file.size > OFFICE_MAX_BYTES) throw new Error('El archivo pesa más de 15 MB.');
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) return readXlsxRows(await file.arrayBuffer());
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type.startsWith('text/')) return parseDelimited(await file.text());
  if (name.endsWith('.xls')) throw new Error('Guarda el archivo como .xlsx (Excel moderno) o .csv y vuelve a intentarlo.');
  throw new Error('Elige un archivo .xlsx o .csv.');
}

/** Encabezados y columnas de alumno: la primera fila (de las 5 primeras) que tenga una columna de alumno. */
function studentColumns(rows) {
  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    const head = rows[r].map((h) => importNormal(h).replace(/\s*<.*$/, ''));
    const find = (names) => head.findIndex((h) => names.map(importNormal).includes(h));
    const cols = { id: find(STUDENT_HEADERS.id), email: find(STUDENT_HEADERS.email), name: find(STUDENT_HEADERS.name), last: find(STUDENT_HEADERS.last), first: find(STUDENT_HEADERS.first) };
    if (cols.id >= 0 || cols.email >= 0 || cols.name >= 0 || cols.last >= 0 || cols.first >= 0) return { headerRow: r, header: rows[r], cols };
  }
  throw new Error('No se encontró la columna de los alumnos. La primera fila debe tener encabezados como «Matrícula», «Alumno» o «Correo».');
}

/** Busca al alumno de una fila entre los del curso (matrícula, correo o nombre). */
function studentFinder(students) {
  const byId = new Map(students.filter((m) => m.matricula).map((m) => [idKey(m.matricula), m]));
  const byEmail = new Map(students.filter((m) => m.email).map((m) => [String(m.email).toLowerCase(), m]));
  const byName = new Map(students.map((m) => [nameKey(m.name), m]));
  return (row, cols) => {
    const cell = (i) => (i >= 0 ? String(row[i] ?? '').trim() : '');
    const id = idKey(cell(cols.id));
    if (id && byId.has(id)) return byId.get(id);
    const email = cell(cols.email).toLowerCase() || (cell(cols.id).includes('@') ? cell(cols.id).toLowerCase() : '');
    if (email && byEmail.has(email)) return byEmail.get(email);
    // El usuario de Brightspace suele ser el correo sin dominio.
    if (id && !email) for (const [mail, m] of byEmail) if (idKey(mail.split('@')[0]) === id) return m;
    const name = cols.name >= 0 ? cell(cols.name) : `${cell(cols.first)} ${cell(cols.last)}`;
    return name.trim() ? byName.get(nameKey(name)) || null : null;
  };
}
const rowLabel = (row, cols) => [cols.name >= 0 ? row[cols.name] : `${row[cols.first] ?? ''} ${row[cols.last] ?? ''}`, cols.id >= 0 ? row[cols.id] : '', cols.email >= 0 ? row[cols.email] : ''].map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ') || '(fila sin nombre)';

// ---- Pase de lista ------------------------------------------------------------------------------------------

/** Fecha (y hora) de un encabezado: 2026-09-01, 01/09/2026, 1/9/26, «2026-09-01 07:00» o una fecha de Excel. */
function headerDate(value) {
  const text = String(value ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(text);
  let y;
  let mo;
  let d;
  let time = '';
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    time = m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : '';
  } else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(text))) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
    time = m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : '';
  } else if (/^\d{5}(\.\d+)?$/.test(text) && Number(text) > 30000 && Number(text) < 70000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(text)) * 86_400_000);
    [y, mo, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  } else return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const check = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== iso) return null;
  return { date: iso, time };
}

/** Estado a partir de lo escrito en la casilla. */
function attendanceValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw || /^(-|—|n\/a|na)$/i.test(raw)) return null;
  const v = importNormal(raw);
  if (['p', 'presente', 'asistio', 'asistencia', 'si', '1', 'x', 'present', 'ok'].includes(v) || value === '✓' || value === '✔') return 'present';
  if (['r', 'retardo', 't', 'tarde', 'late', 'rt'].includes(v)) return 'late';
  if (['f', 'falta', 'ausente', 'a', '0', 'no', 'absent', 'inasistencia'].includes(v)) return 'absent';
  if (['j', 'justificada', 'justificado', 'falta justificada', 'e', 'excused', 'fj'].includes(v)) return 'excused';
  return undefined;
}

/** Interpreta un pase de lista: alumnos en filas y una columna por clase. */
function parseAttendanceImport(rows, students) {
  const { headerRow, header, cols } = studentColumns(rows);
  const dateCols = header.map((h, i) => ({ i, ...headerDate(h) })).filter((x) => x.date);
  if (!dateCols.length) throw new Error('No se encontraron columnas con fechas (por ejemplo 2026-09-01 o 01/09/2026).');
  const find = studentFinder(students);
  const entries = [];
  const unmatched = [];
  const unknown = new Set();
  const counts = { present: 0, late: 0, absent: 0, excused: 0 };
  for (const row of rows.slice(headerRow + 1)) {
    if (!row.some((c) => String(c ?? '').trim())) continue;
    const member = find(row, cols);
    if (!member) {
      unmatched.push(rowLabel(row, cols));
      continue;
    }
    for (const c of dateCols) {
      const status = attendanceValue(row[c.i]);
      if (status === undefined) unknown.add(String(row[c.i]).trim());
      if (!status) continue;
      counts[status]++;
      entries.push({ date: c.date, time: c.time, member: member.id, status });
    }
  }
  return { entries, dates: dateCols.length, matched: new Set(entries.map((e) => e.member)).size, unmatched, unknown: [...unknown].slice(0, 10), counts };
}

let attendanceImport = null;

function importAttendanceModal() {
  attendanceImport = null;
  const sections = courseSections();
  modal(
    'Importar pase de lista',
    `<p>Elige un archivo de Excel (.xlsx) o CSV con <b>un alumno por fila</b> (matrícula, correo o nombre) y <b>una columna por clase</b> con la fecha en el encabezado (2026-09-01 o 01/09/2026). En cada casilla: P, R, F o J (también «Presente», «Retardo», «Falta», «Justificada», 1 o 0). Sirve el archivo que exporta «Exportar a Excel».</p>
     ${sections.length ? `<label>Clases de la sección<select name="section"><option value="">Todo el curso</option>${sections.map((x) => `<option value="${esc(x.id)}" ${selectedSection() === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
     <label class="secondary file-button">Elegir archivo<input type="file" accept=".xlsx,.csv,.txt" data-import-attendance hidden></label>
     <label class="check-label"><input type="checkbox" name="overwrite" checked> Reemplazar lo que ya estaba registrado en esas fechas</label>
     <div data-import-preview><p class="muted">Todavía no eliges un archivo.</p></div>`,
    async (f) => {
      if (!attendanceImport?.entries.length) throw new Error('Elige un archivo con registros para importar.');
      const section = f.get('section') || '';
      const members = new Set(current.members.filter((m) => m.role === 'student' && (!section || m.section === section)).map((m) => m.id));
      const entries = attendanceImport.entries.filter((e) => members.has(e.member));
      if (!entries.length) throw new Error('Ninguno de los alumnos del archivo es de esa sección.');
      const r = await request('/api/attendance/import', { course: current.course.id, section, overwrite: f.get('overwrite') === 'on', entries });
      attendanceLoadedAt = 0;
      return `Listo: ${r.marks} registros importados${r.sessions ? ` y ${r.sessions} ${r.sessions === 1 ? 'clase nueva' : 'clases nuevas'}` : ''}.`;
    },
    'Importar',
  );
}

function attendancePreviewHtml(x) {
  return `<div class="real-status"><p><b>${x.dates}</b> ${x.dates === 1 ? 'clase' : 'clases'} · <b>${x.matched}</b> ${x.matched === 1 ? 'alumno reconocido' : 'alumnos reconocidos'} · <b>${x.entries.length}</b> registros: ${x.counts.present} presentes, ${x.counts.late} retardos, ${x.counts.absent} faltas y ${x.counts.excused} justificadas.</p>
    ${x.unmatched.length ? `<p class="warning-note">No se encontraron en el curso (se omiten): ${x.unmatched.slice(0, 8).map(esc).join('; ')}${x.unmatched.length > 8 ? ` y ${x.unmatched.length - 8} más` : ''}.</p>` : ''}
    ${x.unknown.length ? `<p class="warning-note">Valores que no se entendieron (se omiten): ${x.unknown.map((v) => `«${esc(v)}»`).join(', ')}.</p>` : ''}</div>`;
}

// ---- Calificaciones de actividades ------------------------------------------------------------------------------

const SUMMARY_HEADER = /promedio|calificaci[oó]n final|final calculada|total|porcentaje|asistencia|secci[oó]n|end-of-line|indicador|ajustad|^grupo$|^equipo$/i;

/** Título y puntos máximos de un encabezado (entiende el formato de Brightspace: «Tarea 1 Puntos Calificación <Numérico Máx. Puntos:10>»). */
function gradeHeader(value) {
  const raw = String(value ?? '').trim();
  const max = Number((/(?:puntos|points)\s*:\s*([\d.,]+)/i.exec(raw) || /\(\s*(?:de|sobre|\/)\s*([\d.,]+)\s*\)/i.exec(raw) || [])[1]?.replace(',', '.'));
  const title = raw
    .replace(/<[^>]*>/g, '')
    .replace(/\s+(puntos|points)\s+(calificaci[oó]n|grade)\s*$/i, '')
    .replace(/\s+(calificaci[oó]n|grade|puntos|points)\s*$/i, '')
    .replace(/\(\s*(?:de|sobre|\/)\s*[\d.,]+\s*\)/i, '')
    .trim();
  return { title, max: Number.isFinite(max) && max > 0 ? max : null };
}

/** Número de una casilla: «7», «7.5», «7 / 10, 70 %», «70 %». Devuelve { value, max? } o null. */
function gradeCell(value) {
  const text = String(value ?? '').trim().replace(/,(\d)/g, '.$1');
  if (!text || /^(-|—|n\/a|na|sin calificar)$/i.test(text)) return null;
  let m = /^(-?[\d.]+)\s*\/\s*([\d.]+)/.exec(text);
  if (m) return { value: Number(m[1]), max: Number(m[2]) };
  m = /^(-?[\d.]+)\s*%$/.exec(text);
  if (m) return { value: Number(m[1]) / 10, max: 10 };
  return /^-?[\d.]+$/.test(text) ? { value: Number(text) } : undefined;
}

/** Interpreta un libro de calificaciones: alumnos en filas y una columna por actividad. */
function parseGradesImport(rows, students, tasks) {
  const { headerRow, header, cols } = studentColumns(rows);
  const studentCols = new Set(Object.values(cols).filter((i) => i >= 0));
  const find = studentFinder(students);
  const body = rows.slice(headerRow + 1).filter((r) => r.some((c) => String(c ?? '').trim()));
  const matches = body.map((r) => find(r, cols));
  const byTitle = new Map(tasks.map((t) => [importNormal(t.data.title), t]));
  const columns = [];
  header.forEach((h, i) => {
    if (studentCols.has(i) || !String(h ?? '').trim() || SUMMARY_HEADER.test(h) || /\(\s*[\d.]+\s*%\s*\)\s*$/.test(h) || headerDate(h)) return;
    const { title, max } = gradeHeader(h);
    if (!title) return;
    const cells = body.map((r, k) => ({ member: matches[k], cell: gradeCell(r[i]) })).filter((x) => x.member && x.cell);
    if (!cells.length) return;
    const top = Math.max(...cells.map((x) => x.cell.value));
    const task = byTitle.get(importNormal(title));
    columns.push({ index: i, title, task: task?.id || '', max: max ?? (top > 10 ? (top <= 20 ? 20 : 100) : 10), cells, include: true });
  });
  if (!columns.length) throw new Error('No se encontraron columnas con calificaciones. Revisa que la primera fila tenga el nombre de cada actividad.');
  return { columns, matched: matches.filter(Boolean).length, unmatched: body.filter((_, k) => !matches[k]).map((r) => rowLabel(r, cols)) };
}

let gradesImport = null;

function importGradesModal() {
  gradesImport = null;
  modal(
    'Importar calificaciones',
    `<p>Elige un archivo de Excel (.xlsx) o CSV con <b>un alumno por fila</b> (matrícula, correo o nombre) y <b>una columna por actividad</b>. Sirve el que exporta Brightspace («Exportar calificaciones») o el de Enlace. Las columnas de promedios y calificación final se ignoran.</p>
     <label class="secondary file-button">Elegir archivo<input type="file" accept=".xlsx,.csv,.txt" data-import-grades hidden></label>
     <div data-import-preview><p class="muted">Todavía no eliges un archivo.</p></div>
     <label class="check-label"><input type="checkbox" name="publish" checked> Publicar las calificaciones (los alumnos las ven)</label>
     <label class="check-label"><input type="checkbox" name="overwrite" checked> Reemplazar las calificaciones que ya estaban capturadas</label>`,
    async (f) => {
      if (!gradesImport) throw new Error('Elige un archivo con calificaciones.');
      const activities = [...document.querySelectorAll('#modal [data-grade-col]')]
        .filter((row) => row.querySelector('[data-col-include]').checked)
        .map((row) => {
          const col = gradesImport.columns[Number(row.dataset.gradeCol)];
          const max = Number(row.querySelector('[data-col-max]').value);
          if (!Number.isFinite(max) || max <= 0) throw new Error(`Escribe los puntos máximos de «${col.title}».`);
          const task = row.querySelector('[data-col-task]').value;
          const title = row.querySelector('[data-col-title]').value.trim();
          if (!task && !title) throw new Error('Escribe el nombre de cada actividad nueva.');
          return {
            ...(task ? { task } : { title }),
            grades: col.cells.map((x) => ({ member: x.member.id, grade: Math.min(10, Math.max(0, Math.round(((x.cell.value / (x.cell.max || max)) * 10) * 100) / 100)) })),
          };
        });
      if (!activities.length) throw new Error('Marca al menos una actividad para importar.');
      const r = await request('/api/grades/import', { course: current.course.id, publish: f.get('publish') === 'on', overwrite: f.get('overwrite') === 'on', activities });
      return `Listo: ${r.grades} calificaciones importadas${r.created ? ` y ${r.created} ${r.created === 1 ? 'actividad nueva' : 'actividades nuevas'}` : ''}.`;
    },
    'Importar',
  );
}

function gradesPreviewHtml(x) {
  const tasks = records('task').filter((t) => !t.data.forum);
  return `<p class="real-status"><b>${x.matched}</b> ${x.matched === 1 ? 'alumno reconocido' : 'alumnos reconocidos'} y <b>${x.columns.length}</b> ${x.columns.length === 1 ? 'columna' : 'columnas'} con calificaciones. Revisa a qué actividad va cada una y sobre cuántos puntos está (se convierte a la escala de 0 a 10).</p>
    ${x.unmatched.length ? `<p class="warning-note">No se encontraron en el curso (se omiten): ${x.unmatched.slice(0, 8).map(esc).join('; ')}${x.unmatched.length > 8 ? ` y ${x.unmatched.length - 8} más` : ''}.</p>` : ''}
    <div class="grade-import-list">${x.columns
      .map(
        (c, i) => `<div class="grade-import-row" data-grade-col="${i}"><label class="check-label"><input type="checkbox" data-col-include checked> <b>${esc(c.title)}</b> <span class="muted">· ${c.cells.length} calificaciones</span></label>
        <div class="grade-import-fields"><label>Va a<select data-col-task><option value="">Actividad nueva</option>${tasks.map((t) => `<option value="${esc(t.id)}" ${t.id === c.task ? 'selected' : ''}>${esc(t.data.title)}</option>`).join('')}</select></label>
        <label>Nombre (si es nueva)<input data-col-title value="${esc(c.title)}" maxlength="200"></label>
        <label>Sobre<input data-col-max type="number" min="0.1" step="0.1" value="${c.max}"> puntos</label></div></div>`,
      )
      .join('')}</div>`;
}

document.addEventListener('change', async (e) => {
  const attendanceFile = e.target.matches('[data-import-attendance]');
  const gradesFile = e.target.matches('[data-import-grades]');
  if (!attendanceFile && !gradesFile) return;
  const file = e.target.files?.[0];
  e.target.value = '';
  const box = document.querySelector('#modal [data-import-preview]');
  if (!file || !box) return;
  box.innerHTML = '<p class="muted">Leyendo el archivo…</p>';
  try {
    const rows = await tableRows(file);
    const students = current.members.filter((m) => m.role === 'student');
    if (attendanceFile) {
      attendanceImport = parseAttendanceImport(rows, students);
      box.innerHTML = attendancePreviewHtml(attendanceImport);
    } else {
      gradesImport = parseGradesImport(rows, students, records('task').filter((t) => !t.data.forum));
      box.innerHTML = gradesPreviewHtml(gradesImport);
    }
  } catch (error) {
    attendanceImport = gradesImport = null;
    box.innerHTML = `<p class="form-error error">${esc(error.message || 'No se pudo leer el archivo.')}</p>`;
  }
});
