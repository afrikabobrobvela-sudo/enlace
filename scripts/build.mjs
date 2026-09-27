// Incrusta la interfaz (src/public, incluidas las bibliotecas de src/public/vendor) en src/generated/assets.js.
// Los archivos binarios (fuentes, WebAssembly) se guardan en base64.
// Wrangler empaqueta después src/worker.js con todos sus módulos al ejecutar `wrangler deploy` o `wrangler dev`.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = 'src/public';
const BINARY = new Set(['woff2', 'wasm', 'png', 'jpg', 'ico']);

async function* walk(dir) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

const assets = {};
for await (const path of walk(ROOT)) {
  const name = relative(ROOT, path).split('\\').join('/');
  const extension = name.split('.').pop();
  assets[name] = BINARY.has(extension) ? { base64: (await readFile(path)).toString('base64') } : { text: await readFile(path, 'utf8') };
}

await mkdir('src/generated', { recursive: true });
const source =
  '// Archivo generado por scripts/build.mjs. No lo edites: cambia src/public y vuelve a compilar.\n' +
  `export const assets = ${JSON.stringify(assets)};\n`;
await writeFile('src/generated/assets.js', source);
const compressed = gzipSync(source).length;
console.log(`Interfaz incrustada: ${Object.keys(assets).length} archivos, ${(compressed / 1024 / 1024).toFixed(2)} MB comprimidos (límite del plan gratuito: 3 MB).`);
if (compressed > 2.8 * 1024 * 1024) {
  console.error('La interfaz se acerca al límite de 3 MB del plan gratuito de Workers.');
  process.exit(1);
}
