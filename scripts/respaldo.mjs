#!/usr/bin/env node
// Descarga una copia completa de la base de datos (estructura y datos) a la carpeta respaldos/.
//   npm run respaldo            → base principal
//   npm run respaldo:pruebas    → base del entorno de pruebas
// Incluye cursos, alumnos, calificaciones, asistencia y entregas. Los archivos adjuntos viven en R2 y no se copian.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const testing = process.argv.includes('--pruebas');
const database = testing ? 'enlace-pruebas-db' : 'enlace-db';
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'); // 2026-10-05-14-30 (hora UTC)
const file = `respaldos/${database}-${stamp}.sql`;
mkdirSync('respaldos', { recursive: true });

const args = ['wrangler', 'd1', 'export', database, '--remote', '--output', file, ...(testing ? ['--env', 'pruebas'] : [])];
console.log(`Descargando ${database}…`);
const result = spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
if (result.status !== 0) {
  console.error('\nNo se pudo crear el respaldo. Revisa tu conexión y que hayas iniciado sesión (npx wrangler login).');
  process.exit(1);
}
console.log(`\nRespaldo guardado en ${file}.\nCópialo también fuera de esta computadora (por ejemplo, a Google Drive).`);
