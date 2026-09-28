CREATE TABLE `aula_extensions` (
	`task` text NOT NULL,
	`member` text NOT NULL,
	`due` text DEFAULT '' NOT NULL,
	`end_at` text DEFAULT '' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created` text NOT NULL,
	PRIMARY KEY(`task`, `member`),
	FOREIGN KEY (`task`) REFERENCES `aula_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member`) REFERENCES `aula_members`(`id`) ON UPDATE no action ON DELETE no action
);
