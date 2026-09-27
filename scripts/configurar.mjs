#!/usr/bin/env node
// Configura y publica Enlace en tu cuenta de Cloudflare.
// Puedes ejecutarlo las veces que quieras: salta lo que ya está hecho.
//
//   Windows: doble clic en configurar.cmd     Mac: doble clic en configurar.command
//   o bien, en una terminal:  npm run configurar

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import readline from 'node:readline';

const DB_NAME = 'enlace-db';
const BUCKET = 'enlace-archivos';
const TOML = 'wrangler.toml';
const URL_FILE = '.enlace-url';
const PLACEHOLDER_EMAIL = 'tu-correo@gmail.com';
const PLACEHOLDER_DB = 'PEGA_AQUI_EL_ID_DE_TU_BASE';
const isWindows = process.platform === 'win32';
// Para pruebas: ENLACE_WRANGLER permite usar un wrangler simulado; ENLACE_RESPUESTAS, respuestas fijas.
const WRANGLER = (process.env.ENLACE_WRANGLER || 'npx wrangler').split(' ');
const scripted = process.env.ENLACE_RESPUESTAS ? JSON.parse(process.env.ENLACE_RESPUESTAS) : null;

let stepNumber = 0;
const step = (title) => console.log(`\n── ${++stepNumber}. ${title}`);
const ok = (message) => console.log(`   ✓ ${message}`);
function stop(message) {
  console.log(`\n✗ ${message}\n\nCuando lo resuelvas, vuelve a abrir este programa: continuará donde se quedó.`);
  process.exit(1);
}

/** Ejecuta wrangler. `capture` guarda la salida; `input` la envía por la entrada estándar (para secretos). */
function wrangler(args, { capture = false, input } = {}) {
  const [command, ...prefix] = WRANGLER;
  const stdio = input !== undefined ? ['pipe', 'inherit', 'inherit'] : capture ? ['ignore', 'pipe', 'pipe'] : 'inherit';
  const result = spawnSync(command, [...prefix, ...args], { shell: isWindows, encoding: 'utf8', stdio, input });
  return { status: result.status, output: `${result.stdout || ''}\n${result.stderr || ''}` };
}

function runNode(script) {
  return spawnSync(process.execPath, [script], { stdio: 'inherit' }).status === 0;
}

function prompt(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    if (hidden && process.stdin.isTTY) {
      rl._writeToOutput = (text) => rl.output.write(text.includes(question) ? text : text.replace(/[^\r\n]/g, '•'));
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden && process.stdin.isTTY) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function ask(question, validate, { hidden = false } = {}) {
  for (;;) {
    const raw = scripted ? scripted.shift() : await prompt(`   ${question} `, hidden);
    if (raw === undefined) stop('Faltó una respuesta.');
    const answer = raw.trim();
    const problem = validate(answer);
    if (!problem) return answer;
    console.log(`   ${problem}`);
    if (scripted) stop(problem);
  }
}

const readToml = () => readFileSync(TOML, 'utf8');
const tomlValue = (text, key) => text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1];

/**
 * Rellena solo los marcadores de wrangler.toml y deja intacto todo lo demás
 * (entorno de pruebas, dominios permitidos, comentarios y cualquier cambio tuyo).
 */
function patchToml({ databaseId, owner }) {
  const text = readToml()
    .replace(`database_id = "${PLACEHOLDER_DB}"`, `database_id = "${databaseId}"`)
    .replaceAll(`AULA_OWNER_EMAIL = "${PLACEHOLDER_EMAIL}"`, `AULA_OWNER_EMAIL = "${owner}"`);
  writeFileSync(TOML, text);
}

/** Busca la base por nombre. Devuelve su id o null. */
function findDatabase() {
  const { status, output } = wrangler(['d1', 'list', '--json'], { capture: true });
  if (status !== 0) return null;
  try {
    const list = JSON.parse(output.slice(output.indexOf('['), output.lastIndexOf(']') + 1));
    const db = list.find((d) => d.name === DB_NAME);
    return db ? db.uuid || db.database_id || db.id : null;
  } catch {
    return null;
  }
}

function secretNames() {
  const { status, output } = wrangler(['secret', 'list'], { capture: true });
  return status === 0 ? new Set([...output.matchAll(/"name"\s*:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1])) : new Set();
}

function putSecret(name, value) {
  if (wrangler(['secret', 'put', name], { input: value + '\n' }).status !== 0) stop(`No se pudo guardar ${name}.`);
  ok(`${name} guardado`);
}

// ────────────────────────────────────────────────────────────────────────────────────────────

console.log('Enlace · configuración en tu cuenta de Cloudflare');

step('Comprobando esta computadora');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) stop(`Tienes Node.js ${process.versions.node}. Instala la versión LTS desde https://nodejs.org.`);
if (!existsSync(TOML) || !existsSync('src/worker.js')) stop('Ejecuta este programa desde la carpeta Enlace.');
if (!process.env.ENLACE_WRANGLER && !existsSync('node_modules/wrangler')) {
  console.log('   Instalando herramientas (solo la primera vez, tarda unos minutos)…');
  if (spawnSync('npm', ['install'], { stdio: 'inherit', shell: isWindows }).status !== 0) stop('Falló "npm install". Revisa tu conexión a internet.');
}
ok(`Node.js ${process.versions.node}`);

step('Cuenta de Cloudflare');
const needsLogin = () => /not authenticated|not logged in/i.test(wrangler(['whoami'], { capture: true }).output);
if (needsLogin()) {
  console.log('   Se abrirá tu navegador: entra a Cloudflare (o crea una cuenta gratuita) y pulsa "Allow".');
  wrangler(['login']);
  if (needsLogin()) stop('No se completó el inicio de sesión en Cloudflare.');
}
ok('Sesión iniciada');

step('Base de datos');
let databaseId = tomlValue(readToml(), 'database_id');
if (!databaseId || databaseId.startsWith('PEGA_AQUI')) {
  databaseId = findDatabase();
  if (!databaseId) {
    // Algunas versiones de wrangler agregan la base a wrangler.toml por su cuenta; se restaura el archivo.
    const before = readToml();
    const created = wrangler(['d1', 'create', DB_NAME], { capture: true });
    writeFileSync(TOML, before);
    databaseId = created.output.match(/database_id["'\s:=]+"?([0-9a-f]{8}-[0-9a-f-]{27})/i)?.[1] || findDatabase();
    if (!databaseId) stop(`No se pudo crear la base de datos:\n${created.output.trim()}`);
  }
}
ok(`${DB_NAME} (${databaseId})`);

step('Almacenamiento de archivos');
if (!wrangler(['r2', 'bucket', 'list'], { capture: true }).output.includes(BUCKET)) {
  const created = wrangler(['r2', 'bucket', 'create', BUCKET], { capture: true });
  if (created.status !== 0 && !/already exists/i.test(created.output)) {
    if (/enable R2|10042/i.test(created.output)) {
      stop('R2 no está activo en tu cuenta. Entra a https://dash.cloudflare.com, abre la sección "R2" y actívalo\n  (puede pedir una tarjeta aunque no rebases el nivel gratuito).');
    }
    stop(`No se pudo crear el almacenamiento:\n${created.output.trim()}`);
  }
}
ok(BUCKET);

step('Cuenta de administración');
const previous = readToml();
let owner = tomlValue(previous, 'AULA_OWNER_EMAIL');
if (!owner || owner === PLACEHOLDER_EMAIL) {
  owner = (
    await ask('Correo de tu cuenta de Google (con él entrarás como administración):', (a) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a) ? '' : 'Escribe un correo válido.',
    )
  ).toLowerCase();
}
patchToml({ databaseId, owner });
ok(`${owner} (guardado en wrangler.toml)`);

step('Tablas de la base de datos');
console.log('   Si pregunta si deseas continuar, responde que sí (y).');
if (wrangler(['d1', 'migrations', 'apply', DB_NAME, '--remote']).status !== 0) stop('No se pudieron crear las tablas.');
ok('Tablas al día');

step('Publicación');
if (!runNode('scripts/build.mjs')) stop('Falló la compilación de la interfaz.');
console.log('   Si es tu primera publicación, Cloudflare te pedirá elegir un subdominio (por ejemplo, fisica-buap).');
if (wrangler(['deploy']).status !== 0) stop('No se pudo publicar.');
let siteUrl = existsSync(URL_FILE) ? readFileSync(URL_FILE, 'utf8').trim() : '';
if (!siteUrl) {
  siteUrl = (
    await ask('Copia aquí la dirección que termina en .workers.dev (aparece arriba):', (a) =>
      /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\/?$/i.test(a) ? '' : 'Debe verse así: https://enlace.tu-subdominio.workers.dev',
    )
  ).replace(/\/$/, '');
  writeFileSync(URL_FILE, siteUrl + '\n');
}
ok(`Publicado en ${siteUrl}`);

step('Claves');
let secrets = secretNames();
if (secrets.has('SESSION_SECRET')) ok('SESSION_SECRET ya existía (no se cambia para no cerrar sesiones)');
else putSecret('SESSION_SECRET', randomBytes(48).toString('base64url'));

step('Acceso con Google');
secrets = secretNames();
if (secrets.has('GOOGLE_CLIENT_ID') && secrets.has('GOOGLE_CLIENT_SECRET')) {
  ok('Ya estaba configurado');
} else {
  console.log(`
   Esta parte se hace en tu navegador (unos 5 minutos):

   1. Abre https://console.cloud.google.com y crea un proyecto llamado "Enlace BUAP".
   2. En el buscador de arriba escribe "Google Auth Platform" y ábrelo.
      · Branding: nombre "Enlace" y tu correo de soporte.
      · Audience: elige "External". Luego pulsa "Publish app" (o agrega tu correo en "Test users").
   3. En "Clients" pulsa "Create client", tipo "Web application", y en
      "Authorized redirect URIs" agrega exactamente estas dos direcciones:

        ${siteUrl}/auth/google/callback
        http://localhost:8787/auth/google/callback

   4. Pulsa "Create". Google te mostrará un Client ID y un Client secret.
`);
  const clientId = await ask('Pega el Client ID (termina en .apps.googleusercontent.com), o escribe "después":', (a) =>
    a === 'después' || a === 'despues' || /\.apps\.googleusercontent\.com$/.test(a) ? '' : 'El Client ID termina en .apps.googleusercontent.com',
  );
  if (clientId.startsWith('despu')) {
    console.log('\n   De acuerdo. Cuando tengas los datos de Google, vuelve a abrir este programa: saltará lo que ya está hecho.');
    process.exit(0);
  }
  const clientSecret = await ask('Pega el Client secret (no se mostrará al escribir):', (a) => (a.length >= 10 ? '' : 'Parece incompleto.'), {
    hidden: true,
  });
  putSecret('GOOGLE_CLIENT_ID', clientId);
  putSecret('GOOGLE_CLIENT_SECRET', clientSecret);
}

console.log(`
✓ Enlace está listo.

   Abre ${siteUrl}
   pulsa "Continuar con Google" y entra con ${owner}.
   En "Docentes" podrás dar de alta a tus colegas.
`);
