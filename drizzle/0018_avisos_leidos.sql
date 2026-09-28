CREATE TABLE `aula_notice_reads` (
	`user_id` text NOT NULL,
	`item` text NOT NULL,
	`read_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `item`)
);
