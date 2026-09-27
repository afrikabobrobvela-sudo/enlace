-- Enlace · Fase 2A: registro de asistencia con código QR (AulaPass).
-- Migración no destructiva: solo agrega columnas y una tabla.

-- Registro abierto de una sesión. El QR lleva el código corto y una firma que cambia cada 10 segundos.
ALTER TABLE `aula_sessions` ADD `checkin_code` text;
--> statement-breakpoint
ALTER TABLE `aula_sessions` ADD `checkin_secret` text;
--> statement-breakpoint
-- PIN de 4 dígitos que el docente dicta o proyecta ('' = sin PIN).
ALTER TABLE `aula_sessions` ADD `checkin_pin` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `aula_sessions` ADD `checkin_started` text;
--> statement-breakpoint
ALTER TABLE `aula_sessions` ADD `checkin_until` text;
--> statement-breakpoint
-- Minutos después de abrir el registro a partir de los cuales se marca retardo (0 = nunca).
ALTER TABLE `aula_sessions` ADD `checkin_late_minutes` integer DEFAULT 0 NOT NULL CHECK (`checkin_late_minutes` BETWEEN 0 AND 240);
--> statement-breakpoint
CREATE UNIQUE INDEX `aula_sessions_checkin_code` ON `aula_sessions` (`checkin_code`) WHERE `checkin_code` IS NOT NULL;
--> statement-breakpoint

-- Cada intento de registro: dispositivo usado, PIN fallidos y momento del registro.
CREATE TABLE `aula_checkins` (
	`session` text NOT NULL REFERENCES `aula_sessions`(`id`) ON DELETE CASCADE,
	`member` text NOT NULL REFERENCES `aula_members`(`id`),
	`device` text NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL CHECK (`failures` >= 0),
	`checked_in` text,
	PRIMARY KEY (`session`, `member`)
);
--> statement-breakpoint
-- Un teléfono solo puede registrar a un alumno por sesión.
CREATE UNIQUE INDEX `aula_checkins_device` ON `aula_checkins` (`session`, `device`) WHERE `checked_in` IS NOT NULL;
