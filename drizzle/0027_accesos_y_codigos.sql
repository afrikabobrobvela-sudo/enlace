CREATE TABLE `aula_course_access` (
	`course` text NOT NULL,
	`user_id` text NOT NULL,
	`visits` integer DEFAULT 1 NOT NULL,
	`first_at` text NOT NULL,
	`last_at` text NOT NULL,
	PRIMARY KEY(`course`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `aula_login_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `aula_login_log_user` ON `aula_login_log` (`user_id`,`at`);--> statement-breakpoint
ALTER TABLE `aula_section_dates` ADD `code` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Los inicios de sesión que aún se conservan (los últimos 14 días) pasan al historial. Solo copia; no toca aula_logins.
INSERT OR IGNORE INTO `aula_login_log` (`id`, `user_id`, `at`) SELECT `id`, `user_id`, `created` FROM `aula_logins`;
