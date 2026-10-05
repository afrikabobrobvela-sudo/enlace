// Pruebas de la 12.27: importar el CSV de Brightspace (D2L) y los criterios de aceptación del módulo de evaluaciones
// (evaluaciones/INSTRUCCIONES_CLAUDE_CODE.md): grupos que suman 60 puntos, sorteos distintos, intento congelado al
// recargar, código de acceso con límite, tiempo agotado que cierra el intento, 10 con todo correcto, nada de la clave
// en la red, recalificar al corregir, acentos y subíndices, Safe Exam Browser y vista previa del docente.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

let checks = 0;
const ok = (value, message) => {
  assert(value, message);
  checks++;
};

// ---- 1. Lector del CSV (navegador) ------------------------------------------------------------------------
const context = vm.createContext({ console, structuredClone });
vm.runInContext(readFileSync('src/public/d2l.js', 'utf8'), context);
const run = (code, vars = {}) => {
  Object.assign(context, vars);
  return JSON.parse(JSON.stringify(vm.runInContext(code, context)));
};
const csv = readFileSync('scripts/fixtures/brightspace.csv', 'utf8');
ok(run('isD2LCsv(csv)', { csv }) && !run('isD2LCsv("Tipo,Pregunta\\nElección múltiple,¿?")'), 'Se reconoce el CSV de Brightspace (y no otro CSV)');
const parsed = run('parseD2LCsv(csv)', { csv });
assert.equal(parsed.length, 10);
const byId = Object.fromEntries(parsed.map((r) => [r.id, r]));
// Elección múltiple: HTML con <sub>, crédito parcial, pista, retroalimentación y comentario por opción.
assert.deepEqual(byId['FIS-P01-01'].question, {
  type: 'choice',
  text: '¿Cuál es la fórmula del agua? Escríbela como H₂O.',
  options: ['H₂O', 'HO₂', 'H₂O₂', 'CO₂, dióxido de carbono'],
  correct: 0,
  weights: [100, 50, 0, 0],
  points: 2,
  explanation: 'El agua es H₂O: dos hidrógenos y un oxígeno.',
  hint: 'Tiene dos átomos de hidrógeno.',
  optionFeedback: ['Correcto.', 'Casi: el número va en el hidrógeno.', 'Eso es agua oxigenada.', ''],
});
assert.equal(byId['FIS-P01-02'].question.text, 'El ψ² de la función de onda da una densidad de probabilidad.');
assert.deepEqual([byId['FIS-P01-02'].question.correct, byId['FIS-P01-03'].question.scoring, byId['FIS-P01-03'].question.correct], [true, 'each', [0, 1]]);
// Coincidencia con dos elementos que comparten respuesta y un distractor.
assert.deepEqual(byId['FIS-P02-01'].question, {
  type: 'matching',
  text: 'Relaciona cada magnitud con su unidad.',
  pairs: [{ left: 'Fuerza', right: 'Newton' }, { left: 'Energía', right: 'Joule' }, { left: 'Trabajo', right: 'Joule' }],
  extra: ['Pascal'],
  scoring: 'partial',
  reuse: true,
});
assert.deepEqual(byId['FIS-P02-02'].question, { type: 'ordering', text: 'Ordena del más ligero al más pesado.', items: ['Electrón', 'Protón', 'Partícula alfa'], scoring: 'all' });
// Respuesta corta: sin la expresión regular ni la de crédito parcial (con aviso).
assert.deepEqual(byId['FIS-P02-03'].question.answers, ['6']);
assert.equal(byId['FIS-P02-03'].warnings.length, 2);
assert.equal(byId['FIS-P03-01'].question.text, 'El símbolo del sodio es [[Na]] y su número atómico es [[11]]');
assert.deepEqual([byId['FIS-P03-02'].question.type, byId['FIS-P03-02'].question.guide, byId['FIS-P03-02'].question.points], ['essay', 'Se disocia por completo en agua.', 3]);
// Errores por pregunta, con su renglón.
assert.match(byId['FIS-P03-03'].error, /MAT/);
assert.match(byId['FIS-P03-04'].error, /Ninguna opción es correcta/);
assert.deepEqual([byId['FIS-P03-03'].line, byId['FIS-P03-04'].line], [71, 75]);
checks += 9;
// HTML y entidades: nada de etiquetas, acentos bien.
assert.equal(run(`d2lText('<p>&Aacute;cido<br>H<sub>2</sub>SO<sub>4</sub> &amp; x<sup>2</sup> &lt;b&gt; <script>alert(1)</script></p>')`), 'Ácido\nH₂SO₄ & x² <b> alert(1)');
checks++;
// Grupos: por ID (varios en el archivo), por archivo o sin grupo.
const files = (mode, perFile = false) => run(`assignImportGroups([{ file: 'Física_básica.csv', items: parseD2LCsv(csv) }], ${JSON.stringify(mode)}, ${perFile})[0].items.filter((r) => r.question).map((r) => r.question.pool || '')`, { csv });
assert.deepEqual([...new Set(files('auto'))], ['FIS-P01', 'FIS-P02', 'FIS-P03']);
assert.deepEqual([...new Set(files('file'))], ['Física básica']);
assert.deepEqual([...new Set(files('none'))], ['']);
checks += 3;

// ---- Servidor ---------------------------------------------------------------------------------------------
const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'docente@example.test', SESSION_SECRET: 'd'.repeat(40) };
const cookies = {};
async function send(user, path, data, headers = {}) {
  cookies[user] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user }),
    env,
  );
  return api(
    new Request('https://t.local' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { cookie: cookies[user], Origin: 'https://t.local', 'X-Aula-Request': '1', ...headers },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
}
const seen = []; // todo lo que reciben los alumnos (para buscar la clave en la «red»)
async function call(user, path, data, status = 200, headers = {}) {
  const res = await send(user, path, data, headers);
  const text = await res.text();
  assert.equal(res.status, status, `${path} (${user}) → ${text}`);
  if (user !== 'docente') seen.push({ path, text });
  checks++;
  return JSON.parse(text);
}

await call('docente', '/api/me');
const c = (await call('docente', '/api/courses', { name: 'Química', group: '30296' }, 201)).id;
const alumnos = ['ana', 'luis', 'eva', 'raul'];
await call('docente', '/api/members/bulk', { course: c, students: alumnos.map((n) => ({ name: n, email: n + '@example.test' })) });
for (const n of alumnos) await call(n, '/api/me');

// Banco de 12 grupos × 10 preguntas (como el de Química): el CSV se arma y se lee con el lector del navegador.
const bank = ['NewQuestion,MC'];
bank.length = 0;
for (let p = 1; p <= 12; p++) {
  for (let k = 1; k <= 10; k++) {
    const id = `QUIM-P${String(p).padStart(2, '0')}-${String(k).padStart(2, '0')}`;
    bank.push('NewQuestion,MC', `ID,${id}`, `QuestionText,"Pregunta ${p}.${k}: ¿cuál es el Ácido número ${k}? (H₂O, ψ²)"`, 'Points,1');
    for (let o = 0; o < 4; o++) bank.push(`Option,${o === k % 4 ? 100 : 0},Opción ${o} de ${p}.${k}`);
    bank.push('');
  }
}
const imported = run(`assignImportGroups([{ file: 'Banco.csv', items: parseD2LCsv(bankCsv) }], 'auto')[0].items`, { bankCsv: bank.join('\n') });
assert.equal(imported.filter((r) => r.question).length, 120);
checks++;
const draw = Array.from({ length: 12 }, (_, i) => ({ pool: `QUIM-P${String(i + 1).padStart(2, '0')}`, count: 5 }));
const saveQuiz = (data, status = 201, old) =>
  call('docente', '/api/record', { course: c, kind: 'quiz', ...(old ? { id: old.id, revision: old.revision } : {}), data: { title: 'Primer parcial', visible: true, ...data } }, status);
const parcial = await saveQuiz({
  questions: imported.map((r) => r.question),
  settings: { attempts: 2, timeLimit: 30, shuffle: true, shuffleOptions: true, draw, perPage: 5, results: { score: true, review: 'marks' }, exam: { enabled: true, password: 'gauss' } },
});

// Criterio 2: 12 grupos × 5 preguntas × 1 punto = 60 puntos (el importador aceptó hasta 300 preguntas).
const fromCourse = (await call('ana', '/api/course?id=' + c)).records.find((r) => r.id === parcial.id);
assert.equal(fromCourse.data.questionCount, 60);
assert.equal(fromCourse.data.settings.perPage, 5);
checks += 2;

// Criterio 5: sin código o con código incorrecto no se inicia; 5 equivocados por minuto como máximo.
await call('ana', '/api/attempt/start', { course: c, quiz: parcial.id }, 400);
for (let i = 0; i < 4; i++) await call('ana', '/api/attempt/start', { course: c, quiz: parcial.id, password: 'mal' + i }, 400);
assert.match((await call('ana', '/api/attempt/start', { course: c, quiz: parcial.id, password: 'gauss' }, 429)).error, /Espera un minuto/);
store.raw().prepare("UPDATE aula_exam_tries SET last_failure='2020-01-01T00:00:00.000Z'").run();
checks++;

// Criterio 3: dos alumnos reciben preguntas y órdenes distintos.
const a1 = await call('ana', '/api/attempt/start', { course: c, quiz: parcial.id, password: 'gauss' });
const b1 = await call('luis', '/api/attempt/start', { course: c, quiz: parcial.id, password: 'GAUSS '.toLowerCase() });
assert.equal(a1.questions.length, 60);
assert.notDeepEqual(a1.questions.map((q) => q.index), b1.questions.map((q) => q.index));
const common = a1.questions.filter((q) => b1.questions.some((x) => x.index === q.index)).length;
ok(common < 60, `Comparten ${common} de 60 preguntas`);
// De cada grupo, 5.
const pools = new Map();
for (const q of a1.questions) {
  const pool = imported[q.index].question.pool;
  pools.set(pool, (pools.get(pool) || 0) + 1);
}
assert.deepEqual([...pools.values()], Array(12).fill(5));
checks += 2;

// Criterio 4: recargar no cambia las preguntas ni pierde respuestas.
const answerOf = (x) => {
  const q = imported[x.index].question;
  return x.options.indexOf(q.options[q.correct]);
};
const half = Object.fromEntries(a1.questions.slice(0, 30).map((x) => [x.index, answerOf(x)]));
await call('ana', '/api/attempt/progress', { course: c, quiz: parcial.id, attempt: 1, answers: half, position: 0 });
const a2 = await call('ana', '/api/attempt/start', { course: c, quiz: parcial.id });
assert.deepEqual(a2.questions, a1.questions, 'Mismas preguntas, mismas opciones y mismo orden al recargar');
assert.deepEqual(a2.saved, half);
assert.equal(a2.perPage, 5);
checks += 3;

// Criterio 8: nada de la clave llega al alumno (ni al empezar, ni en el curso).
const forbidden = /"(correct|weights|key|perm|answers|answer|optionFeedback|explanation|password|values)"\s*:/;
for (const r of seen.filter((x) => /attempt\/(start|progress)/.test(x.path))) ok(!forbidden.test(r.text), `Sin clave en ${r.path}: ${r.text.match(forbidden)?.[0]}`);
ok(!/"correct"|"weights"|gauss/.test(JSON.stringify(fromCourse)), 'Sin clave en el curso del alumno');

// Criterio 7: todo correcto → 60/60 y 10 en el cuaderno.
const all = Object.fromEntries(a1.questions.map((x) => [x.index, answerOf(x)]));
const sent = await call('ana', '/api/attempt', { course: c, quiz: parcial.id, answers: all }, 201);
assert.deepEqual([sent.data.correct, sent.data.total, sent.data.score], [60, 60, 10]);
checks++;

// Criterio 6: pasado el límite más el periodo de gracia, guardar responde 409 y el intento queda enviado con lo guardado.
const l2 = Object.fromEntries(b1.questions.slice(0, 12).map((x) => [x.index, answerOf(x)]));
await call('luis', '/api/attempt/progress', { course: c, quiz: parcial.id, attempt: 1, answers: l2 });
store.raw().prepare("UPDATE aula_attempt_starts SET started=? WHERE user_id=(SELECT id FROM aula_users WHERE email='luis@example.test')").run(new Date(Date.now() - 32 * 60_000).toISOString());
const late = await call('luis', '/api/attempt/progress', { course: c, quiz: parcial.id, attempt: 1, answers: all }, 409);
ok(late.closed && /se envió/.test(late.error), 'El guardado tardío cierra el intento');
const luisAttempt = (await call('luis', '/api/course?id=' + c)).records.find((r) => r.kind === 'attempt' && r.data.quiz === parcial.id);
assert.deepEqual([luisAttempt.data.correct, luisAttempt.data.total, luisAttempt.data.score], [12, 60, 2], 'Se califica con lo que había guardado (12 de 60)');
// Su segundo intento sí puede empezar (con el código) y enviarse.
const l3 = await call('luis', '/api/attempt/start', { course: c, quiz: parcial.id, password: 'gauss' });
assert.equal(l3.attempt, 2);
await call('luis', '/api/attempt', { course: c, quiz: parcial.id, answers: Object.fromEntries(l3.questions.map((x) => [x.index, answerOf(x)])) }, 201);
checks++;

// Criterio 9: corregir la clave y recalificar.
const current = (await call('docente', '/api/course?id=' + c)).records.find((r) => r.id === parcial.id);
const fixed = structuredClone(current.data.questions);
const first = a1.questions[0].index;
fixed[first] = { ...fixed[first], correct: (fixed[first].correct + 1) % 4 };
const saved = await call('docente', '/api/record', { course: c, kind: 'quiz', id: parcial.id, revision: current.revision, data: { ...current.data, questions: fixed } });
ok(saved.regraded.checked >= 1 && saved.regraded.changed >= 1, 'Se recalificaron los intentos');
const anaAfter = (await call('docente', '/api/course?id=' + c)).records.find((r) => r.kind === 'attempt' && r.data.quiz === parcial.id && r.data.name === 'ana');
assert.equal(anaAfter.data.correct, 59);
checks++;

// ---- Tipos de Brightspace en un intento: crédito parcial, «por opción», respuesta repetida, tolerancia y pista -----
const mixed = parsed.filter((r) => r.question).map((r) => r.question);
mixed.push({ type: 'short', text: '¿Densidad del agua en g/cm³?', answers: ['1'], tolerance: 0.05 });
const tipos = await saveQuiz({ title: 'Tipos', questions: mixed, settings: { attempts: 3, shuffleOptions: true } });
const t1 = await call('eva', '/api/attempt/start', { course: c, quiz: tipos.id });
// Criterio 10: acentos y subíndices tal cual; la pista sí llega (la respuesta no).
ok(t1.questions[0].text.includes('H₂O') && t1.questions[1].text.includes('ψ²') && t1.questions.some((x) => x.text.includes('Ácido')), 'Acentos y subíndices intactos');
assert.equal(t1.questions[0].hint, 'Tiene dos átomos de hidrógeno.');
assert(!('weights' in t1.questions[0]) && !('correct' in t1.questions[0]));
checks++;
const q = (i) => t1.questions.find((x) => x.index === i);
const answersT = {
  0: q(0).options.indexOf('HO₂'), // 50 %
  1: 0, // verdadero ✓
  2: [q(2).options.indexOf('Protón'), q(2).options.indexOf('Electrón')], // por opción: Protón ✓, Neutrón ✗, Electrón ✗, Fotón ✓ → 50 %
  3: q(3).lefts.map((left) => q(3).rights.indexOf({ Fuerza: 'Newton', Energía: 'Joule', Trabajo: 'Joule' }[left])), // Joule una sola vez
  8: '1.03', // tolerancia 0.05
};
ok(q(3).rights.filter((r) => r === 'Joule').length === 1 && q(3).rights.length === 3, 'La respuesta repetida aparece una sola vez');
const t1sent = await call('eva', '/api/attempt', { course: c, quiz: tipos.id, answers: answersT }, 201);
const credit = Object.fromEntries(t1sent.data.details.map((d) => [d.index, d.credit]));
assert.deepEqual([credit[0], credit[1], credit[2], credit[3], credit[8]], [0.5, 1, 0.5, 1, 1]);
checks++;

// ---- Safe Exam Browser -------------------------------------------------------------------------------------
const sebKey = 'a'.repeat(64);
await saveQuiz({ title: 'SEB', questions: [mixed[1]], settings: { seb: { required: true, keys: 'no-es-llave' } } }, 400);
const seb = await saveQuiz({ title: 'SEB', questions: [mixed[1]], settings: { seb: { required: true, keys: `${sebKey}\n${'b'.repeat(64)}` } } });
const sebSeen = (await call('raul', '/api/course?id=' + c)).records.find((r) => r.id === seb.id);
ok(sebSeen.data.settings.needsSeb === true && !JSON.stringify(sebSeen).includes(sebKey), 'El alumno sabe que se exige SEB, sin la llave');
assert.equal((await call('raul', '/api/attempt/start', { course: c, quiz: seb.id }, 403)).needsSeb, true);
const hash = async (url) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url + sebKey)))].map((b) => b.toString(16).padStart(2, '0')).join('');
await call('raul', '/api/attempt/start', { course: c, quiz: seb.id }, 403, { 'X-SafeExamBrowser-ConfigKeyHash': await hash('https://t.local/otra') });
await call('raul', '/api/attempt/start', { course: c, quiz: seb.id }, 200, { 'X-SafeExamBrowser-ConfigKeyHash': await hash('https://t.local/api/attempt/start') });
await call('raul', '/api/attempt', { course: c, quiz: seb.id, answers: { 0: 0 } }, 403); // enviar también lo exige
await call('raul', '/api/attempt', { course: c, quiz: seb.id, answers: { 0: 0 } }, 201, { 'X-SafeExamBrowser-RequestHash': await hash('https://t.local/api/attempt') });

// 12.28: con un solo botón, sin archivo .seb del docente: Enlace arma la configuración y calcula su Config Key.
const worker = (await import('../src/worker.js')).default;
const facil = await saveQuiz({ title: 'SEB fácil', questions: [mixed[1]], settings: { seb: { required: true } } });
assert.deepEqual((await call('docente', '/api/course?id=' + c)).records.find((r) => r.id === facil.id).data.settings.seb, { required: true });
const conf = await worker.fetch(new Request(`https://t.local/seb/${facil.id}.seb`), env);
assert.equal(conf.status, 200);
assert.equal(conf.headers.get('Content-Type'), 'application/seb');
const xml = await conf.text();
ok(xml.includes(`<key>startURL</key>\n\t<string>https://t.local/#c=${c}&amp;s=quiz&amp;d=${facil.id}</string>`) && xml.includes('<key>sendBrowserExamKey</key>\n\t<true/>'), 'La configuración abre la evaluación y manda las llaves');
for (const key of ['allowSwitchToApplications', 'allowUserSwitching', 'allowSiri', 'allowDictation', 'allowScreenCapture', 'allowWindowCapture', 'allowScreenSharing', 'enablePrintScreen', 'allowAudioCapture', 'allowVideoCapture', 'allowVirtualMachine', 'allowDeveloperConsole', 'allowDictionaryLookup']) {
  assert.ok(xml.includes(`<key>${key}</key>\n\t<false/>`), `SEB debe desactivar ${key}`);
}
assert.ok(xml.includes('<key>monitorProcesses</key>\n\t<true/>'), 'SEB debe vigilar procesos prohibidos');
// La Config Key sale del archivo mismo (como la calcula SEB): JSON sin originatorVersion, llaves en orden sin mayúsculas.
const dict = {};
for (const [, k, v] of xml.matchAll(/<key>([^<]+)<\/key>\n\t(<true\/>|<false\/>|<integer>-?\d+<\/integer>|<string>[^<]*<\/string>)/g)) {
  dict[k] = v === '<true/>' ? true : v === '<false/>' ? false : v.startsWith('<integer>') ? Number(v.slice(9, -10)) : v.slice(8, -9).replace(/&amp;/g, '&');
}
delete dict.originatorVersion;
const keys = Object.keys(dict).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en'));
assert.deepEqual(keys.slice(-2), ['startURL', 'URLFilterEnable'], 'Orden sin distinguir mayúsculas');
const configKey = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`{${keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(dict[k])}`).join(',')}}`)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const hashWith = async (url, key) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url + key)))].map((b) => b.toString(16).padStart(2, '0')).join('');
await call('raul', '/api/attempt/start', { course: c, quiz: facil.id }, 403);
await call('raul', '/api/attempt/start', { course: c, quiz: facil.id }, 200, { 'X-SafeExamBrowser-ConfigKeyHash': await hashWith('https://t.local/api/attempt/start', configKey) });
await call('raul', '/api/attempt', { course: c, quiz: facil.id, answers: { 0: 0 } }, 201, { 'X-SafeExamBrowser-ConfigKeyHash': await hashWith('https://t.local/api/attempt', configKey) });
// Sin exigir SEB, o evaluación inexistente: no hay configuración.
assert.equal((await worker.fetch(new Request(`https://t.local/seb/${tipos.id}.seb`), env)).status, 404);
assert.equal((await worker.fetch(new Request('https://t.local/seb/no-existe.seb'), env)).status, 404);
checks += 4;

// ---- Vista previa del docente ----------------------------------------------------------------------------
await call('ana', '/api/quiz/preview', { course: c, quiz: parcial.id }, 403);
const p1 = await call('docente', '/api/quiz/preview', { course: c, quiz: parcial.id });
const p2 = await call('docente', '/api/quiz/preview', { course: c, quiz: parcial.id });
assert.equal(p1.questions.length, 60);
ok(p1.seed !== p2.seed && JSON.stringify(p1.questions) !== JSON.stringify(p2.questions), 'Cada vista previa sortea distinto');
ok(!forbidden.test(JSON.stringify(p1.questions)), 'La vista previa llega como la vería el alumno');
const graded = await call('docente', '/api/quiz/preview', { course: c, quiz: parcial.id, seed: p1.seed, answers: Object.fromEntries(p1.questions.map((x) => [x.index, answerOf(x)])) });
assert.equal(graded.total, 60);
ok(graded.correct >= 59, 'La vista previa se califica con el mismo sorteo');
const before = (await call('docente', '/api/course?id=' + c)).records.filter((r) => r.kind === 'attempt').length;
await call('docente', '/api/quiz/preview', { course: c, quiz: parcial.id, seed: p1.seed, answers: {} });
assert.equal((await call('docente', '/api/course?id=' + c)).records.filter((r) => r.kind === 'attempt').length, before, 'La vista previa no guarda intentos');
checks++;

// ---- Banco: importar 120 preguntas en 12 temas (de 100 en 100 por solicitud) ---------------------------------
const byTopic = new Map();
for (const r of imported) {
  const { pool, ...rest } = r.question;
  (byTopic.get(pool) || byTopic.set(pool, []).get(pool)).push(rest);
}
let bankSaved = 0;
for (const [topic, questions] of byTopic) bankSaved += (await call('docente', '/api/bank', { course: c, topic, questions }, 201)).saved;
assert.equal(bankSaved, 120);
assert.equal((await call('docente', '/api/bank', { course: c, topic: 'QUIM-P01', questions: byTopic.get('QUIM-P01') }, 201)).repeated, 10, 'No se repiten');
checks += 2;

// ---- 12.29: tiempo fijo ya vencido (abre 7:00, 30 min, cierra 15:30) ------------------------------------------
const hours = (n) => new Date(Date.now() + n * 3600_000).toISOString();
const fijo = await saveQuiz({
  title: 'examen parcial 1',
  questions: [mixed[1], mixed[1]],
  settings: { attempts: 2, timeLimit: 30, opensAt: hours(-8), closesAt: hours(1), timerMode: 'fixed', exam: { enabled: true, password: 'E8576W', oneByOne: true, noBack: true } },
});
const tarde = await call('raul', '/api/attempt/start', { course: c, quiz: fijo.id, password: 'E8576W' }, 403);
ok(/se cuenta desde la hora de inicio/.test(tarde.error), 'Tiempo fijo vencido: explica por qué y no abre el intento');
const raulId = store.raw().prepare("SELECT id FROM aula_users WHERE email='raul@example.test'").get().id;
assert.equal(store.raw().prepare('SELECT count(*) AS n FROM aula_attempts WHERE quiz=?').get(fijo.id).n, 0, 'No se gastó ningún intento');
// Lo que dejaba la versión anterior: dos intentos cerrados en 0 sin respuestas (y uno con respuestas de otro alumno).
const insertAttempt = store.raw().prepare("INSERT INTO aula_attempts (id,course,quiz,user_id,name,answers,correct,total,score,created,attempt,details) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
const insertStart = store.raw().prepare('INSERT INTO aula_attempt_starts (quiz,user_id,attempt,started) VALUES (?,?,?,?)');
for (const n of [1, 2]) {
  insertAttempt.run(`v${n}`, c, fijo.id, raulId, 'raul', '[]', 0, 2, 0, hours(0), n, null);
  insertStart.run(fijo.id, raulId, n, hours(0));
}
const evaId = store.raw().prepare("SELECT id FROM aula_users WHERE email='eva@example.test'").get().id;
insertAttempt.run('conRespuestas', c, fijo.id, evaId, 'eva', '[true]', 1, 2, 5, hours(0), 1, JSON.stringify([{ index: 0, answer: true, correct: true, credit: 1 }]));
await call('raul', '/api/quiz/void-empty', { course: c, quiz: fijo.id }, 403);
const devueltos = await call('docente', '/api/quiz/void-empty', { course: c, quiz: fijo.id });
assert.deepEqual([devueltos.voided, devueltos.students], [2, 1]);
assert.deepEqual(store.raw().prepare('SELECT id FROM aula_attempts WHERE quiz=?').all(fijo.id).map((r) => r.id), ['conRespuestas'], 'Solo se quitan los vacíos');
assert.equal(store.raw().prepare('SELECT count(*) AS n FROM aula_attempt_starts WHERE quiz=? AND user_id=?').get(fijo.id, raulId).n, 0);
// Con el tiempo por alumno, Raúl vuelve a empezar desde el intento 1 y tiene sus 30 minutos.
const actual = (await call('docente', '/api/course?id=' + c)).records.find((r) => r.id === fijo.id);
await call('docente', '/api/record', { course: c, kind: 'quiz', id: fijo.id, revision: actual.revision, data: { ...actual.data, settings: { ...actual.data.settings, timerMode: 'attempt' } } });
const deNuevo = await call('raul', '/api/attempt/start', { course: c, quiz: fijo.id, password: 'E8576W' });
assert.deepEqual([deNuevo.attempt, deNuevo.attemptsLeft], [1, 2]);
ok(Date.parse(deNuevo.deadline) - Date.parse(deNuevo.started) === 30 * 60_000, 'Tiene sus 30 minutos completos');
checks += 3;

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones de la 12.27 — CSV de Brightspace (8 tipos, HTML, errores por renglón, grupos), 60 puntos en 12 grupos, sorteos distintos, intento congelado, código con límite, tiempo agotado, 10 con todo correcto, sin clave en la red, recalificar, Safe Exam Browser y vista previa.`);
