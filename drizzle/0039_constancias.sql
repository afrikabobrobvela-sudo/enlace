-- Enlace 12.67 · Constancias con folio y código QR. Solo se agregan una columna y una tabla (sin tocar datos).
-- aula_courses.certificate: configuración en JSON ('' = sin constancias).
-- aula_certificates: cada constancia emitida; el folio es la llave y la página pública /constancia/<folio> la verifica.
-- Guarda una copia del nombre, del curso y de las horas para que la constancia no cambie si después se edita el curso.
ALTER TABLE `aula_courses` ADD `certificate` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE TABLE `aula_certificates` (
	`id` text PRIMARY KEY NOT NULL,
	`course` text NOT NULL,
	`member_id` text NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`course_name` text NOT NULL,
	`hours` real,
	`grade` real,
	`signer` text DEFAULT '' NOT NULL,
	`issued_at` text NOT NULL,
	`issued_by` text NOT NULL,
	`revoked_at` text
);--> statement-breakpoint
CREATE UNIQUE INDEX `aula_certificates_member` ON `aula_certificates` (`course`, `member_id`);
