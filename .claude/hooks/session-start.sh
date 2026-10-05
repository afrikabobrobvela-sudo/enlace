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

# Plugin ECC (declarado en .claude/settings.json): la sesión en la nube no lo descarga sola.
# Si falla (red, GitHub caído), la sesión sigue sin él.
if command -v claude >/dev/null 2>&1 && ! grep -q '"ecc@ecc"' ~/.claude/plugins/installed_plugins.json 2>/dev/null; then
  claude plugin marketplace add affaan-m/ECC >/dev/null 2>&1 || true
  claude plugin install ecc@ecc --scope project >/dev/null 2>&1 || echo "Aviso: no se pudo instalar el plugin ECC." >&2
fi

# Habilidad graphify (grafo de conocimiento del código, paquete oficial `graphifyy` de PyPI).
# Si falla, la sesión sigue sin ella.
if ! command -v graphify >/dev/null 2>&1 && command -v uv >/dev/null 2>&1; then
  uv tool install 'graphifyy[sql]' >/dev/null 2>&1 || echo "Aviso: no se pudo instalar graphify." >&2
fi
if command -v graphify >/dev/null 2>&1 && [ ! -d ~/.claude/skills/graphify ]; then
  graphify install --platform claude >/dev/null 2>&1 || true
fi

# Comando de la habilidad playwright-cli (.claude/skills/playwright-cli). Por omisión busca Google Chrome; aquí se usa
# el Chromium que ya trae el contenedor (/opt/pw-browsers). Si falla, la sesión sigue sin él.
if ! command -v playwright-cli >/dev/null 2>&1; then
  npm install -g @playwright/cli@latest >/dev/null 2>&1 || echo "Aviso: no se pudo instalar playwright-cli." >&2
fi
if [ -x /opt/pw-browsers/chromium ] && [ ! -f ~/.playwright/cli.config.json ]; then
  mkdir -p ~/.playwright
  cat > ~/.playwright/cli.config.json <<'JSON'
{
  "browser": {
    "browserName": "chromium",
    "launchOptions": { "executablePath": "/opt/pw-browsers/chromium", "headless": true }
  }
}
JSON
fi
