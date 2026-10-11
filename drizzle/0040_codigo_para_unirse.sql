-- Enlace 12.68 · Código para unirse a un curso. Solo agrega una columna y un índice (sin tocar datos).
-- '' = sin código. Con código, cualquier persona con sesión que lo tenga se inscribe como alumno (POST /api/join).
ALTER TABLE `aula_courses` ADD `join_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `aula_courses_join_code` ON `aula_courses` (`join_code`) WHERE `join_code` <> '';
