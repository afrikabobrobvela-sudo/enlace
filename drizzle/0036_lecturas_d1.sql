-- Enlace 12.30 · Menos filas leídas en D1 (límite gratuito: 5 millones al día).
-- La 0034 quitó el índice de entregas por curso; las consultas del docente que buscan por curso volvían a recorrer
-- todas las entregas de la base. Estos índices parciales solo guardan las filas que esas consultas necesitan.

-- «Por calificar» del docente (inicio y avisos): entregas enviadas y sin calificación, por curso.
CREATE INDEX IF NOT EXISTS `aula_submissions_course_to_grade`
  ON `aula_submissions` (`course`)
  WHERE `submitted`!='' AND `grade` IS NULL;--> statement-breakpoint
-- Entregas recientes por curso (avisos del docente y resumen por correo).
CREATE INDEX IF NOT EXISTS `aula_submissions_course_recent`
  ON `aula_submissions` (`course`,`submitted`)
  WHERE `manual`=0;--> statement-breakpoint
-- La inscripción de una persona en un curso (cada solicitud la busca): exacta, aunque acumule cursos de muchos semestres.
CREATE INDEX IF NOT EXISTS `aula_members_user_course`
  ON `aula_members` (`user_id`,`course`);--> statement-breakpoint
-- Cuota por alumno al subir un archivo: solo sus archivos del curso.
CREATE INDEX IF NOT EXISTS `aula_files_course_owner`
  ON `aula_files` (`course`,`owner`);--> statement-breakpoint
-- Total de bytes de la plataforma (una fila): cada subida lo aumenta y se recuenta cada hora. Antes cada subida sumaba
-- todos los archivos de Enlace.
CREATE TABLE IF NOT EXISTS `aula_storage` (
  `id` integer PRIMARY KEY NOT NULL CHECK (`id` = 1),
  `bytes` integer NOT NULL,
  `counted_at` text NOT NULL
);
