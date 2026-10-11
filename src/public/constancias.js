/* Constancias con folio y código QR (12.67; servidor en src/server/constancias.js).
 * - Docente: «Administración del curso → Constancias» (certificatesModal): las activa, elige cómo se obtienen
 *   (al aprobar una evaluación con la mínima, o las entrega él), y entrega, descarga o revoca las de cada alumno.
 * - Alumno: tarjeta en la portada del curso (showCertificateCard) para obtenerla y descargarla.
 * El PDF se dibuja en un lienzo (A4 horizontal) y se guarda con jpegPagesToPdf() de compress.js; el QR (qr.js) lleva a
 * /constancia/<folio>, la página pública que dice si es válida. */

const CERT_W = 1754; // A4 horizontal a 150 ppp
const CERT_H = 1240;

const certVerifyUrl = (folio) => `${location.origin}/constancia/${folio}`;
const certDate = (iso) => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
const certGrade = (grade) => (grade == null ? '' : String(Math.round(grade * 10) / 10));

/** Corta un texto en renglones que caben en `width` (para nombres y cursos largos). */
function certLines(ctx, text, width) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const next = line ? line + ' ' + word : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Texto centrado que se achica hasta caber en `maxLines` renglones; devuelve la altura usada. */
function certCentered(ctx, text, { x, y, width, size, min, weight = 800, stretch = 'condensed', color = '#111a2e', maxLines = 2 }) {
  let lines;
  for (; size >= min; size -= 4) {
    ctx.font = `${weight} ${size}px Archivo, 'Arial Narrow', sans-serif`;
    if ('fontStretch' in ctx) ctx.fontStretch = stretch;
    lines = certLines(ctx, text, width);
    if (lines.length <= maxLines) break;
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  lines.slice(0, maxLines).forEach((line, i) => ctx.fillText(line, x, y + i * size * 1.08));
  return lines.slice(0, maxLines).length * size * 1.08;
}

/** Dibuja la constancia y la descarga como PDF. */
async function downloadCertificate(cert) {
  await Promise.all(['800 60px Archivo', '500 30px Archivo', '400 26px Archivo'].map((f) => document.fonts?.load?.(f).catch(() => null)));
  const canvas = document.createElement('canvas');
  canvas.width = CERT_W;
  canvas.height = CERT_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CERT_W, CERT_H);
  // Lomo de tinta a la izquierda con la marca de la colección (tres lomos que forman una E).
  ctx.fillStyle = '#111a2e';
  ctx.fillRect(0, 0, 150, CERT_H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(35, 70, 80, 80);
  [['#1f3fd1', 16, 46], ['#c0183f', 33.5, 30], ['#0a6e60', 51, 46]].forEach(([color, y, w]) => {
    ctx.fillStyle = color;
    ctx.fillRect(53, 70 + y, w, 13);
  });
  // Filete de tinta arriba y abajo del área de texto.
  ctx.fillStyle = '#111a2e';
  ctx.fillRect(230, 90, CERT_W - 330, 4);
  ctx.fillRect(230, CERT_H - 94, CERT_W - 330, 4);

  const cx = 150 + (CERT_W - 150) / 2;
  const width = CERT_W - 470;
  let y = 250;
  certCentered(ctx, 'CONSTANCIA', { x: cx, y, width, size: 92, min: 92, maxLines: 1 });
  y += 80;
  certCentered(ctx, 'Se otorga a', { x: cx, y, width, size: 34, min: 34, weight: 400, stretch: 'normal', color: '#3d4b5c', maxLines: 1 });
  y += 110;
  y += certCentered(ctx, cert.name, { x: cx, y, width, size: 84, min: 48 });
  y += 20;
  certCentered(ctx, cert.grade != null ? 'por haber aprobado el curso' : 'por haber concluido satisfactoriamente el curso', { x: cx, y, width, size: 34, min: 34, weight: 400, stretch: 'normal', color: '#3d4b5c', maxLines: 1 });
  y += 80;
  y += certCentered(ctx, cert.courseName, { x: cx, y, width, size: 60, min: 36, color: '#1f3fd1' });
  const facts = [cert.hours ? `Duración: ${cert.hours} horas` : '', cert.grade != null ? `Calificación: ${certGrade(cert.grade)} de 10` : '', certDate(cert.issuedAt)].filter(Boolean).join('   ·   ');
  certCentered(ctx, facts, { x: cx, y: y + 20, width, size: 30, min: 24, weight: 500, stretch: 'normal', color: '#3d4b5c', maxLines: 1 });

  // Firma (izquierda) y verificación con QR (derecha).
  const baseY = CERT_H - 200;
  if (cert.signer) {
    ctx.fillStyle = '#111a2e';
    ctx.fillRect(330, baseY - 50, 520, 3);
    certCentered(ctx, cert.signer, { x: 590, y: baseY, width: 520, size: 32, min: 22, weight: 600, stretch: 'normal', maxLines: 1 });
  }
  const url = certVerifyUrl(cert.id);
  const qr = QR.encode(url, 'M');
  const cell = Math.floor(200 / (qr.size + 8));
  const qrSize = cell * (qr.size + 8);
  const qx = CERT_W - 110 - qrSize;
  const qy = CERT_H - 120 - qrSize;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(qx, qy, qrSize, qrSize);
  ctx.fillStyle = '#000000';
  qr.modules.forEach((row, my) => row.forEach((dark, mx) => dark && ctx.fillRect(qx + (mx + 4) * cell, qy + (my + 4) * cell, cell, cell)));
  ctx.textAlign = 'right';
  ctx.fillStyle = '#3d4b5c';
  ctx.font = "500 22px Archivo, sans-serif";
  ctx.fillText(`Folio ${cert.id}`, qx - 24, qy + qrSize - 40);
  ctx.font = "400 20px Archivo, sans-serif";
  ctx.fillText(`Verifica en ${url.replace(/^https?:\/\//, '')}`, qx - 24, qy + qrSize - 8);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  const pdf = jpegPagesToPdf([{ bytes: new Uint8Array(await blob.arrayBuffer()), width: CERT_W, height: CERT_H }]);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(pdf);
  link.download = `constancia-${cert.id}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

// ---- Alumno: tarjeta en la portada del curso ------------------------------------------------------

/** Se agrega bajo la portada si el curso alguna vez configuró constancias (si no, no hace ninguna solicitud). */
async function showCertificateCard() {
  const course = current?.course;
  if (!course?.certificate || teaches() || previewAsStudent || previewMember) return;
  let info;
  try {
    info = await request(`/api/certificates?course=${encodeURIComponent(course.id)}`, undefined, 'GET');
  } catch {
    return;
  }
  if (current?.course.id !== course.id || section !== 'hub' || document.querySelector('#certificateCard')) return;
  const cert = info.certificate;
  if (!info.settings.enabled && !cert) return;
  const min = info.settings.minScore;
  const hours = info.settings.hours ? ` de ${info.settings.hours} horas` : '';
  let body;
  if (cert?.revokedAt) body = '<p>Tu constancia fue revocada. Si crees que es un error, comunícate con tu docente.</p>';
  else if (cert)
    body = `<p>Folio <strong>${esc(cert.id)}</strong> · ${esc(certDate(cert.issuedAt))}. Cualquier persona puede comprobarla con el código QR.</p>
      <div class="action-row"><button type="button" class="primary" data-cert-download>Descargar constancia (PDF)</button><a class="table-link" href="/constancia/${esc(cert.id)}" target="_blank" rel="noopener">Ver verificación</a></div>`;
  else if (info.settings.byQuiz && info.best != null && info.best >= min)
    body = `<p>Aprobaste «${esc(info.quizTitle)}» con ${esc(certGrade(info.best))}. Ya puedes obtener tu constancia${hours}.</p>
      <div class="action-row"><button type="button" class="primary" data-cert-claim>Obtener mi constancia</button></div>`;
  else if (info.settings.byQuiz)
    body = `<p>Al aprobar «${esc(info.quizTitle)}» con ${esc(min)} o más podrás descargar tu constancia${hours}${info.best != null ? ` (tu mejor calificación: ${esc(certGrade(info.best))})` : ''}.</p>`;
  else body = `<p>Tu docente entregará las constancias${hours} al terminar el curso.</p>`;
  document.querySelector('#main .hub-banner')?.insertAdjacentHTML('afterend', `<section class="panel certificate-card" id="certificateCard"><h2>Tu constancia</h2>${body}</section>`);
  const card = document.querySelector('#certificateCard');
  card?.querySelector('[data-cert-download]')?.addEventListener('click', () => downloadCertificate(cert).catch((e) => toast(e.message)));
  card?.querySelector('[data-cert-claim]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const { certificate } = await request('/api/certificates/claim', { course: course.id });
      card.remove();
      await showCertificateCard();
      await downloadCertificate(certificate);
    } catch (error) {
      toast(error.message);
      e.target.disabled = false;
    }
  });
}

// ---- Docente: Administración del curso → Constancias ----------------------------------------------

function certificateRowsHtml(list) {
  const byMember = new Map(list.map((c) => [c.memberId, c]));
  const students = typeof studentsInView === 'function' ? studentsInView() : current.members.filter((m) => m.role === 'student');
  if (!students.length) return '<p class="muted">Todavía no hay alumnos inscritos.</p>';
  return `<table class="keep-table certificate-table"><thead><tr><th scope="col"><span class="sr-only">Elegir</span></th><th scope="col">Alumno</th><th scope="col">Constancia</th></tr></thead><tbody>${students
    .map((m) => {
      const c = byMember.get(m.id);
      const state = !c
        ? '<span class="muted">Sin constancia</span>'
        : c.revokedAt
          ? `<span class="role-pill archived-pill">Revocada</span> <span class="muted">${esc(c.id)}</span>`
          : `${esc(c.id)}${c.grade != null ? ` · ${esc(certGrade(c.grade))}` : ''} <button type="button" class="table-link" data-cert-pdf="${esc(c.id)}">PDF</button> <button type="button" class="danger-link" data-cert-revoke="${esc(c.id)}">Revocar</button>`;
      return `<tr><td>${!c || c.revokedAt ? `<input type="checkbox" data-cert-member value="${esc(m.id)}" aria-label="Entregar a ${esc(m.name)}">` : ''}</td><td>${esc(m.name)}</td><td>${state}</td></tr>`;
    })
    .join('')}</tbody></table>`;
}

async function certificatesModal() {
  const info = await request(`/api/certificates?course=${encodeURIComponent(current.course.id)}`, undefined, 'GET');
  const s = info.settings;
  let list = info.certificates;
  const quizzes = records('quiz');
  const html = `
    <label class="check-label"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> Entregar constancias en este curso</label>
    <label>¿Cómo la obtiene el alumno?
      <select name="quiz">
        <option value="">Se la entrego yo a los alumnos que elija</option>
        ${quizzes.map((q) => `<option value="${esc(q.id)}" ${q.id === s.quiz ? 'selected' : ''}>Al aprobar «${esc(q.data.title)}»</option>`).join('')}
      </select></label>
    <label>Calificación mínima para aprobar (de 0 a 10)<input name="minScore" type="number" min="0" max="10" step="0.1" value="${esc(s.minScore)}"></label>
    <label>Duración del curso en horas (opcional)<input name="hours" type="number" min="1" max="2000" step="0.5" value="${esc(s.hours ?? '')}"></label>
    <details class="more-actions"><summary>Más opciones</summary>
      <label>Nombre del curso en la constancia<input name="title" maxlength="150" value="${esc(s.title)}" placeholder="${esc(current.course.name)}"></label>
      <label>Firma<input name="signer" maxlength="120" value="${esc(s.signer)}" placeholder="Tu nombre"></label>
    </details>
    <p class="muted">Cada constancia lleva un folio y un código QR; quien la reciba puede comprobar que es auténtica en Enlace. Si cambias el nombre o las horas, solo cambian las constancias que se entreguen después.</p>
    <h3>Alumnos</h3>
    <div id="certificateRows">${certificateRowsHtml(list)}</div>
    <div class="action-row"><button type="button" class="secondary" data-cert-issue>Entregar a los marcados</button></div>`;
  modal('Constancias', html, async (form) => {
    await request('/api/certificates/settings', {
      course: current.course.id,
      enabled: form.get('enabled') === 'on',
      quiz: form.get('quiz'),
      minScore: Number(form.get('minScore') || 8),
      hours: form.get('hours'),
      title: form.get('title'),
      signer: form.get('signer'),
    });
    return 'Configuración de constancias guardada.';
  });
  const box = document.querySelector('#certificateRows');
  const refresh = (certificates) => {
    list = certificates;
    box.innerHTML = certificateRowsHtml(list);
  };
  box.addEventListener('click', async (e) => {
    const pdf = e.target.closest('[data-cert-pdf]');
    const revoke = e.target.closest('[data-cert-revoke]');
    if (pdf) return downloadCertificate(list.find((c) => c.id === pdf.dataset.certPdf)).catch((error) => toast(error.message));
    if (revoke && confirm('¿Revocar esta constancia? La página de verificación dirá que ya no es válida.')) {
      try {
        await request('/api/certificates/revoke', { course: current.course.id, id: revoke.dataset.certRevoke });
        refresh((await request(`/api/certificates?course=${encodeURIComponent(current.course.id)}`, undefined, 'GET')).certificates);
      } catch (error) {
        toast(error.message);
      }
    }
  });
  document.querySelector('[data-cert-issue]').addEventListener('click', async () => {
    const members = [...box.querySelectorAll('[data-cert-member]:checked')].map((i) => i.value);
    if (!members.length) return toast('Marca a los alumnos que recibirán su constancia.');
    try {
      refresh((await request('/api/certificates/issue', { course: current.course.id, members })).certificates);
      toast(members.length === 1 ? 'Constancia entregada.' : `${members.length} constancias entregadas.`);
    } catch (error) {
      toast(error.message.includes('activa') ? 'Primero marca «Entregar constancias en este curso» y guarda.' : error.message);
    }
  });
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-certificates]')) return;
  certificatesModal().catch((error) => toast(error.message));
});
