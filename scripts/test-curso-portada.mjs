// Pruebas de la 12.25: renombrar el curso y elegir su color, portada propia (subir, ver, quitar) y corregir los datos
// de un alumno inscrito (nombre, matrícula, correo con re-vinculación a su cuenta y sección).
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const bucket = memoryBucket();
const env = { DB: store.DB, BUCKET: bucket, AULA_OWNER_EMAIL: 'docente@example.test', SESSION_SECRET: 'p'.repeat(40) };
let checks = 0;
const cookies = {};
async function send(user, path, init = {}) {
  cookies[user] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user }),
    env,
  );
  return api(new Request('https://t.local' + path, { ...init, headers: { cookie: cookies[user], Origin: 'https://t.local', 'X-Aula-Request': '1', ...init.headers } }), env);
}
async function call(user, path, data, status = 200, method = data === undefined ? 'GET' : 'POST') {
  const res = await send(user, path, { method, body: data === undefined ? undefined : JSON.stringify(data) });
  const text = await res.text();
  assert.equal(res.status, status, `${method} ${path} (${user}) → ${text}`);
  checks++;
  return JSON.parse(text);
}

await call('docente', '/api/me');
const c = (await call('docente', '/api/courses', { name: 'Optativas', group: '501', theme: 4 }, 201)).id;
await call('docente', '/api/courses', { name: 'x', group: 'y', theme: 9 }, 400);
await call('docente', '/api/members/bulk', { course: c, students: [{ name: 'Ana Peres', email: 'ana.mal@example.test', matricula: '2024' }, { name: 'Luis', email: 'luis@example.test' }] });
await call('luis', '/api/me');
await call('ana', '/api/me'); // Ana tiene cuenta con ana@example.test, pero la inscribieron con un correo equivocado.

// ---- Renombrar y color ----
let lista = await call('docente', '/api/courses');
assert.equal(lista.find((x) => x.id === c).theme, 4);
await call('luis', '/api/course', { course: c, name: 'Hack', group: '1' }, 403);
await call('docente', '/api/course', { course: c, name: 'Temas Selectos de Química', group: '501', period: 'Otoño 2026', theme: 2 });
await call('docente', '/api/course', { course: c, name: 'Temas Selectos de Química', group: '501', theme: -1 }, 400);
lista = await call('luis', '/api/courses');
assert.deepEqual([lista[0].name, lista[0].period, lista[0].theme], ['Temas Selectos de Química', 'Otoño 2026', 2]);
// Sin `theme`, el color se conserva.
await call('docente', '/api/course', { course: c, name: 'Temas Selectos de Química', group: '501' });
assert.equal((await call('docente', '/api/course?id=' + c)).course.theme, 2);
checks += 3;

// ---- Portada ----
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(200).fill(7)]);
const upload = (user, body, status) =>
  send(user, `/api/course/cover?course=${c}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body }).then(async (r) => {
    assert.equal(r.status, status, await r.clone().text());
    checks++;
    return r.json();
  });
await upload('luis', png, 403);
await upload('docente', new TextEncoder().encode('<svg onload=alert(1)>'), 400);
await upload('docente', new Uint8Array(1.6 * 1024 * 1024).fill(1), 413);
const subida = await upload('docente', png, 201);
const curso = (await call('luis', '/api/course?id=' + c)).course;
assert.equal(curso.cover_updated, subida.cover_updated);
assert.equal('cover' in curso, false, 'La llave de R2 no sale en la respuesta');
assert.equal('cover' in (await call('luis', '/api/courses'))[0], false);
// La ven quienes están en el curso; nadie más.
const ver = (user) => send(user, '/api/course-cover/' + c);
let r = await ver('luis');
assert.equal(r.status, 200);
assert.equal(r.headers.get('content-type'), 'image/png');
assert.deepEqual(new Uint8Array(await r.arrayBuffer()).slice(0, 4), png.slice(0, 4));
assert.equal((await ver('extrano')).status, 403);
checks += 5;
// Reemplazar borra la anterior de R2; quitar la borra también.
const antes = [...bucket.blobs.keys()].filter((k) => k.startsWith('portadas/'));
await upload('docente', png, 201);
const despues = [...bucket.blobs.keys()].filter((k) => k.startsWith('portadas/'));
if (bucket.blobs) {
  assert.equal(despues.length, 1);
  assert.notEqual(despues[0], antes[0]);
  checks++;
}
await call('docente', '/api/course/cover/delete', { course: c });
assert.equal((await call('luis', '/api/course?id=' + c)).course.cover_updated, null);
assert.equal((await ver('luis')).status, 404);
checks += 2;
// Copiar el curso conserva el color, no la portada.
await upload('docente', png, 201);
const copia = await call('docente', '/api/course/copy', { course: c, name: 'Física para Ingenierías', group: '501' }, 201);
const copiado = (await call('docente', '/api/course?id=' + copia.id)).course;
assert.deepEqual([copiado.theme, copiado.cover_updated], [2, null]);
checks++;

// ---- Corregir datos de un alumno ----
const miembros = (await call('docente', '/api/course?id=' + c)).members;
const ana = miembros.find((m) => m.email === 'ana.mal@example.test');
const luis = miembros.find((m) => m.email === 'luis@example.test');
assert.equal(ana.user_id, null);
await call('luis', '/api/member/update', { course: c, id: ana.id, name: 'X', email: 'x@example.test' }, 403);
await call('docente', '/api/member/update', { course: c, id: ana.id, name: 'Ana', email: 'no-es-correo' }, 400);
await call('docente', '/api/member/update', { course: c, id: ana.id, name: 'Ana', email: 'luis@example.test' }, 409);
await call('docente', '/api/member/update', { course: c, id: 'otro', name: 'Ana', email: 'a@example.test' }, 404);
const corregida = await call('docente', '/api/member/update', { course: c, id: ana.id, name: 'Ana Pérez', matricula: '202401181', email: 'ana@example.test' });
// Con el correo correcto queda ligada a la cuenta que ya existía: ahora ve el curso.
assert.deepEqual([corregida.name, corregida.matricula, corregida.email, Boolean(corregida.user_id)], ['Ana Pérez', '202401181', 'ana@example.test', true]);
assert((await call('ana', '/api/courses')).some((x) => x.id === c));
// Cambiar solo el nombre no toca la vinculación.
const soloNombre = await call('docente', '/api/member/update', { course: c, id: luis.id, name: 'Luis Hernández', email: 'luis@example.test' });
assert.equal(soloNombre.user_id, luis.user_id);
// Con secciones: se valida la sección.
const seccion = (await call('docente', '/api/sections', { course: c, name: 'A' }, 201)).id;
await call('docente', '/api/member/update', { course: c, id: luis.id, name: 'Luis Hernández', email: 'luis@example.test', section: 'nada' }, 404);
assert.equal((await call('docente', '/api/member/update', { course: c, id: luis.id, name: 'Luis Hernández', email: 'luis@example.test', section: seccion })).section, seccion);
checks += 4;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones de la 12.25 — renombrar el curso y su color, portada (solo imágenes reales, la ve solo el curso), y corregir nombre, matrícula, correo y sección de un alumno.`);
