// Pruebas de la publicación: nunca se publica ni se migra con los valores de ejemplo de wrangler.toml, y
// `npm run configurar` recuerda tu base, tu correo y tu dirección aunque descomprimas una versión nueva en otra carpeta.
// Usa un wrangler simulado que anota cada llamada y guarda el wrangler.toml con el que se publicó.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configProblems } from './revisar-config.mjs';

let checks = 0;
const ROOT = process.cwd();
const TOML = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
const DB_ID = '0f6b1c2d-3e4f-4a5b-8c7d-9e0f1a2b3c4d';

// ---- Revisión de wrangler.toml ----
assert.equal(configProblems(TOML).length, 2, 'El wrangler.toml del ZIP no se puede publicar');
const listo = TOML.replace('PEGA_AQUI_EL_ID_DE_TU_BASE', DB_ID).replaceAll('AULA_OWNER_EMAIL = "tu-correo@gmail.com"', 'AULA_OWNER_EMAIL = "rodrigo@correo.buap.mx"');
assert.deepEqual(configProblems(listo), []);
// El entorno de pruebas se revisa por separado: su base sigue con el marcador.
assert.equal(configProblems(listo, { testing: true }).length, 1);
assert.equal(configProblems(TOML.replace('PEGA_AQUI_EL_ID_DE_TU_BASE', DB_ID)).length, 1, 'Solo falta el correo');
checks += 4;

// ---- Los atajos se detienen antes de publicar o migrar ----
const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;
for (const name of ['deploy', 'deploy:pruebas', 'db:migrate', 'db:migrate:pruebas']) {
  assert.match(scripts[name], /^node scripts\/revisar-config\.mjs/, `${name} revisa la configuración primero`);
  checks++;
}
const guardia = spawnSync(process.execPath, [join(ROOT, 'scripts/revisar-config.mjs')], { cwd: ROOT, encoding: 'utf8' });
assert.equal(guardia.status, 1);
assert.match(guardia.stderr, /npm run configurar/);
checks++;

// ---- configurar con un wrangler simulado ----
const fake = join(mkdtempSync(join(tmpdir(), 'enlace-fake-')), 'wrangler.mjs');
writeFileSync(
  fake,
  `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const cmd = args.join(' ');
appendFileSync(process.env.FAKE_LOG, cmd + '\\n');
if (cmd.startsWith('whoami')) console.log('You are logged in');
else if (cmd.startsWith('d1 list')) console.log(JSON.stringify([{ name: 'enlace-db', uuid: '${DB_ID}' }]));
else if (cmd.startsWith('r2 bucket list')) console.log('name: enlace-archivos');
else if (cmd.startsWith('d1 execute')) {
  const known = JSON.parse(process.env.FAKE_USERS);
  const email = cmd.match(/lower\\(email\\)='([^']+)'/)[1];
  console.log(JSON.stringify([{ results: [{ users: known.length, found: known.includes(email) ? 1 : 0 }] }]));
} else if (cmd.startsWith('d1 migrations list')) console.log('No migrations to apply');
else if (cmd === 'deploy') writeFileSync(process.env.FAKE_DEPLOYED, readFileSync('wrangler.toml', 'utf8'));
else if (cmd.startsWith('secret list')) console.log(JSON.stringify([{ name: 'SESSION_SECRET' }, { name: 'GOOGLE_CLIENT_ID' }, { name: 'GOOGLE_CLIENT_SECRET' }]));
`,
);
const memoryDir = mkdtempSync(join(tmpdir(), 'enlace-memoria-'));

/** Una carpeta recién descomprimida: wrangler.toml con marcadores, como en el ZIP. */
function freshFolder() {
  const dir = mkdtempSync(join(tmpdir(), 'enlace-zip-'));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'wrangler.toml'), TOML);
  writeFileSync(join(dir, 'src/worker.js'), '');
  writeFileSync(join(dir, 'scripts/build.mjs'), '');
  cpSync(join(ROOT, 'scripts/configurar.mjs'), join(dir, 'scripts/configurar.mjs'));
  cpSync(join(ROOT, 'scripts/revisar-config.mjs'), join(dir, 'scripts/revisar-config.mjs'));
  return dir;
}
function configurar(dir, answers, users) {
  const log = join(dir, 'llamadas.log');
  const deployed = join(dir, 'publicado.toml');
  const result = spawnSync(process.execPath, ['scripts/configurar.mjs'], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      ENLACE_WRANGLER: `${process.execPath} ${fake}`,
      ENLACE_RESPUESTAS: JSON.stringify(answers),
      ENLACE_CONFIG_DIR: memoryDir,
      FAKE_LOG: log,
      FAKE_DEPLOYED: deployed,
      FAKE_USERS: JSON.stringify(users),
    },
  });
  return { ...result, deployed: existsSync(deployed) ? readFileSync(deployed, 'utf8') : null, calls: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

// Primera vez: escribe mal su correo; como nunca entró a Enlace, se le advierte y lo corrige.
const primera = configurar(freshFolder(), ['rodrigo@gmail.con', 'no', 'rodrigo@correo.buap.mx', 'https://enlace.enlace-academia.workers.dev'], ['rodrigo@correo.buap.mx', 'ana@alumno.buap.mx']);
assert.equal(primera.status, 0, primera.stdout + primera.stderr);
assert.match(primera.stdout, /rodrigo@gmail\.con nunca ha entrado a Enlace/);
assert.deepEqual(configProblems(primera.deployed), [], 'Se publicó con la base y el correo reales');
assert.match(primera.deployed, /AULA_OWNER_EMAIL = "rodrigo@correo\.buap\.mx"/);
assert.deepEqual(JSON.parse(readFileSync(join(memoryDir, 'configuracion.json'), 'utf8')), {
  databaseId: DB_ID,
  owner: 'rodrigo@correo.buap.mx',
  url: 'https://enlace.enlace-academia.workers.dev',
});
checks += 5;

// Versión nueva descomprimida en otra carpeta: no pregunta nada y publica con los mismos datos.
const nueva = configurar(freshFolder(), [], ['rodrigo@correo.buap.mx']);
assert.equal(nueva.status, 0, nueva.stdout + nueva.stderr);
assert.match(nueva.stdout, /Se usa el correo de la vez anterior: rodrigo@correo\.buap\.mx/);
assert.match(nueva.deployed, /AULA_OWNER_EMAIL = "rodrigo@correo\.buap\.mx"/);
assert.match(nueva.deployed, new RegExp(`database_id = "${DB_ID}"`));
checks += 4;

// Sin memoria y con un correo que nunca entró: si confirma, se respeta su decisión (por ejemplo, otra cuenta).
writeFileSync(join(memoryDir, 'configuracion.json'), '{}');
const confirmado = configurar(freshFolder(), ['nueva@correo.buap.mx', 'sí', 'https://enlace.enlace-academia.workers.dev'], ['rodrigo@correo.buap.mx']);
assert.equal(confirmado.status, 0, confirmado.stdout + confirmado.stderr);
assert.match(confirmado.deployed, /AULA_OWNER_EMAIL = "nueva@correo\.buap\.mx"/);
checks += 2;

// Una respuesta con comillas no llega a la consulta de la base.
writeFileSync(join(memoryDir, 'configuracion.json'), '{}');
const comillas = configurar(freshFolder(), ["x'@y.mx"], ['rodrigo@correo.buap.mx']);
assert.notEqual(comillas.status, 0);
assert(!comillas.calls.includes('d1 execute'));
assert.equal(comillas.deployed, null);
checks += 3;

console.log(`PASS: ${checks} verificaciones de publicación — sin valores de ejemplo en deploy ni migraciones, correo verificado contra la base y datos recordados entre versiones.`);
