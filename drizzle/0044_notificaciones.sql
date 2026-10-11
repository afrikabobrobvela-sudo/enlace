-- Enlace 12.72 · Notificaciones en el celular y la computadora (Web Push). Solo agrega tablas.
-- `aula_push_subscriptions`: una fila por navegador que aceptó avisos, ligada a la sesión (`sid` = aula_logins.id)
-- con la que se activó: al cerrar esa sesión (o todas, o suspender la cuenta) deja de recibir avisos.
CREATE TABLE `aula_push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`sid` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`origin` text NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aula_push_subscriptions_endpoint` ON `aula_push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `aula_push_subscriptions_user` ON `aula_push_subscriptions` (`user_id`);--> statement-breakpoint
-- Avisos por enviar (uno por navegador). Se envían al terminar la solicitud que los creó y, lo que no alcance, en la
-- tarea programada de cada 5 minutos. `expires`: pasada esa hora ya no se envía.
CREATE TABLE `aula_push_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`origin` text NOT NULL,
	`payload` text NOT NULL,
	`expires` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
-- Valores internos: la llave VAPID (cifrada con SESSION_SECRET) y el último día en que salieron los recordatorios.
CREATE TABLE `aula_push_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
