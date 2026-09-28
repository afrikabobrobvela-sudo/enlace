CREATE TABLE `aula_grade_history` (
	`id` text PRIMARY KEY NOT NULL,
	`course` text NOT NULL,
	`task` text NOT NULL,
	`member` text NOT NULL,
	`old_grade` real,
	`new_grade` real,
	`old_published` integer,
	`new_published` integer,
	`feedback_changed` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`changed_by` text NOT NULL,
	`changed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `aula_grade_history_lookup` ON `aula_grade_history` (`course`,`task`,`member`);