#!/bin/bash
# Doble clic para configurar y publicar Enlace en tu cuenta de Cloudflare.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Primero instala Node.js (versión LTS) desde https://nodejs.org y vuelve a abrir este archivo."
  read -r -p "Pulsa Enter para cerrar."
  exit 1
fi
node scripts/configurar.mjs
echo
read -r -p "Pulsa Enter para cerrar."
