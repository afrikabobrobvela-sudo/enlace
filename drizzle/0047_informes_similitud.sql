-- Enlace 12.84 · Informes de similitud guardados. Solo agrega una tabla (sin tocar datos).
-- Una fila por entrega analizada: el docente compara las entregas en su navegador y guarda aquí el resultado para ver el
-- porcentaje en la revisión de cada entrega y el informe con las fuentes. `summary`: fuentes y avisos (JSON pequeño);
-- `data`: bloques de palabras coincidentes por fuente, con un fragmento del texto de la otra entrega (ver
-- src/server/similitud.js). `version`: huella del contenido entregado (fecha de entrega, archivos y texto); si la
-- entrega cambia, el informe está desactualizado (calificar no lo cambia).
CREATE TABLE `aula_similarity` (
	`submission` text PRIMARY KEY NOT NULL,
	`course` text NOT NULL,
	`task` text NOT NULL,
	`version` text NOT NULL,
	`total` real NOT NULL,
	`literal` real NOT NULL,
	`summary` text NOT NULL CHECK (json_valid(`summary`)),
	`data` text NOT NULL CHECK (json_valid(`data`)),
	`analyzed_at` text NOT NULL,
	`analyzed_by` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `aula_similarity_task` ON `aula_similarity` (`course`,`task`);
