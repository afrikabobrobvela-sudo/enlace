/* Cálculo de calificaciones: pesos por actividad (como antes) o categorías con pesos,
   y la calificación final con las reglas del curso. */

const DEFAULT_GRADING = {
  scheme: 'tasks',
  categories: [],
  final: { decimals: 0, rounding: 'down', passing: 6, failingAs: null, missingAsZero: false },
};
let categoryDraft = null; // edición en curso de las categorías { course, categories, tasks }
let categoryEditing = false; // se pidió cambiar a categorías aunque el curso aún use pesos por actividad
let attendanceForGradesLoading = false;

function gradingSettings() {
  return records('grading')[0]?.data || DEFAULT_GRADING;
}

/** Actividades en el orden de las columnas del libro (12.30); las que no tienen lugar guardado van al final, por fecha. */
function orderedTasks(tasks = records('task')) {
  const order = gradingSettings().columnOrder || [];
  if (!order.length) return tasks;
  const position = new Map(order.map((id, i) => [id, i]));
  return tasks
    .map((t, i) => [t, position.has(t.id) ? position.get(t.id) : order.length + i])
    .sort((a, b) => a[1] - b[1])
    .map(([t]) => t);
}

/**
 * Calificación de un alumno. Con final = true y la regla activa, las actividades vencidas sin calificar valen 0;
 * si no, se excluye lo no calificado y se normalizan los pesos restantes (como siempre en Enlace).
 */
function computeGrade({ tasks, grades, settings, weights, attendancePercent = null, now = Date.now(), final = false, dueOf = (task) => task.data.due, quizzes = [], quizGrades = new Map(), categoryGrades = new Map() }) {
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
      let automaticValue = null;
      if (category.source === 'attendance') automaticValue = attendancePercent === null ? null : attendancePercent / 10;
      else {
        let items = [];
        for (const task of tasks.filter((t) => t.data.category === category.id)) {
          const grade = gradeFor(task);
          if (grade !== null) items.push({ grade: Number(grade), points: task.data.points });
        }
        for (const quiz of quizzes.filter((q) => q.data.grade?.category === category.id)) {
          const grade = quizGrades.get(quiz.id);
          if (grade !== null && grade !== undefined) items.push({ grade: Number(grade), points: quiz.data.grade.points });
        }
        items = dropExtremes(items, category.dropLow || 0, category.dropHigh || 0);
        const weightOf = (item) => (category.distribution === 'equal' ? 1 : item.points);
        const points = items.reduce((n, item) => n + weightOf(item), 0);
        automaticValue = points ? items.reduce((n, item) => n + item.grade * weightOf(item), 0) / points : null;
      }
      // Una captura directa del docente sustituye todo el cálculo automático de este rubro para el alumno.
      const value = categoryGrades.has(category.id) ? Number(categoryGrades.get(category.id)) : automaticValue;
      return { id: category.id, name: category.name, weight: category.weight, source: category.source, term: category.term || '', value, automaticValue };
    });
    // Dentro de un parcial, un rubro vacío conserva su peso y aporta 0: no se redistribuye su porcentaje.
    // En el nivel superior, el promedio parcial excluye los parciales completamente vacíos; la calificación
    // final sí conserva sus pesos (por ejemplo, dos parciales de 50 % equivalen a su promedio).
    const weighted = (list, countMissing = false) => {
      let sum = 0;
      let total = 0;
      for (const item of list) {
        if (item.value !== null) sum += item.value * item.weight;
        if (countMissing || item.value !== null) total += item.weight;
      }
      return list.some((item) => item.value !== null) && total ? sum / total : null;
    };
    // Un parcial está «completo» cuando todos sus rubros tienen calificación (la asistencia sin clases no lo detiene).
    // En el promedio parcial (no en la final) solo cuentan los parciales completos: uno en curso, por ejemplo sin su
    // examen, no se promedia como si sus rubros vacíos valieran 0 (12.44). `partial` es lo que lleva de lo calificado.
    const termList = (settings.terms || []).map((term) => {
      const own = categories.filter((c) => c.term === term.id);
      const complete = own.length > 0 && own.every((c) => c.value !== null || c.source === 'attendance');
      const full = weighted(own, true);
      return { id: term.id, name: term.name, weight: term.weight, value: final || complete ? full : null, partial: full, complete };
    });
    const known = new Set(termList.map((t) => t.id));
    const general = categories.filter((c) => !c.term || !known.has(c.term));
    // Si aún no hay ningún parcial completo, el promedio parcial usa lo que llevan (para no quedar vacío al empezar).
    const anyComplete = termList.some((t) => t.complete);
    const topTerms = final || anyComplete ? termList : termList.map((t) => ({ ...t, value: t.partial }));
    return { value: weighted([...topTerms, ...general], final || !termList.length), categories, terms: termList };
  }
  const valid = weights && tasks.every((t) => Number.isFinite(weights[t.id]));
  for (const task of tasks) {
    const grade = gradeFor(task);
    if (grade === null) continue;
    const weight = valid ? weights[task.id] : 1;
    sum += grade * weight;
    total += weight;
  }
  return { value: total ? sum / total : null, categories: [], terms: [] };
}

/** Quita las N calificaciones más bajas y las N más altas (sin dejar la categoría vacía). */
function dropExtremes(items, low, high) {
  if (!low && !high) return items;
  const sorted = [...items].sort((a, b) => a.grade - b.grade);
  if (sorted.length - low - high < 1) return sorted.length ? sorted.slice(Math.min(low, sorted.length - 1)).slice(0, 1) : sorted;
  return sorted.slice(low, sorted.length - high);
}

/** <option> de las categorías del curso (agrupadas por parcial) para los editores de actividades y evaluaciones. */
function gradebookCategoryOptions(selected, empty) {
  const settings = gradingSettings();
  const draft = {
    terms: (settings.terms || []).map((t) => ({ key: t.id, name: t.name })),
    categories: settings.categories.map((c) => ({ key: c.id, name: `${c.name} (${c.weight} %)`, source: c.source, term: c.term || '' })),
  };
  return draftCategoryOptions(draft, selected || '', empty);
}

/** Editor de la actividad: en qué categoría del libro cuenta y con qué valor (como «Está en el cuaderno de calificaciones»). */
function taskGradebookHtml(data) {
  const settings = gradingSettings();
  const usable = settings.scheme === 'categories' && settings.categories.some((c) => c.source === 'tasks');
  if (!usable) {
    return `<details open><summary>Libro de calificaciones</summary><div class="details-body"><p class="muted">Esta actividad cuenta con los pesos por actividad del curso. Para enlazarla a una categoría (Tareas, Laboratorio, Parcial 1…), organiza la calificación por categorías en Calificaciones → Administrar calificaciones.</p></div></details>`;
  }
  return `<details open><summary>Libro de calificaciones</summary><div class="details-body">
    <label>Cuenta en la categoría<select name="gradeCategory">${gradebookCategoryOptions(data.category, 'No cuenta en la calificación')}</select></label>
    <label>Valor dentro de la categoría<input name="gradePoints" type="number" min="0.01" max="1000" step="0.01" value="${esc(data.points ?? 1)}" class="grade-input"></label>
    <p class="muted">Con valor 2 cuenta el doble que una actividad con valor 1 de la misma categoría. También puedes acomodarlo todo en Calificaciones → Administrar calificaciones.</p></div></details>`;
}

/** Nombre de la categoría con su parcial («Parcial 1 · Tareas»). */
function categoryLabel(category, settings = gradingSettings()) {
  const term = category.term && (settings.terms || []).find((t) => t.id === category.term);
  return term ? `${term.name} · ${category.name}` : category.name;
}

/**
 * Redondeo institucional de la calificación final:
 * - si está por debajo de la mínima aprobatoria, siempre baja al entero;
 * - si ya es aprobatoria, sube cuando la parte decimal es mayor que .55 (6.56 → 7); de .00 a .55 baja (6.55 → 6).
 */
const ROUND_UP_AFTER = 0.55;

function roundFinalGrade(value, passing) {
  const whole = Math.floor(value);
  if (value < passing) return whole;
  const fraction = value - whole;
  // La tolerancia evita que 6.55 cuente como 6.5500000001 por la coma flotante (y suba sin deber).
  return fraction > ROUND_UP_AFTER + 1e-9 ? Math.min(10, whole + 1) : whole;
}

function finalGrade(value, rules) {
  if (value === null) return null;
  const rounded = roundFinalGrade(Number(value), rules.passing);
  const passed = rounded >= rules.passing;
  return { value: rounded, passed };
}

/**
 * Calificación final de la materia. Cuando todo está organizado en parciales, promedia las
 * calificaciones ya asentadas de esos parciales; uno vacío aporta 0. Si existen rubros de toda
 * la materia, conserva el cálculo general porque también deben participar en la ponderación.
 */
function courseFinalGrade(result, rules) {
  if (!result) return null;
  const terms = result.terms || [];
  const termIds = new Set(terms.map((term) => term.id));
  const generalCategories = (result.categories || []).filter((category) => !category.term || !termIds.has(category.term));
  if (!terms.length || generalCategories.length) return finalGrade(result.value, rules);
  if (!terms.some((term) => term.value !== null)) return null;
  const totalWeight = terms.reduce((sum, term) => sum + Number(term.weight || 0), 0);
  if (!totalWeight) return null;
  const average = terms.reduce((sum, term) => sum + (finalGrade(term.value, rules)?.value ?? 0) * term.weight, 0) / totalWeight;
  return finalGrade(average, rules);
}

/** De qué sale la calificación final (encabezado del libro): «Promedio de Parcial 1 y Parcial 2», o con sus pesos si son distintos. */
function finalGradeHint(settings = gradingSettings()) {
  const cats = settings.scheme === 'categories' ? settings.categories : [];
  const terms = cats.length ? settings.terms || [] : [];
  if (!terms.length) return cats.length ? 'Promedio ponderado de los rubros' : 'Promedio ponderado de las actividades';
  const names = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} y ${list.at(-1)}` : list[0]);
  const ids = new Set(terms.map((t) => t.id));
  const general = cats.filter((c) => !c.term || !ids.has(c.term));
  const equal = !general.length && terms.every((t) => Number(t.weight) === Number(terms[0].weight));
  if (equal) return terms.length === 1 ? terms[0].name : `Promedio de ${names(terms.map((t) => t.name))}`;
  return `Ponderado: ${names([...terms, ...general].map((t) => `${t.name} ${t.weight} %`))}`;
}

/** Asistencia del alumno en «Mis calificaciones» (12.24). */
function myAttendanceSummaryHtml(member) {
  const pct = attendancePercentFor(member.id);
  if (pct === null) return '';
  const low = pct < (attendanceData.settings?.min_percent ?? 0);
  return `<div class="my-attendance"><h2>Asistencia</h2><p class="my-grade-big-small ${low ? 'grade-low' : 'grade-pass'}">${pct.toFixed(1)} %</p><p class="muted">Mínimo requerido: ${attendanceData.settings.min_percent} %.</p></div>`;
}

function attendancePercentFor(memberId) {
  if (!attendanceData || attendanceData.course !== current.course.id || !attendanceData.sessions.length) return null;
  const member = current.members.find((m) => m.id === memberId);
  const statuses = attendanceData.sessions.filter((s) => sessionApplies(s, member)).map((s) => attendanceRecord(s.id, memberId)?.status).filter(Boolean);
  return attendanceSummary(statuses, attendanceData.settings).percent;
}

/** Si una categoría usa la asistencia y aún no está cargada, la pide y vuelve a dibujar la pantalla. */
function ensureAttendanceForGrades() {
  // 12.24: la columna «Asistencia» de Calificaciones también la necesita.
  const needs = section === 'grades' || gradingSettings().categories.some((c) => c.source === 'attendance');
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
  // Solo lo dirigido a su sección (lo de otras secciones no le cuenta).
  const member = current.members.find((m) => m.id === memberId);
  const tasks = records('task').filter((t) => itemApplies(t, member));
  const quizzes = countedQuizzes().filter((q) => itemApplies(q, member));
  return computeGrade({
    quizzes,
    quizGrades: new Map(quizzes.map((q) => [q.id, quizScore(q, memberId)])),
    tasks,
    grades: new Map(tasks.map((t) => [t.id, gradeOf(memberId, t.id)?.data.grade ?? null])),
    settings: gradingSettings(),
    weights: records('weights')[0]?.data.weights,
    attendancePercent: attendancePercentFor(memberId),
    categoryGrades: new Map(records('category-grade').filter((r) => r.data.member === memberId).map((r) => [r.data.category, r.data.grade])),
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
  const tasks = orderedTasks();
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
        (() => {
          const c = cats.find((x) => x.id === t.data.category);
          return c ? categoryLabel(c, grading) : '';
        })(),
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
        counted ? `cuenta en ${(() => {
          const c = cats.find((x) => x.id === q.data.grade.category);
          return c ? categoryLabel(c, grading) : 'la calificación';
        })()} · ${QUIZ_POLICIES[q.data.grade.policy] || QUIZ_POLICIES.best}` : 'no cuenta en el promedio',
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
      <div><h2>Promedio parcial</h2><p class="muted">Promedio ${scheme}, de 0 a 10, de lo ya calificado${result.terms?.some((t) => t.complete) && result.terms.some((t) => !t.complete) ? ` (solo ${result.terms.filter((t) => t.complete).map((t) => esc(t.name)).join(", ")}; lo demás sigue en curso)` : ""}.</p></div>
      ${myAttendanceSummaryHtml(member)}
    </section>
    ${
      cats.length
        ? `${
            result.terms?.length
              ? `<section class="panel"><h2>Por parcial</h2><ul class="my-grade-list">${result.terms
                  .map((t) => {
                    const grade = finalGrade(t.value, grading.final);
                    // Parcial en curso (12.44): le faltan rubros por calificar; no tiene calificación de parcial todavía.
                    const label = grade !== null ? formatGrade(grade.value, 0) : t.partial !== null && t.partial !== undefined ? 'En curso' : 'Sin calificar';
                    return `<li class="my-grade-item"><div class="my-grade-row is-static"><span class="my-grade-title">${esc(t.name)}<small>${t.weight} % de la calificación final</small></span><span class="my-grade-value ${grade === null ? 'is-pending' : tone(grade.value)}">${label}</span></div></li>`;
                  })
                  .join('')}</ul></section>`
              : ''
          }<section class="panel"><h2>Por categoría</h2><ul class="my-grade-list">${result.categories
            .map((c) => `<li class="my-grade-item"><div class="my-grade-row is-static"><span class="my-grade-title">${esc(categoryLabel(c, grading))}<small>${c.weight} % ${c.term ? 'del parcial' : 'del promedio'}</small></span><span class="my-grade-value ${c.value === null ? 'is-pending' : tone(c.value)}">${c.value === null ? 'Sin calificar' : formatGrade(c.value)}</span></div></li>`)
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
  const others = copySchemeTargets();
  return `<div class="heading"><h1>Cómo se calcula la calificación</h1>${others.length ? '<button type="button" class="secondary" data-copy-scheme>Aplicar a otros grupos</button>' : ''}</div>${schemeSection}
    <h2 class="grading-subtitle">Calificación final y resultado de cada parcial</h2>
    <form id="finalRules" class="real-form grading-rules">
      ${field('Mínima aprobatoria', 'passing', rules.passing, 'number', 'min="0" max="10" step="0.1" required')}
      <p class="muted">La calificación final de la materia y la final de cada parcial siempre se asientan como entero. Las reprobatorias bajan (5.9 → 5); las aprobatorias suben cuando pasan de .55 (6.56 → 7) y de .00 a .55 bajan (6.55 → 6).</p>
      <label class="check-row"><input type="checkbox" name="missingAsZero" ${rules.missingAsZero ? 'checked' : ''}> Las actividades vencidas sin calificar cuentan como 0 en la calificación final</label>
      <p class="muted">El promedio parcial nunca cuenta lo que falta por calificar; esta opción solo afecta la calificación final.</p>
      <p class="form-error error" hidden></p><div class="form-actions"><button class="primary">Guardar reglas</button></div>
    </form>
    <h2 class="grading-subtitle">Rúbricas</h2><div id="rubricBank"><p class="muted">Cargando rúbricas…</p></div>`;
}

/** Otros cursos donde enseña y que no están archivados (destinos para copiar la configuración). */
const copySchemeTargets = () => (courses || []).filter((c) => c.canTeach && !c.archived_at && c.id !== current.course.id);

/** Aplicar la configuración de calificaciones de este curso a otros grupos (12.32). */
function copySchemeModal() {
  if (categoryEditing) return toast('Guarda o cancela primero los cambios de las categorías.');
  const settings = gradingSettings();
  const cats = settings.categories || [];
  const terms = settings.terms || [];
  const label = (c) => [c.name, c.group_name || c.group].filter(Boolean).join(' · ') + (c.period ? ` (${c.period})` : '');
  const summary = settings.scheme === 'categories'
    ? `${terms.length ? `${terms.length} ${terms.length === 1 ? 'parcial' : 'parciales'} y ` : ''}${cats.length} ${cats.length === 1 ? 'categoría' : 'categorías'}`
    : 'pesos por actividad';
  modal(
    'Aplicar la configuración a otros grupos',
    `<p class="real-status">Se copia la configuración de este curso (<b>${esc(summary)}</b>, mínima aprobatoria ${esc(settings.final.passing)}) a los grupos que elijas:</p>
     <ul class="copy-scheme-list">
       <li>Parciales, categorías con sus pesos, distribución y calificaciones que no cuentan.</li>
       <li>Las reglas de la calificación final (decimales, redondeo, mínima aprobatoria).</li>
       <li>La categoría, el valor y el peso de cada actividad, y la categoría de cada evaluación, cuando se llamen igual en el otro grupo.</li>
     </ul>
     <p class="warning-note">La configuración de esos grupos se reemplaza: sus categorías que no existan aquí se quitan y sus actividades quedan sin categoría. Las calificaciones capturadas no se tocan.</p>
     <fieldset class="copy-scheme-targets"><legend>Grupos</legend>${copySchemeTargets()
       .map((c) => `<label class="check-label"><input type="checkbox" name="target" value="${esc(c.id)}"> ${esc(label(c))}</label>`)
       .join('')}</fieldset>`,
    async (f) => {
      const targets = f.getAll('target');
      if (!targets.length) throw new Error('Elige al menos un grupo.');
      const r = await request('/api/grades/copy-scheme', { course: current.course.id, targets });
      const linked = r.courses.reduce((n, c) => n + c.tasks + c.quizzes, 0);
      return `Configuración aplicada a ${r.courses.length === 1 ? '1 grupo' : `${r.courses.length} grupos`}${linked ? `; ${linked === 1 ? 'se enlazó 1 actividad o evaluación' : `se enlazaron ${linked} actividades y evaluaciones`} por su nombre` : ''}.`;
    },
    'Aplicar',
  );
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-copy-scheme]')) copySchemeModal();
});

const CATEGORY_SUGGESTIONS = ['Exámenes', 'Tareas', 'Laboratorio', 'Prácticas', 'Proyecto', 'Participación', 'Foros', 'Evaluaciones en línea', 'Exposiciones', 'Examen departamental', 'Asistencia'];
const round2 = (n) => Math.round(n * 100) / 100;

/** Borrador de «Cómo se calcula»: parciales, categorías y lo que cuenta en cada una (actividades, evaluaciones y foros). */
function newCategoryDraft(tasks) {
  const settings = gradingSettings();
  const graded = new Set(tasks.map((t) => t.data.forum).filter(Boolean));
  return {
    course: current.course.id,
    terms: (settings.terms || []).map((t) => ({ key: t.id, name: t.name, weight: t.weight })),
    categories: settings.categories.length
      ? settings.categories.map((c) => ({ key: c.id, name: c.name, weight: c.weight, source: c.source, term: c.term || '', distribution: c.distribution || 'manual', dropLow: c.dropLow || 0, dropHigh: c.dropHigh || 0 }))
      : [
          { key: 'n1', name: 'Exámenes', weight: 60, source: 'tasks', term: '', distribution: 'manual', dropLow: 0, dropHigh: 0 },
          { key: 'n2', name: 'Tareas', weight: 40, source: 'tasks', term: '', distribution: 'manual', dropLow: 0, dropHigh: 0 },
        ],
    tasks: Object.fromEntries(tasks.map((t) => [t.id, { category: t.data.category || '', points: t.data.points ?? 1 }])),
    quizzes: Object.fromEntries(records('quiz').map((q) => [q.id, { category: q.data.grade?.category || '', points: q.data.grade?.points ?? 10, policy: q.data.grade?.policy || 'best' }])),
    forums: Object.fromEntries(records('forum').filter((f) => !graded.has(f.id)).map((f) => [f.id, { category: '', points: 1 }])),
  };
}

const newCategory = (term = '', name = '', weight = 0) => ({ key: 'n' + Date.now() + Math.random().toString(36).slice(2, 6), name, weight, source: 'tasks', term, distribution: 'manual', dropLow: 0, dropHigh: 0 });

/** Sumas que deben dar 100: el nivel superior (parciales + toda la materia) y cada parcial. */
function draftTotals(draft) {
  const general = draft.categories.filter((c) => !c.term).reduce((n, c) => n + (Number(c.weight) || 0), 0);
  const top = draft.terms.reduce((n, t) => n + (Number(t.weight) || 0), 0) + general;
  const list = [{ label: draft.terms.length ? 'Parciales y categorías de toda la materia' : 'Categorías', sum: top }];
  for (const term of draft.terms) {
    list.push({ label: term.name || 'Parcial sin nombre', sum: draft.categories.filter((c) => c.term === term.key).reduce((n, c) => n + (Number(c.weight) || 0), 0) });
  }
  return list.map((t) => ({ ...t, ok: Math.abs(t.sum - 100) <= 0.01 }));
}

const draftTotalsHtml = (draft) =>
  draftTotals(draft)
    .map((t) => `<span class="${t.ok ? 'grading-ok' : 'error'}">${esc(t.label)}: ${round2(t.sum)} %${t.ok ? ' ✓' : ' (deben sumar 100 %)'}</span>`)
    .join('');

/** «Parcial 1 · Tareas» (la lista cerrada muestra solo la opción, sin el grupo). */
function draftCategoryName(draft, c) {
  const term = c.term && draft.terms.find((t) => t.key === c.term);
  return term ? `${term.name || 'Parcial'} · ${c.name || 'Sin nombre'}` : c.name || 'Sin nombre';
}

/** <option> de categorías de actividades agrupadas por parcial. */
function draftCategoryOptions(draft, selected, empty = 'Sin categoría (no cuenta)') {
  const option = (c) => `<option value="${esc(c.key)}" ${selected === c.key ? 'selected' : ''}>${esc(draftCategoryName(draft, c))}</option>`;
  const usable = draft.categories.filter((c) => c.source === 'tasks');
  const general = usable.filter((c) => !c.term || !draft.terms.some((t) => t.key === c.term));
  return `<option value="">${esc(empty)}</option>${draft.terms
    .map((t) => {
      const inside = usable.filter((c) => c.term === t.key);
      return inside.length ? `<optgroup data-term="${esc(t.key)}" label="${esc(t.name || 'Parcial')}">${inside.map(option).join('')}</optgroup>` : '';
    })
    .join('')}${general.length ? (draft.terms.length ? `<optgroup label="Toda la materia">${general.map(option).join('')}</optgroup>` : general.map(option).join('')) : ''}`;
}

function categoryRowHtml(draft, c, i) {
  const termSelect = draft.terms.length
    ? `<td><select data-cat="term" data-index="${i}" aria-label="Parcial de ${esc(c.name)}"><option value="">Toda la materia</option>${draft.terms
        .map((t) => `<option value="${esc(t.key)}" ${c.term === t.key ? 'selected' : ''}>${esc(t.name || 'Parcial')}</option>`)
        .join('')}</select></td>`
    : '';
  const tasksSource = c.source !== 'attendance';
  return `<tr>
      <td><input data-cat="name" data-index="${i}" value="${esc(c.name)}" list="categorySuggestions" aria-label="Nombre de la categoría" maxlength="80" required placeholder="Por ejemplo, Laboratorio"></td>
      ${termSelect}
      <td><input data-cat="weight" data-index="${i}" type="number" min="0" max="100" step="0.01" value="${esc(c.weight)}" aria-label="Peso de ${esc(c.name)}" class="grade-input" required></td>
      <td><select data-cat="source" data-index="${i}" aria-label="Qué se promedia"><option value="tasks">Actividades, evaluaciones y foros</option><option value="attendance" ${c.source === 'attendance' ? 'selected' : ''}>Porcentaje de asistencia</option></select>
        ${
          tasksSource
            ? `<details class="cat-options"><summary>Opciones${c.distribution === 'equal' || c.dropLow || c.dropHigh ? ' •' : ''}</summary>
          <label>Distribución<select data-cat="distribution" data-index="${i}"><option value="manual">Cada elemento pesa según su valor</option><option value="equal" ${c.distribution === 'equal' ? 'selected' : ''}>Todos los elementos pesan igual</option></select></label>
          <label>No contar las más bajas<input data-cat="dropLow" data-index="${i}" type="number" min="0" max="20" step="1" value="${esc(c.dropLow || 0)}" class="grade-input"></label>
          <label>No contar las más altas<input data-cat="dropHigh" data-index="${i}" type="number" min="0" max="20" step="1" value="${esc(c.dropHigh || 0)}" class="grade-input"></label>
          <p class="muted">Por alumno: por ejemplo, con 1 en «más bajas» se descarta su peor tarea de la categoría.</p></details>`
            : ''
        }</td>
      <td><button type="button" class="danger-link" data-grading="remove-category" data-index="${i}">Quitar</button></td></tr>`;
}

function categoriesFormHtml(tasks) {
  const settings = gradingSettings();
  categoryDraft ??= newCategoryDraft(tasks);
  const draft = categoryDraft;
  const hasTerms = draft.terms.length > 0;
  const cols = hasTerms ? 5 : 4;
  const groupRows = (term, label, hint) => {
    const rows = draft.categories.map((c, i) => [c, i]).filter(([c]) => (term ? c.term === term.key : !c.term || !draft.terms.some((t) => t.key === c.term)));
    const sum = rows.reduce((n, [c]) => n + (Number(c.weight) || 0), 0);
    return `${hasTerms ? `<tr class="grading-group"><th colspan="${cols}">${esc(label)} <span class="muted">${hint}${term ? ` · suman ${round2(sum)} %` : ''}</span></th></tr>` : ''}${rows.map(([c, i]) => categoryRowHtml(draft, c, i)).join('')}
      <tr class="grading-add"><td colspan="${cols}"><button type="button" class="table-link" data-grading="add-category" data-term="${esc(term?.key || '')}">＋ Agregar categoría${hasTerms ? (term ? ` en ${esc(term.name || 'el parcial')}` : ' de toda la materia') : ''}</button></td></tr>`;
  };
  const termsHtml = hasTerms
    ? `<div class="table-wrap"><table class="grading-table terms-table"><thead><tr><th>Parcial</th><th>Peso en la calificación final (%)</th><th aria-label="Quitar"></th></tr></thead><tbody>
      ${draft.terms
        .map(
          (t, i) => `<tr><td><input data-term-field="name" data-index="${i}" value="${esc(t.name)}" maxlength="60" required aria-label="Nombre del parcial"></td>
        <td><input data-term-field="weight" data-index="${i}" type="number" min="0" max="100" step="0.01" value="${esc(t.weight)}" class="grade-input" required aria-label="Peso de ${esc(t.name)}"></td>
        <td><button type="button" class="danger-link" data-grading="remove-term" data-index="${i}">Quitar</button></td></tr>`,
        )
        .join('')}</tbody></table></div>
      <div class="grading-row"><button type="button" class="secondary" data-grading="add-term">＋ Agregar parcial</button><button type="button" class="table-link" data-grading="remove-terms">Quitar todos los parciales</button></div>`
    : `<div class="grading-row"><p class="muted">¿Tu materia se evalúa por parciales? Divídela y cada parcial tendrá sus propias categorías (Exámenes, Tareas…) con un peso en la calificación final. Categorías como Laboratorio pueden quedar para toda la materia.</p>
      <label class="inline-label">Parciales<select id="termCount">${[2, 3, 4].map((n) => `<option ${n === 3 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <button type="button" class="secondary" data-grading="split-terms">Dividir por parciales</button></div>`;
  const options = (selected) => draftCategoryOptions(draft, selected);
  const forumTask = new Map(tasks.filter((t) => t.data.forum).map((t) => [t.id, records('forum').find((f) => f.id === t.data.forum)]));
  const itemRow = (kind, id, title, type, value, extra = '') => `<tr><td>${esc(title)}</td><td><span class="item-kind kind-${kind}">${type}</span></td>
      <td><select data-${kind}-category="${esc(id)}" aria-label="Categoría de ${esc(title)}">${options(value.category || '')}</select></td>
      <td><input data-${kind}-points="${esc(id)}" type="number" min="0.01" max="1000" step="0.01" value="${esc(value.points)}" class="grade-input" aria-label="Valor de ${esc(title)}"></td><td>${extra}</td></tr>`;
  // Con el filtro de secciones del curso, solo lo de esos grupos (12.46): las actividades de otro grupo no se
  // muestran aquí. Lo que no se ve conserva su categoría al guardar (el borrador no se toca).
  const chosen = typeof selectedSections === 'function' ? selectedSections().filter((x) => x !== SECTION_NONE) : [];
  const inView = (r) => !chosen.length || !r.data.sections?.length || r.data.sections.some((x) => chosen.includes(x));
  tasks = tasks.filter(inView);
  const quizList = records('quiz').filter(inView);
  const forumList = records('forum').filter((f) => draft.forums[f.id] && inView(f));
  const items =
    tasks.map((t) => itemRow('task', t.id, t.data.title, forumTask.get(t.id) ? 'Foro' : 'Actividad', draft.tasks[t.id] || { points: 1 })).join('') +
    quizList
      .map((q) =>
        itemRow(
          'quiz',
          q.id,
          q.data.title,
          'Evaluación',
          draft.quizzes[q.id],
          `<select data-quiz-policy="${esc(q.id)}" aria-label="Qué intento cuenta">${Object.entries(QUIZ_POLICIES)
            .map(([k, v]) => `<option value="${k}" ${draft.quizzes[q.id].policy === k ? 'selected' : ''}>Cuenta ${v}</option>`)
            .join('')}</select>`,
        ),
      )
      .join('') +
    forumList.map((f) => itemRow('forum', f.id, f.data.title, 'Foro', draft.forums[f.id], '<span class="muted">Al elegir categoría se crea «Participación» para calificarlo.</span>')).join('');
  const loose = tasks.filter((t) => !draft.tasks[t.id]?.category).length + quizList.filter((q) => !draft.quizzes[q.id]?.category).length;
  return `<form id="categoriesForm" class="real-form">
    <datalist id="categorySuggestions">${CATEGORY_SUGGESTIONS.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
    <h2 class="grading-subtitle">Parciales</h2>
    ${termsHtml}
    <h2 class="grading-subtitle">Categorías</h2>
    <p class="muted">${hasTerms ? 'Dentro de cada parcial, el peso de sus categorías es sobre ese parcial (deben sumar 100 %). Las de «Toda la materia» pesan directo en la calificación final, junto con los parciales.' : 'Agrega las que necesites (Laboratorio, Proyecto, Participación…). Sus pesos deben sumar 100 %.'}</p>
    <div class="table-wrap"><table class="grading-table"><thead><tr><th>Categoría</th>${hasTerms ? '<th>Parcial</th>' : ''}<th>Peso (%)</th><th>Se calcula con</th><th aria-label="Quitar"></th></tr></thead><tbody>
    ${hasTerms ? draft.terms.map((t) => groupRows(t, t.name || 'Parcial', 'peso dentro del parcial')).join('') + groupRows(null, 'Toda la materia', 'peso directo en la final') : groupRows(null)}
    </tbody></table></div>
    <p class="grading-totals" id="categoryTotal">${draftTotalsHtml(draft)}</p>
    <h2 class="grading-subtitle">Qué cuenta en cada categoría</h2>
    ${typeof sectionFilterHtml === 'function' && courseSections().length ? `<div class="toolbar">${sectionFilterHtml()}</div>` : ''}
    <p class="muted">Enlaza aquí actividades, evaluaciones y foros. El valor indica cuánto pesa cada elemento dentro de su categoría (con 2 cuenta el doble que con 1).${loose ? ` ${loose === 1 ? 'Un elemento sin categoría no cuenta' : `${loose} elementos sin categoría no cuentan`} en la calificación.` : ''} Una evaluación sin intentos de un alumno no cuenta como cero.</p>
    <div class="table-wrap"><table class="grading-table items-table"><thead><tr><th>Elemento</th><th>Tipo</th><th>Categoría</th><th>Valor</th><th aria-label="Opciones"></th></tr></thead><tbody>
    ${items || '<tr><td colspan="5">Todavía no hay actividades, evaluaciones ni foros.</td></tr>'}
    </tbody></table></div>
    <p class="form-error error" hidden></p>
    <div class="form-actions"><button class="primary">Guardar</button>
      ${settings.scheme === 'categories' ? '<button type="button" class="secondary" data-grading="use-tasks">Volver a pesos por actividad</button>' : '<button type="button" class="secondary" data-grading="cancel">Cancelar</button>'}</div>
  </form>`;
}

function syncCategoryDraft() {
  const form = document.getElementById('categoriesForm');
  if (!form || !categoryDraft) return;
  const numeric = new Set(['weight', 'dropLow', 'dropHigh']);
  form.querySelectorAll('[data-cat]').forEach((input) => {
    const category = categoryDraft.categories[Number(input.dataset.index)];
    if (category) category[input.dataset.cat] = numeric.has(input.dataset.cat) ? Number(input.value) : input.value;
  });
  form.querySelectorAll('[data-term-field]').forEach((input) => {
    const term = categoryDraft.terms[Number(input.dataset.index)];
    if (term) term[input.dataset.termField] = input.dataset.termField === 'weight' ? Number(input.value) : input.value;
  });
  for (const kind of ['task', 'quiz', 'forum']) {
    const bucket = categoryDraft[kind + (kind === 'quiz' ? 'zes' : 's')];
    form.querySelectorAll(`[data-${kind}-category]`).forEach((select) => bucket[select.getAttribute(`data-${kind}-category`)] && (bucket[select.getAttribute(`data-${kind}-category`)].category = select.value));
    form.querySelectorAll(`[data-${kind}-points]`).forEach((input) => bucket[input.getAttribute(`data-${kind}-points`)] && (bucket[input.getAttribute(`data-${kind}-points`)].points = Number(input.value)));
  }
  form.querySelectorAll('[data-quiz-policy]').forEach((select) => (categoryDraft.quizzes[select.dataset.quizPolicy].policy = select.value));
}

/** Divide en N parciales: cada uno recibe las categorías de actividades actuales (la asistencia queda para toda la materia). */
function splitDraftInTerms(draft, count) {
  const general = draft.categories.filter((c) => c.source === 'attendance');
  let base = draft.categories.filter((c) => c.source !== 'attendance');
  if (!base.length) base = [newCategory('', 'Exámenes', 60), newCategory('', 'Tareas', 40)];
  const sum = base.reduce((n, c) => n + (Number(c.weight) || 0), 0);
  const share = (c) => (sum ? round2(((Number(c.weight) || 0) * 100) / sum) : round2(100 / base.length));
  const rest = 100 - general.reduce((n, c) => n + (Number(c.weight) || 0), 0);
  const each = Math.floor((rest / count) * 100) / 100;
  draft.terms = Array.from({ length: count }, (_, i) => ({ key: 't' + Date.now() + i, name: `Parcial ${i + 1}`, weight: i === count - 1 ? round2(rest - each * (count - 1)) : each }));
  const categories = [];
  draft.terms.forEach((term, i) => {
    // El primer parcial conserva las categorías originales (y lo que ya estaba enlazado a ellas).
    for (const c of base) categories.push(i === 0 ? { ...c, term: term.key, weight: share(c) } : { ...newCategory(term.key, c.name, share(c)), distribution: c.distribution, dropLow: c.dropLow, dropHigh: c.dropHigh });
  });
  draft.categories = [...categories, ...general.map((c) => ({ ...c, term: '' }))];
}

/** Al quitar un parcial, sus categorías pasan a «Toda la materia» con el nombre del parcial para no repetirse. */
function removeDraftTerm(draft, index) {
  const [term] = draft.terms.splice(index, 1);
  if (!term) return;
  for (const c of draft.categories) {
    if (c.term !== term.key) continue;
    c.term = '';
    c.name = `${c.name} (${term.name || 'parcial'})`.slice(0, 80);
  }
}

function bindGradingManage() {
  const categoriesForm = document.getElementById('categoriesForm');
  if (categoriesForm) {
    categoriesForm.addEventListener('input', () => {
      syncCategoryDraft();
      document.getElementById('categoryTotal').innerHTML = draftTotalsHtml(categoryDraft);
    });
    // Cambiar el parcial o el tipo de una categoría reacomoda la tabla (y las listas de categorías).
    categoriesForm.addEventListener('change', (event) => {
      const target = event.target;
      if (target.matches('[data-cat="name"], [data-term-field="name"]')) {
        // Solo cambia el texto de las listas (volver a dibujar aquí perdería el clic que causó el cambio).
        syncCategoryDraft();
        const isTerm = target.matches('[data-term-field]');
        const item = (isTerm ? categoryDraft.terms : categoryDraft.categories)[Number(target.dataset.index)];
        if (!item) return;
        if (isTerm) categoriesForm.querySelectorAll('optgroup').forEach((g) => g.dataset.term === item.key && (g.label = item.name || 'Parcial'));
        for (const c of isTerm ? categoryDraft.categories.filter((x) => x.term === item.key) : [item]) {
          categoriesForm.querySelectorAll(`[data-task-category] option[value="${CSS.escape(c.key)}"], [data-quiz-category] option[value="${CSS.escape(c.key)}"], [data-forum-category] option[value="${CSS.escape(c.key)}"]`).forEach((o) => (o.textContent = draftCategoryName(categoryDraft, c)));
        }
        if (isTerm) categoriesForm.querySelectorAll(`[data-cat="term"] option[value="${CSS.escape(item.key)}"]`).forEach((o) => (o.textContent = item.name || 'Parcial'));
        return;
      }
      if (!target.matches('[data-cat="term"], [data-cat="source"]')) return;
      syncCategoryDraft();
      render();
    });
    bindForm('#categoriesForm', async () => {
      syncCategoryDraft();
      const grading = records('grading')[0];
      const draft = categoryDraft;
      const result = await request('/api/grades/scheme', {
        course: current.course.id,
        revision: grading?.revision ?? 0,
        scheme: 'categories',
        terms: draft.terms.map(({ key, name, weight }) => ({ key, name, weight })),
        categories: draft.categories.map(({ key, name, weight, source, term, distribution, dropLow, dropHigh }) => ({ key, name, weight, source, term, distribution, dropLow, dropHigh })),
        assignments: Object.entries(draft.tasks).map(([task, value]) => ({ task, category: value.category || null, points: value.points })),
        quizzes: Object.entries(draft.quizzes).map(([quiz, value]) => ({ quiz, category: value.category || null, points: value.points, policy: value.policy })),
        forums: Object.entries(draft.forums).filter(([, value]) => value.category).map(([forum, value]) => ({ forum, category: value.category, points: value.points })),
      });
      categoryDraft = null;
      categoryEditing = false;
      return result.forums ? `Guardado. Se ${result.forums === 1 ? 'creó una actividad' : `crearon ${result.forums} actividades`} de participación para calificar los foros.` : 'Guardado.';
    });
  }
  bindForm('#finalRules', async (f) => {
    await request('/api/grades/final-rules', {
      course: current.course.id,
      revision: records('grading')[0]?.revision ?? 0,
      passing: Number(f.get('passing')),
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
  const button = event.target.closest('[data-grading]');
  if (action === 'add-category') {
    syncCategoryDraft();
    categoryDraft.categories.push(newCategory(button.dataset.term || ''));
  }
  if (action === 'remove-category') {
    syncCategoryDraft();
    const [removed] = categoryDraft.categories.splice(Number(button.dataset.index), 1);
    for (const bucket of [categoryDraft.tasks, categoryDraft.quizzes, categoryDraft.forums]) {
      for (const value of Object.values(bucket)) if (value.category === removed?.key) value.category = '';
    }
  }
  if (action === 'split-terms') {
    syncCategoryDraft();
    splitDraftInTerms(categoryDraft, Number(document.getElementById('termCount')?.value) || 3);
  }
  if (action === 'add-term') {
    syncCategoryDraft();
    const term = { key: 't' + Date.now(), name: `Parcial ${categoryDraft.terms.length + 1}`, weight: 0 };
    categoryDraft.terms.push(term);
    categoryDraft.categories.push(newCategory(term.key, 'Exámenes', 60), newCategory(term.key, 'Tareas', 40));
  }
  if (action === 'remove-term') {
    syncCategoryDraft();
    removeDraftTerm(categoryDraft, Number(button.dataset.index));
  }
  if (action === 'remove-terms') {
    syncCategoryDraft();
    while (categoryDraft.terms.length) removeDraftTerm(categoryDraft, 0);
  }
  if (action === 'use-tasks') {
    try {
      await request('/api/grades/scheme', {
        course: current.course.id,
        revision: records('grading')[0]?.revision ?? 0,
        scheme: 'tasks',
        terms: (gradingSettings().terms || []).map((t) => ({ key: t.id, name: t.name, weight: t.weight })),
        categories: gradingSettings().categories.map((c) => ({ key: c.id, name: c.name, weight: c.weight, source: c.source, term: c.term, distribution: c.distribution, dropLow: c.dropLow, dropHigh: c.dropHigh })),
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

// ---- Libro de calificaciones: captura en la tabla, entrega y opciones por actividad (12.24) ----------------------

const DOC_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6"/></svg>';

/** Captura manual que sustituye el cálculo de un rubro para un alumno. */
function categoryGradeOf(member, category) {
  return records('category-grade').find((r) => r.data.member === member && r.data.category === category);
}

/** Casilla siempre visible. Vacía = volver al cálculo automático del rubro. */
/**
 * Color de la casilla del libro según la calificación (como en Brightspace): rojo debajo de la mínima aprobatoria,
 * verde desde ella. Vacía o sin número, sin color.
 */
function gradeToneClass(value) {
  if (value === null || value === undefined || value === '') return '';
  const grade = Number(value);
  if (!Number.isFinite(grade)) return '';
  return grade >= gradingSettings().final.passing ? 'gb-pass' : 'gb-fail';
}

/**
 * Color de la casilla de una actividad (12.43, como en Brightspace): 10 es verde intenso y, al bajar la calificación,
 * el verde se aclara y pasa por amarillo hasta el rojo. Sin calificación ni entrega y ya vencida: rojo («sin entregar»).
 * Entregada sin calificar o aún sin vencer: sin color. Devuelve los atributos para el <td>.
 */
function gradeHeatAttr(task, member, submission) {
  const raw = submission?.data.grade;
  const grade = raw === null || raw === undefined || raw === '' ? null : Number(raw);
  if (grade !== null && Number.isFinite(grade)) {
    // Desde la mínima aprobatoria hasta 10: de verde amarillento y claro a verde intenso. Por debajo: de naranja a rojo.
    const passing = gradingSettings().final.passing || 6;
    const g = Math.max(0, Math.min(10, grade));
    const up = g >= passing ? (passing >= 10 ? 1 : (g - passing) / (10 - passing)) : 0;
    const down = g < passing ? g / passing : 0;
    const hue = g >= passing ? Math.round(75 + 60 * up) : Math.round(2 + 26 * down);
    const sat = g >= passing ? Math.round(45 + 25 * up) : 72;
    const light = g >= passing ? Math.round(90 - 14 * up) : Math.round(84 + 4 * down);
    return ` style="--gb-heat: hsl(${hue} ${sat}% ${light}%)" data-heat="grade"`;
  }
  if (task.data.forum || hasSubmission(submission)) return '';
  const due = dueFor(task, member.id);
  if (!due || Date.parse(due) > Date.now()) return '';
  return ' style="--gb-heat: hsl(2 72% 84%)" data-heat="missing" title="Sin entregar (venció)"';
}

/** Calificación máxima de la captura de un rubro (12.56): se escribe «6 de 9» y se guarda sobre 10. */
const categoryMax = (id) => {
  const max = Number(gradingSettings().categories.find((c) => c.id === id)?.maxScore);
  return max > 0 ? max : 10;
};
const categoryPoints = (id, grade) => (grade === null || grade === undefined || grade === '' ? '' : Math.round(Number(grade) * categoryMax(id) / 10 * 100) / 100);

function categoryGradeCellHtml(category, member, value) {
  if (category.source !== 'tasks' || !teaches()) return `<td class="category-col ${gradeToneClass(value)}">${formatGrade(value)}</td>`;
  const manual = categoryGradeOf(member.id, category.id);
  const automatic = category.automaticValue ?? (manual ? null : value);
  const automaticText = formatGrade(automatic);
  const max = categoryMax(category.id);
  return `<td class="category-col category-grade-cell ${manual ? 'is-manual' : ''} ${gradeToneClass(value)}">
    <input class="category-grade-input" type="number" min="0" max="${max}" step="0.01" inputmode="decimal"
      value="${esc(categoryPoints(category.id, manual?.data.grade))}" placeholder="${esc(max === 10 ? automaticText : automatic === null ? '—' : categoryPoints(category.id, automatic))}" data-category-grade
      data-cg-category="${esc(category.id)}" data-cg-member="${esc(member.id)}"
      aria-label="Calificación manual de ${esc(categoryLabel(category))} para ${esc(member.name)}" title="Escribe una calificación manual; deja vacío para usar el cálculo automático">
    <small class="${manual ? 'manual-grade-tag' : 'category-grade-hint'}">${max !== 10 && manual ? `${categoryPoints(category.id, manual.data.grade)} de ${max} = ${formatGrade(manual.data.grade)} · ` : ''}${manual ? `Manual${automatic === null ? '' : ` · automático: ${automaticText}`}` : `Automático: ${automaticText}`}</small></td>`;
}

/** Guarda una captura manual de rubro. Eliminar su contenido reactiva el valor automático. */
async function saveCategoryGradeInput(input) {
  const { cgCategory: category, cgMember: member } = input.dataset;
  const raw = input.value.trim().replace(',', '.');
  const max = categoryMax(category);
  const points = raw === '' ? null : Number(raw);
  input.classList.remove('is-error');
  if (points !== null && (!Number.isFinite(points) || points < 0 || points > max)) {
    input.classList.add('is-error');
    toast(`La calificación va de 0 a ${max}.`);
    input.focus();
    return false;
  }
  const saved = categoryGradeOf(member, category);
  if (points === null ? !saved : points === categoryPoints(category, saved?.data.grade)) return true;
  const grade = points === null ? null : Math.round(points * 10 / max * 10000) / 10000;
  const key = `${category}:${member}`;
  if (categoryGradeSaving.has(key)) return categoryGradeSaving.get(key);
  input.classList.add('is-saving');
  const pending = (async () => {
    try {
      const response = await request('/api/grades/category', {
        course: current.course.id,
        category,
        member,
        revision: saved?.revision,
        grade,
      });
      if (response.deleted) {
        const i = current.records.findIndex((r) => r.id === response.id);
        if (i >= 0) current.records.splice(i, 1);
      } else {
        const i = current.records.findIndex((r) => r.id === response.id);
        if (i >= 0) current.records[i] = response;
        else current.records.push(response);
      }
      refreshGradebook();
      return true;
    } catch (error) {
      input.classList.remove('is-saving');
      input.classList.add('is-error');
      toast(error.status === 409 ? 'Otra persona cambió esta calificación. Recarga la página.' : error.message);
      input.focus();
      return false;
    }
  })().finally(() => categoryGradeSaving.delete(key));
  categoryGradeSaving.set(key, pending);
  return pending;
}
const categoryGradeSaving = new Map();

/** Casilla del libro: la calificación se escribe ahí mismo y el ícono abre la entrega (o la pantalla para calificar). */
/** ¿El alumno entregó algo? (una captura manual del docente no es entrega) */
const hasSubmission = (s) => Boolean(s && !s.data.manual && (s.data.submitted || s.data.body || s.data.fileIds?.length));

/** Entrega que el docente aún no revisa: sin calificación, o entregada de nuevo después de calificarla (12.32). */
function needsReview(s) {
  if (!hasSubmission(s)) return false;
  const grade = s.data.grade;
  return grade === null || grade === undefined || grade === '' || Boolean(s.data.gradedAt && s.data.submitted && s.data.submitted > s.data.gradedAt);
}

/** Calificación máxima de la columna (12.51): se captura «6 de 9» y se guarda sobre 10 (6.67). */
const taskMax = (t) => Number(t?.data?.maxScore) > 0 ? Number(t.data.maxScore) : 10;
const toPoints = (t, grade) => grade === null || grade === undefined || grade === '' ? '' : Math.round(Number(grade) * taskMax(t) / 10 * 100) / 100;

function gradebookCellHtml(t, m, s) {
  const sent = hasSubmission(s);
  const pending = needsReview(s);
  const title = sent ? `${pending ? 'Sin revisar: ' : ''}ver la entrega de ${m.name}${s.data.late ? ' (tardía)' : ''}` : `Calificar a ${m.name} con comentarios o rúbrica`;
  return `<div class="gb-cell-row${pending ? ' needs-review' : ''}"><input class="gb-input" type="number" min="0" max="${taskMax(t)}" step="0.01" inputmode="decimal" value="${esc(toPoints(t, s?.data.grade))}" placeholder="—"
      title="${taskMax(t) !== 10 && s?.data.grade != null ? `${toPoints(t, s.data.grade)} de ${taskMax(t)} = ${Number(s.data.grade).toFixed(2)} sobre 10` : ''}"
      data-gb-task="${esc(t.id)}" data-gb-member="${esc(m.id)}" aria-label="Calificación de ${esc(m.name)} en ${esc(t.data.title)}">
    <button type="button" class="gb-open ${sent ? 'has-file' : ''} ${pending ? 'needs-review' : ''}" data-action="review" data-id="${esc(t.id)}" data-member="${esc(m.id)}" title="${esc(title)}" aria-label="${esc(title)}">${sent ? DOC_ICON : '›'}</button></div>${
    pending ? '<span class="review-tag">sin revisar</span>' : ''
  }${s && s.data.published === false ? '<span class="draft-tag">borrador</span>' : ''}${sent && s.data.late ? '<span class="late-tag">tardía</span>' : ''}`;
}

/** Menú ⌄ de cada columna (como en Brightspace). `prev`/`next`: columnas visibles a los lados, para moverla. */
function gradebookColumnMenu(t, prev = null, next = null) {
  return `<details class="gb-col-menu"><summary aria-label="Opciones de ${esc(t.data.title)}" title="Opciones">⌄</summary><div class="gb-col-panel">
    <button type="button" data-action="task" data-id="${esc(t.id)}">Ver entregas</button>
    <button type="button" data-action="edit-task" data-id="${esc(t.id)}">Editar actividad</button>
    <button type="button" data-gb-enter="${esc(t.id)}">Ingresar calificaciones</button>
    <button type="button" data-gb-bulk="${esc(t.id)}">Calificar en bloque</button>
    <button type="button" data-gb-max="${esc(t.id)}">Calificación máxima (${taskMax(t)})…</button>
    <button type="button" data-gb-stats="${esc(t.id)}">Ver las estadísticas</button>
    <button type="button" data-gb-move="${esc(t.id)}" data-gb-target="${esc(prev?.id || '')}" ${prev ? '' : 'disabled'}>← Mover a la izquierda</button>
    <button type="button" data-gb-move="${esc(t.id)}" data-gb-target="${esc(next?.id || '')}" data-gb-after="1" ${next ? '' : 'disabled'}>Mover a la derecha →</button>
    <button type="button" class="gb-danger" data-action="trash" data-kind="task" data-id="${esc(t.id)}">Eliminar actividad</button>
  </div></details>`;
}

document.addEventListener('click', async (e) => {
  const button = e.target.closest?.('[data-cg-max]');
  if (!button) return;
  const c = gradingSettings().categories.find((x) => x.id === button.dataset.cgMax);
  if (!c) return;
  modal(`Calificación máxima · ${categoryLabel(c, gradingSettings())}`, `<p class="muted">Escribe en el subtotal los puntos sobre este valor y Enlace lo convierte a 10, como en Brightspace: 6 de 9 = 6.67.</p>
    <label>Calificación máxima<input name="max" type="number" min="0.01" max="1000" step="0.01" required value="${categoryMax(c.id)}"></label>
    <label class="check-label"><input type="checkbox" name="rescale"> Recalcular las calificaciones ya capturadas (conservan sus puntos: un 6 pasa a 6 de 9 = 6.67)</label>
    <p class="muted">Sin marcarla, las calificaciones ya capturadas no cambian.</p>
    `, async (f) => {
    const r = await request('/api/grades/category/max', { course: current.course.id, category: c.id, max: Number(f.get('max')), rescale: f.get('rescale') === 'on' });
    return r.changed ? `Calificación máxima guardada; se recalcularon ${r.changed} calificaciones.` : 'Calificación máxima guardada.';
  });
});

document.addEventListener('click', async (e) => {
  const button = e.target.closest?.('[data-gb-max]');
  if (!button) return;
  const t = records('task').find((x) => x.id === button.dataset.gbMax);
  if (!t) return;
  modal(`Calificación máxima · ${t.data.title}`, `    <p class="muted">Captura sobre este valor y Enlace lo convierte a 10, como en Brightspace: 6 de 9 = 6.67.</p>
    <label>Calificación máxima<input name="max" type="number" min="0.01" max="1000" step="0.01" required value="${taskMax(t)}"></label>
    <label class="check-label"><input type="checkbox" name="rescale"> Recalcular las calificaciones ya capturadas (conservan sus puntos: un 6 pasa a 6 de 9 = 6.67)</label>
    <p class="muted">Sin marcarla, las calificaciones ya capturadas no cambian.</p>
    `, async (f) => {
    const r = await request('/api/task/max', { course: current.course.id, id: t.id, max: Number(f.get('max')), rescale: f.get('rescale') === 'on' });
    return r.changed ? `Calificación máxima guardada; se recalcularon ${r.changed} calificaciones.` : 'Calificación máxima guardada.';
  });
});

/** Mueve la columna `id` antes (o después) de la columna `target` y guarda el orden para todos los docentes del curso. */
async function moveGradebookColumn(id, target, after = false) {
  const order = orderedTasks().map((t) => t.id).filter((x) => x !== id);
  const at = order.indexOf(target);
  if (at < 0 || id === target) return;
  order.splice(after ? at + 1 : at, 0, id);
  await saveColumnOrder(order);
}

async function saveColumnOrder(order) {
  const grading = records('grading')[0];
  const before = grading?.data.columnOrder || [];
  // Se ve de inmediato; si el servidor lo rechaza, vuelve al orden anterior.
  if (grading) grading.data = { ...grading.data, columnOrder: order };
  refreshGradebook();
  try {
    const saved = await request('/api/grades/order', { course: current.course.id, order });
    // La configuración de calificaciones del curso se creó con este cambio: se recarga para tener su revisión.
    if (saved.created) {
      current = await request('/api/course?id=' + encodeURIComponent(current.course.id) + viewSuffix());
      refreshGradebook();
    }
  } catch (error) {
    if (grading) grading.data = { ...grading.data, columnOrder: before };
    refreshGradebook();
    toast(error.message);
  }
}

// Arrastrar el encabezado de una columna para cambiarla de lugar (en el teléfono: menú ⌄ → Mover).
let gradebookDragged = null;
function clearGradebookDrop() {
  for (const th of document.querySelectorAll('.gb-drop-before, .gb-drop-after, .gb-dragging')) th.classList.remove('gb-drop-before', 'gb-drop-after', 'gb-dragging');
}
document.addEventListener('dragstart', (e) => {
  const th = e.target.closest?.('[data-gb-col]');
  if (!th) return;
  gradebookDragged = th.dataset.gbCol;
  th.classList.add('gb-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', gradebookDragged); // Firefox no arrastra sin datos
});
document.addEventListener('dragover', (e) => {
  const th = gradebookDragged && e.target.closest?.('[data-gb-col]');
  if (!th) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const box = th.getBoundingClientRect();
  const after = e.clientX > box.left + box.width / 2;
  for (const other of document.querySelectorAll('.gb-drop-before, .gb-drop-after')) if (other !== th) other.classList.remove('gb-drop-before', 'gb-drop-after');
  if (th.dataset.gbCol === gradebookDragged) return;
  th.classList.toggle('gb-drop-after', after);
  th.classList.toggle('gb-drop-before', !after);
});
document.addEventListener('drop', (e) => {
  const th = gradebookDragged && e.target.closest?.('[data-gb-col]');
  if (!th) return;
  e.preventDefault();
  const id = gradebookDragged;
  const after = th.classList.contains('gb-drop-after');
  gradebookDragged = null;
  clearGradebookDrop();
  moveGradebookColumn(id, th.dataset.gbCol, after);
});
document.addEventListener('dragend', () => {
  gradebookDragged = null;
  clearGradebookDrop();
});

/** Guarda lo escrito en una casilla (si cambió) y actualiza el libro sin perder el lugar. */
async function saveGradebookCell(input) {
  const { gbTask: task, gbMember: member } = input.dataset;
  const raw = input.value.trim().replace(',', '.');
  const t = records('task').find((x) => x.id === task), max = taskMax(t);
  const points = raw === '' ? null : Number(raw);
  input.classList.remove('is-error');
  if (points !== null && (!Number.isFinite(points) || points < 0 || points > max)) {
    input.classList.add('is-error');
    toast(`La calificación va de 0 a ${max}.`);
    return false;
  }
  // Se guarda sobre 10 (6 de 9 = 6.6667); si la casilla no cambió, no se vuelve a guardar.
  if (points !== null && points === toPoints(t, gradeOf(member, task)?.data.grade)) return true;
  const grade = points === null ? null : Math.round(points * 10 / max * 10000) / 10000;
  const s = gradeOf(member, task);
  if ((s?.data.grade ?? null) === grade) return true;
  const key = `${task}:${member}`;
  if (gradebookSaving.has(key)) return gradebookSaving.get(key);
  input.classList.add('is-saving');
  const pending = saveGradebookGrade(input, task, member, s, grade).finally(() => gradebookSaving.delete(key));
  gradebookSaving.set(key, pending);
  return pending;
}
const gradebookSaving = new Map(); // guardados en curso (Enter y luego salir de la casilla no guardan dos veces)

async function saveGradebookGrade(input, task, member, s, grade) {
  try {
    const saved = await request('/api/grade', { course: current.course.id, task, member, revision: s?.revision, grade, publish: reviewPublishNow() });
    const i = current.records.findIndex((r) => r.id === saved.id);
    if (i >= 0) current.records[i] = saved;
    else current.records.push(saved);
    refreshGradebook();
    return true;
  } catch (error) {
    input.classList.remove('is-saving');
    input.classList.add('is-error');
    toast(error.status === 409 ? 'Otra persona cambió esta calificación. Recarga la página.' : error.message);
    return false;
  }
}

/** Vuelve a dibujar el libro conservando el foco, lo que se está escribiendo y el desplazamiento. */
function refreshGradebook() {
  if (section !== 'grades') return;
  const active = document.activeElement?.matches?.('.gb-input, .category-grade-input') ? document.activeElement : null;
  const keep = active?.matches('.gb-input')
    ? { type: 'task', task: active.dataset.gbTask, member: active.dataset.gbMember, value: active.value }
    : active
      ? { type: 'category', category: active.dataset.cgCategory, member: active.dataset.cgMember, value: active.value }
      : null;
  const wrap = document.querySelector('.gradebook');
  const [left, top, y] = [wrap?.scrollLeft, wrap?.scrollTop, window.scrollY];
  const search = document.querySelector('[data-search]')?.value || '';
  renderGrades();
  const box = document.querySelector('[data-search]');
  if (search && box) {
    box.value = search;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const again = document.querySelector('.gradebook');
  if (again) [again.scrollLeft, again.scrollTop] = [left, top];
  window.scrollTo(0, y);
  if (keep) {
    const input = keep.type === 'task'
      ? document.querySelector(`.gb-input[data-gb-task="${CSS.escape(keep.task)}"][data-gb-member="${CSS.escape(keep.member)}"]`)
      : document.querySelector(`.category-grade-input[data-cg-category="${CSS.escape(keep.category)}"][data-cg-member="${CSS.escape(keep.member)}"]`);
    if (input) {
      input.value = keep.value;
      input.focus({ preventScroll: true });
    }
  }
}

/** Casilla de la misma actividad en otra fila visible (Enter baja, Mayús+Enter sube). */
function nextGradebookInput(input, step) {
  const all = [...document.querySelectorAll(`.gb-input[data-gb-task="${CSS.escape(input.dataset.gbTask)}"]`)].filter((x) => !x.closest('tr')?.hidden);
  return all[all.indexOf(input) + step] || null;
}

/** Calificar en bloque (12.32): la misma calificación a todo el grupo o a los alumnos elegidos. */
function bulkGradeModal(taskId) {
  const t = find(taskId);
  const students = studentsInView().filter((m) => itemApplies(t, m));
  const status = (s) => (s?.data.grade !== null && s?.data.grade !== undefined ? `Tiene ${s.data.grade}` : hasSubmission(s) ? 'Entregó, sin calificar' : 'Sin calificación');
  const rows = students
    .map((m) => {
      const s = gradeOf(m.id, t.id);
      const graded = s?.data.grade !== null && s?.data.grade !== undefined;
      return `<tr><td><label class="check-label bulk-grade-pick"><input type="checkbox" name="m" value="${esc(m.id)}" data-graded="${graded ? 1 : 0}" ${graded ? '' : 'checked'}> ${esc(m.name)}</label></td><td class="${needsReview(s) ? 'status-review' : 'muted'}">${esc(status(s))}</td></tr>`;
    })
    .join('');
  modal(
    `Calificar en bloque: ${t.data.title}`,
    `<p class="real-status">Pon la misma calificación a varios alumnos a la vez (por ejemplo, una actividad hecha en clase). Luego puedes cambiar la de cualquiera en el libro.</p>
     <div class="quiz-grid"><label>Calificación (0 a 10)<input name="grade" type="number" min="0" max="10" step="0.01" inputmode="decimal" required></label>
     <label>Estado<select name="publish"><option value="1" ${reviewPublishNow() ? 'selected' : ''}>Publicada (el alumno la ve)</option><option value="0" ${reviewPublishNow() ? '' : 'selected'}>Borrador</option></select></label></div>
     <label>Comentario para cada alumno (opcional; vacío conserva el que tenga)<textarea name="feedback" rows="2" maxlength="15000"></textarea></label>
     <label class="check-label"><input type="checkbox" name="replace" data-bulk-replace> Reemplazar también las calificaciones ya capturadas</label>
     <div class="toolbar bulk-grade-tools"><button type="button" class="secondary" data-bulk-pick="all">Todos</button><button type="button" class="secondary" data-bulk-pick="ungraded">Solo sin calificación</button><button type="button" class="secondary" data-bulk-pick="none">Ninguno</button><span class="muted" data-bulk-count></span></div>
     <div class="table-wrap keep-table bulk-grade-list"><table><thead><tr><th>Alumno</th><th>Ahora</th></tr></thead><tbody>${rows || '<tr><td colspan="2">No hay alumnos en esta vista.</td></tr>'}</tbody></table></div>`,
    async (f) => {
      const members = f.getAll('m');
      if (!members.length) throw new Error('Elige al menos un alumno.');
      const replace = f.get('replace') === 'on';
      const r = await request('/api/grades/bulk', { course: current.course.id, task: t.id, members, grade: f.get('grade'), feedback: f.get('feedback') || '', publish: f.get('publish') === '1', replace });
      const done = r.graded === 1 ? 'Se calificó a 1 alumno' : `Se calificó a ${r.graded} alumnos`;
      return r.skipped ? `${done}; ${r.skipped} ya ${r.skipped === 1 ? 'tenía' : 'tenían'} calificación${replace ? ' igual' : ' (no se reemplazó)'}.` : `${done}.`;
    },
    'Calificar',
  );
  bulkGradeCount();
}

function bulkGradeCount() {
  const boxes = [...document.querySelectorAll('#fields input[name="m"]')];
  const chosen = boxes.filter((b) => b.checked);
  const replace = document.querySelector('#fields [data-bulk-replace]')?.checked;
  const kept = replace ? 0 : chosen.filter((b) => b.dataset.graded === '1').length;
  const out = document.querySelector('#fields [data-bulk-count]');
  if (out) out.textContent = `${chosen.length} de ${boxes.length} elegidos${kept ? ` · ${kept} ya ${kept === 1 ? 'tiene' : 'tienen'} calificación y no se ${kept === 1 ? 'cambiará' : 'cambiarán'}` : ''}`;
}

document.addEventListener('click', (e) => {
  const pick = e.target.closest('[data-bulk-pick]');
  if (!pick) return;
  for (const box of document.querySelectorAll('#fields input[name="m"]')) box.checked = pick.dataset.bulkPick === 'all' || (pick.dataset.bulkPick === 'ungraded' && box.dataset.graded === '0');
  bulkGradeCount();
});
document.addEventListener('change', (e) => {
  if (e.target.closest?.('#fields') && (e.target.name === 'm' || e.target.matches('[data-bulk-replace]'))) bulkGradeCount();
});

/** Casilla del mismo rubro en otra fila visible (Enter baja, Mayús+Enter sube). */
function nextCategoryGradeInput(input, step) {
  const all = [...document.querySelectorAll(`.category-grade-input[data-cg-category="${CSS.escape(input.dataset.cgCategory)}"]`)].filter((x) => !x.closest('tr')?.hidden);
  return all[all.indexOf(input) + step] || null;
}

function gradebookStatsModal(taskId) {
  const t = find(taskId);
  const students = studentsInView().filter((m) => itemApplies(t, m));
  const subs = students.map((m) => gradeOf(m.id, t.id));
  const grades = subs.map((s) => s?.data.grade).filter((g) => g !== null && g !== undefined).map(Number).sort((a, b) => a - b);
  const sent = subs.filter((s) => s && !s.data.manual && s.data.submitted).length;
  const mean = grades.length ? grades.reduce((a, b) => a + b, 0) / grades.length : null;
  const median = grades.length ? (grades.length % 2 ? grades[(grades.length - 1) / 2] : (grades[grades.length / 2 - 1] + grades[grades.length / 2]) / 2) : null;
  const passing = gradingSettings().final.passing;
  const bins = [
    ['Menos de 6', (g) => g < 6],
    ['6 a 6.9', (g) => g >= 6 && g < 7],
    ['7 a 7.9', (g) => g >= 7 && g < 8],
    ['8 a 8.9', (g) => g >= 8 && g < 9],
    ['9 a 10', (g) => g >= 9],
  ];
  const f = (x) => (x === null ? '—' : x.toFixed(2));
  modal(
    `Estadísticas: ${t.data.title}`,
    `<div class="stat-summary"><div><b>${grades.length} de ${students.length}</b><span>calificados</span></div><div><b>${sent}</b><span>entregaron en línea</span></div><div><b>${f(mean)}</b><span>promedio</span></div><div><b>${f(median)}</b><span>mediana</span></div><div><b>${grades.length ? `${f(grades[0])} – ${f(grades.at(-1))}` : '—'}</b><span>mínima y máxima</span></div><div><b>${grades.filter((g) => g >= passing).length}</b><span>aprobados (≥ ${passing})</span></div></div>
     <div class="stat-bars">${bins
       .map(([label, test]) => {
         const n = grades.filter(test).length;
         const share = grades.length ? n / grades.length : 0;
         return `<div class="stat-bar"><span class="stat-bar-label">${label}</span><span class="stat-bar-track" aria-hidden="true"><span class="stat-bar-fill" style="width:${Math.round(share * 100)}%"></span></span><span class="stat-bar-value">${n} · ${Math.round(share * 100)} %</span></div>`;
       })
       .join('')}</div>${courseSections().length ? '<p class="muted">Cuentan los alumnos de las secciones elegidas en el filtro.</p>' : ''}`,
    null,
  );
}

document.addEventListener('keydown', (e) => {
  if (!e.target.matches?.('.gb-input') || e.key !== 'Enter') return;
  e.preventDefault();
  const input = e.target;
  const next = nextGradebookInput(input, e.shiftKey ? -1 : 1);
  saveGradebookCell(input).then((ok) => {
    if (!ok) return;
    const target = next && document.querySelector(`.gb-input[data-gb-task="${CSS.escape(next.dataset.gbTask)}"][data-gb-member="${CSS.escape(next.dataset.gbMember)}"]`);
    target?.focus();
    target?.select?.();
  });
});
document.addEventListener('change', (e) => {
  if (e.target.matches?.('.gb-input')) saveGradebookCell(e.target);
});
document.addEventListener('keydown', (e) => {
  if (!e.target.matches?.('.category-grade-input') || e.key !== 'Enter') return;
  e.preventDefault();
  const input = e.target;
  const next = nextCategoryGradeInput(input, e.shiftKey ? -1 : 1);
  saveCategoryGradeInput(input).then((ok) => {
    if (!ok || !next) return;
    const target = document.querySelector(`.category-grade-input[data-cg-category="${CSS.escape(next.dataset.cgCategory)}"][data-cg-member="${CSS.escape(next.dataset.cgMember)}"]`);
    target?.focus();
    target?.select?.();
  });
});
document.addEventListener('change', (e) => {
  if (e.target.matches?.('.category-grade-input')) saveCategoryGradeInput(e.target);
});
document.addEventListener('click', (e) => {
  const enter = e.target.closest('[data-gb-enter]');
  const stats = e.target.closest('[data-gb-stats]');
  const bulk = e.target.closest('[data-gb-bulk]');
  const move = e.target.closest('[data-gb-move]');
  if (enter || stats || bulk || move) e.target.closest('details')?.removeAttribute('open');
  if (bulk) return bulkGradeModal(bulk.dataset.gbBulk);
  if (stats) return gradebookStatsModal(stats.dataset.gbStats);
  if (move) return moveGradebookColumn(move.dataset.gbMove, move.dataset.gbTarget, Boolean(move.dataset.gbAfter));
  if (enter) {
    const first = document.querySelector(`.gb-input[data-gb-task="${CSS.escape(enter.dataset.gbEnter)}"]`);
    first?.scrollIntoView({ block: 'center', inline: 'center' });
    first?.focus({ preventScroll: true });
    return;
  }
  // Cerrar el menú de columna al tocar fuera.
  for (const open of document.querySelectorAll('.gb-col-menu[open]')) if (!open.contains(e.target)) open.removeAttribute('open');
});
