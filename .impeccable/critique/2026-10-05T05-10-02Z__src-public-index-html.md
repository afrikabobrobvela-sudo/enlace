---
target: interfaz de Enlace (src/public/index.html)
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/user/enlace/src/public/index.html"
target_fingerprint: "sha256:b67ddb562f86472c6e2a771cb285afa0563f2e0bdfa4d1a0bb7d8666279deaa5"
target_path: /home/user/enlace/src/public/index.html
timestamp: 2026-10-05T05-10-02Z
slug: src-public-index-html
---
# Crítica de diseño — Enlace (src/public/index.html), modo Operar

## Puntuación (Nielsen): 26/40 — Aceptable (65 %)
| # | Heurística | Puntos | Problema clave |
|---|---|---|---|
| 1 | Visibilidad del estado | 2 | En el celular el reloj del examen se va con el scroll; el resultado solo sale en un toast |
| 2 | Lenguaje del mundo real | 3 | «Envíos en carpeta»; «Pendiente» significa dos cosas |
| 3 | Control y libertad | 3 | «Enviar evaluación» es irreversible y sin resumen previo |
| 4 | Consistencia | 2 | La insignia dice 6 por entregar y el inicio lista 2; migas mezcladas |
| 5 | Prevención de errores | 2 | Envío sin aviso de preguntas sin contestar; «Retirar» pesa igual que «Editar» |
| 6 | Reconocer vs. recordar | 3 | Todos los materiales con el mismo ícono |
| 7 | Flexibilidad y eficiencia | 3 | Sin atajos globales; doble scroll en el libro |
| 8 | Estética minimalista | 2 | Píldoras repetidas por fila, ayudas encima de tablas, descripción duplicada |
| 9 | Recuperación de errores | 3 | Mensajes claros en español; poco probado |
| 10 | Ayuda y documentación | 3 | Ayuda abundante, a veces estorba |

## Especificidad
Intercambiable con otros LMS salvo detalles (átomo, portadas con patrones, datos por alumno en reactivos). Detector: Inter ×6, paleta cian/turquesa «de IA», 23 bordes laterales de acento.

## Problemas prioritarios
1. [P1] Examen en el celular sin reloj fijo, sin avisos de tiempo y sin revisión antes de enviar; resultado en toast — harden/adapt.
2. [P1] «Qué sigue» se contradice: insignia 6 vs. inicio 2, vencidas iguales a próximas, orden viejo→nuevo — clarify.
3. [P2] Libro de calificaciones: la tabla empieza en y≈613 px, caja de 520 px con ~3 alumnos visibles, filas de 74 px; «0.0» en rojo sin explicar la regla — layout.
4. [P2] Paredes de opciones y ruido en pantallas del docente; acciones destructivas sin estilo de peligro — distill.
5. [P2] La ciencia no se ve donde se trabaja: reactivo variable sin KaTeX en la vista del docente; mismo ícono para todo material — typeset/bolder.
6. [P2] Contraste: contador de avisos e iniciales en blanco sobre #0e9fb4 (3.2:1); anillo de foco ~1.5:1 — audit/polish.
