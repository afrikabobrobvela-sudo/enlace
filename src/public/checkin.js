/* Registro de asistencia con código QR (AulaPass dentro de Enlace) o con código escrito en el pizarrón.
   QR — Docente: proyecta un QR que se firma de nuevo cada 10 s, con PIN opcional.
        Alumno: lo escanea con la cámara del teléfono y, si hace falta, escribe el PIN.
   Código — Docente: escribe en el pizarrón un código de 6 caracteres; su teléfono da la ubicación del salón.
            Alumno: lo escribe en "Registrar asistencia"; si está lejos o sin ubicación, queda por revisar. */

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
    mode: open.mode || 'qr',
    radius: open.radius || 0,
    strict: Boolean(open.strict),
    located: Boolean(open.located),
    flags: [],
    picks: null,
  };
}

/** Ubicación actual del teléfono. Nunca lanza: devuelve { location } o { error: 'denied' | 'unavailable' }. */
function currentLocation(timeout = 15000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ error: 'unavailable' });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ location: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } }),
      (e) => resolve({ error: e.code === 1 ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 },
    );
  });
}

const formatBoardCode = (code) => `${code.slice(0, 3)} ${code.slice(3)}`;

/** Retoma un registro ya abierto (por ejemplo, tras recargar) o pide las opciones para abrir uno nuevo. */
async function startCheckin(mode = 'qr') {
  try {
    const status = await request(`/api/attendance/session?course=${encodeURIComponent(current.course.id)}&id=${encodeURIComponent(attendanceSessionId)}`);
    if (status.checkin) {
      if ((status.checkin.mode || 'qr') !== mode) toast(`Ya hay un registro ${status.checkin.mode === 'code' ? 'con código' : 'con QR'} abierto para esta clase; se muestra ese.`);
      useCheckin(status.checkin, status.serverNow);
      return renderAttendance();
    }
  } catch (error) {
    return toast(error.message);
  }
  if (mode === 'code') return startCodeCheckin();
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

function startCodeCheckin() {
  modal(
    'Registro con código',
    `<p>Escribe el código en el pizarrón o díctalo. Cada alumno entra a Enlace, pulsa <strong>Registrar asistencia</strong> y lo escribe desde su propio teléfono.</p>
     <label>Duración<select name="minutes">${[3, 5, 10, 15, 20, 30].map((n) => `<option value="${n}" ${n === 5 ? 'selected' : ''}>${n} minutos</option>`).join('')}</select></label>
     <label>Distancia máxima a tu teléfono<select name="radius">
       <option value="150" selected>150 m (recomendado)</option>
       <option value="100">100 m</option><option value="300">300 m</option><option value="500">500 m</option>
       <option value="0">No revisar ubicación</option></select></label>
     <label>Si alguien parece estar fuera<select name="strict">
       <option value="0" selected>Por revisar (recomendado)</option>
       <option value="1">No registrarlo</option></select></label>
     ${field('Marcar retardo después de (minutos; 0 = nunca)', 'late_minutes', '0', 'number', 'min="0" max="240" step="1"')}
     <p class="muted">Se usa la ubicación de tu teléfono como referencia del salón y la de cada alumno solo para calcular la distancia: no se guardan coordenadas. La ubicación dentro de edificios puede fallar por decenas de metros; por eso lo recomendado es revisar, no rechazar.</p>`,
    async (f) => {
      const radius = Number(f.get('radius'));
      let place = {};
      if (radius) {
        place = await currentLocation();
        if (place.error && !confirm(`No se pudo obtener tu ubicación (${place.error === 'denied' ? 'no diste permiso' : 'el teléfono no la encontró'}). ¿Abrir el registro de todos modos? Solo se comparará la red de internet, que es menos confiable.`)) {
          throw new Error('Registro no abierto. Permite la ubicación en el navegador y vuelve a intentarlo.');
        }
      }
      const open = await request('/api/attendance/checkin/open', {
        course: current.course.id,
        session: attendanceSessionId,
        mode: 'code',
        minutes: Number(f.get('minutes')),
        radius,
        strict: f.get('strict') === '1',
        location: place.location || null,
        late_minutes: Number(f.get('late_minutes') || 0),
      });
      useCheckin(open, open.serverNow);
      return 'Registro abierto.';
    },
    'Abrir registro',
  );
}

function renderCheckinScreen() {
  if (checkinState.mode === 'code') return renderCodeScreen();
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
      <div id="checkinPicks"></div>
      <label class="check-row"><input type="checkbox" id="checkinMarkAbsent" checked> Al cerrar, marcar falta a quien no se registró</label>
      <div class="action-row">
        <button type="button" class="primary" data-checkin="close">Cerrar registro</button>
        <button type="button" class="secondary" data-checkin="pick">Verificar 3 al azar</button>
        <button type="button" class="secondary" data-checkin="fullscreen">Pantalla completa</button>
        <button type="button" class="secondary" data-checkin="back">Volver a la lista</button>
      </div>
    </div></div>`;
  stopCheckinTimers();
  checkinTick();
  checkinRefresh();
  checkinTimers = [setInterval(checkinTick, 1000), setInterval(checkinRefresh, 3000)];
}

/** Pantalla del docente para el registro con código: se puede ver en el teléfono mientras se camina por el salón. */
function renderCodeScreen() {
  const s = checkinState;
  const session = attendanceData.sessions.find((x) => x.id === s.session);
  const where = !s.radius
    ? 'Sin revisar ubicación.'
    : s.located
      ? `Se revisa que estén a menos de ${s.radius} m de ti. ${s.strict ? 'Si no, no se registran.' : 'Si no, quedan por revisar.'}`
      : 'Sin tu ubicación: solo se compara la red de internet (menos confiable).';
  $('#main').innerHTML = `<div class="checkin-screen code-screen" id="checkinScreen">
    <div class="checkin-side">
      <p class="muted">${esc(current.course.name)} · ${esc(sessionLabel(session, 'long'))}</p>
      <h1>Registro con código</h1>
      <p class="checkin-step">Escríbelo en el pizarrón. Los alumnos entran a Enlace → <strong>Registrar asistencia</strong>.</p>
      <p class="board-code" id="boardCode" aria-label="Código">${esc(formatBoardCode(s.code))}</p>
      <p class="muted" id="checkinClock"></p>
      <p class="muted">${where}</p>
      <p class="checkin-count" id="checkinCount" aria-live="polite"></p>
      <section class="checkin-flags" id="checkinFlags" hidden></section>
      <ul class="checkin-recent" id="checkinRecent" aria-label="Últimos registros"></ul>
      <div id="checkinPicks"></div>
      <label class="check-row"><input type="checkbox" id="checkinMarkAbsent" checked> Al cerrar, marcar falta a quien no se registró</label>
      <div class="action-row">
        <button type="button" class="primary" data-checkin="close">Cerrar registro</button>
        <button type="button" class="secondary" data-checkin="pick">Verificar 3 al azar</button>
        <button type="button" class="secondary" data-checkin="rotate">Cambiar código</button>
        <button type="button" class="secondary" data-checkin="back">Volver a la lista</button>
      </div>
    </div></div>`;
  stopCheckinTimers();
  checkinTick();
  checkinRefresh();
  checkinTimers = [setInterval(checkinTick, 1000), setInterval(checkinRefresh, 4000)];
}

function renderCheckinFlags() {
  const box = document.getElementById('checkinFlags');
  if (!box || !checkinState) return;
  const students = attendanceStudents();
  const flags = checkinState.flags.filter((f) => ['present', 'late'].includes(attendanceRecord(checkinState.session, f.member)?.status));
  box.hidden = !flags.length;
  box.innerHTML = `<h2>Por revisar (${flags.length})</h2><ul>${flags
    .map(
      (f) => `<li><span><strong>${esc(students.find((m) => m.id === f.member)?.name || 'Alumno')}</strong> <span class="muted">${esc(f.flag)}</span></span>
        <span class="action-row"><button type="button" class="table-link" data-checkin="confirm" data-member="${esc(f.member)}">Está en el salón</button>
        <button type="button" class="danger-link" data-checkin="absent" data-member="${esc(f.member)}">Falta</button></span></li>`,
    )
    .join('')}</ul>`;
}

/** Verificación al azar: nombra en voz alta a tres de los registrados; si alguien no está, se nota de inmediato. */
function pickRandomCheckins() {
  const s = checkinState;
  const students = attendanceStudents();
  const registered = students.filter((m) => {
    const r = attendanceRecord(s.session, m.id);
    return r && ['present', 'late'].includes(r.status) && /^Registro con/.test(r.note || '');
  });
  if (!registered.length) return toast('Todavía no hay alumnos registrados.');
  const pool = [...registered];
  const picks = [];
  while (pool.length && picks.length < 3) picks.push(pool.splice(crypto.getRandomValues(new Uint32Array(1))[0] % pool.length, 1)[0]);
  document.getElementById('checkinPicks').innerHTML = `<div class="checkin-picks"><p><strong>Nómbralos en voz alta:</strong></p><ol>${picks
    .map((m) => `<li>${esc(m.name)} <button type="button" class="danger-link" data-checkin="absent" data-member="${esc(m.id)}">No está: falta</button></li>`)
    .join('')}</ol></div>`;
}

async function checkinTick() {
  const s = checkinState;
  const box = document.getElementById('checkinQr');
  if (s?.mode === 'code' && document.getElementById('boardCode')) {
    const left = Date.parse(s.until) - (Date.now() + s.offset);
    const clock = document.getElementById('checkinClock');
    if (clock) clock.textContent = left > 0 ? `Se cierra en ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` : 'El tiempo terminó: pulsa "Cerrar registro".';
    if (left <= 0) document.getElementById('boardCode').classList.add('is-ended');
    return;
  }
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
    s.flags = data.flags || [];
    renderCheckinFlags();
    if (data.checkin?.code && s.mode === 'code' && data.checkin.code !== s.code) {
      s.code = data.checkin.code;
      document.getElementById('boardCode').textContent = formatBoardCode(s.code);
    }
    const recent = data.records.filter((r) => /^Registro con/.test(r.note || '')).sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 6);
    document.getElementById('checkinRecent').innerHTML = recent
      .map((r) => `<li>${esc(students.find((m) => m.id === r.member)?.name || '')}${r.status === 'late' ? ' <span class="att-mark late">Retardo</span>' : ''}${/Por revisar/.test(r.note) ? ' <span class="att-mark review">Por revisar</span>' : ''}</li>`)
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
    <p>${esc(result.course)}, ${esc(sessionLabel(result, 'long'))}. Quedaste como <strong>${esc(label)}</strong>.</p>
    ${result.review ? '<p class="warning-note">Tu registro quedó <strong>por revisar</strong> porque no se pudo confirmar que estés en el salón. Tu docente lo revisará en clase.</p>' : ''}`);
}

/** Alumno: escribe el código del pizarrón. La ubicación se pide en ese momento y solo se usa para calcular la distancia. */
function renderCodeEntry() {
  current = null;
  renderCheckinCard(`<p>Escribe el código que tu docente puso en el pizarrón.</p>
    <form id="codeForm" class="real-form checkin-pin-form">
      <label>Código de asistencia<input name="code" class="code-input" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="9" placeholder="ABC 123" required></label>
      <p class="muted">Enlace te pedirá permiso para ver tu ubicación: solo se usa para confirmar que estás en el salón y no se guarda.</p>
      <p class="form-error error" hidden></p>
      <button class="primary">Registrar asistencia</button>
    </form>`);
  const form = $('#codeForm');
  form.code.focus();
  form.code.oninput = () => (form.code.value = form.code.value.toUpperCase());
  form.onsubmit = async (event) => {
    event.preventDefault();
    const error = form.querySelector('.form-error');
    const submit = form.querySelector('button');
    submit.disabled = true;
    submit.textContent = 'Obteniendo ubicación…';
    try {
      const place = await currentLocation(12000);
      submit.textContent = 'Registrando…';
      const result = await request('/api/attendance/checkin/code', {
        code: form.code.value,
        device: checkinDevice(),
        location: place.location || null,
        locationError: place.error || '',
      });
      checkinResult(result);
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      form.code.select();
    } finally {
      submit.disabled = false;
      submit.textContent = 'Registrar asistencia';
    }
  };
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

document.addEventListener('click', async (event) => {
  if (event.target.closest('[data-checkin-code]')) return renderCodeEntry();
  const target = event.target.closest('[data-checkin]');
  const action = target?.dataset.checkin;
  if (!action || !checkinState) return;
  if (action === 'close') closeCheckin();
  if (action === 'pick') pickRandomCheckins();
  if (action === 'rotate') {
    if (!confirm('¿Cambiar el código? El anterior deja de servir de inmediato: bórralo del pizarrón y escribe el nuevo.')) return;
    try {
      const { code } = await request('/api/attendance/checkin/rotate', { course: checkinState.course, session: checkinState.session });
      checkinState.code = code;
      document.getElementById('boardCode').textContent = formatBoardCode(code);
      toast('Código cambiado.');
    } catch (error) {
      toast(error.message);
    }
  }
  if (action === 'confirm') {
    try {
      await request('/api/attendance/checkin/review', { course: checkinState.course, session: checkinState.session, member: target.dataset.member });
      await checkinRefresh();
    } catch (error) {
      toast(error.message);
    }
  }
  if (action === 'absent') {
    markAttendance(checkinState.session, [target.dataset.member], 'absent', 'Falta: no estaba en el salón al verificar');
    target.closest('li')?.remove();
    renderCheckinFlags();
    toast('Marcado como falta.');
  }
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
