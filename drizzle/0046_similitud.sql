-- Enlace 12.82 · Detector de similitud. Solo agrega una columna (sin tocar datos).
-- 1 = el docente eligió revisar con el detector de similitud las entregas de esta actividad (se analizan en su navegador).
ALTER TABLE `aula_tasks` ADD `similarity` integer DEFAULT 0 NOT NULL;
