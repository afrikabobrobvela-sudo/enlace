/* Cálculo de calificaciones: pesos por actividad (como antes) o categorías con pesos,
   y la calificación final con las reglas del curso. */

const DEFAULT_GRADING = {
  scheme: 'tasks',
  categories: [],
  final: { decimals: 1, rounding: 'half_up', passing: 6, failingAs: null, missingAsZero: false },
};
let categoryDraft = null; // edición en curso de las categorías { course, categories, tasks }
let categoryEditing = false; // se pidió cambiar a categorías aunque el curso aún use pesos por actividad
let attendanceForGradesLoading = false;

function gradingSettings() {
  return records('grading')[0]?.data || DEFAULT_GRADING;
}

/**
 * Calificación de un alumno. Con final = true y la regla activa, las actividades vencidas sin calificar valen 0;
 * si no, se excluye lo no calificado y se normalizan los pesos restantes (como siempre en Enlace).
 */
function computeGrade({ tasks, grades, settings, weights, attendancePercent = null, now = Date.now(), final = false, dueOf = (task) => task.data.due, quizzes = [], quizGrades = new Map() }) {
  // Evaluaciones que cuentan (12.14): solo con categorías; entran a su categoría con sus puntos y la calificación
  // del intento que marque su regla. Sin intento no cuentan (no tienen fecha de entrega que las haga vencer).
  const zeroMissing = final && settings.final.missingAsZero;
  const gradeFor = (task) => {
    const grade = grades.get(task.id);
    if (grade !== null && grade !== undefined) return grade;
    const due = dueOf(task);
    const overdue = task.data.visible !== false && due && Date.parse(due) < now;
    return zeroMissing && overdue ? 0 : null;
  };
  let sum = 0;
  let total = 0;
  if (settings.scheme === 'categories' && settings.categories.length) {
    const categories = settings.categories.map((category) => {
      let value = null;
      if (category.source === 'attendance') value = attendancePercent === null ? null : attendancePercent / 10;
      else {
        let points = 0;
        let earned = 0;
        for (const task of tasks.filter((t) => t.data.category === category.id)) {
          const grade = gradeFor(task);
          if (grade === null) continue;
          earned += grade * task.data.points;
          points += task.data.points;
        }
        for (const quiz of quizzes.filter((q) => q.data.grade?.category === category.id)) {
          const grade = quizGrades.get(quiz.id);
          if (grade === null || grade === undefined) continue;
          earned += grade * quiz.data.grade.points;
          points += quiz.data.grade.points;
        }
        value = points ? earned / points : null;
      }
      if (value !== null) {
        sum += value * category.weight;
        total += category.weight;
      }
      return { id: category.id, name: category.name, weight: category.weight, value };
    });
    return { value: total ? sum / total : null, categories };
  }
  const valid = weights && tasks.every((t) => Number.isFinite(weights[t.id]));
  for (const task of tasks) {
    const grade = gradeFor(task);
    if (grade === null) continue;
    const weight = valid ? weights[task.id] : 1;
    sum += grade * weight;
    total += weight;
  }
  return { value: total ? sum / total : null, categories: [] };
}

function roundGrade(value, decimals, rounding) {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  // El 1e-9 corrige la coma flotante: 1.005 × 100 da 100.4999…, que sin él quedaría en 1.00 en vez de 1.01.
  return (rounding === 'down' ? Math.floor(scaled + 1e-9) : Math.floor(scaled + 0.5 + 1e-9)) / factor;
}

function finalGrade(value, rules) {
  if (value === null) return null;
  const rounded = roundGrade(value, rules.decimals, rules.rounding);
  const passed = rounded >= rules.passing;
  return { value: !passed && rules.failingAs !== null ? rules.failingAs : rounded, passed };
}

function attendancePercentFor(memberId) {
  if (!attendanceData || attendanceData.course !== current.course.id || !attendanceData.sessions.length) return null;
  const statuses = attendanceData.sessions.map((s) => attendanceRecord(s.id, memberId)?.status).filter(Boolean);
  return attendanceSummary(statuses, attendanceData.settings).percent;
}

/** Si una categoría usa la asistencia y aún no está cargada, la pide y vuelve a dibujar la pantalla. */
function ensureAttendanceForGrades() {
  const needs = gradingSettings().categories.some((c) => c.source === 'attendance');
  if (!needs || (attendanceData && attendanceData.course === current.course.id) || attendanceForGradesLoading) return;
  attendanceForGradesLoading = true;
  const courseId = current.course.id;
  request('/api/attendance?course=' + encodeURIComponent(courseId) + viewSuffix())
    .then((data) => {
      attendanceData = { course: courseId, ...data };
      attendanceLoadedAt = Date.now();
      if (current?.course.id === courseId && ['grades', 'progress'].includes(section)) render();
    })
    .catch(() => {})
    .finally(() => (attendanceForGradesLoading = false));
}

const QUIZ_POLICIES = { best: 'el mejor intento', last: 'el último intento', average: 'el promedio de los intentos' };

/** Con quién se guardan los intentos de un alumno (los alumnos sin cuenta del curso de ejemplo usan demo:<id>). */
function attemptKeyOf(memberId) {
  const member = current.members.find((m) => m.id === memberId);
  if (!member) return null;
  return current.viewing?.id === memberId ? current.viewing.key : member.user_id || `demo:${member.id}`;
}

/** Calificación de una evaluación para un alumno según su regla (mejor, último o promedio); null sin intentos. */
function quizScore(quiz, memberId) {
  const key = attemptKeyOf(memberId);
  const attempts = records('attempt')
    .filter((a) => a.data.quiz === quiz.id && a.author === key)
    .sort((a, b) => (a.data.attempt || 1) - (b.data.attempt || 1));
  // Calificación oculta al alumno («pendiente de publicar»): no cuenta en su promedio hasta que se muestre.
  const scores = attempts.filter((a) => a.data.score !== null && a.data.score !== undefined).map((a) => Number(a.data.score));
  if (!scores.length) return null;
  const policy = quiz.data.grade?.policy || 'best';
  if (policy === 'last') return scores.at(-1);
  if (policy === 'average') return scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.max(...scores);
}

/** Evaluaciones que suman a la calificación (con categoría del curso). */
const countedQuizzes = () => {
  const settings = gradingSettings();
  if (settings.scheme !== 'categories') return [];
  return records('quiz').filter((q) => q.data.grade?.category && settings.categories.some((c) => c.id === q.data.grade.category));
};

function studentGrade(memberId, { final = false } = {}) {
  const tasks = records('task');
  const quizzes = countedQuizzes();
  return computeGrade({
    quizzes,
    quizGrades: new Map(quizzes.map((q) => [q.id, quizScore(q, memberId)])),
    tasks,
    grades: new Map(tasks.map((t) => [t.id, gradeOf(memberId, t.id)?.data.grade ?? null])),
    settings: gradingSettings(),
    weights: records('weights')[0]?.data.weights,
    attendancePercent: attendancePercentFor(memberId),
    final,
    dueOf: (task) => dueFor(task, memberId),
  });
}

const formatGrade = (value, decimals = 2) => (value === null || value === undefined ? '—' : Number(value).toFixed(decimals));

/**
 * Mis calificaciones (alumno): el promedio parcial arriba y después cada actividad con su calificación y los
 * comentarios del docente, y los resultados de las evaluaciones. Se lee bien en el teléfono (sin tabla ancha).
 */
function myGradesHtml() {
  const member = myMember();
  if (!member) {
    return `<h1>Mis calificaciones</h1><p class="real-status">${
      previewAsStudent ? 'En la vista de alumno no hay un alumno en particular: aquí cada alumno ve sus calificaciones y los comentarios que les dejes.' : 'No apareces como alumno en este curso.'
    }</p>`;
  }
  const grading = gradingSettings();
  const cats = grading.scheme === 'categories' ? grading.categories : [];
  const weights = records('weights')[0]?.data.weights;
  const tasks = records('task');
  const weighted = !cats.length && weights && tasks.every((t) => Number.isFinite(weights[t.id]));
  const result = studentGrade(member.id);
  const avg = result.value;
  const tone = (value) => (value === null ? '' : value >= grading.final.passing ? 'grade-pass' : 'grade-low');
  const now = Date.now();
  const taskItems = tasks
    .map((t) => {
      const s = gradeOf(member.id, t.id);
      const graded = s?.data.grade !== null && s?.data.grade !== undefined;
      const due = dueFor(t, member.id);
      const state = graded ? '' : s?.data.submitted ? 'Por calificar' : due && Date.parse(due) < now ? 'Sin entrega' : 'Pendiente';
      const detailText = [
        !graded && !s?.data.submitted && due && Date.parse(due) >= now ? 'vence ' + fmt(due) : '',
        cats.find((c) => c.id === t.data.category)?.name,
        weighted ? `peso ${weights[t.id]} %` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return `<li class="my-grade-item"><button type="button" class="my-grade-row" data-action="task" data-id="${esc(t.id)}"><span class="my-grade-title">${esc(t.data.title)}${
        detailText ? `<small>${esc(detailText)}</small>` : ''
      }</span><span class="my-grade-value ${graded ? tone(Number(s.data.grade)) : 'is-pending'}">${graded ? esc(s.data.grade) : esc(state)}</span></button>${
        s?.data.feedback ? `<p class="grade-feedback">${esc(s.data.feedback)}</p>` : ''
      }</li>`;
    })
    .join('');
  const counts = countedQuizzes();
  const quizItems = records('quiz')
    .map((q) => {
      const attempts = records('attempt').filter((a) => a.data.quiz === q.id && a.author === attemptKeyOf(member.id));
      const counted = counts.includes(q);
      const shown = attempts.map((a) => a.data.score).filter((x) => x !== null && x !== undefined);
      const best = counted ? quizScore(q, member.id) : shown.length ? Math.max(...shown) : null;
      const note = [
        attempts.length ? `${attempts.length} ${attempts.length === 1 ? 'intento' : 'intentos'}` : '',
        counted ? `cuenta en ${cats.find((c) => c.id === q.data.grade.category)?.name || 'la calificación'} · ${QUIZ_POLICIES[q.data.grade.policy] || QUIZ_POLICIES.best}` : 'no cuenta en el promedio',
      ]
        .filter(Boolean)
        .join(' · ');
      return `<li class="my-grade-item"><button type="button" class="my-grade-row" data-action="quiz" data-id="${esc(q.id)}"><span class="my-grade-title">${esc(q.data.title)}<small>${esc(note)}</small></span><span class="my-grade-value ${best === null ? 'is-pending' : tone(best)}">${best === null ? (attempts.length ? 'Pendiente' : 'Sin contestar') : best.toFixed(2)}</span></button></li>`;
    })
    .join('');
  const scheme = cats.length ? 'por categorías' : weighted ? 'ponderado' : 'simple';
  return `<h1>Mis calificaciones</h1>
    <section class="my-grade-summary">
      <p class="my-grade-big ${tone(avg)}">${formatGrade(avg)}</p>
      <div><h2>Promedio parcial</h2><p class="muted">Promedio ${scheme}, de 0 a 10, de lo ya calificado.</p></div>
    </section>
    ${
      cats.length
        ? `<section class="panel"><h2>Por categoría</h2><ul class="my-grade-list">${result.categories
            .map((c) => `<li class="my-grade-item"><div class="my-grade-row is-static"><span class="my-grade-title">${esc(c.name)}<small>${c.weight} % del promedio</small></span><span class="my-grade-value ${c.value === null ? 'is-pending' : tone(c.value)}">${c.value === null ? 'Sin calificar' : formatGrade(c.value)}</span></div></li>`)
            .join('')}</ul></section>`
        : ''
    }
    <section class="panel"><h2>Actividades</h2>${taskItems ? `<ul class="my-grade-list">${taskItems}</ul>` : '<p class="muted">Todavía no hay actividades publicadas.</p>'}</section>
    ${quizItems ? `<section class="panel"><h2>Evaluaciones</h2><p class="muted">Las que dicen «cuenta en…» ya están sumadas en tu promedio parcial.</p><ul class="my-grade-list">${quizItems}</ul></section>` : ''}`;
}

// ---- Administrar: esquema, categorías y reglas finales ----------------------------------------

function gradingManageHtml(weightsHtml = '') {
  const settings = gradingSettings();
  const tasks = records('task');
  if (categoryDraft && categoryDraft.course !== current.course.id) {
    categoryDraft = null;
    categoryEditing = false;
  }
  const categoriesMode = categoryEditing || settings.scheme === 'categories';
  const rules = settings.final;
  const schemeSection = categoriesMode
    ? categoriesFormHtml(tasks)
    : `<p class="real-status">Ahora: <strong>pesos por actividad</strong>. Si prefieres agrupar (por ejemplo, exámenes 60 %, tareas 30 %, asistencia 10 %), usa categorías.</p>
       <button type="button" class="secondary" data-grading="use-categories">Usar categorías con pesos</button>${weightsHtml}`;
  return `<h1>Cómo se calcula la calificación</h1>${schemeSection}
    <h2 class="grading-subtitle">Calificación final</h2>
    <form id="finalRules" class="real-form grading-rules">
      <label>Decimales<select name="decimals">${[[0, 'Entero (8)'], [1, 'Un decimal (8.5)'], [2, 'Dos decimales (8.47)']]
        .map(([v, l]) => `<option value="${v}" ${rules.decimals === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Redondeo<select name="rounding"><option value="half_up" ${rules.rounding === 'half_up' ? 'selected' : ''}>Desde .5 hacia arriba (5.5 → 6)</option>
        <option value="down" ${rules.rounding === 'down' ? 'selected' : ''}>Truncar (5.9 → 5)</option></select></label>
      ${field('Mínima aprobatoria', 'passing', rules.passing, 'number', 'min="0" max="10" step="0.1" required')}
      <label>Si no aprueba<select name="failingAs"><option value="">Asentar la calificación calculada</option>
        ${[5, 0].map((v) => `<option value="${v}" ${rules.failingAs === v ? 'selected' : ''}>Asentar ${v}</option>`).join('')}</select></label>
      <label class="check-row"><input type="checkbox" name="missingAsZero" ${rules.missingAsZero ? 'checked' : ''}> Las actividades vencidas sin calificar cuentan como 0 en la calificación final</label>
      <p class="muted">El promedio parcial nunca cuenta lo que falta por calificar; esta opción solo afecta la calificación final.</p>
      <p class="form-error error" hidden></p><div class="form-actions"><button class="primary">Guardar reglas</button></div>
    </form>
    <h2 class="grading-subtitle">Rúbricas</h2><div id="rubricBank"><p class="muted">Cargando rúbricas…</p></div>`;
}

function categoriesFormHtml(tasks) {
  const settings = gradingSettings();
  categoryDraft ??= {
    course: current.course.id,
    categories: settings.categories.length
      ? settings.categories.map((c) => ({ key: c.id, name: c.name, weight: c.weight, source: c.source }))
      : [{ key: 'n1', name: 'Exámenes', weight: 60, source: 'tasks' }, { key: 'n2', name: 'Tareas', weight: 40, source: 'tasks' }],
    tasks: Object.fromEntries(tasks.map((t) => [t.id, { category: t.data.category || '', points: t.data.points ?? 1 }])),
  };
  const draft = categoryDraft;
  const total = draft.categories.reduce((n, c) => n + (Number(c.weight) || 0), 0);
  const options = (selected) =>
    `<option value="">Sin categoría (no cuenta)</option>${draft.categories
      .filter((c) => c.source === 'tasks')
      .map((c) => `<option value="${esc(c.key)}" ${selected === c.key ? 'selected' : ''}>${esc(c.name || 'Sin nombre')}</option>`)
      .join('')}`;
  const loose = tasks.filter((t) => !draft.tasks[t.id]?.category).length;
  return `<form id="categoriesForm" class="real-form">
    <div class="table-wrap"><table class="grading-table"><thead><tr><th>Categoría</th><th>Peso (%)</th><th>Se calcula con</th><th><span class="sr-only">Quitar</span></th></tr></thead><tbody>
    ${draft.categories.map((c, i) => `<tr>
      <td><input data-cat="name" data-index="${i}" value="${esc(c.name)}" aria-label="Nombre de la categoría" maxlength="80" required></td>
      <td><input data-cat="weight" data-index="${i}" type="number" min="0" max="100" step="0.01" value="${esc(c.weight)}" aria-label="Peso de ${esc(c.name)}" class="grade-input" required></td>
      <td><select data-cat="source" data-index="${i}" aria-label="Qué se promedia"><option value="tasks">Actividades</option><option value="attendance" ${c.source === 'attendance' ? 'selected' : ''}>Porcentaje de asistencia</option></select></td>
      <td><button type="button" class="danger-link" data-grading="remove-category" data-index="${i}">Quitar</button></td></tr>`).join('')}
    </tbody></table></div>
    <div class="grading-row"><button type="button" class="secondary" data-grading="add-category">＋ Agregar categoría</button>
      <p class="${Math.abs(total - 100) <= 0.01 ? 'grading-ok' : 'error'}" id="categoryTotal">Suman ${Math.round(total * 100) / 100} %${Math.abs(total - 100) <= 0.01 ? '.' : ': deben sumar 100 %.'}</p></div>
    <h3>Actividades</h3>
    <p class="muted">Dentro de cada categoría, el valor indica cuánto pesa cada actividad (con valor 2 cuenta el doble que con 1).${loose ? ` ${loose === 1 ? 'Una actividad sin categoría no cuenta' : `${loose} actividades sin categoría no cuentan`} en la calificación.` : ''}</p>
    <div class="table-wrap"><table class="grading-table"><thead><tr><th>Actividad</th><th>Categoría</th><th>Valor</th></tr></thead><tbody>
    ${tasks.map((t) => `<tr><td>${esc(t.data.title)}</td>
      <td><select data-task-category="${t.id}" aria-label="Categoría de ${esc(t.data.title)}">${options(draft.tasks[t.id]?.category || '')}</select></td>
      <td><input data-task-points="${t.id}" type="number" min="0.01" max="1000" step="0.01" value="${esc(draft.tasks[t.id]?.points ?? 1)}" class="grade-input" aria-label="Valor de ${esc(t.data.title)}"></td></tr>`).join('') || '<tr><td colspan="3">Todavía no hay actividades.</td></tr>'}
    </tbody></table></div>
    <p class="form-error error" hidden></p>
    <div class="form-actions"><button class="primary">Guardar categorías</button>
      ${settings.scheme === 'categories' ? '<button type="button" class="secondary" data-grading="use-tasks">Volver a pesos por actividad</button>' : '<button type="button" class="secondary" data-grading="cancel">Cancelar</button>'}</div>
  </form>`;
}

function syncCategoryDraft() {
  const form = document.getElementById('categoriesForm');
  if (!form || !categoryDraft) return;
  form.querySelectorAll('[data-cat]').forEach((input) => {
    const category = categoryDraft.categories[Number(input.dataset.index)];
    if (category) category[input.dataset.cat] = input.dataset.cat === 'weight' ? Number(input.value) : input.value;
  });
  form.querySelectorAll('[data-task-category]').forEach((select) => (categoryDraft.tasks[select.dataset.taskCategory].category = select.value));
  form.querySelectorAll('[data-task-points]').forEach((input) => (categoryDraft.tasks[input.dataset.taskPoints].points = Number(input.value)));
}

function bindGradingManage() {
  const categoriesForm = document.getElementById('categoriesForm');
  if (categoriesForm) {
    categoriesForm.addEventListener('input', () => {
      syncCategoryDraft();
      const total = categoryDraft.categories.reduce((n, c) => n + (Number(c.weight) || 0), 0);
      const box = document.getElementById('categoryTotal');
      const ok = Math.abs(total - 100) <= 0.01;
      box.className = ok ? 'grading-ok' : 'error';
      box.textContent = `Suman ${Math.round(total * 100) / 100} %${ok ? '.' : ': deben sumar 100 %.'}`;
    });
    bindForm('#categoriesForm', async () => {
      syncCategoryDraft();
      const grading = records('grading')[0];
      await request('/api/grades/scheme', {
        course: current.course.id,
        revision: grading?.revision ?? 0,
        scheme: 'categories',
        categories: categoryDraft.categories.map(({ key, name, weight, source }) => ({ key, name, weight, source })),
        assignments: Object.entries(categoryDraft.tasks).map(([task, value]) => ({ task, category: value.category || null, points: value.points })),
      });
      categoryDraft = null;
      categoryEditing = false;
      return 'Categorías guardadas.';
    });
  }
  bindForm('#finalRules', async (f) => {
    await request('/api/grades/final-rules', {
      course: current.course.id,
      revision: records('grading')[0]?.revision ?? 0,
      decimals: Number(f.get('decimals')),
      rounding: f.get('rounding'),
      passing: Number(f.get('passing')),
      failingAs: f.get('failingAs') === '' ? null : Number(f.get('failingAs')),
      missingAsZero: f.get('missingAsZero') === 'on',
    });
    return 'Reglas de la calificación final guardadas.';
  });
  renderRubricBank(document.getElementById('rubricBank'));
}

document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-grading]')?.dataset.grading;
  if (!action || !current) return;
  if (action === 'use-categories') categoryEditing = true;
  if (action === 'cancel') {
    categoryEditing = false;
    categoryDraft = null;
  }
  if (action === 'add-category') {
    syncCategoryDraft();
    categoryDraft.categories.push({ key: 'n' + Date.now(), name: '', weight: 0, source: 'tasks' });
  }
  if (action === 'remove-category') {
    syncCategoryDraft();
    const [removed] = categoryDraft.categories.splice(Number(event.target.dataset.index), 1);
    for (const value of Object.values(categoryDraft.tasks)) if (value.category === removed?.key) value.category = '';
  }
  if (action === 'use-tasks') {
    try {
      await request('/api/grades/scheme', {
        course: current.course.id,
        revision: records('grading')[0]?.revision ?? 0,
        scheme: 'tasks',
        categories: gradingSettings().categories.map((c) => ({ key: c.id, name: c.name, weight: c.weight, source: c.source })),
      });
      categoryEditing = false;
      categoryDraft = null;
      await reload();
      return toast('Ahora se calcula con pesos por actividad. Tus categorías se conservan por si vuelves a ellas.');
    } catch (error) {
      return toast(error.message);
    }
  }
  render();
});
