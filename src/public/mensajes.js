/* Mensajes directos (12.70; servidor en src/server/mensajes.js). Sección «Mensajes» del curso.
 * - Alumno: su conversación privada con quienes enseñan en el curso.
 * - Docente: la lista de conversaciones (las que tienen mensajes sin leer, arriba) y cada una por separado
 *   (`detail` = id de inscripción del alumno); «Nuevo mensaje» escribe a uno, a varios o a todo el grupo. */

const messageMine = (m) => (teaches() ? m.from_teacher === 1 : m.from_teacher === 0);

function messageBubbles(list) {
  if (!list.length) return '<p class="muted message-empty">Todavía no hay mensajes en esta conversación.</p>';
  return list
    .map(
      (m) => `<article class="message ${messageMine(m) ? 'is-mine' : ''}">
        <p class="message-meta">${esc(m.author_name)} · ${esc(fmt(m.created))}</p>
        <div class="message-body">${richText(m.body)}</div></article>`,
    )
    .join('');
}

async function renderMessages() {
  const course = current.course.id;
  const thread = teaches() ? detail : 'mine';
  $('#main').innerHTML = '<h1>Mensajes</h1><p class="muted">Cargando…</p>';
  try {
    if (teaches() && !detail) return renderMessageThreads(course, await request(`/api/messages?course=${encodeURIComponent(course)}`));
    const data = await request(`/api/messages/thread?course=${encodeURIComponent(course)}${teaches() ? `&member=${encodeURIComponent(detail)}` : ''}`);
    if (current?.course.id !== course || section !== 'messages' || (teaches() ? detail : 'mine') !== thread) return;
    renderMessageThread(data);
  } catch (error) {
    if (section === 'messages') $('#main').innerHTML = `<h1>Mensajes</h1><p class="form-error">${esc(error.message)}</p>`;
  }
}

function renderMessageThread(data) {
  const student = !teaches();
  $('#main').innerHTML = `${student ? '' : '<button class="back" data-message-list>❮ Todas las conversaciones</button>'}
    <h1>${student ? 'Mensajes' : esc(data.member.name)}</h1>
    <p class="muted">${student ? 'Conversación privada con tus docentes de este curso. Solo ellos la leen.' : 'Conversación privada con este alumno. Tus co-docentes también la ven.'}</p>
    <section class="message-thread" aria-label="Mensajes" tabindex="0">${messageBubbles(data.messages)}</section>
    <form class="message-form real-form" id="messageForm">
      <label for="messageBody">${student ? 'Escribe a tus docentes' : `Responder a ${esc(data.member.name)}`}</label>
      <textarea id="messageBody" name="body" required maxlength="4000" rows="3"></textarea>
      <div class="form-actions"><button class="primary" type="submit">Enviar</button></div>
    </form>`;
  const box = $('#main .message-thread');
  if (box) box.scrollTop = box.scrollHeight;
  $('#messageForm').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      await request('/api/messages', { course: current.course.id, body: form.body.value, ...(student ? {} : { members: [data.member.id] }) });
      await renderMessages();
      $('#messageBody')?.focus();
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  };
}

function renderMessageThreads(course, { threads }) {
  if (current?.course.id !== course || section !== 'messages' || detail) return;
  const names = new Map(current.members.map((m) => [m.id, m]));
  const visible = threads.filter((t) => names.has(t.member) && (typeof inSelectedSection !== 'function' || inSelectedSection(names.get(t.member))));
  const unread = visible.reduce((n, t) => n + (t.unread || 0), 0);
  $('#main').innerHTML = `<div class="home-title-row"><div><h1>Mensajes</h1>
      <p class="muted">${unread ? `${unread} ${unread === 1 ? 'mensaje sin leer' : 'mensajes sin leer'}.` : 'Conversaciones privadas con cada alumno.'}</p></div>
      <div class="action-row"><button class="primary" data-message-new>Nuevo mensaje</button></div></div>
    ${typeof sectionFilterHtml === 'function' ? sectionFilterHtml() : ''}
    ${
      visible.length
        ? `<ul class="message-threads">${visible
            .map(
              (t) => `<li><button class="message-thread-item ${t.unread ? 'is-new' : ''}" data-message-thread="${esc(t.member)}">
                <span class="message-thread-name">${esc(t.name)}${t.unread ? ` <b class="badge-count" aria-label="${t.unread} sin leer">${t.unread}</b>` : ''}</span>
                <span class="message-thread-last">${t.last_from_teacher ? 'Tú: ' : ''}${esc(t.last_body)}</span>
                <span class="message-thread-date">${esc(fmt(t.last_at))}</span></button></li>`,
            )
            .join('')}</ul>`
        : '<p class="empty">Todavía no hay conversaciones. Con «Nuevo mensaje» puedes escribir a un alumno, a varios o a todo el grupo; ellos también pueden escribirte desde «Más → Mensajes».</p>'
    }`;
}

/** `chosen`: alumnos ya elegidos (por ejemplo, desde Participación); `draft`: texto inicial del mensaje. */
function newMessageModal(chosen = null, draft = '') {
  const students = typeof studentsInView === 'function' ? studentsInView() : current.members.filter((m) => m.role === 'student');
  if (!students.length) return toast('Todavía no hay alumnos en este curso (o en la sección elegida).');
  const picked = chosen ? new Set(chosen) : null;
  const isPicked = (m) => !picked || picked.has(m.id);
  modal(
    'Nuevo mensaje',
    `<fieldset class="message-recipients"><legend>Para${picked ? ` (${students.filter(isPicked).length} elegidos)` : ''}</legend>
       <label class="check-label"><input type="checkbox" data-message-all ${students.every(isPicked) ? 'checked' : ''}> Todos (${students.length} ${students.length === 1 ? 'alumno' : 'alumnos'}${typeof selectedSections === 'function' && selectedSections().length ? ' de la sección elegida' : ''})</label>
       <div class="message-recipient-list">${students
         .map((m) => `<label class="check-label"><input type="checkbox" name="to" value="${esc(m.id)}" ${isPicked(m) ? 'checked' : ''}> ${esc(m.name)}</label>`)
         .join('')}</div></fieldset>
     <label>Mensaje<textarea name="body" required maxlength="4000" rows="5">${esc(draft)}</textarea></label>
     <p class="muted">Cada alumno lo recibe en su conversación privada (nadie ve a quién más se envió) y le llega un aviso en la campana y en su resumen por correo.</p>`,
    async (form) => {
      const members = form.getAll('to');
      if (!members.length) throw new Error('Elige al menos un alumno.');
      const { sent } = await request('/api/messages', { course: current.course.id, members, body: form.get('body') });
      return sent === 1 ? 'Mensaje enviado.' : `Mensaje enviado a ${sent} alumnos.`;
    },
    'Enviar',
  );
  const all = document.querySelector('[data-message-all]');
  const boxes = () => [...document.querySelectorAll('#modal input[name=to]')];
  all.addEventListener('change', () => boxes().forEach((b) => (b.checked = all.checked)));
  document.querySelector('.message-recipient-list').addEventListener('change', () => (all.checked = boxes().every((b) => b.checked)));
}

document.addEventListener('click', (event) => {
  const thread = event.target.closest('[data-message-thread]');
  if (thread) {
    section = 'messages';
    detail = thread.dataset.messageThread;
    return render();
  }
  if (event.target.closest('[data-message-list]')) {
    section = 'messages';
    detail = null;
    return render();
  }
  if (event.target.closest('[data-message-new]')) newMessageModal();
});
