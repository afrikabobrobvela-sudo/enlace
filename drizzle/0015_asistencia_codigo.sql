ALTER TABLE `aula_checkins` ADD `distance` integer;--> statement-breakpoint
ALTER TABLE `aula_checkins` ADD `accuracy` integer;--> statement-breakpoint
ALTER TABLE `aula_checkins` ADD `same_network` integer;--> statement-breakpoint
ALTER TABLE `aula_checkins` ADD `flag` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `aula_checkins` ADD `reviewed_by` text;--> statement-breakpoint
ALTER TABLE `aula_sessions` ADD `checkin_mode` text DEFAULT 'qr' NOT NULL;--> statement-breakpoint
ALTER TABLE `aula_sessions` ADD `checkin_lat` real;--> statement-breakpoint
ALTER TABLE `aula_sessions` ADD `checkin_lng` real;--> statement-breakpoint
ALTER TABLE `aula_sessions` ADD `checkin_accuracy` real;--> statement-breakpoint
ALTER TABLE `aula_sessions` ADD `checkin_radius` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `aula_sessions` ADD `checkin_strict` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `aula_sessions` ADD `checkin_network` text;