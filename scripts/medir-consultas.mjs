// Medición de lecturas de D1 (12.30). Corre la API real de Enlace sobre el motor local de D1 de Cloudflare (workerd,
// con getPlatformProxy de wrangler y sin guardar nada: no toca tu cuenta) con decenas de cursos de ejemplo y simula
//   1. un examen de 30 alumnos (guardado por respuesta, salidas y regresos, recargas a media prueba, la campana cada
//      5 minutos y el monitor del docente cada 10 s durante una hora), y
//   2. un día normal de esos 30 alumnos y su docente (abrir el curso, la campana, pendientes y calendario).
// Cuenta `rows_read`, lo mismo que suma el panel de D1 («Rows read») contra el límite gratuito de 5 millones al día.
//
// Uso: node scripts/medir-consultas.mjs            → informe por ruta y las consultas que más leen (npm run medir)
//      node scripts/medir-consultas.mjs --planes   → además, cómo resuelve D1 las consultas más caras
//      node scripts/medir-consultas.mjs --limite --rapido → 10 alumnos y topes por alumno (lo usa npm test)
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { demoCourse } from '../src/server/demo.js';
import { runDigest } from '../src/server/digest.js';
import { memoryBucket } from './lib/d1-sqlite.mjs';

const LIMITE = process.argv.includes('--limite');
const RAPIDO = process.argv.includes('--rapido');
const ALUMNOS = RAPIDO ? 10 : 30;
const CURSOS_DE_EJEMPLO = RAPIDO ? 20 : 45; // volumen de una base con varios docentes y semestres (más que la de producción)
const PREGUNTAS = RAPIDO ? 10 : 25;
const MINUTOS = RAPIDO ? 20 : 60;
// Topes de la prueba, por alumno: con margen sobre lo medido (12.30: unas 3,200 filas por alumno en el examen con el
// monitor y 3,000 en un día normal con el resumen por correo) y muy por debajo de los 5 millones diarios. Antes de la
// 12.30 un examen de 30 alumnos leía más de 500,000 filas y un día normal 1.2 millones.
const TOPE_EXAMEN = 8_000 * ALUMNOS;
const TOPE_DIA = 6_000 * ALUMNOS;
const TOPE_POR_LLAMADA = 2_500; // ninguna solicitud de un alumno debe leer más que esto

// ---- D1 local con medición ---------------------------------------------------------------------------
const proxy = await getPlatformProxy({ persist: false });
const raw = proxy.env.DB;
const medidas = { etiqueta: 'semilla', rutas: new Map(), sql: new Map() };
function anota(sql, meta, filas, args = []) {
  if (medidas.etiqueta === 'semilla') return;
  const leidas = meta?.rows_read ?? 0;
  const clave = sql.replace(/\s+/g, ' ').trim();
  const s = medidas.sql.get(clave) || { veces: 0, leidas: 0, devueltas: 0, rutas: new Set() };
  s.veces++;
  s.leidas += leidas;
  s.devueltas += filas;
  s.rutas.add(medidas.ruta);
  s.sql = sql;
  s.args = args;
  medidas.sql.set(clave, s);
  medidas.lectura += leidas;
  medidas.consultas++;
}
// El puente entre Node y el motor local de D1 a veces pierde una solicitud («fetch failed»): se reintenta (no es de Enlace).
async function reintenta(fn) {
  for (let vez = 1; ; vez++) {
    try {
      return await fn();
    } catch (error) {
      if (vez >= 4 || !/fetch failed/.test(String(error?.message))) throw error;
    }
  }
}
const sentencia = (sql, stmt, args = []) => ({
  sql,
  stmt,
  args,
  bind: (...valores) => sentencia(sql, stmt.bind(...valores), valores),
  // first() de D1 no trae `meta`: se pide como all() para saber cuántas filas leyó.
  async first() {
    const r = await reintenta(() => stmt.all());
    anota(sql, r.meta, r.results.length, args);
    return r.results[0] ?? null;
  },
  async all() {
    const r = await reintenta(() => stmt.all());
    anota(sql, r.meta, r.results.length, args);
    return r;
  },
  async run() {
    const r = await reintenta(() => stmt.run());
    anota(sql, r.meta, 0, args);
    return r;
  },
});
const DB = {
  prepare: (sql) => sentencia(sql, raw.prepare(sql)),
  async batch(list) {
    const rs = await reintenta(() => raw.batch(list.map((s) => s.stmt)));
    rs.forEach((r, i) => anota(list[i].sql, r.meta, r.results?.length ?? 0, list[i].args));
    return rs;
  },
};

// Migraciones, igual que `wrangler d1 migrations apply`.
const dir = new URL('../drizzle/', import.meta.url);
for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  const text = readFileSync(new URL(name, dir), 'utf8').replace(/--> statement-breakpoint/g, '').replace(/^\s*--.*$/gm, '');
  for (const stmt of text.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) await raw.prepare(stmt).run();
}

const env = { DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'm'.repeat(40), MAILER: async () => true };
const cookies = {};
const usuarios = {};
async function entra(quien, nombre = quien) {
  usuarios[quien] = await completeLogin(env, { provider: 'google', subject: 'g-' + quien, email: quien + '@example.test', name: nombre });
  cookies[quien] = await sessionCookieForTests(usuarios[quien], env);
  return usuarios[quien];
}
/** Una solicitud como la del navegador; se anota en la ruta que corresponde. */
async function call(quien, path, data, { ok = [200, 201], method } = {}) {
  const metodo = method ?? (data === undefined ? 'GET' : 'POST');
  const ruta = `${metodo} ${path.split('?')[0]}`;
  const antes = medidas.lectura;
  medidas.ruta = ruta;
  const res = await api(
    new Request('https://t.local' + path, {
      method: metodo,
      headers: { cookie: cookies[quien], Origin: 'https://t.local', 'X-Aula-Request': '1', 'CF-Connecting-IP': '148.228.20.10' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  const text = await res.text();
  if (!ok.includes(res.status)) throw new Error(`${ruta} (${quien}) → ${res.status} ${text.slice(0, 300)}${res.status === 500 ? '\n' + errores500.at(-1) : ''}`);
  if (medidas.etiqueta !== 'semilla') {
    const r = medidas.rutas.get(medidas.etiqueta + '|' + ruta) || { veces: 0, leidas: 0, maximo: 0 };
    const leidas = medidas.lectura - antes;
    r.veces++;
    r.leidas += leidas;
    r.maximo = Math.max(r.maximo, leidas);
    medidas.rutas.set(medidas.etiqueta + '|' + ruta, r);
  }
  return text ? JSON.parse(text) : null;
}
medidas.lectura = 0;
medidas.consultas = 0;

// ---- Datos: docentes con varios cursos, 30 alumnos reales y un curso con examen ------------------------------
const silencio = console.error;
const errores500 = [];
console.error = (...a) => {
  if (a[1] === 500) errores500.push(String(a[2]?.stack || a[2]));
  if (process.env.VER_ERRORES) silencio(...a);
}; // los 4xx esperados se anotan en la consola del servidor; aquí estorban
await entra('admin', 'Administración');
await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
await entra('docente', 'Docente');
const alumnos = Array.from({ length: ALUMNOS }, (_, i) => `alumno${String(i + 1).padStart(2, '0')}`);

// Cursos de ejemplo de 9 docentes (5 cada uno); los tres primeros del docente también tienen a los 30 alumnos reales.
function inserta(table, rows) {
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  const lotes = [];
  for (let i = 0; i < rows.length; i += 400)
    lotes.push(raw.prepare(`INSERT INTO ${table} (${cols.join(',')}) SELECT ${cols.map((c) => `json_extract(value,'$.${c}')`).join(',')} FROM json_each(?)`).bind(JSON.stringify(rows.slice(i, i + 400))));
  return lotes;
}
const docentes = [usuarios.docente];
for (let k = 1; k < 9; k++) docentes.push(await entra('prof' + k, 'Profesor ' + k));
const propios = [];
for (let n = 0; n < CURSOS_DE_EJEMPLO; n++) {
  const d = demoCourse(docentes[n % docentes.length]);
  if (n % docentes.length === 0) propios.push(d.course.id);
  // En 4 cursos de otros docentes también están los alumnos reales (cada alumno lleva varias materias).
  if ([1, 2, 3, 4].includes(n))
    d.members.slice(0, ALUMNOS).forEach((m, i) => {
      const quien = alumnos[(i + n * 7) % ALUMNOS];
      m.email = quien + '@example.test';
    });
  await raw.batch(
    [
      ...inserta('aula_courses', [d.course]),
      ...inserta('aula_members', d.members),
      ...inserta('aula_records', d.records),
      ...inserta('aula_rubrics', [d.rubric]),
      ...inserta('aula_grade_categories', d.categories),
      ...inserta('aula_grade_settings', [d.settings]),
      ...inserta('aula_tasks', d.tasks),
      ...inserta('aula_submissions', d.submissions),
      ...inserta('aula_grade_history', d.history),
      ...inserta('aula_attempts', d.attempts),
      ...inserta('aula_sessions', d.sessions),
      ...inserta('aula_attendance', d.attendance),
      ...inserta('aula_attendance_settings', [d.attendanceSettings]),
      ...inserta('aula_progress', d.progress),
    ],
  );
}
// El curso del examen: copia de uno de ejemplo (unidades, materiales, actividades, foros) con los 30 alumnos.
const c = (await call('docente', '/api/course/copy', { course: propios[0], name: 'Física I', group: '5AV', period: '2026B' }, { ok: [201] })).id;
await call('docente', '/api/members/bulk', { course: c, students: alumnos.map((a, i) => ({ name: 'Alumno ' + (i + 1), email: a + '@example.test', matricula: '2026' + String(i).padStart(5, '0') })) });
for (const a of alumnos) await entra(a, a);
// En los cursos de ejemplo, los alumnos reales quedan ligados a su inscripción por correo.
await raw.prepare("UPDATE aula_members SET user_id=(SELECT id FROM aula_users u WHERE u.email=aula_members.email) WHERE email LIKE 'alumno%@example.test'").run();
let curso = await call('docente', '/api/course?id=' + c);
const miembros = curso.members.filter((m) => m.role === 'student');
const tareas = curso.records.filter((r) => r.kind === 'task' && !r.data.forum);
await call('docente', '/api/grades/import', {
  course: c,
  activities: tareas.map((t, k) => ({ task: t.id, grades: miembros.map((m, i) => ({ member: m.id, grade: (i + k) % 11 })) })),
});
const preguntas = Array.from({ length: PREGUNTAS }, (_, i) => ({ type: 'choice', text: `Pregunta ${i + 1}`, options: ['A', 'B', 'C', 'D'], correct: i % 4 }));
const examen = (
  await call('docente', '/api/record', {
    course: c,
    kind: 'quiz',
    data: { title: 'Primer parcial', visible: true, questions: preguntas, settings: { attempts: 1, timeLimit: MINUTOS, shuffle: true, exam: { enabled: true, lockOnLeave: true, lockGrace: 5, lockPlatform: true } } },
  }, { ok: [201] })
).id;

const tamaño = await raw.prepare(`SELECT (SELECT count(*) FROM aula_courses) AS cursos, (SELECT count(*) FROM aula_members) AS inscripciones,
  (SELECT count(*) FROM aula_submissions) AS entregas, (SELECT count(*) FROM aula_attempts) AS intentos,
  (SELECT count(*) FROM aula_records) AS registros, (SELECT count(*) FROM aula_attendance) AS asistencia`).first();

// ---- 1. Examen de 30 alumnos -------------------------------------------------------------------------------
medidas.etiqueta = 'examen';
const inicioExamen = medidas.lectura;
const ctx = { course: c, quiz: examen, attempt: 1 };
const cargaPagina = async (a) => {
  await call(a, '/api/me');
  await call(a, '/api/courses', undefined, { ok: [200, 423] });
  await call(a, '/api/notifications', undefined, { ok: [200, 423] });
  await call(a, '/api/course?id=' + c);
};
for (const a of alumnos) await cargaPagina(a);
for (const a of alumnos) await call(a, '/api/attempt/start', { course: c, quiz: examen });
// El monitor del docente cada 10 s y la campana de cada alumno cada 5 minutos durante la hora del examen.
const vueltas = PREGUNTAS;
for (let v = 0; v < vueltas; v++) {
  for (const [i, a] of alumnos.entries()) {
    const answers = Object.fromEntries(Array.from({ length: v + 1 }, (_, k) => [k, (k + i) % 4]));
    await call(a, '/api/attempt/progress', { ...ctx, answers, position: v, events: [] });
    // Cada alumno sale y regresa tres veces (una notificación, cambiar de app un momento).
    if (v % 8 === 4) {
      await call(a, '/api/attempt/away', ctx);
      await call(a, '/api/attempt/back', { ...ctx, seconds: 2 });
      await call(a, '/api/attempt/progress', { ...ctx, answers, position: v, events: [{ kind: 'left', seconds: 2 }] });
    }
    // Dos recargas de la página a media prueba (se vuelve a pedir todo y se retoma el intento).
    if (v === 9 || v === 18) {
      await cargaPagina(a);
      await call(a, '/api/attempt/start', { course: c, quiz: examen });
    }
  }
  const monitorPorVuelta = Math.round((MINUTOS * 6) / vueltas);
  for (let k = 0; k < monitorPorVuelta; k++) await call('docente', `/api/exam/monitor?course=${c}&quiz=${examen}`);
  if (v % 2 === 0) for (const a of alumnos) await call(a, '/api/notifications', undefined, { ok: [200, 423] });
}
for (const [i, a] of alumnos.entries()) {
  const answers = Object.fromEntries(Array.from({ length: PREGUNTAS }, (_, k) => [k, (k + i) % 4]));
  await call(a, '/api/attempt', { course: c, quiz: examen, answers });
  await call(a, '/api/course?id=' + c);
}
await call('docente', '/api/course?id=' + c);
const lecturaExamen = medidas.lectura - inicioExamen;

// ---- 2. Un día normal --------------------------------------------------------------------------------------
medidas.etiqueta = 'día';
const inicioDia = medidas.lectura;
const hoy = new Date();
const desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString();
const hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1).toISOString();
for (let vez = 0; vez < 3; vez++) {
  for (const a of alumnos) {
    await call(a, '/api/me');
    await call(a, '/api/courses');
    await call(a, '/api/notifications');
    await call(a, '/api/dashboard');
    await call(a, '/api/course?id=' + c);
  }
}
for (const a of alumnos) await call(a, `/api/calendar?from=${desde}&to=${hasta}`);
for (let vez = 0; vez < 5; vez++) {
  await call('docente', '/api/me');
  await call('docente', '/api/courses');
  await call('docente', '/api/notifications');
  await call('docente', '/api/dashboard');
  await call('docente', '/api/course?id=' + c);
}
await call('docente', `/api/calendar?from=${desde}&to=${hasta}`);
// El resumen diario por correo (cron de las 7 p. m.), una vez para todas las personas.
medidas.ruta = 'cron runDigest';
const antesResumen = medidas.lectura;
await runDigest(DB, env, new Date());
medidas.rutas.set('día|cron runDigest', { veces: 1, leidas: medidas.lectura - antesResumen, maximo: medidas.lectura - antesResumen });
const lecturaDia = medidas.lectura - inicioDia;
console.error = silencio;

// ---- Informe -----------------------------------------------------------------------------------------------
const f = (n) => Math.round(n).toLocaleString('es-MX');
console.log(`Base simulada: ${f(tamaño.cursos)} cursos, ${f(tamaño.inscripciones)} inscripciones, ${f(tamaño.entregas)} entregas, ${f(tamaño.intentos)} intentos, ${f(tamaño.registros)} registros, ${f(tamaño.asistencia)} registros de asistencia.\n`);
for (const etiqueta of ['examen', 'día']) {
  console.log(etiqueta === 'examen' ? `EXAMEN de ${ALUMNOS} alumnos, ${PREGUNTAS} preguntas, ${MINUTOS} min:` : `DÍA NORMAL de ${ALUMNOS} alumnos y su docente:`);
  const filas = [...medidas.rutas].filter(([k]) => k.startsWith(etiqueta + '|')).map(([k, r]) => [k.split('|')[1], r]).sort((a, b) => b[1].leidas - a[1].leidas);
  for (const [ruta, r] of filas) console.log(`  ${ruta.padEnd(30)} ${String(r.veces).padStart(5)} llamadas  ${f(r.leidas).padStart(11)} filas  (${f(r.leidas / r.veces)} por llamada, máx. ${f(r.maximo)})`);
}
console.log(`\nTotal del examen: ${f(lecturaExamen)} filas leídas. Día normal: ${f(lecturaDia)}. Límite gratuito: 5,000,000 al día.`);
console.log('\nConsultas que más leen:');
const caras = [...medidas.sql].sort((a, b) => b[1].leidas - a[1].leidas).slice(0, 12);
for (const [sql, s] of caras)
  console.log(`  ${f(s.leidas).padStart(10)} filas · ${String(s.veces).padStart(5)} veces · ${f(s.leidas / Math.max(1, s.devueltas))} leídas por devuelta · ${[...s.rutas].join(', ')}\n      ${sql.slice(0, 170)}`);

// --planes: cómo resuelve D1 las consultas más caras (SCAN = recorre toda la tabla; SEARCH = usa un índice).
if (process.argv.includes('--planes'))
  for (const [, s] of caras.slice(0, 8)) {
    const plan = await raw.prepare('EXPLAIN QUERY PLAN ' + s.sql).bind(...s.args).all();
    console.log(`\nPLAN ${s.sql.replace(/\s+/g, ' ').slice(0, 90)}…\n${plan.results.map((p) => '   ' + p.detail).join('\n')}`);
  }
await proxy.dispose();

if (LIMITE) {
  assert(lecturaExamen <= TOPE_EXAMEN, `El examen leyó ${f(lecturaExamen)} filas (tope ${f(TOPE_EXAMEN)})`);
  assert(lecturaDia <= TOPE_DIA, `El día normal leyó ${f(lecturaDia)} filas (tope ${f(TOPE_DIA)})`);
  // Por llamada: cualquier solicitud (también el libro completo del docente y su monitor); el resumen diario es uno
  // solo para toda la plataforma y se mide en el total del día.
  for (const [k, r] of medidas.rutas) if (!k.includes('cron')) assert(r.maximo <= TOPE_POR_LLAMADA, `${k}: una llamada leyó ${f(r.maximo)} filas`);
  console.log(`\nPASS: lecturas de D1 dentro de los topes — examen de ${ALUMNOS} alumnos ${f(lecturaExamen)} filas, día normal ${f(lecturaDia)}.`);
}
