/* Evaluaciones: editor (opción múltiple y numéricas con datos aleatorios), intentos del alumno con tiempo límite
 * y resultados para el docente. La calificación siempre la hace el servidor. */

let quizDraft = null; // preguntas del editor abierto
let quizTimer = null; // cronómetro del intento en curso
let quizLastResult = null; // resultado del último intento enviado (se muestra al volver a dibujar la pantalla)
let examState = null; // examen en curso: posición, respuestas, salidas de la pantalla por enviar

const QUIZ_LETTERS = 'ABCDEF';
const quizSettings = (q) => ({ attempts: 1, timeLimit: 0, shuffle: false, exam: null, ...(q?.data.settings || {}) });
const EXAM_RADII = [100, 150, 300, 500];

function quizSettingsText(settings) {
  const parts = [settings.attempts === 1 ? 'Un intento' : `${settings.attempts} intentos (cuenta el mejor)`];
  parts.push(settings.timeLimit ? `${settings.timeLimit} minutos por intento` : 'sin tiempo límite');
  if (settings.shuffle) parts.push('preguntas en orden aleatorio');
  if (settings.exam?.enabled) parts.push(`modo examen${settings.exam.oneByOne ? (settings.exam.noBack ? ', una pregunta a la vez sin regresar' : ', una pregunta a la vez') : ''}`);
  return parts.join(' · ');
}

/** Lo que el alumno ve en la lista: su mejor resultado o que está pendiente (y si es en modo examen). */
function quizStudentStatus(q) {
  const settings = quizSettings(q);
  const attempts = records('attempt').filter((a) => a.data.quiz === q.id);
  if (attempts.length) {
    const best = Math.max(...attempts.map((a) => a.data.score));
    const left = settings.attempts - attempts.length;
    return `${best.toFixed(2)} / 10${left > 0 ? ` · ${left === 1 ? 'queda 1 intento' : `quedan ${left} intentos`}` : ''}`;
  }
  return settings.exam?.enabled ? 'Pendiente · modo examen' : 'Pendiente';
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

/** ¿Cuenta en la calificación? Solo con categorías: la evaluación entra a una categoría con su valor en puntos. */
function quizGradeHtml(grade) {
  const settings = gradingSettings();
  const cats = settings.scheme === 'categories' ? settings.categories.filter((c) => c.source !== 'attendance') : [];
  if (!cats.length) {
    return `<fieldset class="quiz-settings"><legend>Calificación</legend><p class="muted">Para que esta evaluación cuente en el promedio, organiza la calificación del curso por categorías (Calificaciones → Administrar calificaciones). Mientras tanto, sus resultados se ven aquí y en «Mis calificaciones» sin sumarse.</p></fieldset>`;
  }
  const policy = grade?.policy || 'best';
  return `<fieldset class="quiz-settings"><legend>Calificación</legend><div class="quiz-grid">
    <label>Cuenta en la calificación<select name="gradeCategory"><option value="">No cuenta (solo práctica)</option>${cats
      .map((c) => `<option value="${esc(c.id)}" ${grade?.category === c.id ? 'selected' : ''}>${esc(c.name)} (${c.weight} %)</option>`)
      .join('')}</select></label>
    <label>Valor dentro de la categoría (puntos)<input name="gradePoints" type="number" min="0.1" max="1000" step="0.1" value="${esc(grade?.points ?? 10)}"></label>
    <label>Con varios intentos, cuenta<select name="gradePolicy">${Object.entries(QUIZ_POLICIES)
      .map(([k, v]) => `<option value="${k}" ${policy === k ? 'selected' : ''}>${v}</option>`)
      .join('')}</select></label></div>
    <p class="muted">Vale lo mismo que una actividad con esos puntos en su categoría. Si un alumno no la contesta, no cuenta (no se toma como cero).</p></fieldset>`;
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
      examSettingsHtml(settings.exam) +
      quizGradeHtml(old?.data.grade) +
      visible(old?.data.visible ?? false, old?.data.publishAt || '') +
      `<div id="quizQuestions"></div><button type="button" class="secondary" data-quiz="add-question">＋ Agregar pregunta</button>
       <p class="pending-message">Una evaluación con respuestas recibidas no permite modificar las preguntas.</p>` +
      (old ? `<p class="modal-danger">${trashButton('quiz', old.id, 'Eliminar evaluación')}</p>` : ''),
    (f) =>
      save(
        'quiz',
        {
          title: f.get('title'),
          body: f.get('body'),
          visible: f.get('visible') === 'on',
          publishAt: iso(f.get('publishAt')),
          grade: f.get('gradeCategory') ? { category: f.get('gradeCategory'), points: Number(f.get('gradePoints')), policy: f.get('gradePolicy') } : null,
          settings: { attempts: Number(f.get('attempts')), timeLimit: Number(f.get('timeLimit')), shuffle: f.get('shuffle') === 'on', exam: readExamSettings(f) },
          questions: readQuizQuestions(),
        },
        old,
      ),
  );
  renderQuizQuestions();
}

// ---- Configuración del modo examen (editor) ----------------------------------------------------

function examSettingsHtml(exam) {
  const place = exam?.place || null;
  return `<fieldset class="quiz-settings exam-settings"><legend>Modo examen</legend>
    <label class="check-label"><input type="checkbox" name="exam" ${exam?.enabled ? 'checked' : ''}> Activar: pantalla completa, sin copiar ni pegar, y registro de cada vez que el alumno sale de la página</label>
    <div class="exam-options" ${exam?.enabled ? '' : 'hidden'}>
      <label>Contraseña para empezar (opcional; la dictas en el salón)<input name="examPassword" value="${esc(exam?.password || '')}" maxlength="30" autocomplete="off" placeholder="Por ejemplo: gauss"></label>
      <label class="check-label"><input type="checkbox" name="oneByOne" ${exam?.oneByOne ? 'checked' : ''}> Una pregunta a la vez</label>
      <label class="check-label"><input type="checkbox" name="noBack" ${exam?.noBack ? 'checked' : ''}> Sin regresar a preguntas anteriores (requiere "una pregunta a la vez")</label>
      <label>Revisar que estén en el salón<select name="examRadius"><option value="0">No revisar la ubicación</option>${EXAM_RADII.map((r) => `<option value="${r}" ${place?.radius === r ? 'selected' : ''}>A menos de ${r} m del salón</option>`).join('')}</select></label>
      <p class="exam-place-row"><button type="button" class="secondary" data-exam-place>Usar mi ubicación actual como salón</button>
        <span class="muted" id="examPlaceStatus">${place ? 'Ubicación del salón guardada.' : 'Sin ubicación del salón.'}</span></p>
      <input type="hidden" name="examPlace" value="${esc(place ? JSON.stringify({ lat: place.lat, lng: place.lng, accuracy: place.accuracy }) : '')}">
      <p class="muted">Para revisar la ubicación, pulsa el botón estando en el salón (por ejemplo, al empezar la clase) y guarda. Nunca impide el examen: quien esté lejos o no dé permiso aparece marcado en los resultados. Ninguna página web puede bloquear otras aplicaciones; el modo examen deja constancia y disuade.</p>
    </div></fieldset>`;
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
  return { enabled: true, password: String(f.get('examPassword') || '').trim(), oneByOne, noBack: oneByOne && f.get('noBack') === 'on', place };
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
  if (e.target.closest('[data-exam-place]')) captureExamPlace();
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
  stopExam(); // si la pantalla se vuelve a dibujar, el intento se retoma con "Comenzar examen" (sin contraseña)
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
      const row = byStudent.get(a.author) || { author: a.author, name: a.data.name, best: 0, count: 0, last: '', integrity: [] };
      row.best = Math.max(row.best, a.data.score);
      row.count++;
      row.last = a.created > row.last ? a.created : row.last;
      if (a.data.integrity) row.integrity.push({ attempt: a.data.attempt || 1, ...a.data.integrity });
      byStudent.set(a.author, row);
    }
    const rows = [...byStudent.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    const exam = settings.exam?.enabled;
    $('#main').innerHTML = `${head}<div class="toolbar">${button('Editar evaluación', 'edit-quiz', q.id, 'secondary')}</div>
      ${exam ? `<section class="exam-monitor" id="examMonitor"><p class="muted">Cargando examen en curso…</p></section>` : ''}${questions}
      <h2>Resultados</h2><div class="table-wrap"><table><thead><tr><th>Alumno</th><th>Mejor calificación</th><th>Intentos</th><th>Último envío</th>${exam ? '<th>Integridad</th>' : ''}</tr></thead><tbody>${
        rows
          .map(
            (r) => `<tr><td>${esc(r.name)}</td><td>${r.best.toFixed(2)} / 10</td><td>${r.count} de ${settings.attempts}</td><td>${fmt(r.last)}</td>${
              exam ? `<td>${integrityCell(r.integrity)}${r.integrity.length ? ` <button type="button" class="table-link" data-integrity="${esc(r.author)}">Detalle</button>` : ''}</td>` : ''
            }</tr>`,
          )
          .join('') || `<tr><td colspan="${exam ? 5 : 4}">No hay intentos registrados.</td></tr>`
      }</tbody></table></div>`;
    if (exam) loadExamMonitor(q.id);
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
  const exam = settings.exam?.enabled ? settings.exam : null;
  $('#main').innerHTML = `${head}${lastHtml}${history}${
    left > 0 && exam
      ? examIntroHtml(exam, attempts.length)
      : left > 0
      ? `<p class="real-status">${attempts.length ? `Te quedan ${left} intento${left === 1 ? '' : 's'}.` : 'Revisa tus respuestas antes de enviar.'}${settings.timeLimit ? ` El tiempo empieza a contar al comenzar y no se detiene si cierras la página.` : ''}</p>
         <button class="primary" data-quiz-start="${esc(q.id)}">${attempts.length ? 'Comenzar otro intento' : 'Comenzar evaluación'}</button>`
      : attempts.length
        ? '<p class="muted">Ya usaste todos tus intentos.</p>'
        : ''
  }<div id="quizAttemptBox"></div>`;
}

async function startQuizAttempt(quizId, extra = {}) {
  const data = await request('/api/attempt/start', { course: current.course.id, quiz: quizId, ...extra });
  const offset = data.serverNow - Date.now();
  const exam = data.exam;
  const required = exam ? '' : 'required'; // en el examen, lo que quede sin contestar cuenta como incorrecto
  const questions = data.questions
    .map(
      (x, n) => `<fieldset class="quiz-question" data-index="${x.index}" data-position="${n}"><legend>${n + 1}. ${esc(x.text)}</legend>${
        x.type === 'numeric'
          ? `<label class="quiz-number"><input name="q_${x.index}" inputmode="decimal" autocomplete="off" ${required} placeholder="Tu respuesta"> ${x.unit ? `<span>${esc(x.unit)}</span>` : ''}</label>`
          : x.options.map((o, j) => `<label><input type="radio" ${required} name="q_${x.index}" value="${j}"> ${esc(o)}</label>`).join('')
      }</fieldset>`,
    )
    .join('');
  document.querySelector('[data-quiz-start]')?.remove();
  document.querySelector('.exam-intro')?.remove();
  $('#quizAttemptBox').innerHTML = `<form id="quizAttempt" class="quiz-attempt ${exam ? 'is-exam' : ''}">
      <div class="quiz-attempt-head"><strong>Intento ${data.attempt}</strong>${exam?.oneByOne ? '<span id="examProgress" class="muted"></span>' : ''}${data.deadline ? '<span class="quiz-clock" id="quizClock" role="timer"></span>' : ''}</div>
      ${exam?.flagged ? '<p class="warning-note">No se pudo confirmar que estés en el salón: tu docente lo verá junto a tu examen.</p>' : ''}
      ${questions}<p class="form-error error" hidden></p>
      ${exam?.oneByOne ? '<div class="exam-nav"><button type="button" class="secondary" data-exam-nav="prev">‹ Anterior</button><button type="button" class="primary" data-exam-nav="next">Siguiente ›</button></div>' : ''}
      <button class="primary" id="quizSubmit">Enviar evaluación</button></form>`;
  const collect = () => {
    const form = new FormData($('#quizAttempt'));
    const answers = {};
    for (const x of data.questions) {
      const value = form.get('q_' + x.index);
      if (value !== null && value !== '') answers[x.index] = x.type === 'numeric' ? value : Number(value);
    }
    return answers;
  };
  const submit = async () => {
    if (exam) await saveExamProgress(true).catch(() => {});
    const answers = collect();
    const result = await request('/api/attempt', { course: current.course.id, quiz: quizId, answers });
    clearInterval(quizTimer);
    stopExam();
    quizLastResult = { quiz: quizId, result };
    return `Evaluación enviada: ${result.data.score.toFixed(2)} / 10.`;
  };
  if (exam) startExam(quizId, data, collect);
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

// ---- Modo examen (docente) -----------------------------------------------------------------------

const secondsText = (n) => (n >= 60 ? `${Math.floor(n / 60)} min ${n % 60} s` : `${n} s`);

/** Resumen de una fila de resultados: salidas, pantalla completa, copiar/pegar y ubicación. */
function integrityText(i) {
  const parts = [];
  if (i.exits) parts.push(`salió ${i.exits} ${i.exits === 1 ? 'vez' : 'veces'} (${secondsText(i.awaySeconds)})`);
  if (i.fullscreenExits) parts.push(`dejó pantalla completa ${i.fullscreenExits} ${i.fullscreenExits === 1 ? 'vez' : 'veces'}`);
  if (i.copyAttempts) parts.push(`intentó copiar o pegar ${i.copyAttempts} ${i.copyAttempts === 1 ? 'vez' : 'veces'}`);
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
  const labels = { left: 'Salió de la página', fullscreen: 'Dejó pantalla completa', copy: 'Intentó copiar o pegar' };
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
  const running = data.running
    .map((r) => `<li><strong>${esc(r.name)}</strong> <span class="muted">intento ${r.attempt} · ${r.answered} de ${data.total} contestadas · desde ${esc(new Date(r.started).toLocaleTimeString('es-MX', { timeStyle: 'short' }))}</span>${
      integrityText(r) ? ` <span class="integrity-warn">${esc(integrityText(r))}</span>` : ''
    }</li>`)
    .join('');
  const blocked = data.blocked
    .map((b) => `<li><strong>${esc(b.name)}</strong> <span class="muted">se equivocó 10 veces de contraseña</span> <button type="button" class="table-link" data-exam-unlock="${esc(b.user)}">Desbloquear</button></li>`)
    .join('');
  box.innerHTML = `<div class="exam-monitor-head"><h2>Examen en curso</h2><button type="button" class="secondary" data-exam-refresh>Actualizar</button></div>
    ${running ? `<ul>${running}</ul>` : '<p class="muted">Nadie está contestando en este momento.</p>'}
    ${blocked ? `<h3>Bloqueados</h3><ul>${blocked}</ul>` : ''}`;
}

document.addEventListener('click', async (e) => {
  const detailBtn = e.target.closest('[data-integrity]');
  const unlock = e.target.closest('[data-exam-unlock]');
  try {
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

function examIntroHtml(exam, used) {
  const fullscreen = Boolean(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  return `<section class="exam-intro"><h2>Modo examen</h2><ul>
    <li>${fullscreen ? 'Se abre en pantalla completa. ' : ''}Si sales de la página, cambias de aplicación o de pestaña, queda registrado con la hora y la duración, y tu docente lo verá.</li>
    <li>No se puede copiar, pegar ni usar el menú del botón derecho.</li>
    ${exam.oneByOne ? `<li>Verás una pregunta a la vez${exam.noBack ? ' y <strong>no podrás regresar</strong> a las anteriores' : ''}.</li>` : ''}
    ${exam.checksLocation ? '<li>Se pedirá tu ubicación para confirmar que estás en el salón (solo se guarda la distancia).</li>' : ''}
    <li>Tus respuestas se guardan mientras contestas: si se cierra la página, vuelve a entrar y continúa donde ibas.</li></ul>
    <form id="examStart" class="real-form">
      ${exam.needsPassword ? '<label>Contraseña que dio tu docente<input name="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="30"></label>' : ''}
      <p class="form-error error" hidden></p>
      <button class="primary">${used ? 'Comenzar otro intento' : 'Comenzar examen'}</button>
    </form></section>`;
}

function enterFullscreen() {
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
  examState = { quizId, attempt: data.attempt, exam, collect, position: exam.position || 0, events: [], awaySince: null, lastCopy: 0, saveTimer: null, ignoreBlur: false };
  document.body.classList.add('exam-running');
  // Respuestas guardadas (al retomar tras recargar).
  for (const [index, value] of Object.entries(exam.answers || {})) {
    const input = document.querySelector(`#quizAttempt [name="q_${index}"]${typeof value === 'number' ? `[value="${value}"]` : ''}`);
    if (!input) continue;
    if (input.type === 'radio') input.checked = true;
    else input.value = value;
  }
  showExamQuestion();
  const form = $('#quizAttempt');
  form.addEventListener('input', () => queueExamSave());
  form.addEventListener('change', () => queueExamSave());
  for (const type of ['copy', 'cut', 'paste', 'contextmenu', 'dragstart', 'drop']) form.addEventListener(type, examBlockCopy);
  document.addEventListener('visibilitychange', examAwayCheck);
  window.addEventListener('blur', examAwayCheck);
  window.addEventListener('focus', examAwayCheck);
  document.addEventListener('fullscreenchange', examFullscreenCheck);
  document.addEventListener('webkitfullscreenchange', examFullscreenCheck);
  window.addEventListener('beforeunload', examBeforeUnload);
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
  document.body.classList.remove('exam-running');
  document.getElementById('examFullscreenBar')?.remove();
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

/** Salir de la página (otra pestaña, otra aplicación, bloquear el teléfono): se registra al volver, con la duración. */
function examAwayCheck() {
  if (!examState || examState.ignoreBlur) return;
  const away = document.visibilityState === 'hidden' || !document.hasFocus();
  if (away && !examState.awaySince) examState.awaySince = Date.now();
  if (!away && examState.awaySince) {
    const seconds = Math.round((Date.now() - examState.awaySince) / 1000);
    examState.awaySince = null;
    examState.events.push({ kind: 'left', seconds });
    toast(`Saliste del examen ${seconds} s. Quedó registrado.`);
    saveExamProgress(true).catch(() => {});
  }
}

function examFullscreenCheck() {
  if (!examState) return;
  const bar = document.getElementById('examFullscreenBar');
  if (isFullscreen()) return bar?.remove();
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
  } catch (error) {
    state.events.unshift(...events); // se reintenta en el siguiente guardado
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
  document.querySelector('[data-exam-nav="next"]').hidden = last;
  $('#quizSubmit').hidden = !last;
  $('#examProgress').textContent = `Pregunta ${Math.min(position + 1, boxes.length)} de ${boxes.length}`;
  boxes[position]?.querySelector('input')?.focus({ preventScroll: true });
}

async function examNavigate(direction) {
  const state = examState;
  if (!state) return;
  const boxes = document.querySelectorAll('#quizAttempt fieldset[data-position]');
  if (direction === 'next') {
    const current = boxes[state.position];
    const answered = [...current.querySelectorAll('input')].some((i) => (i.type === 'radio' ? i.checked : i.value.trim()));
    if (state.exam.noBack) {
      state.ignoreBlur = true;
      const ok = confirm(answered ? '¿Pasar a la siguiente pregunta? Ya no podrás regresar a esta.' : 'No contestaste esta pregunta. ¿Pasar a la siguiente? Ya no podrás regresar.');
      state.ignoreBlur = false;
      if (!ok) return;
    }
    state.position = Math.min(state.position + 1, boxes.length - 1);
  } else if (!state.exam.noBack) state.position = Math.max(state.position - 1, 0);
  // Primero se guarda (con la respuesta de la pregunta que se deja), luego se bloquea.
  try {
    await saveExamProgress();
  } catch (error) {
    if (state.exam.noBack) {
      state.position--;
      return toast('No se pudo guardar tu respuesta. Revisa tu conexión y vuelve a intentarlo.');
    }
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
    if (isFullscreen()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
    error.textContent = err.message;
    error.hidden = false;
    button.disabled = false;
    button.textContent = 'Comenzar examen';
  }
});

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-exam-nav]');
  if (nav) examNavigate(nav.dataset.examNav);
  if (e.target.closest('[data-exam-fullscreen]')) enterFullscreen();
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
