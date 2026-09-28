ALTER TABLE `aula_courses` ADD `period` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `aula_courses` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `aula_files` ADD `r2_key` text;