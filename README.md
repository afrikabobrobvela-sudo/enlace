# Enlace Web

Plataforma académica web para alumnos, docentes y administración. Enlace reúne cursos, grupos, actividades, entregas, calificaciones, asistencia, calendario y materiales en un mismo entorno.

Este repositorio corresponde a la versión web del ecosistema Enlace y se encuentra en proceso de evolución visual y técnica para integrarse posteriormente con la aplicación móvil Android.

## Estado actual

La aplicación web funciona sobre:

- Cloudflare Workers.
- Cloudflare D1.
- Cloudflare R2.
- JavaScript vanilla.
- CSS puro.
- Interfaz responsive para computadora y dispositivos móviles.

Actualmente se trabaja en la rama:

```text
codex/enlace-mobile-integracion

Las mejoras visuales en curso incluyen:
- Rediseño moderno y responsive.
- Interfaz mobile-first.
- Superficies glassmorphism discretas.
- Mejor jerarquía visual.
- Tipografía más agradable y legible.
- Encabezados de sección con mayor presencia.
- Navegación más clara en pantallas pequeñas.
- Nuevo logotipo en el encabezado.
- Actualización del favicon con la identidad visual de Enlace.
- Mejoras de contraste, espaciado, estados y accesibilidad.
La prioridad es mejorar la experiencia sin alterar las funciones, permisos, rutas ni datos existentes.
Visión del ecosistema
Enlace evolucionará hacia un ecosistema académico conectado compuesto por:
- Enlace Web para computadoras, tablets y usuarios de iOS.
- Enlace Mobile para Android.
- Un sistema común de autenticación, roles y permisos.
- Información académica sincronizada entre plataformas.
- Una experiencia visual coherente en todos los dispositivos.
La integración con Android será progresiva. Actualmente la aplicación móvil y la plataforma web funcionan como proyectos separados, por lo que primero se definirán contratos y responsabilidades comunes antes de unificar servicios.
Próximas etapas
1. Identidad y acceso común
- Unificar la identificación de alumnos, docentes y administradores.
- Compartir reglas de roles y permisos.
- Mantener autenticación segura mediante proveedores institucionales.
- Evitar duplicación de perfiles entre plataformas.
2. Cursos y grupos
- Sincronizar cursos, grupos y periodos académicos.
- Permitir que la información se mantenga consistente entre web y Android.
- Conservar la lógica de inscripción y autorización existente.
3. Actividades y entregas
- Compartir actividades, fechas de entrega, materiales y archivos.
- Permitir que las entregas realizadas desde Android sean visibles en la web.
- Mantener estados como pendiente, entregada, vencida, revisada y calificada.
4. Calificaciones y asistencia
- Sincronizar calificaciones, parciales, criterios y asistencia.
- Conservar el historial de cambios.
- Permitir que docentes y administración consulten la misma información desde ambas plataformas.
5. Agenda y notificaciones
- Compartir calendario académico.
- Mostrar próximas actividades, sesiones y fechas importantes.
- Sincronizar avisos y notificaciones relevantes.
6. Sistema visual compartido
- Mantener una identidad visual común.
- Usar azul profundo, cian, turquesa y superficies translúcidas de forma equilibrada.
- Adaptar componentes a escritorio, tablet, Android e iOS.
- Conservar una experiencia clara y accesible para cada rol.
Repositorios relacionados
Aplicación Android
fabiansandtejpublic1213/Enlace-BUAP

Rama principal de trabajo:
enlace-mobile-v1-premium

Aplicación web
afrikabobrobvela-sudo/enlace

Rama de integración:
codex/enlace-mobile-integracion

Backend móvil
Enlace-BUAP-Backend

Actualmente el backend móvil utiliza Supabase, mientras que la plataforma web utiliza Cloudflare D1 y R2. La futura integración deberá definir una arquitectura compartida sin comprometer los datos actuales.
Desarrollo local
Instalar dependencias:
npm install

Aplicar migraciones únicamente a la base local:
npm run db:migrate:local

Iniciar el entorno local:
npm run dev

La aplicación estará disponible en:
http://localhost:8787

Compilar la interfaz:
npm run build

El entorno local no debe conectarse directamente a la base de producción.
Reglas de desarrollo
- No publicar directamente desde una copia local sin revisar los cambios.
- No subir secretos, claves OAuth ni archivos .dev.vars.
- No modificar producción durante el desarrollo.
- Trabajar en ramas independientes.
- Revisar los cambios visualmente en escritorio y móvil.
- Probar la navegación y las funciones existentes después de cada cambio.
- Mantener el código compatible con JavaScript vanilla y CSS puro.
- No introducir frameworks innecesarios.
- Realizar commits pequeños y descriptivos.
Objetivo del proyecto
Construir una experiencia académica conectada, moderna y accesible donde alumnos, docentes y administración puedan utilizar Enlace desde la web o la aplicación móvil sin perder información, funciones ni continuidad entre dispositivos.
Enlace Web y Enlace Mobile son partes de una misma visión: un ecosistema académico multiplataforma.