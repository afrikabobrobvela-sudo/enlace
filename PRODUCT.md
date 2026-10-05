# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Docentes y alumnos importan por igual (confirmado por el responsable).

- **Docentes** de una academia (nació en la Academia de Física de la BUAP; sirve a cualquier academia). Trabajan sobre todo en computadora: preparan unidades y materiales, crean actividades y evaluaciones, califican en el libro, pasan lista, vigilan exámenes en el salón y revisan el avance de cada grupo y sección. Pueden ser propietarios de un curso o co-docentes.
- **Alumnos** que entran sobre todo desde el celular: ven qué tienen pendiente, abren materiales, entregan tareas, presentan evaluaciones (a veces en modo examen, en el salón), registran su asistencia con QR o código y consultan sus calificaciones y avisos.
- **Administración** (una cuenta principal y quien ella designe): aprueba docentes, gestiona usuarios, catálogo de academias, reportes y respaldos.

## Product Purpose

Enlace es un aula virtual (LMS, inspirado en Brightspace) **en producción con datos reales de estudiantes**. Reúne en un solo lugar todo lo que un curso necesita: contenido por unidades, actividades y entregas, evaluaciones en línea, foros, asistencia, calificaciones con categorías y parciales, avisos y calendario. El éxito es que un docente pueda llevar su materia completa sin depender de la plataforma institucional, y que el alumno siempre sepa qué hacer y cómo va.

## Positioning

Tres cosas que Enlace no debe perder (confirmadas por el responsable):

1. **Independiente y gratuito.** Lo controla la academia, no la institución; corre en el plan gratuito de Cloudflare (Workers + D1 + R2) en la cuenta del propio responsable.
2. **Exámenes con integridad.** Modo examen, bloqueo al salir con código de desbloqueo, plataforma bloqueada durante el examen, un solo dispositivo, códigos por sección, ubicación en el salón, Safe Exam Browser y monitor en vivo para el docente.
3. **Hecho para Física y ciencias.** Fórmulas LaTeX en todo el contenido, reactivos con valores aleatorios y fórmulas, cifras significativas, tolerancias, banco de preguntas por tema e importación desde Brightspace, Word y Excel.

## Operating Context

- Cursos por periodo, con grupos y secciones; copia de un curso a un nuevo periodo.
- Exámenes presenciales en el salón con los celulares o computadoras de los alumnos; el docente dicta códigos y vigila desde su monitor.
- Asistencia en el salón con QR en el pizarrón o código, con comprobación de ubicación y red.
- Importa y exporta en los formatos que ya usan: CSV de Brightspace, Excel y Word.
- Avisos por correo (resumen diario) además de la campana en la aplicación.
- Instalable como aplicación (PWA).

## Capabilities and Constraints

- Toda la interfaz, los mensajes y los correos van **en español de México**.
- Plan gratuito de Cloudflare: máximo 50 consultas por solicitud, Worker ≤ 3 MB comprimido, sin tiempo de CPU para procesar archivos grandes (ZIP y compresión de fotos se hacen en el navegador).
- Frontend sin framework ni empaquetador: scripts clásicos y capas de CSS históricas; la apariencia se ajusta en `tema.css` (y `movil.css` para el teléfono).
- Roles: administración, docente, alumno; por curso, propietario, co-docente y alumno; «vista como alumno» de solo lectura.
- Repositorio público: nunca datos reales de personas, secretos ni identificadores de la base.
- El responsable despliega con `npm run configurar`; no hay despliegue desde las sesiones.

## Brand Commitments

- **El nombre «Enlace» se mantiene.** El logotipo actual (átomo) **sí se puede cambiar**.
- Hoy la interfaz dice «Aula virtual · BUAP» y el pie de página aclara «Espacio docente independiente para grupos BUAP · No es una plataforma institucional oficial». El responsable no lo marcó como compromiso de marca; antes de cambiar esas leyendas, preguntar.

## Evidence on Hand

- Curso de ejemplo completo generado por `POST /api/demo-course` («Mecánica clásica»), con alumnos ficticios `@ejemplo.invalid`: sirve para capturas y demostraciones.
- `LEEME.md` documenta cada versión y sus funciones.
- No hay testimonios, cifras de uso ni casos publicados; no inventarlos.

## Product Principles

1. **El alumno siempre sabe qué sigue.** Pendientes, fechas efectivas (con secciones, prórrogas y accesos especiales) y calificaciones claras desde el celular.
2. **El docente trabaja rápido con muchos alumnos.** Captura en tabla, acciones en bloque, importaciones; nada que obligue a ir alumno por alumno.
3. **La confianza en las evaluaciones no se negocia.** Integridad de exámenes, respuestas correctas que nunca llegan al alumno y registro de lo que pasó.
4. **Independiente y ligero.** Funciona en el plan gratuito, en teléfonos modestos y con poca señal.
5. **Las ciencias son ciudadanas de primera.** Fórmulas, unidades y cifras significativas se ven y se califican bien en todas partes.

## Accessibility & Inclusion

- **WCAG 2.2 AA** como requisito (confirmado): contraste de 4.5:1 en texto normal, uso completo con teclado, etiquetas para lectores de pantalla y objetivos táctiles de al menos 24 px.
- **Celulares modestos y datos limitados** (confirmado): pantallas desde 360 px, poco peso por página, sin depender de imágenes grandes ni animaciones costosas.
