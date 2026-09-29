// Pruebas del banco de preguntas (12.17): guardar sin duplicar, compartir solo con la propia academia, usar preguntas
// de un colega en otro curso (con su imagen, sin copiar el archivo en R2), editar o borrar sin tocar evaluaciones
// hechas; preguntas al azar por grupo (cada alumno recibe otras) y el alumno no recibe preguntas antes de contestarlas.
// También que la limpieza de archivos huérfanos respete las imágenes de preguntas.
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { quizInstance } from '../src/server/quizzes.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
let checks = 0;
const sessions = {};
async function raw(who, path, { data, headers = {}, body } = {}) {
  sessions[who] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who }), env);
  const before = store.counter.queries;
  const res = await api(
    new Request('https://t.local' + path, {
      method: data === undefined && body === undefined ? 'GET' : 'POST',
      headers: { cookie: sessions[who], Origin: 'https://t.local', 'X-Aula-Request': '1', ...headers },
      body: body ?? (data === undefined ? undefined : JSON.stringify(data)),
    }),
    env,
  );
  assert(store.counter.queries - before <= 50, `${path}: ${store.counter.queries - before} consultas`);
  return res;
}
async function call(who, path, data, status = 200) {
  const res = await raw(who, path, { data });
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${who}) → ${text}`);
  checks++;
  return JSON.parse(text);
}
const upload = async (who, course, name) => {
  const res = await raw(who, `/api/upload?course=${course}&scope=material`, { body: '%PNG imagen ' + name, headers: { 'x-file-name': name, 'content-type': 'image/png' } });
  assert.equal(res.status, 201);
  return (await res.json()).id;
};
const sql = (query, ...params) => store.raw().prepare(query).all(...params);

// ---- Docentes en dos academias (y uno sin academia), cursos y alumnos ----
await call('admin', '/api/me');
const fisica = (await call('admin', '/api/catalog', { kind: 'academy', name: 'Física' }, 201)).id;
const quimica = (await call('admin', '/api/catalog', { kind: 'academy', name: 'Química' }, 201)).id;
const prepa = (await call('admin', '/api/catalog', { kind: 'unit', name: 'Preparatoria A' }, 201)).id;
for (const [who, academy] of [['ana', fisica], ['beto', fisica], ['carla', quimica], ['dani', null]]) {
  await call('admin', '/api/teachers', { email: who + '@example.test', name: who.toUpperCase(), role: 'teacher' });
  if (academy) await call(who, '/api/profile/classification', { academy, unit: prepa });
}
const curso = async (who, name) => (await call(who, '/api/courses', { name, group: '501' }, 201)).id;
const anaViejo = await curso('ana', 'Física I (2025)');
const anaNuevo = await curso('ana', 'Física I (2026)');
const betoCurso = await curso('beto', 'Física II');
const alumnos = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'];
for (const c of [anaNuevo, betoCurso]) await call(c === anaNuevo ? 'ana' : 'beto', '/api/members/bulk', { course: c, students: alumnos.map((n) => ({ name: n, email: n + '@example.test' })) });
const plano = await upload('ana', anaViejo, 'plano.png');
const deBeto = await upload('beto', betoCurso, 'otra.png');

const preguntas = [
  { type: 'choice', text: 'Observa el plano. ¿Qué fuerza falta?', options: ['Normal', 'Peso', 'Fricción'], correct: 2, image: plano },
  { type: 'choice', text: 'Unidad de fuerza', options: ['J', 'N'], correct: 1 },
  { type: 'numeric', text: 'Cae desde {h} m. ¿Tiempo?', answer: 'sqrt(2*h/g)', tolerance: 2, unit: 's', variables: [{ name: 'h', min: 5, max: 20, decimals: 0 }] },
];

// ---- Guardar en el banco ----
await call('e1', '/api/bank', undefined, 403); // solo docentes
await call('beto', '/api/bank', { course: anaViejo, topic: 'Cinemática', questions: preguntas }, 403); // curso ajeno
await call('ana', '/api/bank', { course: anaViejo, topic: 'Cinemática', questions: [{ ...preguntas[1], image: deBeto }] }, 400); // imagen de otro curso
await call('ana', '/api/bank', { course: anaViejo, topic: 'Cinemática', questions: [{ type: 'choice', text: 'Sin opciones', options: ['a'], correct: 0 }] }, 400);
let r = await call('ana', '/api/bank', { course: anaViejo, topic: '  Cinemática ', questions: preguntas }, 201);
assert.deepEqual([r.saved, r.repeated], [3, 0]);
// La misma pregunta no se guarda dos veces (aunque cambie el grupo o venga desde otra evaluación).
r = await call('ana', '/api/bank', { course: anaViejo, topic: 'Otro tema', questions: [{ ...preguntas[1], pool: 'X' }, preguntas[1]] }, 201);
assert.deepEqual([r.saved, r.repeated], [0, 2]);
let mias = (await call('ana', '/api/bank')).questions;
assert.equal(mias.length, 3);
assert(mias.every((q) => q.topic === 'Cinemática' && q.mine && !q.shared && !('pool' in q.question)));
assert.equal(mias.find((q) => q.question.image).question.image, plano);
checks += 3;

// ---- Compartir: solo docentes de la misma academia ----
assert.equal((await call('beto', '/api/bank?scope=shared')).questions.length, 0, 'Sin compartir no se ve');
assert.equal((await call('ana', '/api/bank/topic', { topic: 'Cinemática', shared: true })).changed, 3);
const compartidas = (await call('beto', '/api/bank?scope=shared')).questions;
assert.equal(compartidas.length, 3);
assert(compartidas.every((q) => !q.mine && q.owner === 'ANA' && q.shared));
assert.equal((await call('carla', '/api/bank?scope=shared')).questions.length, 0, 'Otra academia no las ve');
const sinAcademia = await call('dani', '/api/bank?scope=shared');
assert.deepEqual([sinAcademia.questions.length, sinAcademia.hasAcademy], [0, false]);
assert.equal((await call('ana', '/api/bank?scope=shared')).questions.length, 0, 'Las propias no salen como compartidas');
checks += 5;
// Nadie más cambia ni borra las preguntas de ana.
const conImagen = mias.find((q) => q.question.image);
await call('beto', '/api/bank/update', { id: conImagen.id, topic: 'Mío' }, 404);
assert.equal((await call('beto', '/api/bank/delete', { ids: [conImagen.id] })).deleted, 0);
assert.equal((await call('beto', '/api/bank/topic', { topic: 'Cinemática', shared: false })).changed, 0);
checks += 2;

// La imagen de una pregunta compartida se ve desde el banco (bank=1), pero no fuera de él ni desde otra academia.
assert.equal((await raw('beto', `/api/file/${plano}?bank=1`)).status, 200);
assert.equal((await raw('beto', `/api/file/${plano}`)).status, 403);
assert.equal((await raw('carla', `/api/file/${plano}?bank=1`)).status, 403);
assert.equal((await raw('e1', `/api/file/${plano}?bank=1`)).status, 403);
checks += 4;

// ---- Usar preguntas de un colega en otro curso ----
await call('carla', '/api/bank/use', { course: betoCurso, ids: [conImagen.id] }, 403);
await call('beto', '/api/bank/use', { course: betoCurso, ids: ['no-existe'] }, 404);
const idsBeto = compartidas.filter((q) => q.question.type === 'choice').map((q) => q.id);
const usadas = await call('beto', '/api/bank/use', { course: betoCurso, ids: idsBeto });
assert.equal(usadas.questions.length, 2);
assert(usadas.questions.every((q) => q.pool === 'Cinemática' && !('id' in q)));
const copia = usadas.questions.find((q) => q.image).image;
assert.notEqual(copia, plano, 'La imagen llega como archivo de este curso');
const fila = sql('SELECT course, r2_key FROM aula_files WHERE id=?', copia)[0];
assert.deepEqual([fila.course, fila.r2_key], [betoCurso, plano], 'Comparte el objeto de R2 (no ocupa espacio extra)');
// Agregarla otra vez reutiliza el mismo archivo.
assert.equal((await call('beto', '/api/bank/use', { course: betoCurso, ids: [conImagen.id] })).questions[0].image, copia);
assert.equal(sql('SELECT count(*) AS n FROM aula_files WHERE course=?', betoCurso)[0].n, 2);
checks += 5;
const quizBeto = await call('beto', '/api/record', { course: betoCurso, kind: 'quiz', data: { title: 'Parcial', visible: true, questions: usadas.questions, settings: { attempts: 1 } } }, 201);
await call('e1', '/api/attempt/start', { course: betoCurso, quiz: quizBeto.id });
const descarga = await raw('e1', `/api/file/${copia}`);
assert.equal(descarga.status, 200);
assert.equal(await descarga.text(), '%PNG imagen plano.png', 'El alumno ve la imagen original');
// En su propio curso, ana reutiliza el archivo que ya tiene (sin copia).
const propias = await call('ana', '/api/bank/use', { course: anaViejo, ids: [conImagen.id] });
assert.equal(propias.questions[0].image, plano);
checks += 3;

// ---- Editar o borrar en el banco no cambia las evaluaciones ya hechas ----
await call('ana', '/api/bank/update', { id: conImagen.id, course: anaNuevo, question: { ...conImagen.question, text: 'Texto nuevo', image: deBeto } }, 400);
await call('ana', '/api/bank/update', { id: conImagen.id, course: anaNuevo, question: { ...conImagen.question, text: 'Texto nuevo' } });
assert.equal((await call('ana', '/api/bank/topic', { topic: 'Cinemática', rename: 'Movimiento' })).changed, 3);
mias = (await call('ana', '/api/bank')).questions;
assert(mias.every((q) => q.topic === 'Movimiento' && q.shared));
assert.equal(mias.find((q) => q.id === conImagen.id).question.text, 'Texto nuevo');
assert.equal(mias.find((q) => q.id === conImagen.id).question.image, plano, 'Conserva la imagen aunque sea de otro curso');
assert.equal((await call('ana', '/api/bank/delete', { ids: mias.map((q) => q.id) })).deleted, 3);
const intacta = (await call('beto', '/api/course?id=' + betoCurso)).records.find((x) => x.id === quizBeto.id);
assert.equal(intacta.data.questions[0].text, 'Observa el plano. ¿Qué fuerza falta?');
checks += 4;

// ---- Preguntas al azar por grupo ----
const q = (text, correct, pool) => ({ type: 'choice', text, options: ['a', 'b', 'c'], correct, ...(pool ? { pool } : {}) });
const banco = [q('A1', 0, 'A'), q('A2', 1, 'A'), q('Fija 1', 2), q('A3', 2, 'A'), q('A4', 0, 'A'), q('Fija 2', 1)];
const crear = (settings, status = 201) => call('ana', '/api/record', { course: anaNuevo, kind: 'quiz', data: { title: 'Sorteo', visible: true, questions: banco, settings: { attempts: 2, ...settings } } }, status);
await crear({ draw: [{ pool: 'A', count: 0 }] }, 400);
await crear({ draw: [{ pool: 'Z', count: 1 }] }, 400);
assert.equal((await crear({ draw: [{ pool: 'A', count: 4 }] })).data.settings.draw, undefined, 'Tomar todas no es sorteo');
const sorteo = await crear({ draw: [{ pool: 'A', count: 2 }] });
assert.deepEqual(sorteo.data.settings.draw, [{ pool: 'A', count: 2 }]);
checks += 2;
// Cada alumno recibe las dos fijas y 2 de las 4 del grupo; no todos las mismas.
const subsets = new Set();
for (let n = 0; n < 40; n++) {
  const inst = quizInstance(sorteo, 'u' + n, 1);
  assert.equal(inst.length, 4);
  assert(inst.some((x) => x.index === 2) && inst.some((x) => x.index === 5));
  subsets.add(inst.filter((x) => ![2, 5].includes(x.index)).map((x) => x.index).sort().join(','));
}
assert(subsets.size >= 4, `Grupos sorteados distintos: ${subsets.size}`);
checks += 2;
// El alumno: antes de empezar solo sabe cuántas le tocan; al empezar recibe 4; contesta bien → 10 con 4 de 4.
const antes = (await call('e1', '/api/course?id=' + anaNuevo)).records.find((x) => x.id === sorteo.id).data;
assert.deepEqual([antes.questionCount, antes.questions.every((x) => x === null)], [4, true]);
const inicio = await call('e1', '/api/attempt/start', { course: anaNuevo, quiz: sorteo.id });
assert.equal(inicio.questions.length, 4);
const correctas = Object.fromEntries(inicio.questions.map((x) => [x.index, banco[x.index].correct]));
const enviado = await call('e1', '/api/attempt', { course: anaNuevo, quiz: sorteo.id, answers: correctas }, 201);
assert.deepEqual([enviado.data.score, enviado.data.correct, enviado.data.total], [10, 4, 4]);
// Después ve el texto de las 4 que le tocaron, y null en las otras 2.
const despues = (await call('e1', '/api/course?id=' + anaNuevo)).records.find((x) => x.id === sorteo.id).data.questions;
assert.deepEqual(
  despues.map((x) => x?.text ?? null).filter(Boolean).sort(),
  inicio.questions.map((x) => banco[x.index].text).sort(),
);
assert(despues.every((x) => x === null || !('correct' in x)));
checks += 4;
// Con intentos, no se cambia cuántas se sortean ni los grupos.
const cambio = (data) => call('ana', '/api/record', { course: anaNuevo, kind: 'quiz', id: sorteo.id, revision: sorteo.revision, data: { ...sorteo.data, ...data } }, 400);
assert.match((await cambio({ settings: { ...sorteo.data.settings, draw: [{ pool: 'A', count: 3 }] } })).error, /preguntas al azar/);
assert.match((await cambio({ questions: banco.map((x) => ({ ...x, pool: 'B' })), settings: { ...sorteo.data.settings, draw: [{ pool: 'B', count: 2 }] } })).error, /cambiar preguntas/);
// El docente sí ve todas (con grupo y respuesta).
const delDocente = (await call('ana', '/api/course?id=' + anaNuevo)).records.find((x) => x.id === sorteo.id).data;
assert.deepEqual([delDocente.questions.length, delDocente.questions[0].pool, delDocente.questions[0].correct], [6, 'A', 0]);
checks++;

// ---- Limpieza de archivos: las imágenes de preguntas (evaluación o banco) no son huérfanas ----
const suelto = await upload('ana', anaViejo, 'suelto.png');
const enBanco = await upload('ana', anaViejo, 'banco.png');
await call('ana', '/api/bank', { course: anaViejo, topic: 'Óptica', questions: [{ ...preguntas[1], text: 'Con imagen', image: enBanco }] }, 201);
store.raw().prepare("UPDATE aula_files SET created='2020-01-01T00:00:00.000Z'").run();
const huerfanos = (await call('admin', '/api/storage/orphans')).files.map((f) => f.id);
assert(huerfanos.includes(suelto), 'Un archivo sin usar sí es huérfano');
assert(!huerfanos.includes(copia), 'Imagen de una pregunta de evaluación');
assert(!huerfanos.includes(enBanco), 'Imagen de una pregunta del banco');
checks += 3;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones del banco de preguntas — guardar sin duplicar, compartir con la academia, usar en otro curso con su imagen, editar y borrar sin tocar evaluaciones, preguntas al azar por grupo, preguntas ocultas antes de contestar e imágenes que no son huérfanas.`);
