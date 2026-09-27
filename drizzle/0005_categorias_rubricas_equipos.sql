-- Enlace · Fase 2B: categorías con pesos, calificación final, rúbricas y entregas por equipo.
-- Migración no destructiva: los cursos existentes siguen calculando igual ("pesos por actividad")
-- hasta que el docente elija categorías.

CREATE TABLE `aula_grade_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`course` text NOT NULL REFERENCES `aula_courses`(`id`),
	`name` text NOT NULL,
	`weight` real NOT NULL CHECK (`weight` >= 0 AND `weight` <= 100),
	-- 'tasks': promedio de sus actividades; 'attendance': porcentaje de asistencia llevado a escala de 10.
	`source` text DEFAULT 'tasks' NOT NULL CHECK (`source` IN ('tasks', 'attendance')),
	`position` integer DEFAULT 0 NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `aula_grade_categories_course` ON `aula_grade_categories` (`course`);
--> statement-breakpoint

-- Rúbricas de cada docente; con shared = 1 forman el banco de la Academia.
-- definition: { levels: [{ name, points }], criteria: [{ name, descriptors: [texto por nivel] }] }
CREATE TABLE `aula_rubrics` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL REFERENCES `aula_users`(`id`),
	`title` text NOT NULL,
	`definition` text NOT NULL CHECK (json_valid(`definition`)),
	`shared` integer DEFAULT 0 NOT NULL CHECK (`shared` IN (0, 1)),
	`revision` integer DEFAULT 1 NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `aula_rubrics_owner` ON `aula_rubrics` (`owner`);
--> statement-breakpoint

ALTER TABLE `aula_tasks` ADD `category` text REFERENCES `aula_grade_categories`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
-- Valor de la actividad dentro de su categoría (1 = todas pesan igual).
ALTER TABLE `aula_tasks` ADD `points` real DEFAULT 1 NOT NULL CHECK (`points` > 0 AND `points` <= 1000);
--> statement-breakpoint
ALTER TABLE `aula_tasks` ADD `rubric` text REFERENCES `aula_rubrics`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
-- Entrega por equipo: nombre de la categoría de equipos ('' = entrega individual).
ALTER TABLE `aula_tasks` ADD `group_category` text DEFAULT '' NOT NULL;
--> statement-breakpoint
-- Evaluación con rúbrica guardada tal como se calificó (criterios, niveles, puntos y comentarios).
ALTER TABLE `aula_submissions` ADD `rubric_scores` text CHECK (`rubric_scores` IS NULL OR json_valid(`rubric_scores`));
--> statement-breakpoint

ALTER TABLE `aula_grade_settings` ADD `scheme` text DEFAULT 'tasks' NOT NULL CHECK (`scheme` IN ('tasks', 'categories'));
--> statement-breakpoint
ALTER TABLE `aula_grade_settings` ADD `final_decimals` integer DEFAULT 1 NOT NULL CHECK (`final_decimals` IN (0, 1, 2));
--> statement-breakpoint
ALTER TABLE `aula_grade_settings` ADD `final_rounding` text DEFAULT 'half_up' NOT NULL CHECK (`final_rounding` IN ('half_up', 'down'));
--> statement-breakpoint
ALTER TABLE `aula_grade_settings` ADD `passing_grade` real DEFAULT 6 NOT NULL CHECK (`passing_grade` BETWEEN 0 AND 10);
--> statement-breakpoint
-- Calificación que se asienta cuando no aprueba (por ejemplo 5); NULL = la calculada.
ALTER TABLE `aula_grade_settings` ADD `failing_as` real CHECK (`failing_as` IS NULL OR `failing_as` BETWEEN 0 AND 10);
--> statement-breakpoint
-- Para la calificación final: las actividades vencidas sin calificar cuentan como 0.
ALTER TABLE `aula_grade_settings` ADD `missing_as_zero` integer DEFAULT 0 NOT NULL CHECK (`missing_as_zero` IN (0, 1));
