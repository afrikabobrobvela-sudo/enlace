// Constancias con folio y código QR (12.67).
// El docente las activa por curso (aula_courses.certificate, JSON) y elige cómo se obtienen:
// - al aprobar una evaluación con la calificación mínima: el alumno la pide desde la portada del curso;
// - o se las entrega el docente a los alumnos que elija (también sirve para reactivar una revocada).
// Cada constancia (aula_certificates) guarda una copia del nombre, el curso, las horas y el firmante. El PDF se arma
// en el navegador (constancias.js); su QR lleva a /constancia/<folio>, una página pública que dice si es válida.
import { access, requireTeacher } from './access.js';
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS, all, fail, json, nowIso, one, optionalText, parseJson, readJson, run } from './http.js';

const FOLIO = /^ENL-[0-9A-F]{10}$/;
const MAX_MEMBERS = 1000;
// 'ENL-' y 10 cifras hexadecimales al azar (40 bits): no se pueden adivinar para inventar una constancia.
const NEW_FOLIO = "'ENL-' || upper(hex(randomblob(5)))";

/** Configuración del curso con sus valores por omisión. */
export function certificateSettings(course) {
  const raw = parseJson(course?.certificate || '', {}) || {};
  return {
    enabled: raw.enabled === true,
    quiz: typeof raw.quiz === 'string' ? raw.quiz : '',
    minScore: Number.isFinite(raw.minScore) ? raw.minScore : 8,
    hours: Number.isFinite(raw.hours) ? raw.hours : null,
    title: typeof raw.title === 'string' ? raw.title : '',
    signer: typeof raw.signer === 'string' ? raw.signer : '',
  };
}

/** Título y firmante efectivos: el nombre del curso y el del propietario si el docente no escribió otros. */
async function issueData(db, course, settings) {
  const owner = settings.signer ? null : await one(db, 'SELECT name FROM aula_users WHERE id=?', course.owner);
  return { title: settings.title || course.name, signer: settings.signer || owner?.name || '', hours: settings.hours };
}

async function quizOf(db, course, id) {
  const row = await one(db, "SELECT id, data FROM aula_records WHERE id=? AND course=? AND kind='quiz' AND deleted_at IS NULL", String(id), course);
  return row ? { id: row.id, title: parseJson(row.data, {}).title || 'Evaluación' } : null;
}

/** Lo que el navegador necesita para dibujar y verificar la constancia. */
const publicRow = (r) => ({
  id: r.id,
  memberId: r.member_id,
  name: r.name,
  courseName: r.course_name,
  hours: r.hours,
  grade: r.grade,
  signer: r.signer,
  issuedAt: r.issued_at,
  revokedAt: r.revoked_at,
});

export const certificateRoutes = {
  /** Docente: configuración y constancias del curso. Alumno: la suya y si ya puede pedirla. */
  async 'GET /api/certificates'({ db, user, url }) {
    const a = await access(db, user, url.searchParams.get('course'));
    const settings = certificateSettings(a.course);
    const quiz = settings.quiz ? await quizOf(db, a.course.id, settings.quiz) : null;
    if (a.teach) {
      const rows = await all(db, 'SELECT * FROM aula_certificates WHERE course=? ORDER BY name', a.course.id);
      return json({ settings, quizTitle: quiz?.title || '', certificates: rows.map(publicRow) });
    }
    const member = await one(db, "SELECT id FROM aula_members WHERE course=? AND user_id=? AND role='student'", a.course.id, user.id);
    const mine = member ? await one(db, 'SELECT * FROM aula_certificates WHERE course=? AND member_id=?', a.course.id, member.id) : null;
    const best = quiz ? await one(db, 'SELECT max(score) AS score FROM aula_attempts WHERE course=? AND quiz=? AND user_id=?', a.course.id, quiz.id, user.id) : null;
    return json({
      settings: { enabled: settings.enabled, minScore: settings.minScore, hours: settings.hours, byQuiz: !!quiz },
      quizTitle: quiz?.title || '',
      best: best?.score ?? null,
      certificate: mine ? publicRow(mine) : null,
    });
  },

  async 'POST /api/certificates/settings'({ db, user, request }) {
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    requireTeacher(a);
    const quiz = body.quiz ? await quizOf(db, a.course.id, body.quiz) : null;
    if (body.quiz && !quiz) fail('Esa evaluación ya no existe. Elige otra.', 404);
    const minScore = Number(body.minScore ?? 8);
    if (!Number.isFinite(minScore) || minScore < 0 || minScore > 10) fail('La calificación mínima va de 0 a 10.');
    const hours = body.hours === '' || body.hours == null ? null : Number(body.hours);
    if (hours !== null && (!Number.isFinite(hours) || hours <= 0 || hours > 2000)) fail('Escribe las horas del curso (de 1 a 2000) o déjalas vacías.');
    const settings = {
      enabled: body.enabled === true,
      quiz: quiz?.id || '',
      minScore: Math.round(minScore * 100) / 100,
      hours,
      title: optionalText(body.title, 150) || '',
      signer: optionalText(body.signer, 120) || '',
    };
    await run(db, 'UPDATE aula_courses SET certificate=? WHERE id=?', JSON.stringify(settings), a.course.id);
    return json({ settings });
  },

  /** El docente entrega (o reactiva) la constancia a los alumnos elegidos. */
  async 'POST /api/certificates/issue'({ db, user, request }) {
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    requireTeacher(a);
    const ids = Array.isArray(body.members) ? [...new Set(body.members.map(String))] : [];
    if (!ids.length) fail('Elige al menos un alumno.');
    if (ids.length > MAX_MEMBERS) fail(`Elige como máximo ${MAX_MEMBERS} alumnos a la vez.`);
    const settings = certificateSettings(a.course);
    if (!settings.enabled) fail('Primero activa las constancias del curso.', 409);
    const data = await issueData(db, a.course, settings);
    await run(
      db,
      `INSERT INTO aula_certificates (id, course, member_id, user_id, name, course_name, hours, grade, signer, issued_at, issued_by)
       SELECT ${NEW_FOLIO}, m.course, m.id, m.user_id, m.name, ?, ?, NULL, ?, ?, ?
       FROM aula_members m WHERE m.course=? AND m.role='student' AND m.id IN (SELECT value FROM json_each(?))
       ON CONFLICT(course, member_id) DO UPDATE SET revoked_at=NULL`,
      data.title,
      data.hours,
      data.signer,
      nowIso(),
      user.id,
      a.course.id,
      JSON.stringify(ids),
    );
    const rows = await all(db, 'SELECT * FROM aula_certificates WHERE course=? ORDER BY name', a.course.id);
    return json({ certificates: rows.map(publicRow) });
  },

  async 'POST /api/certificates/revoke'({ db, user, request }) {
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    requireTeacher(a);
    const done = await run(db, 'UPDATE aula_certificates SET revoked_at=? WHERE id=? AND course=? AND revoked_at IS NULL', nowIso(), String(body.id ?? ''), a.course.id);
    if (!done.meta?.changes) fail('Esa constancia no existe o ya estaba revocada.', 404);
    return json({ ok: true });
  },

  /** El alumno la obtiene al aprobar la evaluación elegida por el docente con la calificación mínima. */
  async 'POST /api/certificates/claim'({ db, user, request }) {
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    if (a.teach) fail('Las constancias son para los alumnos del curso.', 403);
    const settings = certificateSettings(a.course);
    const member = await one(db, "SELECT id FROM aula_members WHERE course=? AND user_id=? AND role='student'", a.course.id, user.id);
    if (!member) fail('No estás inscrito en este curso.', 403);
    // Quien ya la tiene la conserva aunque después se apaguen las constancias del curso.
    const existing = await one(db, 'SELECT * FROM aula_certificates WHERE course=? AND member_id=?', a.course.id, member.id);
    if (existing?.revoked_at) fail('Tu constancia fue revocada. Comunícate con tu docente.', 409);
    if (existing) return json({ certificate: publicRow(existing) });
    if (!settings.enabled) fail('Este curso no entrega constancias.', 409);
    const quiz = settings.quiz ? await quizOf(db, a.course.id, settings.quiz) : null;
    if (!quiz) fail('Tu docente entrega las constancias de este curso.', 409);
    const best = await one(db, 'SELECT max(score) AS score FROM aula_attempts WHERE course=? AND quiz=? AND user_id=?', a.course.id, quiz.id, user.id);
    if (best?.score == null || best.score < settings.minScore) {
      fail(`Para obtener tu constancia necesitas ${settings.minScore} o más en «${quiz.title}».`, 409);
    }
    const data = await issueData(db, a.course, settings);
    await run(
      db,
      `INSERT INTO aula_certificates (id, course, member_id, user_id, name, course_name, hours, grade, signer, issued_at, issued_by)
       SELECT ${NEW_FOLIO}, m.course, m.id, m.user_id, m.name, ?, ?, ?, ?, ?, ? FROM aula_members m WHERE m.id=?
       ON CONFLICT(course, member_id) DO NOTHING`,
      data.title,
      data.hours,
      best.score,
      data.signer,
      nowIso(),
      user.id,
      member.id,
    );
    const row = await one(db, 'SELECT * FROM aula_certificates WHERE course=? AND member_id=?', a.course.id, member.id);
    return json({ certificate: publicRow(row) }, 201);
  },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const longDate = (iso) =>
  new Date(iso).toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric', month: 'long', year: 'numeric' });

/** Página pública de verificación (sin sesión): a esta dirección lleva el código QR de la constancia. */
export async function serveCertificatePage(db, folio) {
  const row = FOLIO.test(folio) ? await one(db, 'SELECT * FROM aula_certificates WHERE id=?', folio) : null;
  const state = !row ? 'missing' : row.revoked_at ? 'revoked' : 'valid';
  const heading = { valid: 'Constancia válida', revoked: 'Constancia revocada', missing: 'Constancia no encontrada' }[state];
  const detail = row
    ? `<dl>
        <dt>Otorgada a</dt><dd>${esc(row.name)}</dd>
        <dt>Curso</dt><dd>${esc(row.course_name)}</dd>
        ${row.hours ? `<dt>Duración</dt><dd>${esc(row.hours)} horas</dd>` : ''}
        ${row.grade != null ? `<dt>Calificación</dt><dd>${esc(Math.round(row.grade * 10) / 10)} de 10</dd>` : ''}
        <dt>Fecha</dt><dd>${esc(longDate(row.issued_at))}</dd>
        ${row.signer ? `<dt>Firma</dt><dd>${esc(row.signer)}</dd>` : ''}
        <dt>Folio</dt><dd class="folio">${esc(row.id)}</dd>
      </dl>${state === 'revoked' ? `<p>Fue revocada el ${esc(longDate(row.revoked_at))} y ya no tiene validez.</p>` : ''}`
    : '<p>Revisa que el folio esté bien escrito. Si escaneaste el código de una constancia y llegaste aquí, la constancia no es auténtica.</p>';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${heading} · Enlace</title>
<style>
body{margin:0;background:#f6f8fa;color:#111a2e;font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:560px;margin:0 auto;padding:40px 16px}
.card{background:#fff;border-radius:8px;box-shadow:0 2px 0 rgba(17,26,46,.1);padding:28px 24px;border-top:6px solid ${state === 'valid' ? '#0a6e60' : '#c0183f'}}
h1{margin:0 0 4px;font-size:28px;line-height:1.1;color:${state === 'valid' ? '#064a40' : '#86102c'}}
.sub{margin:0 0 20px;color:#3d4b5c}
dl{display:grid;grid-template-columns:max-content 1fr;gap:8px 16px;margin:0}
dt{color:#5f6f7e}dd{margin:0;font-weight:600}
.folio{font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:.04em}
footer{margin-top:20px;color:#5f6f7e;font-size:14px}
</style></head><body><main><div class="card"><h1>${heading}</h1>
<p class="sub">${state === 'valid' ? 'Esta constancia fue emitida por Enlace y sus datos son auténticos.' : state === 'revoked' ? 'Esta constancia existió, pero fue revocada.' : 'No existe una constancia con ese folio.'}</p>
${detail}</div><footer>Verificación de constancias de Enlace.</footer></main></body></html>`;
  return new Response(html, {
    status: row ? 200 : 404,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CONTENT_SECURITY_POLICY },
  });
}
