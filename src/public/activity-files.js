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
function renderEditor() {
  const t = find(detail), d = t?.data || {};
  $('#main').innerHTML = `<div class="crumbs"><button data-section="tasks">❮ Volver a asignaciones</button></div><form id="taskEditor" class="real-form"><div class="editor-layout"><section class="editor-main"><h1>${t ? 'Editar actividad' : 'Nueva actividad'}</h1>${field('Título de la asignación', 'title', d.title || '', 'text', 'required maxlength="200"')}<p class="muted">Calificación máxima: 10 puntos</p>${field('Fecha de vencimiento', 'due', localDate(d.due), 'datetime-local')}${attachmentPanel(true)}${richTextarea('Instrucciones', 'body', d.body || '', { images: true })}<p class="muted">Adjunta aquí la guía, plantilla, lectura o rúbrica que deben descargar tus alumnos.</p></section><section class="editor-sidebar"><details open><summary>Visibilidad</summary><div class="details-body">${visible(d.visible, undefined, d.sections)}</div></details>${conditionsEditorHtml(t)}<details open><summary>Fechas y disponibilidad</summary><div class="details-body">${field('Disponible desde', 'start', localDate(d.start), 'datetime-local')}${field('Cierre de entregas', 'end', localDate(d.end), 'datetime-local')}<p class="muted">Las fechas son opcionales. El vencimiento marca entregas tardías; el cierre bloquea nuevos envíos.</p>${sectionDatesHtml(t?.id, 'task')}</div></details><details open><summary>Envío y finalización</summary><div class="details-body"><label>Tipo de entrega<select name="submissionMode">${[['both', 'Texto y/o archivos'], ['files', 'Archivos obligatorios'], ['text', 'Solo texto']].map(([v, n]) => `<option value="${v}" ${(d.submissionMode || 'both') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label>Máximo de archivos por entrega<select name="maxFiles">${[1, 2, 3, 4, 5].map(n => `<option ${(d.maxFiles || 5) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>${field('Extensiones permitidas (opcional)', 'extensions', (d.extensions || []).join(', '), 'text', 'placeholder="pdf, docx, jpg"')}<p class="muted">Déjalo vacío para permitir cualquier formato. Tamaño máximo: 20 MB por archivo.</p><label class="check-label"><input type="checkbox" name="allowResubmit" ${d.allowResubmit !== false ? 'checked' : ''}> Permitir actualizar la entrega</label><p class="muted">Se conserva la entrega más reciente. Si el alumno la actualiza, deberá calificarse nuevamente.</p><label>Individual o por equipo<select name="groupCategory"><option value="">Individual</option>${[...new Set([...records('group').map(g => g.data.category), d.groupCategory].filter(Boolean))].map(c => `<option value="${esc(c)}" ${d.groupCategory === c ? 'selected' : ''}>Por equipo: ${esc(c)}</option>`).join('')}</select></label><p class="muted">Por equipo: lo que entregue un integrante cuenta para todo su equipo, y puedes calificar al equipo completo. Los equipos se forman en Grupos.</p><label>Rúbrica<select name="rubric" id="rubricPicker"><option value="">Sin rúbrica</option>${d.rubric ? `<option value="${esc(d.rubric)}" selected>${esc(records('rubric').find(r => r.id === d.rubric)?.data.title || 'Rúbrica asignada')}</option>` : ''}</select></label></div></details><details><summary>Evaluación y comentarios</summary><div class="details-body"><p>Escala de 0 a 10 con retroalimentación escrita.</p></div></details></section></div><p class="form-error error" hidden></p><div class="editor-bottom"><button class="primary" type="submit">Guardar y cerrar</button><button type="button" class="secondary" data-section="tasks">Cancelar</button>${t ? trashButton('task', t.id, 'Eliminar actividad') : ''}</div></form>`;
  const files = attachmentManager($('#taskEditor'), d.fileIds || []);
  richAttachments = files;
  bindForm('#taskEditor', async (f) => {
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
      maxFiles: Number(f.get('maxFiles')),
      extensions: f.get('extensions'),
      allowResubmit: f.get('allowResubmit') === 'on',
      groupCategory: f.get('groupCategory') || '',
      rubric: f.get('rubric') || null
    }, t);
    await saveSectionDates('task', saved.id, readSectionDates(f));
    section = 'tasks';
  });
  fillRubricPicker($('#rubricPicker'), d.rubric);
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
