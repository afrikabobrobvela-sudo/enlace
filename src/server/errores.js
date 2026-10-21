// Registro de errores y alerta (12.88). Un error inesperado (del servidor, de una tarea programada o del navegador de
// alguien) se guarda con un número corto que también ve la persona («E-7K2QMA»): con él se encuentra el caso exacto.
// Si en una hora hay más errores de lo normal, la tarea de cada 5 minutos avisa por correo a la cuenta principal y
// /salud lo reporta para que la vigilancia de GitHub también avise. Se guardan 30 días; nunca contraseñas ni entregas.
import { requireAdmin } from './access.js';
import { all, json, nowIso, one, readJson } from './http.js';
import { mailBody, mailConfigured, sendMails } from './mail.js';

const KEEP_DAYS = 30;
/** Errores en una hora que ameritan aviso, por tipo. */
export const ALERT = { api: 10, tarea: 3, cliente: 40 };
const ALERT_EVERY_HOURS = 6; // entre un aviso y el siguiente
const CLIENT_HOURLY_CAP = 300; // en total: un navegador descompuesto no llena la tabla
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const HOUR = 3_600_000;

/** Número de error corto y fácil de dictar (sin 0/O, 1/I/L). */
export function errorId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return 'E-' + [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

const clip = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, max);

/** Guarda un error. Nunca lanza: si la base es la que falla, queda solo en el registro de Cloudflare. */
export async function recordError(db, { id = errorId(), kind, status = 500, route = '', message = '', userId = '', detail = '' }) {
  try {
    const statements = [
      db
        .prepare('INSERT INTO aula_errors (id, at, kind, status, route, message, user_id, detail) VALUES (?,?,?,?,?,?,?,?)')
        .bind(id, nowIso(), kind, status, clip(route, 200), clip(message, 500), clip(userId, 80), clip(detail, 2000)),
    ];
    // De vez en cuando se borran los de más de 30 días (no hace falta una tarea aparte).
    if (Math.random() < 0.05) statements.push(db.prepare('DELETE FROM aula_errors WHERE at < ?').bind(new Date(Date.now() - KEEP_DAYS * 24 * HOUR).toISOString()));
    await db.batch(statements);
  } catch (error) {
    console.error('aula-errores no se pudo guardar', id, error);
  }
  return id;
}

/** Errores por tipo en la última hora y si hay que avisar (lo usan /salud y checkErrorAlert()). */
export async function errorPulse(db, now = Date.now()) {
  const rows = await all(db, 'SELECT kind, count(*) AS n FROM aula_errors WHERE at > ? GROUP BY kind', new Date(now - HOUR).toISOString());
  const counts = Object.fromEntries(rows.map((r) => [r.kind, r.n]));
  const over = Object.keys(ALERT).filter((kind) => (counts[kind] || 0) >= ALERT[kind]);
  return { counts, over };
}

/**
 * Aviso por correo a la cuenta principal (AULA_OWNER_EMAIL) cuando una hora pasa el umbral de errores. Uno cada 6 horas
 * como máximo (la fila `alerta` lo recuerda). Lo corre la tarea programada de cada 5 minutos.
 */
export async function checkErrorAlert(db, env, now = Date.now()) {
  const { counts, over } = await errorPulse(db, now);
  if (!over.length) return { alerted: false, counts };
  const last = await one(db, "SELECT max(at) AS at FROM aula_errors WHERE kind='alerta'");
  if (last?.at && Date.parse(last.at) > now - ALERT_EVERY_HOURS * HOUR) return { alerted: false, counts };
  const top = await all(
    db,
    `SELECT kind, message, route, count(*) AS n, max(id) AS id FROM aula_errors
     WHERE at > ? AND kind IN ('api','tarea','cliente') GROUP BY kind, message, route ORDER BY n DESC LIMIT 8`,
    new Date(now - HOUR).toISOString(),
  );
  const label = { api: 'del servidor', tarea: 'de tareas programadas', cliente: 'en el navegador de los usuarios' };
  const summary = over.map((kind) => `${counts[kind]} errores ${label[kind]}`).join(', ');
  await recordError(db, { kind: 'alerta', status: 0, message: summary });
  let sent = false;
  if (env.AULA_OWNER_EMAIL && mailConfigured(env)) {
    const result = await sendMails(db, env, [
      {
        to: env.AULA_OWNER_EMAIL,
        subject: `Enlace: muchos errores en la última hora (${summary})`,
        ...mailBody({
          title: 'Enlace tuvo más errores de lo normal',
          intro: `En la última hora: ${summary}. Los más frecuentes están abajo; el detalle de cada uno, con su número, está en Enlace → Reportes → Errores.`,
          groups: [{ title: 'Más frecuentes', lines: top.map((r) => `${r.n} × ${r.message || 'sin mensaje'} (${r.route || r.kind}, p. ej. ${r.id})`) }],
          url: env.ENLACE_URL || '',
        }),
      },
    ]);
    sent = result.sent.length > 0;
  }
  return { alerted: true, sent, counts };
}

export const errorRoutes = {
  // El navegador reporta un error de la interfaz (errores.js). Con tope por hora para todo Enlace.
  async 'POST /api/client-error'({ db, user, request }) {
    const body = await readJson(request, 8000);
    const recent = await one(db, "SELECT count(*) AS n FROM aula_errors WHERE kind='cliente' AND at > ?", new Date(Date.now() - HOUR).toISOString());
    if (recent.n >= CLIENT_HOURLY_CAP) return json({ ok: false });
    const id = await recordError(db, {
      kind: 'cliente',
      status: 0,
      route: clip(body.page, 200),
      message: clip(body.message, 500),
      userId: user.id,
      detail: JSON.stringify({ source: clip(body.source, 300), line: Number(body.line) || 0, column: Number(body.column) || 0, stack: clip(body.stack, 1200), version: clip(body.version, 20), agent: clip(request.headers.get('user-agent'), 200) }),
    });
    return json({ ok: true, id });
  },

  // Administración: errores recientes y cuántos por tipo en 24 horas.
  async 'GET /api/errors'({ db, user, url }) {
    requireAdmin(user);
    const days = Math.min(30, Math.max(1, Number(url.searchParams.get('days')) || 7));
    const since = new Date(Date.now() - days * 24 * HOUR).toISOString();
    const [rows, counts] = await Promise.all([
      all(
        db,
        `SELECT e.id, e.at, e.kind, e.status, e.route, e.message, e.detail, coalesce(u.name, '') AS name, coalesce(u.email, '') AS email
         FROM aula_errors e LEFT JOIN aula_users u ON u.id=e.user_id WHERE e.at > ? ORDER BY e.at DESC LIMIT 300`,
        since,
      ),
      all(db, 'SELECT kind, count(*) AS n FROM aula_errors WHERE at > ? GROUP BY kind', new Date(Date.now() - 24 * HOUR).toISOString()),
    ]);
    return json({ errors: rows, last24h: Object.fromEntries(counts.map((r) => [r.kind, r.n])), alert: ALERT });
  },
};
