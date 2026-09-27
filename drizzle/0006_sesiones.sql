-- Enlace · Sesiones revocables.
-- Migración no destructiva: solo agrega una tabla.
-- Cada inicio de sesión queda registrado; la cookie lleva su id y el servidor lo revisa en cada solicitud,
-- de modo que cerrar sesión (o retirar a una persona) invalida la cookie aunque no haya vencido.
CREATE TABLE `aula_logins` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created` text NOT NULL,
	`expires` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `aula_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `aula_logins_user` ON `aula_logins` (`user_id`);
