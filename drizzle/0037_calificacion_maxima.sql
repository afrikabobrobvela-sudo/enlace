-- Enlace 12.51 · Calificación máxima de una actividad (como «6 de 9» en Brightspace). La calificación se sigue
-- guardando sobre 10 (6 de 9 = 6.67); este valor solo dice sobre cuánto se captura y se muestra. 10 = como siempre.
ALTER TABLE `aula_tasks` ADD `max_score` real DEFAULT 10 NOT NULL;
