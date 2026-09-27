-- Enlace · Papelera: eliminar contenido, actividades y publicaciones de foro sin perder datos.
-- Migración no destructiva: solo agrega columnas. NULL = elemento activo.
ALTER TABLE `aula_records` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `aula_records` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `aula_tasks` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `aula_tasks` ADD `deleted_by` text;
