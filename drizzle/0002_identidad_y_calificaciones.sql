-- Enlace v9 · Identidad propia y calificaciones en tablas normalizadas.
--
-- Migración NO destructiva: copia actividades, entregas, calificaciones, ponderaciones e intentos
-- desde aula_records a tablas propias. Los registros originales NO se borran (el servidor ya no los lee),
-- de modo que pueden revisarse o recuperarse. Consulta de verificación en LEEME.md.

-- ---- Identidad -------------------------------------------------------------------------------
ALTER TABLE `aula_users` ADD `session_version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `aula_teachers` ADD `role` text DEFAULT 'teacher' NOT NULL CHECK (`role` IN ('teacher','admin'));
--> statement-breakpoint
ALTER TABLE `aula_teachers` ADD `added_by` text;
--> statement-breakpoint
ALTER TABLE `aula_teachers` ADD `added_at` text;
--> statement-breakpoint
CREATE TABLE `aula_identities` (
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`user_id` text NOT NULL REFERENCES `aula_users`(`id`),
	`email` text NOT NULL,
	`created` text NOT NULL,
	`last_login` text NOT NULL,
	PRIMARY KEY (`provider`, `subject`)
);
--> statement-breakpoint
CREATE INDEX `aula_identities_user` ON `aula_identities` (`user_id`);
--> statement-breakpoint
CREATE TABLE `aula_login_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`return_to` text DEFAULT '/' NOT NULL,
	`created` text NOT NULL,
	`expires` text NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE INDEX `aula_login_tokens_email` ON `aula_login_tokens` (`email`, `created`);
--> statement-breakpoint

-- ---- Actividades -----------------------------------------------------------------------------
CREATE TABLE `aula_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`course` text NOT NULL REFERENCES `aula_courses`(`id`),
	`author` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`visible` integer DEFAULT 1 NOT NULL CHECK (`visible` IN (0, 1)),
	`submission_mode` text DEFAULT 'both' NOT NULL CHECK (`submission_mode` IN ('files', 'text', 'both')),
	`max_files` integer DEFAULT 5 NOT NULL CHECK (`max_files` BETWEEN 1 AND 5),
	`extensions` text DEFAULT '[]' NOT NULL CHECK (json_valid(`extensions`)),
	`file_ids` text DEFAULT '[]' NOT NULL CHECK (json_valid(`file_ids`)),
	`allow_resubmit` integer DEFAULT 1 NOT NULL CHECK (`allow_resubmit` IN (0, 1)),
	`due` text DEFAULT '' NOT NULL,
	`start_at` text DEFAULT '' NOT NULL,
	`end_at` text DEFAULT '' NOT NULL,
	`weight` real CHECK (`weight` IS NULL OR (`weight` >= 0 AND `weight` <= 100)),
	`revision` integer DEFAULT 1 NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `aula_tasks_course` ON `aula_tasks` (`course`);
--> statement-breakpoint
INSERT INTO `aula_tasks` (`id`, `course`, `author`, `title`, `body`, `visible`, `submission_mode`, `max_files`,
	`extensions`, `file_ids`, `allow_resubmit`, `due`, `start_at`, `end_at`, `revision`, `created`, `updated`)
SELECT r.id, r.course, r.author,
	coalesce(json_extract(r.data, '$.title'), 'Actividad sin título'),
	coalesce(json_extract(r.data, '$.body'), ''),
	CASE WHEN json_type(r.data, '$.visible') = 'false' THEN 0 ELSE 1 END,
	CASE WHEN json_extract(r.data, '$.submissionMode') IN ('files', 'text', 'both') THEN json_extract(r.data, '$.submissionMode') ELSE 'both' END,
	CASE WHEN json_type(r.data, '$.maxFiles') = 'integer' AND json_extract(r.data, '$.maxFiles') BETWEEN 1 AND 5 THEN json_extract(r.data, '$.maxFiles') ELSE 5 END,
	CASE WHEN json_type(r.data, '$.extensions') = 'array' THEN json_extract(r.data, '$.extensions') ELSE '[]' END,
	CASE WHEN json_type(r.data, '$.fileIds') = 'array' THEN json_extract(r.data, '$.fileIds') ELSE '[]' END,
	CASE WHEN json_type(r.data, '$.allowResubmit') = 'false' THEN 0 ELSE 1 END,
	coalesce(json_extract(r.data, '$.due'), ''),
	coalesce(json_extract(r.data, '$.start'), ''),
	coalesce(json_extract(r.data, '$.end'), ''),
	r.revision, r.created, r.updated
FROM `aula_records` r
WHERE r.kind = 'task' AND EXISTS (SELECT 1 FROM `aula_courses` c WHERE c.id = r.course);
--> statement-breakpoint

-- ---- Ponderaciones ---------------------------------------------------------------------------
CREATE TABLE `aula_grade_settings` (
	`course` text PRIMARY KEY NOT NULL REFERENCES `aula_courses`(`id`),
	`revision` integer DEFAULT 1 NOT NULL,
	`updated` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `aula_grade_settings` (`course`, `revision`, `updated`, `updated_by`)
SELECT w.course, w.revision, w.updated, w.author
FROM `aula_records` w
WHERE w.kind = 'weights'
	AND EXISTS (SELECT 1 FROM `aula_courses` c WHERE c.id = w.course)
	AND w.updated = (SELECT max(x.updated) FROM `aula_records` x WHERE x.kind = 'weights' AND x.course = w.course)
GROUP BY w.course;
--> statement-breakpoint
UPDATE `aula_tasks` SET `weight` = (
	SELECT CASE
		WHEN json_extract(w.data, '$.weights."' || aula_tasks.id || '"') BETWEEN 0 AND 100
		THEN json_extract(w.data, '$.weights."' || aula_tasks.id || '"') END
	FROM `aula_records` w
	WHERE w.kind = 'weights' AND w.course = aula_tasks.course
	ORDER BY w.updated DESC LIMIT 1
);
--> statement-breakpoint

-- ---- Entregas y calificaciones ---------------------------------------------------------------
CREATE TABLE `aula_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`course` text NOT NULL REFERENCES `aula_courses`(`id`),
	`task` text NOT NULL REFERENCES `aula_tasks`(`id`),
	`member` text NOT NULL REFERENCES `aula_members`(`id`),
	`author` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`file_ids` text DEFAULT '[]' NOT NULL CHECK (json_valid(`file_ids`)),
	`submitted` text DEFAULT '' NOT NULL,
	`late` integer DEFAULT 0 NOT NULL CHECK (`late` IN (0, 1)),
	`manual` integer DEFAULT 0 NOT NULL CHECK (`manual` IN (0, 1)),
	`grade` real CHECK (`grade` IS NULL OR (`grade` >= 0 AND `grade` <= 10)),
	`feedback` text DEFAULT '' NOT NULL,
	`graded_by` text,
	`graded_at` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aula_submissions_task_member` ON `aula_submissions` (`task`, `member`);
--> statement-breakpoint
CREATE INDEX `aula_submissions_course` ON `aula_submissions` (`course`);
--> statement-breakpoint
INSERT OR IGNORE INTO `aula_submissions` (`id`, `course`, `task`, `member`, `author`, `body`, `file_ids`, `submitted`,
	`late`, `manual`, `grade`, `feedback`, `revision`, `created`, `updated`)
SELECT r.id, r.course, json_extract(r.data, '$.task'), json_extract(r.data, '$.member'), r.author,
	coalesce(json_extract(r.data, '$.body'), ''),
	CASE WHEN json_type(r.data, '$.fileIds') = 'array' THEN json_extract(r.data, '$.fileIds') ELSE '[]' END,
	coalesce(json_extract(r.data, '$.submitted'), ''),
	CASE WHEN json_type(r.data, '$.late') = 'true' THEN 1 ELSE 0 END,
	CASE WHEN json_type(r.data, '$.manual') = 'true' THEN 1 ELSE 0 END,
	CASE WHEN json_type(r.data, '$.grade') IN ('integer', 'real') AND json_extract(r.data, '$.grade') BETWEEN 0 AND 10
		THEN json_extract(r.data, '$.grade') END,
	coalesce(json_extract(r.data, '$.feedback'), ''),
	r.revision, r.created, r.updated
FROM `aula_records` r
WHERE r.kind = 'submission'
	AND EXISTS (SELECT 1 FROM `aula_tasks` t WHERE t.id = json_extract(r.data, '$.task') AND t.course = r.course)
	AND EXISTS (SELECT 1 FROM `aula_members` m WHERE m.id = json_extract(r.data, '$.member') AND m.course = r.course)
ORDER BY r.updated DESC;
--> statement-breakpoint

-- ---- Intentos de evaluación ------------------------------------------------------------------
CREATE TABLE `aula_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`course` text NOT NULL REFERENCES `aula_courses`(`id`),
	`quiz` text NOT NULL REFERENCES `aula_records`(`id`),
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`answers` text NOT NULL CHECK (json_valid(`answers`)),
	`correct` integer NOT NULL,
	`total` integer NOT NULL CHECK (`total` > 0),
	`score` real NOT NULL CHECK (`score` >= 0 AND `score` <= 10),
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aula_attempts_quiz_user` ON `aula_attempts` (`quiz`, `user_id`);
--> statement-breakpoint
CREATE INDEX `aula_attempts_course` ON `aula_attempts` (`course`);
--> statement-breakpoint
INSERT OR IGNORE INTO `aula_attempts` (`id`, `course`, `quiz`, `user_id`, `name`, `answers`, `correct`, `total`, `score`, `created`)
SELECT r.id, r.course, json_extract(r.data, '$.quiz'), r.author,
	coalesce(json_extract(r.data, '$.name'), ''),
	CASE WHEN json_type(r.data, '$.answers') = 'array' THEN json_extract(r.data, '$.answers') ELSE '[]' END,
	coalesce(json_extract(r.data, '$.correct'), 0),
	json_extract(r.data, '$.total'),
	json_extract(r.data, '$.score'),
	r.created
FROM `aula_records` r
WHERE r.kind = 'attempt'
	AND EXISTS (SELECT 1 FROM `aula_records` q WHERE q.id = json_extract(r.data, '$.quiz') AND q.kind = 'quiz' AND q.course = r.course);
