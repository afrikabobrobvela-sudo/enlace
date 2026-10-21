// Prueba de carga (12.88): 100 alumnos usan Enlace al mismo tiempo, como al empezar una clase con pase de lista,
// entrega y examen, mientras su docente sigue el monitor. Corre el Worker completo (API e interfaz) en esta
// computadora, sin tocar la cuenta de Cloudflare ni la producción, con decenas de cursos de ejemplo para que la base
// tenga un tamaño realista.
//
// Mide por paso: tiempo (mediana, p95, máximo), errores y consultas a D1 por solicitud (el plan gratuito permite 50),
// y al final revisa que cada alumno tenga exactamente su entrega, su asistencia y su examen.
// Falla si hay un error, si algo no cuadra, si una solicitud pasa de 50 consultas o si el p95 de un paso pasa del tope.
//
// Motor: por omisión SQLite en memoria (el motor de D1, con sus límites imitados en scripts/lib/d1-sqlite.mjs): mide
// lo que tarda Enlace mismo, con las consultas una tras otra como en D1. No mide la red: en Cloudflare cada consulta
// suma unos milisegundos, así que la columna de consultas por paso es la que importa para estimar. Con --d1-local se
// usa el motor local de Cloudflare (workerd): mismas consultas, pero su puente con Node tarda unos 13 ms en cada una
// y las atiende de una en una, así que los tiempos salen muy por encima de los reales.
//
// Uso: node scripts/carga.mjs                    → 100 alumnos (npm run carga)
//      node scripts/carga.mjs --usuarios 300     → otro número de alumnos
//      node scripts/carga.mjs --rapido           → 25 alumnos (lo usa npm test)
//      node scripts/carga.mjs --p95 500          → tope del p95 por paso, en milisegundos (1500 por omisión)
//      node scripts/carga.mjs --d1-local         → con el motor local de Cloudflare (sin tope de tiempo)
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, readdirSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import worker from '../src/worker.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { demoCourse } from '../src/server/demo.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const RAPIDO = process.argv.includes('--rapido');
const ALUMNOS = arg('--usuarios', RAPIDO ? 25 : 100);
const D1_LOCAL = process.argv.includes('--d1-local');
const TOPE_P95 = arg('--p95', D1_LOCAL ? Infinity : 1500);
const TOPE_CONSULTAS = 50; // por solicitud, plan gratuito de Cloudflare
const CURSOS_DE_EJEMPLO = RAPIDO ? 10 : 30;
const PREGUNTAS = 10;

// ---- D1 local, contando las consultas de cada solicitud ----------------------------------------------------
const proxy = D1_LOCAL ? await getPlatformProxy({ persist: false }) : null;
const raw = D1_LOCAL ? proxy.env.DB : openD1(':memory:').DB; // openD1 ya aplica las migraciones
const solicitud = new AsyncLocalStorage(); // { consultas } de la solicitud en curso
let reintentos = 0;
// El puente entre Node y el motor local de D1 a veces pierde una solicitud («fetch failed»): se reintenta y se cuenta
// aparte (no es de Enlace ni pasa en Cloudflare).
async function reintenta(fn) {
  for (let vez = 1; ; vez++) {
    try {
      return await fn();
    } catch (error) {
      if (vez >= 4 || !/fetch failed/.test(String(error?.message))) throw error;
      reintentos++;
    }
  }
}
const cuenta = (n = 1) => {
  const s = solicitud.getStore();
  if (s) s.consultas += n;
};
const sentencia = (stmt) => ({
  stmt,
  bind: (...valores) => sentencia(stmt.bind(...valores)),
  first: (...a) => (cuenta(), reintenta(() => stmt.first(...a))),
  all: () => (cuenta(), reintenta(() => stmt.all())),
  run: () => (cuenta(), reintenta(() => stmt.run())),
  raw: (...a) => (cuenta(), reintenta(() => stmt.raw(...a))),
});
const DB = {
  prepare: (sql) => sentencia(raw.prepare(sql)),
  batch: (list) => (cuenta(list.length), reintenta(() => raw.batch(list.map((s) => s.stmt)))),
};

// Migraciones en el motor de Cloudflare, igual que `wrangler d1 migrations apply`.
const dir = new URL('../drizzle/', import.meta.url);
for (const name of D1_LOCAL ? readdirSync(dir).filter((f) => f.endsWith('.sql')).sort() : []) {
  const text = readFileSync(new URL(name, dir), 'utf8').replace(/--> statement-breakpoint/g, '').replace(/^\s*--.*$/gm, '');
  for (const stmt of text.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) await raw.prepare(stmt).run();
}
const env = { DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'c'.repeat(40), MAILER: async () => true, PUSH_FETCH: async () => new Response('', { status: 201 }) };
const pendientes = []; // trabajo después de responder (ctx.waitUntil), se espera al final
const exec = { waitUntil: (p) => pendientes.push(p) };

// ---- Solicitudes, medidas por paso ---------------------------------------------------------------------------
const pasos = new Map(); // paso → { tiempos: [], errores: [], consultas: 0 (máximo) }
const cookies = {};
const errores500 = [];
const consola = console.error;
console.error = (...a) => {
  if (a[0] === 'aula-api' && a[1] === 500) errores500.push(`${a[2]} ${a[3]}: ${a[4]?.stack || a[4]}`);
  if (process.env.VER_ERRORES) consola(...a);
};
async function entra(quien, nombre = quien) {
  const user = await completeLogin(env, { provider: 'google', subject: 'g-' + quien, email: quien + '@example.test', name: nombre });
  cookies[quien] = await sessionCookieForTests(user, env);
  return user;
}
/** Una solicitud como la del navegador (por el Worker completo); con `paso` se mide. */
async function pide(quien, path, { data, paso, ok = [200, 201], headers = {} } = {}) {
  const store = { consultas: 0 };
  const inicio = performance.now();
  const res = await solicitud.run(store, () =>
    worker.fetch(
      new Request('https://t.local' + path, {
        method: data === undefined ? 'GET' : 'POST',
        headers: { cookie: cookies[quien] || '', Origin: 'https://t.local', 'X-Aula-Request': '1', 'CF-Connecting-IP': '148.228.20.10', ...headers },
        body: data === undefined ? undefined : JSON.stringify(data),
      }),
      env,
      exec,
    ),
  );
  const text = res.status === 304 ? '' : await res.text();
  const ms = performance.now() - inicio;
  if (paso) {
    const p = pasos.get(paso) || { tiempos: [], errores: [], consultas: 0 };
    p.tiempos.push(ms);
    p.consultas = Math.max(p.consultas, store.consultas);
    if (!ok.includes(res.status)) p.errores.push(`${quien}: ${res.status} ${text.slice(0, 160)}`);
    pasos.set(paso, p);
  } else if (!ok.includes(res.status)) throw new Error(`${path} (${quien}) → ${res.status} ${text.slice(0, 300)}`);
  return { status: res.status, headers: res.headers, json: () => (text ? JSON.parse(text) : null) };
}
const api = async (quien, path, data, opciones = {}) => (await pide(quien, path, { data, ...opciones })).json();

// ---- Datos: varios docentes y cursos de ejemplo, y la clase de 100 alumnos ------------------------------------
console.log(`Preparando la base (${CURSOS_DE_EJEMPLO} cursos de ejemplo y una clase de ${ALUMNOS} alumnos)…`);
const admin = await entra('admin', 'Administración');
await api('admin', '/api/me');
await api('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const docente = await entra('docente', 'Docente');
function inserta(table, rows) {
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  const lotes = [];
  for (let i = 0; i < rows.length; i += 400)
    lotes.push(raw.prepare(`INSERT INTO ${table} (${cols.join(',')}) SELECT ${cols.map((c) => `json_extract(value,'$.${c}')`).join(',')} FROM json_each(?)`).bind(JSON.stringify(rows.slice(i, i + 400))));
  return lotes;
}
for (let n = 0; n < CURSOS_DE_EJEMPLO; n++) {
  const d = demoCourse(n % 3 === 0 ? docente : admin);
  await raw.batch([
    ...inserta('aula_courses', [d.course]),
    ...inserta('aula_members', d.members),
    ...inserta('aula_records', d.records),
    ...inserta('aula_rubrics', [d.rubric]),
    ...inserta('aula_grade_categories', d.categories),
    ...inserta('aula_grade_settings', [d.settings]),
    ...inserta('aula_tasks', d.tasks),
    ...inserta('aula_submissions', d.submissions),
    ...inserta('aula_attempts', d.attempts),
    ...inserta('aula_sessions', d.sessions),
    ...inserta('aula_attendance', d.attendance),
  ]);
}
const c = (await api('docente', '/api/courses', { name: 'Física I', group: '5AV' }, { ok: [201] })).id;
const alumnos = Array.from({ length: ALUMNOS }, (_, i) => `alumno${String(i + 1).padStart(3, '0')}`);
await api('docente', '/api/members/bulk', { course: c, students: alumnos.map((a, i) => ({ name: 'Alumno ' + (i + 1), email: a + '@example.test' })) });
for (const a of alumnos) await entra(a, a);
const tarea = await api('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Reporte 1', visible: true, due: new Date(Date.now() + 864e5).toISOString() } }, { ok: [201] });
const preguntas = Array.from({ length: PREGUNTAS }, (_, i) => ({ type: 'choice', text: `Pregunta ${i + 1}`, options: ['A', 'B', 'C', 'D'], correct: i % 4 }));
const examen = (await api('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Examen rápido', visible: true, questions: preguntas, settings: { attempts: 1, timeLimit: 30, shuffle: true, exam: { enabled: true, lockOnLeave: true, lockGrace: 10, lockPlatform: true } } } }, { ok: [201] })).id;
const clase = (await api('docente', '/api/attendance/session', { course: c, date: new Date().toISOString().slice(0, 10) }, { ok: [201] })).id;
const salon = { lat: 19.0006, lng: -98.2016, accuracy: 15 };
const registro = await api('docente', '/api/attendance/checkin/open', { course: c, session: clase, mode: 'code', minutes: 15, radius: 150, location: salon });
// La interfaz ya visitada: el navegador pide cada archivo con su ETag (respuesta 304).
const pagina = await pide('alumno001', '/');
const etagApp = (await pide('alumno001', '/app.js')).headers.get('etag');

// ---- 100 alumnos a la vez -----------------------------------------------------------------------------------
console.log(`${ALUMNOS} alumnos a la vez: abrir Enlace, pase de lista con código, entrega, examen y campana…`);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function alumno(a, i) {
  await espera(Math.random() * 1500); // llegan casi juntos, en un segundo y medio
  await pide(a, '/', { paso: '01 Abrir Enlace (index.html)' });
  await pide(a, '/app.js', { paso: '02 Interfaz en caché (304)', ok: [304], headers: { 'If-None-Match': etagApp } });
  await pide(a, '/api/me', { paso: '03 GET /api/me' });
  await pide(a, '/api/courses', { paso: '04 GET /api/courses' });
  await pide(a, '/api/course?id=' + c, { paso: '05 GET /api/course' });
  await pide(a, '/api/attendance/checkin/code', {
    paso: '06 Pase de lista con código',
    data: { code: registro.code, device: `tel-${a}-000001`, location: { lat: salon.lat + (i % 7) * 0.00005, lng: salon.lng, accuracy: 20 } },
  });
  await pide(a, '/api/record', { paso: '07 Entregar actividad', data: { course: c, kind: 'submission', data: { task: tarea.id, body: `Entrega de ${a}.` } } });
  const inicio = await api(a, '/api/attempt/start', { course: c, quiz: examen }, { paso: '08 Empezar examen' });
  const indices = (inicio?.questions || []).map((q) => q.index);
  const answers = {};
  for (let k = 0; k < 3; k++) {
    answers[indices[k] ?? k] = (i + k) % 4;
    await espera(100 + Math.random() * 300);
    await pide(a, '/api/attempt/progress', { paso: '09 Guardar respuesta', data: { course: c, quiz: examen, attempt: 1, answers: { ...answers }, position: k, events: [] } });
  }
  for (const idx of indices) answers[idx] ??= i % 4;
  await pide(a, '/api/attempt', { paso: '10 Enviar examen', data: { course: c, quiz: examen, answers } });
  await pide(a, '/api/notifications', { paso: '11 Campana' });
}
// El docente, mientras tanto: el monitor del examen y la asistencia cada segundo.
let corriendo = true;
async function maestro() {
  while (corriendo) {
    await pide('docente', `/api/exam/monitor?course=${c}&quiz=${examen}`, { paso: '12 Docente: monitor del examen' });
    await pide('docente', `/api/attendance?course=${c}`, { paso: '13 Docente: asistencia' });
    await espera(1000);
  }
}
const inicio = performance.now();
const vigilante = maestro();
await Promise.all(alumnos.map(alumno));
corriendo = false;
await vigilante;
await Promise.all(pendientes);
const segundos = (performance.now() - inicio) / 1000;
// Al final todo debe cuadrar: una entrega, un registro de asistencia y un intento enviado por alumno.
const cuadre = await raw
  .prepare(
    `SELECT (SELECT count(*) FROM aula_submissions WHERE task=?1) AS entregas,
            (SELECT count(*) FROM aula_attendance WHERE session=?2) AS asistencia,
            (SELECT count(*) FROM aula_attempts WHERE quiz=?3 AND details IS NOT NULL) AS intentos`,
  )
  .bind(tarea.id, clase, examen)
  .first();
await proxy?.dispose();

// ---- Informe ---------------------------------------------------------------------------------------------------
const pct = (list, p) => {
  const s = [...list].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : 0;
};
const filas = [...pasos.entries()].sort(([a], [b]) => a.localeCompare(b));
const total = filas.reduce((n, [, p]) => n + p.tiempos.length, 0);
console.log(`\n${total} solicitudes de ${ALUMNOS} alumnos y su docente en ${segundos.toFixed(1)} s (${(total / segundos).toFixed(0)} por segundo).\n`);
console.log('Paso'.padEnd(36) + 'Veces'.padStart(7) + 'Mediana'.padStart(10) + 'p95'.padStart(9) + 'Máximo'.padStart(9) + 'Consultas'.padStart(11) + 'Errores'.padStart(9));
const problemas = [];
for (const [paso, p] of filas) {
  const p95 = pct(p.tiempos, 95);
  console.log(
    paso.slice(3).padEnd(36) +
      String(p.tiempos.length).padStart(7) +
      `${pct(p.tiempos, 50).toFixed(0)} ms`.padStart(10) +
      `${p95.toFixed(0)} ms`.padStart(9) +
      `${Math.max(...p.tiempos).toFixed(0)} ms`.padStart(9) +
      String(p.consultas).padStart(11) +
      String(p.errores.length).padStart(9),
  );
  if (p.errores.length) problemas.push(`${paso.slice(3)}: ${p.errores.length} errores, p. ej. ${p.errores[0]}`);
  if (p.consultas > TOPE_CONSULTAS) problemas.push(`${paso.slice(3)}: ${p.consultas} consultas en una solicitud (máximo ${TOPE_CONSULTAS})`);
  if (p95 > TOPE_P95) problemas.push(`${paso.slice(3)}: p95 de ${p95.toFixed(0)} ms (tope ${TOPE_P95} ms)`);
}
for (const [nombre, valor] of Object.entries({ entregas: cuadre.entregas, asistencia: cuadre.asistencia, intentos: cuadre.intentos }))
  if (valor !== ALUMNOS) problemas.push(`Se esperaban ${ALUMNOS} ${nombre} y hay ${valor}`);
console.log(`\nAl terminar: ${cuadre.entregas} entregas, ${cuadre.asistencia} registros de asistencia y ${cuadre.intentos} exámenes enviados.`);
if (reintentos) console.log(`(${reintentos} reintentos del puente local de D1; no son de Enlace.)`);
if (pagina.status !== 200) problemas.push('La página principal no respondió 200');
if (errores500.length) problemas.push(`Errores 500 del servidor:\n  ${errores500.slice(0, 3).join('\n  ')}`);
if (problemas.length) {
  consola(`\nFALLA la prueba de carga:\n- ${problemas.join('\n- ')}`);
  process.exit(1);
}
console.log(`PASS: prueba de carga con ${ALUMNOS} alumnos a la vez (${D1_LOCAL ? 'motor local de Cloudflare' : 'SQLite en memoria'}) — sin errores, todo cuadra, ≤ ${TOPE_CONSULTAS} consultas por solicitud${Number.isFinite(TOPE_P95) ? ` y p95 ≤ ${TOPE_P95} ms en cada paso` : ''}.`);
process.exit(0);
