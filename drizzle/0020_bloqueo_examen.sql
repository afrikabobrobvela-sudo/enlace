ALTER TABLE `aula_attempt_starts` ADD `away_since` text;--> statement-breakpoint
ALTER TABLE `aula_attempt_starts` ADD `locked_at` text;--> statement-breakpoint
ALTER TABLE `aula_attempt_starts` ADD `unlock_code` text;--> statement-breakpoint
ALTER TABLE `aula_attempt_starts` ADD `unlock_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `aula_attempt_starts` ADD `locks` integer DEFAULT 0 NOT NULL;