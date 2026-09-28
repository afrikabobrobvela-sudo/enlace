-- Enlace · Evaluaciones: varios intentos, tiempo límite y detalle por pregunta.
-- No destructiva: los intentos existentes quedan como intento 1; solo se reemplaza el índice único (quiz, alumno)
-- por (quiz, alumno, intento). No se borra ni se modifica ningún dato.
CREATE TABLE `aula_attempt_starts` (
	`quiz` text NOT NULL,
	`user_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`started` text NOT NULL,
	PRIMARY KEY(`quiz`, `user_id`, `attempt`)
);
--> statement-breakpoint
DROP INDEX `aula_attempts_quiz_user`;--> statement-breakpoint
ALTER TABLE `aula_attempts` ADD `attempt` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `aula_attempts` ADD `details` text;--> statement-breakpoint
CREATE UNIQUE INDEX `aula_attempts_quiz_user_attempt` ON `aula_attempts` (`quiz`,`user_id`,`attempt`);
