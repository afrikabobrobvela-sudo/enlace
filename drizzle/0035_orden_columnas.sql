-- Enlace 12.30 · Orden de las columnas del libro de calificaciones (JSON con ids de actividades; '' = por fecha de creación).
ALTER TABLE `aula_grade_settings` ADD `column_order` text DEFAULT '' NOT NULL;
