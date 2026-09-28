# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Enlace es un LMS (estilo Brightspace) **en producción, con datos reales de estudiantes**, para docentes y alumnos de cualquier academia (nació en la Academia de Física de la BUAP). Responsable: Dr. Rodrigo Vela Vázquez. Todo lo que ven las personas usuarias (interfaz, mensajes de error de la API, correos) va **en español de México**; el código y sus comentarios también están en español. `LEEME.md` es la documentación para el responsable (despliegue, respaldos, novedades por versión): actualízala cuando cambie algo que él deba saber.

Producción: https://enlace.enlace-academia.workers.dev/ (cuenta de Cloudflare del responsable; en esta sesión no hay credenciales de Cloudflare, así que nunca se despliega desde aquí: se entrega el código y él publica con `npm run configurar`).

## Reglas de trabajo (del responsable)

- Nunca borrar ni reescribir tablas de D1 remoto sin respaldo y confirmación explícita. Las migraciones deben ser **no destructivas** (agregar tablas/columnas; copiar en vez de mover). `npm run db:migrate` y `npm run configurar` ya descargan un respaldo antes de migrar.
- Probar en local (`wrangler dev` con D1 local) antes de proponer un despliegue; cambios pequeños y verificables, y explicar cada despliegue.
- Secretos solo con `wrangler secret put` (`SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, opcional `RESEND_API_KEY`); en local van en `.dev.vars` (ignorado por git). El repositorio es público.
- Plan gratuito de Cloudflare: máximo **50 consultas D1 por solicitud** (las pruebas lo vigilan con `store.counter.queries`), 100 parámetros por consulta (por eso las altas masivas usan `json_each(?)`), Worker ≤ 3 MB comprimido (`scripts/build.mjs` falla si se acerca), sin tiempo de CPU para procesar archivos grandes en el servidor (ZIP y compresión de fotos se hacen en el navegador).

## Comandos

```bash
npm install
npm test                         # compila la interfaz y corre todas las suites (≈18)
node scripts/build.mjs           # obligatorio antes de correr una suite suelta o wrangler dev
node scripts/test-papelera.mjs   # una sola suite (las de servidor usan SQLite en memoria vía node:sqlite)
npm run dev                      # build + wrangler dev en http://localhost:8787 (requiere .dev.vars)
npm run db:migrate:local         # migraciones en la D1 local de wrangler dev
npx drizzle-kit generate --name <nombre>   # nueva migración a partir de db/schema.ts (revisa el SQL)
```

No hay linter ni TypeScript en tiempo de ejecución (`db/schema.ts` solo documenta el esquema para drizzle-kit). CI (`.github/workflows/pruebas.yml`) corre `npm install && npm test` en cada push.

Para `wrangler dev` sin tocar el `wrangler.toml` versionado: sustituye temporalmente `PEGA_AQUI_EL_ID_DE_TU_BASE` por cualquier UUID y restáuralo al terminar (nunca subas un `database_id` real ni el correo real). Para entrar sin Google en local, inserta un usuario y una fila en `aula_logins` en la D1 local y firma una cookie `__Host-enlace_session` con `signToken({ uid, sid, ver, exp }, SESSION_SECRET)` de `src/server/http.js`; en Chromium se puede fijar con `document.cookie` sobre `http://localhost:8787` (el prefijo `__Host-` exige contexto seguro; localhost lo es).

## Arquitectura

- **Un solo Worker** (`src/worker.js`): `/api/*` → `src/server/api.js`, `/auth/*` → `src/server/auth.js`, todo lo demás se sirve desde `src/generated/assets.js`, que `scripts/build.mjs` genera incrustando `src/public/` (no se edita a mano; está en `.gitignore`). No hay framework ni empaquetador en el frontend: scripts clásicos con `defer`, en el orden de `src/public/index.html`, que comparten globales (`current`, `me`, `section`, `request()`, `esc()`, `modal()`, `render()`…). Un archivo nuevo de `src/public/` debe agregarse a `index.html` **y** a los `vm.runInContext`/`browser.load` de las pruebas de interfaz que cargan los scripts a mano.
- **Rutas de la API**: mapas `'MÉTODO /ruta': handler(ctx)` en `api.js`, `attendance.js` y `grading.js`; `api()` resuelve la identidad, exige mismo origen + cabecera `X-Aula-Request: 1` en todo lo que no sea GET (CSRF), y convierte `fail(mensaje, status)` en JSON `{ error }`. Validación y helpers de D1 (`one`, `all`, `run`, `text`, `email`, `readJson`) en `http.js`.
- **Identidad**: cookie firmada con HMAC que lleva `uid`, `sid` y `ver`; `identity()` exige una fila vigente en `aula_logins` (sesión revocable por dispositivo) y que `ver` coincida con `aula_users.session_version` (subirla cierra todas las sesiones). Acceso con Google (OIDC); el enlace por correo solo se activa con Resend y dominio propio. Las cabeceras `oai-*` de ChatGPT Sites (versión 8) se ignoran a propósito.
- **Roles**: globales `admin` / `teacher` / `student`; la fuente de verdad es `AULA_OWNER_EMAIL` (cuenta principal, en `wrangler.toml`) más la tabla `aula_teachers`, y se relee en cada solicitud. Por curso, `access()` en `access.js` decide `teach` (admin, propietario que **siga siendo docente** — `ownsCourse` — o miembro con rol `teacher`) y bloquea a miembros `removed` y cursos en `aula_deleted_courses`. Toda ruta que recibe `course` debe pasar por `access()` y, si modifica, por `requireTeacher()`; los registros se buscan siempre con `id=? AND course=?`.
- **Datos**: dos generaciones conviven.
  - `aula_records` guarda como JSON en `data` las unidades, materiales, noticias, foros, publicaciones, equipos y evaluaciones (`kind`); control de concurrencia con `revision` (409 si cambió).
  - Actividades, entregas, calificaciones, ponderaciones, categorías, rúbricas, intentos y asistencia están en tablas normalizadas con CHECK y llaves foráneas (`aula_tasks`, `aula_submissions`, …); `gradebook.js` las devuelve al frontend con la forma de registro `{ id, kind, data, revision }` de la versión 8, así el frontend trata todo como `current.records`.
  - Papelera: `deleted_at` en `aula_records` y `aula_tasks`; **cualquier consulta nueva sobre esas tablas debe filtrar `deleted_at IS NULL`** (y las entregas, por actividad no eliminada).
  - `GET /api/course` entrega todo el curso en una sola respuesta, ya filtrado por rol (el alumno no recibe respuestas correctas, borradores de calificación, correos/matrículas ajenas ni archivos que no puede ver).
- **Vista como alumno**: `?as=student` en `GET /api/course` y `GET /api/attendance` (`viewAs()` en `access.js`) hace que quien enseña reciba los datos con los filtros de alumno (`viewer` null: sin entregas propias). En el frontend, `previewAsStudent` agrega el parámetro (`viewSuffix()`) y `request()` rechaza cualquier escritura mientras está activa; las subidas también se bloquean.
- **Registro de docentes** (`src/server/directory.js`, `src/public/registro.js`): catálogo de academias y unidades académicas (lo edita la administración), solicitudes para ser docente (solo correos de `TEACHER_EMAIL_DOMAINS`, por omisión `correo.buap.mx`) que la administración aprueba o rechaza, y `academy_id`/`unit_id` en `aula_users` y `aula_courses`. `/api/me` incluye el estado del registro (`needsClassification`, `canRequestTeacher`, `teacherRequest`, `pendingTeacherRequests`).
- **Archivos**: R2 con id aleatorio; metadatos en `aula_files` (`scope` material/entrega). La descarga (`downloadFile`) verifica que el archivo esté enlazado desde una unidad/material/actividad visible y no eliminada, o sea del propio alumno o de su equipo. La vista previa (`?preview=1`) detecta el tipo real por los primeros bytes y sirve con `sandbox`. Cuotas: 300 MB por alumno y curso, 9 GB en total.
- **Texto con formato** (`src/public/richtext.js`): el contenido se guarda como texto con marcas tipo Markdown y se convierte a HTML en el navegador con `richText(texto, fileIds)`: escapa todo primero, aparta fórmulas LaTeX (KaTeX las dibuja después, `math.js`) y solo genera enlaces http(s) e imágenes de archivos del propio elemento. `scripts/test-formato-ui.mjs` tiene los casos de XSS: amplíalos si tocas el formato.
- **Estilos**: capas históricas (`styles.css` → … → `fase2.css`) y encima `tema.css` (cargado al final) con los tokens de diseño; ajusta la apariencia en `tema.css` en lugar de editar las capas viejas. Hay reglas antiguas con `!important` y un `aside { position: fixed }` global: no uses `<aside>`.
