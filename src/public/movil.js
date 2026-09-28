/* Experiencia en el teléfono: barra inferior con las secciones del curso, menú «Más» como hoja inferior
 * y tablas que se leen como tarjetas en pantallas angostas (cada celda lleva el nombre de su columna).
 * En computadora la barra y la hoja no se muestran (movil.css) y todo sigue igual.
 */

const NAV_ICON_PATHS = {
  hub: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  content: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7h6',
  tasks: 'M9 3h6v3H9zM7 4.5H5V21h14V4.5h-2M8.5 13l2.5 2.5 4.5-4.5',
  grades: 'M5 20V11M12 20V5M19 20v-6M3 20h18',
  quizzes: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  forums: 'M4 5h16v10H10l-5 4v-4H4zM8 9h8M8 12h5',
  attendance: 'M4 5h16v16H4zM4 9h16M8 3v4M16 3v4M9 15l2 2 4-4',
  notices: 'M4 10v4l3 1 1 5h3l-1-4 8 3V5L7 9zM18 9.5a3 3 0 0 1 0 5',
  groups: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5a6 6 0 0 1 3.5 5.5',
  members: 'M4 4h16v16H4zM12 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM7.5 17a4.5 4.5 0 0 1 9 0',
  progress: 'M3 17l6-6 4 4 7-7M14 8h6v6',
  admin: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  preview: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  courses: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
};
const NAV_NAMES = {
  hub: 'Inicio',
  content: 'Contenido',
  tasks: 'Actividades',
  grades: 'Calificaciones',
  quizzes: 'Evaluaciones',
  forums: 'Foros',
  attendance: 'Asistencia',
  notices: 'Noticias',
  groups: 'Grupos',
  members: 'Alumnos',
  progress: 'Progreso',
  admin: 'Administración del curso',
};
// En la barra inferior solo caben nombres cortos.
const NAV_SHORT = { grades: 'Notas', admin: 'Administración' };

const navIcon = (name) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${NAV_ICON_PATHS[name] || NAV_ICON_PATHS.more}"/></svg>`;

/** Las cuatro secciones de la barra: el alumno consulta sus notas; el docente pasa lista desde el teléfono. */
const bottomNavSections = () => (teaches() ? ['hub', 'content', 'tasks', 'attendance'] : ['hub', 'content', 'tasks', 'grades']);
const moreSections = () =>
  (teaches() ? ['grades', 'quizzes', 'forums', 'notices', 'groups', 'members', 'progress', 'admin'] : ['quizzes', 'forums', 'attendance', 'notices', 'groups', 'members']).filter(
    (s) => !bottomNavSections().includes(s),
  );

/** Sección activa (las pantallas de detalle pertenecen a su lista). */
function activeSection() {
  if (['task', 'editor', 'review'].includes(section)) return 'tasks';
  if (section === 'forum') return 'forums';
  if (section === 'quiz' || section === 'bank') return 'quizzes';
  if (section === 'trash') return 'admin';
  return section;
}

/** Alumno: actividades visibles sin entregar que siguen abiertas. Docente: entregas por calificar. */
function tasksBadge() {
  const subs = records('submission');
  if (teaches()) return subs.filter((s) => !s.data.manual && s.data.submitted && (s.data.grade === null || s.data.grade === undefined)).length;
  const mine = myMember()?.id;
  const now = Date.now();
  return records('task').filter((t) => {
    if (t.data.end && Date.parse(t.data.end) < now) return false;
    return !subs.some((s) => s.data.task === t.id && !s.data.manual && (s.data.member === mine || s.author === viewerKey()));
  }).length;
}

function renderBottomNav() {
  const bar = $('#bottomnav');
  if (!bar) return;
  const inCourse = Boolean(current?.course);
  bar.hidden = !inCourse;
  document.body.classList.toggle('has-bottomnav', inCourse);
  if (!inCourse) return (bar.innerHTML = '');
  const active = activeSection();
  const badge = tasksBadge();
  const moreActive = moreSections().includes(active);
  bar.innerHTML =
    bottomNavSections()
      .map(
        (s) => `<button type="button" data-section="${s}" class="${active === s ? 'active' : ''}" ${active === s ? 'aria-current="page"' : ''}>${navIcon(s)}<span>${NAV_SHORT[s] || NAV_NAMES[s]}</span>${
          s === 'tasks' && badge ? `<b class="nav-badge" aria-label="${badge} ${teaches() ? 'por calificar' : 'por entregar'}">${badge > 9 ? '9+' : badge}</b>` : ''
        }</button>`,
      )
      .join('') +
    `<button type="button" data-more-sheet class="${moreActive ? 'active' : ''}" aria-haspopup="dialog">${navIcon('more')}<span>Más</span></button>`;
}

// ---- Menú «Más» ------------------------------------------------------------------------------

function openMoreSheet() {
  const sheet = $('#sheet');
  if (!sheet || !current) return;
  const active = activeSection();
  const quizzes = records('quiz').length;
  const hints = {
    quizzes: quizzes ? `${quizzes} ${quizzes === 1 ? 'evaluación' : 'evaluaciones'}` : '',
    forums: records('forum').length ? `${records('forum').length} ${records('forum').length === 1 ? 'foro' : 'foros'}` : '',
    notices: records('notice').length ? `${records('notice').length} publicadas` : '',
  };
  $('#sheetTitle').textContent = current.course.name;
  $('#sheetBody').innerHTML = `<div class="sheet-grid">${moreSections()
    .map(
      (s) => `<button type="button" class="sheet-item ${active === s ? 'active' : ''}" data-sheet-section="${s}">${navIcon(s)}<span>${NAV_NAMES[s]}</span>${hints[s] ? `<small>${esc(hints[s])}</small>` : ''}</button>`,
    )
    .join('')}</div>
    <div class="sheet-links">
      ${current.canPreview ? `<button type="button" class="sheet-link" data-sheet-action="toggle-preview">${navIcon('preview')}<span>${current.preview ? 'Volver a vista de docente' : 'Ver como alumno'}</span></button>` : ''}
      <button type="button" class="sheet-link" data-sheet-refresh>${navIcon('refresh')}<span>Actualizar el curso</span></button>
      <button type="button" class="sheet-link" data-sheet-action="home">${navIcon('courses')}<span>Todos mis cursos</span></button>
    </div>`;
  if (!sheet.open) sheet.showModal();
}

/** Ir a una sección (desde la hoja): pregunta si hay cambios sin guardar. */
function goToSection(target) {
  if (dirty && !confirm('Hay cambios sin guardar. ¿Quieres salir de esta pantalla?')) return;
  dirty = false;
  section = target;
  detail = null;
  if (typeof attendanceSessionId !== 'undefined') attendanceSessionId = null;
  render();
  globalThis.scrollTo?.(0, 0);
}

document.addEventListener('click', (event) => {
  if (event.target.closest?.('[data-more-sheet]')) return openMoreSheet();
  const sheet = $('#sheet');
  if (!sheet?.open || !event.target.closest) return;
  // Tocar fuera de la hoja (el fondo oscuro) la cierra.
  if (event.target === sheet) return sheet.close();
  const go = event.target.closest('[data-sheet-section]');
  const action = event.target.closest('[data-sheet-action]');
  if (event.target.closest('[data-sheet-close]')) sheet.close();
  // En la aplicación instalada no hay botón de recargar: aquí se vuelve a pedir el curso al servidor.
  if (event.target.closest('[data-sheet-refresh]'))
    closeDialogThen(sheet, () =>
      reload()
        .then(() => toast('Curso actualizado.'))
        .catch((error) => toast(error.message)),
    );
  if (go) closeDialogThen(sheet, () => goToSection(go.dataset.sheetSection));
  if (action) {
    // Las acciones las atiende app.js con un botón temporal, cuando la hoja ya se cerró.
    closeDialogThen(sheet, () => {
      const proxy = document.createElement('button');
      proxy.dataset.action = action.dataset.sheetAction;
      proxy.hidden = true;
      document.body.append(proxy);
      proxy.click();
      proxy.remove();
    });
  }
});

// ---- Tablas como tarjetas ------------------------------------------------------------------------

/**
 * Pone a cada celda el nombre de su columna (data-label). En el teléfono, movil.css muestra cada fila como una
 * tarjeta con «Columna: valor». Las matrices (libro de calificaciones, lista de asistencia, editor de rúbricas)
 * se quedan como tabla con desplazamiento horizontal.
 */
function labelTables(root = document) {
  for (const table of root?.querySelectorAll?.('table') || []) {
    if (table.closest('.gradebook, .rubric-editor, .keep-table')) continue;
    const headRow = table.tHead?.rows[table.tHead.rows.length - 1];
    if (!headRow) continue;
    const heads = [];
    for (const th of headRow.cells) for (let i = 0; i < (th.colSpan || 1); i++) heads.push(th.textContent.trim());
    table.classList.add('stack-table');
    for (const body of table.tBodies) {
      for (const row of body.rows) {
        let column = 0;
        for (const cell of row.cells) {
          if ((cell.colSpan || 1) === 1 && heads[column] && !cell.hasAttribute('data-label')) cell.dataset.label = heads[column];
          if ((cell.colSpan || 1) > 1) cell.classList.add('stack-full');
          column += cell.colSpan || 1;
        }
      }
    }
  }
}

if (typeof MutationObserver === 'function' && document.getElementById?.('main')) {
  let queued = false;
  const relabel = () => {
    queued = false;
    labelTables(document.getElementById('main'));
    labelTables(document.getElementById('fields'));
  };
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(relabel);
  });
  observer.observe(document.getElementById('main'), { childList: true, subtree: true });
  if (document.getElementById('fields')) observer.observe(document.getElementById('fields'), { childList: true, subtree: true });
}

// ---- Teclado en pantalla -----------------------------------------------------------------------------
// Mientras se escribe, la barra inferior se oculta: si no, en Android queda encima del teclado y tapa el campo.
if (globalThis.matchMedia?.('(pointer: coarse)').matches) {
  const typing = (el) => el?.matches?.('textarea, select, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file])');
  let blurTimer = null;
  document.addEventListener('focusin', (event) => {
    if (!typing(event.target)) return;
    clearTimeout(blurTimer);
    document.body.classList.add('keyboard-open');
  });
  document.addEventListener('focusout', () => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      if (!typing(document.activeElement)) document.body.classList.remove('keyboard-open');
    }, 150);
  });
}
