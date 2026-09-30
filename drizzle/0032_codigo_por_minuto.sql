-- Enlace 12.27: límite de códigos equivocados por minuto. Solo agrega columnas.
ALTER TABLE `aula_exam_tries` ADD `recent` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `aula_exam_tries` ADD `last_failure` text DEFAULT '' NOT NULL;