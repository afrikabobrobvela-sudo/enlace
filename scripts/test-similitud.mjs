// Detector de similitud (12.82): solo quien enseña activa la revisión de una actividad, el alumno recibe el aviso, y el
// motor del navegador (similitud.js) detecta copia literal, reescrituras y evasiones sin marcar textos distintos.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

let checks = 0;

// ---------- Servidor ----------
const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
const cookies = {};
async function call(who, path, data, status = 200, method = data === undefined ? 'GET' : 'POST') {
  cookies[who] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + who, email: who + '@example.test', name: who[0].toUpperCase() + who.slice(1) }), env);
  const res = await api(
    new Request('https://t.local' + path, {
      method,
      headers: { cookie: cookies[who], Origin: 'https://t.local', 'X-Aula-Request': '1' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${who}) → ${text}`);
  checks++;
  return JSON.parse(text);
}

await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const c = (await call('docente', '/api/courses', { name: 'Física', group: 'A' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: [{ name: 'Ana', email: 'ana@example.test' }] });
const task = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Reporte', body: 'Describe el experimento.', visible: true } }, 201);
const taskOf = async (who) => (await call(who, '/api/course?id=' + c)).records.find((r) => r.kind === 'task' && r.id === task.id);
assert.equal((await taskOf('docente')).data.similarity, false, 'Por omisión no se revisa');
await call('ana', '/api/task/similarity', { course: c, id: task.id, enabled: true }, 403);
assert.deepEqual(await call('docente', '/api/task/similarity', { course: c, id: task.id, enabled: true }), { ok: true, similarity: true });
assert.equal((await taskOf('docente')).data.similarity, true);
assert.equal((await taskOf('ana')).data.similarity, true, 'El alumno sabe que su actividad se revisa');
await call('docente', '/api/task/similarity', { course: c, id: 'no-existe', enabled: true }, 404);
await call('docente', '/api/task/similarity', { course: c, id: task.id, enabled: false });
assert.equal((await taskOf('docente')).data.similarity, false);
// Editar la actividad no apaga la revisión.
await call('docente', '/api/task/similarity', { course: c, id: task.id, enabled: true });
const fresh = await taskOf('docente');
await call('docente', '/api/record', { course: c, kind: 'task', id: task.id, revision: fresh.revision, data: { ...fresh.data, title: 'Reporte 1' } });
assert.equal((await taskOf('docente')).data.similarity, true, 'Guardar la actividad conserva la revisión');
checks += 6;

// Informes guardados (12.84): solo quien enseña los guarda y los lee; solo de entregas de esa actividad.
await call('docente', '/api/members/bulk', { course: c, students: [{ name: 'Beto', email: 'beto@example.test' }] });
const anaSub = await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: task.id, body: 'Mi reporte del péndulo' } }, 201);
const betoSub = await call('beto', '/api/record', { course: c, kind: 'submission', data: { task: task.id, body: 'El reporte de Beto' } }, 201);
const otherTask = await call('docente', '/api/record', { course: c, kind: 'task', data: { title: 'Otra', visible: true } }, 201);
const otherSub = await call('ana', '/api/record', { course: c, kind: 'submission', data: { task: otherTask.id, body: 'Otra entrega' } }, 201);
const course = await call('docente', '/api/course?id=' + c);
const memberOf = (id) => course.records.find((r) => r.id === id).data.member;
const report = (sub, extra = {}) => ({
  submission: sub.id,
  version: 'v1',
  total: 0.42,
  literal: 0.3,
  summary: { sources: [{ submission: betoSub.id, member: memberOf(betoSub.id), pct: 0.42, literal: 0.3, words: 2, blocks: 1 }], notes: ['aviso'], settings: { minRun: 8, quotes: true, bibliography: true, instructions: true, teams: '' }, compared: 1, skipped: 0 },
  data: { v: 1, hash: 'abc.1', words: 4, eligible: 4, excluded: [[3, 4, 'c']], blocks: [[0, 0, 2, 1, 'El reporte']] },
  ...extra,
});
await call('ana', '/api/similarity', { course: c, task: task.id, reports: [report(anaSub)] }, 403);
await call('ana', '/api/similarity?course=' + c + '&task=' + task.id, undefined, 403);
await call('docente', '/api/similarity', { course: c, task: task.id, reports: [report(anaSub, { total: 2 })] }, 400);
await call('docente', '/api/similarity', { course: c, task: task.id, reports: [report(anaSub, { data: { ...report(anaSub).data, blocks: [[5, 0, 2, 1, '']] } })] }, 400);
await call('docente', '/api/similarity', { course: c, task: task.id, reports: [report(anaSub, { data: { ...report(anaSub).data, blocks: [[0, 3, 9, 1, '']] } })] }, 400);
await call('docente', '/api/similarity', { course: c, task: 'no-existe', reports: [] }, 404);
const before = store.counter.queries;
const saved = await call('docente', '/api/similarity', { course: c, task: task.id, reports: [report(anaSub), report(betoSub, { total: 0.1, summary: { ...report(betoSub).summary, sources: [] }, data: { ...report(betoSub).data, blocks: [] } }), report(otherSub)] });
assert.ok(store.counter.queries - before <= 8, `Guardar usa pocas consultas (${store.counter.queries - before})`);
assert.equal(saved.saved, 2, 'La entrega de otra actividad no se guarda');
let list = (await call('docente', '/api/similarity?course=' + c + '&task=' + task.id)).reports;
assert.equal(list.length, 2);
const anaRow = list.find((x) => x.submission === anaSub.id);
assert.equal(anaRow.total, 0.42);
assert.equal(anaRow.member, memberOf(anaSub.id));
assert.equal(anaRow.summary.sources[0].submission, betoSub.id);
assert.equal(anaRow.data, undefined, 'La lista no trae los bloques');
const full = (await call('docente', `/api/similarity/report?course=${c}&submission=${anaSub.id}`)).report;
assert.equal(JSON.stringify(full.data.blocks), JSON.stringify([[0, 0, 2, 1, 'El reporte']]));
await call('ana', `/api/similarity/report?course=${c}&submission=${anaSub.id}`, undefined, 403);
await call('docente', `/api/similarity/report?course=${c}&submission=${otherSub.id}`, undefined, 404);
// Volver a analizar reemplaza el informe.
await call('docente', '/api/similarity', { course: c, task: task.id, reports: [report(anaSub, { version: 'v2', total: 0.05 })] });
list = (await call('docente', '/api/similarity?course=' + c + '&task=' + task.id)).reports;
assert.equal(list.find((x) => x.submission === anaSub.id).total, 0.05);
assert.equal(list.find((x) => x.submission === anaSub.id).version, 'v2');
// Otro docente (de otro curso) no lee ni escribe.
await call('admin', '/api/teachers', { email: 'otro@example.test', name: 'Otro', role: 'teacher' });
await call('otro', '/api/similarity?course=' + c + '&task=' + task.id, undefined, 403);
await call('otro', '/api/similarity', { course: c, task: task.id, reports: [report(anaSub)] }, 403);
checks += 12;

// ---------- Motor (navegador) ----------
const context = vm.createContext({
  document: { addEventListener() {} },
  esc: (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]),
});
vm.runInContext(fs.readFileSync(new URL('../src/public/similitud.js', import.meta.url), 'utf8'), context);
const { simPrepare, simAnalyze, simHighlightHtml, simPairView, simCanon, simPickTeamCategory, simTeamOf, simSkipper, simBuildReports, simReportView, simHash, simVersionOf } = context;
const analyze = async (texts, opts = {}) => {
  const docs = texts.map((t) => simPrepare(t, { minRun: 8, ...opts }));
  return { docs, result: await simAnalyze(docs, { minRun: 8, ...opts }) };
};
const pct = (x) => Math.round(x * 100);

const original =
  'La evaluación formativa permite identificar las dificultades de aprendizaje durante el proceso educativo. Los docentes utilizan la información obtenida para ajustar sus estrategias de enseñanza y apoyar a cada estudiante según sus necesidades particulares.';
const distinto =
  'El péndulo simple oscila con un periodo que depende de la longitud del hilo y de la gravedad local. Medimos diez oscilaciones con un cronómetro y repetimos el experimento cinco veces para reducir el error aleatorio.';

// Copia con mayúsculas, puntuación y espacios cambiados.
let r = await analyze([original, original.toUpperCase().replace(/,/g, ' ;').replace(/ /g, '  '), distinto]);
assert.ok(r.result.docs[0].total > 0.95 && r.result.docs[1].literal > 0.95, 'Copia literal disfrazada: ' + pct(r.result.docs[1].literal));
assert.equal(r.result.docs[2].total, 0, 'Un texto distinto no coincide');
assert.equal(r.result.docs[0].sources[0].doc, 1);
checks += 3;

// Evasiones: caracteres invisibles dentro de palabras y letras cirílicas.
const evasion = original.replace(/evaluación/g, 'eva​luación').replace(/a/g, 'а').replace(/o/g, 'о');
r = await analyze([original, evasion]);
assert.ok(r.result.docs[1].literal > 0.95, 'Evasión detectada: ' + pct(r.result.docs[1].literal));
assert.ok(r.docs[1].obfuscation.invisible >= 1 && r.docs[1].obfuscation.confusable > 20, 'Se cuentan las evasiones');
assert.equal(simCanon('Año'), 'año', 'La ñ se conserva');
assert.notEqual(simCanon('año'), simCanon('ano'));
checks += 4;

// Paráfrasis: sinónimos y otro orden, sin 8 palabras seguidas iguales.
const parafrasis =
  'Durante el proceso educativo, la evaluación formativa posibilita identificar dificultades del aprendizaje. Con la información obtenida, los profesores ajustan sus estrategias de enseñanza para apoyar a cada alumno según sus necesidades particulares.';
r = await analyze([original, parafrasis, distinto]);
assert.ok(r.result.docs[1].total > 0.5, 'Reescritura detectada: ' + pct(r.result.docs[1].total));
assert.ok(r.result.docs[1].literal < r.result.docs[1].total, 'Se distingue de la copia literal');
assert.equal(r.result.docs[2].total, 0);
checks += 3;

// Mismo tema, redacción propia: no se marca.
const propio =
  'Para mí, evaluar durante el curso sirve porque el maestro descubre a tiempo qué temas no quedaron claros. Así cambia las actividades de la clase y cada compañero recibe ayuda en lo que más le cuesta.';
r = await analyze([original, propio]);
assert.ok(r.result.docs[1].total < 0.15, 'Redacción propia sobre el mismo tema: ' + pct(r.result.docs[1].total));
checks++;

// Citas: una cita corta se excluye; un texto entero entre comillas no.
const conCita = `Como señala el autor, "${original.split('. ')[0]}". En mi práctica observé lo mismo con mis compañeros de laboratorio durante todo el semestre pasado.`;
r = await analyze([original, conCita]);
assert.equal(r.result.docs[1].total, 0, 'La cita entre comillas no cuenta');
r = await analyze([original, `"${original}"`]);
assert.ok(r.result.docs[1].literal > 0.95, 'Todo entre comillas no esconde la copia');
assert.match(r.docs[1].notes[0], /entre comillas/);
checks += 3;

// Bibliografía: al final se excluye; un encabezado al inicio no esconde el trabajo.
const biblio = `${distinto}\n\nReferencias\n${original}`;
r = await analyze([original, biblio]);
assert.equal(r.result.docs[1].total, 0, 'La bibliografía final no cuenta');
r = await analyze([original, `Bibliografía\n${original}\n${distinto}`]);
assert.ok(r.result.docs[1].literal > 0.4, 'Un encabezado al inicio no excluye todo');
checks += 2;

// Instrucciones de la actividad: copiar la pregunta no es copia entre alumnos.
const pregunta = 'Explica con tus palabras por qué la evaluación formativa permite identificar las dificultades de aprendizaje durante el proceso educativo.';
r = await analyze([`${pregunta} ${distinto}`, `${pregunta} ${propio}`], { instructions: pregunta });
assert.equal(r.result.docs[0].total, 0, 'Lo copiado de las instrucciones se excluye');
r = await analyze([`${pregunta} ${distinto}`, `${pregunta} ${propio}`]);
assert.ok(r.result.docs[0].literal > 0, 'Sin excluir instrucciones sí coincide');
checks += 2;

// Integrantes del mismo equipo no se comparan.
const docs = [original, original, distinto].map((t) => simPrepare(t, { minRun: 8 }));
const team = await simAnalyze(docs, { minRun: 8, skip: (i, j) => i === 0 && j === 1 });
assert.equal(team.docs[0].total, 0, 'El mismo equipo no cuenta como copia');
checks++;

// Equipos de una actividad individual (12.83): se elige la categoría que agrupa a quienes entregaron.
const groups = [
  { id: 'g1', data: { title: 'Mesa 1', category: 'Laboratorio', members: ['a', 'b'] } },
  { id: 'g2', data: { title: 'Mesa 2', category: 'Laboratorio', members: ['c', 'd'] } },
  { id: 'g3', data: { title: 'Exposición', category: 'Exposiciones', members: ['a', 'x'] } },
];
assert.equal(simPickTeamCategory(groups, ['a', 'b', 'c', 'd']), 'Laboratorio', 'La categoría con más alumnos que entregaron');
assert.equal(simPickTeamCategory(groups, ['a', 'b', 'c', 'd'], 'Exposiciones'), 'Exposiciones', 'La de la actividad por equipo manda');
assert.equal(simPickTeamCategory(groups, ['a', 'z']), '', 'Sin equipos de dos que entregaron, no se aplica');
assert.equal(simPickTeamCategory([], ['a', 'b']), '');
assert.equal(simTeamOf(groups, 'Laboratorio', 'c').data.title, 'Mesa 2');
assert.equal(simTeamOf(groups, '', 'c'), null);

// 12.84: tampoco se comparan dos entregas con el mismo archivo (la entrega del equipo que reciben sus integrantes).
const skipper = simSkipper([{ member: 'a', fileIds: ['f1'] }, { member: 'b', fileIds: ['f9'] }, { member: 'c', fileIds: ['f1'] }, { member: 'x' }], groups, 'Laboratorio');
assert.equal(skipper(0, 1), true, 'Mismo equipo');
assert.equal(skipper(0, 2), true, 'Mismo archivo');
assert.equal(skipper(1, 3), false);
assert.equal(simSkipper([{ member: 'a', fileIds: ['f1'] }, { member: 'b', fileIds: ['f1'] }], groups, '')(0, 1), true, 'Sin categoría, el mismo archivo tampoco');

// Informe guardado (12.84): fuentes, bloques con el texto de la otra entrega, exclusiones y la vista con fuentes excluidas.
const three = [`${conCita} ${distinto}`, original, `${distinto} Además agregamos una conclusión propia sobre la medición del tiempo en el laboratorio de la escuela.`];
r = await analyze(three);
const items = three.map((_, i) => ({ submission: 's' + i, member: 'm' + i, version: 'v' + i, notes: i === 2 ? ['foto.pdf: el PDF no tiene texto'] : [] }));
const built = simBuildReports(items, r.docs, r.result, { settings: { minRun: 8 } });
const first = built[0];
assert.equal(first.summary.sources.length, 1, 'La cita no cuenta; coincide solo con la tercera');
assert.equal(first.summary.sources[0].submission, 's2');
assert.equal(first.data.hash, simHash(three[0]));
assert.equal(first.data.words, r.docs[0].n);
assert.ok(first.data.excluded.some(([, , code]) => code === 'c'), 'Se guarda lo excluido');
const sumWords = first.data.blocks.reduce((sum, b) => sum + b[2] - b[1], 0);
assert.equal(sumWords, first.summary.sources[0].words);
assert.ok(first.data.blocks.every((b) => b[4] && distinto.replace(/\s+/g, ' ').includes(b[4].replace('…', '').slice(0, 40))), 'Cada bloque trae el texto de la otra entrega');
assert.ok(Math.abs(simReportView(first.data, 1).total - first.total) < 0.001, 'La vista guardada da el mismo total');
assert.equal(simReportView(first.data, 1, { hidden: new Set([0]) }).total, 0, 'Excluir la fuente quita su parte');
assert.match(built[2].summary.notes.join(' '), /foto\.pdf/);
assert.equal(built[1].summary.sources.length, 0);
checks += 11;

// Fuentes solapadas: tres entregas iguales; la segunda fuente queda cubierta por la primera.
r = await analyze([original, original, original]);
const same = simBuildReports(['a', 'b', 'c'].map((x) => ({ submission: x, member: x, version: x })), r.docs, r.result)[0];
const shown = simReportView(same.data, 2);
assert.equal(shown.shown[1].words, 0, 'Sin solapadas, la segunda fuente no suma');
assert.equal(shown.own[1].words, shown.own[0].words, 'Con solapadas, cada fuente conserva lo suyo');
assert.ok(shown.marks.every((m) => m.src === 0));
const focused = simReportView(same.data, 2, { focus: 1 });
assert.ok(focused.marks.length && focused.marks.every((m) => m.src === 1), 'Marcar solo una fuente');
assert.ok(Math.abs(simReportView(same.data, 2, { hidden: new Set([0]) }).total - same.total) < 0.001, 'Excluir una fuente solapada no cambia el total');
// La huella de una entrega cambia al volver a entregar, no al calificarla.
const sub = { data: { submitted: '2026-10-01T10:00:00Z', fileIds: ['f1'], body: 'x', grade: null } };
assert.equal(simVersionOf(sub), simVersionOf({ data: { ...sub.data, grade: 9 } }));
assert.notEqual(simVersionOf(sub), simVersionOf({ data: { ...sub.data, fileIds: ['f2'] } }));
checks += 7;
const mesa = [original, original, original].map((t) => simPrepare(t, { minRun: 8 }));
const members = ['a', 'b', 'c'];
const lab = await simAnalyze(mesa, { minRun: 8, skip: (i, j) => simTeamOf(groups, 'Laboratorio', members[i])?.id === simTeamOf(groups, 'Laboratorio', members[j])?.id && !!simTeamOf(groups, 'Laboratorio', members[i]) });
assert.equal(JSON.stringify(lab.docs[0].sources.map((x) => x.doc)), '[2]', 'Mesa 1 no se compara entre sí, sí con otra mesa');
checks += 7;

// Resaltado: escapa el texto y empareja los fragmentos de ambos lados.
r = await analyze([`<script>alert(1)</script> ${original}`, original]);
const view = simPairView(r.result, 0, 1);
const html = simHighlightHtml(r.docs[0], view.mine, view.frags, 'mine');
assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'), 'El texto del alumno se escapa');
assert.match(html, /<mark class="sim-lit" data-sim-frag="0"/);
assert.match(simHighlightHtml(r.docs[1], view.theirs, view.frags, 'theirs'), /data-sim-frag="0"/);
checks += 3;

// Rendimiento: 40 entregas de ~1500 palabras en poco tiempo.
// Vocabulario sintético con frecuencias tipo Zipf (como un texto real: pocas palabras muy repetidas y muchas raras).
let seed = 7;
const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
const syllables = 'ba ce di fo gu la me ni po ru sa te vi zo ca de fi go lu ma ne pi ro su ta'.split(' ');
const vocab = Array.from({ length: 3000 }, () => Array.from({ length: 2 + Math.floor(rand() * 3) }, () => syllables[Math.floor(rand() * syllables.length)]).join(''));
const word = () => vocab[Math.floor(Math.pow(rand(), 2.2) * vocab.length)];
const many = Array.from({ length: 40 }, () => Array.from({ length: 1500 }, () => word() + (rand() < 0.06 ? '.' : '')).join(' '));
many[39] = many[3];
const start = performance.now();
const big = await analyze(many);
const ms = performance.now() - start;
assert.ok(big.result.docs[39].literal > 0.95 && big.result.docs[39].sources[0].doc === 3, 'Encuentra la copia entre 40');
assert.ok(ms < 8000, `40 entregas en ${Math.round(ms)} ms`);
checks += 2;

// En un grupo grande (donde las candidatas se buscan solo por términos poco comunes) la reescritura se sigue viendo.
const crowd = await analyze([...many.slice(0, 20), original, parafrasis]);
assert.ok(crowd.result.docs[21].total > 0.5 && crowd.result.docs[21].sources[0].doc === 20, 'Reescritura entre 22: ' + pct(crowd.result.docs[21].total));
checks++;

console.log(`PASS: ${checks} verificaciones del detector de similitud — solo el docente lo activa, copia literal y disfrazada, caracteres invisibles y letras de otro alfabeto, reescrituras, citas, bibliografía, instrucciones, equipos, informes guardados (fuentes, solapadas, excluir) y resaltado seguro (40 entregas en ${Math.round(ms)} ms).`);
