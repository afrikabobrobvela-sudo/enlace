ALTER TABLE `aula_attempt_starts` ADD `session_id` text;--> statement-breakpoint
CREATE INDEX `aula_attempt_starts_user` ON `aula_attempt_starts` (`user_id`,`started`);