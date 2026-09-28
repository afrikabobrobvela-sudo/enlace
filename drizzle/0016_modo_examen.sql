CREATE TABLE `aula_exam_tries` (
	`quiz` text NOT NULL,
	`user_id` text NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`quiz`, `user_id`)
);
--> statement-breakpoint
ALTER TABLE `aula_attempt_starts` ADD `progress` text;--> statement-breakpoint
ALTER TABLE `aula_attempt_starts` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `aula_attempt_starts` ADD `events` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `aula_attempt_starts` ADD `flag` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `aula_attempt_starts` ADD `distance` integer;--> statement-breakpoint
ALTER TABLE `aula_attempts` ADD `integrity` text;