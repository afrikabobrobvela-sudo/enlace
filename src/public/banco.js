/* Banco de preguntas: preguntas propias por tema (y las que comparten los docentes de la misma academia) para
 * reutilizarlas en evaluaciones de cualquier curso. Pantalla en Evaluaciones → Banco de preguntas, selector dentro del
 * editor de evaluaciones y «Guardar en el banco» desde una evaluación. Todo se valida en el servidor (bank.js). */

let bankState = { scope: 'mine', mine: null, shared: null, hasAcademy: true, search: '', topic: '' };
let bankEditing = null; // pregunta del banco abierta en el editor (null = nueva)

const BANK_TYPE = typeof QUESTION_TYPE_NAME === 'object' ? QUESTION_TYPE_NAME : { choice: 'Elección múltiple', numeric: 'Aritmética' };
const bankImage = (id) => (id ? `<img class="quiz-image bank-thumb" src="/api/file/${esc(id)}?preview=1&bank=1" alt="Imagen de la pregunta" loading="lazy">` : '');
const bankTopicName = (topic) => topic || 'Sin tema';

async function loadBank(scope, force = false) {
  if (bankState[scope] && !force) return bankState[scope];
  const data = await request('/api/bank?scope=' + scope);
  bankState[scope] = data.questions;
  bankState.hasAcademy = data.hasAcademy;
  return data.questions;
}

/** Búsqueda sin acentos ni mayúsculas en enunciado, opciones, tema y autor. */
function bankMatches(item, search, topic) {
  if (topic && item.topic !== topic) return false;
  if (!search) return true;
  const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const haystack = plain([item.question.text, ...(item.question.options || []), item.topic, item.owner].join(' '));
  return plain(search).split(/\s+/).every((word) => haystack.includes(word));
}

function bankQuestionSummary(item) {
  const q = item.question;
  const detail =
    typeof isNewType === 'function' && isNewType(q.type)
      ? newQuestionAnswerHtml(q)
      : q.type === 'numeric'
      ? `Respuesta: <code>${esc(q.answer)}</code>${q.unit ? ' ' + esc(q.unit) : ''} · ±${esc(q.tolerance)} %${q.variables?.length ? ` · datos por alumno: ${q.variables.map((v) => esc(v.name)).join(', ')}` : ''}`
      : `<ol type="A" class="bank-options">${q.options.map((o, j) => `<li class="${j === q.correct ? 'is-correct' : ''}">${esc(o)}${j === q.correct ? ' ✓' : ''}</li>`).join('')}</ol>`;
  return `<p class="bank-text">${esc(q.text)}</p>${bankImage(q.image)}<div class="bank-detail">${detail}</div>`;
}

// ---- Pantalla del banco ----------------------------------------------------------------------------

async function renderBank() {
  if (!teaches()) return renderQuizzes();
  const scope = bankState.scope;
  $('#main').innerHTML = `<button class="back" data-section="quizzes">❮ Evaluaciones</button><h1>Banco de preguntas</h1>
    <div class="home-tabs"><button data-section="quizzes">Administrar evaluaciones</button><button class="active">Banco de preguntas</button></div>
    <p class="muted">Tus preguntas sirven para cualquier curso y semestre. Al agregarlas a una evaluación se copian: cambiar o borrar una pregunta del banco no altera las evaluaciones que ya la usan.</p>
    <p class="muted">Cargando…</p>`;
  let items;
  try {
    items = await loadBank(scope);
  } catch (error) {
    $('#main').querySelector('p.muted:last-child').textContent = error.message;
    return;
  }
  if (section !== 'bank') return; // cambió de pantalla mientras cargaba
  const topics = [...new Set(items.map((i) => i.topic))].sort((a, b) => a.localeCompare(b, 'es'));
  if (bankState.topic && !topics.includes(bankState.topic)) bankState.topic = '';
  const shown = items.filter((i) => bankMatches(i, bankState.search, bankState.topic));
  const groups = new Map();
  for (const item of shown) {
    if (!groups.has(item.topic)) groups.set(item.topic, []);
    groups.get(item.topic).push(item);
  }
  const mine = scope === 'mine';
  const emptyText = mine
    ? 'Tu banco está vacío. Crea preguntas aquí o, desde una evaluación que ya tengas, usa «Guardar en el banco».'
    : bankState.hasAcademy
    ? 'Nadie de tu academia ha compartido preguntas todavía.'
    : 'Para ver las preguntas que comparten tus colegas, indica tu academia: en Inicio, «Completa tu registro».';
  $('#main').innerHTML = `<button class="back" data-section="quizzes">❮ Evaluaciones</button><h1>Banco de preguntas</h1>
    <div class="home-tabs"><button data-section="quizzes">Administrar evaluaciones</button><button class="active">Banco de preguntas</button></div>
    <div class="bank-scope" role="group" aria-label="Qué preguntas ver">
      <button type="button" data-bank-scope="mine" class="${mine ? 'active' : ''}">Mis preguntas${bankState.mine ? ` (${bankState.mine.length})` : ''}</button>
      <button type="button" data-bank-scope="shared" class="${mine ? '' : 'active'}">De mi academia</button></div>
    <div class="toolbar bank-toolbar">${mine ? '<button class="primary" data-bank-new>Nueva pregunta</button><button class="secondary" data-bank-import>Importar preguntas (Brightspace, Word, Excel)</button>' : ''}
      <input type="search" data-bank-search placeholder="Buscar en enunciados y opciones…" aria-label="Buscar pregunta" value="${esc(bankState.search)}">
      <select data-bank-topic aria-label="Tema"><option value="">Todos los temas (${items.length})</option>${topics
        .map((t) => `<option value="${esc(t)}" ${t === bankState.topic ? 'selected' : ''}>${esc(bankTopicName(t))} (${items.filter((i) => i.topic === t).length})</option>`)
        .join('')}</select></div>
    <p class="muted">${mine ? 'Al compartir un tema, lo ven (y pueden usar, sin modificarlo) los docentes de tu academia.' : 'Puedes usarlas en tus evaluaciones desde el editor («Agregar desde el banco»). Solo quien las creó puede modificarlas.'}</p>
    ${
      [...groups.entries()]
        .map(
          ([topic, list]) => `<section class="bank-topic"><div class="bank-topic-head"><h2>${esc(bankTopicName(topic))} <span class="muted">(${list.length})</span></h2>${
            mine
              ? `<div class="row-actions"><button type="button" class="text-btn" data-bank-share="${esc(topic)}" data-shared="${list.every((i) => i.shared) ? '1' : ''}">${list.every((i) => i.shared) ? 'Dejar de compartir' : 'Compartir con mi academia'}</button><button type="button" class="text-btn" data-bank-rename="${esc(topic)}">Renombrar tema</button></div>`
              : ''
          }</div><ul class="bank-list">${list
            .map(
              (item) => `<li class="bank-item"><div class="bank-meta"><span class="bank-type">${BANK_TYPE[item.question.type] || ''}</span>${mine && item.shared ? '<span class="bank-shared">Compartida</span>' : ''}${
                mine ? '' : `<span class="muted">de ${esc(item.owner)}</span>`
              }</div>${bankQuestionSummary(item)}${
                mine ? `<div class="row-actions"><button type="button" class="text-btn" data-bank-edit="${esc(item.id)}">Editar</button><button type="button" class="danger-link" data-bank-delete="${esc(item.id)}">Borrar</button></div>` : ''
              }</li>`,
            )
            .join('')}</ul></section>`,
        )
        .join('') || `<p class="empty">${items.length ? 'Ninguna pregunta coincide con la búsqueda.' : emptyText}</p>`
    }`;
}

/** Editor de una pregunta del banco: el mismo de las evaluaciones, con tema y «compartir». */
function bankQuestionModal(item) {
  bankEditing = item;
  quizEditorMode = 'bank';
  quizDraft = [item ? structuredClone(item.question) : blankQuestion()];
  const topics = [...new Set((bankState.mine || []).map((i) => i.topic).filter(Boolean))];
  modal(
    item ? 'Editar pregunta del banco' : 'Nueva pregunta del banco',
    `<div class="quiz-grid"><label>Tema (por ejemplo, Cinemática)<input name="topic" list="bankTopics" maxlength="80" value="${esc(item?.topic ?? bankState.topic ?? '')}"></label></div>
      <datalist id="bankTopics">${topics.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
      <label class="check-label"><input type="checkbox" name="shared" ${item?.shared ? 'checked' : ''}> Compartir con los docentes de mi academia</label>
      <div id="quizQuestions"></div>`,
    async (f) => {
      const [question] = readQuizQuestions();
      const body = { course: current.course.id, topic: f.get('topic'), shared: f.get('shared') === 'on' };
      if (bankEditing) await request('/api/bank/update', { ...body, id: bankEditing.id, question });
      else {
        const r = await request('/api/bank', { ...body, questions: [question] });
        if (!r.saved) throw new Error('Esa pregunta ya está en tu banco.');
      }
      bankState.mine = null;
      return bankEditing ? 'Pregunta actualizada.' : 'Pregunta guardada en tu banco.';
    },
  );
  renderQuizQuestions();
}

document.addEventListener('click', async (e) => {
  const scope = e.target.closest('[data-bank-scope]');
  if (scope) {
    bankState.scope = scope.dataset.bankScope;
    bankState.topic = '';
    return renderBank();
  }
  if (e.target.closest('[data-bank-new]')) return bankQuestionModal(null);
  if (e.target.closest('[data-bank-import]')) return bankImportModal();
  const save = e.target.closest('[data-bank-save]');
  if (save) return saveQuizToBankModal(find(save.dataset.bankSave));
  const edit = e.target.closest('[data-bank-edit]');
  if (edit) return bankQuestionModal((bankState.mine || []).find((i) => i.id === edit.dataset.bankEdit));
  try {
    const del = e.target.closest('[data-bank-delete]');
    if (del) {
      if (!confirm('¿Borrar esta pregunta de tu banco? Las evaluaciones que ya la usan la conservan.')) return;
      await request('/api/bank/delete', { ids: [del.dataset.bankDelete] });
      bankState.mine = null;
      toast('Pregunta borrada del banco.');
      return renderBank();
    }
    const share = e.target.closest('[data-bank-share]');
    if (share) {
      const shared = !share.dataset.shared;
      const r = await request('/api/bank/topic', { topic: share.dataset.bankShare, shared });
      bankState.mine = null;
      toast(shared ? `Compartiste ${r.changed} ${r.changed === 1 ? 'pregunta' : 'preguntas'} con tu academia.` : 'El tema ya no está compartido.');
      return renderBank();
    }
    const rename = e.target.closest('[data-bank-rename]');
    if (rename) {
      const topic = rename.dataset.bankRename;
      return modal('Renombrar tema', field('Nuevo nombre del tema', 'rename', topic, 'text', 'maxlength="80"'), async (f) => {
        await request('/api/bank/topic', { topic, rename: f.get('rename') });
        bankState.mine = null;
        bankState.topic = '';
        return 'Tema renombrado.';
      });
    }
  } catch (error) {
    toast(error.message);
  }
});

let bankSearchTimer = null;
document.addEventListener('input', (e) => {
  if (!e.target.matches('#main [data-bank-search]')) return;
  clearTimeout(bankSearchTimer);
  bankSearchTimer = setTimeout(async () => {
    bankState.search = e.target.value;
    const position = e.target.selectionStart;
    await renderBank();
    const box = document.querySelector('#main [data-bank-search]');
    box?.focus();
    box?.setSelectionRange(position, position);
  }, 250);
});
document.addEventListener('change', (e) => {
  if (!e.target.matches('#main [data-bank-topic]')) return;
  bankState.topic = e.target.value;
  renderBank();
});

// ---- Selector dentro del editor de evaluaciones ----------------------------------------------------

const bankPickerHtml = () => `<details class="bank-picker" id="bankPicker"><summary>＋ Agregar desde el banco de preguntas</summary>
  <div class="bank-picker-body"><p class="muted">Cargando…</p></div></details>`;

let bankPick = { scope: 'mine', topic: '', search: '', chosen: new Set() };

async function renderBankPicker() {
  const box = document.querySelector('#bankPicker .bank-picker-body');
  if (!box) return;
  let items;
  try {
    items = await loadBank(bankPick.scope);
  } catch (error) {
    box.innerHTML = `<p class="form-error error">${esc(error.message)}</p>`;
    return;
  }
  const topics = [...new Set(items.map((i) => i.topic))].sort((a, b) => a.localeCompare(b, 'es'));
  const shown = items.filter((i) => bankMatches(i, bankPick.search, bankPick.topic));
  box.innerHTML = `<div class="bank-picker-tools">
      <select data-pick-scope aria-label="Qué preguntas"><option value="mine">Mis preguntas</option><option value="shared" ${bankPick.scope === 'shared' ? 'selected' : ''}>Compartidas por mi academia</option></select>
      <select data-pick-topic aria-label="Tema"><option value="">Todos los temas</option>${topics.map((t) => `<option value="${esc(t)}" ${t === bankPick.topic ? 'selected' : ''}>${esc(bankTopicName(t))}</option>`).join('')}</select>
      <input type="search" data-pick-search placeholder="Buscar…" aria-label="Buscar en el banco" value="${esc(bankPick.search)}"></div>
    ${
      shown.length
        ? `<label class="check-label"><input type="checkbox" data-pick-all ${shown.every((i) => bankPick.chosen.has(i.id)) ? 'checked' : ''}> Todas las que se ven (${shown.length})</label>
      <ul class="bank-pick-list">${shown
        .map(
          (i) => `<li><label class="check-label"><input type="checkbox" data-pick="${esc(i.id)}" ${bankPick.chosen.has(i.id) ? 'checked' : ''}>
            <span><b>${esc(bankTopicName(i.topic))}</b> · ${BANK_TYPE[i.question.type]}${i.question.image ? ' · con imagen' : ''}${i.mine ? '' : ` · de ${esc(i.owner)}`}<br>${esc(i.question.text.slice(0, 220))}</span></label></li>`,
        )
        .join('')}</ul>`
        : `<p class="muted">${items.length ? 'Ninguna coincide.' : bankPick.scope === 'mine' ? 'Tu banco está vacío.' : 'No hay preguntas compartidas en tu academia.'}</p>`
    }
    <p class="bank-pick-actions"><button type="button" class="primary" data-pick-add ${bankPick.chosen.size ? '' : 'disabled'}>Agregar ${bankPick.chosen.size || ''} ${bankPick.chosen.size === 1 ? 'pregunta' : 'preguntas'}</button>
      <span class="muted">Llegan con su tema como grupo: abajo, en «Preguntas al azar», eliges cuántas recibe cada alumno.</span></p>`;
}

document.addEventListener(
  'toggle',
  (e) => {
    if (e.target.id !== 'bankPicker' || !e.target.open) return;
    bankPick = { scope: 'mine', topic: '', search: '', chosen: new Set() };
    renderBankPicker();
  },
  true,
);
document.addEventListener('change', (e) => {
  if (!e.target.closest('#bankPicker')) return;
  if (e.target.matches('[data-pick-scope]')) {
    bankPick.scope = e.target.value;
    bankPick.topic = '';
    bankPick.chosen.clear();
  } else if (e.target.matches('[data-pick-topic]')) bankPick.topic = e.target.value;
  else if (e.target.matches('[data-pick]')) {
    if (e.target.checked) bankPick.chosen.add(e.target.dataset.pick);
    else bankPick.chosen.delete(e.target.dataset.pick);
  } else if (e.target.matches('[data-pick-all]')) {
    const items = (bankState[bankPick.scope] || []).filter((i) => bankMatches(i, bankPick.search, bankPick.topic));
    for (const i of items) e.target.checked ? bankPick.chosen.add(i.id) : bankPick.chosen.delete(i.id);
  } else return;
  renderBankPicker();
});
let bankPickTimer = null;
document.addEventListener('input', (e) => {
  if (!e.target.matches('#bankPicker [data-pick-search]')) return;
  clearTimeout(bankPickTimer);
  bankPickTimer = setTimeout(async () => {
    bankPick.search = e.target.value;
    await renderBankPicker();
    const box = document.querySelector('#bankPicker [data-pick-search]');
    box?.focus();
    box?.setSelectionRange(box.value.length, box.value.length);
  }, 250);
});
// Enter en la búsqueda no debe enviar el formulario de la evaluación.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('#bankPicker input')) e.preventDefault();
});
document.addEventListener('click', async (e) => {
  const add = e.target.closest('#bankPicker [data-pick-add]');
  if (!add || !bankPick.chosen.size) return;
  add.disabled = true;
  try {
    const r = await request('/api/bank/use', { course: current.course.id, ids: [...bankPick.chosen] });
    quizDraft = readQuizQuestions();
    // Si el editor solo tenía la pregunta vacía del principio, se reemplaza.
    if (quizDraft.length === 1 && !quizDraft[0].text.trim()) quizDraft = [];
    const room = QUIZ_MAX_QUESTIONS - quizDraft.length;
    quizDraft.push(...r.questions.slice(0, room));
    renderQuizQuestions();
    dirty = true;
    document.getElementById('bankPicker').open = false;
    const skipped = r.questions.length - Math.min(room, r.questions.length);
    toast(
      `Se agregaron ${Math.min(room, r.questions.length)} preguntas.` +
        (skipped ? ` ${skipped} no cupieron (máximo ${QUIZ_MAX_QUESTIONS}).` : '') +
        (r.missingImages ? ` ${r.missingImages} llegaron sin imagen (el archivo ya no existe).` : ''),
    );
  } catch (error) {
    toast(error.message);
    add.disabled = false;
  }
});

// ---- Importar al banco (12.27): CSV de Brightspace (uno o varios, cada uno a un tema) y los demás formatos ----------

let bankImport = { files: [], mode: 'auto' };

function renderBankImportPreview() {
  const box = document.getElementById('bankImportPreview');
  if (!box) return;
  const { files, mode } = bankImport;
  if (!files.length) return (box.innerHTML = '');
  assignImportGroups(files, mode === 'single' ? 'none' : mode, true);
  const items = files.flatMap(({ file, items }) => items.map((r) => ({ ...r, file })));
  const ok = items.filter((r) => r.question);
  const withImages = ok.filter((r) => r.imageFile).length;
  const topics = new Map();
  for (const r of ok) topics.set(r.question.pool || '', (topics.get(r.question.pool || '') || 0) + 1);
  const where = (r) => `${files.length > 1 ? `${r.file}, renglón` : 'Renglón'} ${r.line}`;
  const problems = items.filter((r) => r.error || r.warnings?.length);
  box.innerHTML = `<p class="real-status">${ok.length} de ${items.length} ${items.length === 1 ? 'pregunta se entendió' : 'preguntas se entendieron'}${withImages ? ` (${withImages} con imagen)` : ''}.</p>
    ${mode === 'single' ? '' : `<ul class="bank-import-topics">${[...topics].map(([t, n]) => `<li><b>${esc(bankTopicName(t))}</b>: ${n} ${n === 1 ? 'pregunta' : 'preguntas'}</li>`).join('')}</ul>`}
    ${problems.length ? `<ul class="import-list">${problems.map((r) => `<li class="${r.error ? 'has-error' : ''}">${esc(r.source)}<br><span class="${r.error ? 'error' : 'warning-text'}">${esc(where(r))}: ${esc(r.error || `${r.warnings.join('; ')}.`)}</span></li>`).join('')}</ul>` : ''}`;
}

function bankImportModal() {
  bankImport = { files: [], mode: 'auto' };
  modal(
    'Importar preguntas al banco',
    `<p class="muted">Elige uno o varios archivos: el <b>CSV de la biblioteca de preguntas de Brightspace</b> (se reconocen sus 8 tipos: MC, TF, MS, M, O, SA, FIB y WR; con sus imágenes si viene en un <b>.zip</b>) o preguntas en Word, Excel o texto. Las que ya estén en tu banco no se repiten.</p>
      <label class="secondary file-button">Elegir archivos<input type="file" accept=".zip,.csv,.docx,.xlsx,.txt" multiple data-bank-import-file hidden></label>
      <label>Tema de cada pregunta<select name="topicMode" data-bank-import-mode>
        <option value="auto">Automático (por archivo, o por el ID de Brightspace si un archivo trae varios grupos)</option>
        <option value="file">Uno por archivo (el nombre del archivo)</option>
        <option value="id">Por el ID de Brightspace (QUIM-P01-01 → QUIM-P01)</option>
        <option value="single">Todas en un solo tema…</option></select></label>
      <label data-bank-import-single hidden>Nombre del tema<input name="topic" maxlength="80" placeholder="Por ejemplo: Química — Parcial 1"></label>
      <label class="check-label"><input type="checkbox" name="shared"> Compartir con los docentes de mi academia</label>
      <div id="bankImportPreview"></div>`,
    async (f) => {
      const ok = bankImport.files.flatMap(({ items }) => items).filter((r) => r.question);
      if (!ok.length) throw new Error('Elige al menos un archivo con preguntas.');
      const single = bankImport.mode === 'single';
      if (single && !String(f.get('topic') || '').trim()) throw new Error('Escribe el nombre del tema.');
      // Las imágenes (del ZIP o del Word) se suben como material de este curso antes de guardar (12.33).
      const button = $('#formSave');
      let questions;
      try {
        questions = await importQuestionsWithImages(ok, (n, total) => {
          button.textContent = `Subiendo imagen ${n} de ${total}…`;
        });
      } finally {
        button.textContent = 'Guardar en el banco';
      }
      const byTopic = new Map();
      for (const question of questions) {
        const { pool, ...rest } = question;
        const topic = single ? String(f.get('topic')).trim() : pool || '';
        (byTopic.get(topic) || byTopic.set(topic, []).get(topic)).push(rest);
      }
      let saved = 0;
      let repeated = 0;
      // De 100 en 100 (lo que acepta el servidor por solicitud).
      for (const [topic, questions] of byTopic) {
        for (let i = 0; i < questions.length; i += 100) {
          const r = await request('/api/bank', { course: current.course.id, topic, shared: f.get('shared') === 'on', questions: questions.slice(i, i + 100) });
          saved += r.saved;
          repeated += r.repeated;
        }
      }
      bankState.mine = null;
      bankState.topic = '';
      return `Se guardaron ${saved} ${saved === 1 ? 'pregunta' : 'preguntas'} en ${byTopic.size} ${byTopic.size === 1 ? 'tema' : 'temas'}${repeated ? ` (${repeated} ya estaban)` : ''}.`;
    },
    'Guardar en el banco',
  );
}

document.addEventListener('change', async (e) => {
  if (e.target.matches('[data-bank-import-mode]')) {
    bankImport.mode = e.target.value;
    document.querySelector('[data-bank-import-single]').hidden = e.target.value !== 'single';
    return renderBankImportPreview();
  }
  if (!e.target.matches('[data-bank-import-file]')) return;
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length) return;
  const box = document.getElementById('bankImportPreview');
  box.innerHTML = '<p class="muted">Leyendo…</p>';
  try {
    bankImport.files = await readImportFiles(files);
    renderBankImportPreview();
  } catch (error) {
    box.innerHTML = `<p class="form-error error">${esc(error.message || 'No se pudo leer el archivo.')}</p>`;
  }
});

// ---- Guardar las preguntas de una evaluación en el banco -----------------------------------------------

function saveQuizToBankModal(q) {
  const pools = new Set(q.data.questions.map((x) => x.pool).filter(Boolean));
  modal(
    'Guardar preguntas en el banco',
    `<p class="muted">Quedan en tu banco para usarlas en otras evaluaciones y cursos. Las que ya estén no se repiten.</p>
      <label>Tema<input name="topic" maxlength="80" value="${esc([...pools][0] || q.data.title)}"></label>
      ${pools.size ? '<label class="check-label"><input type="checkbox" name="usePools" checked> Usar el grupo de cada pregunta como tema (si tiene)</label>' : ''}
      <label class="check-label"><input type="checkbox" name="shared"> Compartir con los docentes de mi academia</label>
      <fieldset class="bank-save-list"><legend>Preguntas</legend>${q.data.questions
        .map((x, i) => `<label class="check-label"><input type="checkbox" name="pick" value="${i}" checked> ${i + 1}. ${esc(x.text.slice(0, 160))}${x.pool ? ` <span class="muted">(${esc(x.pool)})</span>` : ''}</label>`)
        .join('')}</fieldset>`,
    async (f) => {
      const picked = f.getAll('pick').map(Number);
      if (!picked.length) throw new Error('Elige al menos una pregunta.');
      const byTopic = new Map();
      for (const i of picked) {
        const x = q.data.questions[i];
        const topic = f.get('usePools') === 'on' && x.pool ? x.pool : f.get('topic');
        if (!byTopic.has(topic)) byTopic.set(topic, []);
        byTopic.get(topic).push(x);
      }
      let saved = 0;
      let repeated = 0;
      for (const [topic, questions] of byTopic) {
        const r = await request('/api/bank', { course: current.course.id, topic, shared: f.get('shared') === 'on', questions });
        saved += r.saved;
        repeated += r.repeated;
      }
      bankState.mine = null;
      return `Se guardaron ${saved} ${saved === 1 ? 'pregunta' : 'preguntas'} en tu banco${repeated ? ` (${repeated} ya estaban)` : ''}.`;
    },
  );
}
