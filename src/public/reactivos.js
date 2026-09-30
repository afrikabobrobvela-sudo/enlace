/* Tipos de reactivos (12.21): editor, lo que contesta el alumno y la vista del docente de cada tipo.
 * «Elección múltiple» (choice) y «Aritmética» (numeric) siguen dibujándose en evaluaciones.js; aquí están los demás.
 * El servidor (src/server/reactivos.js) valida y califica: el navegador nunca conoce las respuestas del alumno ajenas
 * ni la clave de cada pregunta.
 */

const QUESTION_TYPES = [
  ['choice', 'Elección múltiple'],
  ['truefalse', 'Verdadero o falso'],
  ['fill', 'Para completar'],
  ['multi', 'Selección múltiple'],
  ['matching', 'Coincidencia'],
  ['ordering', 'Ordenamiento'],
  ['essay', 'Respuesta escrita'],
  ['short', 'Respuesta corta'],
  ['numeric', 'Aritmética'],
  ['sigfig', 'Cifras significativas'],
  ['multishort', 'Varias respuestas cortas'],
];
const QUESTION_TYPE_NAME = Object.fromEntries(QUESTION_TYPES);
const NEW_QUESTION_TYPES = ['truefalse', 'multi', 'fill', 'matching', 'ordering', 'essay', 'short', 'multishort', 'sigfig'];
const isNewType = (type) => NEW_QUESTION_TYPES.includes(type);
const MULTI_LETTERS = 'ABCDEFGHIJ';
const lines = (value) => String(value || '').split('\n').map((x) => x.trim()).filter(Boolean);

function blankNewQuestion(type) {
  switch (type) {
    case 'truefalse':
      return { type, text: '', correct: true };
    case 'multi':
      return { type, text: '', options: ['', '', ''], correct: [], scoring: 'all' };
    case 'fill':
      return { type, text: '', exact: false };
    case 'matching':
      return { type, text: '', pairs: [{ left: '', right: '' }, { left: '', right: '' }], extra: [], scoring: 'partial' };
    case 'ordering':
      return { type, text: '', items: [], scoring: 'partial' };
    case 'essay':
      return { type, text: '', guide: '' };
    case 'short':
      return { type, text: '', answers: [], exact: false };
    case 'multishort':
      return { type, text: '', answers: [], boxes: 2, exact: false };
    case 'sigfig':
      return { type, text: '', answer: '', tolerance: 1, unit: '', variables: [], figures: 3, penalty: 50 };
  }
  return { type: 'choice', text: '', options: ['', ''], correct: 0 };
}

const scoringSelect = (q, all, partial) =>
  `<label>Calificación<select data-f="scoring"><option value="all" ${q.scoring === 'all' ? 'selected' : ''}>${all}</option><option value="partial" ${q.scoring === 'partial' ? 'selected' : ''}>${partial}</option></select></label>`;
const exactCheck = (q) => `<label class="check-label"><input type="checkbox" data-f="exact" ${q.exact ? 'checked' : ''}> Distinguir mayúsculas y acentos</label>`;

/** Campos del editor propios de cada tipo nuevo. `numericBody` es el de «Aritmética» (lo reutiliza «Cifras significativas»). */
function newQuestionBodyHtml(q, i, numericBody) {
  switch (q.type) {
    case 'truefalse':
      return `<div class="quiz-options"><label class="check-label"><input type="radio" name="correct_${i}" value="true" ${q.correct !== false ? 'checked' : ''}> Verdadero</label>
        <label class="check-label"><input type="radio" name="correct_${i}" value="false" ${q.correct === false ? 'checked' : ''}> Falso</label></div><p class="muted">Marca la respuesta correcta.</p>`;
    case 'multi':
      return `<div class="quiz-options">${q.options
        .map(
          (o, k) => `<div class="quiz-option"><input type="checkbox" data-correct="${k}" ${q.correct.includes(k) ? 'checked' : ''} aria-label="Opción ${MULTI_LETTERS[k]} correcta">
            <span class="quiz-letter">${MULTI_LETTERS[k]}</span><input data-o="${k}" value="${esc(o)}" required maxlength="1500" placeholder="Opción ${MULTI_LETTERS[k]}">
            ${q.options.length > 2 ? `<button type="button" class="danger-link" data-quiz="remove-option" data-option="${k}" aria-label="Quitar opción ${MULTI_LETTERS[k]}">×</button>` : ''}</div>`,
        )
        .join('')}</div>
        ${q.options.length < 10 ? '<button type="button" class="text-btn" data-quiz="add-option">＋ Opción</button>' : ''}
        <p class="muted">Marca con la casilla todas las opciones correctas; el alumno puede elegir varias.</p>
        <label>Calificación<select data-f="scoring">${[
          ['all', 'Todo o nada (solo si elige exactamente las correctas)'],
          ['partial', 'Parcial (correctas elegidas menos incorrectas)'],
          ['each', 'Por opción (cada opción bien marcada o bien sin marcar vale lo mismo, como «Respuestas correctas» de Brightspace)'],
        ]
          .map(([v, label]) => `<option value="${v}" ${q.scoring === v ? 'selected' : ''}>${label}</option>`)
          .join('')}</select></label>`;
    case 'fill':
      return `<p class="muted">Escribe en el enunciado cada espacio entre dobles corchetes con su respuesta: «La unidad de fuerza es el [[newton]]». Si se aceptan varias, sepáralas con una barra: [[newton|N]]. Cada espacio vale lo mismo.</p>${exactCheck(q)}`;
    case 'matching':
      return `<div class="quiz-pairs">${q.pairs
        .map(
          (p, k) => `<div class="quiz-pair" data-pair="${k}"><input data-p="left" value="${esc(p.left)}" required maxlength="500" placeholder="Elemento ${k + 1} (por ejemplo: Fuerza)">
            <span aria-hidden="true">↔</span><input data-p="right" value="${esc(p.right)}" required maxlength="500" placeholder="Su pareja (por ejemplo: N)">
            ${q.pairs.length > 2 ? `<button type="button" class="danger-link" data-quiz="remove-pair" data-pair-index="${k}" aria-label="Quitar pareja ${k + 1}">×</button>` : ''}</div>`,
        )
        .join('')}</div>
        ${q.pairs.length < 10 ? '<button type="button" class="text-btn" data-quiz="add-pair">＋ Pareja</button>' : ''}
        <label>Respuestas de más (opcional, una por renglón; no le corresponden a ningún elemento)<textarea data-f="extra" rows="2">${esc((q.extra || []).join('\n'))}</textarea></label>
        <label class="check-label"><input type="checkbox" data-f="reuse" ${q.reuse ? 'checked' : ''}> Una misma respuesta puede ser la pareja de varios elementos (se muestra una sola vez)</label>
        ${scoringSelect(q, 'Todo o nada', 'Parcial (cada pareja vale lo mismo)')}`;
    case 'ordering':
      return `<label>Elementos en el orden correcto (uno por renglón; el alumno los recibe revueltos)<textarea data-f="items" rows="4" required>${esc((q.items || []).join('\n'))}</textarea></label>
        ${scoringSelect(q, 'Todo o nada', 'Parcial (cada elemento en su lugar vale lo mismo)')}`;
    case 'essay':
      return `<label>Guía para calificar (opcional; solo la ves tú)<textarea data-f="guide" rows="2" maxlength="3000">${esc(q.guide || '')}</textarea></label>
        <p class="muted">El alumno escribe su respuesta y tú la calificas después, desde «Revisar respuestas escritas» en la evaluación. Mientras tanto cuenta 0.</p>`;
    case 'short':
      return `<label>Respuestas aceptadas (una por renglón)<textarea data-f="answers" rows="3" required>${esc((q.answers || []).join('\n'))}</textarea></label>${exactCheck(q)}
        <label>Tolerancia numérica (opcional; si la respuesta es un número, se acepta a esta distancia: con 0.1, 2.1 acepta de 2.0 a 2.2)<input data-f="tolerance" type="number" min="0" step="any" value="${esc(q.tolerance ?? '')}"></label>`;
    case 'multishort':
      return `<div class="quiz-grid"><label>Espacios para responder<input data-f="boxes" type="number" min="1" max="10" value="${esc(q.boxes)}"></label></div>
        <label>Respuestas aceptadas (una por renglón; alternativas de la misma con barra: metro|m)<textarea data-f="answers" rows="4" required>${esc((q.answers || []).join('\n'))}</textarea></label>
        <p class="muted">Cada espacio vale lo mismo; escribir dos veces la misma respuesta cuenta una sola vez.</p>${exactCheck(q)}`;
    case 'sigfig':
      return `${numericBody}<div class="quiz-grid"><label>Cifras significativas<input data-f="figures" type="number" min="1" max="10" value="${esc(q.figures)}"></label>
        <label>Descuento si el valor es correcto pero no las cifras (%)<input data-f="penalty" type="number" min="0" max="100" value="${esc(q.penalty)}"></label></div>
        <p class="muted">El alumno puede escribir 0.0450, 4.50e-2 o 1.20e3: se cuentan las cifras tal como las escribe (en 1200 los ceros finales no cuentan).</p>`;
  }
  return '';
}

/** Lee del editor los campos propios del tipo. */
function readNewQuestionBody(box, type, i, readNumeric) {
  const get = (f) => box.querySelector(`[data-f="${f}"]`);
  const scoring = get('scoring')?.value;
  switch (type) {
    case 'truefalse':
      return { correct: box.querySelector(`input[name="correct_${i}"]:checked`)?.value !== 'false' };
    case 'multi':
      return {
        options: [...box.querySelectorAll('[data-o]')].map((x) => x.value),
        correct: [...box.querySelectorAll('[data-correct]:checked')].map((x) => Number(x.dataset.correct)),
        scoring,
      };
    case 'fill':
      return { exact: get('exact')?.checked === true };
    case 'matching':
      return {
        pairs: [...box.querySelectorAll('[data-pair]')].map((row) => ({ left: row.querySelector('[data-p="left"]').value, right: row.querySelector('[data-p="right"]').value })),
        extra: lines(get('extra')?.value),
        scoring,
        ...(get('reuse')?.checked ? { reuse: true } : {}),
      };
    case 'ordering':
      return { items: lines(get('items')?.value), scoring };
    case 'essay':
      return { guide: get('guide')?.value || '' };
    case 'short': {
      const tolerance = get('tolerance')?.value;
      return { answers: lines(get('answers')?.value), exact: get('exact')?.checked === true, ...(tolerance !== undefined && tolerance !== '' ? { tolerance: Number(tolerance) } : {}) };
    }
    case 'multishort':
      return { answers: lines(get('answers')?.value), boxes: Number(get('boxes')?.value || 1), exact: get('exact')?.checked === true };
    case 'sigfig':
      return { ...readNumeric(), figures: Number(get('figures')?.value || 0), penalty: Number(get('penalty')?.value || 0) };
  }
  return {};
}

/** Acciones del editor de los tipos nuevos (parejas; las opciones las maneja evaluaciones.js). */
function newQuestionAction(action, q, target) {
  if (action === 'add-pair' && q.pairs.length < 10) q.pairs.push({ left: '', right: '' });
  if (action === 'remove-pair') q.pairs.splice(Number(target.dataset.pairIndex), 1);
}

// ---- Vista del docente -----------------------------------------------------------------------------------

/** Detalle de la respuesta correcta (página de la evaluación y banco). */
function newQuestionAnswerHtml(x) {
  switch (x.type) {
    case 'truefalse':
      return `<p>Respuesta: <b>${x.correct ? 'Verdadero' : 'Falso'}</b></p>`;
    case 'multi':
      return `<ol type="A">${x.options.map((o, j) => `<li>${esc(o)} ${x.correct.includes(j) ? '✓' : ''}</li>`).join('')}</ol><p class="muted">${x.scoring === 'partial' ? 'Crédito parcial' : x.scoring === 'each' ? 'Por opción' : 'Todo o nada'}</p>`;
    case 'fill':
      return `<p class="muted">Espacios: ${[...String(x.text).matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => `<code>${esc(m[1])}</code>`).join(' · ')}${x.exact ? ' · distingue mayúsculas y acentos' : ''}</p>`;
    case 'matching':
      return `<ul>${x.pairs.map((p) => `<li>${esc(p.left)} ↔ <b>${esc(p.right)}</b></li>`).join('')}</ul>${x.extra?.length ? `<p class="muted">De más: ${x.extra.map(esc).join(', ')}</p>` : ''}${x.reuse ? '<p class="muted">Las respuestas repetidas se muestran una vez.</p>' : ''}`;
    case 'ordering':
      return `<ol>${x.items.map((o) => `<li>${esc(o)}</li>`).join('')}</ol>`;
    case 'essay':
      return `<p class="muted">Respuesta escrita: la calificas tú.${x.guide ? ` Guía: ${esc(x.guide)}` : ''}</p>`;
    case 'short':
      return `<p>Se acepta: ${x.answers.map((a) => `<code>${esc(a)}</code>`).join(' · ')}${x.tolerance !== undefined ? ` · tolerancia ±${esc(x.tolerance)}` : ''}</p>`;
    case 'multishort':
      return `<p>${x.boxes} ${x.boxes === 1 ? 'respuesta' : 'respuestas'} de: ${x.answers.map((a) => `<code>${esc(a)}</code>`).join(' · ')}</p>`;
    case 'sigfig':
      return `<p>Respuesta: <code>${esc(x.answer)}</code> ${x.unit ? esc(x.unit) : ''} · ${x.figures} cifras significativas · tolerancia ${esc(x.tolerance)} % · descuento ${esc(x.penalty)} %</p>${
        x.variables?.length ? `<p class="muted">Datos por alumno: ${x.variables.map((v) => `${esc(v.name)} entre ${esc(v.min)} y ${esc(v.max)}`).join('; ')}</p>` : ''
      }`;
  }
  return '';
}

// ---- Lo que contesta el alumno ------------------------------------------------------------------------------

/** Campos para contestar una pregunta de tipo nuevo (en la evaluación o el examen). */
function newAnswerInputHtml(x, required) {
  const name = `q_${x.index}`;
  switch (x.type) {
    case 'truefalse':
      return `<label><input type="radio" ${required} name="${name}" value="0"> Verdadero</label><label><input type="radio" ${required} name="${name}" value="1"> Falso</label>`;
    case 'multi':
      return `<p class="muted quiz-hint">Elige todas las que sean correctas.</p>${x.options.map((o, j) => `<label><input type="checkbox" name="${name}" value="${j}"> ${esc(o)}</label>`).join('')}`;
    case 'fill':
      return `<p class="quiz-fill">${x.parts
        .map((part, k) => esc(part) + (k < x.parts.length - 1 ? `<input class="quiz-blank" name="${name}_${k}" ${required} autocomplete="off" aria-label="Espacio ${k + 1}">` : ''))
        .join('')}</p>`;
    case 'matching':
      return `<div class="quiz-match">${x.lefts
        .map(
          (left, k) => `<label class="quiz-match-row"><span>${esc(left)}</span><select name="${name}_${k}" ${required}><option value="">Elige…</option>${x.rights
            .map((r, j) => `<option value="${j}">${esc(r)}</option>`)
            .join('')}</select></label>`,
        )
        .join('')}</div>`;
    case 'ordering':
      return `<p class="muted quiz-hint">Pon el número de lugar de cada uno (1 = primero).</p><div class="quiz-match">${x.items
        .map(
          (item, k) => `<label class="quiz-match-row"><span>${esc(item)}</span><select name="${name}_${k}" ${required}><option value="">Lugar…</option>${x.items
            .map((_, p) => `<option value="${p}">${p + 1}</option>`)
            .join('')}</select></label>`,
        )
        .join('')}</div>`;
    case 'essay':
      return `<textarea class="quiz-essay" name="${name}" rows="6" maxlength="10000" ${required} placeholder="Escribe tu respuesta"></textarea>`;
    case 'short':
      return `<label class="quiz-number"><input name="${name}" autocomplete="off" ${required} maxlength="300" placeholder="Tu respuesta"></label>`;
    case 'multishort':
      return `<div class="quiz-boxes">${Array.from({ length: x.boxes }, (_, k) => `<input name="${name}_${k}" autocomplete="off" ${required} maxlength="300" placeholder="Respuesta ${k + 1}">`).join('')}</div>`;
    case 'sigfig':
      return `<p class="muted quiz-hint">Responde con ${x.figures} cifras significativas.</p><label class="quiz-number"><input name="${name}" inputmode="decimal" autocomplete="off" ${required} placeholder="Tu respuesta"> ${x.unit ? `<span>${esc(x.unit)}</span>` : ''}</label>`;
  }
  return '';
}

const blankCount = (x) => (x.type === 'fill' ? x.parts.length - 1 : x.type === 'matching' ? x.lefts.length : x.type === 'ordering' ? x.items.length : x.type === 'multishort' ? x.boxes : 0);

/** Respuesta de una pregunta de tipo nuevo (undefined si no contestó nada). */
function collectNewAnswer(form, x) {
  const name = `q_${x.index}`;
  switch (x.type) {
    case 'truefalse': {
      const v = form.get(name);
      return v === null ? undefined : Number(v);
    }
    case 'multi': {
      const chosen = form.getAll(name).map(Number);
      return chosen.length ? chosen : undefined;
    }
    case 'fill':
    case 'multishort': {
      const list = Array.from({ length: blankCount(x) }, (_, k) => String(form.get(`${name}_${k}`) || ''));
      return list.some((v) => v.trim()) ? list : undefined;
    }
    case 'matching':
    case 'ordering': {
      const list = Array.from({ length: blankCount(x) }, (_, k) => {
        const v = form.get(`${name}_${k}`);
        return v === null || v === '' ? null : Number(v);
      });
      return list.some((v) => v !== null) ? list : undefined;
    }
    default: {
      const v = form.get(name);
      return v === null || !String(v).trim() ? undefined : String(v);
    }
  }
}

/** Vuelve a poner en el formulario una respuesta guardada (al retomar un examen). */
function restoreNewAnswer(root, x, value) {
  const name = `q_${x.index}`;
  const set = (field, v) => {
    const input = root.querySelector(`[name="${field}"]`);
    if (input && v !== null && v !== undefined) input.value = String(v);
  };
  if (x.type === 'truefalse') {
    const input = root.querySelector(`[name="${name}"][value="${Number(value)}"]`);
    if (input) input.checked = true;
  } else if (x.type === 'multi') {
    for (const j of Array.isArray(value) ? value : []) {
      const input = root.querySelector(`[name="${name}"][value="${Number(j)}"]`);
      if (input) input.checked = true;
    }
  } else if (Array.isArray(value)) value.forEach((v, k) => set(`${name}_${k}`, v));
  else set(name, value);
}

// ---- Resultados ----------------------------------------------------------------------------------------------

/** Marca de una pregunta en el resultado: ✓, ✗, parcial o por revisar. */
function creditMark(d) {
  if (d.manual && !d.reviewed) return { cls: 'pending', icon: '⏳', note: ' (por revisar)' };
  const credit = typeof d.credit === 'number' ? d.credit : d.correct ? 1 : 0;
  if (credit >= 1) return { cls: 'ok', icon: '✓', note: '' };
  if (credit <= 0) return { cls: 'bad', icon: '✗', note: '' };
  return { cls: 'partial', icon: '◐', note: ` (${Math.round(credit * 100)} %)` };
}
