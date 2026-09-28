// Registro de docentes: catálogo de academias y unidades académicas, solicitudes para ser docente
// (con aprobación de la administración) y la academia/unidad de cada docente.
import { requireAdmin } from './access.js';
import { all, fail, json, nowIso, one, optionalText, readJson, run, text } from './http.js';

const KINDS = { academy: 'aula_academies', unit: 'aula_units' };
const MAX_BULK = 200;

/** Dominios de correo que pueden pedir ser docentes (TEACHER_EMAIL_DOMAINS, separados por comas). */
export function teacherDomains(env) {
  return String(env.TEACHER_EMAIL_DOMAINS ?? 'correo.buap.mx')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export const canRequestTeacher = (env, user) => user.role === 'student' && teacherDomains(env).includes(user.email.split('@')[1]);

/** Clave para detectar duplicados: sin mayúsculas, acentos ni espacios repetidos ("Física" = "FISICA"). */
const nameKey = (name) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

async function existingKeys(db, table, exceptId = null) {
  const rows = await all(db, `SELECT id, name FROM ${table}`);
  return new Set(rows.filter((r) => r.id !== exceptId).map((r) => nameKey(r.name)));
}

function catalogTable(kind) {
  const table = KINDS[kind];
  if (!table) fail('Catálogo no válido.');
  return table;
}

/** Comprueba que la academia y la unidad existan y estén activas. */
async function validClassification(db, academyId, unitId) {
  const row = await one(
    db,
    `SELECT (SELECT name FROM aula_academies WHERE id=?1 AND active=1) AS academy,
            (SELECT name FROM aula_units WHERE id=?2 AND active=1) AS unit`,
    String(academyId ?? ''),
    String(unitId ?? ''),
  );
  if (!row.academy) fail('Elige tu academia.');
  if (!row.unit) fail('Elige tu unidad académica.');
  return { academyId: String(academyId), unitId: String(unitId) };
}

/**
 * Datos del registro que acompañan a /api/me en una sola consulta: si falta clasificar a un docente,
 * si la persona puede pedir ser docente, su última solicitud y, para la administración, las pendientes.
 */
export async function registrationStatus(db, env, user) {
  const row = await one(
    db,
    `SELECT (SELECT count(*) FROM aula_academies WHERE active=1) AS academies,
            (SELECT count(*) FROM aula_units WHERE active=1) AS units,
            (SELECT json_object('status', status, 'reason', reason, 'created', created)
               FROM aula_teacher_requests WHERE user_id=?1 ORDER BY created DESC LIMIT 1) AS request,
            (SELECT count(*) FROM aula_teacher_requests WHERE status='pending') AS pending`,
    user.id,
  );
  const catalogReady = row.academies > 0 && row.units > 0;
  const teacher = user.role === 'teacher' || user.role === 'admin';
  return {
    academyId: user.academy_id ?? null,
    unitId: user.unit_id ?? null,
    needsClassification: teacher && catalogReady && (!user.academy_id || !user.unit_id),
    canRequestTeacher: catalogReady && canRequestTeacher(env, user),
    teacherRequest: row.request ? JSON.parse(row.request) : null,
    ...(user.role === 'admin' ? { pendingTeacherRequests: row.pending } : {}),
  };
}

export const directoryRoutes = {
  // Catálogo visible para cualquier persona con sesión (la administración también ve lo desactivado).
  'GET /api/catalog': async ({ db, user }) => {
    const filter = user.role === 'admin' ? '' : 'WHERE active=1';
    const [academies, units] = await Promise.all(
      Object.values(KINDS).map((table) => all(db, `SELECT id, name, active FROM ${table} ${filter} ORDER BY name COLLATE NOCASE`)),
    );
    return json({ academies, units });
  },

  // Alta, cambio de nombre o desactivación de una academia o unidad. No se borran: pueden tener docentes y cursos.
  'POST /api/catalog': async ({ db, user, request }) => {
    requireAdmin(user);
    const body = await readJson(request);
    const table = catalogTable(body.kind);
    const name = text(body.name, 150);
    const active = body.active === false ? 0 : 1;
    if ((await existingKeys(db, table, body.id ?? null)).has(nameKey(name))) fail(`Ya existe "${name}".`, 409);
    if (body.id) {
      const result = await run(db, `UPDATE ${table} SET name=?, active=? WHERE id=?`, name, active, String(body.id));
      if (!result.meta.changes) fail('Elemento no encontrado.', 404);
      return json({ id: body.id });
    }
    const id = crypto.randomUUID();
    await run(db, `INSERT INTO ${table} (id,name,active,created) VALUES (?,?,?,?)`, id, name, active, nowIso());
    return json({ id }, 201);
  },

  // Lista pegada (un nombre por renglón). Ignora los que ya existen, sin importar mayúsculas.
  'POST /api/catalog/bulk': async ({ db, user, request }) => {
    requireAdmin(user);
    const body = await readJson(request);
    const table = catalogTable(body.kind);
    if (!Array.isArray(body.names) || !body.names.length) fail('La lista está vacía.');
    if (body.names.length > MAX_BULK) fail(`Agrega como máximo ${MAX_BULK} a la vez.`);
    const seen = await existingKeys(db, table);
    const rows = [];
    let existing = 0;
    for (const raw of body.names) {
      const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
      if (!name) continue;
      if (name.length > 150) fail(`Nombre demasiado largo: ${name.slice(0, 40)}…`);
      if (seen.has(nameKey(name))) {
        existing++;
        continue;
      }
      seen.add(nameKey(name));
      rows.push({ id: crypto.randomUUID(), name });
    }
    if (!rows.length && !existing) fail('La lista está vacía.');
    if (rows.length) {
      await run(
        db,
        `INSERT INTO ${table} (id,name,active,created)
         SELECT json_extract(j.value,'$.id'), json_extract(j.value,'$.name'), 1, ?1 FROM json_each(?2) j`,
        nowIso(),
        JSON.stringify(rows),
      );
    }
    return json({ created: rows.length, existing }, 201);
  },

  // El docente (o la administración) registra su academia y unidad.
  'POST /api/profile/classification': async ({ db, user, request }) => {
    if (user.role !== 'teacher' && user.role !== 'admin') fail('Solo el personal docente registra su academia.', 403);
    const body = await readJson(request);
    const { academyId, unitId } = await validClassification(db, body.academy, body.unit);
    await run(db, 'UPDATE aula_users SET academy_id=?, unit_id=? WHERE id=?', academyId, unitId, user.id);
    return json({ ok: true });
  },

  // Solicitud para ser docente. Solo con correo institucional y si no hay otra pendiente.
  'POST /api/teacher-request': async ({ db, env, user, request }) => {
    if (user.role !== 'student') fail('Tu cuenta ya es de docente.', 409);
    if (!canRequestTeacher(env, user)) {
      fail(`Para solicitar acceso como docente entra con tu correo institucional (${teacherDomains(env).map((d) => '@' + d).join(', ')}).`, 403);
    }
    const body = await readJson(request);
    const { academyId, unitId } = await validClassification(db, body.academy, body.unit);
    try {
      await run(
        db,
        `INSERT INTO aula_teacher_requests (id,user_id,email,name,academy_id,unit_id,subjects,message,status,created)
         VALUES (?,?,?,?,?,?,?,?,'pending',?)`,
        crypto.randomUUID(),
        user.id,
        user.email,
        text(body.name, 150),
        academyId,
        unitId,
        optionalText(body.subjects, 500),
        optionalText(body.message, 1000),
        nowIso(),
      );
    } catch (error) {
      if (error.status) throw error;
      fail('Ya tienes una solicitud en revisión.', 409);
    }
    return json({ ok: true }, 201);
  },

  'GET /api/teacher-requests': async ({ db, user }) => {
    requireAdmin(user);
    const requests = await all(
      db,
      `SELECT r.id, r.email, r.name, r.subjects, r.message, r.status, r.reason, r.created, r.decided_at,
              a.name AS academy, u.name AS unit, d.name AS decided_by
       FROM aula_teacher_requests r
       JOIN aula_academies a ON a.id=r.academy_id JOIN aula_units u ON u.id=r.unit_id
       LEFT JOIN aula_users d ON d.id=r.decided_by
       WHERE r.status='pending' OR r.decided_at > ?
       ORDER BY r.status='pending' DESC, r.created DESC LIMIT 200`,
      new Date(Date.now() - 30 * 86400_000).toISOString(),
    );
    return json({ requests });
  },

  // Aprobar da de alta al docente con su academia y unidad; rechazar guarda el motivo, que la persona ve.
  'POST /api/teacher-requests/decide': async ({ db, user, request }) => {
    requireAdmin(user);
    const body = await readJson(request);
    const row = await one(db, "SELECT * FROM aula_teacher_requests WHERE id=? AND status='pending'", String(body.id ?? ''));
    if (!row) fail('La solicitud ya no está pendiente. Recarga la lista.', 409);
    const now = nowIso();
    if (body.approve !== true) {
      const reason = text(body.reason, 500);
      await run(db, "UPDATE aula_teacher_requests SET status='rejected', reason=?, decided_by=?, decided_at=? WHERE id=?", reason, user.id, now, row.id);
      return json({ ok: true });
    }
    await db.batch([
      db
        .prepare(
          `INSERT INTO aula_teachers (email,name,role,added_by,added_at) VALUES (?,?,'teacher',?,?)
           ON CONFLICT(email) DO UPDATE SET name=excluded.name`,
        )
        .bind(row.email, row.name, user.id, now),
      // El rol se relee en cada solicitud: puede crear cursos de inmediato, sin volver a entrar.
      db
        .prepare("UPDATE aula_users SET role='teacher', name=?, academy_id=?, unit_id=? WHERE id=? AND role='student'")
        .bind(row.name, row.academy_id, row.unit_id, row.user_id),
      db.prepare("UPDATE aula_teacher_requests SET status='approved', decided_by=?, decided_at=? WHERE id=?").bind(user.id, now, row.id),
    ]);
    return json({ ok: true });
  },
};
