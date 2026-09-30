// Banco de preguntas: cada docente guarda preguntas por tema para reutilizarlas en sus evaluaciones de cualquier curso
// y semestre, y puede compartirlas con los docentes de su academia. Una evaluación siempre guarda su propia copia:
// cambiar o borrar una pregunta del banco no altera evaluaciones ya hechas ni sus intentos.
import { access, requireTeacher } from './access.js';
import { all, fail, json, nowIso, one, readJson, run } from './http.js';
import { MAX_QUESTIONS, questionFields, questionFingerprint } from './quizzes.js';

export const MAX_BANK_QUESTIONS = 2000; // por docente
const MAX_PER_REQUEST = 100;
const MAX_TOPIC = 80;

const topicOf = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_TOPIC);

function requireStaff(user) {
  if (user.role !== 'teacher' && user.role !== 'admin') fail('El banco de preguntas es para docentes.', 403);
}

/** Lista de ids enviada por la interfaz (sin repetir y con un máximo). */
function idList(value, max = MAX_PER_REQUEST) {
  if (!Array.isArray(value) || !value.length) fail('Elige al menos una pregunta.');
  const ids = [...new Set(value.filter((x) => typeof x === 'string' && x.length <= 64))];
  if (!ids.length || ids.length > max) fail(`Elige de 1 a ${max} preguntas.`);
  return ids;
}

/** Condición SQL: preguntas que puede usar la persona (las suyas y las compartidas por docentes de su academia). */
const VISIBLE = `(b.owner_id=?1 OR (b.shared=1 AND ?2 IS NOT NULL AND o.academy_id=?2))`;

/** ¿Hay una pregunta del banco visible para esta persona con esa imagen? (para mostrarla aunque sea de otro curso) */
export async function bankImageVisible(db, user, fileId) {
  if (user.role !== 'teacher' && user.role !== 'admin') return false;
  const row = await one(
    db,
    `SELECT 1 AS ok FROM aula_question_bank b JOIN aula_users o ON o.id=b.owner_id
     WHERE ${VISIBLE} AND json_extract(b.question,'$.image')=?3 LIMIT 1`,
    user.id,
    user.academy_id ?? null,
    fileId,
  );
  return Boolean(row);
}

/** Las imágenes de preguntas nuevas deben ser archivos de material del curso desde donde se guardan. */
async function assertImages(db, course, questions, allowed = new Set()) {
  const images = [...new Set(questions.map((q) => q.image).filter((id) => id && !allowed.has(id)))];
  if (!images.length) return;
  const found = await one(db, "SELECT count(*) AS n FROM aula_files WHERE course=? AND scope='material' AND id IN (SELECT value FROM json_each(?))", course, JSON.stringify(images));
  if (found.n !== images.length) fail('Una imagen de las preguntas no es válida. Vuelve a subirla.');
}

const bankRow = (row, user) => ({
  id: row.id,
  topic: row.topic,
  question: JSON.parse(row.question),
  shared: Boolean(row.shared),
  mine: row.owner_id === user.id,
  owner: row.owner_name || '',
  created: row.created,
  updated: row.updated,
});

export const bankRoutes = {
  // Mis preguntas (`scope=mine`) o las que comparten los docentes de mi academia (`scope=shared`).
  'GET /api/bank': async ({ db, user, url }) => {
    requireStaff(user);
    const shared = url.searchParams.get('scope') === 'shared';
    const rows = await all(
      db,
      `SELECT b.*, coalesce(o.name, o.email) AS owner_name FROM aula_question_bank b JOIN aula_users o ON o.id=b.owner_id
       WHERE ${shared ? 'b.shared=1 AND ?2 IS NOT NULL AND o.academy_id=?2 AND b.owner_id!=?1' : 'b.owner_id=?1'}
       ORDER BY b.topic COLLATE NOCASE, b.created LIMIT ?3`,
      user.id,
      user.academy_id ?? null,
      MAX_BANK_QUESTIONS,
    );
    return json({ questions: rows.map((row) => bankRow(row, user)), hasAcademy: Boolean(user.academy_id), limit: MAX_BANK_QUESTIONS });
  },

  // Guardar preguntas en el banco (desde el editor o desde una evaluación). Las repetidas no se duplican.
  'POST /api/bank': async ({ db, user, request }) => {
    requireStaff(user);
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    const input = Array.isArray(body.questions) ? body.questions : [];
    if (!input.length || input.length > MAX_PER_REQUEST) fail(`Guarda de 1 a ${MAX_PER_REQUEST} preguntas a la vez.`);
    const questions = input.map((q, n) => {
      const { pool: _pool, ...question } = questionFields(q, `Pregunta ${n + 1}`);
      return question;
    });
    await assertImages(db, body.course, questions);
    const topic = topicOf(body.topic);
    const shared = body.shared === true ? 1 : 0;
    const now = nowIso();
    const byPrint = new Map();
    for (const question of questions) {
      const fingerprint = await questionFingerprint(question);
      if (!byPrint.has(fingerprint)) byPrint.set(fingerprint, { id: crypto.randomUUID(), fingerprint, question: JSON.stringify(question) });
    }
    const count = await one(db, 'SELECT count(*) AS n FROM aula_question_bank WHERE owner_id=?', user.id);
    if (count.n + byPrint.size > MAX_BANK_QUESTIONS) fail(`Tu banco admite hasta ${MAX_BANK_QUESTIONS} preguntas. Borra las que ya no uses.`);
    const result = await run(
      db,
      `INSERT INTO aula_question_bank (id,owner_id,topic,question,fingerprint,shared,created,updated)
       SELECT json_extract(value,'$.id'), ?1, ?2, json_extract(value,'$.question'), json_extract(value,'$.fingerprint'), ?3, ?4, ?4
       FROM json_each(?5)
       WHERE NOT EXISTS (SELECT 1 FROM aula_question_bank b WHERE b.owner_id=?1 AND b.fingerprint=json_extract(value,'$.fingerprint'))`,
      user.id,
      topic,
      shared,
      now,
      JSON.stringify([...byPrint.values()]),
    );
    const saved = result.meta.changes || 0;
    return json({ saved, repeated: questions.length - saved }, 201);
  },

  // Cambiar una pregunta propia: tema, compartir y, si se envía, la pregunta misma.
  'POST /api/bank/update': async ({ db, user, request }) => {
    requireStaff(user);
    const body = await readJson(request);
    const row = await one(db, 'SELECT * FROM aula_question_bank WHERE id=? AND owner_id=?', String(body.id ?? ''), user.id);
    if (!row) fail('Pregunta no encontrada en tu banco.', 404);
    let question = JSON.parse(row.question);
    if (body.question) {
      const { pool: _pool, ...next } = questionFields(body.question, 'La pregunta');
      // Una imagen nueva se sube desde el curso abierto; la que ya tenía se conserva aunque sea de otro curso.
      if (next.image && next.image !== question.image) {
        requireTeacher(await access(db, user, body.course));
        await assertImages(db, body.course, [next]);
      }
      question = next;
    }
    const fingerprint = await questionFingerprint(question);
    await run(
      db,
      'UPDATE aula_question_bank SET topic=?, shared=?, question=?, fingerprint=?, updated=? WHERE id=? AND owner_id=?',
      body.topic === undefined ? row.topic : topicOf(body.topic),
      body.shared === undefined ? row.shared : body.shared === true ? 1 : 0,
      JSON.stringify(question),
      fingerprint,
      nowIso(),
      row.id,
      user.id,
    );
    return json({ ok: true });
  },

  // Renombrar un tema o compartir (o dejar de compartir) todas sus preguntas de una vez.
  'POST /api/bank/topic': async ({ db, user, request }) => {
    requireStaff(user);
    const body = await readJson(request);
    const topic = topicOf(body.topic);
    const rename = body.rename === undefined ? null : topicOf(body.rename);
    const shared = typeof body.shared === 'boolean' ? (body.shared ? 1 : 0) : null;
    if (rename === null && shared === null) fail('Indica qué cambiar del tema.');
    const result = await run(
      db,
      'UPDATE aula_question_bank SET topic=coalesce(?1, topic), shared=coalesce(?2, shared), updated=?3 WHERE owner_id=?4 AND topic=?5',
      rename,
      shared,
      nowIso(),
      user.id,
      topic,
    );
    return json({ changed: result.meta.changes || 0 });
  },

  // Borrar del banco (solo las propias). Las evaluaciones que ya las usan conservan su copia.
  'POST /api/bank/delete': async ({ db, user, request }) => {
    requireStaff(user);
    const body = await readJson(request);
    const ids = idList(body.ids, 500);
    const result = await run(db, 'DELETE FROM aula_question_bank WHERE owner_id=? AND id IN (SELECT value FROM json_each(?))', user.id, JSON.stringify(ids));
    return json({ deleted: result.meta.changes || 0 });
  },

  /**
   * Preguntas del banco listas para agregar a una evaluación de este curso. Cada una llega con su tema como grupo
   * (para sortear) y, si tiene imagen de otro curso, con una copia del archivo en este curso que comparte el mismo
   * objeto de R2 (no ocupa espacio extra; igual que al copiar un curso).
   */
  'POST /api/bank/use': async ({ db, user, request }) => {
    requireStaff(user);
    const body = await readJson(request);
    requireTeacher(await access(db, user, body.course));
    // Hasta 300 (12.27): un examen completo de Brightspace, como el de Química, viene de 12 temas del banco.
    const ids = idList(body.ids, MAX_QUESTIONS);
    const rows = await all(
      db,
      `SELECT b.* FROM aula_question_bank b JOIN aula_users o ON o.id=b.owner_id
       WHERE ${VISIBLE} AND b.id IN (SELECT value FROM json_each(?3))`,
      user.id,
      user.academy_id ?? null,
      JSON.stringify(ids),
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const picked = ids.filter((id) => byId.has(id)).map((id) => ({ topic: byId.get(id).topic, question: JSON.parse(byId.get(id).question) }));
    if (!picked.length) fail('Esas preguntas ya no están en el banco.', 404);
    const imageIds = [...new Set(picked.map((p) => p.question.image).filter(Boolean))];
    const images = new Map();
    let missingImages = 0;
    if (imageIds.length) {
      const sources = await all(
        db,
        "SELECT id, course, name, size, mime, coalesce(r2_key, id) AS k FROM aula_files WHERE scope='material' AND id IN (SELECT value FROM json_each(?))",
        JSON.stringify(imageIds),
      );
      // Si este curso ya tiene ese mismo objeto (la imagen es de aquí o ya se agregó antes), se reutiliza.
      const here = await all(
        db,
        "SELECT id, coalesce(r2_key, id) AS k FROM aula_files WHERE course=? AND scope='material' AND coalesce(r2_key, id) IN (SELECT value FROM json_each(?))",
        body.course,
        JSON.stringify(sources.map((f) => f.k)),
      );
      const hereByKey = new Map(here.map((f) => [f.k, f.id]));
      const copies = [];
      for (const f of sources) {
        let id = f.course === body.course ? f.id : hereByKey.get(f.k);
        if (!id) {
          id = crypto.randomUUID();
          hereByKey.set(f.k, id);
          copies.push({ id, name: f.name, size: f.size, mime: f.mime, key: f.k });
        }
        images.set(f.id, id);
      }
      if (copies.length) {
        await run(
          db,
          `INSERT INTO aula_files (id,course,owner,scope,name,size,mime,created,r2_key)
           SELECT json_extract(value,'$.id'), ?1, ?2, 'material', json_extract(value,'$.name'), json_extract(value,'$.size'),
                  json_extract(value,'$.mime'), ?3, json_extract(value,'$.key') FROM json_each(?4)`,
          body.course,
          user.id,
          nowIso(),
          JSON.stringify(copies),
        );
      }
    }
    const questions = picked.map(({ topic, question }) => {
      const { image, ...rest } = question;
      if (image && !images.has(image)) missingImages++;
      return { ...rest, ...(image && images.has(image) ? { image: images.get(image) } : {}), ...(topic ? { pool: topic } : {}) };
    });
    return json({ questions, missingImages });
  },
};
