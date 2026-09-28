#!/usr/bin/env node
// Descarga una copia completa de la base de datos (estructura y datos) a la carpeta respaldos/.
//   npm run respaldo            → base principal
//   npm run respaldo:pruebas    → base del entorno de pruebas
// Incluye cursos, alumnos, calificaciones, asistencia y entregas. Los archivos adjuntos viven en R2 y no se copian:
// se respaldan desde Enlace (Reportes → Respaldo de archivos).
// Al terminar, el respaldo se comprueba cargándolo completo en una base temporal de esta computadora.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { verifyDump } from './lib/dump.mjs';

const testing = process.argv.includes('--pruebas');
const database = testing ? 'enlace-pruebas-db' : 'enlace-db';
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'); // 2026-10-05-14-30 (hora UTC)
const file = `respaldos/${database}-${stamp}.sql`;
mkdirSync('respaldos', { recursive: true });

// Por el binding (DB) y no por el nombre: sigue funcionando si Enlace usa una base restaurada con otro nombre.
const args = ['wrangler', 'd1', 'export', 'DB', '--remote', '--output', file, ...(testing ? ['--env', 'pruebas'] : [])];
console.log(`Descargando ${database}…`);
const result = spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
if (result.status !== 0) {
  console.error('\nNo se pudo crear el respaldo. Revisa tu conexión y que hayas iniciado sesión (npx wrangler login).');
  process.exit(1);
}
try {
  const counts = await verifyDump(readFileSync(file, 'utf8'));
  const n = (t) => counts[t] ?? 0;
  console.log(
    `\n✓ Respaldo comprobado: se puede restaurar completo (${n('aula_users')} usuarios, ${n('aula_courses')} cursos, ` +
      `${n('aula_submissions')} entregas y calificaciones, ${n('aula_attendance')} registros de asistencia).`,
  );
} catch (error) {
  console.error(`\n⚠ El respaldo se descargó, pero al comprobarlo falló: ${error.message}\n  Vuelve a intentarlo; si se repite, avisa antes de actualizar Enlace.`);
  process.exitCode = 1;
}
console.log(`\nRespaldo guardado en ${file}.\nCópialo también fuera de esta computadora (por ejemplo, a Google Drive), y respalda los archivos desde Enlace (Reportes → Respaldo de archivos).`);
