-- Enlace 12.88 · Registro de errores. Solo agrega una tabla (sin tocar datos).
-- Una fila por error inesperado del servidor ('api'), de una tarea programada ('tarea') o del navegador de alguien
-- ('cliente'), con el número que ve la persona («E-7K2QMA»). `kind`='alerta' marca el último aviso por correo.
-- Se guardan 30 días (src/server/errores.js) y nunca llevan contraseñas ni contenido de entregas.
CREATE TABLE `aula_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`status` integer DEFAULT 500 NOT NULL,
	`route` text DEFAULT '' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`user_id` text DEFAULT '' NOT NULL,
	`detail` text DEFAULT '' NOT NULL
);--> statement-breakpoint
CREATE INDEX `aula_errors_at` ON `aula_errors` (`at`);
