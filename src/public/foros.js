/* Foros (12.23): lista de foros, hilos con respuestas, anónimo, fijar y cerrar hilos, seguir (avisos), lo nuevo desde
 * la última lectura y calificación de la participación (una actividad del libro de calificaciones ligada al foro).
 * El servidor ya entrega las publicaciones filtradas: el alumno recibe las anónimas sin nombre y, si el foro pide
 * publicar primero, solo las suyas hasta que publique. */

let forumSort = 'activity'; // orden de los hilos: última actividad, más recientes o sin respuesta
let forumSearch = '';
let threadForum = null; // foro del hilo abierto (para volver si el hilo se elimina)
let participationOpen = false; // panel de participación abierto (docente)
const FORUM_NEW_DAYS = 14; // sin registro de lectura, cuenta como nuevo lo de los últimos 14 días

const forumPosts = (forumId) => records('post').filter((p) => p.data.forum === forumId);
const threadsOf = (forumId) => forumPosts(forumId).filter((p) => !p.data.parent);
const repliesOf = (rootId) => records('post').filter((p) => p.data.parent === rootId).sort((a, b) => (a.created < b.created ? -1 : 1));
const forumStateOf = (item) => (current.forumState || []).find((s) => s.item === item);
const isMine = (p) => p.author === viewerKey();
const followsItem = (item) => forumStateOf(item)?.follow === 1;

/** ¿Es nueva para mí esta publicación? (posterior a la última vez que abrí el hilo; las propias nunca). */
function isUnread(p, rootId) {
  if (isMine(p)) return false;
  const readAt = forumStateOf(rootId)?.read_at;
  return readAt ? p.created > readAt : Date.parse(p.created) > Date.now() - FORUM_NEW_DAYS * 86_400_000;
}

/** Resumen de un hilo: respuestas, última actividad y cuántas publicaciones nuevas tiene. */
function threadSummary(root) {
  const replies = repliesOf(root.id);
  const all = [root, ...replies];
  return { replies: replies.length, last: all.reduce((m, p) => (p.created > m ? p.created : m), root.created), unread: all.filter((p) => isUnread(p, root.id)).length };
}

/** Alumno del curso que escribió una publicación (cuenta o alumno de ejemplo). */
const postMember = (p) => current.members.find((m) => m.user_id === p.author || `demo:${m.id}` === p.author);

function postAuthorHtml(p) {
  const member = postMember(p);
  const name = p.data.anonymous ? (teaches() ? `Anónimo · ${p.data.name}` : isMine(p) ? 'Anónimo (tú)' : 'Anónimo') : p.data.name;
  const teacher = member?.role === 'teacher' || (!member && current.course.owner === p.author);
  return `<span class="post-author">${p.data.anonymous && !teaches() ? '<span class="avatar avatar-sm avatar-initials" aria-hidden="true">?</span>' : avatarHtml(member || { name: p.data.name })}<b>${esc(name)}</b>${
    teacher ? ' <span class="post-role">Docente</span>' : ''
  }</span>`;
}

const forumFlags = (f) =>
  [f.data.locked ? 'Cerrado' : '', f.data.anonymous ? 'Se puede publicar como anónimo' : '', f.data.mustPost ? 'Publica para ver lo de tus compañeros' : ''].filter(Boolean);

/** Aviso en la actividad que califica la participación en un foro (no se entrega nada en ella). */
function forumTaskNote(t) {
  const f = find(t.data.forum);
  return `<p class="real-status">${teaches() ? 'Esta actividad califica la participación en el foro' : 'Aquí no se entrega nada: se califica tu participación en el foro'} ${
    f ? `<button type="button" class="table-link" data-action="forum" data-id="${esc(f.id)}">«${esc(f.data.title)}»</button>` : '(eliminado)'
  }.</p>`;
}

/** Actividad del libro de calificaciones que califica la participación en el foro (si la hay). */
const participationTask = (forumId) => records('task').find((t) => t.data.forum === forumId);

// ---- Lista de foros ---------------------------------------------------------------------------------------

function renderForums() {
  const forums = records('forum');
  $('#main').innerHTML = `<h1>Foros</h1><div class="toolbar">${teaches() ? button('Nuevo foro', 'new-forum') : ''}</div>${
    forums
      .map((f) => {
        const threads = threadsOf(f.id);
        const posts = forumPosts(f.id);
        const unread = threads.reduce((n, t) => n + threadSummary(t).unread, 0);
        const last = posts.reduce((m, p) => (p.created > m ? p.created : m), '');
        const task = participationTask(f.id);
        return `<section class="forum-card">
          <div class="forum-card-head"><h2><button class="table-link" data-action="forum" data-id="${esc(f.id)}">${esc(f.data.title)}</button>${sectionTag(f)}</h2>
            ${teaches() ? button('Editar', 'edit-forum', f.id, 'text-btn') : ''}</div>
          <p class="forum-card-meta">${[
            f.data.visible === false ? 'Oculto' : scheduledFor(f) ? `Programado para ${esc(fmt(scheduledFor(f)))}` : '',
            `${threads.length} ${threads.length === 1 ? 'hilo' : 'hilos'}`,
            `${posts.length - threads.length} ${posts.length - threads.length === 1 ? 'respuesta' : 'respuestas'}`,
            last ? `última publicación ${esc(fmt(last))}` : 'sin publicaciones',
            ...forumFlags(f).map(esc),
            task ? 'Se califica la participación' : '',
          ]
            .filter(Boolean)
            .join(' · ')}${unread ? ` <span class="forum-new">${unread} ${unread === 1 ? 'nueva' : 'nuevas'}</span>` : ''}</p>
          ${f.data.body ? `<div class="forum-card-body">${richText(f.data.body)}</div>` : ''}
        </section>`;
      })
      .join('') || '<p class="empty">No hay foros.</p>'
  }`;
}

// ---- Un foro: sus hilos -------------------------------------------------------------------------------------

function renderForum() {
  const f = find(detail);
  if (!f || f.kind !== 'forum') return renderForums();
  if (threadForum !== f.id) forumSearch = '';
  threadForum = f.id;
  const all = threadsOf(f.id);
  const query = forumSearch.trim().toLocaleLowerCase('es-MX');
  const matches = (t) => !query || [t, ...repliesOf(t.id)].some((p) => `${p.data.title} ${p.data.body} ${p.data.anonymous ? '' : p.data.name}`.toLocaleLowerCase('es-MX').includes(query));
  const summaries = new Map(all.map((t) => [t.id, threadSummary(t)]));
  const threads = all
    .filter(matches)
    .filter((t) => forumSort !== 'unanswered' || !summaries.get(t.id).replies)
    .sort((a, b) => (b.data.pinned ? 1 : 0) - (a.data.pinned ? 1 : 0) || (forumSort === 'new' ? (a.created < b.created ? 1 : -1) : summaries.get(a.id).last < summaries.get(b.id).last ? 1 : -1));
  const locked = f.data.locked && !teaches();
  const mine = forumPosts(f.id).some(isMine);
  const task = participationTask(f.id);
  $('#main').innerHTML = `<button class="back" data-section="forums">❮ Foros</button><h1>${esc(f.data.title)}${sectionTag(f)}</h1>${richText(f.data.body)}
    ${forumFlags(f).length ? `<p class="forum-flags">${forumFlags(f).map((x) => `<span>${esc(x)}</span>`).join('')}</p>` : ''}
    ${!teaches() && f.data.mustPost && !mine ? '<p class="real-status">En este foro, las publicaciones de tus compañeros aparecen después de que publiques la tuya.</p>' : ''}
    ${!teaches() && task ? '<p class="real-status">Tu docente califica tu participación en este foro.</p>' : ''}
    <div class="toolbar">${locked ? '<span class="muted">Este foro está cerrado.</span>' : button('Nuevo hilo', 'new-post', f.id)}
      <button type="button" class="secondary" data-forum-follow="${esc(f.id)}" aria-pressed="${followsItem(f.id)}">${followsItem(f.id) ? '✓ Siguiendo el foro' : 'Seguir el foro'}</button>
      ${teaches() ? `${button('Editar foro', 'edit-forum', f.id, 'secondary')}<button type="button" class="secondary" data-forum-grading="${esc(f.id)}">${task ? 'Participación' : 'Calificar participación'}</button>` : ''}
      <input type="search" data-forum-search placeholder="Buscar en el foro…" aria-label="Buscar en el foro" value="${esc(forumSearch)}">
      <select data-forum-sort aria-label="Ordenar hilos"><option value="activity" ${forumSort === 'activity' ? 'selected' : ''}>Última actividad</option><option value="new" ${forumSort === 'new' ? 'selected' : ''}>Más recientes</option><option value="unanswered" ${forumSort === 'unanswered' ? 'selected' : ''}>Sin respuesta</option></select></div>
    ${teaches() && task ? participationHtml(f, task) : ''}
    <div class="thread-list">${
      threads
        .map((t) => {
          const s = summaries.get(t.id);
          return `<button type="button" class="thread-row ${s.unread ? 'has-new' : ''}" data-thread="${esc(t.id)}">
            <span class="thread-title">${t.data.pinned ? '<span class="thread-flag" title="Fijado">📌 Fijado</span>' : ''}${t.data.locked ? '<span class="thread-flag" title="Cerrado">🔒 Cerrado</span>' : ''}${esc(t.data.title)}</span>
            <span class="thread-meta">${postAuthorHtml(t)}<span>${esc(fmt(t.created))}</span></span>
            <span class="thread-stats"><span>${s.replies} ${s.replies === 1 ? 'respuesta' : 'respuestas'}</span><span>última ${esc(fmt(s.last))}</span>${s.unread ? `<span class="forum-new">${s.unread} ${s.unread === 1 ? 'nueva' : 'nuevas'}</span>` : ''}</span>
          </button>`;
        })
        .join('') || `<p class="empty">${all.length ? 'Ningún hilo coincide.' : 'Todavía no hay hilos. ¡Abre el primero!'}</p>`
    }</div>`;
}

// ---- Un hilo -------------------------------------------------------------------------------------------------

function renderThread() {
  const root = find(detail);
  if (!root || root.kind !== 'post') {
    detail = threadForum;
    section = threadForum && find(threadForum) ? 'forum' : 'forums';
    return render();
  }
  const f = find(root.data.forum);
  threadForum = f?.id || null;
  const replies = repliesOf(root.id);
  const closed = !teaches() && (root.data.locked || f?.data.locked);
  const canDelete = (p) => teaches() || isMine(p);
  const postHtml = (p, isRoot) => `<article class="forum-post ${isRoot ? 'is-root' : 'is-reply'} ${isUnread(p, root.id) ? 'is-new' : ''}" id="post-${esc(p.id)}">
      <div class="post-head">${postAuthorHtml(p)}<span class="muted">${esc(fmt(p.created))}</span>${isUnread(p, root.id) ? '<span class="forum-new">Nueva</span>' : ''}</div>
      ${isRoot ? '' : p.data.title && p.data.title !== `Re: ${root.data.title}`.slice(0, 200) ? `<h3>${esc(p.data.title)}</h3>` : ''}
      <div class="post-body">${richText(p.data.body)}</div>
      ${canDelete(p) ? `<div class="post-actions">${trashButton('post', p.id, isRoot && replies.length ? 'Eliminar hilo' : 'Eliminar')}</div>` : ''}
    </article>`;
  $('#main').innerHTML = `<button class="back" data-action="forum" data-id="${esc(root.data.forum)}">❮ ${esc(f?.data.title || 'Foro')}</button>
    <h1>${root.data.pinned ? '<span class="thread-flag">📌 Fijado</span> ' : ''}${root.data.locked ? '<span class="thread-flag">🔒 Cerrado</span> ' : ''}${esc(root.data.title)}</h1>
    <div class="toolbar"><button type="button" class="secondary" data-forum-follow="${esc(root.id)}" aria-pressed="${followsItem(root.id)}">${followsItem(root.id) ? '✓ Siguiendo el hilo' : 'Seguir el hilo'}</button>
      ${teaches() ? `<button type="button" class="secondary" data-thread-pin="${esc(root.id)}">${root.data.pinned ? 'Desfijar' : 'Fijar arriba'}</button><button type="button" class="secondary" data-thread-lock="${esc(root.id)}">${root.data.locked ? 'Abrir el hilo' : 'Cerrar el hilo'}</button>` : ''}</div>
    ${postHtml(root, true)}
    <h2 class="thread-replies-title">${replies.length ? `${replies.length} ${replies.length === 1 ? 'respuesta' : 'respuestas'}` : 'Sin respuestas todavía'}</h2>
    <div class="thread-replies">${replies.map((p) => postHtml(p, false)).join('')}</div>
    ${
      closed
        ? `<p class="real-status">${root.data.locked ? 'Este hilo está cerrado' : 'Este foro está cerrado'}: ya no recibe respuestas.</p>`
        : `<form class="real-form reply-form" id="replyForm"><label>Tu respuesta<textarea name="body" required maxlength="15000" rows="4"></textarea></label>
        ${!teaches() && f?.data.anonymous ? '<label class="check-label"><input type="checkbox" name="anonymous"> Publicar como anónimo (tus compañeros no verán tu nombre; tu docente sí)</label>' : ''}
        <p class="form-error error" hidden></p><button class="primary">Responder</button></form>`
    }`;
  if (!closed) {
    bindForm('#replyForm', async () => {
      const form = new FormData($('#replyForm'));
      await save('post', { forum: root.data.forum, parent: root.id, body: form.get('body'), anonymous: form.get('anonymous') === 'on' });
      return 'Respuesta publicada.';
    });
  }
  markThreadRead(root.id);
}

/** Registra que la persona abrió el hilo (lo nuevo deja de marcarse la próxima vez). */
function markThreadRead(item) {
  if (previewAsStudent || !current) return;
  const now = new Date().toISOString();
  const state = forumStateOf(item);
  if (state?.read_at && Date.now() - Date.parse(state.read_at) < 60_000) return;
  request('/api/forum/read', { course: current.course.id, item })
    .then((r) => {
      current.forumState = [...(current.forumState || []).filter((s) => s.item !== item), { item, follow: state?.follow || 0, read_at: r.readAt || now }];
    })
    .catch(() => {});
}

// ---- Participación (docente) ----------------------------------------------------------------------------

function participationHtml(f, task) {
  const posts = forumPosts(f.id);
  const students = studentsInView().filter((m) => itemApplies(task, m));
  const rows = students.map((m) => {
    const own = posts.filter((p) => p.author === m.user_id || p.author === `demo:${m.id}`);
    const threads = own.filter((p) => !p.data.parent).length;
    const last = own.reduce((x, p) => (p.created > x ? p.created : x), '');
    const g = gradeOf(m.id, task.id);
    return `<tr><td><span class="person">${avatarHtml(m)}<span>${esc(m.name)}</span></span></td><td>${threads}</td><td>${own.length - threads}</td><td>${last ? esc(fmt(last)) : '—'}</td>
      <td><input class="participation-grade" type="number" min="0" max="10" step="0.1" inputmode="decimal" data-part-member="${esc(m.id)}" data-part-revision="${g?.revision ?? ''}" value="${g?.data.grade ?? ''}" aria-label="Calificación de ${esc(m.name)}"></td></tr>`;
  });
  return `<details class="participation" ${participationOpen ? 'open' : ''}><summary>Participación y calificación (${esc(task.data.title)})</summary>
    <p class="muted">Hilos y respuestas de cada alumno en este foro (también las anónimas). La calificación (0 a 10) se guarda en la actividad «${esc(task.data.title)}» del libro de calificaciones: ahí eliges su categoría o ponderación.</p>
    <div class="table-wrap"><table class="keep-table"><thead><tr><th>Alumno</th><th>Hilos</th><th>Respuestas</th><th>Última publicación</th><th>Calificación</th></tr></thead><tbody>${
      rows.join('') || '<tr><td colspan="5">No hay alumnos en esta vista.</td></tr>'
    }</tbody></table></div>
    <p class="bank-pick-actions"><button type="button" class="primary" data-part-save="${esc(task.id)}">Guardar calificaciones</button><button type="button" class="text-btn" data-action="task" data-id="${esc(task.id)}">Abrir la actividad</button></p></details>`;
}

async function saveParticipation(taskId, target) {
  const changed = [...document.querySelectorAll('[data-part-member]')].filter((input) => {
    const g = gradeOf(input.dataset.partMember, taskId);
    return input.value !== String(g?.data.grade ?? '');
  });
  if (!changed.length) return toast('No hay calificaciones nuevas que guardar.');
  target.disabled = true;
  let saved = 0;
  try {
    for (const input of changed) {
      const grade = input.value === '' ? null : Number(input.value);
      if (grade !== null && (!Number.isFinite(grade) || grade < 0 || grade > 10)) throw new Error('Cada calificación va de 0 a 10.');
      await request('/api/grade', {
        course: current.course.id,
        task: taskId,
        member: input.dataset.partMember,
        revision: input.dataset.partRevision ? Number(input.dataset.partRevision) : undefined,
        grade,
        publish: true,
      });
      saved++;
    }
  } catch (error) {
    toast(error.message);
  } finally {
    await reload();
  }
  if (saved) toast(`Se ${saved === 1 ? 'guardó 1 calificación' : `guardaron ${saved} calificaciones`}.`);
}

// ---- Editor del foro ------------------------------------------------------------------------------------

function forumModal(old) {
  const d = old?.data || {};
  const check = (name, on, label) => `<label class="check-label"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}> ${label}</label>`;
  modal(
    `${old ? 'Editar' : 'Crear'} foro`,
    field('Título', 'title', d.title || '', 'text', 'required maxlength="200"') +
      richTextarea('Instrucciones', 'body', d.body || '') +
      `<fieldset class="quiz-settings"><legend>Reglas del foro</legend>
        ${check('anonymous', d.anonymous, 'Los alumnos pueden publicar como anónimos (tú sí ves quién fue)')}
        ${check('mustPost', d.mustPost, 'Cada alumno ve las publicaciones de sus compañeros hasta que publique la suya')}
        ${check('locked', d.locked, 'Cerrado: los alumnos ya no pueden publicar ni responder')}</fieldset>` +
      visible(d.visible, d.publishAt || '', d.sections) +
      conditionsEditorHtml(old) +
      (old ? `<p class="modal-danger">${trashButton('forum', old.id, 'Eliminar foro')}</p>` : ''),
    async (f) => {
      await save(
        'forum',
        {
          title: f.get('title'),
          body: f.get('body'),
          visible: f.get('visible') === 'on',
          publishAt: iso(f.get('publishAt')),
          anonymous: f.get('anonymous') === 'on',
          mustPost: f.get('mustPost') === 'on',
          locked: f.get('locked') === 'on',
        },
        old,
      );
      dirty = false;
    },
  );
}

function newThreadModal(forumId) {
  const f = find(forumId);
  modal(
    'Nuevo hilo',
    field('Título', 'title', '', 'text', 'required maxlength="200"') +
      textarea('Mensaje', 'body') +
      (!teaches() && f?.data.anonymous ? '<label class="check-label"><input type="checkbox" name="anonymous"> Publicar como anónimo (tus compañeros no verán tu nombre; tu docente sí)</label>' : ''),
    async (form) => {
      const saved = await save('post', { forum: forumId, title: form.get('title'), body: form.get('body'), anonymous: form.get('anonymous') === 'on' });
      dirty = false;
      section = 'thread';
      detail = saved.id;
      return 'Hilo publicado.';
    },
    'Publicar',
  );
}

// ---- Eventos ---------------------------------------------------------------------------------------------------

document.addEventListener('click', async (e) => {
  const thread = e.target.closest('[data-thread]');
  if (thread) {
    section = 'thread';
    detail = thread.dataset.thread;
    render();
    window.scrollTo?.(0, 0);
    return;
  }
  const follow = e.target.closest('[data-forum-follow]');
  const pin = e.target.closest('[data-thread-pin]');
  const lock = e.target.closest('[data-thread-lock]');
  const grading = e.target.closest('[data-forum-grading]');
  const part = e.target.closest('[data-part-save]');
  try {
    if (follow) {
      const item = follow.dataset.forumFollow;
      const next = !followsItem(item);
      await request('/api/forum/follow', { course: current.course.id, item, follow: next });
      const state = forumStateOf(item);
      current.forumState = [...(current.forumState || []).filter((s) => s.item !== item), { item, follow: next ? 1 : 0, read_at: state?.read_at || '' }];
      render();
      toast(next ? 'Te avisaremos de las publicaciones nuevas (campana y resumen por correo).' : 'Ya no recibirás avisos de aquí.');
    } else if (pin || lock) {
      const root = find((pin || lock).dataset.threadPin || (pin || lock).dataset.threadLock);
      await request('/api/forum/thread', { course: current.course.id, id: root.id, ...(pin ? { pinned: !root.data.pinned } : { locked: !root.data.locked }) });
      await reload();
    } else if (grading) {
      const forumId = grading.dataset.forumGrading;
      if (participationTask(forumId)) {
        participationOpen = true;
        const panel = document.querySelector('.participation');
        if (panel) panel.open = true;
        panel?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      if (!confirm('Se creará la actividad «Participación» en el libro de calificaciones (los alumnos no entregan nada en ella). ¿Continuar?')) return;
      await request('/api/forum/grading', { course: current.course.id, forum: forumId });
      participationOpen = true;
      await reload();
      toast('Listo: califica la participación aquí mismo. Su categoría o ponderación se cambian en la actividad.');
    } else if (part) {
      await saveParticipation(part.dataset.partSave, part);
    }
  } catch (error) {
    toast(error.message);
  }
});

document.addEventListener('change', (e) => {
  if (e.target.matches('[data-forum-sort]')) {
    forumSort = e.target.value;
    renderForum();
  }
});
let forumSearchTimer = null;
document.addEventListener('input', (e) => {
  if (!e.target.matches('[data-forum-search]')) return;
  clearTimeout(forumSearchTimer);
  forumSearchTimer = setTimeout(() => {
    forumSearch = e.target.value;
    renderForum();
    const box = document.querySelector('[data-forum-search]');
    box?.focus();
    box?.setSelectionRange(box.value.length, box.value.length);
  }, 250);
});
document.addEventListener(
  'toggle',
  (e) => {
    if (e.target.classList?.contains('participation')) participationOpen = e.target.open;
  },
  true,
);
