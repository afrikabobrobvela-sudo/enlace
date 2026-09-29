/* Condiciones de liberación (12.23): en el editor de unidades, materiales, foros, evaluaciones y actividades, quien
 * enseña elige qué debe hacer el alumno antes de ver el elemento (completar o abrir un material, entregar o aprobar
 * una actividad, contestar o aprobar una evaluación). El servidor decide qué ve cada alumno; aquí solo se editan y se
 * describen. `save()` (app.js) lee el editor abierto por su cuenta, como el selector de secciones. */

const CONDITION_LABELS = {
  material_done: 'Completó el material',
  material_opened: 'Abrió el material',
  task_submitted: 'Entregó la actividad',
  task_grade: 'Sacó al menos … en la actividad',
  quiz_done: 'Contestó la evaluación',
  quiz_score: 'Sacó al menos … en la evaluación',
};
const CONDITION_TARGET = { material_done: 'material', material_opened: 'material', task_submitted: 'task', task_grade: 'task', quiz_done: 'quiz', quiz_score: 'quiz' };
const CONDITION_VALUE = ['task_grade', 'quiz_score'];
const CONDITION_OPTION = { task_grade: 'Calificación mínima en la actividad', quiz_score: 'Calificación mínima en la evaluación' };

function conditionTargets(type, selfId) {
  return records(CONDITION_TARGET[type])
    .filter((r) => r.id !== selfId)
    .map((r) => ({ id: r.id, title: r.data.title }));
}

function conditionRowHtml(item, selfId) {
  const type = item.type || 'material_done';
  const targets = conditionTargets(type, selfId);
  return `<div class="cond-row">
    <select data-cond-type aria-label="Condición">${Object.entries(CONDITION_LABELS)
      .map(([k, v]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${esc(CONDITION_OPTION[k] || v)}</option>`)
      .join('')}</select>
    <select data-cond-target aria-label="Elemento" required>${targets.length ? '' : '<option value="">No hay elementos de este tipo</option>'}${targets
      .map((t) => `<option value="${esc(t.id)}" ${t.id === item.target ? 'selected' : ''}>${esc(t.title)}</option>`)
      .join('')}${item.target && !targets.some((t) => t.id === item.target) ? '<option value="" selected>(elemento eliminado: elige otro)</option>' : ''}</select>
    ${CONDITION_VALUE.includes(type) ? `<label class="cond-value">mínimo<input data-cond-value type="number" min="0" max="10" step="0.1" value="${esc(item.value ?? 6)}" aria-label="Calificación mínima (0 a 10)"></label>` : ''}
    <button type="button" class="danger-link" data-cond-remove aria-label="Quitar condición">×</button></div>`;
}

/** Editor de condiciones (para cualquier editor de elemento). */
function conditionsEditorHtml(old) {
  const c = old?.data.conditions;
  const items = c?.items || [];
  return `<details class="quiz-settings conditions-editor" data-conditions data-self="${esc(old?.id || '')}" ${items.length ? 'open' : ''}><summary>Condiciones de liberación${items.length ? ` (${items.length})` : ' (opcional)'}</summary>
    <p class="muted">Los alumnos lo verán solo cuando cumplan las condiciones. Si no pones ninguna, lo ven como siempre (con su visibilidad, fecha y sección).</p>
    <label>Se muestra cuando se cumplen<select data-cond-mode><option value="all">todas las condiciones</option><option value="any" ${c?.mode === 'any' ? 'selected' : ''}>cualquiera de ellas</option></select></label>
    <div class="cond-rows">${items.map((x) => conditionRowHtml(x, old?.id)).join('')}</div>
    <button type="button" class="text-btn" data-cond-add>＋ Agregar condición</button></details>`;
}

/** Condiciones escritas en un editor (null si no hay). */
function readConditions(root = document.querySelector('#modal[open] [data-conditions], #taskEditor [data-conditions]')) {
  if (!root) return undefined;
  const items = [...root.querySelectorAll('.cond-row')].map((row) => {
    const type = row.querySelector('[data-cond-type]').value;
    const item = { type, target: row.querySelector('[data-cond-target]').value };
    if (CONDITION_VALUE.includes(type)) item.value = Number(row.querySelector('[data-cond-value]')?.value || 0);
    return item;
  });
  if (!items.length) return null;
  if (items.some((x) => !x.target)) throw new Error('Elige el elemento de cada condición de liberación (o quítala).');
  return { mode: root.querySelector('[data-cond-mode]').value === 'any' ? 'any' : 'all', items };
}

/** Descripción para quien enseña: «Completó “Lectura 1” y sacó al menos 6 en “Tarea 2”». */
function conditionsSummary(r) {
  const c = r?.data?.conditions;
  if (!c?.items?.length) return '';
  const parts = c.items.map((x) => {
    const title = find(x.target)?.data.title;
    const name = title ? `«${title}»` : '(elemento eliminado)';
    return `${CONDITION_VALUE.includes(x.type) ? CONDITION_LABELS[x.type].replace('…', String(x.value)) : CONDITION_LABELS[x.type]} ${name}`;
  });
  return `${c.mode === 'any' ? 'Cuando cumpla cualquiera: ' : 'Cuando cumpla: '}${parts.join(c.mode === 'any' ? ' o ' : '; ')}`;
}

/** Etiqueta «Con condiciones» (solo quien enseña), con el detalle al pasar el cursor. */
function conditionsTag(r) {
  if (!teaches() || !r?.data?.conditions?.items?.length) return '';
  const broken = r.data.conditions.items.some((x) => !find(x.target));
  return ` <span class="role-pill conditions-pill ${broken ? 'is-broken' : ''}" title="${esc(conditionsSummary(r))}">${broken ? '⚠ Condición rota' : '🔒 Con condiciones'}</span>`;
}

document.addEventListener('click', (e) => {
  const editor = e.target.closest('[data-conditions]');
  if (!editor) return;
  if (e.target.closest('[data-cond-add]')) {
    const rows = editor.querySelector('.cond-rows');
    if (rows.children.length >= 10) return toast('Pon como máximo 10 condiciones.');
    const type = records('material').length ? 'material_done' : records('task').length ? 'task_submitted' : 'quiz_done';
    rows.insertAdjacentHTML('beforeend', conditionRowHtml({ type }, editor.dataset.self));
    dirty = true;
  }
  if (e.target.closest('[data-cond-remove]')) {
    e.target.closest('.cond-row').remove();
    dirty = true;
  }
});
document.addEventListener('change', (e) => {
  if (!e.target.matches('[data-conditions] [data-cond-type]')) return;
  const row = e.target.closest('.cond-row');
  const editor = e.target.closest('[data-conditions]');
  row.outerHTML = conditionRowHtml({ type: e.target.value }, editor.dataset.self);
});
