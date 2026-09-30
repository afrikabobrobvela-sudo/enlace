-- Enlace 12.26: parciales y opciones por categoría. Solo agrega columnas (los cursos existentes calculan igual).
ALTER TABLE `aula_grade_categories` ADD `term` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `aula_grade_categories` ADD `distribution` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `aula_grade_categories` ADD `drop_low` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `aula_grade_categories` ADD `drop_high` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `aula_grade_settings` ADD `terms` text DEFAULT '' NOT NULL;