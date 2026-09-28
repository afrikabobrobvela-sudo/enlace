#!/usr/bin/env node
// Detiene la publicación si wrangler.toml todavía tiene los valores de ejemplo del ZIP.
//
// Cada versión nueva trae wrangler.toml con marcadores (el repositorio es público): si se publica así, el
// Worker queda con AULA_OWNER_EMAIL = "tu-correo@gmail.com" y nadie tiene la cuenta de administración.
// `npm run configurar` rellena los marcadores; este programa protege los atajos (`npm run deploy`,
// `npm run db:migrate`) para que no se publique ni se migre con ellos.
//
//   node scripts/revisar-config.mjs            → configuración principal
//   node scripts/revisar-config.mjs --pruebas  → entorno de pruebas
import { readFileSync } from 'node:fs';

export const PLACEHOLDER_EMAIL = 'tu-correo@gmail.com';

/** Problemas de configuración de una sección de wrangler.toml (arreglo vacío si está lista para publicar). */
export function configProblems(toml, { testing = false } = {}) {
  // La sección principal termina donde empieza [env.pruebas]; la de pruebas es lo que sigue.
  const start = toml.search(/^\[env\.pruebas\]/m);
  const section = testing ? (start < 0 ? '' : toml.slice(start)) : start < 0 ? toml : toml.slice(0, start);
  const value = (key) => section.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1];
  const problems = [];
  const databaseId = value('database_id');
  if (!databaseId || databaseId.startsWith('PEGA_AQUI') || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId)) {
    problems.push(`database_id no es el de tu base (dice "${databaseId || ''}").`);
  }
  const owner = value('AULA_OWNER_EMAIL');
  if (!owner || owner === PLACEHOLDER_EMAIL || !/^[^\s@"']+@[^\s@"']+\.[^\s@"']+$/.test(owner)) {
    problems.push(`AULA_OWNER_EMAIL no es tu correo de administración (dice "${owner || ''}").`);
  }
  return problems;
}

if (process.argv[1]?.endsWith('revisar-config.mjs')) {
  const testing = process.argv.includes('--pruebas');
  const problems = configProblems(readFileSync('wrangler.toml', 'utf8'), { testing });
  if (problems.length) {
    console.error(`\n✗ Se detuvo: wrangler.toml tiene valores de ejemplo${testing ? ' en el entorno de pruebas' : ''}.\n`);
    for (const p of problems) console.error('   · ' + p);
    console.error(
      testing
        ? '\n   Rellena la sección [env.pruebas] como indica LEEME.md → "Entorno de pruebas".\n'
        : '\n   Esto pasa al descomprimir una versión nueva. Usa:  npm run configurar\n   (recuerda tu base y tu correo, y no te pregunta lo que ya sabe).\n',
    );
    process.exit(1);
  }
}
