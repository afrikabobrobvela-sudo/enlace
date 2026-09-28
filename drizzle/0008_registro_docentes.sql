-- Enlace · Registro de docentes: catálogo de academias y unidades académicas, solicitudes para ser docente
-- y academia/unidad de cada docente y de cada curso. Migración no destructiva: solo agrega tablas y columnas.
CREATE TABLE `aula_academies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created` text NOT NULL,
	CONSTRAINT "aula_academies_active_check" CHECK(active IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aula_academies_name` ON `aula_academies` (`name`);--> statement-breakpoint
CREATE TABLE `aula_teacher_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`academy_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`subjects` text DEFAULT '' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created` text NOT NULL,
	`decided_by` text,
	`decided_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `aula_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`academy_id`) REFERENCES `aula_academies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `aula_units`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "aula_teacher_requests_status_check" CHECK(status IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `aula_teacher_requests_status` ON `aula_teacher_requests` (`status`,`created`);--> statement-breakpoint
CREATE UNIQUE INDEX `aula_teacher_requests_pending` ON `aula_teacher_requests` (`user_id`) WHERE status = 'pending';--> statement-breakpoint
CREATE TABLE `aula_units` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created` text NOT NULL,
	CONSTRAINT "aula_units_active_check" CHECK(active IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aula_units_name` ON `aula_units` (`name`);--> statement-breakpoint
ALTER TABLE `aula_courses` ADD `academy_id` text REFERENCES aula_academies(id);--> statement-breakpoint
ALTER TABLE `aula_courses` ADD `unit_id` text REFERENCES aula_units(id);--> statement-breakpoint
ALTER TABLE `aula_users` ADD `academy_id` text REFERENCES aula_academies(id);--> statement-breakpoint
ALTER TABLE `aula_users` ADD `unit_id` text REFERENCES aula_units(id);
