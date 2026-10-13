-- Enlace 12.74 · Código para unirse por sección. Solo agrega una columna y un índice (sin tocar datos).
-- '' = sin código. Con el código de una sección, quien se une queda inscrito como alumno de esa sección (POST /api/join).
ALTER TABLE `aula_sections` ADD `join_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `aula_sections_join_code` ON `aula_sections` (`join_code`) WHERE `join_code` <> '';
