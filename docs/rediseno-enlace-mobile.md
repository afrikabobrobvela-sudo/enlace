# Rediseño local de Enlace Web · identidad Mobile

Rama: `codex/enlace-mobile-integracion`. Base: 12.49. Sin commit ni publicación.

## Archivos y alcance

- `src/public/coleccion.css`: sistema visual y ajustes responsive sobre las capas existentes.
- `src/public/auth.css`: confirmación independiente por correo con la misma paleta, tarjeta responsive y foco visible; esta página no carga la capa `coleccion.css`.
- `LEEME.md`: nota de uso y enlace a este informe.
- `docs/rediseno-enlace-mobile.md`: auditoría, resultados y pendientes.

`wrangler.toml` ya tenía cambios locales de la tarea anterior; se conservaron y no forman parte del rediseño. No se modificaron HTML, JavaScript, rutas, API, permisos, autenticación, D1, R2 ni migraciones. `src/generated/assets.js` solo se regeneró mediante el build, como exige el proyecto; está ignorado por Git.

La copia física modificada está en `C:\Users\fabian\enlace-web`, en la rama indicada. El espacio de trabajo virtual del IDE (`\afrikabobrobvela-sudo\enlace`) es otra ubicación; este trabajo no se publicó ni se transfirió mediante un commit. Para revisar el diff real, abrir la carpeta física o ejecutar `git -C C:\Users\fabian\enlace-web diff --stat`.

No se añadieron paquetes, fuentes remotas, frameworks ni librerías.

## Auditoría previa y decisiones

El orden efectivo en `index.html` es `styles.css` → `brightspace-layout.css` → `academic-tools.css` → `real.css` → `workspace.css` → `auth.css` → `fase1.css` → `contenido.css` → `fase2.css` → KaTeX → `tema.css` → `movil.css` → `coleccion.css`.

Las capas históricas redefinen repetidamente `.primary`, `.secondary`, `h1`, `.cards`, `.course-cover`, `.panel`, `.table-wrap`, `.home-tabs` y `.shell > header`. `coleccion.css` también tenía una segunda declaración de `--canvas` y sombras que anulaban su sistema inicial. Se reorganizaron esos valores en la capa final, sin eliminar hojas ni modificar su orden de carga.

Las reglas con IDs (`#topnav`, `#main h1`, `dialog#modal`) y las reglas con `!important` para portadas, objetivos táctiles, atributos `hidden`, columnas fijas y estados del libro requieren especial cuidado. Se conservaron las reglas funcionales de ocultación, examen y tablas. Los `!important` nuevos se limitan a anular tamaños, rellenos y estados visuales que las capas antiguas ya fijaban con esa prioridad, además de movimiento reducido y alto contraste.

`movil.css` controla hasta 720 px la barra inferior, el menú Más, los modales de pantalla completa, los campos de 16 px, el índice de unidades y las tablas convertidas a tarjetas. La capa final mantiene esos comportamientos y añade una adaptación entre 721 y 1100 px.

Se revisaron los componentes y selectores de los scripts públicos. Ejemplos que se mantienen intactos:

- Estructura: `#main`, `#topnav`, `#bottomnav`, `#sheet`, `#modal`, `#fields`, `#formSave`, `#profile`, `#bellPanel`.
- Cursos: `[data-course-card]`, `[data-course-search]`, `[data-course-filter]`, `[data-action]`, `[data-section]`, `[data-theme]`, `body[data-tomo]`.
- Navegación y estados: `.in-course`, `.signed-out`, `.has-bottomnav`, `.keyboard-open`, `.exam-running`, `.exam-platform-lock`, `.active`, `[hidden]`, `[aria-pressed]`.
- Calificaciones y asistencia: `.gradebook`, `.sticky-name`, `.gb-input`, `.category-grade-input`, `[data-heat]`, `.att-grid`, `[data-att-cell]`.

Alumno, docente y administración comparten encabezado, tarjetas, filtros, formularios, modales, tablas, botones y calendario. Sus diferencias ya se resuelven en JavaScript y en la API; el rediseño reutiliza ese HTML y no añade información ni cambia permisos. No fue necesario cambiar marcado ni lógica.

## Cambios visuales

| Área | Cambio |
| --- | --- |
| Sistema | Tokens centralizados de color, superficies, bordes, estados, radios, sombras, espacios, tipografía y duración. Archivo local con anchura normal en títulos. |
| Encabezado y navegación | Base azul marino estable, navegación clara con vidrio discreto, indicador activo subrayado, perfil y foco contrastados. |
| Mis cursos | Rejilla de tres columnas en escritorio, dos en tableta y una en teléfono; portadas degradadas con el color de cada curso; nombres sin truncado; periodos, roles y archivados distinguibles. Se mantienen imágenes personalizadas. |
| Acciones de curso | Menús sin recorte por el borde de la tarjeta; enlaces de acceso visibles también en teléfono. No se eliminaron acciones. |
| Alumno y pendientes | Mejor jerarquía de actividades por entregar, calificaciones nuevas y pendientes de revisión; vencidos con texto y borde además del color. Se conserva su posición. |
| Espacio de curso | Encabezado, unidades, materiales, noticias, foros, evaluaciones y paneles con el mismo lenguaje visual. Se conservan nombres y rutas de pestañas. |
| Calendario | Filtros agrupados, estado actual contrastado, agenda legible y fichas táctiles en la vista mensual móvil. |
| Administración | Tarjetas de estadísticas, filtros, solicitudes, catálogos, tablas de usuarios y enlaces administrativos coherentes. Acciones destructivas con color y separación propios. |
| Calificaciones y asistencia | Tipografía tabular, encabezados claros y foco visible. Se conservan fondos opacos, columnas fijas, colores por calificación, fechas, subrayados de reprobación y marcas de asistencia. |
| Formularios y modales | Bordes de campo contrastados, foco visible, errores legibles, cierre de 44 px y acciones separadas. El modal móvil continúa a pantalla completa. |
| Acceso | Panel de identidad marino/turquesa y botones de proveedor más legibles, sin modificar el flujo ni sus textos. |

## Responsive y accesibilidad

Implementación preparada para los cinco tamaños solicitados; **no se pudo certificar su renderizado real**, porque no había un navegador disponible en las herramientas de esta sesión.

| Tamaño solicitado | Reglas aplicables | Estado de revisión visual |
| --- | --- | --- |
| 360 × 800 | Una columna; controles ≥ 44 px de alto; formularios flexibles; menú y barra móvil existentes. | Pendiente |
| 390 × 844 | Misma composición móvil, con márgenes de área segura. | Pendiente |
| 768 × 1024 | Dos columnas de cursos; navegación superior sin posición fija; columnas internas más estrechas. | Pendiente |
| 1280 × 800 | Tres columnas de cursos; contenedor y paneles de escritorio. | Pendiente |
| 1440 × 900 | Contenedor de hasta 1360 px, con tres columnas y márgenes centrados. | Pendiente |

Se mantienen las tablas en tarjetas de `movil.js`; las matrices de calificaciones y asistencia siguen desplazándose dentro de su contenedor, con nombres fijos. Se añadieron `min-width: 0`, columnas `minmax(0, 1fr)`, ajuste de texto y límites de ancho; no se usó `overflow-x: hidden` en el cuerpo para esconder problemas. La ausencia de desbordamiento accidental requiere todavía medición en navegador.

Se conservan las etiquetas de estado y las señales adicionales al color. Se amplió el foco de controles que antes lo anulaban, incluidos los botones de asistencia y los menús del libro. Se mantienen los campos móviles de 16 px y las reglas de visibilidad por rol.

Contrastes calculados sobre los pares de color del sistema:

| Par | Relación |
| --- | --- |
| Texto principal / blanco | 15.70:1 |
| Texto secundario / superficie suave | 6.86:1 |
| Texto tenue / fondo | 5.35:1 |
| Blanco / botón primario | 8.46:1 |
| Enlace / fondo | 6.64:1 |
| Éxito / su fondo | 6.70:1 |
| Advertencia / su fondo | 6.81:1 |
| Error / su fondo | 6.34:1 |
| Foco / blanco | 5.25:1 |
| Borde de campo / blanco | 3.24:1 |
| Foco / encabezado marino | 6.54:1 |

Esto verifica los tokens indicados, no constituye una auditoría WCAG completa de todas las pantallas.

## Movimiento

Entrada por opacidad de tarjetas, paneles, modales y menús (140–220 ms). Transiciones de color, borde y sombra en controles. Carga por opacidad solo para estados explícitos (`aria-busy`, visor y guardado de calificaciones). Sin desplazamientos al pasar el cursor o presionar. `prefers-reduced-motion` desactiva animaciones y transiciones, incluida la animación anterior de la hoja móvil. Se añadieron reglas para colores forzados.

## Validación ejecutada

Todos los comandos se ejecutaron en `C:\Users\fabian\enlace-web`.

```powershell
npm run build
npm run dev
```

Resultado: 94 archivos, aproximadamente **1.49 MiB gzip**, frente al límite de 3 MiB y al umbral preventivo del build de 2.8 MiB. Solo se usaron los bindings locales.

Las ocho suites de UI se ejecutaron con:

```powershell
$uiTests = @(Get-ChildItem scripts/test-*-ui.mjs | Sort-Object Name)
foreach ($test in $uiTests) {
  node $test.FullName
  if ($LASTEXITCODE -ne 0) { throw "Falló $($test.Name)" }
}
```

| Suite | Resultado / cobertura |
| --- | --- |
| `test-admin-ui.mjs` | PASS · listas y panel de docentes, acciones y escape de nombres. |
| `test-auth-ui.mjs` | PASS · pantalla de acceso, proveedores, errores y ruta de retorno. |
| `test-fase1-ui.mjs` | PASS · 40 verificaciones de asistencia, equipos, visor, revisión y borradores. |
| `test-fase2-ui.mjs` | PASS · 18 verificaciones de QR, ZIP y riesgo. |
| `test-fase2b-ui.mjs` | PASS · 54 verificaciones de categorías, rúbricas, equipos y exportación. |
| `test-formato-ui.mjs` | PASS · 64 verificaciones de texto, imágenes, fórmulas y seguridad. |
| `test-movil-ui.mjs` | PASS · 58 verificaciones de rutas, Atrás, barra inferior, Más, tablas y notas. |
| `test-workspace-ui.mjs` | PASS · vistas docente/alumno, contenido, acciones y navegación. |

Además:

```powershell
node scripts/test-calendario.mjs
node scripts/test-auth.mjs
node scripts/test-teacher-files.mjs
git diff --check
```

Las tres suites adicionales pasaron: calendario y avisos (86 verificaciones), autenticación con proveedores simulados (82) y adjuntos docentes. Las pruebas de autenticación provocan deliberadamente errores como `no such table: aula_identities`, estados 401 y D1 caída; son casos negativos esperados del test en memoria, no errores de la D1 local.

También se validaron las 13 hojas CSS con el `esbuild` ya instalado, sin advertencias, y se calcularon los contrastes anteriores mediante un script Node temporal. Un primer intento de ese comando falló por el tratamiento de comillas de PowerShell; se corrigió enviándolo por stdin y terminó correctamente.

Verificaciones HTTP: `/` responde 200; `/coleccion.css` responde 200 y coincide exactamente con el archivo fuente; `/api/me` sin cookie responde 401 esperado; `/auth/google/start` responde 302. Las pruebas automatizadas usan entornos en memoria y no escriben en D1/R2 de producción.

Durante la revisión había dos instancias de Wrangler: una en 8787 y otra en 8788 compartiendo persistencia, y apareció `SQLITE_BUSY` al recargar. Se detuvieron esas instancias locales y se dejó una sola mediante `npm run dev` en **http://localhost:8787/**. No se borró ni migró la base de datos.

## Pendientes y límites

1. Revisar visualmente las pantallas de alumno, docente y administración en los cinco tamaños indicados. La herramienta de navegador devolvió inventario vacío; tanto Chrome como el navegador integrado estaban indisponibles. La URL local sí era accesible por HTTP.
2. Verificar en navegador clics, foco/teclado, modales, filtros, cambio de pestañas, desplazamiento de tablas y ausencia de desbordamiento horizontal. Las suites existentes ejercitan funciones y HTML mediante DOM simulado; no miden layout ni pintan CSS.
3. Revisar la consola del navegador después de recorrer las pantallas. No puede afirmarse que esté libre de errores sin esa inspección.
4. Completar una comprobación manual del login real de Google después del rediseño. Las pruebas de OAuth pasaron con respuestas externas simuladas; el flujo real no fue recorrido por el agente.
5. Comparar con los dos videos mencionados: no estaban incluidos en el adjunto. No hay capturas antes/después de esta sesión.

No se identificó una necesidad de cambiar lógica para los ajustes implementados. Este trabajo queda listo para revisión local; la certificación visual sigue pendiente. No se ejecutó deploy, migración remota, `npm audit fix --force` ni commit.
