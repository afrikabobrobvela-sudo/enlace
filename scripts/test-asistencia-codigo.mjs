// Pruebas del registro de asistencia con código escrito en el pizarrón: ubicación del salón, red, registros
// "por revisar", modo estricto, cambio de código, confirmación del docente y convivencia con el registro con QR.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { distanceMeters, networkOf } from '../src/server/attendance.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'q'.repeat(40) };
let checks = 0;
const cookies = {};
const ESCUELA = '148.228.10.20';
async function call(user, path, data, status = 200, ip = ESCUELA) {
  cookies[user] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user }),
    env,
  );
  const before = store.counter.queries;
  const res = await api(
    new Request('https://t.local' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { cookie: cookies[user], Origin: 'https://t.local', 'X-Aula-Request': '1', 'CF-Connecting-IP': ip },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${user}) → ${text}`);
  assert(store.counter.queries - before <= 50);
  checks++;
  return JSON.parse(text);
}

// ---- Utilidades ----
const salon = { lat: 19.0006, lng: -98.2016, accuracy: 20 }; // Ciudad Universitaria (aproximado)
assert(Math.abs(distanceMeters(salon, { lat: 19.0006, lng: -98.2016 + 0.001 }) - 105) < 2, 'Unos 105 m por milésima de grado de longitud');
const net = (ip) => networkOf(new Request('https://t.local', { headers: { 'CF-Connecting-IP': ip } }));
assert.equal(net('148.228.10.20'), net('148.228.10.99'));
assert.notEqual(net('148.228.10.20'), net('189.203.4.5'));
assert.equal(net('2806:10a0:12:3::1'), net('2806:10a0:12:ffff::9'));
assert.equal(net(''), null);
checks += 5;

// ---- Curso ----
await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '501' }, 201)).id;
const alumnos = ['ana', 'beto', 'carla', 'dani', 'eva', 'fer'];
await call('docente', '/api/members/bulk', { course: c, students: alumnos.map((n) => ({ name: n, email: n + '@example.test' })) });
const miembros = Object.fromEntries((await call('docente', '/api/course?id=' + c)).members.map((m) => [m.name, m.id]));
const hoy = (await call('docente', '/api/attendance/session', { course: c, date: '2026-10-05' }, 201)).id;

// ---- Abrir con código y ubicación ----
await call('ana', '/api/attendance/checkin/open', { course: c, session: hoy, mode: 'code' }, 403);
await call('docente', '/api/attendance/checkin/open', { course: c, session: hoy, mode: 'code', radius: 77 }, 400);
const abierto = await call('docente', '/api/attendance/checkin/open', { course: c, session: hoy, mode: 'code', minutes: 5, radius: 150, location: salon });
assert.match(abierto.code, /^[A-HJKMNP-Z2-9]{6}$/, 'Seis caracteres sin letras confusas');
assert.deepEqual([abierto.mode, abierto.radius, abierto.strict, abierto.located, abierto.pin], ['code', 150, false, true, '']);
checks += 2;

const registrar = (quien, extra = {}, status = 200, ip = ESCUELA) =>
  call(quien, '/api/attendance/checkin/code', { code: abierto.code, device: 'tel-' + quien + '-0001', ...extra }, status, ip);
const cerca = { lat: salon.lat + 0.0003, lng: salon.lng, accuracy: 25 }; // ~33 m
const lejos = { lat: 19.05, lng: -98.23, accuracy: 15 }; // ~6 km

// En el salón: presente, sin nada que revisar. Minúsculas, espacios y guion se aceptan.
const a = await call('ana', '/api/attendance/checkin/code', { code: ` ${abierto.code.slice(0, 3).toLowerCase()}-${abierto.code.slice(3)} `, device: 'tel-ana-0001', location: cerca });
assert.deepEqual([a.status, a.review], ['present', false]);
assert.deepEqual((await registrar('ana', { location: cerca })).already, true);
// Desde su casa, con el código que le pasaron: queda por revisar con la distancia.
const b = await registrar('beto', { location: lejos }, 200, '189.203.4.5');
assert.equal(b.review, true);
// Sin permiso de ubicación pero en la red de la escuela: se acepta; fuera de la red, por revisar.
assert.equal((await registrar('carla', { locationError: 'denied' })).review, false);
assert.equal((await registrar('dani', { locationError: 'denied' }, 200, '189.203.4.5')).review, true);
// El mismo teléfono no registra a dos alumnos.
await registrar('eva', { device: 'tel-ana-0001', location: cerca }, 409);
// Códigos equivocados y el QR de otra sesión no sirven.
await call('eva', '/api/attendance/checkin/code', { code: 'ZZZZZZ', device: 'tel-eva-0001' }, 404);
await call('eva', '/api/attendance/checkin/code', { code: '12', device: 'tel-eva-0001' }, 400);
await call('eva', '/api/attendance/checkin', { token: `${abierto.code}.abc.firmafalsa`, device: 'tel-eva-0001' }, 400);
await call('docente', '/api/attendance/checkin/code', { code: abierto.code, device: 'tel-doc-0001' }, 403); // no es alumno
checks += 4;

// Lo que ve el docente: motivos, sin coordenadas de nadie.
let estado = await call('docente', `/api/attendance/session?course=${c}&id=${hoy}`);
const motivo = Object.fromEntries(estado.flags.map((f) => [f.member, f.flag]));
assert.match(motivo[miembros.beto], /^a \d+\.\d km del salón$/);
assert.equal(motivo[miembros.dani], 'no permitió ver su ubicación');
assert.equal(Object.keys(motivo).length, 2);
const notas = Object.fromEntries(estado.records.map((r) => [r.member, r.note]));
assert.equal(notas[miembros.ana], 'Registro con código');
assert.match(notas[miembros.beto], /^Registro con código · Por revisar: a /);
assert.deepEqual([estado.checkin.mode, estado.checkin.located], ['code', true]);
const guardado = store.raw().prepare('SELECT * FROM aula_checkins WHERE member=?').get(miembros.beto);
assert(guardado.distance > 5000 && !('lat' in guardado) && guardado.same_network === 0);
checks += 7;

// El alumno ve su propio registro por revisar.
const vistaBeto = await call('beto', '/api/attendance?course=' + c);
assert.match(vistaBeto.records[0].note, /Por revisar/);
checks++;

// Confirmar (estaba en el salón): desaparece de "por revisar"; confirmar dos veces avisa.
await call('ana', '/api/attendance/checkin/review', { course: c, session: hoy, member: miembros.dani }, 403);
await call('docente', '/api/attendance/checkin/review', { course: c, session: hoy, member: miembros.dani });
await call('docente', '/api/attendance/checkin/review', { course: c, session: hoy, member: miembros.dani }, 409);
estado = await call('docente', `/api/attendance/session?course=${c}&id=${hoy}`);
assert.deepEqual(estado.flags.map((f) => f.member), [miembros.beto]);
assert.equal(estado.records.find((r) => r.member === miembros.dani).note, 'Registro con código · Confirmado por el docente');
checks += 2;

// Cambiar el código: el anterior deja de servir.
const nuevo = (await call('docente', '/api/attendance/checkin/rotate', { course: c, session: hoy })).code;
assert.notEqual(nuevo, abierto.code);
await registrar('eva', { location: cerca }, 404);
assert.equal((await call('eva', '/api/attendance/checkin/code', { code: nuevo, device: 'tel-eva-0001', location: cerca })).status, 'present');
checks += 2;

// Cerrar: se borra la ubicación del salón y la red; el código ya no sirve.
await call('docente', '/api/attendance/checkin/close', { course: c, session: hoy });
const sesion = store.raw().prepare('SELECT * FROM aula_sessions WHERE id=?').get(hoy);
assert.deepEqual([sesion.checkin_lat, sesion.checkin_lng, sesion.checkin_network, sesion.checkin_code], [null, null, null, null]);
await call('fer', '/api/attendance/checkin/code', { code: nuevo, device: 'tel-fer-0001' }, 404);
checks++;

// ---- Modo estricto: fuera del radio no se registra ----
const otra = (await call('docente', '/api/attendance/session', { course: c, date: '2026-10-07' }, 201)).id;
const estricto = await call('docente', '/api/attendance/checkin/open', { course: c, session: otra, mode: 'code', radius: 100, strict: true, location: salon });
await call('beto', '/api/attendance/checkin/code', { code: estricto.code, device: 'tel-beto-0001', location: lejos }, 403, '189.203.4.5');
assert.equal(store.raw().prepare('SELECT count(*) AS n FROM aula_attendance WHERE session=?').get(otra).n, 0);
assert.equal((await call('beto', '/api/attendance/checkin/code', { code: estricto.code, device: 'tel-beto-0001', location: cerca })).status, 'present');
checks += 2;

// ---- Sin la ubicación del docente: solo la red ----
const tercera = (await call('docente', '/api/attendance/session', { course: c, date: '2026-10-09' }, 201)).id;
const sinUbicacion = await call('docente', '/api/attendance/checkin/open', { course: c, session: tercera, mode: 'code', radius: 150, location: null });
assert.equal(sinUbicacion.located, false);
assert.equal((await call('ana', '/api/attendance/checkin/code', { code: sinUbicacion.code, device: 'tel-ana-0001', location: lejos })).review, false);
assert.equal((await call('beto', '/api/attendance/checkin/code', { code: sinUbicacion.code, device: 'tel-beto-0001' }, 200, '189.203.4.5')).review, true);
checks += 3;

// ---- Sin revisar ubicación (radio 0): nunca queda por revisar ----
const cuarta = (await call('docente', '/api/attendance/session', { course: c, date: '2026-10-12' }, 201)).id;
const libre = await call('docente', '/api/attendance/checkin/open', { course: c, session: cuarta, mode: 'code', radius: 0, location: salon });
assert.equal(libre.located, false, 'Sin radio no se guarda la ubicación del docente');
assert.equal((await call('beto', '/api/attendance/checkin/code', { code: libre.code, device: 'tel-beto-0001', location: lejos }, 200, '189.203.4.5')).review, false);
checks += 2;

// ---- El registro con QR sigue igual y no acepta el código escrito ----
const quinta = (await call('docente', '/api/attendance/session', { course: c, date: '2026-10-14' }, 201)).id;
const qr = await call('docente', '/api/attendance/checkin/open', { course: c, session: quinta, minutes: 10 });
assert.equal(qr.mode, 'qr');
assert.match(qr.pin, /^\d{4}$/);
// El código del QR es aleatorio (puede tener - y _): para probar solo el modo, se le da la forma de un código de
// pizarrón. Aun así, escrito a mano no se acepta, porque la sesión es de QR.
store.raw().prepare("UPDATE aula_sessions SET checkin_code='QRQRQR' WHERE id=?").run(quinta);
await call('ana', '/api/attendance/checkin/code', { code: 'qrqrqr', device: 'tel-ana-0001' }, 404);
checks += 2;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones de asistencia con código — ubicación del salón sin guardar coordenadas, red como indicio, registros por revisar, modo estricto, cambio de código y QR intacto.`);
