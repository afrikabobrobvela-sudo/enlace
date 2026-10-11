/* Actividades interactivas H5P (12.71; servidor en src/server/h5p.js, reproductor en h5p-jugador.js).
 * Un material con un archivo .h5p muestra «Abrir actividad interactiva»: se pide una dirección firmada y el reproductor
 * se abre en un marco aislado. Al terminar, la actividad avisa su resultado: el material queda completado y se guarda
 * la mejor calificación del alumno (aula_progress.score). El docente ve los resultados y los lleva al libro. */

const h5pFilesOf = (record) => (record.data.fileIds || []).map((id) => current.files.find((f) => f.id === id)).filter((f) => f && /\.h5p$/i.test(f.name));
const h5pFrames = new Map(); // ventana del marco → material

function h5pMaterialHtml(record) {
  const files = h5pFilesOf(record);
  if (!files.length) return '';
  const member = !teaches() && typeof myMember === 'function' ? myMember() : null;
  const mine = member && typeof progressOf === 'function' ? progressOf(member.id, record.id) : null;
  const scored = (current.progress || []).filter((p) => p.record === record.id && p.score != null);
  return files
    .map(
      (f) => `<section class="h5p-box" data-h5p-material="${esc(record.id)}" data-h5p-file="${esc(f.id)}">
        <div class="h5p-head"><button type="button" class="primary" data-h5p-open>Abrir actividad interactiva</button>
        ${mine?.score != null ? `<span class="h5p-best">Tu mejor resultado: <strong>${esc(mine.score)}</strong> de 10</span>` : ''}
        ${teaches() ? `<span class="h5p-best">${scored.length} ${scored.length === 1 ? 'alumno la ha terminado' : 'alumnos la han terminado'}</span>
          ${scored.length ? `<button type="button" class="secondary" data-h5p-results>Ver resultados</button><button type="button" class="secondary" data-h5p-gradebook>Llevar al libro de calificaciones</button>` : ''}` : ''}</div>
        <div class="h5p-stage" hidden></div></section>`,
    )
    .join('');
}

async function openH5p(box) {
  const stage = box.querySelector('.h5p-stage');
  stage.hidden = false;
  stage.innerHTML = '<p class="muted">Abriendo la actividad…</p>';
  const { url } = await request(`/api/h5p/token?course=${encodeURIComponent(current.course.id)}&file=${encodeURIComponent(box.dataset.h5pFile)}`);
  const frame = document.createElement('iframe');
  frame.className = 'h5p-frame';
  frame.title = 'Actividad interactiva';
  // Sin allow-same-origin: el contenido del paquete corre con origen opaco (la CSP del servidor también lo impone).
  frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-forms allow-downloads');
  frame.setAttribute('allow', 'fullscreen; autoplay');
  frame.src = url;
  stage.replaceChildren(frame);
  h5pFrames.set(frame.contentWindow, { frame, material: box.dataset.h5pMaterial });
  box.querySelector('[data-h5p-open]').textContent = 'Volver a empezar';
}

window.addEventListener('message', async (event) => {
  const target = h5pFrames.get(event.source);
  if (!target || !event.data?.enlaceH5p) return;
  if (event.data.type === 'height') target.frame.style.height = Math.min(Math.max(Number(event.data.height) || 0, 240), 4000) + 'px';
  if (event.data.type !== 'score' || teaches() || previewAsStudent || previewMember) return;
  const score = Number(event.data.score);
  if (!Number.isFinite(score)) return;
  try {
    await request('/api/progress', { course: current.course.id, record: target.material, action: 'complete', score });
    const member = myMember?.();
    const row = (current.progress ||= []).find((p) => p.member === member?.id && p.record === target.material);
    if (row) Object.assign(row, { completed_at: row.completed_at || new Date().toISOString(), score: Math.max(row.score ?? 0, score) });
    else if (member) current.progress.push({ member: member.id, record: target.material, opened_at: new Date().toISOString(), completed_at: new Date().toISOString(), score });
    toast(`Actividad terminada: ${score} de 10. Se guardó tu resultado.`);
  } catch (error) {
    toast(error.message);
  }
});

function h5pResultsModal(materialId) {
  const record = find(materialId);
  const rows = studentsInView().map((m) => [m, (current.progress || []).find((p) => p.member === m.id && p.record === materialId)]);
  modal(
    `Resultados: ${record?.data.title || 'actividad'}`,
    `<table class="keep-table"><thead><tr><th scope="col">Alumno</th><th scope="col">Mejor resultado</th><th scope="col">Terminó</th></tr></thead><tbody>${rows
      .map(([m, p]) => `<tr><td>${esc(m.name)}</td><td>${p?.score != null ? `${esc(p.score)} de 10` : '<span class="muted">Sin resultado</span>'}</td><td>${p?.completed_at ? esc(fmt(p.completed_at)) : ''}</td></tr>`)
      .join('')}</tbody></table>`,
    null,
  );
}

/** Lleva la mejor calificación de cada alumno a una actividad del libro (la crea la primera vez, después la actualiza). */
async function h5pToGradebook(materialId) {
  const record = find(materialId);
  const grades = (current.progress || []).filter((p) => p.record === materialId && p.score != null && current.members.some((m) => m.id === p.member && m.role === 'student'));
  if (!grades.length) return toast('Todavía nadie ha terminado la actividad.');
  const task = record.data.h5pTask && find(record.data.h5pTask) ? record.data.h5pTask : null;
  if (!confirm(`${task ? 'Se actualizarán' : 'Se creará la actividad «' + record.data.title + '» en el libro con'} las calificaciones de ${grades.length} ${grades.length === 1 ? 'alumno' : 'alumnos'} (su mejor resultado, publicado). ¿Continuar?`)) return;
  const result = await request('/api/grades/import', {
    course: current.course.id,
    publish: true,
    activities: [{ ...(task ? { task } : { title: record.data.title }), grades: grades.map((p) => ({ member: p.member, grade: p.score })) }],
  });
  const created = result.tasks?.[0]?.id || null;
  if (!task && created) await save('material', { ...record.data, h5pTask: created }, record).catch(() => null);
  await reload();
  toast('Calificaciones enviadas al libro.');
}

document.addEventListener('click', (event) => {
  const box = event.target.closest('.h5p-box');
  if (!box) return;
  if (event.target.closest('[data-h5p-open]')) openH5p(box).catch((error) => toast(error.message));
  if (event.target.closest('[data-h5p-results]')) h5pResultsModal(box.dataset.h5pMaterial);
  if (event.target.closest('[data-h5p-gradebook]')) h5pToGradebook(box.dataset.h5pMaterial).catch((error) => toast(error.message));
});
