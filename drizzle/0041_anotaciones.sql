-- Enlace 12.69 · Anotaciones del docente sobre los archivos de una entrega (PDF o imagen). Solo agrega una tabla.
-- `data`: JSON con los trazos, recuadros y comentarios de cada página (ver src/server/anotaciones.js).
CREATE TABLE `aula_annotations` (
	`file_id` text PRIMARY KEY NOT NULL,
	`course` text NOT NULL,
	`data` text NOT NULL CHECK (json_valid(`data`)),
	`updated` text NOT NULL,
	`updated_by` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `aula_annotations_course` ON `aula_annotations` (`course`);
