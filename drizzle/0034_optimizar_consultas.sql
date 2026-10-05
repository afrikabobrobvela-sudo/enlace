-- Enlace 12.29 · Índices dirigidos por las métricas reales de D1.
-- Reemplazan índices de una sola columna cuando el compuesto conserva el mismo prefijo.

DROP INDEX IF EXISTS `aula_submissions_course`;--> statement-breakpoint
CREATE INDEX `aula_submissions_member_course_created`
  ON `aula_submissions` (`member`,`course`,`created`);--> statement-breakpoint
CREATE INDEX `aula_submissions_member_course_graded`
  ON `aula_submissions` (`member`,`course`,`graded_at`)
  WHERE `published`=1 AND `grade` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `aula_submissions_recent`
  ON `aula_submissions` (`submitted`,`course`)
  WHERE `manual`=0;--> statement-breakpoint

DROP INDEX IF EXISTS `aula_attempts_course`;--> statement-breakpoint
CREATE INDEX `aula_attempts_course_created`
  ON `aula_attempts` (`course`,`created`);--> statement-breakpoint
CREATE INDEX `aula_attempts_course_user_created`
  ON `aula_attempts` (`course`,`user_id`,`created`);--> statement-breakpoint

DROP INDEX IF EXISTS `aula_progress_course`;--> statement-breakpoint
CREATE INDEX `aula_progress_course_member`
  ON `aula_progress` (`course`,`member`);--> statement-breakpoint

DROP INDEX IF EXISTS `aula_tasks_course`;--> statement-breakpoint
CREATE INDEX `aula_tasks_course_live_created`
  ON `aula_tasks` (`course`,`deleted_at`,`created`);--> statement-breakpoint

DROP INDEX IF EXISTS `aula_records_course_kind`;--> statement-breakpoint
CREATE INDEX `aula_records_course_kind_live_created`
  ON `aula_records` (`course`,`kind`,`deleted_at`,`created`);
