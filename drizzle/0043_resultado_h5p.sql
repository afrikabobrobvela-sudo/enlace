-- Enlace 12.71 · Resultado de las actividades H5P en el seguimiento del contenido. Solo agrega dos columnas.
-- `score`: la mejor calificación (0 a 10) que el alumno obtuvo en la actividad interactiva de ese material.
ALTER TABLE `aula_progress` ADD `score` real;--> statement-breakpoint
ALTER TABLE `aula_progress` ADD `score_at` text;
