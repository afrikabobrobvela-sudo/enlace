CREATE TABLE `aula_quiz_access` (
	`quiz` text NOT NULL,
	`member` text NOT NULL,
	`course` text NOT NULL,
	`start_at` text DEFAULT '' NOT NULL,
	`end_at` text DEFAULT '' NOT NULL,
	`extra_minutes` integer DEFAULT 0 NOT NULL,
	`extra_attempts` integer DEFAULT 0 NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created` text NOT NULL,
	PRIMARY KEY(`quiz`, `member`),
	FOREIGN KEY (`quiz`) REFERENCES `aula_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member`) REFERENCES `aula_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `aula_quiz_access_course` ON `aula_quiz_access` (`course`);--> statement-breakpoint
ALTER TABLE `aula_extensions` ADD `start_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `aula_tasks` ADD `special_only` integer DEFAULT 0 NOT NULL;