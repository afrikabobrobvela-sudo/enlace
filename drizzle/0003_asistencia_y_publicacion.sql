-- Enlace · Fase 1: asistencia y calificaciones en borrador.
-- Migración no destructiva: solo agrega tablas y una columna.

-- ---- Calificaciones en borrador ---------------------------------------------------------------
-- Las calificaciones que ya existían quedan publicadas (1) para que ningún alumno deje de verlas.
ALTER TABLE `aula_submissions` ADD `published` integer DEFAULT 1 NOT NULL CHECK (`published` IN (0, 1));
--> statement-breakpoint

-- ---- Asistencia ------------------------------------------------------------------------------
CREATE TABLE `aula_attendance_settings` (
	`course` text PRIMARY KEY NOT NULL REFERENCES `aula_courses`(`id`),
	`min_percent` real DEFAULT 80 NOT NULL CHECK (`min_percent` BETWEEN 0 AND 100),
	-- Cuántos retardos equivalen a una falta (0 = los retardos cuentan como asistencia).
	`lates_per_absence` integer DEFAULT 0 NOT NULL CHECK (`lates_per_absence` BETWEEN 0 AND 10),
	-- Las faltas justificadas cuentan como asistencia ('present') o no se toman en cuenta ('excluded').
	`excused_counts` text DEFAULT 'present' NOT NULL CHECK (`excused_counts` IN ('present', 'excluded')),
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `aula_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`course` text NOT NULL REFERENCES `aula_courses`(`id`),
	`date` text NOT NULL CHECK (`date` GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	`start_time` text DEFAULT '' NOT NULL CHECK (`start_time` = '' OR `start_time` GLOB '[0-2][0-9]:[0-5][0-9]'),
	`topic` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aula_sessions_course_date_time` ON `aula_sessions` (`course`, `date`, `start_time`);
--> statement-breakpoint
CREATE TABLE `aula_attendance` (
	`session` text NOT NULL REFERENCES `aula_sessions`(`id`) ON DELETE CASCADE,
	`member` text NOT NULL REFERENCES `aula_members`(`id`),
	`status` text NOT NULL CHECK (`status` IN ('present', 'late', 'absent', 'excused')),
	`note` text DEFAULT '' NOT NULL,
	`updated_by` text NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY (`session`, `member`)
);
--> statement-breakpoint
CREATE INDEX `aula_attendance_member` ON `aula_attendance` (`member`);
