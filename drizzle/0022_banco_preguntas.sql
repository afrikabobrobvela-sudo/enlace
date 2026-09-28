CREATE TABLE `aula_question_bank` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`topic` text DEFAULT '' NOT NULL,
	`question` text NOT NULL,
	`fingerprint` text NOT NULL,
	`shared` integer DEFAULT 0 NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `aula_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `aula_question_bank_owner` ON `aula_question_bank` (`owner_id`,`topic`);--> statement-breakpoint
CREATE INDEX `aula_question_bank_fingerprint` ON `aula_question_bank` (`owner_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `aula_question_bank_shared` ON `aula_question_bank` (`shared`,`owner_id`);