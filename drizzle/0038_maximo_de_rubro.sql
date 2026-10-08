-- Enlace 12.56 · Calificación máxima de la captura directa de un rubro (el «Subtotal» del libro, por ejemplo
-- un examen sobre 9). La calificación se sigue guardando sobre 10; esto solo dice sobre cuánto se captura. 10 = como siempre.
ALTER TABLE `aula_grade_categories` ADD `max_score` real DEFAULT 10 NOT NULL;
