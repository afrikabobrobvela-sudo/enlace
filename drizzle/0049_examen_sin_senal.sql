-- Enlace 12.91 · Última señal del intento. Solo agrega una columna (sin tocar datos).
-- `last_seen` es la hora en que el servidor recibió por última vez algo del examen (guardado, latido, salida,
-- regreso). Sirve para ver en el monitor quién perdió la conexión (por ejemplo, modo avión) y para bloquear al
-- retomar un examen tras un silencio largo.
ALTER TABLE `aula_attempt_starts` ADD `last_seen` text;
