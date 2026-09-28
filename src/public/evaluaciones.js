/* Evaluaciones: editor (opción múltiple y numéricas con datos aleatorios), intentos del alumno con tiempo límite
 * y resultados para el docente. La calificación siempre la hace el servidor. */

let quizDraft = null; // preguntas del editor abierto
let quizTimer = null; // cronómetro del intento en curso
let quizLastResult = null; // resultado del último intento enviado (se muestra al volver a dibujar la pantalla)

const QUIZ_LETTERS = 'ABCDEF';
const quizSettings = (q) => ({ attempts: 1, timeLimit: 0, shuffle: false, ...(q?.data.settings || {}) });

function quizSettingsText(settings) {
  const parts = [settings.attempts === 1 ? 'Un intento' : `${settings.attempts} intentos (cuenta el mejor)`];
  parts.push(settings.timeLimit ? `${settings.timeLimit} minutos por intento` : 'sin tiempo límite');
  if (settings.shuffle) parts.push('preguntas en orden aleatorio');
  return parts.join(' · ');
}

// ---- Editor ---------------------------------------------------------------------------------------

function blankQuestion(type = 'choice') {
  return type === 'numeric'
    ? { type, text: '', answer: '', tolerance: 1, unit: '', variables: [] }
    : { type: 'choice', text: '', options: ['', ''], correct: 0 };
}

function quizQuestionHtml(q, i) {
  const numeric = q.type === 'numeric';
  const body = numeric
    ? `<div class="quiz-numeric">
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
      </div>`
    : `<div class="quiz-options">${q.options
        .map(
          (o, k) => `<div class="quiz-option"><input type="radio" name="correct_${i}" value="${k}" ${q.correct === k ? 'checked' : ''} aria-label="Respuesta correcta ${QUIZ_LETTERS[k]}">
            <span class="quiz-letter">${QUIZ_LETTERS[k]}</span><input data-o="${k}" value="${esc(o)}" required maxlength="1500" placeholder="Opción ${QUIZ_LETTERS[k]}">
            ${q.options.length > 2 ? `<button type="button" class="danger-link" data-quiz="remove-option" data-option="${k}" aria-label="Quitar opción ${QUIZ_LETTERS[k]}">×</button>` : ''}</div>`,
        )
        .join('')}</div>
      ${q.options.length < 6 ? '<button type="button" class="text-btn" data-quiz="add-option">＋ Opción</button>' : ''}
      <p class="muted">Marca con el círculo la respuesta correcta.</p>`;
  return `<fieldset class="quiz-edit-question" data-question="${i}">
    <legend>Pregunta ${i + 1}</legend>
    <div class="quiz-question-head">
      <label>Tipo<select data-f="type"><option value="choice" ${numeric ? '' : 'selected'}>Opción múltiple</option><option value="numeric" ${numeric ? 'selected' : ''}>Respuesta numérica</option></select></label>
      ${quizDraft.length > 1 ? `<button type="button" class="danger-link" data-quiz="remove-question">Quitar pregunta</button>` : ''}
    </div>
    <label>Enunciado<textarea data-f="text" required maxlength="3000">${esc(q.text)}</textarea></label>
    ${body}
  </fieldset>`;
}

/** Lee del formulario el estado actual de las preguntas. */
function readQuizQuestions() {
  return [...document.querySelectorAll('#quizQuestions [data-question]')].map((box, i) => {
    const get = (f) => box.querySelector(`[data-f="${f}"]`)?.value ?? '';
    if (get('type') === 'numeric') {
      return {
        type: 'numeric',
        text: get('text'),
        answer: get('answer'),
        tolerance: Number(get('tolerance') || 0),
        unit: get('unit'),
        variables: [...box.querySelectorAll('[data-var]')].map((row) => ({
          name: row.querySelector('[data-v="name"]').value.trim(),
          min: Number(row.querySelector('[data-v="min"]').value),
          max: Number(row.querySelector('[data-v="max"]').value),
          decimals: Number(row.querySelector('[data-v="decimals"]').value || 0),
        })),
      };
    }
    const options = [...box.querySelectorAll('[data-o]')].map((input) => input.value);
    const checked = box.querySelector(`input[name="correct_${i}"]:checked`);
    return { type: 'choice', text: get('text'), options, correct: checked ? Number(checked.value) : -1 };
  });
}

function renderQuizQuestions() {
  $('#quizQuestions').innerHTML = quizDraft.map(quizQuestionHtml).join('');
}

function quizModal(old) {
  const settings = quizSettings(old);
  quizDraft = old ? structuredClone(old.data.questions).map((q) => (q.type === 'numeric' ? q : { ...q, type: 'choice' })) : [blankQuestion()];
  modal(
    old ? 'Editar evaluación' : 'Nueva evaluación',
    field('Título', 'title', old?.data.title || '', 'text', 'required') +
      richTextarea('Instrucciones', 'body', old?.data.body || '') +
      `<fieldset class="quiz-settings"><legend>Configuración</legend><div class="quiz-grid">
        <label>Intentos por alumno<input name="attempts" type="number" min="1" max="10" value="${settings.attempts}"></label>
        <label>Tiempo límite (minutos, 0 = sin límite)<input name="timeLimit" type="number" min="0" max="300" value="${settings.timeLimit}"></label>
      </div><label class="check-label"><input type="checkbox" name="shuffle" ${settings.shuffle ? 'checked' : ''}> Presentar las preguntas en orden aleatorio a cada alumno</label></fieldset>` +
      visible(old?.data.visible ?? false) +
      `<div id="quizQuestions"></div><button type="button" class="secondary" data-quiz="add-question">＋ Agregar pregunta</button>
       <p class="pending-message">Con varios intentos cuenta el mejor. Una evaluación con respuestas recibidas no permite modificar las preguntas.</p>` +
      (old ? `<p class="modal-danger">${trashButton('quiz', old.id, 'Eliminar evaluación')}</p>` : ''),
    (f) =>
      save(
        'quiz',
        {
          title: f.get('title'),
          body: f.get('body'),
          visible: f.get('visible') === 'on',
          settings: { attempts: Number(f.get('attempts')), timeLimit: Number(f.get('timeLimit')), shuffle: f.get('shuffle') === 'on' },
          questions: readQuizQuestions(),
        },
        old,
      ),
  );
  renderQuizQuestions();
}

function quizEditorAction(action, target) {
  quizDraft = readQuizQuestions();
  const box = target.closest('[data-question]');
  const q = box ? quizDraft[Number(box.dataset.question)] : null;
  if (action === 'add-question' && quizDraft.length < 50) quizDraft.push(blankQuestion(quizDraft.at(-1)?.type));
  if (action === 'remove-question') quizDraft.splice(Number(box.dataset.question), 1);
  if (action === 'add-option' && q.options.length < 6) q.options.push('');
  if (action === 'remove-option') {
    const k = Number(target.dataset.option);
    q.options.splice(k, 1);
    q.correct = q.correct === k ? 0 : q.correct > k ? q.correct - 1 : q.correct;
  }
  if (action === 'add-var' && (q.variables || []).length < 8) (q.variables ||= []).push({ name: '', min: 1, max: 10, decimals: 0 });
  if (action === 'remove-var') q.variables.splice(Number(target.dataset.varIndex), 1);
  renderQuizQuestions();
  dirty = true;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-quiz]');
  if (b && $('#quizQuestions')) quizEditorAction(b.dataset.quiz, b);
});
document.addEventListener('change', (e) => {
  if (!e.target.matches('#quizQuestions [data-f="type"]')) return;
  quizDraft = readQuizQuestions();
  const i = Number(e.target.closest('[data-question]').dataset.question);
  quizDraft[i] = { ...blankQuestion(e.target.value), text: quizDraft[i].text };
  renderQuizQuestions();
});

// ---- Pantalla de la evaluación -------------------------------------------------------------------

function renderQuiz() {
  clearInterval(quizTimer);
  const q = find(detail);
  if (!q) return renderQuizzes();
  const settings = quizSettings(q);
  const attempts = records('attempt').filter((a) => a.data.quiz === q.id);
  const head = `<button class="back" data-section="quizzes">❮ Evaluaciones</button><h1>${esc(q.data.title)}</h1>${richText(q.data.body)}<p class="quiz-meta">${esc(quizSettingsText(settings))}</p>`;
  if (teaches()) {
    const questions = q.data.questions
      .map((x, i) =>
        x.type === 'numeric'
          ? `<section class="quiz-question"><h3>${i + 1}. ${esc(x.text)}</h3><p>Respuesta: <code>${esc(x.answer)}</code> ${x.unit ? esc(x.unit) : ''} · tolerancia ${esc(x.tolerance)} %</p>${
              x.variables?.length ? `<p class="muted">Datos por alumno: ${x.variables.map((v) => `${esc(v.name)} entre ${esc(v.min)} y ${esc(v.max)}`).join('; ')}</p>` : ''
            }</section>`
          : `<section class="quiz-question"><h3>${i + 1}. ${esc(x.text)}</h3><ol type="A">${x.options.map((o, j) => `<li>${esc(o)} ${j === x.correct ? '✓' : ''}</li>`).join('')}</ol></section>`,
      )
      .join('');
    // Resultados por alumno: mejor calificación y número de intentos.
    const byStudent = new Map();
    for (const a of attempts) {
      const row = byStudent.get(a.author) || { name: a.data.name, best: 0, count: 0, last: '' };
      row.best = Math.max(row.best, a.data.score);
      row.count++;
      row.last = a.created > row.last ? a.created : row.last;
      byStudent.set(a.author, row);
    }
    const rows = [...byStudent.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    $('#main').innerHTML = `${head}<div class="toolbar">${button('Editar evaluación', 'edit-quiz', q.id, 'secondary')}</div>${questions}
      <h2>Resultados</h2><div class="table-wrap"><table><thead><tr><th>Alumno</th><th>Mejor calificación</th><th>Intentos</th><th>Último envío</th></tr></thead><tbody>${
        rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.best.toFixed(2)} / 10</td><td>${r.count} de ${settings.attempts}</td><td>${fmt(r.last)}</td></tr>`).join('') ||
        '<tr><td colspan="4">No hay intentos registrados.</td></tr>'
      }</tbody></table></div>`;
    return;
  }
  const best = attempts.length ? Math.max(...attempts.map((a) => a.data.score)) : null;
  const left = settings.attempts - attempts.length;
  const history = attempts.length
    ? `<div class="quiz-result"><p>Mejor calificación: <b>${best.toFixed(2)} / 10</b></p><ul>${attempts
        .sort((a, b) => (a.data.attempt || 1) - (b.data.attempt || 1))
        .map((a) => `<li>Intento ${a.data.attempt || 1}: ${a.data.score.toFixed(2)} / 10 · ${a.data.correct} de ${a.data.total} correctas · ${fmt(a.created)}</li>`)
        .join('')}</ul></div>`
    : '';
  const last = quizLastResult?.quiz === q.id ? quizLastResult.result : null;
  const lastHtml = last
    ? `<div class="quiz-result is-new"><p>Resultado del intento ${last.data.attempt}: <b>${last.data.score.toFixed(2)} / 10</b> (${last.data.correct} de ${last.data.total} correctas)</p><ul class="quiz-detail">${(last.data.details || [])
        .map((d) => `<li class="${d.correct ? 'ok' : 'bad'}">${d.correct ? '✓' : '✗'} ${esc((q.data.questions[d.index]?.text || '').replace(/\{([A-Za-z_]\w*)\}/g, (m, name) => d.values?.[name] ?? m))}</li>`)
        .join('')}</ul></div>`
    : '';
  $('#main').innerHTML = `${head}${lastHtml}${history}${
    left > 0
      ? `<p class="real-status">${attempts.length ? `Te quedan ${left} intento${left === 1 ? '' : 's'}.` : 'Revisa tus respuestas antes de enviar.'}${settings.timeLimit ? ` El tiempo empieza a contar al comenzar y no se detiene si cierras la página.` : ''}</p>
         <button class="primary" data-quiz-start="${esc(q.id)}">${attempts.length ? 'Comenzar otro intento' : 'Comenzar evaluación'}</button>`
      : attempts.length
        ? '<p class="muted">Ya usaste todos tus intentos.</p>'
        : ''
  }<div id="quizAttemptBox"></div>`;
}

async function startQuizAttempt(quizId) {
  const data = await request('/api/attempt/start', { course: current.course.id, quiz: quizId });
  const offset = data.serverNow - Date.now();
  const questions = data.questions
    .map(
      (x, n) => `<fieldset class="quiz-question" data-index="${x.index}"><legend>${n + 1}. ${esc(x.text)}</legend>${
        x.type === 'numeric'
          ? `<label class="quiz-number"><input name="q_${x.index}" inputmode="decimal" autocomplete="off" required placeholder="Tu respuesta"> ${x.unit ? `<span>${esc(x.unit)}</span>` : ''}</label>`
          : x.options.map((o, j) => `<label><input type="radio" required name="q_${x.index}" value="${j}"> ${esc(o)}</label>`).join('')
      }</fieldset>`,
    )
    .join('');
  document.querySelector('[data-quiz-start]')?.remove();
  $('#quizAttemptBox').innerHTML = `<form id="quizAttempt" class="quiz-attempt">
      <div class="quiz-attempt-head"><strong>Intento ${data.attempt}</strong>${data.deadline ? '<span class="quiz-clock" id="quizClock" role="timer"></span>' : ''}</div>
      ${questions}<p class="form-error error" hidden></p><button class="primary">Enviar evaluación</button></form>`;
  const submit = async () => {
    const form = new FormData($('#quizAttempt'));
    const answers = {};
    for (const x of data.questions) {
      const value = form.get('q_' + x.index);
      if (value !== null && value !== '') answers[x.index] = x.type === 'numeric' ? value : Number(value);
    }
    const result = await request('/api/attempt', { course: current.course.id, quiz: quizId, answers });
    clearInterval(quizTimer);
    quizLastResult = { quiz: quizId, result };
    return `Evaluación enviada: ${result.data.score.toFixed(2)} / 10.`;
  };
  bindForm('#quizAttempt', submit);
  if (data.deadline) {
    const tick = () => {
      const left = Date.parse(data.deadline) - (Date.now() + offset);
      const clock = $('#quizClock');
      if (!clock) return clearInterval(quizTimer);
      const s = Math.max(0, Math.round(left / 1000));
      clock.textContent = `Tiempo restante: ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      clock.classList.toggle('is-low', s < 60);
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

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-quiz-start]');
  if (!b || busy) return;
  try {
    await startQuizAttempt(b.dataset.quizStart);
  } catch (error) {
    toast(error.message);
  }
});
