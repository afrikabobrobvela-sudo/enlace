@echo off
rem Doble clic para configurar y publicar Enlace en tu cuenta de Cloudflare.
cd /d "%~dp0"
where node >nul 2>nul || (echo Primero instala Node.js ^(version LTS^) desde https://nodejs.org y vuelve a abrir este archivo. & pause & exit /b 1)
node scripts\configurar.mjs
echo.
pause
