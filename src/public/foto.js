/* Foto de perfil: cada persona sube la suya desde «Mi perfil» (en el teléfono, de la galería o la cámara). El
 * navegador la recorta en cuadrado y la reduce antes de subirla; la ven la persona, sus docentes y la administración
 * (photos.js). Sin foto se muestran las iniciales. */

const PHOTO_SIDE = 320;

const initialsOf = (name) =>
  String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join('')
    .toUpperCase();

/** Foto (o iniciales) de una persona. `person` necesita `user_id` o `id`, `name` y `photo` (fecha de cambio). */
function avatarHtml(person, size = 'sm') {
  const userId = person?.user_id ?? person?.id;
  if (person?.photo && userId) {
    return `<img class="avatar avatar-${size}" src="/api/photo/${encodeURIComponent(userId)}?v=${encodeURIComponent(person.photo)}" alt="" loading="lazy" decoding="async">`;
  }
  return `<span class="avatar avatar-${size} avatar-initials" aria-hidden="true">${esc(initialsOf(person?.name))}</span>`;
}

/** Recorta al centro en cuadrado y reduce a JPEG (así pesa unos 30 KB). */
async function squarePhoto(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Elige una imagen (foto JPG o PNG).');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.min(PHOTO_SIDE, side);
  canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('No se pudo preparar la foto. Intenta con otra.');
  return blob;
}

/** Apartado de la foto en «Mi perfil». */
function profilePhotoHtml() {
  return `<div class="profile-photo">${avatarHtml(me, 'lg')}<div>
      ${
        me.role === 'student'
          ? '<button type="button" class="secondary" data-photo-camera>Tomar otra foto</button>'
          : `<label class="secondary profile-photo-pick">${me.photo ? 'Cambiar foto' : 'Subir foto'}<input type="file" accept="image/*" data-profile-photo hidden></label>
      ${me.photo ? '<button type="button" class="danger-link" data-profile-photo-delete>Quitar foto</button>' : ''}`
      }
      <p class="muted">Una foto de tu cara, como en una credencial. La ven tus docentes (por ejemplo, al pasar lista) y la administración; tus compañeros no.</p></div></div>`;
}

async function refreshProfilePhoto(message) {
  me = await request('/api/me');
  document.querySelector('#fields .profile-photo')?.replaceWith(Object.assign(document.createElement('div'), { innerHTML: profilePhotoHtml() }).firstElementChild);
  renderProfileButton();
  toast(message);
}

document.addEventListener('change', async (e) => {
  if (!e.target.matches('[data-profile-photo]')) return;
  const file = e.target.files?.[0];
  if (!file) return;
  const label = e.target.closest('label');
  label.firstChild.textContent = 'Subiendo…';
  try {
    const blob = await squarePhoto(file);
    const r = await fetch('/api/profile/photo', { method: 'POST', credentials: 'same-origin', headers: { 'X-Aula-Request': '1', 'content-type': 'image/jpeg' }, body: blob });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'No se pudo subir la foto.');
    await refreshProfilePhoto('Foto guardada.');
  } catch (error) {
    label.firstChild.textContent = me.photo ? 'Cambiar foto' : 'Subir foto';
    toast(error.message);
  }
});

document.addEventListener('click', async (e) => {
  try {
    if (e.target.closest('[data-profile-photo-delete]')) {
      if (!confirm('¿Quitar tu foto de perfil?')) return;
      await request('/api/profile/photo/delete', {});
      return await refreshProfilePhoto('Foto quitada.');
    }
    // Quien enseña puede quitar la foto de un alumno de su curso si no es adecuada.
    const remove = e.target.closest('[data-member-photo-delete]');
    if (remove) {
      const member = current.members.find((m) => m.id === remove.dataset.memberPhotoDelete);
      if (!member || !confirm(`¿Quitar la foto de ${member.name}? Podrá subir otra.`)) return;
      await request('/api/profile/photo/delete', { course: current.course.id, user: member.user_id });
      await reload();
      toast('Foto quitada.');
    }
  } catch (error) {
    toast(error.message);
  }
});

/** Botón de «Mi perfil» del encabezado: la foto o las iniciales. */
function renderProfileButton() {
  const button = $('#profile');
  if (!button) return;
  if (me?.photo) button.innerHTML = avatarHtml(me, 'md');
  else button.textContent = initialsOf(me?.name);
}

// ---- Foto obligatoria: el alumno se la toma con la cámara la primera vez que entra -----------------------

let photoStream = null;
let photoBlob = null;

function stopPhotoCamera() {
  photoStream?.getTracks().forEach((t) => t.stop());
  photoStream = null;
}

/** Cuadrado del centro de la imagen de la cámara, reducido a JPEG. */
async function framePhoto(video) {
  const side = Math.min(video.videoWidth, video.videoHeight);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.min(PHOTO_SIDE, side);
  canvas.getContext('2d').drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('No se pudo tomar la foto. Intenta de nuevo.');
  return blob;
}

/**
 * Pantalla para tomarse la foto. Obligatoria (sin «Cancelar») cuando el alumno aún no tiene foto; desde «Mi perfil»
 * sirve para cambiarla.
 */
async function renderPhotoGate({ cancelable = false } = {}) {
  stopPhotoCamera();
  photoBlob = null;
  if (typeof nav === 'function' && !cancelable) nav();
  $('#main').innerHTML = `<section class="panel photo-gate">
    <h1>${cancelable ? 'Cambiar tu foto de perfil' : 'Tómate tu foto de perfil'}</h1>
    <p>${cancelable ? '' : 'Para entrar a Enlace necesitas una foto tuya. '}Tómala de frente, con buena luz y sin lentes oscuros ni gorra, como en una credencial. Tus docentes la usan para reconocerte al pasar lista y en los exámenes; tus compañeros no la ven.</p>
    <div class="camera-box"><video id="photoVideo" playsinline muted autoplay></video><img id="photoPreview" hidden alt="Tu foto"><div class="camera-guide" aria-hidden="true"></div></div>
    <p class="muted" id="photoStatus" role="status">Activando la cámara… Si el navegador pregunta, permite usar la cámara.</p>
    <div class="form-actions photo-actions">
      <button type="button" class="primary" id="photoShoot" disabled>Tomar foto</button>
      <button type="button" class="secondary" id="photoRetake" hidden>Tomar otra</button>
      <button type="button" class="primary" id="photoUse" hidden>Usar esta foto</button>
      ${cancelable ? '<button type="button" class="text-btn" id="photoCancel">Cancelar</button>' : ''}
    </div>
    <div id="photoFallback" hidden><p>No se pudo abrir la cámara aquí. Toca el botón para tomarla con la cámara de tu teléfono o computadora.</p>
      <label class="secondary profile-photo-pick">Abrir la cámara<input type="file" accept="image/*" capture="user" id="photoFile" hidden></label></div>
    ${cancelable ? '' : '<p class="muted">¿Entraste con la cuenta equivocada? <button type="button" class="text-btn" data-action="logout">Cerrar sesión</button></p>'}
  </section>`;
  const video = $('#photoVideo');
  const status = $('#photoStatus');
  const showPreview = (blob) => {
    photoBlob = blob;
    const img = $('#photoPreview');
    img.src = URL.createObjectURL(blob);
    img.hidden = false;
    video.hidden = true;
    $('#photoShoot').hidden = true;
    $('#photoRetake').hidden = false;
    $('#photoUse').hidden = false;
    status.textContent = '¿Se te ve bien la cara? Si no, toma otra.';
  };
  const fallback = (why) => {
    stopPhotoCamera();
    video.hidden = true;
    $('#photoShoot').hidden = true;
    $('#photoFallback').hidden = false;
    status.textContent = why;
  };
  $('#photoShoot').onclick = async () => {
    try {
      showPreview(await framePhoto(video));
    } catch (error) {
      toast(error.message);
    }
  };
  $('#photoRetake').onclick = () => {
    if (!photoStream) return $('#photoFile')?.click();
    $('#photoPreview').hidden = true;
    video.hidden = false;
    $('#photoShoot').hidden = false;
    $('#photoRetake').hidden = true;
    $('#photoUse').hidden = true;
    status.textContent = 'Acomoda tu cara dentro del círculo y toma la foto.';
  };
  $('#photoFile').onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      showPreview(await squarePhoto(file));
    } catch (error) {
      toast(error.message);
    }
  };
  $('#photoUse').onclick = async () => {
    if (!photoBlob) return;
    const use = $('#photoUse');
    use.disabled = true;
    status.textContent = 'Guardando tu foto…';
    try {
      const r = await fetch('/api/profile/photo', { method: 'POST', credentials: 'same-origin', headers: { 'X-Aula-Request': '1', 'content-type': 'image/jpeg' }, body: photoBlob });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'No se pudo guardar la foto.');
      stopPhotoCamera();
      toast('Foto guardada.');
      if (cancelable) {
        me = await request('/api/me');
        renderProfileButton();
        render();
      } else await init();
    } catch (error) {
      status.textContent = error.message;
      use.disabled = false;
    }
  };
  if (cancelable) $('#photoCancel').onclick = () => (stopPhotoCamera(), render());
  if (!navigator.mediaDevices?.getUserMedia) return fallback('Este navegador no permite usar la cámara desde la página.');
  try {
    photoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
    if (!document.getElementById('photoVideo')) return stopPhotoCamera(); // cambió de pantalla mientras tanto
    video.srcObject = photoStream;
    await video.play().catch(() => {});
    $('#photoShoot').disabled = false;
    status.textContent = 'Acomoda tu cara dentro del círculo y toma la foto.';
  } catch (error) {
    fallback(error?.name === 'NotAllowedError' ? 'No diste permiso para usar la cámara.' : 'No se encontró una cámara disponible.');
  }
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-photo-camera]')) return;
  $('#modal')?.close?.();
  renderPhotoGate({ cancelable: true });
});
