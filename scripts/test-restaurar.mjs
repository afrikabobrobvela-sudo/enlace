// Pruebas de restauración de la base: la exportación de D1 (tablas en orden de creación) no se puede cargar tal cual
// en una base vacía con las llaves foráneas activas; orderDump() la reordena, verifyDump() comprueba que cargue
// completa, y `npm run restaurar` solo escribe en una base vacía y compara las filas al terminar.
// Se usa el esquema real (todas las migraciones) con datos creados por el servidor.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { api } from '../src/server/api.js';
import { completeLogin, sessionCookieForTests } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';
import { orderDump, splitStatements, verifyDump } from './lib/dump.mjs';

let checks = 0;

// ---- Dividir sentencias sin romper textos ----
assert.deepEqual(splitStatements("INSERT INTO t VALUES('a;\nb','it''s');\n-- comentario; con punto y coma\nINSERT INTO t VALUES(\"x;y\");"), [
  "INSERT INTO t VALUES('a;\nb','it''s')",
  'INSERT INTO t VALUES("x;y")',
]);
checks++;

// ---- Un curso real: datos creados con el servidor sobre el esquema de todas las migraciones ----
const store = openD1(':memory:');
const env = { DB: store.DB, BUCKET: memoryBucket(), AULA_OWNER_EMAIL: 'admin@example.test', SESSION_SECRET: 'x'.repeat(40) };
const cookies = {};
async function call(user, path, data, status = 200) {
  cookies[user] ??= await sessionCookieForTests(await completeLogin(env, { provider: 'google', subject: 'g-' + user, email: user + '@example.test', name: user }), env);
  const res = await api(
    new Request('https://t.local' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { cookie: cookies[user], Origin: 'https://t.local', 'X-Aula-Request': '1' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  assert.equal(res.status, status, await res.clone().text());
  return res.json();
}
await call('admin', '/api/me');
await call('admin', '/api/teachers', { email: 'docente@example.test', name: 'Docente', role: 'teacher' });
const { id: demo } = await call('docente', '/api/demo-course', {}, 201);
// Un texto con punto y coma, salto de línea y comillas, como los que escriben los docentes.
await call('docente', '/api/record', { course: demo, kind: 'notice', data: { title: "Aviso; 'importante'", body: 'Línea 1;\nLínea 2 -- no es comentario', visible: true } }, 201);
const db = store.raw();

/** Exportación con la misma forma que `wrangler d1 export`: cada tabla en orden de creación seguida de sus datos. */
function exportLikeD1() {
  const lines = ['PRAGMA defer_foreign_keys=TRUE;'];
  const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
  const quote = (v) => (v === null ? 'NULL' : typeof v === 'number' || typeof v === 'bigint' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  for (const t of tables) {
    lines.push(t.sql + ';');
    for (const row of db.prepare(`SELECT * FROM "${t.name}"`).all()) {
      lines.push(`INSERT INTO "${t.name}" (${Object.keys(row).map((c) => `"${c}"`).join(',')}) VALUES(${Object.values(row).map(quote).join(',')});`);
    }
  }
  for (const i of db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY rowid").all()) lines.push(i.sql + ';');
  return lines.join('\n') + '\n';
}
const dump = exportLikeD1();
const source = Object.fromEntries(
  ['aula_users', 'aula_courses', 'aula_members', 'aula_submissions', 'aula_attendance', 'aula_records', 'aula_units'].map((t) => [t, db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n]),
);

// El problema real: tal cual, una base vacía con llaves foráneas lo rechaza.
const raw = new DatabaseSync(':memory:');
raw.exec('PRAGMA foreign_keys=ON');
assert.throws(() => raw.exec(dump), /no such table/);
raw.close();
checks++;

// Reordenado: carga completa, con las mismas filas y sin llaves rotas.
const { tables } = orderDump(dump);
assert(tables.indexOf('aula_units') < tables.indexOf('aula_courses'), 'Las unidades antes que los cursos');
assert(tables.indexOf('aula_tasks') < tables.indexOf('aula_submissions'));
const counts = await verifyDump(dump);
for (const [t, n] of Object.entries(source)) assert.equal(counts[t], n, t);
assert(counts.aula_submissions > 60);
const restored = new DatabaseSync(':memory:');
restored.exec('PRAGMA foreign_keys=ON');
restored.exec(orderDump(dump).sql);
assert.equal(restored.prepare("SELECT data FROM aula_records WHERE kind='notice' AND data LIKE '%importante%'").get().data.includes('Línea 1;\\nLínea 2 -- no es comentario'), true);
restored.close();
checks += 5;

// Un respaldo con una fila que apunta a un registro inexistente no se da por bueno.
await assert.rejects(verifyDump(dump.replace(/INSERT INTO "aula_users"[^\n]*\n/g, '')), /apuntan a registros que no existen/);
checks++;

// ---- npm run restaurar con un wrangler simulado (la "nube" es un archivo SQLite) ----
const dir = mkdtempSync(join(tmpdir(), 'enlace-restaurar-'));
const fake = join(dir, 'wrangler.mjs');
writeFileSync(
  fake,
  `import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, args.join(' ') + '\\n');
const dbs = existsSync(process.env.FAKE_DBS) ? JSON.parse(readFileSync(process.env.FAKE_DBS, 'utf8')) : [];
const open = (name) => { const db = new DatabaseSync(process.env.FAKE_DIR + '/' + name + '.sqlite'); db.exec('PRAGMA foreign_keys=ON'); return db; };
if (args[0] === 'd1' && args[1] === 'list') console.log(JSON.stringify(dbs.map((name) => ({ name, uuid: '00000000-0000-4000-8000-000000000000' }))));
else if (args[0] === 'd1' && args[1] === 'create') { dbs.push(args[2]); writeFileSync(process.env.FAKE_DBS, JSON.stringify(dbs)); console.log('created'); }
else if (args[0] === 'd1' && args[1] === 'execute') {
  const db = open(args[2]);
  const file = args[args.indexOf('--file') + 1];
  if (args.includes('--file')) db.exec(readFileSync(file, 'utf8'));
  else { console.error('▲ [WARNING] Proxy environment variables detected [x]'); console.log(JSON.stringify([{ results: db.prepare(args[args.indexOf('--command') + 1]).all() }])); }
}
`,
);
const backupFile = join(dir, 'enlace-db-2026-10-05-14-30.sql');
writeFileSync(backupFile, dump);
function restaurar(extra = []) {
  const result = spawnSync(process.execPath, ['scripts/restaurar.mjs', backupFile, ...extra], {
    encoding: 'utf8',
    env: { ...process.env, ENLACE_WRANGLER: `${process.execPath} ${fake}`, FAKE_DIR: dir, FAKE_DBS: join(dir, 'dbs.json'), FAKE_LOG: join(dir, 'log') },
  });
  return { ...result, text: result.stdout + result.stderr };
}
// Nunca sobre la base de producción.
let r = restaurar(['--destino', 'enlace-db']);
assert.notEqual(r.status, 0);
assert.match(r.text, /no se restaura sobre enlace-db/);
// En una base nueva: la crea, carga y compara.
r = restaurar();
assert.equal(r.status, 0, r.text);
assert.match(r.text, /Base enlace-db-restaurada creada/);
assert.match(r.text, /Todas las tablas tienen las mismas filas/);
assert(existsSync(backupFile.replace(/\.sql$/, '.restaurable.sql')));
const nube = new DatabaseSync(join(dir, 'enlace-db-restaurada.sqlite'));
for (const [t, n] of Object.entries(source)) assert.equal(nube.prepare(`SELECT count(*) AS n FROM ${t}`).get().n, n, t);
nube.close();
checks += 5;
// Otra vez: la base ya tiene datos y no se toca.
const log = () => readFileSync(join(dir, 'log'), 'utf8');
const before = log().split('\n').filter((l) => l.includes('--file')).length;
r = restaurar();
assert.notEqual(r.status, 0);
assert.match(r.text, /ya tiene datos/);
assert.equal(log().split('\n').filter((l) => l.includes('--file')).length, before, 'No se cargó nada');
// Un respaldo dañado se detiene antes de subir nada.
writeFileSync(backupFile, dump.slice(0, dump.length / 2));
r = restaurar(['--destino', 'otra-base']);
assert.notEqual(r.status, 0);
assert.match(r.text, /no se puede restaurar/);
assert(!log().includes('create otra-base'));
checks += 6;

console.log(`PASS: ${checks} verificaciones de restauración — la exportación de D1 se reordena y comprueba, restaurar solo en una base vacía y con las mismas filas.`);
