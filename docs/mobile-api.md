# API móvil de Enlace

La primera conexión de Enlace Mobile es de solo lectura y usa un token de Supabase, separado de la cookie de sesión web.

Configura en `.dev.vars` (no se sube al repositorio):

```text
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_PUBLISHABLE_KEY=tu-clave-publicable
```

El cliente envía por HTTPS `Authorization: Bearer <access-token>`. El Worker consulta `/auth/v1/user`, exige correo confirmado y busca ese correo normalizado en `aula_users`. La cuenta debe existir previamente y no estar suspendida; los roles se resuelven con las reglas de Enlace (`AULA_OWNER_EMAIL` y `aula_teachers`).

`GET /api/mobile/v1/me` devuelve `id`, `email`, `name`, `role` y `photo` (actualmente `null`). `GET /api/mobile/v1/courses` devuelve únicamente los cursos que la cuenta puede ver según las mismas reglas que `GET /api/courses`, con `id`, `name`, `groupName`, `term` y `canTeach`.

Para probar en local, configura esas dos variables con un proyecto de pruebas de Supabase, usa un usuario de prueba cuyo correo ya exista y esté autorizado en la D1 local, y envía su access token. No uses datos de producción ni guardes tokens en archivos del proyecto. Las respuestas son JSON con `401` para una sesión ausente o inválida y `403` para una identidad válida sin cuenta o acceso vigente.
