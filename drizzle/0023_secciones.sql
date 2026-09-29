CREATE TABLE `aula_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`course` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`course`) REFERENCES `aula_courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aula_sections_course_name` ON `aula_sections` (`course`,`name`);
--> statement-breakpoint
CREATE TABLE `aula_section_dates` (
	`item` text NOT NULL,
	`section` text NOT NULL,
	`course` text NOT NULL,
	`start_at` text DEFAULT '' NOT NULL,
	`due` text DEFAULT '' NOT NULL,
	`end_at` text DEFAULT '' NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`item`, `section`),
	FOREIGN KEY (`section`) REFERENCES `aula_sections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `aula_section_dates_course` ON `aula_section_dates` (`course`);
--> statement-breakpoint
DROP INDEX `aula_sessions_course_date_time`;
--> statement-breakpoint
ALTER TABLE `aula_sessions` ADD `section` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `aula_sessions_course_date_time_section` ON `aula_sessions` (`course`,`date`,`start_time`,`section`);
--> statement-breakpoint
ALTER TABLE `aula_members` ADD `section` text DEFAULT '' NOT NULL;
