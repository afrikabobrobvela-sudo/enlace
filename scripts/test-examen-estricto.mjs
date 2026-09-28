// Pruebas de las trampas que el examen estricto debe impedir (12.16): contraseña para empezar junto con el bloqueo al
// salir; plataforma bloqueada mientras contesta (ni otros cursos, materiales, avisos ni archivos, aunque abra otra
// pestaña o vuelva a iniciar sesión); un solo dispositivo (otra sesión bloquea y la anterior ya no guarda ni envía);
// opciones en orden aleatorio calificadas bien; e imágenes en las preguntas que no se adelantan antes de empezar.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
let checks = 0;
const sessions = {};
/** Cada "dispositivo" es un inicio de sesión distinto (su propia cookie). */
async function login(name, who = name) {
  sessions[name] = await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who }), env);
}
async function raw(name, path, { data, method, headers = {}, body } = {}) {
  if (!sessions[name]) await login(name);
  const before = store.counter.queries;
  const res = await api(
    new Request('https://t.local' + path, {
      method: method || (data === undefined && body === undefined ? 'GET' : 'POST'),
      headers: { cookie: sessions[name], Origin: 'https://t.local', 'X-Aula-Request': '1', ...headers },
      body: body ?? (data === undefined ? undefined : JSON.stringify(data)),
    }),
    env,
  );
  assert(store.counter.queries - before <= 50, `${path}: ${store.counter.queries - before} consultas`);
  return res;
}
async function call(name, path, data, status = 200) {
  const res = await raw(name, path, { data });
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${name}) → ${text}`);
  checks++;
  return JSON.parse(text);
}
const upload = async (course, name) => {
  const res = await raw('docente', `/api/upload?course=${course}&scope=material`, { body: '%PNG imagen ' + name, headers: { 'x-file-name': name, 'content-type': 'image/png' } });
  assert.equal(res.status, 201);
  return (await res.json()).id;
};

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '501' }, 201)).id;
const otro = (await call('docente', '/api/courses', { name: 'Química', group: '502' }, 201)).id;
for (const course of [c, otro]) await call('docente', '/api/members/bulk', { course, students: [{ name: 'Ana', email: 'ana@example.test' }, { name: 'Beto', email: 'beto@example.test' }] });
const apunte = await upload(c, 'apunte.png');
const unidad = await call('docente', '/api/record', { course: c, kind: 'module', data: { title: 'U1', body: '', visible: true, fileIds: [apunte] } }, 201);
const imagen = await upload(c, 'plano.png');

// ---- Imágenes: deben ser archivos de material del curso ----
const preguntas = [
  { type: 'choice', text: 'Observa el plano inclinado. ¿Qué fuerza falta?', options: ['Normal', 'Peso', 'Fricción', 'Tensión'], correct: 2, image: imagen },
  { type: 'choice', text: 'Unidad de energía', options: ['Joule', 'Newton', 'Watt'], correct: 0 },
  { type: 'choice', text: 'Unidad de potencia', options: ['Joule', 'Newton', 'Watt'], correct: 2 },
];
const exam = { enabled: true, password: 'gauss', lockOnLeave: true, lockGrace: 5, lockPlatform: true, oneByOne: true };
const crear = (extra = {}, status = 201) =>
  call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Parcial', visible: true, questions: preguntas, settings: { attempts: 1, timeLimit: 60, shuffle: true, shuffleOptions: true, exam }, ...extra } }, status);
await crear({ questions: [{ ...preguntas[0], image: '00000000-0000-4000-8000-000000000000' }] }, 400);
const q = await crear();
assert.equal(q.data.questions[0].image, imagen);
assert.deepEqual([q.data.settings.shuffleOptions, q.data.settings.exam.lockPlatform], [true, true]);
checks += 2;

// Antes de empezar: la imagen no se puede ver (no se adelantan las preguntas) y Enlace funciona normal.
assert.equal((await raw('ana', '/api/file/' + imagen)).status, 403);
await call('ana', '/api/courses');
assert.equal((await call('ana', '/api/me')).activeExam, null);
// El alumno recibe la imagen en la pregunta, pero no la respuesta correcta.
const visto = (await call('ana', '/api/course?id=' + c)).records.find((r) => r.id === q.id);
assert.equal(visto.data.questions[0].image, imagen);
assert(!('correct' in visto.data.questions[0]));
checks += 3;

// ---- Contraseña + bloqueo al salir juntos ----
const ctx = (extra = {}) => ({ course: c, quiz: q.id, attempt: 1, ...extra });
await call('ana', '/api/attempt/start', ctx({ password: 'newton' }), 400);
const inicio = await call('ana', '/api/attempt/start', ctx({ password: 'gauss' }));
assert.equal(inicio.exam.lockOnLeave, true);
checks++;

// ---- Plataforma bloqueada mientras contesta ----
const me = await call('ana', '/api/me');
assert.deepEqual(me.activeExam, { quiz: q.id, course: c });
for (const path of ['/api/courses', '/api/notifications', '/api/dashboard', '/api/course?id=' + otro, `/api/attendance?course=${c}`]) {
  const r = await call('ana', path, undefined, 423);
  assert.deepEqual(r.activeExam, { quiz: q.id, course: c });
}
await call('ana', '/api/record', { course: c, kind: 'post', data: { forum: 'x', title: 'a', body: 'b' } }, 423);
// Del curso del examen solo recibe la evaluación.
const reducido = await call('ana', '/api/course?id=' + c);
assert.equal(reducido.examOnly, true);
assert.deepEqual([...new Set(reducido.records.map((r) => r.kind))], ['quiz']);
assert(!reducido.records.some((r) => r.id === unidad.id));
// Archivos: la imagen de la pregunta sí; el apunte de la unidad no.
assert.equal((await raw('ana', '/api/file/' + imagen)).status, 200);
assert.equal((await raw('ana', '/api/file/' + apunte)).status, 423);
// Tampoco puede empezar otra evaluación mientras tanto.
const otra = await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Práctica', visible: true, questions: preguntas.slice(1) } }, 201);
await call('ana', '/api/attempt/start', { course: c, quiz: otra.id }, 423);
// Beto (no ha empezado) y el docente no se ven afectados.
await call('beto', '/api/courses');
await call('docente', '/api/course?id=' + c);
checks += 7;

// ---- Volver a iniciar sesión / otro dispositivo ----
await call('ana', '/api/attempt/progress', ctx({ answers: { [inicio.questions[0].index]: 0 }, position: 0 }));
await login('ana2', 'ana'); // mismo alumno, nueva sesión (otro teléfono o pestaña privada)
assert.deepEqual((await call('ana2', '/api/me')).activeExam, { quiz: q.id, course: c }, 'La nueva sesión también queda limitada al examen');
await call('ana2', '/api/courses', undefined, 423);
const retomar = await call('ana2', '/api/attempt/start', ctx());
assert.equal(retomar.exam.locked, true, 'Abrir el examen en otra sesión lo bloquea');
// La sesión anterior ya no puede guardar, enviar ni desbloquear.
const viejo = await call('ana', '/api/attempt/progress', ctx({ answers: {} }), 409);
assert.equal(viejo.otherDevice, true);
await call('ana', '/api/attempt', { course: c, quiz: q.id, answers: {} }, 409);
await call('ana', '/api/attempt/unlock', ctx({ code: '123456' }), 409);
// La nueva, con el código del docente, continúa.
await call('ana2', '/api/attempt/progress', ctx({ answers: {} }), 423);
const monitor = (await call('docente', `/api/exam/monitor?course=${c}&quiz=${q.id}`)).running.find((r) => r.name === 'Ana');
assert.equal(monitor.locked, true);
await call('ana2', '/api/attempt/unlock', ctx({ code: monitor.unlockCode }));
await call('ana2', '/api/attempt/progress', ctx({ answers: {} }));
checks += 6;

// ---- Opciones en otro orden: se califica con la opción original ----
const correctas = { 0: 'Fricción', 1: 'Joule', 2: 'Watt' };
const respuestas = Object.fromEntries(retomar.questions.map((x) => [x.index, x.options.indexOf(correctas[x.index])]));
const ordenes = retomar.questions.map((x) => x.options.join(','));
assert(!retomar.questions.some((x) => 'perm' in x || 'correct' in x), 'La permutación y la respuesta no llegan al navegador');
assert.equal(retomar.questions.find((x) => x.index === 0).image, imagen);
// Otro alumno ve otro orden (con cuatro opciones es muy improbable que coincida todo).
const deBeto = await call('beto', '/api/attempt/start', ctx({ password: 'gauss' }));
assert.notDeepEqual(deBeto.questions.map((x) => x.options.join(',')), ordenes);
const enviado = await call('ana2', '/api/attempt', { course: c, quiz: q.id, answers: respuestas }, 201);
assert.deepEqual([enviado.data.correct, enviado.data.total], [3, 3]);
// El detalle guarda la opción original (para que el docente vea qué eligió).
assert.equal(enviado.data.details.find((d) => d.index === 0).answer, 2);
checks += 5;

// ---- Al enviar, la plataforma se desbloquea ----
assert.equal((await call('ana2', '/api/me')).activeExam, null);
await call('ana2', '/api/courses');
await call('ana', '/api/courses');
checks++;

// ---- Se acabó el tiempo sin enviar: también se desbloquea ----
store.raw().prepare("UPDATE aula_attempt_starts SET started=? WHERE quiz=? AND user_id=(SELECT id FROM aula_users WHERE email='beto@example.test')").run(new Date(Date.now() - 62 * 60_000).toISOString(), q.id);
await call('beto', '/api/courses');
checks++;

// ---- Sin «bloquear la plataforma», contestar no limita lo demás ----
const libre = await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Libre', visible: true, questions: preguntas.slice(1), settings: { attempts: 1, exam: { enabled: true } } } }, 201);
await call('beto', '/api/attempt/start', { course: c, quiz: libre.id });
await call('beto', '/api/courses');
assert.equal((await call('beto', '/api/me')).activeExam, null);
checks++;
// Capturas de pantalla detectadas en el navegador: quedan en el registro de integridad.
await call('beto', '/api/attempt/progress', { course: c, quiz: libre.id, attempt: 1, events: [{ kind: 'capture' }, { kind: 'capture' }] });
const conCapturas = await call('beto', '/api/attempt', { course: c, quiz: libre.id, answers: { 0: 0, 1: 2 } }, 201);
assert.equal(conCapturas.data.integrity.captures, 2);
checks++;

// ================= Fechas, temporizador fijo, qué ve al terminar =================
const min = 60_000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const quiz = (settings, status = 201) =>
  call('docente', '/api/record', { course: otro, kind: 'quiz', data: { title: 'Q', visible: true, questions: preguntas.slice(1), settings: { attempts: 1, ...settings } } }, status);
await quiz({ opensAt: iso(10 * min), closesAt: iso(5 * min) }, 400); // la final antes de la de inicio
await quiz({ timerMode: 'fixed', timeLimit: 30 }, 400); // temporizador fijo sin fecha de inicio
// Aún no abre / ya cerró: no se puede empezar.
const futura = await quiz({ opensAt: iso(60 * min) });
assert.match((await call('beto', '/api/attempt/start', { course: otro, quiz: futura.id }, 403)).error, /se abre el/);
const cerrada = await quiz({ closesAt: iso(-min) });
assert.match((await call('beto', '/api/attempt/start', { course: otro, quiz: cerrada.id }, 403)).error, /cerró el/);
// Temporizador fijo: empezó hace 20 min con límite de 30 → a quien entra ahora le quedan ~10.
const fija = await quiz({ opensAt: iso(-20 * min), timeLimit: 30, timerMode: 'fixed' });
const tarde = await call('beto', '/api/attempt/start', { course: otro, quiz: fija.id });
const restante = (Date.parse(tarde.deadline) - Date.now()) / min;
assert(restante > 9 && restante < 11, `Quedan ${restante.toFixed(1)} min`);
// La fecha final corta el intento aunque su tiempo sea mayor.
const corta = await quiz({ closesAt: iso(5 * min), timeLimit: 60 });
const cortado = await call('ana', '/api/attempt/start', { course: otro, quiz: corta.id });
assert(Math.abs(Date.parse(cortado.deadline) - Date.parse(corta.data.settings.closesAt)) < 1000);
checks += 5;

// Qué ve al terminar: sin calificación (pendiente) y sin detalle.
const oculta = await quiz({ results: { score: false } });
const r1 = await call('beto', '/api/attempt', { course: otro, quiz: oculta.id, answers: { 0: 0, 1: 2 } }, 201);
assert.deepEqual([r1.data.score, r1.data.correct, r1.data.details, r1.data.hidden], [null, null, null, true]);
const deBetoCurso = (await call('beto', '/api/course?id=' + otro)).records.find((r) => r.kind === 'attempt' && r.data.quiz === oculta.id);
assert.equal(deBetoCurso.data.score, null);
const delDocente = (await call('docente', '/api/course?id=' + otro)).records.find((r) => r.kind === 'attempt' && r.data.quiz === oculta.id);
assert.equal(delDocente.data.score, 10, 'El docente sí ve la calificación');
// Al activarla después, el alumno ya la ve.
await call('docente', '/api/record', { course: otro, kind: 'quiz', id: oculta.id, revision: oculta.revision, data: { ...oculta.data, settings: { ...oculta.data.settings, results: { score: true, review: 'none' } } } });
const visible = (await call('beto', '/api/course?id=' + otro)).records.find((r) => r.kind === 'attempt' && r.data.quiz === oculta.id);
assert.deepEqual([visible.data.score, visible.data.details], [10, null], 'Calificación sí, detalle no');
checks += 4;

// Se acabó el tiempo sin enviar: se califica lo que dejó guardado (antes contaba 0).
const guardada = await quiz({ timeLimit: 10, exam: { enabled: true } });
const g = await call('ana', '/api/attempt/start', { course: otro, quiz: guardada.id });
const buenas = Object.fromEntries(g.questions.map((x) => [x.index, x.options.indexOf(x.index === 0 ? 'Joule' : 'Watt')]));
await call('ana', '/api/attempt/progress', { course: otro, quiz: guardada.id, attempt: 1, answers: buenas });
store.raw().prepare("UPDATE aula_attempt_starts SET started=? WHERE quiz=? AND user_id=(SELECT id FROM aula_users WHERE email='ana@example.test')").run(iso(-15 * min), guardada.id);
await call('ana', '/api/attempt/start', { course: otro, quiz: guardada.id }, 409); // ya no le quedan intentos
const cerrado = store.raw().prepare("SELECT score, correct FROM aula_attempts WHERE quiz=?").get(guardada.id);
assert.deepEqual([cerrado.score, cerrado.correct], [10, 2]);
checks++;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones del examen estricto — contraseña con bloqueo, plataforma bloqueada mientras contesta, un solo dispositivo, opciones aleatorias bien calificadas e imágenes sin adelantar preguntas.`);
