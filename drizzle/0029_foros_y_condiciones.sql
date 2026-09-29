CREATE TABLE `aula_forum_state` (
	`user_id` text NOT NULL,
	`course` text NOT NULL,
	`item` text NOT NULL,
	`follow` integer DEFAULT 0 NOT NULL,
	`read_at` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`user_id`, `item`)
);
--> statement-breakpoint
CREATE INDEX `aula_forum_state_course` ON `aula_forum_state` (`course`,`user_id`);--> statement-breakpoint
ALTER TABLE `aula_tasks` ADD `forum` text;--> statement-breakpoint
ALTER TABLE `aula_tasks` ADD `conditions` text DEFAULT '' NOT NULL;