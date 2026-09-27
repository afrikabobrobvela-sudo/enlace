/* Registro de asistencia con código QR (AulaPass dentro de Enlace).
   Docente: proyecta un QR que se firma de nuevo cada 10 s, con PIN opcional.
   Alumno: lo escanea con la cámara del teléfono y, si hace falta, escribe el PIN. */

let checkinState = null; // registro abierto que se está proyectando
let checkinTimers = [];
let checkinKeyCache = null;

function base64urlToBytes(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function bytesToBase64url(buffer) {
  let binary = '';
  for (const b of new Uint8Array(buffer)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Firma del intervalo de 10 s actual, con la hora del servidor (el reloj del iPad puede estar desfasado). */
async function checkinToken(state, now = Date.now()) {
  const slot = Math.floor((now + state.offset) / state.windowMs);
  if (checkinKeyCache?.secret !== state.secret) {
    const key = await crypto.subtle.importKey('raw', base64urlToBytes(state.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    checkinKeyCache = { secret: state.secret, key };
  }
  const signature = await crypto.subtle.sign('HMAC', checkinKeyCache.key, new TextEncoder().encode(`${state.code}.${slot}`));
  return { slot, token: `${state.code}.${slot.toString(36)}.${bytesToBase64url(signature).slice(0, 16)}` };
}

function checkinDevice() {
  const key = 'enlace:dispositivo';
  try {
    let id = localStorage.getItem(key);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id || '')) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return (checkinDevice.memory ??= crypto.randomUUID());
  }
}

function stopCheckinTimers() {
  checkinTimers.forEach(clearInterval);
  checkinTimers = [];
}

// ---- Docente ---------------------------------------------------------------------------------

function useCheckin(open, serverNow) {
  checkinState = {
    course: current.course.id,
    session: attendanceSessionId,
    code: open.code,
    secret: open.secret,
    pin: open.pin,
    until: open.until,
    windowMs: open.windowMs,
    offset: serverNow - Date.now(),
    showPin: true,
    lastSlot: null,
  };
}

/** Retoma un registro ya abierto (por ejemplo, tras recargar) o pide las opciones para abrir uno nuevo. */
async function startCheckin() {
  try {
    const status = await request(`/api/attendance/session?course=${encodeURIComponent(current.course.id)}&id=${encodeURIComponent(attendanceSessionId)}`);
    if (status.checkin) {
      useCheckin(status.checkin, status.serverNow);
      return renderAttendance();
    }
  } catch (error) {
    return toast(error.message);
  }
  modal(
    'Registro con código QR',
    `<p>Los alumnos escanean el código con la cámara de su teléfono. El código cambia cada 10 segundos, así que una foto reenviada deja de servir, y cada teléfono solo puede registrar a un alumno.</p>
     <label>Duración<select name="minutes">${[5, 10, 15, 20, 30, 45, 60].map((n) => `<option value="${n}" ${n === 15 ? 'selected' : ''}>${n} minutos</option>`).join('')}</select></label>
     <label class="check-row"><input type="checkbox" name="pin" checked> Pedir un PIN de 4 dígitos (lo proyectas o lo dictas)</label>
     ${field('Marcar retardo después de (minutos; 0 = nunca)', 'late_minutes', '0', 'number', 'min="0" max="240" step="1"')}`,
    async (f) => {
      const open = await request('/api/attendance/checkin/open', {
        course: current.course.id,
        session: attendanceSessionId,
        minutes: Number(f.get('minutes')),
        pin: f.get('pin') === 'on',
        late_minutes: Number(f.get('late_minutes') || 0),
      });
      useCheckin(open, open.serverNow);
      return 'Registro abierto.';
    },
    'Abrir registro',
  );
}

function renderCheckinScreen() {
  const s = checkinState;
  const session = attendanceData.sessions.find((x) => x.id === s.session);
  $('#main').innerHTML = `<div class="checkin-screen" id="checkinScreen">
    <div class="checkin-qr" id="checkinQr"></div>
    <div class="checkin-side">
      <p class="muted">${esc(current.course.name)}</p>
      <h1>Registro de asistencia</h1>
      <p>${esc(sessionLabel(session, 'long'))}</p>
      <p class="checkin-step">Escanea el código con la cámara de tu teléfono${s.pin ? ' y escribe el PIN' : ''}.</p>
      ${s.pin ? `<div class="checkin-pin"><span>PIN</span><strong id="checkinPin">${s.showPin ? esc(s.pin) : '••••'}</strong><button type="button" class="text-btn" data-checkin="pin">${s.showPin ? 'Ocultar PIN' : 'Mostrar PIN'}</button></div>` : ''}
      <p class="checkin-count" id="checkinCount" aria-live="polite"></p>
      <p class="muted" id="checkinClock"></p>
      <ul class="checkin-recent" id="checkinRecent" aria-label="Últimos registros"></ul>
      <label class="check-row"><input type="checkbox" id="checkinMarkAbsent" checked> Al cerrar, marcar falta a quien no se registró</label>
      <div class="action-row">
        <button type="button" class="primary" data-checkin="close">Cerrar registro</button>
        <button type="button" class="secondary" data-checkin="fullscreen">Pantalla completa</button>
        <button type="button" class="secondary" data-checkin="back">Volver a la lista</button>
      </div>
    </div></div>`;
  stopCheckinTimers();
  checkinTick();
  checkinRefresh();
  checkinTimers = [setInterval(checkinTick, 1000), setInterval(checkinRefresh, 3000)];
}

async function checkinTick() {
  const s = checkinState;
  const box = document.getElementById('checkinQr');
  if (!s || !box) return stopCheckinTimers();
  const left = Date.parse(s.until) - (Date.now() + s.offset);
  const clock = document.getElementById('checkinClock');
  if (left <= 0) {
    box.innerHTML = '<p class="checkin-ended">El tiempo de registro terminó</p>';
    if (clock) clock.textContent = 'Pulsa "Cerrar registro" para terminar.';
    return;
  }
  if (clock) clock.textContent = `Se cierra en ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
  const { slot, token } = await checkinToken(s);
  if (slot !== s.lastSlot && checkinState === s) {
    s.lastSlot = slot;
    box.innerHTML = QR.svg(`${location.origin}/?a=${token}`, { label: 'Código QR para registrar asistencia' });
  }
}

async function checkinRefresh() {
  const s = checkinState;
  if (!s || !document.getElementById('checkinScreen')) return stopCheckinTimers();
  try {
    const data = await request(`/api/attendance/session?course=${encodeURIComponent(s.course)}&id=${encodeURIComponent(s.session)}`);
    if (checkinState !== s) return;
    for (const r of data.records) {
      const record = attendanceRecord(s.session, r.member);
      if (record) Object.assign(record, { status: r.status, note: r.note });
      else attendanceData.records.push({ session: s.session, member: r.member, status: r.status, note: r.note });
    }
    const students = attendanceStudents();
    const arrived = data.records.filter((r) => r.status === 'present' || r.status === 'late').length;
    document.getElementById('checkinCount').textContent = `${arrived} de ${students.length} registrados`;
    const recent = data.records.filter((r) => r.note === 'Registro con QR').sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 6);
    document.getElementById('checkinRecent').innerHTML = recent
      .map((r) => `<li>${esc(students.find((m) => m.id === r.member)?.name || '')}${r.status === 'late' ? ' <span class="att-mark late">Retardo</span>' : ''}</li>`)
      .join('');
  } catch {
    const count = document.getElementById('checkinCount');
    if (count) count.textContent = 'Sin conexión; reintentando…';
  }
}

async function closeCheckin() {
  const s = checkinState;
  const markAbsent = document.getElementById('checkinMarkAbsent')?.checked;
  try {
    await request('/api/attendance/checkin/close', { course: s.course, session: s.session });
    await checkinRefresh();
  } catch (error) {
    return toast(error.message);
  }
  stopCheckinTimers();
  checkinState = null;
  let marked = 0;
  if (markAbsent) {
    const missing = attendanceStudents().filter((m) => !attendanceRecord(s.session, m.id)).map((m) => m.id);
    if (missing.length) markAttendance(s.session, missing, 'absent');
    marked = missing.length;
  }
  toast(marked ? `Registro cerrado. Se marcó falta a ${marked === 1 ? '1 alumno' : `${marked} alumnos`}.` : 'Registro cerrado.');
  renderAttendance();
}

// ---- Alumno ----------------------------------------------------------------------------------

function renderCheckinCard(inner) {
  $('#main').innerHTML = `<section class="checkin-card" aria-live="polite"><h1>Registro de asistencia</h1>${inner}
    <div class="action-row">${button('Ir a mis cursos', 'home', '', 'secondary')}</div></section>`;
}

function checkinResult(result) {
  const label = ATT_STATUS[result.status]?.label || 'Presente';
  renderCheckinCard(`<p class="checkin-ok"><span aria-hidden="true">✓</span> ${result.already ? 'Ya estabas registrado' : 'Asistencia registrada'}</p>
    <p>${esc(result.course)}, ${esc(sessionLabel(result, 'long'))}. Quedaste como <strong>${esc(label)}</strong>.</p>`);
}

/** Se ejecuta al abrir Enlace desde el QR (?a=...). Quita el código de la dirección para que recargar no lo reutilice. */
async function startCheckinFromLink() {
  const params = new URLSearchParams(location.search);
  const token = params.get('a') || '';
  params.delete('a');
  history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : ''));
  renderCheckinCard('<p class="muted">Registrando tu asistencia…</p>');
  try {
    const result = await request('/api/attendance/checkin', { token, device: checkinDevice() });
    if (!result.needPin) return checkinResult(result);
    renderCheckinCard(`<p>${esc(result.course)}, ${esc(sessionLabel(result, 'long'))}.</p>
      <form id="pinForm" class="real-form checkin-pin-form">
        <label>PIN que dio tu docente<input name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="one-time-code" required></label>
        <p class="form-error error" hidden></p>
        <button class="primary">Registrar asistencia</button>
      </form>`);
    const form = $('#pinForm');
    form.pin.focus();
    form.onsubmit = async (event) => {
      event.preventDefault();
      const error = form.querySelector('.form-error');
      const submit = form.querySelector('button');
      submit.disabled = true;
      try {
        checkinResult(await request('/api/attendance/checkin/pin', { claim: result.claim, pin: form.pin.value }));
      } catch (e) {
        if (e.status === 400) {
          error.textContent = e.message;
          error.hidden = false;
          form.pin.select();
        } else renderCheckinCard(`<p class="error">${esc(e.message)}</p>`);
      } finally {
        submit.disabled = false;
      }
    };
  } catch (error) {
    renderCheckinCard(`<p class="error">${esc(error.message)}</p>`);
  }
}

document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-checkin]')?.dataset.checkin;
  if (!action || !checkinState) return;
  if (action === 'close') closeCheckin();
  if (action === 'back') {
    stopCheckinTimers();
    checkinState = null; // el registro sigue abierto en el servidor; "Registro con QR" lo retoma
    renderAttendance();
  }
  if (action === 'fullscreen') {
    const screen = document.getElementById('checkinScreen');
    (screen?.requestFullscreen || screen?.webkitRequestFullscreen)?.call(screen);
  }
  if (action === 'pin') {
    checkinState.showPin = !checkinState.showPin;
    document.getElementById('checkinPin').textContent = checkinState.showPin ? checkinState.pin : '••••';
    event.target.textContent = checkinState.showPin ? 'Ocultar PIN' : 'Mostrar PIN';
  }
});
