/* Evaluaciones: editor (opción múltiple y numéricas con datos aleatorios), intentos del alumno con tiempo límite
 * y resultados para el docente. La calificación siempre la hace el servidor. */

let quizDraft = null; // preguntas del editor abierto
let quizTimer = null; // cronómetro del intento en curso
let quizLastResult = null; // resultado del último intento enviado (se muestra al volver a dibujar la pantalla)
let examMonitorTimer = null;
let examState = null; // examen en curso: posición, respuestas, salidas de la pantalla por enviar
let quizEditorMode = 'quiz'; // el editor de preguntas también se usa para el banco ('bank': sin grupo)
let quizDrawCounts = new Map(); // editor: grupo → cuántas preguntas recibe cada alumno

const QUIZ_LETTERS = 'ABCDEF';
const QUIZ_MAX_QUESTIONS = 300; // igual que MAX_QUESTIONS en el servidor (12.27)
const quizSettings = (q) => ({ attempts: 1, timeLimit: 0, shuffle: false, exam: null, ...(q?.data.settings || {}) });
const EXAM_RADII = [100, 150, 300, 500];

function quizSettingsText(settings) {
  const parts = [settings.attempts === 1 ? 'Un intento' : `${settings.attempts} intentos (cuenta el mejor)`];
  parts.push(settings.timeLimit ? `${settings.timeLimit} minutos por intento` : 'sin tiempo límite');
  if (settings.shuffle) parts.push('preguntas en orden aleatorio');
  if (settings.draw?.length) parts.push('preguntas sorteadas para cada alumno');
  if (settings.opensAt || settings.closesAt)
    parts.push([settings.opensAt ? `abre ${fmt(settings.opensAt)}` : '', settings.closesAt ? `cierra ${fmt(settings.closesAt)}` : ''].filter(Boolean).join(', '));
  if (settings.timerMode === 'fixed') parts.push('el tiempo corre desde la hora de inicio');
  if (settings.results?.releaseAt && Date.parse(settings.results.releaseAt) > Date.now()) parts.push(`resultados a partir del ${fmt(settings.results.releaseAt)}`);
  if (settings.exam?.enabled) parts.push(`modo examen${settings.exam.oneByOne ? (settings.exam.noBack ? ', una pregunta a la vez sin regresar' : ', una pregunta a la vez') : ''}`);
  if (settings.perPage && !settings.exam?.oneByOne) parts.push(`${settings.perPage} ${settings.perPage === 1 ? 'pregunta' : 'preguntas'} por página`);
  if (settings.seb || settings.needsSeb) parts.push('solo en Safe Exam Browser');
  return parts.join(' · ');
}

/** Lo que el alumno ve en la lista: su mejor resultado o que está pendiente (y si es en modo examen). */
function quizStudentStatus(q) {
  const settings = quizSettings(q);
  const attempts = records('attempt').filter((a) => a.data.quiz === q.id);
  if (attempts.length) {
    const scores = attempts.map((a) => a.data.score).filter((x) => x !== null && x !== undefined);
    const left = settings.attempts - attempts.length;
    const more = left > 0 ? ` · ${left === 1 ? 'queda 1 intento' : `quedan ${left} intentos`}` : '';
    return scores.length ? `${Math.max(...scores).toFixed(2)} / 10${more}` : `Enviada · calificación pendiente${more}`;
  }
  if (settings.opensAt && Date.parse(settings.opensAt) > Date.now()) return `Abre ${fmt(settings.opensAt)}`;
  if (settings.closesAt && Date.parse(settings.closesAt) < Date.now()) return 'Cerrada';
  return settings.exam?.enabled ? 'Pendiente · modo examen' : 'Pendiente';
}

// ---- Editor ---------------------------------------------------------------------------------------

/** Cuántas preguntas recibe cada alumno (con preguntas al azar, menos que las de la evaluación). */
function questionCountOf(data) {
  if (Number.isInteger(data.questionCount)) return data.questionCount;
  let n = data.questions.length;
  for (const { pool, count } of data.settings?.draw || []) n -= data.questions.filter((q) => q?.pool === pool).length - count;
  return n;
}

/** Mensaje para el alumno cuando aún no puede ver su calificación. */
const pendingReviewText = (n) => `${n === 1 ? 'Falta que tu docente califique 1 respuesta escrita' : `Faltan ${n} respuestas escritas por calificar`} (mientras tanto cuentan 0)`;
/** Comentarios del docente en las preguntas de un intento (respuestas escritas o ajustes). */
function feedbackListHtml(a, q) {
  const notes = (a.data.details || a.data.feedback || []).filter((d) => d.feedback);
  if (!notes.length) return '';
  return `<ul class="quiz-feedback">${notes
    .map((d) => `<li><b>${esc((q.data.questions[d.index]?.text || 'Pregunta').slice(0, 120))}</b> · ${Math.round((d.credit ?? 0) * 100)} %<br>${esc(d.feedback)}</li>`)
    .join('')}</ul>`;
}
const pendingResultText = (data) => (data?.releaseAt ? `Verás tu resultado a partir del ${fmt(data.releaseAt)}` : 'Tu docente publicará la calificación.');

const poolTag = (x) => (x.pool ? ` <span class="quiz-pool-tag">${esc(x.pool)}</span>` : '');
/** Valor de la pregunta (solo si no es 1 punto). */
const pointsTag = (x) => (x?.points && x.points !== 1 ? ` <span class="quiz-points-tag">${x.points} pts</span>` : '');
/** Retroalimentación escrita por el docente (vista del docente). */
function teacherFeedbackHtml(x) {
  const letters = x.type === 'multi' ? MULTI_LETTERS : QUIZ_LETTERS;
  const notes = (x.optionFeedback || []).map((n, k) => (n ? `<li><b>${letters[k]}:</b> ${esc(n)}</li>` : '')).join('');
  if (!x.explanation && !notes && !x.hint) return '';
  return `<div class="quiz-explanation">${x.hint ? `<p><b>Pista:</b> ${esc(x.hint)}</p>` : ''}${x.explanation ? `<p><b>Retroalimentación:</b> ${esc(x.explanation)}</p>` : ''}${notes ? `<ul>${notes}</ul>` : ''}</div>`;
}
/** Revisión de un intento para el alumno: ✓/✗ por pregunta con la retroalimentación del docente (12.23). */
function attemptReviewHtml(a, q, texts) {
  return `<ul class="quiz-detail">${(a.data.details || [])
    .map((d) => {
      const mark = creditMark(d);
      const question = q.data.questions[d.index];
      const text = texts?.[d.index] ?? (question?.text || '').replace(/\{([A-Za-z_]\w*)\}/g, (m, name) => d.values?.[name] ?? m);
      const notes = [d.explanation, ...(d.optionNotes || [])].filter(Boolean);
      return `<li class="${mark.cls}">${mark.icon} ${esc(question?.type === 'fill' ? String(text).replace(/\[\[[^\]]*\]\]/g, '___') : text)}${mark.note}${pointsTag(question)}${
        notes.length ? `<div class="quiz-explanation">${notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>` : ''
      }${d.feedback ? `<div class="quiz-explanation is-teacher"><p><b>Comentario de tu docente:</b> ${esc(d.feedback)}</p></div>` : ''}</li>`;
    })
    .join('')}</ul>`;
}

/** Imagen de una pregunta (se sirve con la misma revisión de permisos que cualquier archivo del curso). */
const quizImageHtml = (id, n) => (id ? `<img class="quiz-image" src="/api/file/${esc(id)}?preview=1" alt="Imagen de la pregunta ${n + 1}">` : '');

function blankQuestion(type = 'choice') {
  if (isNewType(type)) return blankNewQuestion(type);
  return type === 'numeric'
    ? { type, text: '', answer: '', tolerance: 1, unit: '', variables: [] }
    : { type: 'choice', text: '', options: ['', ''], correct: 0 };
}

/** Respuesta con fórmula y datos aleatorios («Aritmética»; también la usa «Cifras significativas»). */
function numericBodyHtml(q) {
  return `<div class="quiz-numeric">
        <div class="quiz-grid">
          <label>Respuesta (número o fórmula)<input data-f="answer" value="${esc(q.answer)}" required placeholder="Por ejemplo: sqrt(2*h/g)"></label>
          <label>Tolerancia (%)<input data-f="tolerance" type="number" min="0" max="50" step="0.1" value="${esc(q.tolerance)}"></label>
          <label>Unidad (opcional)<input data-f="unit" value="${esc(q.unit)}" maxlength="30" placeholder="m/s"></label>
        </div>
        <p class="muted">Fórmulas con + − * / ^, paréntesis, sqrt, sin, cos, tan, ln, log, abs y las constantes pi, e y g (9.81).</p>
        <div class="quiz-vars">${(q.variables || [])
          .map(
            (v, k) => `<div class="quiz-var" data-var="${k}">
              <label>Variable<input data-v="name" value="${esc(v.name)}" required maxlength="16" placeholder="h"></label>
              <label>Mínimo<input data-v="min" type="number" step="any" value="${esc(v.min)}" required></label>
              <label>Máximo<input data-v="max" type="number" step="any" value="${esc(v.max)}" required></label>
              <label>Decimales<input data-v="decimals" type="number" min="0" max="4" value="${esc(v.decimals ?? 0)}"></label>
              <button type="button" class="danger-link" data-quiz="remove-var" data-var-index="${k}" aria-label="Quitar variable">Quitar</button></div>`,
          )
          .join('')}</div>
        <button type="button" class="text-btn" data-quiz="add-var">＋ Dato aleatorio</button>
        <p class="muted">Cada alumno recibe valores distintos. Escríbelos en el enunciado entre llaves: "Un objeto cae desde {h} m".</p>
      </div>`;
}

function quizQuestionHtml(q, i) {
  const numeric = q.type === 'numeric';
  const body = isNewType(q.type)
    ? newQuestionBodyHtml(q, i, q.type === 'sigfig' ? numericBodyHtml(q) : '')
    : numeric
    ? numericBodyHtml(q)
    : `<div class="quiz-options">${q.options
        .map(
          (o, k) => `<div class="quiz-option"><input type="radio" name="correct_${i}" value="${k}" ${q.correct === k ? 'checked' : ''} aria-label="Respuesta correcta ${QUIZ_LETTERS[k]}">
            <span class="quiz-letter">${QUIZ_LETTERS[k]}</span><input data-o="${k}" value="${esc(o)}" required maxlength="1500" placeholder="Opción ${QUIZ_LETTERS[k]}">
            ${q.options.length > 2 ? `<button type="button" class="danger-link" data-quiz="remove-option" data-option="${k}" aria-label="Quitar opción ${QUIZ_LETTERS[k]}">×</button>` : ''}</div>`,
        )
        .join('')}</div>
      ${q.options.length < 6 ? '<button type="button" class="text-btn" data-quiz="add-option">＋ Opción</button>' : ''}
      <p class="muted">Marca con el círculo la respuesta correcta.</p>${choiceWeightsHtml(q)}`;
  return `<fieldset class="quiz-edit-question" data-question="${i}">
    <legend>Pregunta ${i + 1}</legend>
    <div class="quiz-question-head">
      <label>Tipo<select data-f="type">${QUESTION_TYPES.map(([value, label]) => `<option value="${value}" ${(q.type || 'choice') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="quiz-points-field">Puntos<input data-f="points" type="number" min="0.1" max="100" step="0.1" value="${esc(q.points ?? 1)}" aria-label="Puntos de la pregunta ${i + 1}"></label>
      ${quizEditorMode === 'quiz' ? `<label>Grupo para sortear (opcional)<input data-f="pool" list="quizPools" maxlength="80" value="${esc(q.pool || '')}" placeholder="Por ejemplo: Cinemática"></label>` : ''}
      ${quizDraft.length > 1 ? `<button type="button" class="danger-link" data-quiz="remove-question">Quitar pregunta</button>` : ''}
    </div>
    <label>Enunciado<textarea data-f="text" required maxlength="3000">${esc(q.text)}</textarea></label>
    <p class="muted quiz-text-hint">Puedes escribir fórmulas entre signos de pesos: $v = v_0 + a t$.</p>
    <div class="quiz-image-edit"><input type="hidden" data-f="image" value="${esc(q.image || '')}">${
      q.image
        ? `<img class="quiz-image" src="/api/file/${esc(q.image)}?preview=1${quizEditorMode === 'bank' ? '&bank=1' : ''}" alt="Imagen de la pregunta ${i + 1}"><button type="button" class="danger-link" data-quiz="remove-image">Quitar imagen</button>`
        : `<label class="secondary quiz-image-add">＋ Imagen (diagrama, gráfica, foto)<input type="file" accept="image/*" data-quiz-image hidden></label>`
    }</div>
    ${body}
    ${questionFeedbackHtml(q)}
  </fieldset>`;
}

/** Crédito parcial por opción (12.27, como en Brightspace): elegir otra opción puede valer una parte de la pregunta. */
function choiceWeightsHtml(q) {
  const weights = q.weights || [];
  const open = q.options.some((_, k) => k !== q.correct && weights[k] > 0);
  return `<details class="quiz-weights" ${open ? 'open' : ''}><summary>Crédito parcial por opción (opcional)</summary>
    <div class="quiz-option-notes">${q.options
      .map((o, k) => `<label>${QUIZ_LETTERS[k]}${o ? ` (${esc(o.slice(0, 40))}${o.length > 40 ? '…' : ''})` : ''}<input data-w="${k}" type="number" min="0" max="100" step="1" value="${esc(k === q.correct ? 100 : weights[k] || 0)}" ${k === q.correct ? 'disabled' : ''} aria-label="Crédito de la opción ${QUIZ_LETTERS[k]} (%)"></label>`)
      .join('')}</div>
    <p class="muted">% de la pregunta que gana quien elige esa opción. La correcta siempre vale 100 %.</p></details>`;
}

/** Retroalimentación (12.23): la ve el alumno al revisar su intento, si la evaluación muestra qué preguntas acertó. */
function questionFeedbackHtml(q) {
  const options = (q.type || 'choice') === 'choice' || q.type === 'multi' ? q.options || [] : [];
  const letters = q.type === 'multi' ? MULTI_LETTERS : QUIZ_LETTERS;
  const notes = q.optionFeedback || [];
  const open = q.explanation || q.hint || notes.some(Boolean);
  return `<details class="quiz-feedback-edit" ${open ? 'open' : ''}><summary>Retroalimentación para el alumno${open ? '' : ' (opcional)'}</summary>
    <label>Explicación de la pregunta (la ve el alumno al revisar su intento, si activas «Qué preguntas acertó»)<textarea data-f="explanation" rows="2" maxlength="3000" placeholder="Por ejemplo: se usa la segunda ley de Newton, F = m a.">${esc(q.explanation || '')}</textarea></label>
    <label>Pista (opcional; el alumno la puede abrir mientras contesta)<input data-f="hint" maxlength="1000" value="${esc(q.hint || '')}" placeholder="Por ejemplo: recuerda que Z es el número de protones."></label>
    ${options.length ? `<div class="quiz-option-notes">${options.map((o, k) => `<label>Si elige ${letters[k]}${o ? ` (${esc(o.slice(0, 40))}${o.length > 40 ? '…' : ''})` : ''}<input data-ofb="${k}" maxlength="1000" value="${esc(notes[k] || '')}" placeholder="Comentario para esta opción (opcional)"></label>`).join('')}</div>` : ''}
  </details>`;
}

/** Lee del formulario el estado actual de las preguntas. */
function readQuizQuestions() {
  return [...document.querySelectorAll('#quizQuestions [data-question]')].map((box, i) => {
    const get = (f) => box.querySelector(`[data-f="${f}"]`)?.value ?? '';
    const image = get('image') ? { image: get('image') } : {};
    if (get('pool').trim()) image.pool = get('pool').trim();
    const readNumeric = () => ({
        answer: get('answer'),
        tolerance: Number(get('tolerance') || 0),
        unit: get('unit'),
        variables: [...box.querySelectorAll('[data-var]')].map((row) => ({
          name: row.querySelector('[data-v="name"]').value.trim(),
          min: Number(row.querySelector('[data-v="min"]').value),
          max: Number(row.querySelector('[data-v="max"]').value),
          decimals: Number(row.querySelector('[data-v="decimals"]').value || 0),
        })),
    });
    const type = get('type') || 'choice';
    // Puntos y retroalimentación (12.23): 1 punto no se guarda; los comentarios por opción solo si hay alguno.
    const points = Number(get('points') || 1);
    if (points !== 1) image.points = points;
    if (get('explanation').trim()) image.explanation = get('explanation').trim();
    if (get('hint').trim()) image.hint = get('hint').trim();
    const notes = [...box.querySelectorAll('[data-ofb]')].map((input) => input.value.trim());
    if (notes.some(Boolean)) image.optionFeedback = notes;
    if (isNewType(type)) return { ...image, type, text: get('text'), ...readNewQuestionBody(box, type, i, readNumeric) };
    if (type === 'numeric') return { ...image, type: 'numeric', text: get('text'), ...readNumeric() };
    const options = [...box.querySelectorAll('[data-o]')].map((input) => input.value);
    const checked = box.querySelector(`input[name="correct_${i}"]:checked`);
    const correct = checked ? Number(checked.value) : -1;
    const weights = options.map((_, k) => (k === correct ? 100 : Number(box.querySelector(`[data-w="${k}"]`)?.value || 0)));
    const partial = weights.some((w, k) => k !== correct && w > 0);
    return { type: 'choice', text: get('text'), options, correct, ...(partial ? { weights } : {}), ...image };
  });
}

/**
 * Enunciado para el docente (12.36): los datos por alumno ({F}, {m}) se ven como variables, no como llaves sueltas;
 * las fórmulas LaTeX ($…$) las sigue dibujando KaTeX como en la vista del alumno.
 */
function teacherQuestionText(x) {
  const names = new Set((x.variables || []).map((v) => v.name));
  return esc(x.text).replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (all, name) => (names.has(name) ? `<var class="qvar" title="Dato distinto para cada alumno">${name}</var>` : all));
}

/** La respuesta numérica como fórmula, con los datos por alumno resaltados igual que en el enunciado. */
function teacherFormula(x) {
  const names = new Set((x.variables || []).map((v) => v.name));
  return esc(x.answer).replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (name) => (names.has(name) ? `<var class="qvar">${name}</var>` : name));
}

function renderQuizQuestions() {
  $('#quizQuestions').innerHTML = quizDraft.map(quizQuestionHtml).join('');
  renderQuizDraw();
}

/** Puntos que recibe cada alumno: las preguntas sin grupo más, por cada grupo, las que se sortean por su valor (12.27). */
function quizTotalPoints(questions, counts) {
  const byPool = new Map();
  let total = 0;
  for (const q of questions) {
    const pool = q.pool?.trim();
    if (!pool) total += q.points || 1;
    else (byPool.get(pool) || byPool.set(pool, []).get(pool)).push(q.points || 1);
  }
  let exact = true;
  for (const [pool, points] of byPool) {
    const count = Math.min(Math.max(counts.get(pool) || points.length, 1), points.length);
    if (new Set(points).size > 1 && count < points.length) exact = false;
    total += count === points.length ? points.reduce((a, b) => a + b, 0) : (count * points.reduce((a, b) => a + b, 0)) / points.length;
  }
  return { total: Math.round(total * 100) / 100, exact };
}

/** Preguntas al azar: por cada grupo escrito en las preguntas, cuántas recibe cada alumno y cuánto vale cada una. */
function renderQuizDraw() {
  const box = document.getElementById('quizDrawBox');
  if (!box) return;
  for (const input of box.querySelectorAll('[data-draw-pool]')) quizDrawCounts.set(input.dataset.drawPool, Number(input.value));
  const sizes = new Map();
  for (const q of quizDraft) if (q.pool?.trim()) sizes.set(q.pool.trim(), (sizes.get(q.pool.trim()) || 0) + 1);
  const pools = document.getElementById('quizPools');
  if (pools) pools.innerHTML = [...sizes.keys()].map((p) => `<option value="${esc(p)}">`).join('');
  const points = quizTotalPoints(quizDraft, quizDrawCounts);
  const totalLine = `<p class="quiz-total"><b>Total: ${points.exact ? '' : 'aprox. '}${points.total} ${points.total === 1 ? 'punto' : 'puntos'}</b> por alumno${points.exact ? '' : ' (en un grupo las preguntas valen distinto)'}. La calificación se lleva a la escala de 0 a 10.</p>`;
  if (!sizes.size) {
    box.innerHTML = `<legend>Preguntas al azar</legend>${totalLine}<p class="muted">Para que cada alumno reciba preguntas distintas, escribe el mismo grupo en varias preguntas (por ejemplo «Cinemática») y aquí eliges cuántas recibe de cada grupo. Las preguntas del banco llegan con su tema como grupo.</p>`;
    return;
  }
  let total = quizDraft.length;
  const poolPoints = (pool) => {
    const values = new Set(quizDraft.filter((q) => q.pool?.trim() === pool).map((q) => q.points || 1));
    return values.size === 1 ? [...values][0] : '';
  };
  const rows = [...sizes].map(([pool, size]) => {
    const count = Math.min(Math.max(quizDrawCounts.get(pool) || size, 1), size);
    total -= size - count;
    return `<div class="draw-row"><span class="draw-pool">«${esc(pool)}»</span>
      <span class="draw-field">recibe <input type="number" data-draw-pool="${esc(pool)}" min="1" max="${size}" value="${count}" aria-label="Preguntas de ${esc(pool)} para cada alumno"> de ${size}</span>
      <span class="draw-field">de <input type="number" data-draw-points="${esc(pool)}" min="0.1" max="100" step="0.1" value="${esc(poolPoints(pool))}" placeholder="varios" aria-label="Puntos por pregunta de ${esc(pool)}"> ${poolPoints(pool) === 1 ? 'punto' : 'puntos'} c/u</span></div>`;
  });
  box.innerHTML = `<legend>Preguntas al azar</legend>${rows.join('')}
    <div class="draw-row draw-all"><span class="draw-pool">A todos los grupos</span>
      <span class="draw-field">recibe <input type="number" data-draw-all-count min="1" max="100" placeholder="n" aria-label="Preguntas de cada grupo"></span>
      <span class="draw-field">de <input type="number" data-draw-all-points min="0.1" max="100" step="0.1" placeholder="1" aria-label="Puntos por pregunta de todos los grupos"> c/u</span>
      <button type="button" class="secondary" data-draw-apply>Aplicar</button></div>
    ${totalLine}<p class="muted">Cada alumno recibe <b>${total} de ${quizDraft.length}</b> preguntas; las que no tienen grupo le tocan a todos. En cada intento se sortean otra vez.</p>`;
}

/** Puntos de todas las preguntas de un grupo (12.27; «puntos por pregunta» del grupo, como en Brightspace). */
function setPoolPoints(pool, value) {
  const points = Math.round(Number(value) * 100) / 100;
  if (!(points >= 0.1 && points <= 100)) return;
  quizDraft = readQuizQuestions();
  for (const q of quizDraft) {
    if (q.pool?.trim() !== pool) continue;
    if (points === 1) delete q.points;
    else q.points = points;
  }
  renderQuizQuestions();
  dirty = true;
}

document.addEventListener('change', (e) => {
  if (e.target.matches('#quizQuestions [data-f="pool"]')) {
    quizDraft = readQuizQuestions();
    renderQuizDraw();
  }
  if (e.target.matches('#quizDrawBox [data-draw-pool]')) renderQuizDraw();
  if (e.target.matches('#quizDrawBox [data-draw-points]')) setPoolPoints(e.target.dataset.drawPoints, e.target.value);
  if (e.target.matches('#quizQuestions [data-f="points"]')) {
    quizDraft = readQuizQuestions();
    renderQuizDraw();
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#quizDrawBox [data-draw-apply]')) return;
  const box = document.getElementById('quizDrawBox');
  const count = Number(box.querySelector('[data-draw-all-count]').value);
  const points = Number(box.querySelector('[data-draw-all-points]').value);
  if (Number.isInteger(count) && count >= 1) for (const input of box.querySelectorAll('[data-draw-pool]')) input.value = Math.min(count, Number(input.max));
  renderQuizDraw();
  if (points) {
    quizDraft = readQuizQuestions();
    for (const q of quizDraft) {
      if (!q.pool?.trim()) continue;
      if (Math.round(points * 100) / 100 === 1) delete q.points;
      else q.points = Math.round(points * 100) / 100;
    }
    renderQuizQuestions();
  }
  dirty = true;
});

/** ¿Cuenta en la calificación? Solo con categorías: la evaluación entra a una categoría con su valor en puntos. */
function quizGradeHtml(grade) {
  const settings = gradingSettings();
  const cats = settings.scheme === 'categories' ? settings.categories.filter((c) => c.source !== 'attendance') : [];
  if (!cats.length) {
    return `<fieldset class="quiz-settings"><legend>Calificación</legend><p class="muted">Para que esta evaluación cuente en el promedio, organiza la calificación del curso por categorías (Calificaciones → Administrar calificaciones). Mientras tanto, sus resultados se ven aquí y en «Mis calificaciones» sin sumarse.</p></fieldset>`;
  }
  const policy = grade?.policy || 'best';
  return `<fieldset class="quiz-settings"><legend>Calificación</legend><div class="quiz-grid">
    <label>Cuenta en la calificación<select name="gradeCategory">${gradebookCategoryOptions(grade?.category, 'No cuenta (solo práctica)')}</select></label>
    <label>Valor dentro de la categoría (puntos)<input name="gradePoints" type="number" min="0.1" max="1000" step="0.1" value="${esc(grade?.points ?? 10)}"></label>
    <label>Con varios intentos, cuenta<select name="gradePolicy">${Object.entries(QUIZ_POLICIES)
      .map(([k, v]) => `<option value="${k}" ${policy === k ? 'selected' : ''}>${v}</option>`)
      .join('')}</select></label></div>
    <p class="muted">Vale lo mismo que una actividad con esos puntos en su categoría. Si un alumno no la contesta, no cuenta (no se toma como cero).</p></fieldset>`;
}

function quizModal(old) {
  // Las evaluaciones nuevas nacen con preguntas y opciones mezcladas; el docente puede desmarcarlo si necesita orden fijo.
  const settings = old ? quizSettings(old) : { ...quizSettings(old), shuffle: true, shuffleOptions: true };
  quizEditorMode = 'quiz';
  quizDrawCounts = new Map((settings.draw || []).map((d) => [d.pool, d.count]));
  quizDraft = old ? structuredClone(old.data.questions).map((q) => (q.type ? q : { ...q, type: 'choice' })) : [blankQuestion()];
  modal(
    old ? 'Editar evaluación' : 'Nueva evaluación',
    field('Título', 'title', old?.data.title || '', 'text', 'required') +
      richTextarea('Instrucciones', 'body', old?.data.body || '') +
      quizSectionsHtml(old) +
      `<fieldset class="quiz-settings"><legend>Configuración</legend><div class="quiz-grid">
        <label>Intentos por alumno<input name="attempts" type="number" min="1" max="10" value="${settings.attempts}"></label>
        <label>Tiempo límite (minutos, 0 = sin límite)<input name="timeLimit" type="number" min="0" max="300" value="${settings.timeLimit}"></label>
        <label>Preguntas por página (0 = todas en una página)<input name="perPage" type="number" min="0" max="50" value="${settings.perPage || 0}"></label>
      </div><label class="check-label"><input type="checkbox" name="shuffle" ${settings.shuffle ? 'checked' : ''}> Presentar las preguntas en orden aleatorio a cada alumno</label>
      <label class="check-label"><input type="checkbox" name="shuffleOptions" ${settings.shuffleOptions ? 'checked' : ''}> También el orden de las opciones de cada pregunta (distinto para cada alumno)</label></fieldset>
      <fieldset class="quiz-settings"><legend>Fechas y disponibilidad</legend><div class="quiz-grid">
        <label>Fecha de inicio (opcional)<input name="opensAt" type="datetime-local" value="${esc(localDate(settings.opensAt))}"></label>
        <label>Fecha final (opcional)<input name="closesAt" type="datetime-local" value="${esc(localDate(settings.closesAt))}"></label></div>
        <label class="check-label"><input type="checkbox" name="timerFixed" ${settings.timerMode === 'fixed' ? 'checked' : ''}> El tiempo empieza a la hora de inicio, igual para todos: todos terminan a la misma hora (inicio + tiempo límite) y quien entra tarde tiene menos tiempo. Úsalo solo si todo el grupo presenta a la misma hora.</label>
        <p class="muted">Antes del inicio no se puede empezar; en la fecha final termina todo lo que esté en curso y se califica lo que cada alumno dejó guardado.</p>
        ${courseSections().length ? '<p class="muted">El horario de cada sección está arriba, en «Secciones y horarios».</p>' : ''}</fieldset>
      <fieldset class="quiz-settings"><legend>Qué ve el alumno al terminar</legend>
        <label class="check-label"><input type="checkbox" name="showScore" ${settings.results?.score !== false ? 'checked' : ''}> Su calificación (si lo desmarcas, ve «pendiente» hasta que lo actives)</label>
        <label class="check-label"><input type="checkbox" name="showReview" ${old && settings.results?.review !== 'none' ? 'checked' : ''}> Qué preguntas acertó (ve los enunciados que le tocaron con ✓ y ✗, sin las respuestas correctas)</label>
        <label>Mostrar resultados a partir de (opcional)<input name="releaseAt" type="datetime-local" value="${esc(localDate(settings.results?.releaseAt))}"></label>
        <p class="muted">Si otros grupos aún no presentan, desmarca «Qué preguntas acertó» o pon aquí la fecha y hora en que termina el último grupo: hasta entonces nadie ve su calificación ni sus aciertos, y después se muestran solos.</p></fieldset>` +
      examSettingsHtml(settings.exam) +
      sebSettingsHtml(settings.seb) +
      quizGradeHtml(old?.data.grade) +
      visible(old?.data.visible ?? false, old?.data.publishAt || '', [], false) +
      conditionsEditorHtml(old) +
      `<div id="quizQuestions"></div><datalist id="quizPools"></datalist>
       <div class="quiz-add-row"><button type="button" class="secondary" data-quiz="add-question">＋ Agregar pregunta</button>${bankPickerHtml()}${quizImportHtml()}</div>
       <fieldset class="quiz-settings" id="quizDrawBox"></fieldset>
       <p class="pending-message">Con respuestas recibidas solo puedes corregir las respuestas correctas, los puntos y la retroalimentación: al guardar, se vuelven a calificar todos los intentos. Las preguntas, opciones y preguntas al azar ya no cambian.</p>` +
      (old ? `<p class="modal-danger">${trashButton('quiz', old.id, 'Eliminar evaluación')}</p>` : ''),
    async (f) => {
      // 12.29: con el tiempo fijo, después de «inicio + tiempo límite» ya nadie puede presentar, aunque la evaluación
      // siga abierta. Si la fecha final es posterior, casi siempre es un error de configuración: se pregunta.
      const opens = iso(f.get('opensAt'));
      const closes = iso(f.get('closesAt'));
      const limit = Number(f.get('timeLimit')) || 0;
      if (f.get('timerFixed') === 'on' && opens && limit && closes && Date.parse(closes) > Date.parse(opens) + limit * 60_000 + 60_000) {
        const end = new Date(Date.parse(opens) + limit * 60_000);
        const ok = confirm(
          `Con «El tiempo empieza a la hora de inicio», todos deben terminar a las ${end.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })} del ${end.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}, aunque la evaluación cierre después (${fmt(closes)}). Quien entre después de esa hora ya no podrá presentarla.\n\nSi cada alumno debe tener sus ${limit} minutos desde que empieza, cancela y desmarca esa casilla. ¿Guardar así?`,
        );
        if (!ok) throw new Error('Revisa «El tiempo empieza a la hora de inicio»: con esa casilla, todos terminan a la misma hora.');
      }
      const saved = await save(
        'quiz',
        {
          title: f.get('title'),
          body: f.get('body'),
          visible: f.get('visible') === 'on',
          publishAt: iso(f.get('publishAt')),
          sections: courseSections().length ? readQuizSections(f) : [],
          grade: f.get('gradeCategory') ? { category: f.get('gradeCategory'), points: Number(f.get('gradePoints')), policy: f.get('gradePolicy') } : null,
          settings: {
            attempts: Number(f.get('attempts')),
            timeLimit: Number(f.get('timeLimit')),
            shuffle: f.get('shuffle') === 'on',
            shuffleOptions: f.get('shuffleOptions') === 'on',
            draw: [...document.querySelectorAll('#quizDrawBox [data-draw-pool]')].map((input) => ({ pool: input.dataset.drawPool, count: Number(input.value) })),
            opensAt: iso(f.get('opensAt')),
            closesAt: iso(f.get('closesAt')),
            timerMode: f.get('timerFixed') === 'on' ? 'fixed' : 'attempt',
            perPage: Number(f.get('perPage') || 0),
            seb: f.get('seb') === 'on' ? { required: true, keys: String(f.get('sebKeys') || '') } : null,
            results: { score: f.get('showScore') === 'on', review: f.get('showReview') === 'on' ? 'marks' : 'none', releaseAt: iso(f.get('releaseAt')) },
            exam: readExamSettings(f),
          },
          questions: readQuizQuestions(),
        },
        old,
      );
      await saveSectionDates('quiz', saved.id, readQuizSectionDates(f));
      const regraded = saved.regraded;
      if (regraded?.checked) {
        return `Guardado. Se volvieron a calificar ${regraded.checked === 1 ? 'el intento' : `los ${regraded.checked} intentos`} con las respuestas corregidas: ${
          regraded.changed ? `cambió el resultado de ${regraded.changed}.` : 'ningún resultado cambió.'
        }`;
      }
    },
  );
  renderQuizQuestions();
}

// ---- Safe Exam Browser (12.27) ----------------------------------------------------------------

const isSafeExamBrowser = () => /\bSEB\//.test(navigator.userAgent || '');

/** Enlace para abrir la evaluación en SEB (sebs:// descarga la configuración que arma Enlace y la abre en SEB). */
const sebLink = (quizId) => `${location.protocol === 'https:' ? 'sebs' : 'seb'}://${location.host}/seb/${encodeURIComponent(quizId)}.seb`;
const SEB_DOWNLOAD = 'https://safeexambrowser.org/download_en.html';

const isAndroid = () => /Android/i.test(navigator.userAgent || '');
const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Aviso para el alumno fuera de SEB (12.30): el botón, dónde descargarlo y qué hacer en un teléfono Android. */
function sebRequiredHtml(quizId) {
  if (isAndroid()) {
    return `<div class="seb-notice warning-note" id="sebRequired"><p>Esta evaluación solo se puede presentar en <b>Safe Exam Browser</b>, que <b>no existe para Android</b>.</p>
      <p>Preséntala desde una <b>computadora</b> (Windows o Mac) o un <b>iPad o iPhone</b> con Safe Exam Browser instalado: entra a Enlace ahí, abre esta evaluación y toca «Abrir en Safe Exam Browser».</p>
      <p class="muted">Si no tienes ninguno de esos equipos, avísale a tu docente. <a href="${SEB_DOWNLOAD}" target="_blank" rel="noopener">Más información de Safe Exam Browser</a></p></div>`;
  }
  return `<div class="seb-notice warning-note" id="sebRequired"><p>Esta evaluación solo se puede presentar en <b>Safe Exam Browser</b>.</p>
    <p><a class="primary button-link" href="${esc(sebLink(quizId))}">Abrir en Safe Exam Browser</a></p>
    <p class="muted">¿No lo tienes? ${
      isIOS()
        ? '<a href="https://apps.apple.com/app/safeexambrowser/id1155002964" target="_blank" rel="noopener">Instálalo gratis desde la App Store</a>'
        : `<a href="${SEB_DOWNLOAD}" target="_blank" rel="noopener">Descárgalo gratis</a> (Windows, Mac, iPad o iPhone)`
    }, y vuelve a tocar el botón. Dentro de Safe Exam Browser entra a Enlace con tu cuenta.</p></div>`;
}

/** El servidor pidió Safe Exam Browser (al empezar, guardar o enviar): se muestra el aviso con el botón. */
function showSebRequired(quizId) {
  clearInterval(quizTimer);
  stopExam();
  attemptSave = null;
  const box = document.getElementById('quizAttemptBox') || document.getElementById('main');
  if (!box) return;
  document.querySelector('#quizAttempt')?.remove();
  document.querySelector('.exam-intro')?.remove();
  document.querySelector('[data-quiz-start]')?.remove();
  document.querySelector('[data-quiz-code]')?.remove();
  if (!document.getElementById('sebRequired')) box.insertAdjacentHTML('afterbegin', sebRequiredHtml(quizId));
  document.getElementById('sebRequired')?.scrollIntoView?.({ block: 'center' });
}

function sebSettingsHtml(seb) {
  return `<fieldset class="quiz-settings"><legend>Safe Exam Browser</legend>
    <label class="check-label"><input type="checkbox" name="seb" ${seb?.required ? 'checked' : ''}> Exigir Safe Exam Browser: solo se puede empezar, guardar y enviar desde él</label>
    <div class="seb-options" ${seb?.required ? '' : 'hidden'}>
      <p class="muted">No necesitas preparar nada: Enlace arma la configuración. Tus alumnos (con Safe Exam Browser instalado) tocan <b>«Abrir en Safe Exam Browser»</b> en la evaluación y se abre ahí directamente; desde otro navegador no pueden empezar.</p>
      <p class="warning-note"><b>Google Assistant, Gemini y dictado:</b> una página abierta en Chrome, Safari o Android no puede detectar de forma fiable estas herramientas del sistema. Para una evaluación controlada exige Safe Exam Browser y supervisión; tampoco es posible detectar otro teléfono.</p>
      <details${seb?.keys?.length ? ' open' : ''}><summary>Avanzado: aceptar también mi propio archivo .seb</summary>
        <label>Config Key de tu archivo .seb (64 caracteres, una por renglón; opcional)<textarea name="sebKeys" rows="2" spellcheck="false" autocomplete="off">${esc((seb?.keys || []).join('\n'))}</textarea></label>
      </details>
    </div></fieldset>`;
}

document.addEventListener('change', (e) => {
  if (e.target.matches('input[name="seb"]')) document.querySelector('.seb-options').hidden = !e.target.checked;
});

// ---- Configuración del modo examen (editor) ----------------------------------------------------

function examSettingsHtml(exam) {
  const place = exam?.place || null;
  return `<fieldset class="quiz-settings exam-settings"><legend>Modo examen</legend>
    <label class="check-label"><input type="checkbox" name="exam" ${exam?.enabled ? 'checked' : ''}> Activar: pantalla completa, sin copiar ni pegar, y registro de cada vez que el alumno sale de la página</label>
    <div class="exam-options" ${exam?.enabled ? '' : 'hidden'}>
      <label>Contraseña para empezar (opcional; la dictas en el salón. Si pones un código por sección, manda el de la sección)<input name="examPassword" value="${esc(exam?.password || '')}" maxlength="30" autocomplete="off" placeholder="Por ejemplo: gauss"></label>
      <label class="check-label"><input type="checkbox" name="oneByOne" ${exam?.oneByOne ? 'checked' : ''}> Una pregunta a la vez</label>
      <label class="check-label"><input type="checkbox" name="noBack" ${exam?.noBack ? 'checked' : ''}> Sin regresar a preguntas anteriores (requiere "una pregunta a la vez")</label>
      <label class="check-label"><input type="checkbox" name="lockPlatform" ${exam?.lockPlatform || !exam ? 'checked' : ''}> Bloquear el resto de Enlace mientras contesta: no puede abrir otros cursos, materiales, foros ni avisos, aunque abra otra pestaña o vuelva a iniciar sesión</label>
      <label class="check-label"><input type="checkbox" name="lockOnLeave" ${exam?.lockOnLeave ? 'checked' : ''}> Bloquear si sale de la página: para continuar necesita un código que tú le das (aparece en tu monitor del examen)</label>
      <label>Tolerancia antes de bloquear<select name="lockGrace">${[0, 5, 15, 30]
        .map((g) => `<option value="${g}" ${(exam?.lockOnLeave ? exam.lockGrace : 5) === g ? 'selected' : ''}>${g ? `${g} segundos (por ejemplo, una notificación)` : 'Ninguna: se bloquea al salir'}</option>`)
        .join('')}</select></label>
      <label>Revisar que estén en el salón<select name="examRadius"><option value="0">No revisar la ubicación</option>${EXAM_RADII.map((r) => `<option value="${r}" ${place?.radius === r ? 'selected' : ''}>A menos de ${r} m del salón</option>`).join('')}</select></label>
      <p class="exam-place-row"><button type="button" class="secondary" data-exam-place>Usar mi ubicación actual como salón</button>
        <span class="muted" id="examPlaceStatus">${place ? 'Ubicación del salón guardada.' : 'Sin ubicación del salón.'}</span></p>
      <input type="hidden" name="examPlace" value="${esc(place ? JSON.stringify({ lat: place.lat, lng: place.lng, accuracy: place.accuracy }) : '')}">
      <p class="muted">Para revisar la ubicación, pulsa el botón estando en el salón (por ejemplo, al empezar la clase) y guarda. Nunca impide el examen: quien esté lejos o no dé permiso aparece marcado en los resultados. Ninguna página web puede bloquear otras aplicaciones; el modo examen deja constancia y disuade.</p>
      <div class="warning-note"><b>Protección contra asistentes e IA.</b> Para reducir Google/Gemini, usa una pregunta aleatoria a la vez, sin regresar, y exige Safe Exam Browser. La siguiente pregunta aparece en esta misma pantalla, sin abrir otra página.
        <p><button type="button" class="secondary" data-exam-harden>Aplicar configuración reforzada</button></p>
        <small>Actívala antes de que alguien comience: después de recibir intentos ya no se puede cambiar el sorteo de preguntas.</small></div>
    </div></fieldset>`;
}

/** Activa en el editor las defensas compatibles entre sí; el docente todavía decide si guarda. */
function hardenExamSettings() {
  for (const name of ['exam', 'oneByOne', 'noBack', 'lockPlatform', 'lockOnLeave', 'shuffle', 'shuffleOptions', 'seb']) {
    const input = document.querySelector(`input[name="${name}"]`);
    if (input) input.checked = true;
  }
  const grace = document.querySelector('select[name="lockGrace"]');
  if (grace) grace.value = '5';
  document.querySelector('.exam-options')?.removeAttribute?.('hidden');
  const examOptions = document.querySelector('.exam-options');
  if (examOptions) examOptions.hidden = false;
  const sebOptions = document.querySelector('.seb-options');
  if (sebOptions) sebOptions.hidden = false;
  dirty = true;
  toast('Configuración reforzada aplicada. Revisa las fechas y guarda la evaluación.');
}

function readExamSettings(f) {
  if (f.get('exam') !== 'on') return null;
  const radius = Number(f.get('examRadius') || 0);
  let place = null;
  if (radius) {
    try {
      place = JSON.parse(f.get('examPlace') || 'null');
    } catch {
      place = null;
    }
    if (!place) throw new Error('Pulsa "Usar mi ubicación actual como salón" o elige "No revisar la ubicación".');
    place = { ...place, radius };
  }
  const oneByOne = f.get('oneByOne') === 'on';
  const lockOnLeave = f.get('lockOnLeave') === 'on';
  return {
    enabled: true,
    password: String(f.get('examPassword') || '').trim(),
    oneByOne,
    noBack: oneByOne && f.get('noBack') === 'on',
    place,
    lockOnLeave,
    lockGrace: Number(f.get('lockGrace') || 5),
    lockPlatform: f.get('lockPlatform') === 'on',
  };
}

async function captureExamPlace() {
  const status = $('#examPlaceStatus');
  status.textContent = 'Obteniendo tu ubicación…';
  const { location, error } = await currentLocation(15000);
  if (!location) return (status.textContent = error === 'denied' ? 'No diste permiso de ubicación al navegador.' : 'No se pudo obtener la ubicación. Intenta de nuevo.');
  document.querySelector('input[name="examPlace"]').value = JSON.stringify(location);
  const radius = document.querySelector('select[name="examRadius"]');
  if (radius.value === '0') radius.value = '150';
  status.textContent = `Ubicación guardada (precisión ±${Math.round(location.accuracy)} m). Guarda la evaluación para aplicarla.`;
}

document.addEventListener('change', (e) => {
  if (e.target.matches('input[name="exam"]')) document.querySelector('.exam-options').hidden = !e.target.checked;
});

function quizEditorAction(action, target) {
  quizDraft = readQuizQuestions();
  const box = target.closest('[data-question]');
  const q = box ? quizDraft[Number(box.dataset.question)] : null;
  if (action === 'add-question' && quizDraft.length < QUIZ_MAX_QUESTIONS) quizDraft.push(blankQuestion(quizDraft.at(-1)?.type));
  if (action === 'remove-question') quizDraft.splice(Number(box.dataset.question), 1);
  if (action === 'add-option' && q.options.length < (q.type === 'multi' ? 10 : 6)) q.options.push('');
  if (action === 'remove-option') {
    const k = Number(target.dataset.option);
    q.options.splice(k, 1);
    q.optionFeedback?.splice(k, 1);
    q.weights?.splice(k, 1);
    if (Array.isArray(q.correct)) q.correct = q.correct.filter((j) => j !== k).map((j) => (j > k ? j - 1 : j));
    else q.correct = q.correct === k ? 0 : q.correct > k ? q.correct - 1 : q.correct;
  }
  if (q && isNewType(q.type)) newQuestionAction(action, q, target);
  if (action === 'add-var' && (q.variables || []).length < 8) (q.variables ||= []).push({ name: '', min: 1, max: 10, decimals: 0 });
  if (action === 'remove-var') q.variables.splice(Number(target.dataset.varIndex), 1);
  if (action === 'remove-image') delete q.image;
  renderQuizQuestions();
  dirty = true;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-quiz]');
  if (b && $('#quizQuestions')) quizEditorAction(b.dataset.quiz, b);
  if (e.target.closest('[data-exam-place]')) captureExamPlace();
  if (e.target.closest('[data-exam-harden]')) hardenExamSettings();
});
// Imagen de una pregunta: se reduce en el teléfono o la computadora (no en el servidor) y se sube como material.
async function uploadQuestionImage(file) {
  const blob = await compressImage(file);
  const r = await fetch(`/api/upload?course=${encodeURIComponent(current.course.id)}&scope=material`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Aula-Request': '1', 'x-file-name': encodeURIComponent(file.name || 'imagen.jpg'), 'content-type': blob.type || file.type || 'image/jpeg' },
    body: blob,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `No se pudo subir la imagen «${file.name || 'imagen'}».`);
  return data.id;
}

document.addEventListener('change', async (e) => {
  if (!e.target.matches('#quizQuestions [data-quiz-image]')) return;
  const file = e.target.files?.[0];
  const box = e.target.closest('[data-question]');
  if (!file || !box) return;
  const label = e.target.closest('label');
  label.firstChild.textContent = 'Subiendo imagen…';
  try {
    const id = await uploadQuestionImage(file);
    quizDraft = readQuizQuestions();
    quizDraft[Number(box.dataset.question)].image = id;
    renderQuizQuestions();
    dirty = true;
  } catch (error) {
    label.firstChild.textContent = '＋ Imagen (diagrama, gráfica, foto)';
    toast(error.message);
  }
});
document.addEventListener('change', (e) => {
  if (!e.target.matches('#quizQuestions [data-f="type"]')) return;
  quizDraft = readQuizQuestions();
  const i = Number(e.target.closest('[data-question]').dataset.question);
  const { text, image, pool, points, explanation, hint } = quizDraft[i];
  quizDraft[i] = { ...blankQuestion(e.target.value), text, ...(image ? { image } : {}), ...(pool ? { pool } : {}), ...(points ? { points } : {}), ...(explanation ? { explanation } : {}), ...(hint ? { hint } : {}) };
  renderQuizQuestions();
});

// ---- Pantalla de la evaluación -------------------------------------------------------------------

function renderQuiz() {
  clearInterval(quizTimer);
  // Al volver a dibujar, lo pendiente de guardar se guarda (el intento se retoma con «Comenzar»).
  if (attemptSave) saveAttemptProgress().catch(() => {});
  attemptSave = null;
  stopExam(); // si la pantalla se vuelve a dibujar, el intento se retoma con "Comenzar examen" (sin contraseña)
  const q = find(detail);
  if (!q) return renderQuizzes();
  const settings = quizSettings(q);
  const attempts = records('attempt').filter((a) => a.data.quiz === q.id);
  const head = `<button class="back" data-section="quizzes">❮ Evaluaciones</button><h1>${esc(q.data.title)}${sectionTag(q)}</h1>${richText(q.data.body)}<p class="quiz-meta">${esc(quizSettingsText(settings))}</p>${!teaches() && q.data.specialAccess ? '<p class="extension-note">Tienes acceso especial en esta evaluación: el horario, el tiempo y los intentos de arriba ya son los tuyos.</p>' : ''}`;
  if (teaches()) {
    const questions = q.data.questions
      .map((x, i) =>
        isNewType(x.type)
          ? `<section class="quiz-question"><h3>${i + 1}. ${teacherQuestionText(x)}${pointsTag(x)}${poolTag(x)} <span class="quiz-type-tag">${QUESTION_TYPE_NAME[x.type]}</span></h3>${quizImageHtml(x.image, i)}${newQuestionAnswerHtml(x)}${teacherFeedbackHtml(x)}</section>`
          : x.type === 'numeric'
          ? `<section class="quiz-question"><h3>${i + 1}. ${teacherQuestionText(x)}${pointsTag(x)}${poolTag(x)}</h3>${quizImageHtml(x.image, i)}<p>Respuesta: <code class="formula">${teacherFormula(x)}</code> ${x.unit ? esc(x.unit) : ''} · tolerancia ${esc(x.tolerance)} %</p>${
              x.variables?.length ? `<p class="muted">Datos por alumno: ${x.variables.map((v) => `<var class="qvar">${esc(v.name)}</var> entre ${esc(v.min)} y ${esc(v.max)}`).join('; ')}</p>` : ''
            }${teacherFeedbackHtml(x)}</section>`
          : `<section class="quiz-question"><h3>${i + 1}. ${teacherQuestionText(x)}${pointsTag(x)}${poolTag(x)}</h3>${quizImageHtml(x.image, i)}<ol type="A">${x.options.map((o, j) => `<li>${esc(o)} ${j === x.correct ? '✓' : x.weights?.[j] ? `<span class="muted">(${x.weights[j]} %)</span>` : ''}</li>`).join('')}</ol>${teacherFeedbackHtml(x)}</section>`,
      )
      .join('');
    // Resultados por alumno: mejor calificación y número de intentos.
    const byStudent = new Map();
    // Con secciones, el autor del intento (cuenta o alumno de ejemplo) se ubica en su sección.
    const memberOfAuthor = (author) => current.members.find((m) => m.user_id === author || `demo:${m.id}` === author);
    for (const a of attempts.filter((x) => inSelectedSection(memberOfAuthor(x.author)))) {
      const row = byStudent.get(a.author) || { author: a.author, name: a.data.name, best: 0, count: 0, last: '', integrity: [] };
      row.best = Math.max(row.best, a.data.score);
      row.pending = (row.pending || 0) + (a.data.pending || 0);
      row.count++;
      row.last = a.created > row.last ? a.created : row.last;
      if (a.data.integrity) row.integrity.push({ attempt: a.data.attempt || 1, ...a.data.integrity });
      byStudent.set(a.author, row);
    }
    const rows = [...byStudent.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    const exam = settings.exam?.enabled;
    const drawNote = settings.draw?.length
      ? `<p class="real-status">Cada alumno recibe ${questionCountOf(q.data)} de ${q.data.questions.length} preguntas: ${settings.draw
          .map((d) => `${d.count} de «${esc(d.pool)}»`)
          .join(', ')} al azar${questionCountOf(q.data) > settings.draw.reduce((n, d) => n + d.count, 0) ? ' y todas las que no tienen grupo' : ''}.</p>`
      : '';
    const essays = q.data.questions.some((x) => x.type === 'essay');
    // Intentos cerrados por tiempo sin ninguna respuesta (12.29): se pueden devolver.
    const emptyAttempts = attempts.filter((a) => !a.data.details && !(a.data.answers || []).length);
    const toReview = attempts.filter((a) => inSelectedSection(memberOfAuthor(a.author))).reduce((n, a) => n + (a.data.pending || 0), 0);
    const total = quizTotalPoints(q.data.questions, new Map((settings.draw || []).map((d) => [d.pool, d.count])));
    const sebInfo = settings.seb?.required
      ? `<p class="real-status">Exige <b>Safe Exam Browser</b>: tus alumnos ven el botón «Abrir en Safe Exam Browser». <a href="${esc(sebLink(q.id))}">Probarlo aquí</a> · <a href="/seb/${esc(q.id)}.seb" download>Descargar la configuración (.seb)</a></p>`
      : '';
    $('#main').innerHTML = `${head}<p class="quiz-meta">${total.exact ? '' : 'Aprox. '}${total.total} ${total.total === 1 ? 'punto' : 'puntos'} por alumno.</p>${sebInfo}<div class="toolbar">${button('Editar evaluación', 'edit-quiz', q.id, 'secondary')}<button class="secondary" type="button" data-quiz-preview="${esc(q.id)}">Vista previa</button>${specialAccessButton('quiz', q.id)}${
      essays ? `<button class="${toReview ? 'primary' : 'secondary'}" type="button" data-essay-review="${esc(q.id)}">Revisar respuestas escritas${toReview ? ` (${toReview} por calificar)` : ''}</button>` : ''
    }${attempts.length ? `<button class="secondary" type="button" data-quiz-stats="${esc(q.id)}">Estadísticas</button>` : ''}<details class="more-actions"><summary class="secondary">Más acciones</summary><div class="more-actions-panel"><button type="button" data-quiz-duplicate="${esc(q.id)}">Duplicar</button>${attempts.length ? `<button type="button" data-quiz-export="${esc(q.id)}">Exportar a Excel</button>` : ''}<button type="button" data-bank-save="${esc(q.id)}">Guardar en el banco</button></div></details>${sectionFilterHtml()}</div>${sectionDatesSummary(q.id)}${
      emptyAttempts.length
        ? `<div class="warning-note void-note"><p><b>${emptyAttempts.length} ${emptyAttempts.length === 1 ? 'intento se cerró' : 'intentos se cerraron'} sin ninguna respuesta</b> (de ${new Set(emptyAttempts.map((a) => a.author)).size} ${new Set(emptyAttempts.map((a) => a.author)).size === 1 ? 'alumno' : 'alumnos'}): se acabó el tiempo antes de que contestaran. Si fue por la configuración, devuélvelos para que puedan volver a presentar.</p><button type="button" class="secondary" data-void-empty="${esc(q.id)}">Devolver intentos sin respuestas</button></div>`
        : ''
    }
      <section class="exam-monitor" id="examMonitor"><p class="muted">Cargando quién está contestando y quién ya terminó…</p></section>${drawNote}${questions}
      <h2>Resultados</h2><div class="table-wrap"><table><thead><tr><th>Alumno</th><th>Mejor calificación</th><th>Intentos</th><th>Último envío</th>${exam ? '<th>Integridad</th>' : ''}<th>Respuestas</th></tr></thead><tbody>${
        rows
          .map(
            (r) => `<tr><td>${esc(r.name)}${courseSections().length ? `<div class="table-subtext">${esc(sectionName(memberOfAuthor(r.author)?.section) || 'Sin sección')}</div>` : ''}</td><td>${r.best.toFixed(2)} / 10${r.pending ? `<div class="table-subtext">${r.pending} por calificar</div>` : ''}</td><td>${r.count} de ${settings.attempts}</td><td>${fmt(r.last)}</td>${
              exam ? `<td>${integrityCell(r.integrity)}${r.integrity.length ? ` <button type="button" class="table-link" data-integrity="${esc(r.author)}">Detalle</button>` : ''}</td>` : ''
            }<td><button type="button" class="table-link" data-attempt-answers="${esc(r.author)}" data-quiz="${esc(q.id)}">Ver respuestas</button></td></tr>`,
          )
          .join('') || `<tr><td colspan="${exam ? 6 : 5}">No hay intentos registrados.</td></tr>`
      }</tbody></table></div>`;
    {
      // 12.31: el seguimiento (quién contesta, quién terminó y con qué calificación) va en toda evaluación.
      loadExamMonitor(q.id);
      // El monitor se actualiza solo cada 10 s mientras está en pantalla (así aparecen los bloqueados y su código).
      // Con la pestaña oculta no se pide (12.30: cada vuelta cuesta lecturas de D1); al volver se actualiza en seguida.
      clearInterval(examMonitorTimer);
      examMonitorTimer = setInterval(() => {
        if (section !== 'quiz' || detail !== q.id || !document.getElementById('examMonitor')) return clearInterval(examMonitorTimer);
        if (document.visibilityState === 'hidden') return;
        loadExamMonitor(q.id);
      }, 10_000);
    }
    return;
  }
  // La calificación puede estar oculta («pendiente») si el docente así lo configuró.
  const shownScores = attempts.map((a) => a.data.score).filter((x) => x !== null && x !== undefined);
  const best = shownScores.length ? Math.max(...shownScores) : null;
  const left = settings.attempts - attempts.length;
  const history = attempts.length
    ? `<div class="quiz-result">${best === null ? `<p>${pendingResultText(attempts[0]?.data)}</p>` : `<p>Mejor calificación: <b>${best.toFixed(2)} / 10</b></p>`}<ul>${attempts
        .sort((a, b) => (a.data.attempt || 1) - (b.data.attempt || 1))
        .map(
          (a) =>
            `<li>Intento ${a.data.attempt || 1}: ${a.data.score === null || a.data.score === undefined ? 'enviado' : `${a.data.score.toFixed(2)} / 10 · ${a.data.correct} de ${a.data.total} correctas`} · ${fmt(a.created)}${a.data.pending ? ` · ${pendingReviewText(a.data.pending)}` : ''}${
              a.data.details?.length ? `<details class="quiz-review"><summary>Ver revisión</summary>${attemptReviewHtml(a, q)}</details>` : feedbackListHtml(a, q)
            }</li>`,
        )
        .join('')}</ul></div>`
    : '';
  const last = quizLastResult?.quiz === q.id ? quizLastResult.result : null;
  if (last && quizLastResult.fresh) {
    // Recién enviada (12.36): el resultado queda a la vista, no solo en el aviso que desaparece.
    quizLastResult.fresh = false;
    setTimeout(() => {
      const box = document.querySelector('.quiz-result.is-new');
      box?.scrollIntoView?.({ block: 'start' });
      box?.focus?.({ preventScroll: true });
    }, 0);
  }
  const lastHtml = last?.data.hidden
    ? `<div class="quiz-result is-new"><p><b>Tu evaluación se envió.</b> ${pendingResultText(last.data)}</p></div>`
    : last
    ? `<div class="quiz-result is-new" tabindex="-1" role="status"><p>Resultado del intento ${last.data.attempt}: <b>${last.data.score.toFixed(2)} / 10</b> (${last.data.correct} de ${last.data.total} correctas)${last.data.pending ? `. ${pendingReviewText(last.data.pending)}` : ''}</p>${attemptReviewHtml(last, q, quizLastResult.texts)}${last.data.details ? '' : feedbackListHtml(last, q)}</div>`
    : '';
  const exam = settings.exam?.enabled ? settings.exam : null;
  // Fechas de disponibilidad: antes de abrir o después de cerrar no hay botón para empezar.
  const notYet = settings.opensAt && Date.parse(settings.opensAt) > Date.now();
  const closed = settings.closesAt && Date.parse(settings.closesAt) < Date.now();
  // 12.29: con el tiempo fijo, después de «inicio + tiempo límite» ya no hay tiempo para nadie.
  const fixedEnd = settings.timerMode === 'fixed' && settings.opensAt && settings.timeLimit ? Date.parse(settings.opensAt) + settings.timeLimit * 60_000 : null;
  const timeOver = fixedEnd && fixedEnd < Date.now() && !closed;
  const sebNotice = settings.needsSeb && left > 0 && !isSafeExamBrowser() ? sebRequiredHtml(q.id) : '';
  $('#main').innerHTML = `${head}${lastHtml}${history}${sebNotice}${
    sebNotice
      ? '' // fuera de Safe Exam Browser no hay botón para empezar (el servidor tampoco lo permitiría)
      : left > 0 && notYet
      ? `<p class="real-status">Esta evaluación se abre el <b>${esc(fmt(settings.opensAt))}</b>. Vuelve a esta página a esa hora.</p>`
      : left > 0 && closed
      ? `<p class="real-status">Esta evaluación cerró el ${esc(fmt(settings.closesAt))}.</p>`
      : left > 0 && timeOver
      ? `<p class="real-status">El tiempo de esta evaluación terminó el ${esc(fmt(new Date(fixedEnd).toISOString()))}: se cuenta desde la hora de inicio, igual para todos. Si crees que es un error, avisa a tu docente.</p>`
      : left > 0 && exam
      ? examIntroHtml(exam, attempts.length)
      : left > 0
      ? `<p class="real-status">${attempts.length ? `Te quedan ${left} intento${left === 1 ? '' : 's'}.` : 'Revisa tus respuestas antes de enviar.'}${settings.timeLimit ? ` El tiempo empieza a contar al comenzar y no se detiene si cierras la página.` : ''}</p>
         ${settings.needsCode
           ? `<form class="real-form quiz-code-form" data-quiz-code="${esc(q.id)}"><label>Código que dio tu docente<input name="password" required autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="30"></label><p class="form-error error" hidden></p><button class="primary">${attempts.length ? 'Comenzar otro intento' : 'Comenzar evaluación'}</button></form>`
           : `<button class="primary" data-quiz-start="${esc(q.id)}">${attempts.length ? 'Comenzar otro intento' : 'Comenzar evaluación'}</button>`}`
      : attempts.length
        ? '<p class="muted">Ya usaste todos tus intentos.</p>'
        : ''
  }<div id="quizAttemptBox"></div>`;
}

/** Campos de una pregunta del intento (también los usa la vista previa del docente). */
function attemptQuestionHtml(x, n, required) {
  return `<fieldset class="quiz-question" data-index="${x.index}" data-position="${n}"><legend>${n + 1}. ${x.type === 'fill' ? 'Completa los espacios' : esc(x.text)}${pointsTag(x)}</legend>${quizImageHtml(x.image, n)}${
    isNewType(x.type)
      ? newAnswerInputHtml(x, required)
      : x.type === 'numeric'
      ? `<label class="quiz-number"><input name="q_${x.index}" inputmode="decimal" autocomplete="off" ${required} placeholder="Tu respuesta"> ${x.unit ? `<span>${esc(x.unit)}</span>` : ''}</label>`
      : x.options.map((o, j) => `<label><input type="radio" ${required} name="q_${x.index}" value="${j}"> ${esc(o)}</label>`).join('')
  }${x.hint ? `<details class="quiz-hint-box"><summary>Ver pista</summary><p>${esc(x.hint)}</p></details>` : ''}</fieldset>`;
}

/** Respuestas del intento tal como las manda el navegador ({ índice original: respuesta }). */
function collectAttemptAnswers(form, questions) {
  const data = new FormData(form);
  const answers = {};
  for (const x of questions) {
    if (isNewType(x.type)) {
      const answer = collectNewAnswer(data, x);
      if (answer !== undefined) answers[x.index] = answer;
      continue;
    }
    const value = data.get('q_' + x.index);
    if (value !== null && value !== '') answers[x.index] = x.type === 'numeric' ? value : Number(value);
  }
  return answers;
}

/** Vuelve a poner en el formulario las respuestas guardadas (al retomar tras recargar). */
function restoreAttemptAnswers(form, questions, answers) {
  for (const [index, value] of Object.entries(answers || {})) {
    const question = questions.find((x) => String(x.index) === index);
    if (!question) continue;
    if (isNewType(question.type)) {
      restoreNewAnswer(form, question, value);
      continue;
    }
    const input = form.querySelector(`[name="q_${index}"]${typeof value === 'number' ? `[value="${value}"]` : ''}`);
    if (!input) continue;
    if (input.type === 'radio') input.checked = true;
    else input.value = value;
  }
}

/** Páginas de preguntas (12.27): muestra la página `page` y ajusta los botones. */
function showAttemptPage(form, page) {
  const boxes = [...form.querySelectorAll('fieldset[data-page]')];
  const pages = Math.max(...boxes.map((b) => Number(b.dataset.page))) + 1;
  const current = Math.min(Math.max(page, 0), pages - 1);
  form.dataset.page = current;
  boxes.forEach((box) => (box.hidden = Number(box.dataset.page) !== current));
  form.querySelector('[data-page-nav="prev"]').hidden = current === 0;
  form.querySelector('[data-page-nav="next"]').hidden = current === pages - 1;
  const label = form.querySelector('[data-page-label]');
  if (label) label.textContent = `Página ${current + 1} de ${pages}`;
  return current;
}

let attemptSave = null; // guardado automático del intento sin modo examen: { quizId, attempt, collect, timer }

/** Indicador «Guardado» del intento. */
function attemptSaveStatus(text, cls = '') {
  const box = document.getElementById('quizSaveStatus');
  if (!box) return;
  box.textContent = text;
  box.className = `quiz-save-status ${cls}`;
}

/** Guarda las respuestas del intento (12.27: en cualquier evaluación, no solo en el modo examen). */
async function saveAttemptProgress() {
  const state = attemptSave;
  if (!state) return;
  clearTimeout(state.timer);
  attemptSaveStatus('Guardando…');
  try {
    await request('/api/attempt/progress', { course: current.course.id, quiz: state.quizId, attempt: state.attempt, answers: state.collect() });
    if (attemptSave === state) attemptSaveStatus(`Guardado ${new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`, 'is-saved');
  } catch (error) {
    if (attemptSave !== state) return;
    if (error.data?.closed) return attemptClosed(error.message);
    if (error.data?.needsSeb) return showSebRequired(state.quizId);
    attemptSaveStatus('Sin conexión: se volverá a intentar', 'is-error');
    state.timer = setTimeout(() => saveAttemptProgress(), 10_000);
  }
}

/** El servidor cerró el intento (se acabó el tiempo): se muestra el resultado. */
async function attemptClosed(message) {
  clearInterval(quizTimer);
  clearTimeout(attemptSave?.timer);
  attemptSave = null;
  releaseActiveExam();
  stopExam();
  dirty = false;
  toast(message);
  await reload();
}

async function startQuizAttempt(quizId, extra = {}) {
  let data;
  try {
    data = await request('/api/attempt/start', { course: current.course.id, quiz: quizId, ...extra });
  } catch (error) {
    if (error.data?.needsSeb) showSebRequired(quizId);
    throw error;
  }
  const offset = data.serverNow - Date.now();
  const exam = data.exam;
  // Examen que bloquea la plataforma: se anota ya (12.30). Así la campana no se pide y una respuesta 423 de otra
  // solicitud no vuelve a abrir el curso encima del intento.
  if (exam?.lockPlatform && me) {
    me.activeExam = { quiz: quizId, course: current.course.id };
    document.body.classList.add('exam-platform-lock');
  }
  // Preguntas por página (12.27); en el examen «una pregunta a la vez» manda.
  const perPage = exam?.oneByOne ? 0 : Number(data.perPage) || 0;
  const paged = perPage > 0 && data.questions.length > perPage;
  const required = exam || paged ? '' : 'required'; // en el examen, lo que quede sin contestar cuenta como incorrecto
  const questions = data.questions.map((x, n) => attemptQuestionHtml(x, n, required).replace('<fieldset class="quiz-question"', `<fieldset class="quiz-question"${paged ? ` data-page="${Math.floor(n / perPage)}"` : ''}`)).join('');
  document.querySelector('[data-quiz-start]')?.remove();
  document.querySelector('[data-quiz-code]')?.remove();
  document.querySelector('.exam-intro')?.remove();
  $('#quizAttemptBox').innerHTML = `<form id="quizAttempt" class="quiz-attempt ${exam ? 'is-exam' : ''}">
      <div class="quiz-attempt-head"><strong>Intento ${data.attempt}</strong>${exam?.oneByOne ? '<span id="examProgress" class="muted"></span>' : paged ? '<span class="muted" data-page-label></span>' : ''}<span id="quizAnswered" class="quiz-answered"></span><span id="quizSaveStatus" class="quiz-save-status" role="status" aria-live="polite"></span>${data.deadline ? '<span class="quiz-clock" id="quizClock" role="timer"></span><span id="quizClockAlert" class="sr-only" role="alert"></span>' : ''}</div>
      ${exam?.flagged ? '<p class="warning-note">No se pudo confirmar que estés en el salón: tu docente lo verá junto a tu examen.</p>' : ''}
      ${questions}<p class="form-error error" hidden></p>
      ${exam?.oneByOne ? `<p class="exam-nav-note">${exam.noBack ? 'Al avanzar se guarda la respuesta y ya no podrás regresar. Si la dejas vacía, se guardará sin respuesta.' : 'Cada cambio de pregunta se guarda automáticamente.'}${exam.randomOrder ? ' El orden es aleatorio para este intento.' : ''} No se abre otra página.</p><div class="exam-nav"><button type="button" class="secondary" data-exam-nav="prev">‹ Anterior</button><button type="button" class="primary" data-exam-nav="next">${exam.randomOrder ? 'Guardar y siguiente aleatoria ›' : 'Guardar y siguiente ›'}</button></div>` : ''}
      ${paged ? '<div class="exam-nav"><button type="button" class="secondary" data-page-nav="prev">‹ Página anterior</button><button type="button" class="primary" data-page-nav="next">Página siguiente ›</button></div>' : ''}
      <button class="primary" id="quizSubmit">Enviar evaluación</button></form>`;
  const form = $('#quizAttempt');
  const collect = () => collectAttemptAnswers($('#quizAttempt'), data.questions);
  if (paged) showAttemptPage(form, 0);
  // Cuántas lleva contestadas (12.36): a la vista todo el tiempo, también en el celular (el encabezado es fijo).
  const total = data.questions.length;
  const answeredCount = () => Object.keys(collect()).length;
  const showAnswered = () => {
    const box = $('#quizAnswered');
    if (box) box.textContent = `${answeredCount()} de ${total} contestadas`;
  };
  form.addEventListener('change', showAnswered);
  form.addEventListener('input', showAnswered);
  // Antes de enviar a mano: confirmación con las que faltan (no aplica al envío automático por tiempo).
  form.addEventListener(
    'submit',
    async (e) => {
      if (form.dataset.confirmed) {
        delete form.dataset.confirmed;
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      const missing = total - answeredCount();
      const ok = await examConfirm(
        missing ? `Te ${missing === 1 ? 'falta 1 pregunta' : `faltan ${missing} preguntas`} sin contestar; contarán como incorrectas. ¿Enviar de todos modos? Después ya no podrás cambiar tus respuestas.` : 'Contestaste todas las preguntas. ¿Enviar la evaluación? Después ya no podrás cambiar tus respuestas.',
        'Enviar evaluación',
      );
      if (!ok) return;
      form.dataset.confirmed = '1';
      form.requestSubmit();
    },
    true,
  );
  const submit = async () => {
    if (exam) await saveExamProgress(true).catch(() => {});
    const answers = collect();
    let result;
    try {
      result = await request('/api/attempt', { course: current.course.id, quiz: quizId, answers });
    } catch (error) {
      if (error.status === 423) showExamLock();
      if (error.data?.otherDevice) showOtherDevice();
      if (error.data?.closed) {
        attemptClosed(error.message);
        return error.message;
      }
      if (error.data?.needsSeb) showSebRequired(quizId);
      throw error;
    }
    releaseActiveExam();
    clearInterval(quizTimer);
    clearTimeout(attemptSave?.timer);
    attemptSave = null;
    stopExam();
    // Los enunciados tal como los vio (con sus datos), para mostrar sus ✓ y ✗ al volver a dibujar la pantalla.
    quizLastResult = { quiz: quizId, result, fresh: true, texts: Object.fromEntries(data.questions.map((x) => [x.index, x.text])) };
    return result.data.score === null || result.data.score === undefined ? `Evaluación enviada. ${pendingResultText(result.data)}` : `Evaluación enviada: ${result.data.score.toFixed(2)} / 10.`;
  };
  if (exam) startExam(quizId, data, collect);
  else {
    // Sin modo examen (12.27): las respuestas guardadas vuelven al recargar y se guardan mientras contesta.
    restoreAttemptAnswers(form, data.questions, data.saved);
    attemptSave = { quizId, attempt: data.attempt, collect, timer: null };
    const queue = (delay) => {
      if (!attemptSave) return;
      clearTimeout(attemptSave.timer);
      attemptSaveStatus('Cambios sin guardar…');
      attemptSave.timer = setTimeout(() => saveAttemptProgress(), delay);
    };
    form.addEventListener('change', () => queue(300));
    form.addEventListener('input', (e) => queue(e.target.matches('textarea, input[type="text"], input:not([type])') ? 1500 : 300));
    if (data.saved && Object.keys(data.saved).length) attemptSaveStatus('Se recuperaron tus respuestas guardadas', 'is-saved');
  }
  bindForm('#quizAttempt', submit);
  showAnswered();
  setTimeout(showAnswered, 600); // el examen restaura lo guardado de forma asíncrona
  if (data.deadline) {
    const tick = () => {
      const left = Date.parse(data.deadline) - (Date.now() + offset);
      const clock = $('#quizClock');
      if (!clock) return clearInterval(quizTimer);
      const s = Math.max(0, Math.round(left / 1000));
      clock.textContent = `Tiempo restante: ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      clock.classList.toggle('is-low', s < 60);
      clock.classList.toggle('is-warn', s >= 60 && s < 300);
      // Avisos que también leen los lectores de pantalla, una sola vez cada uno.
      const alert = s <= 60 ? 'Queda 1 minuto.' : s <= 300 ? 'Quedan 5 minutos.' : '';
      if (alert && clock.dataset.alerted !== alert && left > 0) {
        clock.dataset.alerted = alert;
        const live = $('#quizClockAlert');
        if (live) live.textContent = alert;
        toast(alert);
      }
      if (left <= 0) {
        clearInterval(quizTimer);
        toast('Se acabó el tiempo: se envían tus respuestas.');
        submit()
          .then(async (message) => {
            dirty = false;
            await reload();
            toast(message);
          })
          .catch((error) => toast(error.message));
      }
    };
    tick();
    quizTimer = setInterval(tick, 1000);
  }
}

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-page-nav]');
  if (!nav) return;
  const form = nav.closest('form');
  showAttemptPage(form, Number(form.dataset.page || 0) + (nav.dataset.pageNav === 'next' ? 1 : -1));
  if (attemptSave) saveAttemptProgress();
  form.scrollIntoView?.({ block: 'start' });
});

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-void-empty]');
  if (!b || busy) return;
  if (!confirm('Se quitarán los intentos que se cerraron sin ninguna respuesta; esos alumnos podrán volver a empezar. Los intentos con respuestas no se tocan. ¿Continuar?')) return;
  try {
    const r = await request('/api/quiz/void-empty', { course: current.course.id, quiz: b.dataset.voidEmpty });
    await reload();
    toast(r.voided ? `Se ${r.voided === 1 ? 'devolvió 1 intento' : `devolvieron ${r.voided} intentos`} a ${r.students} ${r.students === 1 ? 'alumno' : 'alumnos'}. Revisa que el horario y el tiempo de la evaluación sean los correctos.` : 'No había intentos por devolver (o el alumno tiene uno en curso).');
  } catch (error) {
    toast(error.message);
  }
});

// ---- Duplicar una evaluación (12.30) ---------------------------------------------------------------------

function duplicateQuizModal(q) {
  const targets = (courses || []).filter((c) => c.canTeach && !c.archived_at);
  modal(
    'Duplicar evaluación',
    `${field('Título de la copia', 'title', `Copia de ${q.data.title}`, 'text', 'required maxlength="200"')}
      <label>Curso donde se crea<select name="target">${targets
        .map((c) => `<option value="${esc(c.id)}" ${c.id === current.course.id ? 'selected' : ''}>${esc(c.name)}${c.group_name ? ` · ${esc(c.group_name)}` : ''}${c.id === current.course.id ? ' (este curso)' : ''}</option>`)
        .join('')}</select></label>
      <p class="muted">Se copian las preguntas, las preguntas al azar y toda la configuración (tiempo, intentos, modo examen, código, Safe Exam Browser). La copia queda <b>oculta</b> y sin intentos: revisa las fechas y publícala cuando quieras. En otro curso no se copian las secciones, la categoría de calificación ni las condiciones (son de este curso).</p>`,
    async (f) => {
      const r = await request('/api/quiz/duplicate', { course: current.course.id, quiz: q.id, target: f.get('target'), title: f.get('title') });
      if (r.course === current.course.id) {
        detail = r.id;
        section = 'quiz';
      }
      return r.course === current.course.id ? 'Evaluación duplicada (oculta). Revisa sus fechas antes de publicarla.' : 'Evaluación duplicada en el otro curso (oculta).';
    },
    'Duplicar',
  );
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-quiz-duplicate]');
  if (b) duplicateQuizModal(find(b.dataset.quizDuplicate));
});

// ---- Vista previa del docente (12.27) -----------------------------------------------------------------
// Cada vista previa pide al servidor un sorteo nuevo (preguntas, orden y datos) como el de un alumno; no se guarda nada.

let quizPreview = null; // { quizId, seed, questions }

async function openQuizPreview(quizId) {
  const data = await request('/api/quiz/preview', { course: current.course.id, quiz: quizId });
  quizPreview = { quizId, seed: data.seed, questions: data.questions };
  const total = data.questions.reduce((n, x) => n + (x.points || 1), 0);
  modal(
    'Vista previa',
    `<p class="real-status">Así lo recibiría un alumno: <b>${data.questions.length} ${data.questions.length === 1 ? 'pregunta' : 'preguntas'}</b> (${Math.round(total * 100) / 100} puntos), sorteadas ahora. Cada vista previa sortea de nuevo. No se guarda nada.${data.perPage ? ` El alumno las verá de ${data.perPage} en ${data.perPage}.` : ''}</p>
      <div id="quizPreviewQuestions" class="quiz-attempt">${data.questions.map((x, n) => attemptQuestionHtml(x, n, '')).join('')}</div>
      <div id="quizPreviewResult"></div>
      <p class="bank-pick-actions"><button type="button" class="primary" data-preview-grade>Revisar mis respuestas</button><button type="button" class="secondary" data-preview-again>Otra vista previa (nuevo sorteo)</button></p>`,
    null,
  );
}

async function gradeQuizPreview() {
  if (!quizPreview) return;
  const answers = collectAttemptAnswers($('#form'), quizPreview.questions);
  const result = await request('/api/quiz/preview', { course: current.course.id, quiz: quizPreview.quizId, seed: quizPreview.seed, answers });
  for (const box of document.querySelectorAll('#quizPreviewQuestions fieldset')) box.querySelector('.preview-mark')?.remove();
  for (const d of result.details) {
    const box = document.querySelector(`#quizPreviewQuestions fieldset[data-index="${d.index}"] legend`);
    const mark = creditMark(d);
    box?.insertAdjacentHTML('beforeend', ` <span class="preview-mark quiz-mark ${mark.cls}">${mark.icon}${mark.note}</span>`);
  }
  $('#quizPreviewResult').innerHTML = `<p class="quiz-result is-new">Calificación de esta vista previa: <b>${result.score.toFixed(2)} / 10</b> (${result.correct} de ${result.total} correctas${result.pending ? `; ${result.pending} escritas quedarían por revisar` : ''}).</p>`;
}

document.addEventListener('click', async (e) => {
  const open = e.target.closest('[data-quiz-preview]');
  const again = e.target.closest('[data-preview-again]');
  const grade = e.target.closest('[data-preview-grade]');
  if (!open && !again && !grade) return;
  try {
    if (grade) return await gradeQuizPreview();
    await openQuizPreview(open ? open.dataset.quizPreview : quizPreview.quizId);
  } catch (error) {
    toast(error.message);
  }
});

// ---- Respuestas escritas (docente) ------------------------------------------------------------------

/** Ventana para calificar las respuestas escritas de una evaluación (primero las pendientes). */
function essayReviewModal(quizId) {
  const q = find(quizId);
  const memberOfAuthor = (author) => current.members.find((m) => m.user_id === author || `demo:${m.id}` === author);
  const list = records('attempt')
    .filter((a) => a.data.quiz === quizId && inSelectedSection(memberOfAuthor(a.author)))
    .map((a) => ({ a, essays: (a.data.details || []).filter((d) => q.data.questions[d.index]?.type === 'essay') }))
    .filter((x) => x.essays.length)
    .sort((x, y) => (y.a.data.pending || 0) - (x.a.data.pending || 0) || x.a.data.name.localeCompare(y.a.data.name, 'es'));
  const body = list.length
    ? list
        .map(
          ({ a, essays }) => `<section class="essay-review" data-essay-attempt="${esc(a.id)}"><h3>${esc(a.data.name)} <span class="muted">· intento ${a.data.attempt || 1} · ${a.data.score.toFixed(2)} / 10</span></h3>${essays
            .map((d) => {
              const question = q.data.questions[d.index];
              return `<div class="essay-item" data-essay-index="${d.index}"><p><b>${esc(question.text)}</b></p>${question.guide ? `<p class="muted">Guía: ${esc(question.guide)}</p>` : ''}
                <blockquote class="essay-answer">${d.answer ? esc(d.answer) : '<span class="muted">Sin respuesta</span>'}</blockquote>
                <div class="quiz-grid"><label>Puntaje (%)<input type="number" min="0" max="100" step="1" data-essay-credit value="${d.reviewed ? Math.round((d.credit ?? 0) * 100) : ''}" placeholder="${d.answer ? 'Por calificar' : '0'}"></label>
                <label>Comentario para el alumno (opcional)<textarea data-essay-feedback rows="2" maxlength="2000">${esc(d.feedback || '')}</textarea></label></div></div>`;
            })
            .join('')}</section>`,
        )
        .join('')
    : '<p class="muted">Todavía nadie ha enviado respuestas escritas.</p>';
  modal(
    'Revisar respuestas escritas',
    `<p class="muted">Cada pregunta vale lo mismo que las demás; pon de 0 a 100 %. La calificación del intento se actualiza al guardar y el alumno ve tu comentario.</p>${body}`,
    async () => {
      let saved = 0;
      for (const box of document.querySelectorAll('#modal [data-essay-attempt]')) {
        const reviews = [...box.querySelectorAll('[data-essay-index]')]
          .map((item) => ({ item, value: item.querySelector('[data-essay-credit]').value }))
          .filter(({ value }) => value !== '')
          .map(({ item, value }) => {
            const percent = Number(value);
            if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('El puntaje va de 0 a 100 %.');
            return { index: Number(item.dataset.essayIndex), credit: percent / 100, feedback: item.querySelector('[data-essay-feedback]').value };
          });
        if (!reviews.length) continue;
        await request('/api/attempt/review', { course: current.course.id, id: box.dataset.essayAttempt, reviews });
        saved++;
      }
      return saved ? `Calificaciones guardadas (${saved} ${saved === 1 ? 'intento' : 'intentos'}).` : 'No había puntajes nuevos que guardar.';
    },
    'Guardar calificaciones',
  );
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-essay-review]');
  if (b) essayReviewModal(b.dataset.essayReview);
});

// ---- Modo examen (docente) -----------------------------------------------------------------------

const secondsText = (n) => (n >= 60 ? `${Math.floor(n / 60)} min ${n % 60} s` : `${n} s`);

/** Resumen de una fila de resultados: salidas, pantalla completa, copiar/pegar y ubicación. */
function integrityText(i) {
  const parts = [];
  if (i.exits) parts.push(`salió ${i.exits} ${i.exits === 1 ? 'vez' : 'veces'} (${secondsText(i.awaySeconds)})`);
  if (i.fullscreenExits) parts.push(`dejó pantalla completa ${i.fullscreenExits} ${i.fullscreenExits === 1 ? 'vez' : 'veces'}`);
  if (i.locks) parts.push(`se bloqueó ${i.locks} ${i.locks === 1 ? 'vez' : 'veces'}`);
  if (i.copyAttempts) parts.push(`intentó copiar o pegar ${i.copyAttempts} ${i.copyAttempts === 1 ? 'vez' : 'veces'}`);
  if (i.captures) parts.push(`intentó una captura de pantalla ${i.captures} ${i.captures === 1 ? 'vez' : 'veces'}`);
  if (i.flag) parts.push(i.flag);
  return parts.join(' · ');
}

function integrityCell(list) {
  if (!list.length) return '<span class="muted">—</span>';
  const text = list.map(integrityText).filter(Boolean).join(' · ');
  return text ? `<span class="integrity-warn">${esc(text)}</span>` : '<span class="integrity-ok">Sin salidas</span>';
}

function integrityModal(author) {
  const q = find(detail);
  const attempts = records('attempt')
    .filter((a) => a.data.quiz === q.id && a.author === author && a.data.integrity)
    .sort((a, b) => (a.data.attempt || 1) - (b.data.attempt || 1));
  const labels = { left: 'Salió de la página', fullscreen: 'Dejó pantalla completa', copy: 'Intentó copiar o pegar', capture: 'Intentó una captura de pantalla', locked: 'Examen bloqueado', unlocked: 'Desbloqueado' };
  modal(
    `Integridad: ${attempts[0]?.data.name || ''}`, // modal() usa textContent para el título
    attempts
      .map(
        (a) => `<h3>Intento ${a.data.attempt || 1} · ${a.data.score.toFixed(2)} / 10</h3>
          <p>${esc(integrityText(a.data.integrity) || 'Sin salidas ni avisos.')}${a.data.integrity.distance !== null && !a.data.integrity.flag ? ` · a ${a.data.integrity.distance} m del salón` : ''}</p>
          ${a.data.integrity.events.length ? `<ol class="history-list">${a.data.integrity.events.map((e) => `<li><span>${labels[e.kind] || esc(e.kind)}${e.kind === 'left' ? ` durante ${secondsText(e.seconds)}` : ''}</span><span class="muted">${esc(new Date(e.at).toLocaleTimeString('es-MX'))}</span></li>`).join('')}</ol>` : ''}`,
      )
      .join('') +
      '<p class="muted">Las salidas se registran al volver a la página. Un registro no prueba por sí solo que hubo trampa (una llamada o una notificación también cuentan): úsalo para platicar con el alumno.</p>',
    null,
  );
}

/** Examen en curso: quién contesta, cuánto lleva y cuántas veces ha salido; quién quedó bloqueado por la contraseña. */
async function loadExamMonitor(quizId) {
  const box = document.getElementById('examMonitor');
  if (!box) return;
  let data;
  try {
    data = await request(`/api/exam/monitor?course=${encodeURIComponent(current.course.id)}&quiz=${encodeURIComponent(quizId)}`);
  } catch (error) {
    box.innerHTML = `<p class="error">${esc(error.message)}</p>`;
    return;
  }
  if (!document.getElementById('examMonitor') || detail !== quizId) return;
  // Con secciones, solo la sección elegida en el filtro (la que está presentando).
  const inView = (r) => inSelectedSection({ section: r.section || '' });
  data = { ...data, running: data.running.filter(inView), blocked: data.blocked.filter(inView) };
  // Bloqueados al salir: arriba, con el código grande para dictárselo en persona.
  const locked = data.running
    .filter((r) => r.locked)
    .map((r) => `<li class="exam-locked-row"><div><strong>${esc(r.name)}</strong> <span class="muted">bloqueado desde las ${esc(new Date(r.lockedAt).toLocaleTimeString('es-MX', { timeStyle: 'short' }))}${
      r.unlockFailures ? ` · ${r.unlockFailures} ${r.unlockFailures === 1 ? 'código equivocado' : 'códigos equivocados'}` : ''
    }</span></div><span class="exam-unlock-code" aria-label="Código para continuar">${esc(r.unlockCode || '')}</span><button type="button" class="table-link" data-exam-resume="${esc(r.user)}">Permitir continuar</button></li>`)
    .join('');
  const running = data.running
    .filter((r) => !r.locked)
    .map((r) => `<li><strong>${esc(r.name)}</strong>${r.section && !selectedSection() ? ` <span class="quiz-pool-tag">${esc(sectionName(r.section))}</span>` : ''} <span class="muted">intento ${r.attempt} · ${r.answered} de ${data.total} contestadas · desde ${esc(new Date(r.started).toLocaleTimeString('es-MX', { timeStyle: 'short' }))}</span>${
      integrityText(r) ? ` <span class="integrity-warn">${esc(integrityText(r))}</span>` : ''
    }</li>`)
    .join('');
  const blocked = data.blocked
    .map((b) => `<li><strong>${esc(b.name)}</strong> <span class="muted">se equivocó 10 veces de contraseña</span> <button type="button" class="table-link" data-exam-unlock="${esc(b.user)}">Desbloquear</button></li>`)
    .join('');
  // Resumen (12.31): quién terminó y con qué calificación, quién sigue y quién no ha empezado.
  const passing = gradingSettings().final?.passing ?? 6;
  const finished = (data.finished || []).filter(inView).sort((a, b) => (a.last < b.last ? 1 : -1));
  const notStarted = (data.notStarted || []).filter(inView);
  const scores = finished.map((r) => r.score);
  const average = scores.length ? scores.reduce((n, x) => n + x, 0) / scores.length : null;
  const passed = scores.filter((x) => x >= passing).length;
  const q = find(quizId);
  const closedNow = q?.data.settings?.closesAt && Date.parse(q.data.settings.closesAt) < Date.now();
  const finishedRows = finished
    .map(
      (r) => `<tr><td>${esc(r.name)}${r.matricula ? `<div class="table-subtext">${esc(r.matricula)}</div>` : ''}</td><td class="${r.score >= passing ? 'grade-pass' : 'grade-low'}"><b>${r.score.toFixed(2)}</b> / 10${
        r.pending ? `<div class="table-subtext">${r.pending} por calificar</div>` : ''
      }</td><td>${r.correct} de ${r.total}</td><td>${r.attempts}</td><td>${esc(new Date(r.last).toLocaleTimeString('es-MX', { timeStyle: 'short' }))}</td></tr>`,
    )
    .join('');
  box.innerHTML = `<div class="exam-monitor-head"><h2>${closedNow || !q?.data.settings?.exam?.enabled ? 'Resumen de la evaluación' : 'Seguimiento en vivo'}</h2><button type="button" class="secondary" data-exam-refresh>Actualizar</button></div>
    <div class="monitor-stats">
      <div><b>${finished.length}</b><span>terminaron</span></div>
      <div><b>${data.running.filter((r) => !r.locked).length}</b><span>contestando</span></div>
      <div><b>${data.running.filter((r) => r.locked).length + data.blocked.length}</b><span>bloqueados</span></div>
      <div><b>${notStarted.length}</b><span>no han empezado</span></div>
      <div><b>${average === null ? '—' : average.toFixed(2)}</b><span>promedio</span></div>
      <div><b>${scores.length ? `${passed} de ${scores.length}` : '—'}</b><span>aprobados (≥ ${passing})</span></div>
    </div>
    ${locked ? `<h3>Bloqueados por salir de la página</h3><p class="muted">Dile a cada alumno su código (en persona) o pulsa «Permitir continuar».</p><ul class="exam-locked-list">${locked}</ul>` : ''}
    ${running ? `<h3>Contestando ahora</h3><ul>${running}</ul>` : ''}
    ${blocked ? `<h3>Bloqueados</h3><ul>${blocked}</ul>` : ''}
    ${
      finished.length
        ? `<h3>Ya terminaron (${finished.length})</h3><div class="table-wrap"><table class="keep-table monitor-finished"><thead><tr><th>Alumno</th><th>Calificación</th><th>Aciertos</th><th>Intentos</th><th>Envió</th></tr></thead><tbody>${finishedRows}</tbody></table></div><p class="muted">Con varios intentos se muestra el mejor. El detalle de cada intento y la integridad están abajo, en «Resultados».</p>`
        : '<p class="muted">Todavía nadie ha terminado.</p>'
    }
    ${notStarted.length ? `<details class="monitor-pending"><summary>No han empezado (${notStarted.length})</summary><p>${notStarted.map((m) => esc(m.name)).join(' · ')}</p></details>` : ''}`;
}

document.addEventListener('click', async (e) => {
  const detailBtn = e.target.closest('[data-integrity]');
  const unlock = e.target.closest('[data-exam-unlock]');
  const resume = e.target.closest('[data-exam-resume]');
  try {
    if (resume) {
      await request('/api/exam/resume', { course: current.course.id, quiz: detail, user: resume.dataset.examResume });
      toast('Listo: puede continuar su examen.');
      await loadExamMonitor(detail);
    }
    if (detailBtn) integrityModal(detailBtn.dataset.integrity);
    if (e.target.closest('[data-exam-refresh]')) await loadExamMonitor(detail);
    if (unlock) {
      await request('/api/exam/unlock', { course: current.course.id, quiz: detail, user: unlock.dataset.examUnlock });
      toast('Desbloqueado: ya puede volver a escribir la contraseña.');
      await loadExamMonitor(detail);
    }
  } catch (error) {
    toast(error.message);
  }
});

// ---- Modo examen (alumno) --------------------------------------------------------------------------

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && section === 'quiz' && detail && document.getElementById('examMonitor')) loadExamMonitor(detail);
});

let activeExamOpening = null; // varias respuestas 423 a la vez (campana, cursos…) abren el curso una sola vez

/** Lleva al examen abierto y oculta todo lo demás (el servidor tampoco responde otra cosa hasta enviarlo). */
async function goToActiveExam(active) {
  if (!active) return;
  document.body.classList.add('exam-platform-lock');
  if (me) me.activeExam = active;
  // Ya lo está contestando en esta página: no se toca nada. Antes se volvía a abrir el curso (12.30: lo provocaba la
  // campana a los pocos minutos de empezar) y se borraba la pantalla del intento a media respuesta.
  if (section === 'quiz' && detail === active.quiz && document.getElementById('quizAttempt')) return;
  if (current?.course.id !== active.course || !current.examOnly) {
    activeExamOpening ??= openCourse(active.course).finally(() => (activeExamOpening = null));
    await activeExamOpening;
  }
  if (section === 'quiz' && detail === active.quiz && document.getElementById('quizAttempt')) return;
  section = 'quiz';
  detail = active.quiz;
  render();
}

/** Al terminar el examen (enviado o sin tiempo) la plataforma vuelve a estar disponible. */
function releaseActiveExam() {
  if (!me?.activeExam) return;
  me.activeExam = null;
  document.body.classList.remove('exam-platform-lock');
}

/** Este dispositivo dejó de tener el examen (se abrió en otro): se avisa y se ofrece continuar aquí. */
function showOtherDevice() {
  if (!examState || document.getElementById('examLock')) return;
  examState.locked = true;
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div id="examLock" class="exam-lock" role="alertdialog" aria-modal="true" aria-labelledby="examLockTitle"><div class="exam-lock-card">
      <p class="exam-lock-icon" aria-hidden="true">📱</p><h2 id="examLockTitle">El examen continúa en otro dispositivo</h2>
      <p>Se abrió en otro teléfono, computadora o sesión. Desde aquí ya no se guarda ni se envía nada.</p>
      <p class="muted">Si quieres seguir en este dispositivo, pulsa el botón: el examen se bloqueará y necesitarás el código de tu docente.</p>
      <button type="button" class="primary" data-exam-here>Continuar en este dispositivo</button></div></div>`,
  );
}

function examIntroHtml(exam, used) {
  const resuming = me?.activeExam?.quiz === detail;
  const fullscreen = Boolean(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  return `<section class="exam-intro"><h2>Modo examen</h2><ul>
    <li>${fullscreen ? 'Se abre en pantalla completa. ' : ''}Si sales de la página, cambias de aplicación o de pestaña, queda registrado con la hora y la duración, y tu docente lo verá.</li>
    <li>No se puede copiar, pegar ni usar el menú del botón derecho.</li>
    <li>No se permiten capturas de pantalla: cada pregunta lleva tu nombre como marca de agua, en computadora la tecla de captura tapa el examen y queda registrada, y el examen no se puede imprimir.</li>
    ${exam.oneByOne ? `<li>Verás una pregunta a la vez${exam.noBack ? ' y <strong>no podrás regresar</strong> a las anteriores' : ''}.</li>` : ''}
    ${exam.lockOnLeave ? `<li><strong>Si sales de la página${exam.lockGrace ? ` más de ${exam.lockGrace} segundos` : ''} (otra aplicación, WhatsApp, bloquear el teléfono), el examen se bloquea</strong> y necesitarás un código de tu docente para continuar. <strong>A la 3.ª salida se bloquea aunque sean salidas cortas.</strong> El tiempo sigue corriendo. Silencia las notificaciones antes de empezar.</li>` : ''}
    ${exam.checksLocation ? '<li>Se pedirá tu ubicación para confirmar que estás en el salón (solo se guarda la distancia).</li>' : ''}
    <li>Tus respuestas se guardan mientras contestas: si se cierra la página, vuelve a entrar y continúa donde ibas.</li></ul>
    <form id="examStart" class="real-form">
      ${resuming ? '<p class="real-status">Tienes este examen en curso: continúa donde ibas.</p>' : ''}
      ${exam.needsPassword && !resuming ? '<label>Código que dio tu docente<input name="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="30"></label>' : ''}
      <p class="form-error error" hidden></p>
      <button class="primary">${resuming ? 'Continuar examen' : used ? 'Comenzar otro intento' : 'Comenzar examen'}</button>
    </form></section>`;
}

function enterFullscreen() {
  if (isSafeExamBrowser()) return; // SEB ya ocupa toda la pantalla (12.31)
  const root = document.documentElement;
  const go = root.requestFullscreen || root.webkitRequestFullscreen;
  try {
    const result = go?.call(root);
    result?.catch?.(() => {});
  } catch {
    // iPhone y algunos navegadores no permiten pantalla completa: las salidas se registran igual.
  }
}

const isFullscreen = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);

function startExam(quizId, data, collect) {
  stopExam();
  const exam = data.exam;
  examState = { quizId, attempt: data.attempt, exam, collect, position: exam.position || 0, events: [], awaySince: null, blurTimer: null, lastCopy: 0, saveTimer: null };
  document.body.classList.add('exam-running');
  // Respuestas guardadas (al retomar tras recargar).
  restoreAttemptAnswers(document.getElementById('quizAttempt'), data.questions, data.saved);
  showExamQuestion();
  if (exam.locked) showExamLock();
  const form = $('#quizAttempt');
  examWatermark(form);
  form.addEventListener('input', () => queueExamSave());
  form.addEventListener('change', () => queueExamSave());
  for (const type of ['copy', 'cut', 'paste', 'contextmenu', 'dragstart', 'drop']) form.addEventListener(type, examBlockCopy);
  document.addEventListener('visibilitychange', examAwayCheck);
  window.addEventListener('blur', examAwayCheck);
  window.addEventListener('focus', examAwayCheck);
  document.addEventListener('fullscreenchange', examFullscreenCheck);
  document.addEventListener('webkitfullscreenchange', examFullscreenCheck);
  window.addEventListener('beforeunload', examBeforeUnload);
  document.addEventListener('keydown', examCaptureKey, true);
  document.addEventListener('keyup', examCaptureKey, true);
  window.addEventListener('beforeprint', examPrint);
}

function stopExam() {
  if (!examState) return;
  clearTimeout(examState.saveTimer);
  document.removeEventListener('visibilitychange', examAwayCheck);
  window.removeEventListener('blur', examAwayCheck);
  window.removeEventListener('focus', examAwayCheck);
  document.removeEventListener('fullscreenchange', examFullscreenCheck);
  document.removeEventListener('webkitfullscreenchange', examFullscreenCheck);
  window.removeEventListener('beforeunload', examBeforeUnload);
  document.removeEventListener('keydown', examCaptureKey, true);
  document.removeEventListener('keyup', examCaptureKey, true);
  window.removeEventListener('beforeprint', examPrint);
  document.body.classList.remove('exam-running', 'exam-shield');
  document.getElementById('examFullscreenBar')?.remove();
  document.getElementById('examConfirm')?.remove();
  clearTimeout(examState.blurTimer);
  hideExamLock();
  examState = null;
  if (isFullscreen()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
}

function examBeforeUnload(e) {
  e.preventDefault();
  e.returnValue = '';
}

function examBlockCopy(e) {
  e.preventDefault();
  if (!examState || Date.now() - examState.lastCopy < 5000) return;
  examState.lastCopy = Date.now();
  examState.events.push({ kind: 'copy' });
  toast('En el examen no se puede copiar ni pegar. Quedó registrado.');
  saveExamProgress(true).catch(() => {});
}

// ---- Capturas de pantalla ----------------------------------------------------------------------------
// Una página web no puede impedir la captura del teléfono (es del sistema operativo). Lo que sí se hace:
// cada pregunta lleva una marca de agua con el nombre del alumno (la captura lo delata), no se imprime,
// y en computadora se detectan las teclas de captura: se tapa el examen y queda registrado.

function examWatermark(form) {
  const member = myMember();
  const who = [me?.name, member?.matricula || me?.email].filter(Boolean).join(' · ');
  const text = `${who} · ${new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}`;
  const mark = document.createElement('div');
  mark.className = 'exam-watermark';
  mark.setAttribute('aria-hidden', 'true');
  mark.innerHTML = `<div>${Array.from({ length: 40 }, () => `<span>${esc(text)}</span>`).join('')}</div>`;
  form.prepend(mark);
}

function isCaptureKey(e) {
  const key = String(e.key || '');
  if (key === 'PrintScreen' || e.code === 'PrintScreen') return true;
  // Windows: Win + Mayús + S. Mac: Cmd + Mayús + 3, 4 o 5.
  if (e.shiftKey && e.metaKey && (/^[sS345#$%]$/.test(key) || ['KeyS', 'Digit3', 'Digit4', 'Digit5'].includes(e.code))) return true;
  return false;
}

function examCaptureKey(e) {
  if (!examState || !isCaptureKey(e)) return;
  e.preventDefault();
  examShield();
  if (e.type === 'keyup' || Date.now() - (examState.lastCapture || 0) < 3000) return;
  examState.lastCapture = Date.now();
  examState.events.push({ kind: 'capture' });
  // La tecla Impr Pant copia al portapapeles: se intenta vaciarlo (el navegador puede no permitirlo).
  navigator.clipboard?.writeText?.('').catch?.(() => {});
  toast('En el examen no se permiten capturas de pantalla. Quedó registrado.');
  saveExamProgress(true).catch(() => {});
}

/** Tapa el examen unos segundos (lo que alcance a salir en la captura es la pantalla en blanco). */
function examShield() {
  document.body.classList.add('exam-shield');
  clearTimeout(examState?.shieldTimer);
  if (examState) examState.shieldTimer = setTimeout(() => document.body.classList.remove('exam-shield'), 2500);
}

function examPrint() {
  if (!examState || Date.now() - (examState.lastCapture || 0) < 3000) return;
  examState.lastCapture = Date.now();
  examState.events.push({ kind: 'capture' });
  saveExamProgress(true).catch(() => {});
}

/** Salir de la página (otra pestaña, otra aplicación, bloquear el teléfono): se registra al volver, con la duración. */
function examAwayCheck() {
  // Dentro de Safe Exam Browser no se puede salir del examen; al tocar su barra o sus avisos la página pierde el foco
  // y eso se confundía con una salida que bloqueaba el examen (12.31).
  if (isSafeExamBrowser()) return;
  if (!examState) return;
  const hidden = document.visibilityState === 'hidden';
  // Un selector nativo abierto (relacionar, ordenar) le quita el foco a la ventana sin salir de la página (12.30).
  const away = hidden || (!document.hasFocus() && !examSelectOpen());
  clearTimeout(examState.blurTimer);
  if (away && !examState.awaySince) {
    // Ocultar la página (otra aplicación, otra pestaña, bloquear el teléfono) cuenta en ese instante. Perder solo el
    // foco con la página a la vista (pantalla dividida, ventana flotante, la cortina de notificaciones) cuenta si dura
    // más de BLUR_CONFIRM_MS, y entonces desde que empezó: así un parpadeo del foco al tocar la pantalla no es salida (12.32).
    if (hidden) markExamAway(Date.now());
    else {
      const since = Date.now();
      const state = examState;
      state.blurTimer = setTimeout(() => {
        if (examState === state && !state.awaySince && (document.visibilityState === 'hidden' || (!document.hasFocus() && !examSelectOpen()))) markExamAway(since);
      }, BLUR_CONFIRM_MS);
    }
  }
  examReturnCheck(away);
}

const BLUR_CONFIRM_MS = 600;

/** Con un selector de la evaluación enfocado, la pérdida de foco (o de pantalla completa) es del propio selector. */
const examSelectOpen = () => Boolean(document.activeElement?.matches?.('#quizAttempt select'));

function markExamAway(since) {
  if (!examState || examState.awaySince) return;
  examState.awaySince = since;
  // Bloqueo al salir: el servidor anota la salida en ese momento (keepalive: llega aunque se cierre la página).
  if (examState.exam.lockOnLeave && !examState.locked) examState.awayRequest = examLockCall('away', {}, true);
}

/** Al volver a la página: registra la salida con su duración (y, con bloqueo al salir, pregunta al servidor). */
function examReturnCheck(away) {
  if (!away && examState.awaySince) {
    const seconds = Math.round((Date.now() - examState.awaySince) / 1000);
    examState.awaySince = null;
    examState.events.push({ kind: 'left', seconds });
    if (examState.exam.lockOnLeave && !examState.locked) {
      const state = examState;
      // Primero se espera el aviso de salida (para que el servidor no lo reciba después del regreso).
      Promise.resolve(state.awayRequest)
        .catch(() => {})
        .then(() => examLockCall('back', { seconds }))
        .then((r) => {
          if (r?.locked && examState === state) showExamLock();
          else if (examState === state) toast(`Saliste del examen ${seconds} s. Quedó registrado.`);
          saveExamProgress(true).catch(() => {});
        })
        .catch(() => saveExamProgress(true).catch(() => {}));
      return;
    }
    toast(`Saliste del examen ${seconds} s. Quedó registrado.`);
    saveExamProgress(true).catch(() => {});
  }
}

/** Pregunta de sí o no dentro de la página (sin ventanas nativas, que cuentan como salir del examen). */
function examConfirm(message, okText = 'Sí, continuar') {
  return new Promise((resolve) => {
    document.getElementById('examConfirm')?.remove();
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div id="examConfirm" class="exam-lock exam-confirm" role="alertdialog" aria-modal="true" aria-labelledby="examConfirmText"><div class="exam-lock-card">
        <p id="examConfirmText">${esc(message)}</p>
        <div class="form-actions"><button type="button" class="secondary" data-exam-confirm="no">Cancelar</button><button type="button" class="primary" data-exam-confirm="yes">${esc(okText)}</button></div>
      </div></div>`,
    );
    const box = document.getElementById('examConfirm');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-exam-confirm]');
      if (!b) return;
      box.remove();
      resolve(b.dataset.examConfirm === 'yes');
    });
    box.querySelector('[data-exam-confirm="yes"]').focus({ preventScroll: true });
  });
}

/** Llamadas del bloqueo al salir. `keepalive` deja que el aviso de salida llegue aunque la página se cierre. */
async function examLockCall(action, extra = {}, keepalive = false) {
  const state = examState;
  if (!state) return null;
  const body = JSON.stringify({ course: current.course.id, quiz: state.quizId, attempt: state.attempt, ...extra });
  const r = await fetch('/api/attempt/' + action, { method: 'POST', credentials: 'same-origin', keepalive, headers: { 'Content-Type': 'application/json', 'X-Aula-Request': '1' }, body });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'No se pudo completar la operación.'), { status: r.status });
  return data;
}

// ---- Pantalla de bloqueo: tapa el examen hasta que se escriba el código del docente -----------------

let examLockPoll = null;

function showExamLock() {
  if (!examState) return;
  examState.locked = true;
  clearTimeout(examState.saveTimer);
  if (document.getElementById('examLock')) return;
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div id="examLock" class="exam-lock" role="alertdialog" aria-modal="true" aria-labelledby="examLockTitle">
      <div class="exam-lock-card">
        <p class="exam-lock-icon" aria-hidden="true">🔒</p>
        <h2 id="examLockTitle">Examen bloqueado</h2>
        <p>Saliste de la página del examen. Para continuar, <strong>pide a tu docente el código</strong> que aparece junto a tu nombre en su monitor.</p>
        <p class="muted">Tus respuestas están guardadas. El tiempo sigue corriendo.</p>
        <form id="examUnlockForm" class="real-form">
          <label>Código de tu docente<input name="code" inputmode="numeric" pattern="[0-9 ]*" maxlength="7" autocomplete="off" required></label>
          <p class="form-error error" hidden></p>
          <button class="primary">Continuar el examen</button>
        </form>
      </div></div>`,
  );
  document.getElementById('examUnlockForm').code.focus();
  // Si el docente lo desbloquea desde su monitor, se nota solo.
  clearInterval(examLockPoll);
  examLockPoll = setInterval(async () => {
    try {
      const r = await examLockCall('back', { seconds: 0 });
      if (r && !r.locked) examUnlocked();
    } catch {}
  }, 10_000);
}

function hideExamLock() {
  clearInterval(examLockPoll);
  document.getElementById('examLock')?.remove();
}

function examUnlocked() {
  if (examState) {
    examState.locked = false;
    examState.awaySince = null;
  }
  hideExamLock();
  toast('Puedes continuar el examen.');
  saveExamProgress(true).catch(() => {});
}

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'examUnlockForm') return;
  e.preventDefault();
  const error = e.target.querySelector('.form-error');
  const button = e.target.querySelector('button');
  button.disabled = true;
  try {
    const r = await examLockCall('unlock', { code: e.target.code.value });
    if (!r.locked) examUnlocked();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    e.target.code.value = '';
  } finally {
    button.disabled = false;
  }
});

function examFullscreenCheck() {
  if (isSafeExamBrowser()) return;
  if (!examState) return;
  const bar = document.getElementById('examFullscreenBar');
  if (isFullscreen()) return bar?.remove();
  if (document.visibilityState !== 'hidden' && examSelectOpen()) return;
  examState.events.push({ kind: 'fullscreen' });
  saveExamProgress(true).catch(() => {});
  if (!bar) {
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<div id="examFullscreenBar" class="exam-fullscreen-bar" role="alert">Saliste de pantalla completa (quedó registrado). <button type="button" class="primary" data-exam-fullscreen>Volver a pantalla completa</button></div>',
    );
  }
}

function queueExamSave() {
  if (!examState) return;
  clearTimeout(examState.saveTimer);
  examState.saveTimer = setTimeout(() => saveExamProgress().catch(() => {}), 1500);
}

async function saveExamProgress() {
  const state = examState;
  if (!state) return;
  clearTimeout(state.saveTimer);
  const events = state.events.splice(0, 20);
  try {
    await request('/api/attempt/progress', { course: current.course.id, quiz: state.quizId, attempt: state.attempt, answers: state.collect(), position: state.position, events });
    attemptSaveStatus(`Guardado ${new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`, 'is-saved');
  } catch (error) {
    state.events.unshift(...events); // se reintenta en el siguiente guardado
    if (error.status === 423) showExamLock();
    if (error.data?.otherDevice) showOtherDevice();
    if (error.data?.closed) attemptClosed(error.message);
    else if (error.data?.needsSeb) showSebRequired(state.quizId);
    else attemptSaveStatus('Sin conexión: se volverá a intentar', 'is-error');
    throw error;
  }
}

function showExamQuestion() {
  const { exam, position } = examState;
  const boxes = [...document.querySelectorAll('#quizAttempt fieldset[data-position]')];
  if (!exam.oneByOne) return;
  boxes.forEach((box, n) => {
    box.hidden = n !== position;
    // Sin regresar: las preguntas que ya quedaron atrás no se pueden cambiar (el servidor tampoco lo acepta).
    if (exam.noBack && n < position) box.disabled = true;
  });
  const last = position >= boxes.length - 1;
  const prev = document.querySelector('[data-exam-nav="prev"]');
  prev.hidden = exam.noBack || position === 0;
  prev.disabled = examState.navigating;
  const next = document.querySelector('[data-exam-nav="next"]');
  next.hidden = last;
  next.disabled = examState.navigating;
  next.textContent = exam.randomOrder ? 'Guardar y siguiente aleatoria ›' : 'Guardar y siguiente ›';
  $('#quizSubmit').hidden = !last;
  $('#examProgress').textContent = `Pregunta ${Math.min(position + 1, boxes.length)} de ${boxes.length}`;
  boxes[position]?.querySelector('input')?.focus({ preventScroll: true });
}

async function examNavigate(direction) {
  const state = examState;
  if (!state || state.navigating) return;
  const boxes = document.querySelectorAll('#quizAttempt fieldset[data-position]');
  const previousPosition = state.position;
  const destination = direction === 'next' ? Math.min(previousPosition + 1, boxes.length - 1) : state.exam.noBack ? previousPosition : Math.max(previousPosition - 1, 0);
  if (destination === previousPosition) return;
  if (direction === 'next') {
    if (state.exam.noBack) {
      const answered = [...boxes[previousPosition].querySelectorAll('input, select, textarea')].some((i) => (i.type === 'radio' || i.type === 'checkbox' ? i.checked : i.value.trim()));
      // Confirmación dentro de la página: la ventana nativa (confirm) le quita el foco a la página y en el celular el
      // aviso de «salió» llegaba después de cerrarla, así que pasar de pregunta contaba como una salida (12.32).
      state.navigating = true;
      const ok = await examConfirm(answered ? '¿Pasar a la siguiente pregunta? Ya no podrás regresar a esta.' : 'No contestaste esta pregunta. ¿Pasar a la siguiente? Ya no podrás regresar.', 'Pasar a la siguiente');
      state.navigating = false;
      if (!ok || examState !== state) return;
    }
  }
  state.position = destination;
  state.navigating = true;
  for (const button of document.querySelectorAll('[data-exam-nav]')) button.disabled = true;
  // Primero se guarda (con la respuesta de la pregunta que se deja), luego se bloquea.
  try {
    await saveExamProgress();
  } catch (error) {
    state.position = previousPosition;
    return toast('No se pudo guardar tu respuesta. Revisa tu conexión y vuelve a intentarlo.');
  } finally {
    state.navigating = false;
    for (const button of document.querySelectorAll('[data-exam-nav]')) button.disabled = false;
  }
  showExamQuestion();
  window.scrollTo?.(0, 0);
}

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'examStart') return;
  e.preventDefault();
  enterFullscreen(); // debe pedirse en el mismo clic
  const form = e.target;
  const error = form.querySelector('.form-error');
  const button = form.querySelector('button');
  const q = find(detail);
  button.disabled = true;
  try {
    const extra = { password: form.password?.value || '' };
    if (quizSettings(q).exam?.checksLocation) {
      button.textContent = 'Obteniendo ubicación…';
      const place = await currentLocation(12000);
      extra.location = place.location || null;
      extra.locationError = place.error || '';
    }
    await startQuizAttempt(q.id, extra);
  } catch (err) {
    // El intento ya se cerró (por ejemplo, se acabó el tiempo): la plataforma se libera.
    if (err.status === 409) releaseActiveExam();
    if (isFullscreen()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
    error.textContent = err.message;
    error.hidden = false;
    button.disabled = false;
    button.textContent = 'Comenzar examen';
  }
});

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-exam-here]') || !examState) return;
  // Reabrir aquí: el servidor bloquea el intento y lo pasa a este dispositivo (hará falta el código del docente).
  const quizId = examState.quizId;
  hideExamLock();
  stopExam();
  try {
    await startQuizAttempt(quizId, {});
  } catch (error) {
    toast(error.message);
  }
});

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-exam-nav]');
  if (nav) examNavigate(nav.dataset.examNav);
  if (e.target.closest('[data-exam-fullscreen]')) enterFullscreen();
});

// Evaluación (sin modo examen) que pide el código de la sección.
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-quiz-code]');
  if (!form) return;
  e.preventDefault();
  const error = form.querySelector('.form-error');
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    await startQuizAttempt(form.dataset.quizCode, { password: form.password.value.trim() });
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    button.disabled = false;
  }
});

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-quiz-start]');
  if (!b || busy) return;
  try {
    await startQuizAttempt(b.dataset.quizStart);
  } catch (error) {
    toast(error.message);
  }
});

// «Más acciones» (12.36): se cierra al elegir una opción o al tocar fuera.
document.addEventListener('click', (e) => {
  for (const menu of document.querySelectorAll('details.more-actions[open]')) {
    if (!menu.contains(e.target) || e.target.closest('.more-actions-panel button')) menu.open = false;
  }
});
