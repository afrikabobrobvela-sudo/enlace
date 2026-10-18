function attachmentPanel(teacher = false, where = 'la actividad') {
  return `<section class="attachment-box"><h2>${teacher ? 'Material para tus alumnos' : 'Archivos adjuntos'}</h2><p>${teacher ? `Sube presentaciones PowerPoint (.ppt, .pptx), PDF, Word, Excel, imágenes u otros archivos. Tus alumnos podrán descargarlos desde ${where}.` : 'Selecciona documentos, imágenes, audio o video. Las fotos se reducen solas antes de subirlas.'} También puedes arrastrarlos aquí.</p><div class="file-pickers"><label class="file-picker">Seleccionar archivos<input type="file" multiple data-file-input></label><label class="file-picker camera-picker">Tomar foto<input type="file" accept="image/*" capture="environment" data-camera-input></label></div><label class="check-label photo-merge" hidden><input type="checkbox" data-photo-merge checked> <span>Unir las fotos en un solo PDF, una página por foto (recomendado para tareas a mano)</span></label><p class="muted" data-file-limit></p><ul class="attachment-list" data-file-list></ul><p role="status" data-upload-status></p><progress data-upload-progress hidden max="100" value="0"></progress><p class="error" data-file-error hidden></p></section>`;
}
function attachmentManager(root, existing = [], scope = 'material', max = 5, extensions = []) {
  const box = root.querySelector('.attachment-box'), input = box.querySelector('[data-file-input]'), list = box.querySelector('[data-file-list]'), status = box.querySelector('[data-upload-status]'), progress = box.querySelector('progress'), error = box.querySelector('[data-file-error]');
  const camera = box.querySelector('[data-camera-input]'), mergeRow = box.querySelector('.photo-merge'), mergeBox = box.querySelector('[data-photo-merge]');
  let items = existing.map(id => ({ id, ...current.files.find(f => f.id === id) }));
  const size = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB';
  // Fotos que se unirán en un PDF: se permite si la actividad acepta PDF. Si solo acepta PDF, las fotos se unen siempre.
  const extensionOf = name => String(name || '').split('.').pop().toLowerCase();
  const pdfAllowed = !extensions.length || extensions.includes('pdf');
  const pendingPhotos = () => items.filter(f => !f.id && f.file && isPhoto(f.file));
  const merging = () => pdfAllowed && pendingPhotos().length > 0 && (pendingPhotos().some(f => f.mustMerge) || (pendingPhotos().length > 1 && mergeBox?.checked !== false));
  // Cuántos archivos quedarán al enviar (las fotos unidas cuentan como uno).
  const finalCount = () => items.length - (merging() ? pendingPhotos().length - 1 : 0);
  box.querySelector('[data-file-limit]').textContent = `Máximo ${max} archivo(s), 20 MB cada uno.${extensions.length ? ' Formatos: ' + extensions.join(', ') + '.' : ''}`;
  if (extensions.length)
    input.accept = extensions.map(x => '.' + x).join(',');
  const render = () => {
    const merge = merging();
    list.innerHTML = items.map((f, i) => `<li><div><strong>${esc(f.name || 'Archivo adjunto')}</strong><small>${size(f.size || 0)} · ${f.id ? 'Cargado' : merge && isPhoto(f.file) ? 'Se unirá al PDF' : 'Pendiente de guardar'}</small></div><button type="button" class="text-btn" data-remove-file="${i}" aria-label="Quitar ${esc(f.name)}">Quitar</button></li>`).join('');
    if (mergeRow) {
      const forced = pendingPhotos().some(f => f.mustMerge);
      mergeRow.hidden = !pdfAllowed || (!forced && pendingPhotos().length < 2);
      mergeBox.disabled = forced;
      if (forced) mergeBox.checked = true;
      mergeRow.querySelector('span').textContent = forced
        ? 'Esta actividad recibe PDF: tus fotos se unirán en un solo PDF, una página por foto.'
        : 'Unir las fotos en un solo PDF, una página por foto (recomendado para tareas a mano)';
    }
  };
  function add(files) {
    error.hidden = true;
    for (const file of files) {
      let msg = '';
      const photo = isPhoto(file) && pdfAllowed;
      // Una foto que la actividad no acepta como imagen pero sí como PDF se unirá en un PDF.
      const mustMerge = photo && extensions.length > 0 && !extensions.includes(extensionOf(file.name));
      if (!file.size)
        msg = 'El archivo está vacío.';
      else if (file.size > 20 * 1048576)
        msg = 'Cada archivo debe pesar como máximo 20 MB.';
      else if (extensions.length && !extensions.includes(extensionOf(file.name)) && !mustMerge)
        msg = 'Formato no permitido: ' + file.name;
      else if (photo && pendingPhotos().length >= MAX_PDF_PHOTOS)
        msg = `Puedes unir hasta ${MAX_PDF_PHOTOS} fotos en un PDF.`;
      else {
        // Se agrega y se revisa cuántos archivos quedarían al enviar (las fotos unidas cuentan como uno).
        items.push({ file, name: file.name, size: file.size, mustMerge });
        if (finalCount() > max) {
          items.pop();
          msg = `Puedes adjuntar hasta ${max} archivos.${photo && mergeBox && !mergeBox.checked ? ' Marca «Unir las fotos en un solo PDF» para enviar más fotos.' : ''}`;
        } else
          dirty = true;
      }
      if (msg) {
        error.textContent = msg;
        error.hidden = false;
      }
    }
    input.value = '';
    if (camera) camera.value = '';
    render();
  }
  input.onchange = () => add([...input.files]);
  if (camera) camera.onchange = () => add([...camera.files]);
  if (mergeBox) mergeBox.onchange = () => {
    if (!mergeBox.checked && finalCount() > max) {
      mergeBox.checked = true;
      error.textContent = `Sin unirlas serían más de ${max} archivos: quita algunas fotos antes de desmarcar esta opción.`;
      error.hidden = false;
    }
    render();
  };
  box.ondragover = e => {
    e.preventDefault();
    box.classList.add('dragging');
  };
  box.ondragleave = () => box.classList.remove('dragging');
  box.ondrop = e => {
    e.preventDefault();
    box.classList.remove('dragging');
    if (!busy)
      add([...e.dataTransfer.files]);
  };
  list.onclick = e => {
    const b = e.target.closest('[data-remove-file]');
    if (!b || busy)
      return;
    items.splice(Number(b.dataset.removeFile), 1);
    dirty = true;
    render();
  };
  render();
  const send = (item, onProgress) => new Promise((resolve, reject) => {
    if (previewAsStudent)
      return reject(new Error(PREVIEW_READONLY));
              const xhr = new XMLHttpRequest();
              xhr.open('POST', `/api/upload?course=${encodeURIComponent(current.course.id)}&scope=${scope}`);
              xhr.setRequestHeader('X-Aula-Request', '1');
              xhr.setRequestHeader('X-File-Name', encodeURIComponent(item.name));
              xhr.setRequestHeader('Content-Type', item.file.type || 'application/octet-stream');
              xhr.upload.onprogress = e => {
                if (e.lengthComputable)
                  onProgress(e.loaded / e.total);
              };
              xhr.onerror = () => reject(new Error('No se pudo subir ' + item.name + '. Conserva esta pantalla y vuelve a intentar.'));
              xhr.timeout = 180000;
              xhr.ontimeout = () => reject(new Error('La carga tardó demasiado. Vuelve a intentar.'));
              xhr.onload = () => {
                let r;
                try {
                  r = JSON.parse(xhr.responseText);
                }
                catch {
                  return reject(new Error('Respuesta inesperada al subir el archivo.'));
                }
                if (xhr.status < 200 || xhr.status >= 300)
                  return reject(new Error(r.error || 'No se pudo subir el archivo.'));
                resolve(r.id);
              };
              xhr.send(item.file);
            });
  return {
    /** Ids de los archivos ya subidos (para la vista previa de imágenes insertadas en el texto). */
    ids: () => items.filter(f => f.id).map(f => f.id),
    /** Sube un archivo en este momento (imágenes insertadas en el texto) y lo agrega a la lista. */
    async uploadNow(file) {
      if (items.length >= max)
        throw new Error(`Puedes adjuntar hasta ${max} archivos.`);
      const item = { file: await compressImage(file), name: file.name };
      item.size = item.file.size;
      status.textContent = 'Subiendo ' + item.name;
      progress.hidden = false;
      try {
        item.id = await send(item, p => progress.value = p * 100);
      }
      finally {
        progress.hidden = true;
        status.textContent = '';
      }
      items.push(item);
      current.files.push({ id: item.id, name: item.name, size: item.size, scope, owner: me.id });
      dirty = true;
      render();
      return item;
    },
    async upload() {
      input.disabled = true;
      progress.hidden = false;
      let completed = 0;
      try {
        if (merging()) {
          // Las fotos pendientes se reemplazan por un PDF en el lugar de la primera.
          const photos = pendingPhotos();
          status.textContent = `Uniendo ${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'} en un PDF…`;
          const pdf = await photosToPdf(photos.map(f => f.file), `fotos-${new Date().toISOString().slice(0, 10)}.pdf`);
          if (pdf.size > 20 * 1048576)
            throw new Error('Las fotos juntas pesan más de 20 MB. Quita algunas o envíalas en dos partes.');
          const at = items.indexOf(photos[0]);
          items = items.filter(f => !photos.includes(f));
          items.splice(at, 0, { file: pdf, name: pdf.name, size: pdf.size });
          render();
        }
        if (finalCount() > max)
          throw new Error(`Puedes adjuntar hasta ${max} archivos.`);
        for (const item of items) {
          if (!item.id) {
            status.textContent = 'Subiendo ' + item.name;
            item.file = await compressImage(item.file);
            item.id = await send(item, p => progress.value = (completed + p) / items.length * 100);
          }
          completed++;
          progress.value = items.length ? completed / items.length * 100 : 100;
          render();
        }
        status.textContent = items.length ? 'Archivos cargados. Guardando…' : '';
        return items.map(f => f.id);
      }
      finally {
        input.disabled = false;
      }
    } };
}
function teacherFilesModal(task) {
  if (!teaches() || !task || task.kind !== 'task')
    return;
  let files;
  modal('Material del docente', `<h3>${esc(task.data.title)}</h3>${attachmentPanel(true)}<p class="muted">Puedes quitar un adjunto y seleccionar su reemplazo. Los cambios se publican al guardar y respetan la visibilidad de la actividad.</p>`, async () => {
    const fileIds = await files.upload();
    await save('task', {
      ...task.data,
      extensions: (task.data.extensions || []).join(', '),
      fileIds
    }, task);
    dirty = false;
  }, 'Guardar material');
  files = attachmentManager($('#fields'), task.data.fileIds || [], 'material');
}
/**
 * Editor de actividades al estilo Brightspace (12.76): a la izquierda título, «Calificación de» y vencimiento en una
 * fila, instrucciones y material; a la derecha tres tarjetas plegables con un resumen debajo del título («Fechas y
 * condiciones de disponibilidad», «Envío y finalización», «Evaluación y comentarios»); abajo una barra fija con
 * «Guardar y cerrar», «Guardar», «Cancelar» y el interruptor Visible/Oculto. Los nombres de los campos son los de
 * siempre, así que save() y las secciones/condiciones se leen igual.
 */
function taskEditorCard(key, title, body) {
  return `<details class="bs-card" data-bs-card="${key}"><summary><span class="bs-card-title">${title}</span><span class="bs-card-sum" data-bs-sum="${key}"></span></summary><div class="bs-card-body">${body}</div></details>`;
}

/** Resúmenes de las tarjetas, del estado actual del formulario. */
function taskEditorSummaries(form) {
  const get = (name) => form.querySelector(`[name="${name}"]`);
  const when = (name) => (get(name)?.value ? new Date(get(name).value).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '');
  const start = when('start'), end = when('end');
  const conds = form.querySelectorAll('[data-conditions] .cond-row').length;
  const some = form.querySelector('[name="sectionsMode"][value="some"]')?.checked;
  const dates = [start && `Desde ${start}`, end && `hasta ${end}`].filter(Boolean).join(' ') || 'Siempre disponible';
  const extra = [some && 'algunas secciones', conds && `${conds} ${conds === 1 ? 'condición' : 'condiciones'}`].filter(Boolean);
  const mode = { files: 'Envío de archivos', text: 'Envío de texto', both: 'Envío de archivos o texto' }[get('submissionMode')?.value] || '';
  const team = get('groupCategory')?.value;
  const rubric = get('rubric');
  const sums = {
    fechas: extra.length ? `${dates} · ${extra.join(' · ')}` : dates,
    envio: team ? `${mode} · por equipo` : mode,
    evaluacion: (rubric?.value ? `Rúbrica: ${rubric.selectedOptions[0]?.textContent || ''}` : 'No se agregó ninguna rúbrica') + (form.querySelector('[name="similarity"]')?.checked ? ' · Detector de similitud' : ''),
  };
  for (const [key, text] of Object.entries(sums)) {
    const el = form.querySelector(`[data-bs-sum="${key}"]`);
    if (el) el.textContent = text;
  }
  const toggle = form.querySelector('.bs-visible');
  if (toggle) toggle.querySelector('span').textContent = get('visible').checked ? 'Visible' : 'Oculto';
}

let specialAfterSave = null; // actividad cuya ventana de acceso especial se abre tras guardar
function renderEditor() {
  const t = find(detail), d = t?.data || {};
  const maxScore = d.maxScore ?? 10;
  const maxFiles = d.maxFiles || 5;
  const teams = [...new Set([...records('group').map((g) => g.data.category), d.groupCategory].filter(Boolean))];
  const radio = (name, value, label, checked) => `<label class="check-label"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}> ${label}</label>`;
  const grants = t ? specialGrants('task', t.id).length : 0;
  const fechas = `${field('Fecha de inicio', 'start', localDate(d.start), 'datetime-local')}${field('Fecha final', 'end', localDate(d.end), 'datetime-local')}
    <p class="muted">Antes de la fecha de inicio los alumnos no pueden entregar; después de la fecha final ya no se aceptan entregas. El vencimiento (a la izquierda) solo marca las entregas tardías.</p>
    ${typeof sectionChooserHtml === 'function' ? sectionChooserHtml(d.sections || []) : ''}${sectionDatesHtml(t?.id, 'task')}
    <h3 class="bs-sub">Condiciones de publicación</h3><p class="muted">Los alumnos no pueden ver la actividad hasta que cumplan las condiciones.</p>${conditionsEditorHtml(t)}
    <h3 class="bs-sub">Acceso especial</h3><p class="muted">El acceso especial abre la actividad en otras fechas para algunos alumnos (por ejemplo, una prórroga). ${grants ? `Ahora lo ${grants === 1 ? 'tiene 1 alumno' : `tienen ${grants} alumnos`}.` : 'Nadie lo tiene todavía.'}</p>
    <button class="secondary bs-special" type="submit" value="special">${t ? 'Dar acceso especial…' : 'Guardar y dar acceso especial…'}${grants ? ` <span class="badge-count">${grants}</span>` : ''}</button>
    <p class="muted">${t ? 'Guarda los cambios de la actividad y' : 'Guarda la actividad y'} abre la lista de alumnos.</p>`;
  const envio = `<label>Tipo de asignación<select name="groupCategory"><option value="">Asignación individual</option>${teams.map((c) => `<option value="${esc(c)}" ${d.groupCategory === c ? 'selected' : ''}>Asignación de grupo: ${esc(c)}</option>`).join('')}</select></label>
    <p class="muted">De grupo: lo que entregue un integrante cuenta para todo su equipo y la calificación se aplica al equipo completo. Los equipos se forman en Grupos.</p>
    <label>Tipo de material enviado<select name="submissionMode">${[['files', 'Envío de archivos'], ['text', 'Envío de texto'], ['both', 'Envío de archivos o texto']].map(([v, n]) => `<option value="${v}" ${(d.submissionMode || 'both') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <fieldset class="bs-radios" data-files-only><legend>Archivos permitidos por envío</legend>${radio('maxFiles', 5, 'Hasta 5 archivos', maxFiles === 5)}${maxFiles > 1 && maxFiles < 5 ? radio('maxFiles', maxFiles, `Hasta ${maxFiles} archivos`, true) : ''}${radio('maxFiles', 1, 'Un archivo', maxFiles === 1)}</fieldset>
    <div data-files-only>${field('Extensiones de archivo permitidas', 'extensions', (d.extensions || []).join(', '), 'text', 'placeholder="Sin restricciones (por ejemplo: pdf, docx)"')}<p class="muted">Vacío = sin restricciones. Tamaño máximo: 20 MB por archivo.</p></div>
    <fieldset class="bs-radios"><legend>Envíos</legend>${radio('allowResubmit', 'on', 'Se conserva solamente el envío más reciente', d.allowResubmit !== false)}${radio('allowResubmit', 'off', 'Sólo un envío permitido', d.allowResubmit === false)}</fieldset>
    <p class="muted">Si el alumno reemplaza su envío, deberás calificarlo nuevamente. Recibes un aviso en la campana (y en el celular, si activaste las notificaciones) con cada entrega.</p>`;
  const evaluacion = `<label>Rúbricas<select name="rubric" id="rubricPicker"><option value="">Sin rúbrica</option>${d.rubric ? `<option value="${esc(d.rubric)}" selected>${esc(records('rubric').find((r) => r.id === d.rubric)?.data.title || 'Rúbrica asignada')}</option>` : ''}</select></label>
    ${taskGradebookHtml(d, true)}
    <h3 class="bs-sub">Detector de similitud</h3><label class="check-label"><input type="checkbox" name="similarity" ${d.similarity ? 'checked' : ''}> Revisar las entregas con el detector de similitud</label><p class="muted">Compara entre sí las entregas de esta actividad para encontrar texto copiado. Los alumnos ven un aviso en la actividad.</p>
    <h3 class="bs-sub">Herramientas de anotación</h3><p class="muted">Puedes marcar y escribir sobre los PDF entregados al revisar cada envío; el alumno ve las correcciones cuando publicas la calificación.</p>`;
  $('#main').innerHTML = `<div class="crumbs"><button data-section="tasks">❮ Volver a administrar asignaciones</button></div><form id="taskEditor" class="real-form bs-editor"><div class="editor-layout"><section class="editor-main"><h1>${t ? 'Editar actividad' : 'Nueva actividad'}</h1>${field('Nombre', 'title', d.title || '', 'text', 'required maxlength="200" placeholder="Sin título"')}
      <div class="bs-row"><label>Calificación de<span class="bs-points"><input name="maxScore" type="number" min="0.01" max="1000" step="0.01" value="${esc(maxScore)}" aria-describedby="bsPointsHint"><span>puntos</span></span></label>${field('Fecha de vencimiento', 'due', localDate(d.due), 'datetime-local')}</div>
      <p class="muted" id="bsPointsHint">Calificas sobre estos puntos en el libro; Enlace la convierte a escala de 10.</p>
      ${richTextarea('Instrucciones', 'body', d.body || '', { images: true })}${attachmentPanel(true)}</section>
    <section class="editor-sidebar">${taskEditorCard('fechas', 'Fechas y condiciones de disponibilidad', fechas)}${taskEditorCard('envio', 'Envío y finalización', envio)}${taskEditorCard('evaluacion', 'Evaluación y comentarios', evaluacion)}</section></div>
    <p class="form-error error" hidden></p>
    <div class="editor-bottom"><button class="primary" type="submit" value="close">Guardar y cerrar</button><button class="secondary" type="submit" value="stay">Guardar</button><button type="button" class="secondary" data-section="tasks">Cancelar</button>
      <label class="bs-visible"><input type="checkbox" name="visible" role="switch" ${d.visible !== false ? 'checked' : ''}><span></span></label>${t ? trashButton('task', t.id, 'Eliminar actividad') : ''}</div></form>`;
  const form = $('#taskEditor');
  const files = attachmentManager(form, d.fileIds || []);
  richAttachments = files;
  const filesOnly = () => form.querySelectorAll('[data-files-only]').forEach((el) => (el.hidden = form.querySelector('[name="submissionMode"]').value === 'text'));
  form.addEventListener('change', () => (filesOnly(), taskEditorSummaries(form)));
  form.addEventListener('click', (e) => e.target.closest('[data-cond-add], [data-cond-remove]') && setTimeout(() => taskEditorSummaries(form)));
  filesOnly();
  bindForm('#taskEditor', async (f, submitter) => {
    const max = Number(f.get('maxScore'));
    if (!(max > 0 && max <= 1000)) throw new Error('La calificación debe ser mayor que 0 y hasta 1000 puntos.');
    const fileIds = await files.upload();
    const saved = await save('task', {
      title: f.get('title'),
      body: f.get('body'),
      due: iso(f.get('due')),
      start: iso(f.get('start')),
      end: iso(f.get('end')),
      visible: f.get('visible') === 'on',
      fileIds,
      submissionMode: f.get('submissionMode'),
      maxFiles: Number(f.get('maxFiles')) || 5,
      extensions: f.get('extensions') || '',
      allowResubmit: f.get('allowResubmit') !== 'off',
      groupCategory: f.get('groupCategory') || '',
      rubric: f.get('rubric') || null,
      ...(f.has('gradeCategory') ? { gradebook: { category: f.get('gradeCategory') || null, points: Number(f.get('gradePoints')) || 1 } } : {})
    }, t);
    await saveSectionDates('task', saved.id, readSectionDates(f));
    // «Calificación de»: cambia solo el máximo; las calificaciones ya capturadas conservan su valor sobre 10.
    if (max !== (t?.data.maxScore ?? 10)) {
      const graded = t ? records('submission').filter((x) => x.data.task === t.id && x.data.grade != null).length : 0;
      const rescale = graded > 0 && confirm(`Ya hay ${graded} ${graded === 1 ? 'calificación capturada' : 'calificaciones capturadas'}. ¿Conservar los puntos de cada alumno con el nuevo máximo? (Aceptar = conservar los puntos; Cancelar = conservar la calificación sobre 10.)`);
      await request('/api/task/max', { course: current.course.id, id: saved.id, max, rescale });
    }
    // Detector de similitud (12.82): se guarda aparte, solo si cambió.
    if ((f.get('similarity') === 'on') !== Boolean(t?.data.similarity))
      await request('/api/task/similarity', { course: current.course.id, id: saved.id, enabled: f.get('similarity') === 'on' });
    if (submitter?.value === 'stay' || submitter?.value === 'special') {
      detail = saved.id;
      // El acceso especial se da sobre la actividad ya guardada: la ventana se abre al volver a dibujar el editor.
      if (submitter.value === 'special') specialAfterSave = saved.id;
      return 'Guardado. Puedes seguir editando.';
    }
    section = 'tasks';
  });
  fillRubricPicker($('#rubricPicker'), d.rubric);
  taskEditorSummaries(form);
  if (t && specialAfterSave === t.id) {
    specialAfterSave = null;
    specialAccessModal('task', t.id);
  }
}
function submissionModal(t) {
  const s = records('submission').find(s => s.data.task === t.id && (s.author === viewerKey() || s.data.member === myMember()?.id)), d = t.data;
  if (s && !s.data.manual && d.allowResubmit === false)
    return toast('Esta actividad permite una sola entrega.');
  let manager;
  modal(s ? 'Actualizar entrega' : 'Entregar actividad', `<h3>${esc(d.title)}</h3><p class="deadline">Vence: ${fmt(d.due)}</p>${d.submissionMode === 'files' ? '<p>Adjunta al menos un archivo. Puedes agregar un comentario.</p>' : ''}${textarea(d.submissionMode === 'text' ? 'Tu respuesta' : 'Respuesta o comentario', 'body', s?.data.body || '', d.submissionMode === 'text')}${d.submissionMode === 'text' ? '' : attachmentPanel()}<p class="pending-message">Los archivos se enviarán al pulsar «Enviar entrega». ${s ? 'La actualización reemplaza tu entrega anterior y deja la calificación pendiente.' : 'Podrás consultar los archivos y la fecha de envío en esta actividad.'}</p>`, async (f) => {
    const fileIds = manager ? await manager.upload() : [];
    await save('submission', {
      task: t.id,
      body: f.get('body'),
      fileIds
    }, s);
    dirty = false;
  }, 'Enviar entrega');
  if (d.submissionMode !== 'text')
    manager = attachmentManager($('#fields'), s?.data.fileIds || [], 'submission', d.maxFiles || 5, d.extensions || []);
}
