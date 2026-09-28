// Pruebas del respaldo de archivos (R2): solo la administración; una copia por objeto (las copias de curso comparten
// el original); descarga como adjunto; el respaldo en la carpeta es incremental y lleva índice; restaurar solo sube
// lo que falta, nunca reemplaza y exige el tamaño registrado. El código de la pantalla (admin-tools.js) se ejecuta
// contra una carpeta en memoria con la misma interfaz que showDirectoryPicker.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const bucket = memoryBucket();
const env = { DB: store.DB, BUCKET: bucket, AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
let checks = 0;
const cookies = {};
async function login(user) {
  cookies[user] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user }),
    env,
  );
  return cookies[user];
}
async function raw(user, path, { method = 'GET', body, headers = {} } = {}) {
  const before = store.counter.queries;
  const res = await api(
    new Request('https://t.local' + path, {
      method,
      headers: { cookie: await login(user), Origin: 'https://t.local', ...(method === 'GET' ? {} : { 'X-Aula-Request': '1' }), ...headers },
      body,
    }),
    env,
  );
  assert(store.counter.queries - before <= 50, `${path}: ${store.counter.queries - before} consultas`);
  return res;
}
async function call(user, path, data, status = 200) {
  const res = await raw(user, path, data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) });
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${user}) → ${text}`);
  checks++;
  return JSON.parse(text);
}
async function upload(user, course, scope, name, content) {
  const res = await raw(user, `/api/upload?course=${course}&scope=${scope}`, {
    method: 'POST',
    body: content,
    headers: { 'x-file-name': encodeURIComponent(name), 'content-type': 'application/pdf' },
  });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()).id;
}
const bytesOf = async (key) => new Uint8Array(bucket.blobs.get(key));

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física I', group: '501' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: [{ name: 'Ana', email: 'ana@example.test' }] });
await call('ana', '/api/me');
const guia = await upload('docente', c, 'material', 'Guía «1».pdf', '%PDF-1.4 guía de la unidad');
const tarea = await upload('ana', c, 'submission', 'tarea.pdf', '%PDF-1.4 mi tarea resuelta');
const modulo = await call('docente', '/api/record', { course: c, kind: 'module', data: { title: 'Unidad 1', body: '', fileIds: [guia] } }, 201);
assert(modulo.id);
// Una copia del curso comparte el objeto original: no se respalda dos veces.
const copia = (await call('docente', '/api/course/copy', { course: c, name: 'Física I', group: '502' }, 201)).id;
assert.equal(store.raw().prepare('SELECT count(*) AS n FROM aula_files WHERE r2_key IS NOT NULL').get().n, 1);
checks++;

// ---- Solo la administración ----
await call('docente', '/api/backup/files', undefined, 403);
await call('ana', '/api/backup/files', undefined, 403);
assert.equal((await raw('docente', '/api/backup/object?key=' + guia)).status, 403);
await call('docente', '/api/backup/missing', { keys: [guia] }, 403);
assert.equal((await raw('ana', '/api/backup/restore?key=' + tarea, { method: 'POST', body: 'x' })).status, 403);
checks += 2;

// ---- Lista: un renglón por objeto, con nombre y curso ----
let list = await call('admin', '/api/backup/files');
assert.deepEqual(list.files.map((f) => f.key).sort(), [guia, tarea].sort());
assert.equal(list.next, null);
const filaGuia = list.files.find((f) => f.key === guia);
assert.deepEqual([filaGuia.name, filaGuia.course_name, filaGuia.scope, filaGuia.size], ['Guía «1».pdf', 'Física I', 'material', 27]);
assert.equal(filaGuia.course, c, 'Se describe con el curso original, no con la copia');
assert.notEqual(filaGuia.course, copia);
checks += 4;

// ---- Descarga: siempre como adjunto, sin interpretarse ----
let res = await raw('admin', '/api/backup/object?key=' + guia);
assert.equal(res.status, 200);
assert.equal(res.headers.get('content-type'), 'application/octet-stream');
assert.match(res.headers.get('content-disposition'), /^attachment/);
assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
assert.deepEqual(new Uint8Array(await res.arrayBuffer()), await bytesOf(guia));
assert.equal((await raw('admin', '/api/backup/object?key=no-existe')).status, 404);
assert.equal((await raw('admin', '/api/backup/object?key=' + encodeURIComponent('../x'))).status, 400);
checks += 7;

// ---- Faltantes: por lotes de 40 como máximo ----
assert.deepEqual((await call('admin', '/api/backup/missing', { keys: [guia, tarea] })).missing, []);
await call('admin', '/api/backup/missing', { keys: Array.from({ length: 41 }, (_, i) => 'k' + i) }, 400);
await call('admin', '/api/backup/missing', { keys: ['a/b'] }, 400);

// ---- Restaurar: nunca reemplaza, solo lo registrado, con el tamaño exacto ----
const original = await bytesOf(tarea);
res = await raw('admin', '/api/backup/restore?key=' + tarea, { method: 'POST', body: 'otro contenido' });
assert.equal(res.status, 409, 'Un archivo que existe no se reemplaza');
assert.deepEqual(await bytesOf(tarea), original);
res = await raw('admin', '/api/backup/restore?key=' + crypto.randomUUID(), { method: 'POST', body: 'x' });
assert.equal(res.status, 404, 'Por aquí no se suben archivos nuevos');
bucket.blobs.delete(tarea);
assert.deepEqual((await call('admin', '/api/backup/missing', { keys: [guia, tarea] })).missing, [tarea]);
assert.equal((await raw('admin', '/api/backup/object?key=' + tarea)).status, 410);
res = await raw('admin', '/api/backup/restore?key=' + tarea, { method: 'POST', body: 'demasiado corto' });
assert.equal(res.status, 400);
assert.match((await res.json()).error, /no coincide/);
res = await raw('admin', '/api/backup/restore?key=' + tarea, { method: 'POST', body: 'y'.repeat(original.length + 5) });
assert.equal(res.status, 400, 'Más largo que lo registrado');
assert(!bucket.blobs.has(tarea));
res = await raw('admin', '/api/backup/restore?key=' + tarea, { method: 'POST', body: original });
assert.equal(res.status, 201);
assert.deepEqual(await bytesOf(tarea), original);
// La alumna vuelve a descargar su entrega por la ruta normal.
assert.equal((await raw('ana', '/api/file/' + tarea)).status, 200);
checks += 11;

// ---- Pantalla: respaldo incremental en una carpeta y restauración desde ella ----
function memoryDir() {
  const entries = new Map();
  const handle = {
    entries,
    async getDirectoryHandle(name, { create = false } = {}) {
      if (!entries.has(name)) {
        if (!create) throw Object.assign(new Error('No existe'), { name: 'NotFoundError' });
        entries.set(name, memoryDir());
      }
      return entries.get(name);
    },
    async getFileHandle(name, { create = false } = {}) {
      if (!entries.has(name)) {
        if (!create) throw Object.assign(new Error('No existe'), { name: 'NotFoundError' });
        entries.set(name, new Blob([]));
      }
      return {
        getFile: async () => entries.get(name),
        createWritable: async () => {
          const chunks = [];
          return { write: async (b) => chunks.push(b), close: async () => entries.set(name, new Blob(chunks)), abort: async () => {} };
        },
      };
    },
  };
  return handle;
}
const context = vm.createContext({
  document: { addEventListener() {} },
  addEventListener() {},
  removeEventListener() {},
  Blob,
  URL,
  encodeURIComponent,
  console,
  request: async (path, data) => {
    const res = await raw('admin', path, data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    return body;
  },
  fetch: async (path, options = {}) => raw('admin', path, { method: options.method || 'GET', body: options.body }),
});
vm.runInContext(readFileSync('src/public/admin-tools.js', 'utf8'), context);
const folder = memoryDir();
const progress = [];
let r = await context.backupFiles(folder, { onProgress: (p) => progress.push(p.done) });
assert.deepEqual([r.total, r.saved, r.kept, r.missing.length, r.failed.length], [2, 2, 0, 0, 0]);
const archivos = folder.entries.get('archivos').entries;
assert.deepEqual(new Uint8Array(await archivos.get(guia).arrayBuffer()), await bytesOf(guia));
const indice = await folder.entries.get('indice.csv').text();
assert.match(indice, /"archivos\/[0-9a-f-]+","Guía «1»\.pdf","Física I","Material"/);
assert.match(await folder.entries.get('LEEME.txt').text(), /Restaurar archivos que falten/);
assert(progress.length >= 2);
checks += 5;

// Segunda vez: solo lo nuevo.
const nueva = await upload('ana', c, 'submission', 'tarea2.pdf', '%PDF-1.4 segunda tarea');
r = await context.backupFiles(folder);
assert.deepEqual([r.total, r.saved, r.kept], [3, 1, 2]);
// Un archivo a medias en la carpeta (tamaño distinto) se vuelve a descargar.
archivos.set(guia, new Blob(['cortado']));
r = await context.backupFiles(folder);
assert.deepEqual([r.saved, r.kept], [1, 2]);
assert.deepEqual(new Uint8Array(await archivos.get(guia).arrayBuffer()), await bytesOf(guia));
// Registrado en Enlace pero perdido en R2 (y sin copia): se informa, no rompe el respaldo.
const perdida = await upload('ana', c, 'submission', 'perdida.pdf', '%PDF-1.4 se perderá');
bucket.blobs.delete(perdida);
r = await context.backupFiles(folder);
assert.deepEqual([...r.missing.map((f) => f.key)], [perdida]);
assert.match(await folder.entries.get('indice.csv').text(), /"perdida\.pdf","Física I","Entrega","\d+","[^"]+","Falta en Enlace"/);
checks += 5;

// Se pierde el almacenamiento: se restaura todo lo que hay en la carpeta.
const antes = new Map([...bucket.blobs].map(([k, v]) => [k, new Uint8Array(v)]));
bucket.blobs.clear();
r = await context.restoreFiles(folder);
assert.deepEqual([r.total, r.missing, r.restored, r.failed.length], [4, 4, 3, 0]);
assert.deepEqual([...r.unavailable.map((f) => f.key)], [perdida], 'El que nunca se respaldó se informa');
for (const [key, bytes] of antes) assert.deepEqual(new Uint8Array(bucket.blobs.get(key)), bytes);
// Otra vez: ya no falta nada (salvo el perdido) y no se sube nada.
r = await context.restoreFiles(folder);
assert.deepEqual([r.missing, r.restored], [1, 0]);
// Una carpeta que no es un respaldo.
await assert.rejects(context.restoreFiles(memoryDir()), /no es un respaldo de Enlace/);
assert(nueva);
checks += 5;

// ---- Paginación: más de 1000 archivos ----
const insert = store.raw().prepare("INSERT INTO aula_files (id,course,owner,scope,name,size,mime,created) VALUES (?,?,?,'material',?,1,'text/plain','2026-01-01')");
for (let i = 0; i < 1005; i++) insert.run(`p${String(i).padStart(5, '0')}`, c, 'x', `f${i}.txt`);
list = await call('admin', '/api/backup/files');
assert.equal(list.files.length, 1000);
const segunda = await call('admin', '/api/backup/files?after=' + list.next);
assert.equal(list.files.length + segunda.files.length, 1009);
assert.equal(segunda.next, null);
assert.equal(new Set([...list.files, ...segunda.files].map((f) => f.key)).size, 1009);
checks += 4;

console.log(`PASS: ${checks} verificaciones del respaldo de archivos — solo administración, un objeto por archivo, descarga segura, respaldo incremental con índice, restauración sin reemplazar y con tamaño exacto, paginación.`);
