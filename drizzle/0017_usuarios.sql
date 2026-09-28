CREATE TABLE `aula_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target_user` text,
	`course` text,
	`detail` text DEFAULT '' NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `aula_audit_target` ON `aula_audit` (`target_user`,`created`);--> statement-breakpoint
CREATE INDEX `aula_audit_created` ON `aula_audit` (`created`);--> statement-breakpoint
ALTER TABLE `aula_users` ADD `suspended_at` text;--> statement-breakpoint
ALTER TABLE `aula_users` ADD `suspended_by` text;--> statement-breakpoint
ALTER TABLE `aula_users` ADD `suspended_reason` text;