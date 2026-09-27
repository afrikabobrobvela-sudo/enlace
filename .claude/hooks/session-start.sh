#!/bin/bash
# Prepara las sesiones de Claude Code en la web: dependencias e interfaz compilada,
# para que `npm test` y cualquier suite suelta (node scripts/test-*.mjs) funcionen de inmediato.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# npm install (no npm ci): aprovecha la caché del contenedor y es idempotente.
npm install --no-audit --no-fund

# src/generated/assets.js (ignorado por git) lo necesitan worker.js y las pruebas que lo importan.
node scripts/build.mjs
