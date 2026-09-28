#!/usr/bin/env node
// Restaura un respaldo de la base (respaldos/*.sql) en una base NUEVA de Cloudflare D1.
//
//   npm run restaurar -- respaldos/enlace-db-2026-10-05-14-30.sql
//   npm run restaurar -- respaldos/ARCHIVO.sql --destino enlace-db-restaurada
//
// - Nunca escribe sobre una base con datos: si la base destino ya tiene tablas de Enlace, se detiene.
// - Antes de subir nada, comprueba el respaldo en esta computadora (se carga completo en una base temporal).
// - La exportación de D1 no se puede cargar tal cual en una base vacía (las llaves foráneas apuntan a tablas que
//   se crean después); aquí se reordena (scripts/lib/dump.mjs) y se guarda junto al original como .restaurable.sql.
// Para errores recientes conviene más D1 Time Travel (LEEME.md → Respaldos): regresa la base a un minuto dado.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { orderDump, verifyDump } from './lib/dump.mjs';

const isWindows = process.platform === 'win32';
const WRANGLER = (process.env.ENLACE_WRANGLER || 'npx wrangler').split(' ');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const local = args.includes('--local'); // simulacro en la base local de wrangler dev
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--destino');
const target = option('--destino', local ? 'DB' : 'enlace-db-restaurada');
const where = local ? '--local' : '--remote';

function stop(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}
function wrangler(list, { capture = true } = {}) {
  const [command, ...prefix] = WRANGLER;
  const result = spawnSync(command, [...prefix, ...list], { shell: isWindows, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  return { status: result.status, stdout: result.stdout || '', output: `${result.stdout || ''}\n${result.stderr || ''}` };
}
/** Una consulta de solo lectura en la base destino; devuelve la primera fila o null. */
function query(sql) {
  // Solo la salida estándar: los avisos de wrangler (en la salida de errores) también llevan corchetes.
  const { status, stdout } = wrangler(['d1', 'execute', target, where, '--json', '--command', isWindows ? `"${sql}"` : sql]);
  if (status !== 0) return null;
  try {
    return JSON.parse(stdout.slice(stdout.indexOf('['), stdout.lastIndexOf(']') + 1))[0].results[0];
  } catch {
    return null;
  }
}

if (!file) stop('Indica el respaldo. Por ejemplo:  npm run restaurar -- respaldos/enlace-db-2026-10-05-14-30.sql');
if (!existsSync(file)) stop(`No existe el archivo ${file}.`);
if (!/^[A-Za-z0-9_-]{1,64}$/.test(target)) stop('Nombre de base destino no válido.');
if (!local && target === 'enlace-db') stop('Por seguridad no se restaura sobre enlace-db. Usa una base nueva (--destino enlace-db-restaurada).');

console.log('── 1. Revisando el respaldo en esta computadora…');
const sql = readFileSync(file, 'utf8');
let counts;
try {
  counts = await verifyDump(sql);
} catch (error) {
  stop(`El respaldo no se puede restaurar: ${error.message}`);
}
const n = (t) => counts[t] ?? 0;
console.log(
  `   ✓ Se puede restaurar: ${n('aula_users')} usuarios, ${n('aula_courses')} cursos, ${n('aula_members')} inscripciones, ` +
    `${n('aula_submissions')} entregas y calificaciones, ${n('aula_attendance')} registros de asistencia, ${n('aula_files')} archivos registrados.`,
);
const ordered = file.replace(/\.sql$/i, '') + '.restaurable.sql';
writeFileSync(ordered, orderDump(sql).sql);

console.log(`── 2. Base destino: ${target} (${local ? 'local' : 'Cloudflare'})`);
if (!local) {
  const list = wrangler(['d1', 'list', '--json']);
  if (list.status !== 0) stop('No se pudo consultar Cloudflare. Revisa tu conexión y que hayas iniciado sesión (npx wrangler login).');
  if (!list.stdout.includes(`"${target}"`)) {
    const toml = existsSync('wrangler.toml') ? readFileSync('wrangler.toml', 'utf8') : null;
    const created = wrangler(['d1', 'create', target]);
    if (toml !== null) writeFileSync('wrangler.toml', toml); // algunas versiones de wrangler la agregan solas
    if (created.status !== 0) stop(`No se pudo crear la base ${target}:\n${created.output.trim()}`);
    console.log(`   ✓ Base ${target} creada`);
  }
}
const existing = query("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'aula_%'");
if (!existing) stop(`No se pudo consultar la base ${target}.`);
if (existing.n > 0) stop(`La base ${target} ya tiene datos (${existing.n} tablas de Enlace). Por seguridad solo se restaura en una base vacía.`);
console.log('   ✓ Está vacía');

console.log('── 3. Cargando el respaldo (puede tardar unos minutos)…');
if (wrangler(['d1', 'execute', target, where, '--file', ordered, '--yes'], { capture: false }).status !== 0) stop('No se pudo cargar el respaldo.');

console.log('── 4. Comprobando…');
const tables = ['aula_users', 'aula_courses', 'aula_members', 'aula_submissions', 'aula_attendance', 'aula_files', 'aula_records'].filter((t) => t in counts);
const loaded = query(`SELECT ${tables.map((t) => `(SELECT count(*) FROM ${t}) AS ${t}`).join(', ')}`);
if (!loaded) stop('No se pudo comprobar la base restaurada.');
const differ = tables.filter((t) => loaded[t] !== counts[t]);
if (differ.length) stop(`La base restaurada no coincide con el respaldo en: ${differ.join(', ')}.`);
console.log('   ✓ Todas las tablas tienen las mismas filas que el respaldo');

console.log(
  local
    ? '\n✓ Simulacro terminado en la base local.\n'
    : `
✓ Respaldo restaurado en ${target}. Enlace todavía usa la base anterior.

   Para cambiar Enlace a la base restaurada:
   1. Abre wrangler.toml y, en la primera sección [[d1_databases]], cambia
        database_name = "${target}"
        database_id   = (el id que aparece con: npx wrangler d1 list)
   2. Publica:  npm run deploy
   3. Si también se perdieron archivos: Reportes → Respaldo de archivos → «Restaurar archivos que falten…».
`,
);
