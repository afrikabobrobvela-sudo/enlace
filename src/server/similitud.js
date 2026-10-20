// Informes de similitud (12.84). El navegador del docente compara las entregas de una actividad (src/public/similitud.js)
// y guarda aquí una fila por entrega: así la revisión de cada entrega muestra su porcentaje y el informe con las fuentes
// se abre sin volver a comparar todo. Solo quien enseña los lee y los escribe; el alumno no recibe nada de esto.
//
// `summary` (pequeño, va en la lista): { format, unit, team, sources: [{ submission, member, members, team, pct,
// literal, words, blocks }], notes, settings, compared, skipped, commonShare }. `unit` agrupa a un equipo en la tabla
// (12.87) y cada fuente es un equipo o una entrega. `data` (solo en el informe): { v, hash, words, eligible,
// excluded: [[desde, hasta, motivo]], blocks: [[fuente, desde, hasta, tipo, fragmento, otra, desde, hasta]],
// others: [{ submission, hash, words }] } en índices de palabra del texto que leyó el navegador; `hash` es la huella de
// ese texto para no dibujar marcas sobre otro, y `otra` señala en `others` la entrega donde está la pareja del bloque.
import { access, requireTeacher } from './access.js';
import { all, fail, json, nowIso, one, readJson, run } from './http.js';

const MAX_BODY = 1_500_000; // por solicitud: el navegador manda los informes en partes (D1 acepta textos de hasta 2 MB)
const MAX_REPORTS = 150; // por solicitud
const MAX_DATA = 300_000; // por informe
const MAX_SOURCES = 300;
const MAX_BLOCKS = 2000;
const MAX_EXCLUDED = 5000;
const MAX_OTHERS = 400;
const MAX_MEMBERS = 60;
const MAX_WORDS = 500_000;
const EXCLUDED = new Set(['c', 'b', 'i', 'p']); // cita, bibliografía, instrucciones, texto común a muchas entregas

const bad = () => fail('Informe de similitud no válido.');
const text = (value, max = 100) => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : bad());
const short = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const share = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) bad();
  return Math.round(n * 10000) / 10000;
};
const int = (value, max) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) bad();
  return n;
};
const list = (value, max) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) bad();
  return value;
};

/** Resumen: fuentes con su porcentaje y avisos. Solo números y textos acotados. */
export function cleanSummary(input) {
  const s = input && typeof input === 'object' ? input : bad();
  const settings = s.settings && typeof s.settings === 'object' ? s.settings : {};
  return {
    format: int(s.format ?? 1, 10),
    unit: s.unit === undefined ? '' : text(s.unit),
    team: short(s.team, 100),
    sources: list(s.sources, MAX_SOURCES).map((x) => ({
      submission: text(x?.submission),
      member: text(x?.member),
      members: list(x?.members, MAX_MEMBERS).map((m) => text(m)),
      team: short(x?.team, 100),
      pct: share(x?.pct),
      literal: share(x?.literal),
      words: int(x?.words, MAX_WORDS),
      blocks: int(x?.blocks, MAX_BLOCKS),
    })),
    notes: list(s.notes, 30).map((note) => short(note, 300)),
    settings: {
      minRun: int(settings.minRun ?? 8, 50),
      quotes: settings.quotes !== false,
      bibliography: settings.bibliography !== false,
      instructions: settings.instructions !== false,
      common: settings.common !== false,
      teams: short(settings.teams, 100),
    },
    compared: int(s.compared ?? 0, 100_000),
    skipped: int(s.skipped ?? 0, 100_000),
    commonShare: share(s.commonShare ?? 0),
  };
}

/** Bloques coincidentes y exclusiones, con posiciones dentro del texto (`words` palabras). */
export function cleanData(input, sources) {
  const d = input && typeof input === 'object' ? input : bad();
  const words = int(d.words, MAX_WORDS);
  const range = (from, to, max = words) => int(from, max) < int(to, max) || bad();
  const others = list(d.others, MAX_OTHERS).map((o) => ({ submission: text(o?.submission), hash: text(o?.hash, 40), words: int(o?.words, MAX_WORDS) }));
  return {
    v: d.v === 2 ? 2 : 1,
    hash: text(d.hash, 40),
    words,
    eligible: int(d.eligible, words),
    excluded: list(d.excluded, MAX_EXCLUDED).map((x) => {
      if (!Array.isArray(x) || !EXCLUDED.has(x[2])) bad();
      range(x[0], x[1]);
      return [x[0], x[1], x[2]];
    }),
    blocks: list(d.blocks, MAX_BLOCKS).map((x) => {
      if (!Array.isArray(x) || (x.length !== 5 && x.length !== 8) || (x[3] !== 1 && x[3] !== 2) || !sources) bad();
      range(x[1], x[2]);
      const block = [int(x[0], sources - 1), x[1], x[2], x[3], short(x[4], 400)];
      if (x.length === 8) {
        const other = others[int(x[5], others.length - 1)] || bad();
        range(x[6], x[7], other.words);
        block.push(x[5], x[6], x[7]);
      }
      return block;
    }),
    others,
  };
}

async function loadTask(db, course, id) {
  const task = await one(db, 'SELECT id, forum FROM aula_tasks WHERE id=? AND course=? AND deleted_at IS NULL', String(id ?? ''), course);
  if (!task) fail('Actividad no encontrada.', 404);
  return task;
}

export const similarityRoutes = {
  // Lista de informes de una actividad (sin los bloques): porcentaje, fuentes y avisos de cada entrega.
  async 'GET /api/similarity'({ db, user, url }) {
    const a = await access(db, user, url.searchParams.get('course'));
    requireTeacher(a);
    const task = await loadTask(db, a.course.id, url.searchParams.get('task'));
    const rows = await all(
      db,
      `SELECT r.submission, s.member, r.version, r.total, r.literal, r.summary, r.analyzed_at
       FROM aula_similarity r JOIN aula_submissions s ON s.id=r.submission AND s.course=r.course AND s.task=r.task
       WHERE r.course=? AND r.task=?`,
      a.course.id,
      task.id,
    );
    return json({
      reports: rows.map((r) => ({ submission: r.submission, member: r.member, version: r.version, total: r.total, literal: r.literal, summary: JSON.parse(r.summary), analyzedAt: r.analyzed_at })),
    });
  },

  // Un informe completo (con los bloques coincidentes y el fragmento de cada fuente).
  async 'GET /api/similarity/report'({ db, user, url }) {
    const a = await access(db, user, url.searchParams.get('course'));
    requireTeacher(a);
    const r = await one(
      db,
      `SELECT r.submission, r.task, s.member, r.version, r.total, r.literal, r.summary, r.data, r.analyzed_at, r.analyzed_by
       FROM aula_similarity r
       JOIN aula_submissions s ON s.id=r.submission AND s.course=r.course
       JOIN aula_tasks t ON t.id=r.task AND t.course=r.course AND t.deleted_at IS NULL
       WHERE r.submission=? AND r.course=?`,
      String(url.searchParams.get('submission') ?? ''),
      a.course.id,
    );
    if (!r) fail('Esta entrega todavía no tiene informe de similitud.', 404);
    return json({
      report: { submission: r.submission, task: r.task, member: r.member, version: r.version, total: r.total, literal: r.literal, summary: JSON.parse(r.summary), data: JSON.parse(r.data), analyzedAt: r.analyzed_at },
    });
  },

  // Guarda (o reemplaza) los informes de entregas de una actividad. Solo se guardan los de entregas que sí son de esa
  // actividad y de este curso (el JOIN descarta lo demás).
  async 'POST /api/similarity'({ db, user, request }) {
    const body = await readJson(request, MAX_BODY);
    const a = await access(db, user, body.course);
    requireTeacher(a);
    const task = await loadTask(db, a.course.id, body.task);
    if (task.forum) fail('La participación en un foro no tiene entregas que comparar.');
    const reports = list(body.reports, MAX_REPORTS).map((r) => {
      const summary = cleanSummary(r?.summary);
      const data = JSON.stringify(cleanData(r?.data, summary.sources.length));
      if (data.length > MAX_DATA) fail('Un informe de similitud es demasiado grande.', 413);
      return { submission: text(r?.submission), version: text(r?.version, 80), total: share(r?.total), literal: share(r?.literal), summary: JSON.stringify(summary), data };
    });
    if (!reports.length) return json({ saved: 0 });
    const result = await run(
      db,
      `INSERT INTO aula_similarity (submission, course, task, version, total, literal, summary, data, analyzed_at, analyzed_by)
       SELECT s.id, s.course, s.task, json_extract(j.value,'$.version'), json_extract(j.value,'$.total'), json_extract(j.value,'$.literal'),
              json_extract(j.value,'$.summary'), json_extract(j.value,'$.data'), ?, ?
       FROM json_each(?) j JOIN aula_submissions s ON s.id=json_extract(j.value,'$.submission') AND s.course=? AND s.task=?
       WHERE true
       ON CONFLICT(submission) DO UPDATE SET version=excluded.version, total=excluded.total, literal=excluded.literal,
         summary=excluded.summary, data=excluded.data, analyzed_at=excluded.analyzed_at, analyzed_by=excluded.analyzed_by
       WHERE aula_similarity.course=excluded.course`,
      nowIso(),
      user.id,
      JSON.stringify(reports),
      a.course.id,
      task.id,
    );
    return json({ saved: result.meta?.changes ?? reports.length });
  },
};
