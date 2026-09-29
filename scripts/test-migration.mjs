// Migración de la versión 8 a la 9 sin pérdida de datos.
// 1. Con el servidor v8 real (scripts/fixtures/server-v8.js) se crean datos en el esquema anterior.
// 2. Se aplica drizzle/0002_identidad_y_calificaciones.sql.
// 3. Con la API v9 se comprueba que todo llegó igual y que se puede seguir trabajando.
import assert from 'node:assert/strict';
import { api as apiV8 } from './fixtures/server-v8.js';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:', { migrations: 'none' });
store.applyMigrations((name) => name < '0002');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'rodrigo@example.test', SESSION_SECRET: 's'.repeat(40) };
let checks = 0;

// ---- 1. Datos creados por la versión 8 ----
async function v8(user, path, data, status = 200, method = data === undefined ? 'GET' : 'POST') {
  const res = await apiV8(
    new Request('https://aula.test' + path, {
      method,
      headers: {
        'oai-authenticated-user-id': 'chatgpt-' + user,
        'oai-authenticated-user-email': user + '@example.test',
        Origin: 'https://aula.test',
        'X-Aula-Request': '1',
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  const text = await res.text();
  assert.equal(res.status, status, `v8 ${path} → ${text}`);
  return JSON.parse(text);
}

const c = (await v8('rodrigo', '/api/courses', { name: 'Física II', group: '401' }, 201)).id;
for (const [email, name] of [['ana', 'Ana'], ['luis', 'Luis'], ['sofia', 'Sofía']]) {
  await v8('rodrigo', '/api/member', { course: c, email: email + '@example.test', name, matricula: '2026' + name.length });
}
await v8('ana', '/api/me');
await v8('luis', '/api/me'); // Sofía nunca entró en la versión 8
const rec = (kind, data, old) => ({ course: c, kind, data, id: old?.id, revision: old?.revision });
const t1 = await v8('rodrigo', '/api/record', rec('task', { title: 'Práctica 1', body: 'Péndulo simple', due: '2030-01-01T00:00:00Z' }), 201);
const t2 = await v8(
  'rodrigo',
  '/api/record',
  rec('task', { title: 'Reporte', submissionMode: 'text', maxFiles: 2, extensions: 'pdf, docx', allowResubmit: false }),
  201,
);
const t3 = await v8('rodrigo', '/api/record', rec('task', { title: 'Oculta', visible: false }), 201);
const anaSub = await v8('ana', '/api/record', rec('submission', { task: t1.id, body: 'T = 2π√(L/g)' }), 201);
const luisSub = await v8('luis', '/api/record', rec('submission', { task: t2.id, body: 'Mi reporte' }), 201);
let roster = (await v8('rodrigo', '/api/course?id=' + c)).members;
const member = (email) => roster.find((m) => m.email === email + '@example.test');
await v8('rodrigo', '/api/grade', { course: c, task: t1.id, member: member('ana').id, revision: anaSub.revision, grade: 9.5, feedback: 'Excelente' });
await v8('rodrigo', '/api/grade', { course: c, task: t2.id, member: member('luis').id, revision: luisSub.revision, grade: 6, feedback: '' });
await v8('rodrigo', '/api/grade', { course: c, task: t1.id, member: member('sofia').id, grade: 8, feedback: 'Examen escrito' }); // manual, sin cuenta
const weights = await v8('rodrigo', '/api/record', rec('weights', { weights: { [t1.id]: 50, [t2.id]: 30, [t3.id]: 20 } }), 201);
await v8('rodrigo', '/api/record', rec('weights', { weights: { [t1.id]: 60, [t2.id]: 30, [t3.id]: 10 } }, weights));
const quiz = await v8(
  'rodrigo',
  '/api/record',
  rec('quiz', { title: 'Cinemática', questions: [{ text: 'v = ?', options: ['d/t', 't/d'], correct: 0 }, { text: 'a = ?', options: ['Δv/t', 'v·t'], correct: 0 }] }),
  201,
);
await v8('ana', '/api/attempt', { course: c, quiz: quiz.id, answers: [0, 1] }, 201);
await v8('rodrigo', '/api/record', rec('notice', { title: 'Bienvenida', body: 'Inicio de semestre' }), 201);

const before = await v8('rodrigo', '/api/course?id=' + c);
const legacyRows = store.raw().prepare('SELECT count(*) AS n FROM aula_records').get().n;
const pick = (records, kind) =>
  records
    .filter((r) => r.kind === kind)
    .map(({ id, revision, data }) => ({ id, revision, data }))
    .sort((a, b) => a.id.localeCompare(b.id));

// ---- 2. Migración ----
store.applyMigrations((name) => name.startsWith('0002'));
store.applyMigrations((name) => name >= '0003'); // migraciones posteriores (asistencia, borradores)
assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), [], 'Sin llaves foráneas rotas');
assert.equal(store.raw().prepare('SELECT count(*) AS n FROM aula_records').get().n, legacyRows, 'Los registros originales se conservan');
// La misma consulta de verificación que recomienda LEEME.md.
const verification = store.raw().prepare(`SELECT r.kind,
       count(*) AS originales,
       CASE r.kind WHEN 'task' THEN (SELECT count(*) FROM aula_tasks)
                   WHEN 'submission' THEN (SELECT count(*) FROM aula_submissions)
                   WHEN 'attempt' THEN (SELECT count(*) FROM aula_attempts) END AS migrados
FROM aula_records r WHERE r.kind IN ('task', 'submission', 'attempt') GROUP BY r.kind;`).all();
assert.equal(verification.length, 3);
for (const row of verification) assert.equal(row.migrados, row.originales, `Faltan filas de ${row.kind}`);
checks += 3;

// ---- 3. Verificación con la versión 9 ----
const sessions = {};
async function v9(user, path, data, status = 200, method = data === undefined ? 'GET' : 'POST') {
  sessions[user] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user }),
    env,
  );
  const res = await api(
    new Request('https://aula.test' + path, {
      method,
      headers: { cookie: sessions[user], Origin: 'https://aula.test', 'X-Aula-Request': '1' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  const text = await res.text();
  assert.equal(res.status, status, `v9 ${path} → ${text}`);
  checks++;
  return JSON.parse(text);
}

assert.equal((await v9('rodrigo', '/api/me')).id, 'chatgpt-rodrigo', 'La cuenta de la versión 8 se conserva al entrar con Google');
const after = await v9('rodrigo', '/api/course?id=' + c);

// Actividades: mismos ids, revisiones y campos.
const legacyTasks = pick(before.records, 'task').map((t) => ({
  ...t,
  data: {
    visible: true, fileIds: [], submissionMode: 'both', maxFiles: 5, extensions: [], allowResubmit: true, due: '', start: '', end: '',
    ...t.data,
    // Fase 2B: sin categoría, valor 1, sin rúbrica y entrega individual.
    category: null, points: 1, rubric: null, groupCategory: '',
    // 12.18: para todas las secciones.
    sections: [],
    specialOnly: false,
  },
}));
assert.deepEqual(pick(after.records, 'task'), legacyTasks);
const grading = after.records.find((r) => r.kind === 'grading');
assert.equal(grading.data.scheme, 'tasks', 'Los cursos existentes siguen calculando con pesos por actividad');
assert.deepEqual(grading.data.categories, []);
// Entregas y calificaciones: la v9 agrega `manual` y `gradedAt` explícitos; lo demás es idéntico.
const normalize = (s) => ({
  ...s,
  data: { body: '', fileIds: [], submitted: '', late: false, ...s.data, manual: s.data.manual === true, gradedAt: undefined, published: undefined, rubricScores: undefined },
});
assert(pick(after.records, 'submission').every((s) => s.data.published === true), 'Las calificaciones existentes quedan publicadas');
assert.deepEqual(pick(after.records, 'submission').map(normalize), pick(before.records, 'submission').map(normalize));
assert.equal(pick(after.records, 'submission').length, 3);
// Ponderaciones y evaluaciones.
const w = after.records.find((r) => r.kind === 'weights');
assert.deepEqual(w.data, before.records.find((r) => r.kind === 'weights').data);
assert.equal(w.revision, 2);
// Los intentos llegan idénticos; la versión 12.6 solo agrega su número (1) y el detalle (vacío en los migrados).
const withoutNewFields = (list) => list.map((r) => ({ ...r, data: Object.fromEntries(Object.entries(r.data).filter(([k]) => !['attempt', 'details', 'integrity'].includes(k))) }));
assert.deepEqual(withoutNewFields(pick(after.records, 'attempt')), pick(before.records, 'attempt'));
assert(pick(after.records, 'attempt').every((r) => r.data.attempt === 1 && r.data.details === null && r.data.integrity === null));
assert.deepEqual(pick(after.records, 'notice'), pick(before.records, 'notice'));
checks += 6;

// Sofía nunca entró en v8: al entrar por primera vez con Google ve su calificación manual.
const sofia = await v9('sofia', '/api/course?id=' + c);
assert.equal(sofia.records.find((r) => r.kind === 'submission').data.grade, 8);
assert(!sofia.records.some((r) => r.id === t3.id), 'La actividad oculta sigue oculta');
const ana = await v9('ana', '/api/course?id=' + c);
assert.deepEqual(
  ana.records.filter((r) => ['submission', 'attempt'].includes(r.kind)).map((r) => r.kind).sort(),
  ['attempt', 'submission'],
  'Cada alumno solo ve lo suyo',
);
checks += 3;

// Se puede seguir trabajando sobre los datos migrados.
const anaGraded = after.records.find((r) => r.id === anaSub.id);
await v9('rodrigo', '/api/grade', { course: c, task: t1.id, member: member('ana').id, revision: anaGraded.revision - 1, grade: 7 }, 409);
const regraded = await v9('rodrigo', '/api/grade', { course: c, task: t1.id, member: member('ana').id, revision: anaGraded.revision, grade: 10, feedback: 'Corregido' });
assert.equal(regraded.revision, anaGraded.revision + 1);
await v9('luis', '/api/record', rec('submission', { task: t2.id, body: 'Otra vez' }, pick(after.records, 'submission').find((s) => s.id === luisSub.id)), 403); // entrega única
await v9('rodrigo', '/api/record', rec('weights', { weights: { [t1.id]: 50, [t2.id]: 50, [t3.id]: 0 } }, w));
await v9('ana', '/api/attempt', { course: c, quiz: quiz.id, answers: [0, 0] }, 409); // un solo intento, también tras migrar
await v9('rodrigo', '/api/record', rec('quiz', { ...before.records.find((r) => r.id === quiz.id).data, title: 'Cinemática (repaso)' }, quiz));
await v9(
  'rodrigo',
  '/api/record',
  rec('quiz', { title: 'Cinemática', questions: [{ text: 'v = ?', options: ['d/t', 'x'], correct: 0 }] }, { id: quiz.id, revision: 2 }),
  400,
); // con intentos no se cambian las preguntas

store.close();
console.log(`PASS: ${checks} verificaciones de migración — datos creados con el servidor v8 llegan idénticos a la v9 (actividades, entregas, calificaciones manuales, ponderaciones, intentos) y los originales se conservan.`);
