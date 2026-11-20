// Alumno de prueba (12.92): quien enseña entra a su curso con una cuenta de alumno de verdad, contesta un examen como
// sus alumnos (se guarda, sale en el monitor) y vuelve a su cuenta con un botón. También: el enlace de un solo uso
// para otro dispositivo, borrar lo que hizo, quitarlo del curso y lo que esa cuenta no puede hacer.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { auth, completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { sendMails } from '../src/server/mail.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
const ORIGIN = 'https://t.local';
let checks = 0;
const cookies = {};

async function login(who) {
  cookies[who] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who }), env);
  return cookies[who];
}

/** Solicitud a la API con una cookie dada (la de una persona o la del alumno de prueba). */
async function apiAs(cookie, path, data, status = 200) {
  const before = store.counter.queries;
  const res = await api(
    new Request(ORIGIN + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { cookie, Origin: ORIGIN, 'X-Aula-Request': '1' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  const text = await res.text();
  assert.equal(res.status, status, `${path} → ${text}`);
  assert(store.counter.queries - before <= 50, `${path}: demasiadas consultas`);
  checks++;
  return JSON.parse(text);
}
const call = async (who, path, data, status) => apiAs(await login(who), path, data, status);

/** Solicitud a /auth/*: devuelve el estado, el cuerpo y las cookies que fija. */
async function authAs(cookie, path, { json, form, method = json || form ? 'POST' : 'GET', origin = ORIGIN } = {}) {
  const headers = { cookie: cookie || '', Origin: origin };
  let body;
  if (json) {
    headers['X-Aula-Request'] = '1';
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) body = new URLSearchParams(form);
  const res = await auth(new Request(ORIGIN + path, { method, headers, body }), env);
  const set = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    set[pair.slice(0, i)] = { value: pair.slice(i + 1), maxAge: Number(/Max-Age=(\d+)/.exec(line)?.[1]) };
  }
  const text = await res.text();
  return { status: res.status, location: res.headers.get('location'), set, body: text.startsWith('{') ? JSON.parse(text) : text };
}
const SESSION = '__Host-enlace_session';
const STASH = '__Host-enlace_docente';
const jar = (session, stash) => [session && `${SESSION}=${session}`, stash && `${STASH}=${stash}`].filter(Boolean).join('; ');
const valueOf = (cookie) => cookie.split('=').slice(1).join('=');

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
await call('admin', '/api/teachers', { email: 'colega@example.test', name: 'Colega', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '501' }, 201)).id;
const otro = (await call('colega', '/api/courses', { name: 'Química', group: '101' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: [{ name: 'Ana', email: 'ana@example.test' }] });
const seccion = (await call('docente', '/api/sections', { course: c, name: 'Martes' }, 201)).id;
const examen = await call('docente', '/api/record', {
  course: c,
  kind: 'quiz',
  data: {
    title: 'Parcial 1',
    visible: true,
    questions: [{ type: 'choice', text: 'Unidad de fuerza', options: ['J', 'N'], correct: 1 }],
    settings: { attempts: 1, timeLimit: 30, exam: { enabled: true, lockOnLeave: true, lockGrace: 5 } },
  },
}, 201);
const tarea = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Tarea 1', visible: true } }, 201);
// Se revisa el curso antes de mostrarlo a los alumnos: el alumno de prueba entra aunque esté oculto.
await call('docente', '/api/course/visibility', { course: c, visible: false });

// ---- Solo quien enseña ese curso puede entrar como su alumno de prueba ----
const docente = await login('docente');
assert.equal((await authAs(await login('ana'), '/auth/prueba/entrar', { json: { course: c } })).status, 403, 'Un alumno no');
assert.equal((await authAs(await login('colega'), '/auth/prueba/entrar', { json: { course: c } })).status, 403, 'Otro docente no');
assert.equal((await authAs(docente, '/auth/prueba/entrar', { json: { course: c }, origin: 'https://otro.sitio' })).status, 403, 'Mismo origen');
assert.equal((await authAs('', '/auth/prueba/entrar', { json: { course: c } })).status, 401, 'Con sesión');
checks += 4;
let state = await call('docente', '/api/test-student?course=' + c);
assert.deepEqual([state.enrolled, state.attempts, state.submissions], [false, 0, 0]);
await call('ana', '/api/test-student?course=' + c, undefined, 403);
checks += 1;

// ---- Entrar aquí: la sesión cambia y la de docente queda guardada en otra cookie ----
const entrada = await authAs(docente, '/auth/prueba/entrar', { json: { course: c, section: seccion, device: 'here' } });
assert.equal(entrada.status, 200);
assert.equal(entrada.body.course, c);
const prueba = entrada.set[SESSION].value;
assert(prueba && prueba !== valueOf(docente), 'Sesión nueva del alumno de prueba');
assert.equal(entrada.set[STASH].value, valueOf(docente), 'Se guarda la sesión de docente tal cual');
assert(entrada.set[STASH].maxAge > 13 * 86400, 'Con el mismo vencimiento que la de docente');
checks += 5;

const yo = await apiAs(jar(prueba, valueOf(docente)), '/api/me');
assert.equal(yo.role, 'student');
assert.equal(yo.name, 'Alumno de prueba');
assert.deepEqual(yo.testStudent, { course: c, canReturn: true });
assert.equal(yo.canRequestTeacher, false, 'No puede pedir ser docente');
assert.equal(yo.privacyAccepted, true, 'El aviso ya lo aceptó quien enseña');
assert.equal((await apiAs(`${SESSION}=${prueba}`, '/api/me')).testStudent.canReturn, false, 'Sin la cookie guardada no hay a dónde volver');
checks += 6;

// Foto obligatoria: no se le pide (a un alumno real sí).
env.FOTO_OBLIGATORIA = '1';
assert.equal((await apiAs(`${SESSION}=${prueba}`, '/api/me')).needsPhoto, false);
await apiAs(`${SESSION}=${prueba}`, '/api/courses');
assert.equal((await call('ana', '/api/me')).needsPhoto, true);
delete env.FOTO_OBLIGATORIA;
checks += 2;

// Ve su curso (oculto para los alumnos) y nada más; queda en la sección elegida.
const mios = await apiAs(`${SESSION}=${prueba}`, '/api/courses');
assert.deepEqual(mios.map((x) => x.id), [c]);
const vista = await apiAs(`${SESSION}=${prueba}`, '/api/course?id=' + c);
assert(vista.records.some((r) => r.id === examen.id), 'Ve la evaluación publicada');
assert(vista.records.find((r) => r.id === examen.id).data.questions.every((q) => q === null), 'Sin las preguntas, como un alumno');
await apiAs(`${SESSION}=${prueba}`, '/api/course?id=' + otro, undefined, 403);
let miembros = (await call('docente', '/api/course?id=' + c)).members;
const fila = miembros.find((m) => m.name === 'Alumno de prueba');
assert.equal(fila.role, 'student');
assert.equal(fila.section, seccion);
assert.equal((await call('ana', '/api/courses')).length, 0, 'El curso sigue oculto para los alumnos');
checks += 6;

// No puede unirse a otros cursos.
const { code } = await call('colega', '/api/course/join-code', { course: otro, enabled: true });
assert.match((await apiAs(`${SESSION}=${prueba}`, '/api/join', { code }, 403)).error, /solo puede estar en su propio curso/);
checks += 1;

// ---- Contesta el examen como un alumno: sale en el monitor y queda su intento ----
const ctx = { course: c, quiz: examen.id, attempt: 1 };
await apiAs(`${SESSION}=${prueba}`, '/api/attempt/start', ctx);
await apiAs(`${SESSION}=${prueba}`, '/api/attempt/progress', { ...ctx, answers: { 0: 1 }, position: 0 });
let monitor = await call('docente', `/api/exam/monitor?course=${c}&quiz=${examen.id}`);
assert.deepEqual(monitor.running.map((r) => r.name), ['Alumno de prueba'], 'Aparece en el monitor');
state = await call('docente', '/api/test-student?course=' + c);
assert.deepEqual([state.enrolled, state.section, state.running, state.attempts], [true, seccion, 1, 0]);
// Salir del examen lo bloquea igual que a un alumno, y el código sale en el monitor del docente.
await apiAs(`${SESSION}=${prueba}`, '/api/attempt/away', ctx);
assert.equal((await apiAs(`${SESSION}=${prueba}`, '/api/attempt/back', { ...ctx, seconds: 40 })).locked, true, 'Se bloquea al salir');
monitor = await call('docente', `/api/exam/monitor?course=${c}&quiz=${examen.id}`);
const bloqueo = monitor.running.find((r) => r.name === 'Alumno de prueba');
assert.equal(bloqueo.locked, true);
assert.match(bloqueo.unlockCode, /^\d{6}$/, 'El docente ve el código');
await apiAs(`${SESSION}=${prueba}`, '/api/attempt/unlock', { ...ctx, code: bloqueo.unlockCode });
checks += 4;
await apiAs(`${SESSION}=${prueba}`, '/api/attempt', { ...ctx, answers: { 0: 1 } }, 201);
await apiAs(`${SESSION}=${prueba}`, '/api/record', { course: c, kind: 'submission', data: { task: tarea.id, body: 'mi respuesta' } }, 201);
state = await call('docente', '/api/test-student?course=' + c);
assert.deepEqual([state.attempts, state.running, state.submissions], [1, 0, 1]);
checks += 1;

// ---- Volver a la cuenta de docente: se recupera la misma sesión y se cierra la de prueba ----
const vuelta = await authAs(jar(prueba, valueOf(docente)), '/auth/prueba/volver', { json: {} });
assert.equal(vuelta.status, 200);
assert.deepEqual([vuelta.body.course, vuelta.body.relogin], [c, undefined]);
assert.equal(vuelta.set[SESSION].value, valueOf(docente), 'Vuelve la cookie de docente');
assert.equal(vuelta.set[STASH].maxAge, 0, 'Se borra la guardada');
await apiAs(`${SESSION}=${prueba}`, '/api/me', undefined, 401);
assert.equal((await call('docente', '/api/me')).role, 'teacher');
checks += 4;
// «Volver» desde una sesión que no es de prueba no hace nada.
assert.equal((await authAs(jar(valueOf(docente), valueOf(docente)), '/auth/prueba/volver', { json: {} })).status, 409);
checks += 1;
// Desde la cuenta de una persona real, la cookie guardada no sirve para entrar como otra (la API la ignora).
assert.equal((await apiAs(jar(valueOf(await login('ana')), valueOf(docente)), '/api/me')).email, 'ana@example.test');
checks += 1;

// ---- Otro dispositivo: enlace de un solo uso, que nunca regresa a la cuenta de docente ----
const pedido = await authAs(docente, '/auth/prueba/entrar', { json: { course: c, section: 'no-existe', device: 'other' } });
assert.equal(pedido.status, 200);
assert.equal(Object.keys(pedido.set).length, 0, 'Pedir el enlace no cambia la sesión de quien lo pide');
const url = new URL(pedido.body.url);
assert.equal(url.pathname, '/auth/prueba');
assert(url.href.length < 120, 'Cabe en un código QR');
const token = url.searchParams.get('t');
const pagina = await authAs('', '/auth/prueba?t=' + token);
assert.equal(pagina.status, 200);
assert.match(pagina.body, /<form method="post" action="\/auth\/prueba">/, 'El GET solo muestra un botón');
const dispositivo = await authAs('', '/auth/prueba', { form: { token } });
assert.equal(dispositivo.status, 302);
assert.equal(dispositivo.location, '/#c=' + c);
const enOtro = dispositivo.set[SESSION].value;
assert.equal(dispositivo.set[STASH].maxAge, 0);
assert.deepEqual((await apiAs(`${SESSION}=${enOtro}`, '/api/me')).testStudent, { course: c, canReturn: false });
assert.equal((await authAs('', '/auth/prueba', { form: { token } })).location, '/?login_error=link', 'Solo una vez');
miembros = (await call('docente', '/api/course?id=' + c)).members;
assert.equal(miembros.find((m) => m.name === 'Alumno de prueba').section, '', 'Una sección que no es del curso queda en «sin sección»');
checks += 11;
// El enlace de prueba no sirve en el enlace por correo, y un proveedor nunca entrega el dominio reservado.
const otroPedido = await authAs(docente, '/auth/prueba/entrar', { json: { course: c, device: 'other' } });
const otroToken = new URL(otroPedido.body.url).searchParams.get('t');
assert.equal((await authAs('', '/auth/email/verify', { form: { token: otroToken } })).location, '/?login_error=link');
await assert.rejects(completeLogin(env, { provider: 'google', subject: 'x', email: 'prueba-' + c + '@alumno-prueba.invalid', name: 'x' }), /no puede usarse/);
checks += 2;
// Sin sesión de docente guardada, «Salir» deja sin sesión.
const salida = await authAs(`${SESSION}=${enOtro}`, '/auth/prueba/volver', { json: {} });
assert.equal(salida.body.relogin, true);
assert.equal(salida.set[SESSION].maxAge, 0);
await apiAs(`${SESSION}=${enOtro}`, '/api/me', undefined, 401);
checks += 3;
// Cerrar sesión también olvida la cookie guardada.
const fuera = await authAs(jar(valueOf(docente), valueOf(docente)), '/auth/logout', { json: {} });
assert.equal(fuera.set[STASH].maxAge, 0);
checks += 1;
cookies.docente = undefined;
const docente2 = await login('docente');

// ---- Borrar lo que hizo y quitarlo del curso ----
await call('ana', '/api/test-student/reset', { course: c }, 403);
const borrado = await call('docente', '/api/test-student/reset', { course: c });
assert.deepEqual([borrado.attempts, borrado.submissions], [1, 1]);
state = await call('docente', '/api/test-student?course=' + c);
assert.deepEqual([state.enrolled, state.attempts, state.running, state.submissions], [true, 0, 0, 0]);
assert.equal(store.raw().prepare("SELECT count(*) AS n FROM aula_attempt_starts WHERE user_id='prueba-' || ?").get(c).n, 0);
checks += 3;
// Puede volver a contestar desde cero.
const otraEntrada = await authAs(docente2, '/auth/prueba/entrar', { json: { course: c, section: '' } });
const prueba2 = otraEntrada.set[SESSION].value;
await apiAs(`${SESSION}=${prueba2}`, '/api/attempt/start', ctx);
await apiAs(`${SESSION}=${prueba2}`, '/api/attempt', { ...ctx, answers: { 0: 0 } }, 201);
// Quitarlo: se borra lo que hizo, se da de baja y se cierran sus sesiones.
await call('docente', '/api/test-student/reset', { course: c, remove: true });
await apiAs(`${SESSION}=${prueba2}`, '/api/me', undefined, 401);
miembros = (await call('docente', '/api/course?id=' + c)).members;
assert.equal(miembros.some((m) => m.name === 'Alumno de prueba'), false, 'Ya no sale en la lista');
state = await call('docente', '/api/test-student?course=' + c);
assert.deepEqual([state.enrolled, state.attempts], [false, 0]);
// Un enlace pendiente ya no entra después de quitarlo.
const pendiente = await authAs(docente2, '/auth/prueba/entrar', { json: { course: c, device: 'other' } });
await call('docente', '/api/test-student/reset', { course: c, remove: true });
assert.equal((await authAs('', '/auth/prueba', { form: { token: new URL(pendiente.body.url).searchParams.get('t') } })).location, '/?login_error=link');
// Entrar otra vez lo reactiva.
const regreso = await authAs(docente2, '/auth/prueba/entrar', { json: { course: c } });
assert.equal((await apiAs(`${SESSION}=${regreso.set[SESSION].value}`, '/api/me')).testStudent.course, c);
checks += 6;

// ---- Curso archivado: no se entra ----
await call('docente', '/api/course/archive', { course: c, archived: true });
assert.match((await authAs(docente2, '/auth/prueba/entrar', { json: { course: c } })).body.error, /archivado/);
checks += 1;

// ---- Nunca se envían correos al dominio reservado ----
const sent = [];
const mailEnv = { ...env, MAILER: async (m) => sent.push(m.to) };
const r = await sendMails(store.DB, mailEnv, [
  { to: 'prueba-' + c + '@alumno-prueba.invalid', subject: 'x', text: 'x' },
  { to: 'luis@ejemplo.invalid', subject: 'x', text: 'x' },
  { to: 'ana@example.test', subject: 'x', text: 'x' },
]);
assert.deepEqual(sent, ['ana@example.test']);
assert.equal(r.skipped.length, 2);
checks += 2;

console.log(`PASS: ${checks} verificaciones del alumno de prueba — entrar desde la cuenta docente y volver, enlace de un solo uso para otro dispositivo, examen en el monitor, borrar lo que hizo, quitarlo y lo que no puede hacer.`);
