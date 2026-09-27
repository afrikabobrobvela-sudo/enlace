/* Rúbricas: banco del docente y de la Academia, editor, evaluación con rúbrica y resultado para el alumno. */

let rubricBank = null; // [{ id, revision, author, mine, data: { title, shared, ownerName, levels, criteria } }]
let rubricDraft = null; // edición en curso en el diálogo
let rubricGrading = null; // { rubric, scores, comments } en la pantalla de revisión
let rubricGradeTouched = false;

const RUBRIC_TEMPLATE = {
  levels: [
    { name: 'Excelente', points: 4 },
    { name: 'Bien', points: 3 },
    { name: 'Suficiente', points: 2 },
    { name: 'Insuficiente', points: 0 },
  ],
  criteria: [{ name: '', descriptors: [] }],
};

async function loadRubricBank() {
  rubricBank ??= (await request('/api/rubrics')).rubrics;
  return rubricBank;
}

async function renderRubricBank(box) {
  if (!box) return;
  try {
    await loadRubricBank();
  } catch (error) {
    box.innerHTML = `<p class="error">${esc(error.message)}</p>`;
    return;
  }
  box.innerHTML = `<p class="muted">Tus rúbricas sirven en todos tus cursos. Las que compartes forman el banco de la Academia: tus colegas pueden usarlas y copiarlas, pero solo tú las editas.</p>
    <div class="action-row"><button type="button" class="primary" data-rubric="new">Nueva rúbrica</button></div>
    ${rubricBank.length
      ? `<div class="table-wrap"><table><thead><tr><th>Rúbrica</th><th>Criterios</th><th>Autor</th><th>Acciones</th></tr></thead><tbody>${rubricBank
          .map((r) => `<tr><td><strong>${esc(r.data.title)}</strong>${r.data.shared ? ' <span class="category-pill">Academia</span>' : ''}</td>
            <td>${r.data.criteria.length}</td><td>${r.mine ? 'Tú' : esc(r.data.ownerName)}</td>
            <td><div class="row-actions">${r.mine ? `<button type="button" class="text-btn" data-rubric="edit" data-id="${r.id}">Editar</button>` : ''}
              <button type="button" class="text-btn" data-rubric="copy" data-id="${r.id}">Copiar</button>
              ${r.mine || me.role === 'admin' ? `<button type="button" class="danger-link" data-rubric="delete" data-id="${r.id}">Eliminar</button>` : ''}</div></td></tr>`)
          .join('')}</tbody></table></div>`
      : '<p class="empty">Todavía no hay rúbricas. Crea la primera, por ejemplo para tus reportes de laboratorio.</p>'}`;
}

// ---- Editor ----------------------------------------------------------------------------------

function rubricEditor(existing, { copy = false } = {}) {
  rubricDraft = {
    id: existing && !copy ? existing.id : null,
    revision: existing && !copy ? existing.revision : null,
    title: existing ? (copy ? `${existing.data.title} (copia)` : existing.data.title) : '',
    shared: existing && !copy ? existing.data.shared : false,
    levels: structuredClone(existing?.data.levels || RUBRIC_TEMPLATE.levels),
    criteria: structuredClone(existing?.data.criteria || RUBRIC_TEMPLATE.criteria),
  };
  modal(
    existing && !copy ? 'Editar rúbrica' : 'Nueva rúbrica',
    '<div id="rubricEditor"></div>',
    async () => {
      syncRubricDraft();
      const body = { title: rubricDraft.title, shared: rubricDraft.shared, levels: rubricDraft.levels, criteria: rubricDraft.criteria };
      if (rubricDraft.id) Object.assign(body, { id: rubricDraft.id, revision: rubricDraft.revision });
      await request('/api/rubric', body);
      rubricBank = null;
      return 'Rúbrica guardada.';
    },
    'Guardar rúbrica',
  );
  drawRubricEditor();
}

function drawRubricEditor() {
  const box = document.getElementById('rubricEditor');
  if (!box) return;
  const d = rubricDraft;
  box.innerHTML = `${field('Título', 'rubricTitle', d.title, 'text', 'required maxlength="120" placeholder="Por ejemplo: reporte de laboratorio"')}
    <label class="check-row"><input type="checkbox" name="rubricShared" ${d.shared ? 'checked' : ''}> Compartir con la Academia</label>
    <div class="table-wrap rubric-editor"><table><thead><tr><th>Criterio</th>${d.levels
      .map((l, j) => `<th><input data-level-name="${j}" value="${esc(l.name)}" aria-label="Nombre del nivel ${j + 1}" maxlength="60" required>
        <span class="rubric-points"><input data-level-points="${j}" type="number" min="0" max="100" step="0.5" value="${esc(l.points)}" aria-label="Puntos del nivel ${j + 1}" class="grade-input"> pts</span></th>`)
      .join('')}<th><span class="sr-only">Quitar</span></th></tr></thead>
    <tbody>${d.criteria
      .map((c, i) => `<tr><td><input data-criterion="${i}" value="${esc(c.name)}" placeholder="Por ejemplo: análisis de datos" aria-label="Criterio ${i + 1}" maxlength="200" required></td>
        ${d.levels.map((_, j) => `<td><textarea data-descriptor="${i}:${j}" rows="2" placeholder="Qué se espera (opcional)" aria-label="Descripción del nivel ${j + 1}">${esc(c.descriptors?.[j] || '')}</textarea></td>`).join('')}
        <td><button type="button" class="danger-link" data-rubric-edit="remove-criterion" data-index="${i}" ${d.criteria.length === 1 ? 'disabled' : ''}>Quitar</button></td></tr>`)
      .join('')}</tbody></table></div>
    <div class="action-row"><button type="button" class="secondary" data-rubric-edit="add-criterion">＋ Criterio</button>
      <button type="button" class="secondary" data-rubric-edit="add-level" ${d.levels.length >= 6 ? 'disabled' : ''}>＋ Nivel</button>
      <button type="button" class="secondary" data-rubric-edit="remove-level" ${d.levels.length <= 2 ? 'disabled' : ''}>− Nivel</button></div>
    <p class="muted">La calificación es la suma de los puntos elegidos entre el máximo posible, en escala de 10.</p>`;
}

function syncRubricDraft() {
  const box = document.getElementById('rubricEditor');
  if (!box || !rubricDraft) return;
  rubricDraft.title = box.querySelector('[name="rubricTitle"]').value;
  rubricDraft.shared = box.querySelector('[name="rubricShared"]').checked;
  box.querySelectorAll('[data-level-name]').forEach((input) => (rubricDraft.levels[input.dataset.levelName].name = input.value));
  box.querySelectorAll('[data-level-points]').forEach((input) => (rubricDraft.levels[input.dataset.levelPoints].points = Number(input.value)));
  box.querySelectorAll('[data-criterion]').forEach((input) => (rubricDraft.criteria[input.dataset.criterion].name = input.value));
  box.querySelectorAll('[data-descriptor]').forEach((area) => {
    const [i, j] = area.dataset.descriptor.split(':').map(Number);
    (rubricDraft.criteria[i].descriptors ||= [])[j] = area.value;
  });
}

// ---- Selector en el editor de actividades ------------------------------------------------------

/** Llena el selector sin perder la rúbrica ya asignada, aunque su autor haya dejado de compartirla. */
async function fillRubricPicker(select, currentId) {
  if (!select) return;
  try {
    await loadRubricBank();
  } catch {
    return;
  }
  const option = (r) => `<option value="${esc(r.id)}" ${r.id === currentId ? 'selected' : ''}>${esc(r.data.title)}</option>`;
  const mine = rubricBank.filter((r) => r.mine);
  const shared = rubricBank.filter((r) => !r.mine);
  const assigned = currentId && !rubricBank.some((r) => r.id === currentId) ? records('rubric').find((r) => r.id === currentId) : null;
  select.innerHTML = `<option value="">Sin rúbrica</option>${assigned ? option(assigned) : ''}
    ${mine.length ? `<optgroup label="Mis rúbricas">${mine.map(option).join('')}</optgroup>` : ''}
    ${shared.length ? `<optgroup label="Banco de la Academia">${shared.map(option).join('')}</optgroup>` : ''}`;
}

// ---- Evaluar con rúbrica -----------------------------------------------------------------------

function rubricForTask(task) {
  return task.data.rubric ? records('rubric').find((r) => r.id === task.data.rubric) || null : null;
}

function rubricTotals() {
  const { rubric, scores } = rubricGrading;
  const top = Math.max(...rubric.data.levels.map((l) => l.points));
  const chosen = scores.filter((s) => s !== null).length;
  const total = scores.reduce((n, s) => n + (s === null ? 0 : rubric.data.levels[s].points), 0);
  return { total, max: top * scores.length, complete: chosen === scores.length, any: chosen > 0 };
}

function rubricTotalText() {
  const t = rubricTotals();
  if (!t.any) return 'Elige un nivel en cada criterio: la calificación se calcula sola.';
  return `${t.total} de ${t.max} puntos${t.complete ? `: ${Math.round((t.total / t.max) * 1000) / 100} de 10` : '. Faltan criterios por evaluar.'}`;
}

function rubricWidgetHtml(task, submission) {
  const rubric = rubricForTask(task);
  rubricGradeTouched = false;
  if (!rubric) {
    rubricGrading = null;
    return '';
  }
  const previous = submission?.data.rubricScores;
  const reuse = previous?.title === rubric.data.title && previous.scores?.length === rubric.data.criteria.length;
  rubricGrading = {
    rubric,
    scores: reuse ? [...previous.scores] : rubric.data.criteria.map(() => null),
    comments: reuse ? previous.items.map((item) => item.comment || '') : rubric.data.criteria.map(() => ''),
  };
  return `<fieldset class="rubric-grade"><legend>Rúbrica: ${esc(rubric.data.title)}</legend>
    ${rubric.data.criteria
      .map((c, i) => `<div class="rubric-criterion"><p class="rubric-name">${esc(c.name)}</p>
        <div class="rubric-levels" role="group" aria-label="${esc(c.name)}">${rubric.data.levels
          .map((l, j) => `<button type="button" class="rubric-level" data-rubric-score="${i}:${j}" aria-pressed="${rubricGrading.scores[i] === j}">
            <strong>${esc(l.name)}</strong> <span>${l.points} pts</span>${c.descriptors?.[j] ? `<small>${esc(c.descriptors[j])}</small>` : ''}</button>`)
          .join('')}</div>
        <input class="rubric-comment" data-rubric-comment="${i}" value="${esc(rubricGrading.comments[i])}" placeholder="Comentario sobre este criterio (opcional)" aria-label="Comentario sobre ${esc(c.name)}" maxlength="1000"></div>`)
      .join('')}
    <p class="rubric-total" id="rubricTotal" aria-live="polite">${rubricTotalText()}</p></fieldset>`;
}

/** Lo que se envía al guardar. Sin ningún nivel elegido, se califica sin rúbrica. */
function collectRubric() {
  if (!rubricGrading) return undefined;
  const t = rubricTotals();
  if (!t.any) return undefined;
  if (!t.complete) throw new Error('Elige un nivel en cada criterio de la rúbrica, o deja todos sin elegir para calificar sin ella.');
  return { scores: rubricGrading.scores, comments: rubricGrading.comments };
}

function rubricResultHtml(scores) {
  if (!scores?.items?.length) return '';
  return `<div class="rubric-result"><h3>Rúbrica: ${esc(scores.title)}</h3><div class="table-wrap"><table>
    <thead><tr><th>Criterio</th><th>Nivel</th><th>Puntos</th></tr></thead>
    <tbody>${scores.items.map((item) => `<tr><td>${esc(item.criterion)}${item.comment ? `<p class="muted">${esc(item.comment)}</p>` : ''}</td><td>${esc(item.level)}</td><td>${item.points} de ${item.max}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="2">Total</td><td>${scores.total} de ${scores.max}</td></tr></tfoot></table></div></div>`;
}

// ---- Eventos -----------------------------------------------------------------------------------

document.addEventListener('click', async (event) => {
  const score = event.target.closest('[data-rubric-score]');
  if (score && rubricGrading) {
    const [i, j] = score.dataset.rubricScore.split(':').map(Number);
    rubricGrading.scores[i] = j;
    score.parentElement.querySelectorAll('[data-rubric-score]').forEach((b) => b.setAttribute('aria-pressed', String(b === score)));
    document.getElementById('rubricTotal').textContent = rubricTotalText();
    const t = rubricTotals();
    const grade = document.querySelector('#reviewForm [name="grade"]');
    if (t.complete && grade && !rubricGradeTouched) grade.value = Math.round((t.total / t.max) * 1000) / 100;
    dirty = true;
    return;
  }
  const edit = event.target.closest('[data-rubric-edit]')?.dataset.rubricEdit;
  if (edit && rubricDraft) {
    syncRubricDraft();
    if (edit === 'add-criterion') rubricDraft.criteria.push({ name: '', descriptors: [] });
    if (edit === 'remove-criterion') rubricDraft.criteria.splice(Number(event.target.dataset.index), 1);
    if (edit === 'add-level') rubricDraft.levels.push({ name: `Nivel ${rubricDraft.levels.length + 1}`, points: 0 });
    if (edit === 'remove-level') {
      rubricDraft.levels.pop();
      rubricDraft.criteria.forEach((c) => c.descriptors?.splice(rubricDraft.levels.length));
    }
    return drawRubricEditor();
  }
  const bank = event.target.closest('[data-rubric]');
  if (!bank) return;
  const rubric = rubricBank?.find((r) => r.id === bank.dataset.id);
  if (bank.dataset.rubric === 'new') rubricEditor(null);
  if (bank.dataset.rubric === 'edit' && rubric) rubricEditor(rubric);
  if (bank.dataset.rubric === 'copy' && rubric) rubricEditor(rubric, { copy: true });
  if (bank.dataset.rubric === 'delete' && rubric) {
    modal(
      'Eliminar rúbrica',
      `<p>Se eliminará <strong>${esc(rubric.data.title)}</strong>. Las actividades que la usan quedarán sin rúbrica; las evaluaciones ya hechas conservan su detalle.</p>`,
      async () => {
        await request('/api/rubric', { id: rubric.id }, 'DELETE');
        rubricBank = null;
        return 'Rúbrica eliminada.';
      },
      'Eliminar rúbrica',
    );
    $('#formSave').classList.add('danger-button');
  }
});

document.addEventListener('input', (event) => {
  const comment = event.target.closest('[data-rubric-comment]');
  if (comment && rubricGrading) rubricGrading.comments[Number(comment.dataset.rubricComment)] = comment.value;
  if (event.target.matches('#reviewForm [name="grade"]')) rubricGradeTouched = true;
});
