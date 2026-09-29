// Pruebas de la foto de perfil (12.18): cada quien sube la suya (solo JPG, PNG o WEBP reales y pequeñas); la ven la
// persona, la administración y quien comparte un curso con ella si alguna de las dos enseña (no los compañeros);
// el docente puede quitar la de un alumno de su curso, y al cambiarla se borra la anterior de R2.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const bucket = memoryBucket();
const env = { DB: store.DB, BUCKET: bucket, AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40), FOTO_OBLIGATORIA: '1' };
let checks = 0;
const cookies = {};
const ids = {};
async function raw(who, path, { data, body, headers = {} } = {}) {
  if (!cookies[who]) {
    const login = await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who });
    cookies[who] = await sessionCookieForTests(login, env);
  }
  return api(
    new Request('https://t.local' + path, {
      method: data === undefined && body === undefined ? 'GET' : 'POST',
      headers: { cookie: cookies[who], Origin: 'https://t.local', 'X-Aula-Request': '1', ...headers },
      body: body ?? (data === undefined ? undefined : JSON.stringify(data)),
    }),
    env,
  );
}
async function call(who, path, data, status = 200) {
  const res = await raw(who, path, { data });
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${who}) → ${text}`);
  checks++;
  return JSON.parse(text);
}
const jpeg = (n = 200) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(n).fill(7)]);
const upload = (who, bytes, status = 201) =>
  raw(who, '/api/profile/photo', { body: bytes, headers: { 'content-type': 'image/jpeg' } }).then(async (r) => {
    assert.equal(r.status, status, await r.clone().text());
    checks++;
    return r.json();
  });
const photo = (who, owner) => raw(who, '/api/photo/' + ids[owner]).then((r) => r.status);

for (const who of ['admin', 'ana', 'beto', 'carla']) ids[who] = (await call(who, '/api/me')).id;
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
ids.docente = (await call('docente', '/api/me')).id;
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '5AV' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: [{ name: 'Ana', email: 'ana@example.test' }, { name: 'Beto', email: 'beto@example.test' }] });

// ---- Obligatoria para los alumnos: sin foto solo pueden tomársela ----
const sinFoto = await call('beto', '/api/me');
assert.equal(sinFoto.needsPhoto, true);
assert.equal((await call('docente', '/api/me')).needsPhoto, false, 'Al docente no se le exige');
await call('docente', '/api/courses');
const bloqueado = await call('beto', '/api/courses', undefined, 428);
assert.equal(bloqueado.needsPhoto, true);
await call('beto', '/api/course?id=' + c, undefined, 428);
await call('beto', '/api/privacy/accept', {});
await upload('beto', jpeg(80));
assert.equal((await call('beto', '/api/me')).needsPhoto, false);
await call('beto', '/api/courses');
await upload('carla', jpeg(90));
checks += 3;

// ---- Subir: solo imágenes reales y pequeñas ----
await upload('ana', new TextEncoder().encode('<svg onload=alert(1)>'), 400);
await upload('ana', new Uint8Array(500 * 1024).fill(255), 413);
const primera = await upload('ana', jpeg());
assert.equal((await call('ana', '/api/me')).photo, primera.photo);
const llavePrimera = [...bucket.blobs.keys()].find((k) => k.startsWith(`perfil/${ids.ana}/`));
assert(llavePrimera?.endsWith('.jpg'));

// ---- Quién la ve ----
assert.equal(await photo('ana', 'ana'), 200);
assert.equal(await photo('docente', 'ana'), 200, 'Su docente');
assert.equal(await photo('admin', 'ana'), 200);
assert.equal(await photo('beto', 'ana'), 404, 'Un compañero no');
assert.equal(await photo('carla', 'ana'), 404, 'Alguien de fuera no');
const res = await raw('docente', '/api/photo/' + ids.ana);
assert.equal(res.headers.get('content-type'), 'image/jpeg');
assert.match(res.headers.get('cache-control'), /private/);
await upload('docente', jpeg(50));
assert.equal(await photo('ana', 'docente'), 200, 'El alumno ve a su docente');
checks += 8;
// En el curso: el docente recibe la fecha de la foto de cada alumno; el alumno, la suya y la del docente.
const delDocente = await call('docente', '/api/course?id=' + c);
assert.equal(delDocente.members.find((m) => m.email === 'ana@example.test').photo, primera.photo);
const deBeto = await call('beto', '/api/course?id=' + c);
assert(!deBeto.members.find((m) => m.name === 'Ana').photo, 'Beto no recibe la de Ana');
checks += 2;

// ---- Cambiarla borra la anterior; el docente puede quitar la de su alumno ----
const segunda = await upload('ana', jpeg(300));
assert.notEqual(segunda.photo, primera.photo);
assert.equal(await bucket.get(llavePrimera), null, 'La foto anterior se borró de R2');
await call('beto', '/api/profile/photo/delete', { user: ids.ana, course: c }, 403);
await call('docente', '/api/profile/photo/delete', { user: ids.carla, course: c }, 404);
await call('docente', '/api/profile/photo/delete', { user: ids.ana, course: c });
assert.equal(await photo('docente', 'ana'), 404, 'Ya no hay foto');
assert.equal((await call('ana', '/api/me')).photo, null);
// Sin foto otra vez: al volver a entrar se le pide tomarse otra.
assert.equal((await call('ana', '/api/me')).needsPhoto, true);
await call('ana', '/api/courses', undefined, 428);
checks += 3;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones de la foto de perfil — solo imágenes reales y pequeñas, la ven la persona, sus docentes y la administración (no los compañeros), cambiarla borra la anterior y el docente puede quitarla.`);
