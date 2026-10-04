// Pruebas de la 12.33: importar preguntas con imágenes y grupos — el ZIP de Brightspace (CSV + imágenes, renglón Image
// o <img> en el enunciado), un ZIP con texto («Imagen:» y «Grupo:»), Word con imágenes incrustadas, y la subida de cada
// imagen una sola vez. Al final, las preguntas con esas imágenes se guardan en una evaluación y el alumno las ve.
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

const uploads = [];
const ctx = vm.createContext({
  console,
  TextEncoder,
  TextDecoder,
  Blob,
  File,
  Response,
  DecompressionStream,
  structuredClone,
  URL,
  // En el navegador sube a /api/upload; aquí se anota qué se subió.
  uploadQuestionImage: async (file) => {
    uploads.push({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    return `img-${uploads.length}`;
  },
});
for (const file of ['reactivos.js', 'zip.js', 'oficina.js', 'd2l.js', 'importar.js']) {
  vm.runInContext(readFileSync('src/public/' + file, 'utf8').replace(/\ndocument\.addEventListener\([\s\S]*$/, ''), ctx);
}
const g = (name) => vm.runInContext(name, ctx);
const enc = new TextEncoder();
// Un ZIP (sin compresión) armado con zipParts(), como un File del navegador.
const zipFile = async (name, files) =>
  new File([await new Blob(g('zipParts')(Object.entries(files).map(([path, data]) => ({ name: path, data: typeof data === 'string' ? enc.encode(data) : data, date: new Date() })))).arrayBuffer()], name);
const png = (n) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n, n, n, n]);
const J = (value) => JSON.parse(JSON.stringify(value)); // los arreglos del contexto vm son de otro «realm»
const plain = (items) => J(items.map(({ imageFile, thumb, ...rest }) => ({ ...rest, image: imageFile?.name || null })));

// ---- 1. ZIP de Brightspace: el CSV y sus imágenes ----------------------------------------------------------
const csv = `NewQuestion,MC,,,
ID,FIS1-VEC01-A,,,
QuestionText,¿Cuál es la magnitud de la resultante de la figura?,,,
Image,imagenes/vector-a.png,,,
Option,100,5 N,,
Option,0,7 N,,
NewQuestion,MC,,,
ID,FIS1-VEC01-B,,,
QuestionText,"<p>Observa la figura:</p><img src=""/content/enforced/123-FIS/imagenes/Vector-B.png"" alt=""""><p>¿Cuál es la resultante?</p>",HTML,,
Option,0,3 N,,
Option,100,13 N,,
NewQuestion,TF,,,
ID,FIS1-VEC02-A,,,
QuestionText,La masa es una magnitud vectorial.,,,
Image,imagenes/no-existe.png,,,
TRUE,0,,,
FALSE,100,,,
NewQuestion,MC,,,
ID,FIS1-VEC02-B,,,
QuestionText,Mismo diagrama que la primera,,,
Image,vector-a.png,,,
Option,100,Sí,,
Option,0,No,,
`;
const zip = await zipFile('Fisica.zip', {
  'Fisica/preguntas.csv': csv,
  'Fisica/imagenes/vector-a.png': png(1),
  'Fisica/imagenes/vector-b.png': png(2),
  '__MACOSX/Fisica/._preguntas.csv': 'basura',
  'Fisica/.DS_Store': 'basura',
});
const read = await g('readImportFiles')([zip]);
assert.equal(read.length, 1, 'Solo el CSV cuenta como archivo de preguntas (no los de macOS)');
assert.equal(read[0].file, 'preguntas.csv');
const items = read[0].items;
assert.deepEqual(
  J(items.map((r) => [r.id, r.imageFile?.name || null, r.warnings])),
  [
    ['FIS1-VEC01-A', 'vector-a.png', []],
    ['FIS1-VEC01-B', 'vector-b.png', []], // la <img> del enunciado, con otra ruta y mayúsculas
    ['FIS1-VEC02-A', null, ['no se encontró la imagen «imagenes/no-existe.png» en el ZIP: agrégala en el editor']],
    ['FIS1-VEC02-B', 'vector-a.png', []], // solo el nombre del archivo
  ],
);
assert.equal(items[1].question.text, 'Observa la figura:\n¿Cuál es la resultante?', 'La etiqueta <img> no queda en el texto');
assert.equal(items[0].imageFile.key, items[3].imageFile.key, 'Dos preguntas con la misma imagen');
// Grupos por ID de Brightspace, como antes.
g('assignImportGroups')(read, 'auto');
assert.deepEqual(J([...new Set(items.map((r) => r.question.pool))]), ['FIS1-VEC01', 'FIS1-VEC02']);
checks += 5;
// El CSV suelto avisa que la imagen no se importa (y la pregunta sí).
const loose = JSON.parse(JSON.stringify(g('parseD2LCsv')(csv)));
ok(loose[0].question && /elige el ZIP con el CSV y sus imágenes/.test(loose[0].warnings[0]), 'Sin ZIP, aviso de la imagen');

// Al agregar: cada imagen se sube una sola vez y queda su id en la pregunta.
const questions = JSON.parse(JSON.stringify(await g('importQuestionsWithImages')(items.filter((r) => r.question))));
assert.deepEqual(questions.map((q) => q.image || null), ['img-1', 'img-2', null, 'img-1']);
assert.deepEqual(uploads.map((u) => [u.name, u.type, u.bytes[8]]), [['vector-a.png', 'image/png', 1], ['vector-b.png', 'image/png', 2]]);
assert.equal(items[0].question.image, undefined, 'La lectura no se modifica (se puede volver a agregar)');
checks += 3;

// ---- 2. ZIP con texto: «Imagen:» y «Grupo:» ---------------------------------------------------------------
const texto = `1. ¿Qué vector es más largo?
Imagen: fig1.png
Grupo: Vectores
a) A
*b) B

2. ¿Cuánto es 3 × 10² + 2 × 10²?
Grupo: Notación científica
a) 5 × 10⁴
*b) 5 × 10²

3. Sin grupo
Respuesta: Verdadero`;
const read2 = await g('readImportFiles')([await zipFile('otro.zip', { 'banco.txt': texto, 'fig1.png': png(3) })]);
const items2 = read2[0].items;
assert.deepEqual(plain(items2).map((r) => [r.question.type, r.explicitGroup || '', r.image]), [
  ['choice', 'Vectores', 'fig1.png'],
  ['choice', 'Notación científica', null],
  ['truefalse', '', null],
]);
// El grupo escrito manda (aunque sea un solo archivo); «uno por archivo» y «sin grupos» lo reemplazan.
const pools = (mode) => (g('assignImportGroups')(read2, mode), J(items2.map((r) => r.question.pool || '')));
assert.deepEqual(pools('auto'), ['Vectores', 'Notación científica', '']);
assert.deepEqual(pools('file'), ['banco', 'banco', 'banco']);
assert.deepEqual(pools('none'), ['', '', '']);
// Sin ZIP (pegado), «Imagen:» avisa; en Excel, las columnas Imagen y Grupo.
const pasted = JSON.parse(JSON.stringify(g('importFromText')(texto)));
assert.match(pasted[0].warnings[0], /no se importa: elige un ZIP/);
const excel = g('importFromBlocks')(g('importRowBlocks')([['Pregunta', 'A', 'B', 'Respuesta', 'Grupo', 'Imagen'], ['¿Cuál?', 'x', 'y', 'B', 'Vectores', 'fig1.png']]), (path) => (path === 'fig1.png' ? { key: 'k', name: 'fig1.png', type: 'image/png' } : null));
assert.deepEqual(J([excel[0].question.correct, excel[0].explicitGroup, excel[0].imageFile.name]), [1, 'Vectores', 'fig1.png']);
checks += 6;

// ---- 3. Word con imágenes ---------------------------------------------------------------------------------
const p = (inner, list = true) => `<w:p>${list ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' : ''}${inner}</w:p>`;
const run = (text, bold = false) => `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const drawing = (rid) => `<w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
const opt = (text, bold = false) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(text, bold)}</w:p>`;
const docXml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="w" xmlns:a="a" xmlns:r="r"><w:body>
  ${p(drawing('rIdLogo') + run('Examen de Física I'), false)}
  ${p(run('Calcula la fuerza resultante sobre el perno de la figura.'))}
  ${p(drawing('rIdFig'), false)}
  ${opt('692 N', true)}${opt('1177 N')}
  ${p(run('Una pregunta sin imagen'))}
  ${opt('uno', true)}${opt('dos')}
  ${p(run('Con dos imágenes ') + drawing('rIdFig') + drawing('rIdOtra'))}
  ${opt('tres', true)}${opt('cuatro')}
</w:body></w:document>`;
const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="x">
  <Relationship Id="rIdLogo" Type="image" Target="media/logo.png"/>
  <Relationship Id="rIdFig" Type="image" Target="media/image2.png"/>
  <Relationship Id="rIdOtra" Type="image" Target="media/image3.jpeg"/>
  <Relationship Id="rIdWeb" Type="image" Target="https://ejemplo.invalid/x.png" TargetMode="External"/></Relationships>`;
const docx = async (name, figure) =>
  zipFile(name, { '[Content_Types].xml': '<Types/>', 'word/document.xml': docXml, 'word/_rels/document.xml.rels': rels, 'word/media/logo.png': png(9), 'word/media/image2.png': png(figure), 'word/media/image3.jpeg': png(8) });
const read3 = await g('readImportFiles')([await docx('parcial-2025.docx', 4), await docx('parcial-2026.docx', 5)]);
const w1 = plain(read3[0].items);
assert.deepEqual(
  w1.map((r) => [r.question.text, r.question.correct, r.image, r.warnings || []]),
  [
    ['Calcula la fuerza resultante sobre el perno de la figura.', 0, 'image2.png', []],
    ['Una pregunta sin imagen', 0, null, []],
    ['Con dos imágenes', 0, 'image2.png', ['tenía 2 imágenes: se usa la primera']],
  ],
  'La imagen va con su pregunta; el logotipo de antes de la primera pregunta no cuenta',
);
// Dos documentos con la misma ruta interna (word/media/image2.png) son imágenes distintas.
uploads.length = 0;
const both = JSON.parse(JSON.stringify(await g('importQuestionsWithImages')([...read3[0].items, ...read3[1].items].filter((r) => r.question))));
assert.deepEqual(both.map((q) => q.image || null), ['img-1', null, 'img-1', 'img-2', null, 'img-2']);
assert.deepEqual(uploads.map((u) => u.bytes[8]), [4, 5]);
checks += 3;
// Un ZIP sin preguntas, o que no es ZIP, se rechaza con un mensaje claro.
await assert.rejects(g('readImportFiles')([await zipFile('solo-imagenes.zip', { 'a.png': png(1) })]), /no trae preguntas/);
await assert.rejects(g('readImportFiles')([new File(['hola'], 'falso.zip')]), /no es un ZIP válido/);
checks += 2;

// ---- 4. Servidor: la evaluación guarda las imágenes subidas y el alumno las ve -------------------------------------
const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'docente@example.test', SESSION_SECRET: 'i'.repeat(40) };
const cookies = {};
async function call(user, path, data, status = 200, headers = {}, body) {
  cookies[user] ??= await sessionCookieForTests(
    await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user }),
    env,
  );
  const res = await api(
    new Request('https://t.local' + path, {
      method: data === undefined && body === undefined ? 'GET' : 'POST',
      headers: { cookie: cookies[user], Origin: 'https://t.local', 'X-Aula-Request': '1', ...headers },
      body: body ?? (data === undefined ? undefined : JSON.stringify(data)),
    }),
    env,
  );
  assert.equal(res.status, status, `${path} (${user}) → ${res.status}`);
  checks++;
  return res.headers.get('content-type')?.includes('json') ? res.json() : res;
}
await call('docente', '/api/me');
const c = (await call('docente', '/api/courses', { name: 'Física I', group: 'A' }, 201)).id;
await call('docente', '/api/members/bulk', { course: c, students: [{ name: 'Ana', email: 'ana@example.test' }] });
await call('ana', '/api/me');
// Lo que hace uploadQuestionImage() en el navegador, con los bytes que venían en el ZIP.
const up = await call('docente', `/api/upload?course=${c}&scope=material`, undefined, 201, { 'x-file-name': 'vector-a.png', 'content-type': 'image/png' }, png(1));
const withImages = questions.map((q) => (q.image ? { ...q, image: up.id } : q));
const quiz = await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Vectores', visible: true, questions: withImages, settings: { attempts: 1 } } }, 201);
assert.deepEqual(quiz.data.questions.map((q) => q.image || null), [up.id, up.id, null, up.id]);
const start = await call('ana', '/api/attempt/start', { course: c, quiz: quiz.id });
ok(start.questions.some((q) => q.image === up.id), 'El alumno recibe la pregunta con su imagen');
const seen = await call('ana', `/api/file/${up.id}?preview=1`);
ok(seen.status === 200, 'Y puede ver la imagen');
// Una imagen de otro curso no se acepta.
const otro = (await call('docente', '/api/courses', { name: 'Química', group: 'B' }, 201)).id;
const ajena = await call('docente', `/api/upload?course=${otro}&scope=material`, undefined, 201, { 'x-file-name': 'x.png', 'content-type': 'image/png' }, png(7));
await call('docente', '/api/record', { course: c, kind: 'quiz', data: { title: 'Mal', visible: true, questions: [{ ...withImages[0], image: ajena.id }] } }, 400);

assert.deepEqual(store.raw().prepare('PRAGMA foreign_key_check').all(), []);
console.log(`PASS: ${checks} verificaciones de la 12.33 — importar con imágenes: ZIP de Brightspace (Image y <img>), ZIP con «Imagen:» y «Grupo:», Word con imágenes, cada imagen se sube una vez, y la evaluación las guarda y el alumno las ve.`);
