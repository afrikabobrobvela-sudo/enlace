---
name: Enlace
description: Aula virtual de la BUAP como una colección de divulgación científica; cada curso es un tomo con su tinta.
colors:
  tinta: "#111a2e"
  tinta-2: "#1d2942"
  senal: "#ffc414"
  ink-soft: "#3b475c"
  ink-faint: "#56627a"
  line: "#d8dde5"
  line-strong: "#b4bdca"
  surface: "#ffffff"
  canvas: "#f6f8fa"
  table-head: "#f4f6f9"
  alerta: "#b42318"
  cobalto: "#1f3fd1"
  cobalto-lomo: "#142b96"
  cobalto-papel: "#e8ecfb"
  verdete: "#0a6e60"
  verdete-lomo: "#064a40"
  verdete-papel: "#e2f1ee"
  granza: "#c0183f"
  granza-lomo: "#86102c"
  granza-papel: "#fbe7ec"
  ciruela: "#6a2c9e"
  ciruela-lomo: "#4a1e70"
  ciruela-papel: "#f0e8f7"
  ocre: "#b04a05"
  ocre-lomo: "#7a3303"
  ocre-papel: "#fbede2"
  musgo: "#4b6a0f"
  musgo-lomo: "#33490a"
  musgo-papel: "#edf2e1"
typography:
  display:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "clamp(34px, 5vw, 60px)"
    fontWeight: 800
    lineHeight: 0.98
    fontVariation: "'wdth' 70"
  headline:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "clamp(30px, 3.4vw, 44px)"
    fontWeight: 800
    lineHeight: 1.04
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 75"
  title:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "20px"
    fontWeight: 800
    fontVariation: "'wdth' 80"
  cover-title:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "clamp(24px, 2.4vw, 30px)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.015em"
    fontVariation: "'wdth' 72"
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontWeight: 400
    fontVariation: "'wdth' 100"
  label:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontWeight: 800
    letterSpacing: "0.04em"
    fontVariation: "'wdth' 85"
rounded:
  pill: "4px"
  sm: "6px"
  md: "8px"
spacing:
  card-gap: "20px"
  cover-pad: "16px 16px 18px 38px"
  spine: "18px"
  spine-hub: "26px"
components:
  button-primary:
    backgroundColor: "{colors.cobalto}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
  button-primary-hover:
    backgroundColor: "{colors.cobalto-lomo}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.sm}"
  button-secondary-hover:
    backgroundColor: "{colors.cobalto-papel}"
    textColor: "{colors.cobalto-lomo}"
  header-bar:
    backgroundColor: "{colors.tinta}"
    textColor: "{colors.surface}"
  tab-bar:
    backgroundColor: "{colors.cobalto-lomo}"
    textColor: "{colors.surface}"
  tab-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.cobalto-lomo}"
    rounded: "{rounded.sm}"
  course-cover:
    backgroundColor: "{colors.cobalto}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "{spacing.cover-pad}"
    height: "190px"
  badge-count:
    backgroundColor: "{colors.senal}"
    textColor: "{colors.tinta}"
  count-pill:
    backgroundColor: "{colors.tinta}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
  role-pill:
    backgroundColor: "{colors.cobalto-papel}"
    textColor: "{colors.cobalto-lomo}"
    rounded: "{rounded.pill}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.sm}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
  toast:
    backgroundColor: "{colors.tinta}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
---

# Design System: Enlace

## Overview

**Creative North Star: "La Colección de Divulgación"**

Enlace se ve como una colección de libros de divulgación científica: papel blanco frío, una tinta azul casi negra para el texto y la barra, y seis tintas planas de imprenta. Cada curso es un tomo con su propia tinta (cobalto, verdete, granza, ciruela, ocre o musgo, elegida con `data-theme` 1 a 6 y aplicada al curso abierto con `body[data-tomo]`). La tinta no salpica: llena regiones completas (la portada del tomo, la barra del curso, la pestaña activa, la acción principal).

Es una interfaz con energía, no calmada, pero densa y de trabajo: tablas de columnas fijas, cifras tabulares y títulos condensados pesados que ocupan poco ancho. Rechaza el LMS de tarjetas azul-turquesa, los mosaicos de métricas y las sombras suaves y difusas. Toda la capa vive en `src/public/coleccion.css`, cargada después de `tema.css` y `movil.css`; solo cambia la apariencia.

La marca son tres lomos horizontales que forman una E (cobalto, granza y verdete sobre un cuadro blanco de esquina 7 px), en la barra de `index.html` y en `login.js`.

**Key Characteristics:**
- Una tinta por tomo, con tres tonos: `--tomo` (plana), `--tomo-lomo` (oscura) y `--tomo-papel` (fondo claro).
- Texto blanco sobre cualquier tinta y lomo, siempre a más de 4.5:1.
- Archivo variable: condensada pesada para títulos y portadas, ancho normal para la interfaz.
- Filete de tinta de 2 px bajo títulos, encabezados de tabla y diálogos.
- Esquinas de 6 y 8 px; sombras cortas con desplazamiento, nunca difusas en reposo.

## Colors

Papel frío y tinta azul-negra, con seis tintas planas saturadas que solo existen dentro de las regiones del tomo.

### Primary (las tintas del tomo)
Cada tinta trae su lomo (hover, barra de pestañas, lomo de la portada) y su papel (fondos de selección, pastillas, avisos).
- **Cobalto** (#1f3fd1 / lomo #142b96 / papel #e8ecfb): tinta por omisión (`:root` y tema 1).
- **Verdete** (#0a6e60 / #064a40 / #e2f1ee): tema 2.
- **Granza** (#c0183f / #86102c / #fbe7ec): tema 3.
- **Ciruela** (#6a2c9e / #4a1e70 / #f0e8f7): tema 4.
- **Ocre** (#b04a05 / #7a3303 / #fbede2): tema 5.
- **Musgo** (#4b6a0f / #33490a / #edf2e1): tema 6.

Las capas viejas leen `--c1`, `--c2`, `--brand`, `--accent` y `--link`; `coleccion.css` las vuelve a declarar en cada elemento con tinta para que apunten a `--tomo`.

### Secondary
- **Amarillo de Señal** (#ffc414): solo contadores (`.badge-count`), la barra de vista previa y el reloj del examen en aviso. Tinta encima (10.9:1).
- **Rojo de Alerta** (#b42318): calificación baja en el libro y nada más.

### Neutral
- **Tinta de Colección** (#111a2e): texto, barra superior fuera de un curso, encabezado del intento, avisos emergentes, anillo de foco.
- **Tinta 2** (#1d2942): variante de la tinta.
- **Gris Pizarra** (#3b475c): texto secundario (`--ink-soft`).
- **Gris Nota** (#56627a): texto tenue, marcadores y pie (`--ink-faint`); no hay texto más claro que este.
- **Papel Frío** (#f6f8fa): fondo de la página (`--canvas`).
- **Blanco** (#ffffff): paneles y campos.
- **Encabezado de Tabla** (#f4f6f9): fondo de `th` y de guías.
- **Filete** (#d8dde5) y **Filete Fuerte** (#b4bdca): bordes de paneles y de campos.

### Named Rules
**The Tinta en Regiones Rule.** La tinta del tomo llena regiones completas (portada, barra, pestaña activa, botón principal, elemento activo del índice); no se usa como salpicadura decorativa ni en degradados.

**The Una Acción Rule.** Un solo color de acción por contexto: la tinta del tomo abierto (o cobalto fuera de un curso).

**The Señal Escasa Rule.** El amarillo #ffc414 solo marca lo que pide atención; nunca es fondo de sección ni decoración.

**The Cifra Neutra Rule.** En el libro las calificaciones aprobadas van en tinta (#111a2e), nunca en la tinta del tomo: con granza parecerían reprobadas. Solo la baja va en rojo (#b42318). Sin rellenos pastel en las celdas.

## Typography

**Display Font:** Archivo variable (pesos 100–900, ancho 62–125 %), con 'Arial Narrow' como respaldo.
**Body Font:** Archivo al 100 % de ancho, con ui-sans-serif y system-ui.

**Character:** Una sola familia en dos voces: condensada y pesada para títulos y portadas (como el lomo de un libro), normal para leer y trabajar. Se sirve local desde `src/public/vendor/archivo/` (latin y latin-ext).

### Hierarchy
- **Display** (800, clamp(34px, 5vw, 60px), 0.98, ancho 70 %): título del curso en la portada del tomo (`.hub-banner h1`); 34 px en el teléfono.
- **Headline** (800, clamp(30px, 3.4vw, 44px), 1.04, −0.02em, ancho 75 %): `h1` de cada pantalla, con filete de 2 px de la tinta; 30 px en el teléfono.
- **Título de portada** (800, clamp(24px, 2.4vw, 30px), 1.02, ancho 72 %): nombre del curso en el estante, blanco, hasta tres líneas.
- **Title** (800, 20px, ancho 80 %): `h2` de paneles; diálogos a 24 px y 78 %; `h2` genérico 750 al 85 %, `h3` 700 al 90 %.
- **Body** (400, ancho 100 %): todo el texto de interfaz; `word-spacing: 0.04em` porque el espacio de Archivo es angosto.
- **Label** (800, ancho 85 %, 0.04em): encabezados de tabla, con filete inferior de 2 px de tinta.

### Named Rules
**The Espacio Abierto Rule.** En anchos condensados (títulos, portadas, `th`) se abre el espacio entre palabras a 0.08em.

**The Cifra Tabular Rule.** Tablas, libro, reloj del examen y contadores usan `font-variant-numeric: tabular-nums`.

## Layout

La página es una columna (`.shell`) sobre papel frío (#f6f8fa): barra de tinta, barra de pestañas del lomo y contenido. Mis cursos es un estante de portadas con separación de 20 px. Las portadas reservan a la izquierda el lomo (18 px en el estante, 26 px en la portada del curso) y su relleno lo respeta (38 px en el estante, 58 px en la portada del curso).

Hasta 720 px la barra de pestañas se cambia por `#bottomnav` (blanco, con filete superior de 2 px de la tinta; la pestaña activa en el lomo sobre papel de la tinta), las portadas del estante se vuelven franjas de al menos 112 px con lomo de 14 px, y la portada del curso usa lomo de 18 px. En el celular, lo siguiente va primero.

## Elevation & Depth

Plano por omisión: los paneles se separan por filete (1 px #d8dde5) y una sombra corta con desplazamiento, sin difuminado.

### Shadow Vocabulary
- **Desplazamiento de panel** (`box-shadow: 0 2px 0 rgba(17, 26, 46, 0.1)`): paneles, tarjetas del inicio, tablas, entradas de material, unidades, acceso.
- **Portada en el estante** (`box-shadow: 0 2px 0 rgba(17, 26, 46, 0.14)`); al pasar el puntero, `0 3px 0` del lomo de la tinta.
- **Botón principal** (`box-shadow: 0 2px 0 var(--tomo-lomo), 0 3px 8px rgba(17, 26, 46, 0.16)`); al presionar baja a `0 1px 0`.
- **Diálogo y acceso** (`--shadow-lg: 0 14px 34px rgba(17, 26, 46, 0.2)`): solo lo que flota sobre la página.

### Named Rules
**The Desplazamiento Corto Rule.** Las superficies en la página se levantan con un desplazamiento de 2 a 3 px, no con un halo difuso; la sombra grande queda para diálogos.

**The Nada Se Mueve Rule.** Los estados se marcan con color y sombra, nunca con `transform` (las portadas anulan el `translate` de capas viejas).

## Shapes

Esquinas moderadas: 6 px (`--radius-sm`) en botones, campos, menús y avisos; 8 px (`--radius`) en paneles, portadas, diálogos y la caja de acceso; 4 px en pastillas y código de curso. Los filetes de tinta son de 2 px; los bordes de campos y del botón secundario de 1.5 px. El lomo es una franja rectangular a todo lo alto de la portada, con una sombra interior de 2 px.

## Components

### Buttons
- **Shape:** esquina de 6 px, peso 700.
- **Primary:** fondo de la tinta, borde de 1 px del lomo, texto blanco, sombra de desplazamiento del lomo. Hover: fondo del lomo.
- **Secondary:** fondo blanco, borde de 1.5 px de tinta, texto de tinta. Hover: papel de la tinta, borde de la tinta, texto del lomo.
- **Texto / enlace de tabla:** tinta del tomo, 700; hover al lomo con subrayado.
- **Focus:** contorno de 3 px de tinta con 2 px de separación; dentro de un curso, del lomo; en barras de tinta, blanco.
- **Disabled:** opacidad 0.55, sin sombra.

### Chips
- **Pastilla de rol / estado:** papel de la tinta con texto del lomo, esquina de 4 px, 700.
- **Pastilla de conteo:** tinta (#111a2e) con texto blanco.
- **Contador de avisos:** amarillo de señal con tinta, aro de 2 px del color de la barra.

### Cards / Containers
- **Corner Style:** 8 px.
- **Background:** blanco sobre papel frío.
- **Shadow Strategy:** desplazamiento de panel (ver Elevation).
- **Border:** 1 px #d8dde5.
- **Títulos:** `h2` condensado 800 a 20 px.

### Inputs / Fields
- **Style:** borde de 1.5 px #b4bdca, esquina de 6 px, marcador en #56627a.
- **Focus:** borde de la tinta y aro de 3 px del papel de la tinta; `accent-color` y `caret-color` de la tinta.

### Navigation
- **Barra superior:** tinta (#111a2e) en Mis cursos, la tinta del tomo dentro de un curso; transición de color de 0.45 s `cubic-bezier(0.16, 1, 0.3, 1)` (sin transición con movimiento reducido). Marca condensada 800 a 26 px en blanco.
- **Pestañas (`#topnav`):** fondo del lomo, texto blanco 600; hover blanco al 16 %; activa en bloque blanco con texto del lomo, 800.
- **Pestañas de pantalla (`.home-tabs`):** subrayado de la tinta, activa en 800.
- **Índice de unidades:** el elemento activo es un bloque lleno de la tinta con texto blanco.

### Portada del tomo (signature)
En el estante: tinta plana a lo ancho, lomo de 18 px a la izquierda, código del grupo en una etiqueta blanca al 16 %, título condensado blanco abajo a la izquierda, al menos 190 px de alto; toda la portada abre el curso y el menú «⋯» queda encima. Con imagen de portada, un velo de tinta (#111a2e del 20 al 78 %) sobre la foto. Archivada, en gris (`grayscale(0.85)`). Dentro del curso, `.hub-banner` repite la portada a mayor escala con lomo de 26 px; las tarjetas de unidad alternan tinta y lomo.

### Diálogo y avisos
Diálogo de 8 px sin borde, sombra grande y filete de 2 px de la tinta bajo el encabezado (título 24 px condensado). Avisos (`.notice`) en papel de la tinta con título del lomo. Notificación emergente (`#toast`) en tinta con texto blanco.

### Intento de evaluación
Encabezado fijo en tinta con texto blanco; el reloj pasa a amarillo de señal en aviso y a #ff8a8a cuando queda poco. La opción elegida se marca con papel de la tinta y un aro interior de 1.5 px de la tinta.

## Do's and Don'ts

### Do:
- **Do** tomar todo color de acción de `--tomo`, `--tomo-lomo` y `--tomo-papel`, para que la pantalla cambie con el curso.
- **Do** poner texto blanco sobre la tinta y el lomo, y texto del lomo sobre el papel de la tinta.
- **Do** poner el filete de 2 px de la tinta bajo el `h1` de cada pantalla.
- **Do** usar Archivo condensada (ancho 70–85 %, 700–800) para títulos y ancho 100 % para la interfaz.
- **Do** separar superficies con filete de 1 px y desplazamiento `0 2px 0`.
- **Do** dejar el texto tenue en #56627a o más oscuro.

### Don't:
- **Don't** usar sombras difusas en paneles o tarjetas en reposo; la sombra grande es solo para diálogos y la caja de acceso.
- **Don't** usar `transform` en `:hover` o `:active`.
- **Don't** pintar calificaciones aprobadas con la tinta del tomo ni rellenar celdas del libro con colores pastel.
- **Don't** usar el amarillo de señal fuera de contadores, la barra de vista previa y el reloj.
- **Don't** poner antetítulos sobre los títulos (`.workspace-eyebrow` está oculto).
- **Don't** mezclar dos tintas de tomo en la misma pantalla de curso.
