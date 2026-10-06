// Pruebas de la 12.32: calificar en bloque (todo el grupo o los alumnos elegidos), sin reemplazar lo ya calificado salvo
// que se pida, con historial y sin pasar del límite de consultas.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'docente@example.test', SESSION_SECRET: 'b'.repeat(40) };
let checks = 0;
const cookies = {};
async function call(user, path, data, status = 200) {
  cookies[user] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user }),
    env,
  );
  const res = await api(
    new Request('https://t.local' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { cookie: cookies[user], Origin: 'https://t.local', 'X-Aula-Request': '1' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${user}) → ${text}`);
  checks++;
  return JSON.parse(text);
}

await call('docente', '/api/me');
const c = (await call('docente', '/api/courses', { name: 'Física I', group: 'A' }, 201)).id;
const otro = (await call('docente', '/api/courses', { name: 'Física II', group: 'B' }, 201)).id;
await call('docente', '/api/members/bulk', {
  course: c,
  students: [
    { name: 'Ana', email: 'ana@example.test' },
    { name: 'Luis', email: 'luis@example.test' },
    { name: 'Eva', email: 'eva@example.test' },
    { name: 'Raúl (sin cuenta)', email: 'raul@example.test' },
  ],
});
await call('docente', '/api/members/bulk', { course: otro, students: [{ name: 'Zoe', email: 'zoe@example.test' }] });
await call('ana', '/api/me');
await call('luis', '/api/me');
const task = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Práctica en clase', visible: true } }, 201);
const course = async () => call('docente', '/api/course?id=' + c);
let data = await course();
const id = (name) => data.members.find((m) => m.name.startsWith(name)).id;
const [ana, luis, eva, raul] = ['Ana', 'Luis', 'Eva', 'Raúl'].map(id);
const zoe = (await call('docente', '/api/course?id=' + otro)).members[0].id;
const gradeOf = (member) => data.records.find((r) => r.kind === 'submission' && r.data.task === task.id && r.data.member === member)?.data;

// Ana entrega; Luis ya tiene calificación con comentario.
await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: task.id, body: 'Mi práctica' } }, 201);
data = await course();
await call('docente', '/api/grade', { course: c, task: task.id, member: luis, grade: 6, feedback: 'Bien', publish: true });

// 12.51: calificación máxima. Luis tiene 6 sobre 10; con máximo 9 sus 6 puntos valen 6.67, y con 12, 5.
data = await course();
const antes = gradeOf(luis).grade;
await call('docente', '/api/task/max', { course: c, id: task.id, max: 0 }, 400);
await call('ana', '/api/task/max', { course: c, id: task.id, max: 9 }, 403);
await call('docente', '/api/task/max', { course: c, id: task.id, max: 9 });
await call('docente', '/api/task/max', { course: c, id: task.id, max: 10 });
data = await course();
assert.equal(gradeOf(luis).grade, antes, 'Ida y vuelta conserva la calificación');
await call('docente', '/api/task/max', { course: c, id: task.id, max: 9 });
data = await course();
assert.equal(data.records.find((r) => r.id === task.id).data.maxScore, 9);
assert.equal(gradeOf(luis).grade, 6.6667, 'El 6 capturado pasa a 6 de 9 = 6.67');
await call('docente', '/api/task/max', { course: c, id: task.id, max: 12 });
data = await course();
assert.equal(Math.round(gradeOf(luis).grade * 100) / 100, 5, '6 de 9 pasa a 6 de 12 = 5');
assert(store.raw().prepare("SELECT count(*) AS n FROM aula_grade_history WHERE reason='calificación máxima'").get().n >= 1);
await call('docente', '/api/task/max', { course: c, id: task.id, max: 10 });
data = await course();
assert.equal(gradeOf(luis).grade, 6);
checks += 6;

// Permisos y validación.
await call('ana', '/api/grades/bulk', { course: c, task: task.id, members: [ana], grade: 10 }, 403);
await call('docente', '/api/grades/bulk', { course: c, task: task.id, members: [ana], grade: 11 }, 400);
await call('docente', '/api/grades/bulk', { course: c, task: task.id, members: [ana], grade: '' }, 400);
await call('docente', '/api/grades/bulk', { course: c, task: task.id, members: [], grade: 8 }, 400);
await call('docente', '/api/grades/bulk', { course: c, task: task.id, members: [ana, zoe], grade: 8 }, 409); // Zoe es de otro curso

// Todo el grupo, sin reemplazar: Luis conserva su 6.
store.counter.queries = 0;
let r = await call('docente', '/api/grades/bulk', { course: c, task: task.id, members: [ana, luis, eva, raul], grade: 9.5, feedback: 'Actividad en clase', publish: false });
assert(store.counter.queries <= 12, `consultas: ${store.counter.queries}`);
assert.deepEqual(r, { graded: 3, skipped: 1 });
data = await course();
assert.deepEqual([gradeOf(ana).grade, gradeOf(ana).body, gradeOf(ana).manual, gradeOf(ana).published, gradeOf(ana).feedback], [9.5, 'Mi práctica', false, false, 'Actividad en clase'], 'La entrega de Ana se conserva');
assert.deepEqual([gradeOf(luis).grade, gradeOf(luis).feedback], [6, 'Bien'], 'Luis no se reemplaza');
assert.deepEqual([gradeOf(eva).grade, gradeOf(eva).manual, gradeOf(raul).grade], [9.5, true, 9.5], 'Eva y Raúl (sin cuenta) quedan como captura manual');
checks += 4;

// Reemplazar a los elegidos, sin comentario: se conserva el de cada uno.
r = await call('docente', '/api/grades/bulk', { course: c, task: task.id, members: [luis, eva], grade: '8,5', replace: true });
assert.deepEqual(r, { graded: 2, skipped: 0 });
data = await course();
assert.deepEqual([gradeOf(luis).grade, gradeOf(luis).feedback, gradeOf(luis).published, gradeOf(eva).grade, gradeOf(eva).feedback], [8.5, 'Bien', true, 8.5, 'Actividad en clase']);
assert.equal(gradeOf(ana).grade, 9.5, 'Ana no estaba elegida');
// Repetir lo mismo no escribe nada.
r = await call('docente', '/api/grades/bulk', { course: c, task: task.id, members: [luis, eva], grade: 8.5, replace: true });
assert.deepEqual(r, { graded: 0, skipped: 2 });
checks += 3;

// Historial: una fila por cambio real, con el motivo.
const history = store.raw().prepare("SELECT member, old_grade, new_grade FROM aula_grade_history WHERE task=? AND reason='calificación en bloque' ORDER BY changed_at, member").all(task.id);
assert.equal(history.length, 5);
assert.deepEqual(history.filter((h) => h.member === luis).map((h) => [h.old_grade, h.new_grade]), [[6, 8.5]]);
checks++;

// El alumno ve la publicada y no el borrador.
const own = (await call('ana', '/api/course?id=' + c)).records.find((x) => x.kind === 'submission' && x.data.task === task.id);
assert.equal(own.data.grade ?? null, null, 'El borrador no llega al alumno');
const luisView = (await call('luis', '/api/course?id=' + c)).records.find((x) => x.kind === 'submission' && x.data.task === task.id);
assert.equal(luisView.data.grade, 8.5);
checks += 2;

// Curso archivado: no se escribe.
await call('docente', '/api/course/archive', { course: c });
await call('docente', '/api/grades/bulk', { course: c, task: task.id, members: [ana], grade: 7, replace: true }, 409);

// ---- Aplicar la configuración de calificaciones a otros grupos ----
const src = (await call('docente', '/api/courses', { name: 'Química', group: '1A' }, 201)).id;
const dst = (await call('docente', '/api/courses', { name: 'Química', group: '1B' }, 201)).id;
const dst2 = (await call('docente', '/api/courses', { name: 'Química', group: '1C' }, 201)).id;
const grading = async (course) => (await call('docente', '/api/course?id=' + course)).records.find((r) => r.kind === 'grading');
const mk = (course, title) => call('docente', '/api/record', { course, kind: 'task', data: { title, visible: true } }, 201);
const srcT1 = await mk(src, 'Tarea 1');
const srcLab = await mk(src, 'Práctica de laboratorio');
const srcQuiz = await call('docente', '/api/record', { course: src, kind: 'quiz', data: { title: 'Examen parcial 1', visible: true, questions: [{ type: 'truefalse', text: 'x', correct: true }] } }, 201);
await call('docente', '/api/grades/scheme', {
  course: src,
  revision: (await grading(src)).revision,
  scheme: 'categories',
  terms: [{ key: 'p1', name: 'Parcial 1', weight: 70 }],
  categories: [
    { key: 'ex', name: 'Exámenes', weight: 60, term: 'p1', source: 'tasks' },
    { key: 'ta', name: 'Tareas', weight: 40, term: 'p1', source: 'tasks', distribution: 'equal', dropLow: 1 },
    { key: 'lab', name: 'Laboratorio', weight: 30, term: '', source: 'tasks' },
  ],
  assignments: [{ task: srcT1.id, category: 'ta', points: 2 }, { task: srcLab.id, category: 'lab', points: 5 }],
  quizzes: [{ quiz: srcQuiz.id, category: 'ex', points: 10, policy: 'last' }],
});
await call('docente', '/api/grades/final-rules', { course: src, revision: (await grading(src)).revision, decimals: 0, rounding: 'down', passing: 7, failingAs: 5, missingAsZero: true });
// El destino ya tenía «Tareas» (se conserva su id) y «Extra» (se quita); tiene «Tarea 1» y el examen con el mismo nombre.
const dstT1 = await mk(dst, 'tarea 1 ');
const dstOther = await mk(dst, 'Otra actividad');
const dstQuiz = await call('docente', '/api/record', { course: dst, kind: 'quiz', data: { title: 'Examen parcial 1', visible: true, questions: [{ type: 'truefalse', text: 'y', correct: false }] } }, 201);
await call('docente', '/api/grades/scheme', {
  course: dst,
  revision: (await grading(dst)).revision,
  scheme: 'categories',
  categories: [{ key: 'a', name: 'tareas', weight: 50, source: 'tasks' }, { key: 'b', name: 'Extra', weight: 50, source: 'tasks' }],
  assignments: [{ task: dstOther.id, category: 'b', points: 1 }],
});
const oldTareas = (await grading(dst)).data.categories.find((c) => c.name === 'tareas').id;

await call('ana', '/api/grades/copy-scheme', { course: src, targets: [dst] }, 403);
await call('docente', '/api/grades/copy-scheme', { course: src, targets: [] }, 400);
await call('docente', '/api/grades/copy-scheme', { course: src, targets: [c] }, 409); // Física I está archivado
store.counter.queries = 0;
const copied = await call('docente', '/api/grades/copy-scheme', { course: src, targets: [dst, dst2] });
assert(store.counter.queries <= 20, `consultas: ${store.counter.queries}`);
assert.deepEqual(copied.courses.map((x) => [x.categories, x.removed, x.tasks, x.quizzes]), [[3, 1, 1, 1], [3, 0, 0, 0]]);
const g = (await grading(dst)).data;
const s0 = (await grading(src)).data;
assert.equal(g.scheme, 'categories');
assert.deepEqual(g.final, s0.final, 'Reglas de la calificación final copiadas');
assert.deepEqual(g.terms.map((t) => [t.name, t.weight]), [['Parcial 1', 70]]);
assert.deepEqual(
  g.categories.map((x) => [x.name, x.weight, x.term === g.terms[0].id ? 'P1' : x.term, x.distribution, x.dropLow]),
  [['Exámenes', 60, 'P1', 'manual', 0], ['Tareas', 40, 'P1', 'equal', 1], ['Laboratorio', 30, '', 'manual', 0]],
);
assert.equal(g.categories.find((x) => x.name === 'Tareas').id, oldTareas, 'La categoría que ya existía conserva su id');
const dstRecords = (await call('docente', '/api/course?id=' + dst)).records;
const t1After = dstRecords.find((r) => r.id === dstT1.id).data;
assert.deepEqual([t1After.category, t1After.points], [oldTareas, 2], 'La actividad con el mismo nombre queda en su categoría y con su valor');
assert.equal(dstRecords.find((r) => r.id === dstOther.id).data.category ?? null, null, 'La de la categoría quitada queda sin categoría');
const qAfter = dstRecords.find((r) => r.id === dstQuiz.id).data.grade;
assert.deepEqual([qAfter.category === g.categories[0].id, qAfter.points, qAfter.policy], [true, 10, 'last']);
assert.equal((await grading(dst2)).data.categories.length, 3, 'También el segundo grupo');
// Aplicar dos veces da lo mismo (no duplica parciales ni categorías).
await call('docente', '/api/grades/copy-scheme', { course: src, targets: [dst] });
const again = (await grading(dst)).data;
assert.deepEqual([again.terms.map((t) => t.id), again.categories.map((x) => x.id)], [g.terms.map((t) => t.id), g.categories.map((x) => x.id)]);
// Un grupo de otro docente: no.
await call('docente', '/api/teachers', { email: 'colega@example.test', name: 'Colega', role: 'teacher' });
const ajeno = (await call('colega', '/api/courses', { name: 'Química', group: '2A' }, 201)).id;
await call('colega', '/api/grades/copy-scheme', { course: ajeno, targets: [dst] }, 403); // no enseña en el destino
await call('colega', '/api/grades/copy-scheme', { course: src, targets: [ajeno] }, 403); // ni en el origen
// Pesos por actividad: el peso viaja con la actividad del mismo nombre.
const pa = (await call('docente', '/api/courses', { name: 'Óptica', group: 'A' }, 201)).id;
const pb = (await call('docente', '/api/courses', { name: 'Óptica', group: 'B' }, 201)).id;
const pa1 = await mk(pa, 'Reporte 1');
const pa2 = await mk(pa, 'Reporte 2');
const pb1 = await mk(pb, 'Reporte 1');
await call('docente', '/api/record', { course: pa, kind: 'weights', data: { weights: { [pa1.id]: 30, [pa2.id]: 70 } } }, 201);
await call('docente', '/api/grades/copy-scheme', { course: pa, targets: [pb] });
const pbWeights = (await call('docente', '/api/course?id=' + pb)).records.find((r) => r.kind === 'weights');
assert.equal(pbWeights.data.weights[pb1.id], 30);
checks += 13;


assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones de la 12.32 — calificar en bloque (grupo o elegidos, sin reemplazar salvo que se pida, comentario opcional, borrador o publicada, historial y curso archivado) y aplicar la configuración de calificaciones a otros grupos (parciales, categorías, reglas y actividades por nombre).`);
