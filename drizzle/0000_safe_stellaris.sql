CREATE TABLE `aula_courses` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`group_name` text NOT NULL,
	`intro` text DEFAULT '' NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `aula_courses_owner` ON `aula_courses` (`owner`);--> statement-breakpoint
CREATE TABLE `aula_files` (
	`id` text PRIMARY KEY NOT NULL,
	`course` text NOT NULL,
	`owner` text NOT NULL,
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`mime` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `aula_files_course` ON `aula_files` (`course`);--> statement-breakpoint
CREATE TABLE `aula_teachers` (
	`email` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `aula_members` (
	`id` text PRIMARY KEY NOT NULL,
	`course` text NOT NULL,
	`email` text NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`matricula` text DEFAULT '' NOT NULL,
	`role` text DEFAULT 'student' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aula_members_course_email` ON `aula_members` (`course`,`email`);--> statement-breakpoint
CREATE INDEX `aula_members_user` ON `aula_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `aula_records` (
	`id` text PRIMARY KEY NOT NULL,
	`course` text NOT NULL,
	`kind` text NOT NULL,
	`author` text NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `aula_records_course_kind` ON `aula_records` (`course`,`kind`);--> statement-breakpoint
CREATE TABLE `aula_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'student' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aula_users_email` ON `aula_users` (`email`);