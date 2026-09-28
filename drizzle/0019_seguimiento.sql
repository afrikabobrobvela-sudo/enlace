CREATE TABLE `aula_progress` (
	`member` text NOT NULL,
	`record` text NOT NULL,
	`course` text NOT NULL,
	`opened_at` text,
	`completed_at` text,
	PRIMARY KEY(`member`, `record`)
);
--> statement-breakpoint
CREATE INDEX `aula_progress_course` ON `aula_progress` (`course`);