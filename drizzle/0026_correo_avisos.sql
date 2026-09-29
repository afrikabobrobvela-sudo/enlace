CREATE TABLE `aula_mail_log` (
	`day` text PRIMARY KEY NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`last_run` text,
	`last_error` text
);
--> statement-breakpoint
ALTER TABLE `aula_users` ADD `email_digest` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `aula_users` ADD `digest_sent_at` text;