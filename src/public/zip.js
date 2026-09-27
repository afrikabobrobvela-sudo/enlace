/* Descarga de todas las entregas de una actividad en un ZIP, armado en el navegador.
   (En el plan gratuito, el Worker solo tiene 10 ms de procesador por solicitud: no alcanza para empaquetar archivos grandes.)
   Los archivos se guardan sin volver a comprimir: PDF, fotos y videos ya vienen comprimidos. */

const ZIP_MAX_BYTES = 1.5 * 1024 ** 3;
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** entries: [{ name, data: Uint8Array, date }] → partes de un ZIP (sin compresión, nombres en UTF-8). */
function zipParts(entries) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const { time, date } = dosDateTime(entry.date);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // versión necesaria: 2.0
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint16(8, 0, true); // sin compresión
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, entry.data.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, entry.data);
    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 20, true);
    header.setUint16(8, 0x0800, true);
    header.setUint16(12, time, true);
    header.setUint16(14, date, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, entry.data.length, true);
    header.setUint32(24, entry.data.length, true);
    header.setUint16(28, name.length, true);
    header.setUint32(42, offset, true);
    central.push(new Uint8Array(header.buffer), name);
    offset += 30 + name.length + entry.data.length;
  }
  const size = central.reduce((n, part) => n + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return [...parts, ...central, new Uint8Array(end.buffer)];
}

/** Nombre válido en Windows, Mac y Linux. */
function safeFileName(value, fallback = 'archivo') {
  const clean = String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 120);
  return clean || fallback;
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@\-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

/** Lista de archivos del ZIP: carpeta por alumno, texto de la entrega y resumen. No descarga nada. */
function submissionZipPlan(task, members, submissions, files) {
  const folder = safeFileName(task.data.title, 'Actividad');
  const used = new Set();
  const unique = (path) => {
    let candidate = path;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = path.replace(/(\.[^./]*)?$/, ` (${n})$1`);
    used.add(candidate.toLowerCase());
    return candidate;
  };
  const plan = [];
  const summary = [['Matrícula', 'Alumno', 'Entregado', 'Tardía', 'Calificación', 'Archivos']];
  for (const s of submissions.filter((s) => s.data.task === task.id && s.data.submitted)) {
    const member = members.find((m) => m.id === s.data.member);
    const who = safeFileName(`${member?.name || 'Alumno'}${member?.matricula ? ' - ' + member.matricula : ''}`, 'Alumno');
    if (String(s.data.body || '').trim()) plan.push({ path: unique(`${folder}/${who}/texto de la entrega.txt`), text: s.data.body });
    let count = 0;
    for (const id of s.data.fileIds || []) {
      const file = files.find((f) => f.id === id);
      if (!file) continue;
      plan.push({ path: unique(`${folder}/${who}/${safeFileName(file.name)}`), fileId: id, size: file.size || 0, date: s.data.submitted });
      count++;
    }
    summary.push([member?.matricula, member?.name, s.data.submitted, s.data.late ? 'Sí' : 'No', s.data.grade ?? '', count]);
  }
  plan.unshift({ path: `${folder}/resumen.csv`, text: '\uFEFF' + summary.map((row) => row.map(csvCell).join(',')).join('\r\n') });
  return { folder, plan, students: summary.length - 1 };
}

function saveBlob(name, blob) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = asciiFileName(name);
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function downloadTaskZip(taskId) {
  const task = find(taskId);
  const { folder, plan, students } = submissionZipPlan(task, current.members, records('submission'), current.files);
  if (!students) return toast('Todavía no hay entregas en esta actividad.');
  const total = plan.reduce((n, item) => n + (item.size || 0), 0);
  if (total > ZIP_MAX_BYTES) return toast('Las entregas suman más de 1.5 GB: el navegador podría quedarse sin memoria. Descárgalas por alumno.');
  const encoder = new TextEncoder();
  const downloads = plan.filter((item) => item.fileId);
  let done = 0;
  toast(`Preparando ${downloads.length} archivos de ${students} alumnos…`);
  const queue = [...downloads];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const response = await fetch('/api/file/' + encodeURIComponent(item.fileId), { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`No se pudo descargar ${item.path.split('/').pop()}.`);
      item.data = new Uint8Array(await response.arrayBuffer());
      done++;
      if (done % 5 === 0 || done === downloads.length) toast(`Descargando ${done} de ${downloads.length} archivos…`);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(4, downloads.length || 1) }, worker));
  } catch (error) {
    return toast(error.message);
  }
  const entries = plan.map((item) => ({ name: item.path, data: item.data || encoder.encode(item.text || ''), date: item.date ? new Date(item.date) : new Date() }));
  saveBlob(`${folder}.zip`, new Blob(zipParts(entries), { type: 'application/zip' }));
  toast(`Listo: ${folder}.zip con las entregas de ${students} ${students === 1 ? 'alumno' : 'alumnos'}.`);
}
