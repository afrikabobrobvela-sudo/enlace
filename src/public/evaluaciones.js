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
const pendingResultText = (data) => (data?.releaseAt ? `Verás tu resultado a partir del ${fmt(data.releaseAt)}` : 'Tu docente publicará la calificación.');

const poolTag = (x) => (x.pool ? ` <span class="quiz-pool-tag">${esc(x.pool)}</span>` : '');

/** Imagen de una pregunta (se sirve con la misma revisión de permisos que cualquier archivo del curso). */
const quizImageHtml = (id, n) => (id ? `<img class="quiz-image" src="/api/file/${esc(id)}?preview=1" alt="Imagen de la pregunta ${n + 1}">` : '');

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
  </fieldset>`;
}

/** Lee del formulario el estado actual de las preguntas. */
function readQuizQuestions() {
  return [...document.querySelectorAll('#quizQuestions [data-question]')].map((box, i) => {
    const get = (f) => box.querySelector(`[data-f="${f}"]`)?.value ?? '';
    const image = get('image') ? { image: get('image') } : {};
    if (get('pool').trim()) image.pool = get('pool').trim();
    if (get('type') === 'numeric') {
      return {
        ...image,
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
    return { type: 'choice', text: get('text'), options, correct: checked ? Number(checked.value) : -1, ...image };
  });
}

function renderQuizQuestions() {
  $('#quizQuestions').innerHTML = quizDraft.map(quizQuestionHtml).join('');
  renderQuizDraw();
}

/** Preguntas al azar: por cada grupo escrito en las preguntas, cuántas recibe cada alumno. */
function renderQuizDraw() {
  const box = document.getElementById('quizDrawBox');
  if (!box) return;
  for (const input of box.querySelectorAll('[data-draw-pool]')) quizDrawCounts.set(input.dataset.drawPool, Number(input.value));
  const sizes = new Map();
  for (const q of quizDraft) if (q.pool?.trim()) sizes.set(q.pool.trim(), (sizes.get(q.pool.trim()) || 0) + 1);
  const pools = document.getElementById('quizPools');
  if (pools) pools.innerHTML = [...sizes.keys()].map((p) => `<option value="${esc(p)}">`).join('');
  if (!sizes.size) {
    box.innerHTML = `<legend>Preguntas al azar</legend><p class="muted">Para que cada alumno reciba preguntas distintas, escribe el mismo grupo en varias preguntas (por ejemplo «Cinemática») y aquí eliges cuántas recibe de cada grupo. Las preguntas del banco llegan con su tema como grupo.</p>`;
    return;
  }
  let total = quizDraft.length;
  const rows = [...sizes].map(([pool, size]) => {
    const count = Math.min(Math.max(quizDrawCounts.get(pool) || size, 1), size);
    total -= size - count;
    return `<label class="draw-row"><span>«${esc(pool)}»: cada alumno recibe</span> <input type="number" data-draw-pool="${esc(pool)}" min="1" max="${size}" value="${count}" aria-label="Preguntas de ${esc(pool)} para cada alumno"> <span>de ${size}</span></label>`;
  });
  box.innerHTML = `<legend>Preguntas al azar</legend>${rows.join('')}<p class="muted">Cada alumno recibe <b>${total} de ${quizDraft.length}</b> preguntas; las que no tienen grupo le tocan a todos. En cada intento se sortean otra vez.</p>`;
}

document.addEventListener('change', (e) => {
  if (e.target.matches('#quizQuestions [data-f="pool"]')) {
    quizDraft = readQuizQuestions();
    renderQuizDraw();
  }
  if (e.target.matches('#quizDrawBox [data-draw-pool]')) renderQuizDraw();
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
  quizEditorMode = 'quiz';
  quizDrawCounts = new Map((settings.draw || []).map((d) => [d.pool, d.count]));
  quizDraft = old ? structuredClone(old.data.questions).map((q) => (q.type === 'numeric' ? q : { ...q, type: 'choice' })) : [blankQuestion()];
  modal(
    old ? 'Editar evaluación' : 'Nueva evaluación',
    field('Título', 'title', old?.data.title || '', 'text', 'required') +
      richTextarea('Instrucciones', 'body', old?.data.body || '') +
      `<fieldset class="quiz-settings"><legend>Configuración</legend><div class="quiz-grid">
        <label>Intentos por alumno<input name="attempts" type="number" min="1" max="10" value="${settings.attempts}"></label>
        <label>Tiempo límite (minutos, 0 = sin límite)<input name="timeLimit" type="number" min="0" max="300" value="${settings.timeLimit}"></label>
      </div><label class="check-label"><input type="checkbox" name="shuffle" ${settings.shuffle ? 'checked' : ''}> Presentar las preguntas en orden aleatorio a cada alumno</label>
      <label class="check-label"><input type="checkbox" name="shuffleOptions" ${settings.shuffleOptions ? 'checked' : ''}> También el orden de las opciones de cada pregunta (distinto para cada alumno)</label></fieldset>
      <fieldset class="quiz-settings"><legend>Fechas y disponibilidad</legend><div class="quiz-grid">
        <label>Fecha de inicio (opcional)<input name="opensAt" type="datetime-local" value="${esc(localDate(settings.opensAt))}"></label>
        <label>Fecha final (opcional)<input name="closesAt" type="datetime-local" value="${esc(localDate(settings.closesAt))}"></label></div>
        <label class="check-label"><input type="checkbox" name="timerFixed" ${settings.timerMode === 'fixed' ? 'checked' : ''}> El tiempo empieza a la hora de inicio, igual para todos (quien entra tarde tiene menos tiempo)</label>
        <p class="muted">Antes del inicio no se puede empezar; en la fecha final termina todo lo que esté en curso y se califica lo que cada alumno dejó guardado.</p></fieldset>
      <fieldset class="quiz-settings"><legend>Qué ve el alumno al terminar</legend>
        <label class="check-label"><input type="checkbox" name="showScore" ${settings.results?.score !== false ? 'checked' : ''}> Su calificación (si lo desmarcas, ve «pendiente» hasta que lo actives)</label>
        <label class="check-label"><input type="checkbox" name="showReview" ${old && settings.results?.review !== 'none' ? 'checked' : ''}> Qué preguntas acertó (ve los enunciados que le tocaron con ✓ y ✗, sin las respuestas correctas)</label>
        <label>Mostrar resultados a partir de (opcional)<input name="releaseAt" type="datetime-local" value="${esc(localDate(settings.results?.releaseAt))}"></label>
        <p class="muted">Si otros grupos aún no presentan, desmarca «Qué preguntas acertó» o pon aquí la fecha y hora en que termina el último grupo: hasta entonces nadie ve su calificación ni sus aciertos, y después se muestran solos.</p></fieldset>` +
      examSettingsHtml(settings.exam) +
      quizGradeHtml(old?.data.grade) +
      visible(old?.data.visible ?? false, old?.data.publishAt || '') +
      `<div id="quizQuestions"></div><datalist id="quizPools"></datalist>
       <div class="quiz-add-row"><button type="button" class="secondary" data-quiz="add-question">＋ Agregar pregunta</button>${bankPickerHtml()}</div>
       <fieldset class="quiz-settings" id="quizDrawBox"></fieldset>
       <p class="pending-message">Una evaluación con respuestas recibidas no permite modificar las preguntas ni las preguntas al azar.</p>` +
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
          settings: {
            attempts: Number(f.get('attempts')),
            timeLimit: Number(f.get('timeLimit')),
            shuffle: f.get('shuffle') === 'on',
            shuffleOptions: f.get('shuffleOptions') === 'on',
            draw: [...document.querySelectorAll('#quizDrawBox [data-draw-pool]')].map((input) => ({ pool: input.dataset.drawPool, count: Number(input.value) })),
            opensAt: iso(f.get('opensAt')),
            closesAt: iso(f.get('closesAt')),
            timerMode: f.get('timerFixed') === 'on' ? 'fixed' : 'attempt',
            results: { score: f.get('showScore') === 'on', review: f.get('showReview') === 'on' ? 'marks' : 'none', releaseAt: iso(f.get('releaseAt')) },
            exam: readExamSettings(f),
          },
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
  if (action === 'add-question' && quizDraft.length < 100) quizDraft.push(blankQuestion(quizDraft.at(-1)?.type));
  if (action === 'remove-question') quizDraft.splice(Number(box.dataset.question), 1);
  if (action === 'add-option' && q.options.length < 6) q.options.push('');
  if (action === 'remove-option') {
    const k = Number(target.dataset.option);
    q.options.splice(k, 1);
    q.correct = q.correct === k ? 0 : q.correct > k ? q.correct - 1 : q.correct;
  }
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
});
// Imagen de una pregunta: se reduce en el teléfono o la computadora (no en el servidor) y se sube como material.
document.addEventListener('change', async (e) => {
  if (!e.target.matches('#quizQuestions [data-quiz-image]')) return;
  const file = e.target.files?.[0];
  const box = e.target.closest('[data-question]');
  if (!file || !box) return;
  const label = e.target.closest('label');
  label.firstChild.textContent = 'Subiendo imagen…';
  try {
    const blob = await compressImage(file);
    const r = await fetch(`/api/upload?course=${encodeURIComponent(current.course.id)}&scope=material`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Aula-Request': '1', 'x-file-name': encodeURIComponent(file.name || 'imagen.jpg'), 'content-type': blob.type || file.type || 'image/jpeg' },
      body: blob,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'No se pudo subir la imagen.');
    quizDraft = readQuizQuestions();
    quizDraft[Number(box.dataset.question)].image = data.id;
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
  const { text, image, pool } = quizDraft[i];
  quizDraft[i] = { ...blankQuestion(e.target.value), text, ...(image ? { image } : {}), ...(pool ? { pool } : {}) };
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
          ? `<section class="quiz-question"><h3>${i + 1}. ${esc(x.text)}${poolTag(x)}</h3>${quizImageHtml(x.image, i)}<p>Respuesta: <code>${esc(x.answer)}</code> ${x.unit ? esc(x.unit) : ''} · tolerancia ${esc(x.tolerance)} %</p>${
              x.variables?.length ? `<p class="muted">Datos por alumno: ${x.variables.map((v) => `${esc(v.name)} entre ${esc(v.min)} y ${esc(v.max)}`).join('; ')}</p>` : ''
            }</section>`
          : `<section class="quiz-question"><h3>${i + 1}. ${esc(x.text)}${poolTag(x)}</h3>${quizImageHtml(x.image, i)}<ol type="A">${x.options.map((o, j) => `<li>${esc(o)} ${j === x.correct ? '✓' : ''}</li>`).join('')}</ol></section>`,
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
    const drawNote = settings.draw?.length
      ? `<p class="real-status">Cada alumno recibe ${questionCountOf(q.data)} de ${q.data.questions.length} preguntas: ${settings.draw
          .map((d) => `${d.count} de «${esc(d.pool)}»`)
          .join(', ')} al azar${questionCountOf(q.data) > settings.draw.reduce((n, d) => n + d.count, 0) ? ' y todas las que no tienen grupo' : ''}.</p>`
      : '';
    $('#main').innerHTML = `${head}<div class="toolbar">${button('Editar evaluación', 'edit-quiz', q.id, 'secondary')}<button class="secondary" data-bank-save="${esc(q.id)}">Guardar en el banco</button></div>
      ${exam ? `<section class="exam-monitor" id="examMonitor"><p class="muted">Cargando examen en curso…</p></section>` : ''}${drawNote}${questions}
      <h2>Resultados</h2><div class="table-wrap"><table><thead><tr><th>Alumno</th><th>Mejor calificación</th><th>Intentos</th><th>Último envío</th>${exam ? '<th>Integridad</th>' : ''}</tr></thead><tbody>${
        rows
          .map(
            (r) => `<tr><td>${esc(r.name)}</td><td>${r.best.toFixed(2)} / 10</td><td>${r.count} de ${settings.attempts}</td><td>${fmt(r.last)}</td>${
              exam ? `<td>${integrityCell(r.integrity)}${r.integrity.length ? ` <button type="button" class="table-link" data-integrity="${esc(r.author)}">Detalle</button>` : ''}</td>` : ''
            }</tr>`,
          )
          .join('') || `<tr><td colspan="${exam ? 5 : 4}">No hay intentos registrados.</td></tr>`
      }</tbody></table></div>`;
    if (exam) {
      loadExamMonitor(q.id);
      // El monitor se actualiza solo cada 10 s mientras está en pantalla (así aparecen los bloqueados y su código).
      clearInterval(examMonitorTimer);
      examMonitorTimer = setInterval(() => {
        if (section !== 'quiz' || detail !== q.id || !document.getElementById('examMonitor')) return clearInterval(examMonitorTimer);
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
        .map((a) => `<li>Intento ${a.data.attempt || 1}: ${a.data.score === null || a.data.score === undefined ? 'enviado' : `${a.data.score.toFixed(2)} / 10 · ${a.data.correct} de ${a.data.total} correctas`} · ${fmt(a.created)}</li>`)
        .join('')}</ul></div>`
    : '';
  const last = quizLastResult?.quiz === q.id ? quizLastResult.result : null;
  const lastHtml = last?.data.hidden
    ? `<div class="quiz-result is-new"><p><b>Tu evaluación se envió.</b> ${pendingResultText(last.data)}</p></div>`
    : last
    ? `<div class="quiz-result is-new"><p>Resultado del intento ${last.data.attempt}: <b>${last.data.score.toFixed(2)} / 10</b> (${last.data.correct} de ${last.data.total} correctas)</p><ul class="quiz-detail">${(last.data.details || [])
        .map((d) => `<li class="${d.correct ? 'ok' : 'bad'}">${d.correct ? '✓' : '✗'} ${esc(quizLastResult.texts?.[d.index] ?? (q.data.questions[d.index]?.text || '').replace(/\{([A-Za-z_]\w*)\}/g, (m, name) => d.values?.[name] ?? m))}</li>`)
        .join('')}</ul></div>`
    : '';
  const exam = settings.exam?.enabled ? settings.exam : null;
  // Fechas de disponibilidad: antes de abrir o después de cerrar no hay botón para empezar.
  const notYet = settings.opensAt && Date.parse(settings.opensAt) > Date.now();
  const closed = settings.closesAt && Date.parse(settings.closesAt) < Date.now();
  $('#main').innerHTML = `${head}${lastHtml}${history}${
    left > 0 && notYet
      ? `<p class="real-status">Esta evaluación se abre el <b>${esc(fmt(settings.opensAt))}</b>. Vuelve a esta página a esa hora.</p>`
      : left > 0 && closed
      ? `<p class="real-status">Esta evaluación cerró el ${esc(fmt(settings.closesAt))}.</p>`
      : left > 0 && exam
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
      (x, n) => `<fieldset class="quiz-question" data-index="${x.index}" data-position="${n}"><legend>${n + 1}. ${esc(x.text)}</legend>${quizImageHtml(x.image, n)}${
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
    let result;
    try {
      result = await request('/api/attempt', { course: current.course.id, quiz: quizId, answers });
    } catch (error) {
      if (error.status === 423) showExamLock();
      if (error.data?.otherDevice) showOtherDevice();
      throw error;
    }
    releaseActiveExam();
    clearInterval(quizTimer);
    stopExam();
    // Los enunciados tal como los vio (con sus datos), para mostrar sus ✓ y ✗ al volver a dibujar la pantalla.
    quizLastResult = { quiz: quizId, result, texts: Object.fromEntries(data.questions.map((x) => [x.index, x.text])) };
    return result.data.score === null || result.data.score === undefined ? `Evaluación enviada. ${pendingResultText(result.data)}` : `Evaluación enviada: ${result.data.score.toFixed(2)} / 10.`;
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
  // Bloqueados al salir: arriba, con el código grande para dictárselo en persona.
  const locked = data.running
    .filter((r) => r.locked)
    .map((r) => `<li class="exam-locked-row"><div><strong>${esc(r.name)}</strong> <span class="muted">bloqueado desde las ${esc(new Date(r.lockedAt).toLocaleTimeString('es-MX', { timeStyle: 'short' }))}${
      r.unlockFailures ? ` · ${r.unlockFailures} ${r.unlockFailures === 1 ? 'código equivocado' : 'códigos equivocados'}` : ''
    }</span></div><span class="exam-unlock-code" aria-label="Código para continuar">${esc(r.unlockCode || '')}</span><button type="button" class="table-link" data-exam-resume="${esc(r.user)}">Permitir continuar</button></li>`)
    .join('');
  const running = data.running
    .filter((r) => !r.locked)
    .map((r) => `<li><strong>${esc(r.name)}</strong> <span class="muted">intento ${r.attempt} · ${r.answered} de ${data.total} contestadas · desde ${esc(new Date(r.started).toLocaleTimeString('es-MX', { timeStyle: 'short' }))}</span>${
      integrityText(r) ? ` <span class="integrity-warn">${esc(integrityText(r))}</span>` : ''
    }</li>`)
    .join('');
  const blocked = data.blocked
    .map((b) => `<li><strong>${esc(b.name)}</strong> <span class="muted">se equivocó 10 veces de contraseña</span> <button type="button" class="table-link" data-exam-unlock="${esc(b.user)}">Desbloquear</button></li>`)
    .join('');
  box.innerHTML = `<div class="exam-monitor-head"><h2>Examen en curso</h2><button type="button" class="secondary" data-exam-refresh>Actualizar</button></div>
    ${locked ? `<h3>Bloqueados por salir de la página</h3><p class="muted">Dile a cada alumno su código (en persona) o pulsa «Permitir continuar».</p><ul class="exam-locked-list">${locked}</ul>` : ''}
    ${running ? `<ul>${running}</ul>` : locked ? '' : '<p class="muted">Nadie está contestando en este momento.</p>'}
    ${blocked ? `<h3>Bloqueados</h3><ul>${blocked}</ul>` : ''}`;
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

/** Lleva al examen abierto y oculta todo lo demás (el servidor tampoco responde otra cosa hasta enviarlo). */
async function goToActiveExam(active) {
  if (!active) return;
  document.body.classList.add('exam-platform-lock');
  if (current?.course.id !== active.course || !current.examOnly) await openCourse(active.course);
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
    ${exam.lockOnLeave ? `<li><strong>Si sales de la página${exam.lockGrace ? ` más de ${exam.lockGrace} segundos` : ''} (otra aplicación, WhatsApp, bloquear el teléfono), el examen se bloquea</strong> y necesitarás un código de tu docente para continuar. El tiempo sigue corriendo. Silencia las notificaciones antes de empezar.</li>` : ''}
    ${exam.checksLocation ? '<li>Se pedirá tu ubicación para confirmar que estás en el salón (solo se guarda la distancia).</li>' : ''}
    <li>Tus respuestas se guardan mientras contestas: si se cierra la página, vuelve a entrar y continúa donde ibas.</li></ul>
    <form id="examStart" class="real-form">
      ${resuming ? '<p class="real-status">Tienes este examen en curso: continúa donde ibas.</p>' : ''}
      ${exam.needsPassword && !resuming ? '<label>Contraseña que dio tu docente<input name="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="30"></label>' : ''}
      <p class="form-error error" hidden></p>
      <button class="primary">${resuming ? 'Continuar examen' : used ? 'Comenzar otro intento' : 'Comenzar examen'}</button>
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
  if (!examState || examState.ignoreBlur) return;
  const away = document.visibilityState === 'hidden' || !document.hasFocus();
  if (away && !examState.awaySince) {
    examState.awaySince = Date.now();
    // Bloqueo al salir: el servidor anota la salida en ese momento (keepalive: llega aunque se cierre la página).
    if (examState.exam.lockOnLeave && !examState.locked) examState.awayRequest = examLockCall('away', {}, true);
  }
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
    if (error.status === 423) showExamLock();
    if (error.data?.otherDevice) showOtherDevice();
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

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-quiz-start]');
  if (!b || busy) return;
  try {
    await startQuizAttempt(b.dataset.quizStart);
  } catch (error) {
    toast(error.message);
  }
});
