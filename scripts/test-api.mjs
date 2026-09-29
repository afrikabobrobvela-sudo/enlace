// Pruebas de la API con una base SQLite temporal (mismas reglas de D1, llaves foráneas activas).
// Incluye todas las verificaciones de la versión 8, ahora con sesiones firmadas en lugar de cabeceras.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const dir = mkdtempSync(tmpdir() + '/aula-test-');
const store = openD1(dir + '/test.sqlite');
const env = {
  DB: store.DB,
  BUCKET: memoryBucket(),
  AULA_OWNER_EMAIL: 'owner@example.test',
  SESSION_SECRET: 'x'.repeat(48),
  GOOGLE_CLIENT_ID: 'cliente.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secreto',
};
let checks = 0;
const sessions = new Map();

/** Inicia sesión como lo haría Google y devuelve la cookie de sesión. */
async function session(name) {
  if (!sessions.has(name)) {
    const user = await completeLogin(env, { provider: 'google', subject: 'sub-' + name, email: name + '@example.test', name });
    sessions.set(name, await sessionCookieForTests(user, env));
  }
  return sessions.get(name);
}

async function raw(name, path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (name) headers.set('cookie', await session(name));
  return api(new Request('https://test.local' + path, { ...init, headers }), env);
}

async function call(name, path, data, status = 200, method = data === undefined ? 'GET' : 'POST', extra = {}) {
  const res = await raw(name, path, {
    method,
    headers: { Origin: 'https://test.local', 'X-Aula-Request': '1', ...extra },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await res.text();
  assert.equal(res.status, status, `${method} ${path} → ${body}`);
  checks++;
  return JSON.parse(body);
}

try {
  // ---- Identidad: nada de cabeceras de terceros, solo la cookie firmada ----
  await session('owner'); // el usuario debe existir, si no la prueba de cabeceras falsas pasaría por casualidad
  const anonymous = await api(new Request('https://test.local/api/me'), env);
  assert.equal(anonymous.status, 401);
  assert.deepEqual((await anonymous.json()).login, { google: true, microsoft: false, email: false }, '401 indica los métodos de acceso');
  checks++;
  const forged = await api(
    new Request('https://test.local/api/me', {
      headers: { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.test' },
    }),
    env,
  );
  assert.equal(forged.status, 401, 'Las cabeceras de ChatGPT Sites ya no otorgan identidad');
  checks++;
  const cookieValue = (await session('owner')).split('=')[1];
  const tampered = await api(
    new Request('https://test.local/api/me', { headers: { cookie: '__Host-enlace_session=' + cookieValue.slice(0, -2) + 'xx' } }),
    env,
  );
  assert.equal(tampered.status, 401, 'Una firma alterada se rechaza');
  checks++;

  // ---- Flujo de la versión 8 ----
  assert.equal((await call('owner', '/api/me')).role, 'admin');
  const c = (await call('owner', '/api/courses', { name: 'Curso real', group: 'A' }, 201)).id;
  await call('student', '/api/courses', { name: 'No', group: 'B' }, 403);
  await call('owner', '/api/member', { course: c, email: 'student@example.test', name: 'Alumno' });
  await call('student', '/api/me');
  assert.equal((await call('student', '/api/courses')).length, 1);
  await call('stranger', '/api/course?id=' + c, undefined, 403);
  const rec = (kind, data, old) => ({ course: c, kind, data, id: old?.id, revision: old?.revision });
  const task = await call('owner', '/api/record', rec('task', { title: 'Trabajo', body: 'Entrega', visible: true }), 201);
  await call('student', '/api/record', rec('task', { title: 'No' }), 403);
  const sub = await call('student', '/api/record', rec('submission', { task: task.id, body: 'Respuesta' }), 201);
  const data = await call('owner', '/api/course?id=' + c);
  const member = data.members[0];
  const graded = await call('owner', '/api/grade', {
    course: c,
    task: task.id,
    member: member.id,
    revision: sub.revision,
    grade: 9,
    feedback: 'Bien',
  });
  assert.equal((await call('student', '/api/course?id=' + c)).records.find((x) => x.id === sub.id).data.grade, 9);
  await call('owner', '/api/grade', { course: c, task: task.id, member: member.id, revision: sub.revision, grade: 8 }, 409);
  await call('owner', '/api/member', { course: c, email: 'other@example.test', name: 'Otro' });
  const other = await call('other', '/api/course?id=' + c);
  assert(!other.records.some((x) => x.kind === 'submission'));
  await call('other', '/api/record', rec('submission', { task: task.id, body: 'Hack' }, graded), 403);
  const quiz = await call(
    'owner',
    '/api/record',
    rec('quiz', { title: 'Quiz', questions: [{ text: '2+2', options: ['3', '4', '5'], correct: 1 }] }),
    201,
  );
  // Antes de contestar, el alumno no recibe las preguntas (ni la respuesta correcta): solo cuántas son.
  const antes = (await call('student', '/api/course?id=' + c)).records.find((x) => x.id === quiz.id).data;
  assert.deepEqual([antes.questions, antes.questionCount], [[null], 1]);
  const attempt = await call('student', '/api/attempt', { course: c, quiz: quiz.id, answers: [1] }, 201);
  assert.equal(attempt.data.score, 10);
  // Después ve el enunciado de lo que contestó (para sus ✓ y ✗), nunca la respuesta correcta.
  const despues = (await call('student', '/api/course?id=' + c)).records.find((x) => x.id === quiz.id).data.questions[0];
  assert.equal(despues.text, '2+2');
  assert(!('correct' in despues));
  await call('student', '/api/attempt', { course: c, quiz: quiz.id, answers: [0] }, 409);
  await call(
    'owner',
    '/api/record',
    rec('quiz', { title: 'Quiz', questions: [{ text: '2+3', options: ['3', '5'], correct: 1 }] }, quiz),
    400,
  );

  const upload = await raw('owner', '/api/upload?course=' + c + '&scope=material', {
    method: 'POST',
    headers: { Origin: 'https://test.local', 'X-Aula-Request': '1', 'X-File-Name': 'lectura.txt' },
    body: 'Contenido permanente',
  });
  assert.equal(upload.status, 201);
  const file = await upload.json();
  const unit = await call('owner', '/api/record', rec('module', { title: 'Unidad oculta', visible: false }), 201);
  const withFile = await call(
    'owner',
    '/api/record',
    rec('task', {
      title: 'Guía adjunta',
      fileIds: [file.id],
      submissionMode: 'files',
      maxFiles: 1,
      extensions: 'pdf',
      allowResubmit: false,
    }),
    201,
  );
  const taskView = await call('student', '/api/course?id=' + c);
  assert(taskView.files.some((f) => f.id === file.id));
  assert.equal((await raw('student', '/api/file/' + file.id)).status, 200);
  await call('student', '/api/record', rec('submission', { task: withFile.id, body: 'Sin archivo' }), 400);
  await call('owner', '/api/record', rec('task', { ...withFile.data, extensions: 'pdf', visible: false }, withFile));
  await call('owner', '/api/record', rec('material', { title: 'Lectura', module: unit.id, fileIds: [file.id] }), 201);
  await call('student', '/api/file/' + file.id, undefined, 403);
  assert(!(await call('student', '/api/course?id=' + c)).files.some((x) => x.id === file.id));
  await call('owner', '/api/record', rec('module', { title: 'Unidad publicada', visible: true }, unit));
  const download = await raw('student', '/api/file/' + file.id);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), 'Contenido permanente');
  await call('owner', '/api/member', { course: c, id: member.id }, 200, 'DELETE');
  await call('student', '/api/course?id=' + c, undefined, 403);
  await call('owner', '/api/member', { course: c, email: 'student@example.test', name: 'Alumno' });
  assert.equal((await call('student', '/api/course?id=' + c)).records.find((x) => x.id === sub.id).data.grade, 9);
  await call('owner', '/api/courses', { name: 'CSRF', group: 'B' }, 403, 'POST', { Origin: 'https://evil.test' });
  await call('owner', '/api/teachers', { email: 'teacher@example.test', name: 'Docente' });
  assert.equal((await call('teacher', '/api/me')).role, 'teacher');
  await call('teacher', '/api/course?id=' + c, undefined, 403);

  // Acciones destructivas: alcance, rol, confirmación explícita y protección contra datos desactualizados.
  const group = await call('owner', '/api/record', rec('group', { title: 'Equipo de prueba', members: [member.id] }), 201);
  const del = { course: c, id: group.id, revision: group.revision, confirm: group.data.title };
  await call('student', '/api/group', del, 403, 'DELETE');
  await call('teacher', '/api/group', del, 403, 'DELETE');
  await call('owner', '/api/group', { ...del, confirm: 'otro' }, 400, 'DELETE');
  await call('owner', '/api/group', { ...del, revision: 0 }, 409, 'DELETE');
  await call('owner', '/api/group', { ...del, id: withFile.id }, 404, 'DELETE');
  await call('owner', '/api/group', del, 200, 'DELETE');
  const afterGroup = await call('student', '/api/course?id=' + c);
  assert(!afterGroup.records.some((x) => x.id === group.id));
  assert.equal(afterGroup.records.find((x) => x.id === sub.id).data.grade, 9);
  assert(afterGroup.members.some((x) => x.id === member.id));

  const sections = Array.from({ length: 7 }, (_, i) => ({ title: 'Apartado ' + i, body: 'Ejemplo editable ' + i }));
  await call('student', '/api/course-guide', { course: c, sections }, 403);
  await call('teacher', '/api/course-guide', { course: c, sections }, 403);
  await call('owner', '/api/course-guide', { course: c, sections: [] }, 400);
  const guide = await call('owner', '/api/course-guide', { course: c, sections }, 201);
  const guideTeacher = await call('owner', '/api/course?id=' + c);
  assert.equal(guideTeacher.records.filter((r) => r.data.module === guide.module).length, 7);
  assert(guideTeacher.records.filter((r) => r.data.module === guide.module || r.id === guide.module).every((r) => r.data.visible === false));
  assert(!(await call('student', '/api/course?id=' + c)).records.some((r) => r.id === guide.module || r.data.module === guide.module));
  await call('owner', '/api/course-guide', { course: c, sections }, 409);

  const removeCourse = (await call('teacher', '/api/courses', { name: 'Curso a retirar', group: 'B' }, 201)).id;
  await call('teacher', '/api/member', { course: removeCourse, email: 'student@example.test', name: 'Alumno' });
  await call('student', '/api/course', { course: removeCourse, confirm: 'Curso a retirar' }, 403, 'DELETE');
  await call('teacher', '/api/course', { course: removeCourse, confirm: 'otro' }, 400, 'DELETE');
  await call('teacher', '/api/course', { course: removeCourse, confirm: 'Curso a retirar' }, 200, 'DELETE');
  for (const who of ['teacher', 'owner', 'student']) {
    assert(!(await call(who, '/api/courses')).some((x) => x.id === removeCourse));
    await call(who, '/api/course?id=' + removeCourse, undefined, 404);
  }
  await call('teacher', '/api/record', { course: removeCourse, kind: 'notice', data: { title: 'No', body: 'No' } }, 404);
  assert(store.raw().prepare('SELECT id FROM aula_courses WHERE id=?').get(removeCourse), 'Los datos del curso se conservan');

  // ---- Ponderaciones (ahora en aula_tasks.weight + aula_grade_settings) ----
  const w1 = await call('owner', '/api/record', rec('weights', { weights: { [task.id]: 60, [withFile.id]: 30 } }), 400);
  assert.match(w1.error, /100/);
  const weights = await call('owner', '/api/record', rec('weights', { weights: { [task.id]: 70, [withFile.id]: 30 } }), 201);
  assert.equal(weights.id, 'weights:' + c);
  await call('owner', '/api/record', rec('weights', { weights: { [task.id]: 50, [withFile.id]: 50 } }), 409); // sin revisión
  await call('owner', '/api/record', rec('weights', { weights: { [task.id]: 50, [withFile.id]: 50 } }, weights));
  await call('owner', '/api/record', rec('weights', { weights: { [task.id]: 40, [withFile.id]: 60 } }, weights), 409); // revisión vieja
  const w = (await call('owner', '/api/course?id=' + c)).records.find((r) => r.kind === 'weights');
  assert.deepEqual(w.data.weights, { [task.id]: 50, [withFile.id]: 50 });
  assert.equal(w.revision, 2);

  // Una calificación fuera de escala la rechaza la API y, además, la propia base de datos.
  await call('owner', '/api/grade', { course: c, task: task.id, member: member.id, revision: graded.revision, grade: 11 }, 400);
  assert.throws(() => store.raw().prepare('UPDATE aula_submissions SET grade=11 WHERE id=?').run(sub.id), /CHECK/);
  // Calificación manual (sin entrega) para otro alumno.
  const otherMember = (await call('owner', '/api/course?id=' + c)).members.find((m) => m.email === 'other@example.test');
  const manual = await call('owner', '/api/grade', { course: c, task: withFile.id, member: otherMember.id, grade: 7.5, feedback: 'Examen' });
  assert.equal(manual.data.manual, true);
  assert.equal(manual.data.gradedAt.length > 0, true);
  // Si el alumno ya entregó, reentregar reinicia la calificación (el docente debe revisar el trabajo nuevo).
  const resub = await call('student', '/api/record', rec('submission', { task: task.id, body: 'Versión 2' }, graded));
  assert.equal(resub.data.grade, null);

  // ---- Administración de docentes ----
  await call('teacher', '/api/teachers', undefined, 403);
  let teachers = await call('owner', '/api/teachers');
  assert(teachers.find((t) => t.owner && t.email === 'owner@example.test'), 'La cuenta principal aparece en la lista');
  assert.equal(teachers.find((t) => t.email === 'teacher@example.test').courses, 0, 'El curso retirado no cuenta');
  assert(teachers.find((t) => t.email === 'teacher@example.test').lastLogin, 'Se muestra el último acceso');
  await call('owner', '/api/teachers', { email: 'coord@example.test', name: 'Coordinación', role: 'admin' });
  assert.equal((await call('coord', '/api/me')).role, 'admin');
  await call('coord', '/api/teachers', { email: 'owner@example.test' }, 400, 'DELETE');
  await call('coord', '/api/teachers', { email: 'coord@example.test' }, 400, 'DELETE');
  await call('coord', '/api/teachers', { email: 'nadie@example.test' }, 404, 'DELETE');
  const kept = (await call('teacher', '/api/courses', { name: 'Física II', group: 'D' }, 201)).id;
  await call('teacher', '/api/member', { course: kept, name: 'Alumno', email: 'student@example.test' });
  await call('coord', '/api/teachers', { email: 'teacher@example.test' }, 200, 'DELETE');
  // El retiro cierra sus sesiones abiertas; al volver a entrar ya no es docente.
  await call('teacher', '/api/me', undefined, 401);
  sessions.delete('teacher');
  assert.equal((await call('teacher', '/api/me')).role, 'student', 'El retiro aplica de inmediato');
  await call('teacher', '/api/courses', { name: 'Nuevo', group: 'C' }, 403);
  // Pierde el acceso a los cursos que creó; el curso y sus datos siguen intactos para la administración.
  assert(!(await call('teacher', '/api/courses')).some((x) => x.id === kept), 'El curso ya no aparece en su lista');
  await call('teacher', '/api/course?id=' + kept, undefined, 403);
  await call('teacher', '/api/course', { course: kept, name: 'Cambio', group: 'D' }, 403);
  await call('teacher', '/api/course', { course: kept, confirm: 'Física II' }, 403, 'DELETE');
  assert.equal((await call('owner', '/api/course?id=' + kept)).members.length, 1);
  assert((await call('student', '/api/courses')).some((x) => x.id === kept), 'Sus alumnos conservan el curso');
  // Si se le vuelve a dar de alta, lo recupera.
  await call('owner', '/api/teachers', { email: 'teacher@example.test', name: 'Docente', role: 'teacher' });
  assert.equal((await call('teacher', '/api/course?id=' + kept)).canTeach, true);
  await call('owner', '/api/teachers', { email: 'teacher@example.test' }, 200, 'DELETE');
  sessions.delete('teacher');
  teachers = await call('owner', '/api/teachers');
  assert(!teachers.some((t) => t.email === 'teacher@example.test'));

  // ---- Inscripción masiva ----
  await call('student', '/api/members/bulk', { course: c, students: [{ name: 'X', email: 'x@example.test' }] }, 403);
  const bad = await call('owner', '/api/members/bulk', { course: c, students: [{ name: 'Ana', email: 'ana@example.test' }, { name: 'B', email: 'no-es-correo' }] }, 400);
  assert.match(bad.error, /^Fila 2:/);
  await call('late', '/api/me'); // alguien que ya inició sesión antes de ser inscrito
  const bulk = await call('owner', '/api/members/bulk', {
    course: c,
    students: [
      { name: 'Ana Pérez', email: 'ANA@example.test', matricula: '202600001' },
      { name: 'Ana P. (repetida)', email: 'ana@example.test', matricula: '202600001' },
      { name: 'Alumno', email: 'student@example.test', matricula: '202600002' },
      { name: 'Tardío', email: 'late@example.test' },
    ],
  });
  assert.deepEqual(bulk, { total: 3, created: 2, updated: 1 });
  const roster = (await call('owner', '/api/course?id=' + c)).members;
  assert.equal(roster.find((m) => m.email === 'ana@example.test').name, 'Ana P. (repetida)');
  assert.equal(roster.find((m) => m.email === 'student@example.test').id, member.id, 'Reinscribir conserva el mismo registro');
  assert(roster.find((m) => m.email === 'late@example.test').user_id, 'Se vincula a una cuenta existente');
  assert.equal((await call('late', '/api/courses')).length, 1);

  // ---- Límite de consultas de D1 (plan gratuito: 50 por solicitud) ----
  for (let i = 0; i < 30; i++) await call('owner', '/api/courses', { name: 'Curso ' + i, group: 'G' }, 201);
  store.counter.queries = 0;
  assert.equal((await call('owner', '/api/courses')).length, 32); // 30 nuevos, el inicial y el del docente retirado
assert(store.counter.queries <= 3, `GET /api/courses usó ${store.counter.queries} consultas con 32 cursos`);
  store.counter.queries = 0;
  await call('student', '/api/course?id=' + c);
// 11 desde la 12.14 (seguimiento del contenido); el límite del plan gratuito es 50 por solicitud.
// 12: una más desde la 12.18 (secciones y sus fechas, juntas en una consulta).
assert(store.counter.queries <= 12, `GET /api/course usó ${store.counter.queries} consultas`);

  // ---- Persistencia real al reabrir la base ----
  store.reopen();
  assert.equal((await call('owner', '/api/course?id=' + c)).records.find((x) => x.id === sub.id).data.body, 'Versión 2');
  assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), [], 'Sin llaves foráneas rotas');
  checks++;

  console.log(
    `PASS: ${checks} verificaciones de API — sesiones firmadas, cabeceras falsificadas rechazadas, roles, archivos, ` +
      'confidencialidad de respuestas, bloqueo optimista, ponderaciones, docentes, inscripción masiva y límite de consultas.',
  );
} finally {
  store.close();
  rmSync(dir, { recursive: true });
}
