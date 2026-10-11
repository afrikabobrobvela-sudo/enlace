-- Enlace 12.70 · Mensajes directos entre el docente y cada alumno de un curso. Solo agrega dos tablas.
-- Una conversación por inscripción (`member`); `from_teacher` dice quién escribió. `aula_message_threads` guarda hasta
-- cuándo leyó cada lado (el alumno y el equipo docente del curso).
CREATE TABLE `aula_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`course` text NOT NULL,
	`member` text NOT NULL,
	`from_teacher` integer NOT NULL CHECK (`from_teacher` IN (0, 1)),
	`author` text NOT NULL,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`created` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `aula_messages_member` ON `aula_messages` (`member`, `created`);--> statement-breakpoint
CREATE INDEX `aula_messages_course` ON `aula_messages` (`course`, `created`);--> statement-breakpoint
CREATE TABLE `aula_message_threads` (
	`member` text PRIMARY KEY NOT NULL,
	`course` text NOT NULL,
	`student_read_at` text DEFAULT '' NOT NULL,
	`teacher_read_at` text DEFAULT '' NOT NULL
);
