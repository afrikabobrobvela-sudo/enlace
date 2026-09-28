// Esquema de la base de datos (Cloudflare D1 / SQLite), descrito con Drizzle.
// Las migraciones SQL de drizzle/ son las que realmente se aplican; este archivo las documenta
// y permite generar migraciones futuras. Revisa siempre el SQL que proponga `drizzle-kit generate`.
import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ---- Personas y acceso ----

export const users = sqliteTable(
  'aula_users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: text('role').notNull().default('student'),
    // Subirlo invalida todas las sesiones abiertas de esa persona.
    sessionVersion: integer('session_version').notNull().default(1),
    // Migración 0008: academia y unidad académica del docente (registro de docentes).
    academyId: text('academy_id').references(() => academies.id),
    unitId: text('unit_id').references(() => units.id),
    // Migración 0009: versión del aviso de privacidad aceptada y cuándo.
    privacyVersion: text('privacy_version'),
    privacyAcceptedAt: text('privacy_accepted_at'),
  },
  (t) => [uniqueIndex('aula_users_email').on(t.email)],
);

/** Lista de docentes y administración. Es la fuente de verdad de los roles. */
export const teachers = sqliteTable(
  'aula_teachers',
  {
    email: text('email').primaryKey(),
    name: text('name').notNull(),
    role: text('role').notNull().default('teacher'),
    addedBy: text('added_by'),
    addedAt: text('added_at'),
  },
  () => [check('aula_teachers_role_check', sql`role IN ('teacher','admin')`)],
);

/** Cuentas externas (Google, correo) vinculadas a cada usuario. */
export const identities = sqliteTable(
  'aula_identities',
  {
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    email: text('email').notNull(),
    created: text('created').notNull(),
    lastLogin: text('last_login').notNull(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.subject] }), index('aula_identities_user').on(t.userId)],
);

/**
 * Cada inicio de sesión (un navegador o dispositivo). La cookie lleva su id: cerrar sesión la revoca
 * en el servidor, así que una cookie copiada deja de servir aunque no haya vencido.
 */
export const logins = sqliteTable(
  'aula_logins',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    created: text('created').notNull(),
    expires: text('expires').notNull(),
    revokedAt: text('revoked_at'),
  },
  (t) => [index('aula_logins_user').on(t.userId)],
);

/** Enlaces de acceso por correo (solo se guarda el hash del token). */
export const loginTokens = sqliteTable(
  'aula_login_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    email: text('email').notNull(),
    returnTo: text('return_to').notNull().default('/'),
    created: text('created').notNull(),
    expires: text('expires').notNull(),
    usedAt: text('used_at'),
  },
  (t) => [index('aula_login_tokens_email').on(t.email, t.created)],
);

// ---- Cursos e inscripciones ----

export const courses = sqliteTable(
  'aula_courses',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    groupName: text('group_name').notNull(),
    intro: text('intro').notNull().default(''),
    created: text('created').notNull(),
    // Migración 0008: academia y unidad de quien creó el curso (para clasificar y hacer reportes).
    academyId: text('academy_id').references(() => academies.id),
    unitId: text('unit_id').references(() => units.id),
    // Migración 0010: periodo (por ejemplo "Otoño 2026") y archivo (solo lectura).
    period: text('period').notNull().default(''),
    archivedAt: text('archived_at'),
  },
  (t) => [index('aula_courses_owner').on(t.owner)],
);

// ---- Registro de docentes: catálogo de academias y unidades, y solicitudes (migración 0008) ----

/** Academias (por ejemplo, Física, Matemáticas). Se desactivan en lugar de borrarse. */
export const academies = sqliteTable(
  'aula_academies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    active: integer('active').notNull().default(1),
    created: text('created').notNull(),
  },
  (t) => [uniqueIndex('aula_academies_name').on(t.name), check('aula_academies_active_check', sql`active IN (0, 1)`)],
);

/** Unidades académicas (preparatorias, facultades o sedes del complejo regional). */
export const units = sqliteTable(
  'aula_units',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    active: integer('active').notNull().default(1),
    created: text('created').notNull(),
  },
  (t) => [uniqueIndex('aula_units_name').on(t.name), check('aula_units_active_check', sql`active IN (0, 1)`)],
);

/** Solicitudes para ser docente: la administración las aprueba o rechaza. */
export const teacherRequests = sqliteTable(
  'aula_teacher_requests',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    email: text('email').notNull(),
    name: text('name').notNull(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    subjects: text('subjects').notNull().default(''),
    message: text('message').notNull().default(''),
    status: text('status').notNull().default('pending'),
    reason: text('reason').notNull().default(''),
    created: text('created').notNull(),
    decidedBy: text('decided_by'),
    decidedAt: text('decided_at'),
  },
  (t) => [
    index('aula_teacher_requests_status').on(t.status, t.created),
    // Una sola solicitud pendiente por persona.
    uniqueIndex('aula_teacher_requests_pending').on(t.userId).where(sql`status = 'pending'`),
    check('aula_teacher_requests_status_check', sql`status IN ('pending', 'approved', 'rejected')`),
  ],
);

export const deletedCourses = sqliteTable('aula_deleted_courses', {
  course: text('course').primaryKey(),
  deletedBy: text('deleted_by').notNull(),
  deletedAt: text('deleted_at').notNull(),
});

export const members = sqliteTable(
  'aula_members',
  {
    id: text('id').primaryKey(),
    course: text('course').notNull(),
    email: text('email').notNull(),
    userId: text('user_id'),
    name: text('name').notNull(),
    matricula: text('matricula').notNull().default(''),
    role: text('role').notNull().default('student'),
  },
  (t) => [uniqueIndex('aula_members_course_email').on(t.course, t.email), index('aula_members_user').on(t.userId)],
);

// ---- Contenido libre (unidades, materiales, avisos, foros, publicaciones, equipos, evaluaciones) ----

export const records = sqliteTable(
  'aula_records',
  {
    id: text('id').primaryKey(),
    course: text('course').notNull(),
    kind: text('kind').notNull(),
    author: text('author').notNull(),
    data: text('data').notNull(),
    revision: integer('revision').notNull().default(1),
    created: text('created').notNull(),
    updated: text('updated').notNull(),
    // Papelera: un elemento eliminado conserva sus datos y puede restaurarse (NULL = activo).
    deletedAt: text('deleted_at'),
    deletedBy: text('deleted_by'),
  },
  (t) => [index('aula_records_course_kind').on(t.course, t.kind)],
);

export const files = sqliteTable(
  'aula_files',
  {
    id: text('id').primaryKey(),
    course: text('course').notNull(),
    owner: text('owner').notNull(),
    scope: text('scope').notNull(),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    mime: text('mime').notNull(),
    created: text('created').notNull(),
    // Migración 0010: objeto en R2. NULL = el id del archivo. Los cursos copiados comparten el objeto original.
    r2Key: text('r2_key'),
  },
  (t) => [index('aula_files_course').on(t.course)],
);

// ---- Actividades y calificaciones (normalizadas desde la versión 9) ----

export const tasks = sqliteTable(
  'aula_tasks',
  {
    id: text('id').primaryKey(),
    course: text('course')
      .notNull()
      .references(() => courses.id),
    author: text('author').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    visible: integer('visible').notNull().default(1),
    submissionMode: text('submission_mode').notNull().default('both'),
    maxFiles: integer('max_files').notNull().default(5),
    extensions: text('extensions').notNull().default('[]'), // arreglo JSON, p. ej. ["pdf","docx"]
    fileIds: text('file_ids').notNull().default('[]'), // arreglo JSON de aula_files.id
    allowResubmit: integer('allow_resubmit').notNull().default(1),
    due: text('due').notNull().default(''),
    startAt: text('start_at').notNull().default(''),
    endAt: text('end_at').notNull().default(''),
    weight: real('weight'), // porcentaje en la calificación final; NULL = sin ponderar
    // Migración 0005.
    category: text('category').references(() => gradeCategories.id, { onDelete: 'set null' }),
    points: real('points').notNull().default(1), // valor dentro de su categoría
    rubric: text('rubric').references(() => rubrics.id, { onDelete: 'set null' }),
    groupCategory: text('group_category').notNull().default(''), // '' = entrega individual
    // Papelera (migración 0007): la actividad eliminada conserva entregas y calificaciones.
    deletedAt: text('deleted_at'),
    deletedBy: text('deleted_by'),
    revision: integer('revision').notNull().default(1),
    created: text('created').notNull(),
    updated: text('updated').notNull(),
  },
  (t) => [
    index('aula_tasks_course').on(t.course),
    check('aula_tasks_visible_check', sql`visible IN (0, 1)`),
    check('aula_tasks_mode_check', sql`submission_mode IN ('files', 'text', 'both')`),
    check('aula_tasks_max_files_check', sql`max_files BETWEEN 1 AND 5`),
    check('aula_tasks_extensions_check', sql`json_valid(extensions)`),
    check('aula_tasks_file_ids_check', sql`json_valid(file_ids)`),
    check('aula_tasks_resubmit_check', sql`allow_resubmit IN (0, 1)`),
    check('aula_tasks_weight_check', sql`weight IS NULL OR (weight >= 0 AND weight <= 100)`),
    check('aula_tasks_points_check', sql`points > 0 AND points <= 1000`),
  ],
);

/** Una fila por curso con ponderaciones guardadas; `revision` protege contra ediciones simultáneas. */
export const gradeSettings = sqliteTable(
  'aula_grade_settings',
  {
    course: text('course')
      .primaryKey()
      .references(() => courses.id),
    revision: integer('revision').notNull().default(1),
    updated: text('updated').notNull(),
    updatedBy: text('updated_by').notNull(),
    // Migración 0005: cómo se calcula y reglas de la calificación final.
    scheme: text('scheme').notNull().default('tasks'), // tasks | categories
    finalDecimals: integer('final_decimals').notNull().default(1),
    finalRounding: text('final_rounding').notNull().default('half_up'), // half_up | down
    passingGrade: real('passing_grade').notNull().default(6),
    failingAs: real('failing_as'), // p. ej. 5; NULL = la calculada
    missingAsZero: integer('missing_as_zero').notNull().default(0),
  },
  () => [
    check('aula_grade_settings_scheme_check', sql`scheme IN ('tasks', 'categories')`),
    check('aula_grade_settings_decimals_check', sql`final_decimals IN (0, 1, 2)`),
    check('aula_grade_settings_rounding_check', sql`final_rounding IN ('half_up', 'down')`),
    check('aula_grade_settings_passing_check', sql`passing_grade BETWEEN 0 AND 10`),
    check('aula_grade_settings_failing_check', sql`failing_as IS NULL OR failing_as BETWEEN 0 AND 10`),
    check('aula_grade_settings_missing_check', sql`missing_as_zero IN (0, 1)`),
  ],
);

// Categorías con pesos (migración 0005).
export const gradeCategories = sqliteTable(
  'aula_grade_categories',
  {
    id: text('id').primaryKey(),
    course: text('course')
      .notNull()
      .references(() => courses.id),
    name: text('name').notNull(),
    weight: real('weight').notNull(),
    source: text('source').notNull().default('tasks'), // tasks | attendance
    position: integer('position').notNull().default(0),
    updated: text('updated').notNull(),
  },
  (t) => [
    index('aula_grade_categories_course').on(t.course),
    check('aula_grade_categories_weight_check', sql`weight >= 0 AND weight <= 100`),
    check('aula_grade_categories_source_check', sql`source IN ('tasks', 'attendance')`),
  ],
);

// Rúbricas de cada docente; shared = 1 las pone en el banco de la Academia (migración 0005).
export const rubrics = sqliteTable(
  'aula_rubrics',
  {
    id: text('id').primaryKey(),
    owner: text('owner')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    definition: text('definition').notNull(), // { levels: [{ name, points }], criteria: [{ name, descriptors }] }
    shared: integer('shared').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    created: text('created').notNull(),
    updated: text('updated').notNull(),
  },
  (t) => [
    index('aula_rubrics_owner').on(t.owner),
    check('aula_rubrics_definition_check', sql`json_valid(definition)`),
    check('aula_rubrics_shared_check', sql`shared IN (0, 1)`),
  ],
);

/** Entrega de un alumno y su calificación (o calificación manual sin entrega). */
export const submissions = sqliteTable(
  'aula_submissions',
  {
    id: text('id').primaryKey(),
    course: text('course')
      .notNull()
      .references(() => courses.id),
    task: text('task')
      .notNull()
      .references(() => tasks.id),
    member: text('member')
      .notNull()
      .references(() => members.id),
    author: text('author').notNull(),
    body: text('body').notNull().default(''),
    fileIds: text('file_ids').notNull().default('[]'),
    submitted: text('submitted').notNull().default(''),
    late: integer('late').notNull().default(0),
    manual: integer('manual').notNull().default(0),
    grade: real('grade'), // escala 0 a 10; NULL = sin calificar
    feedback: text('feedback').notNull().default(''),
    // 0 = borrador que el alumno aún no ve (fase 1). Las calificaciones anteriores quedaron en 1.
    published: integer('published').notNull().default(1),
    // Copia de la evaluación con rúbrica tal como se calificó (migración 0005).
    rubricScores: text('rubric_scores'),
    gradedBy: text('graded_by'),
    gradedAt: text('graded_at'),
    revision: integer('revision').notNull().default(1),
    created: text('created').notNull(),
    updated: text('updated').notNull(),
  },
  (t) => [
    uniqueIndex('aula_submissions_task_member').on(t.task, t.member),
    index('aula_submissions_course').on(t.course),
    check('aula_submissions_file_ids_check', sql`json_valid(file_ids)`),
    check('aula_submissions_late_check', sql`late IN (0, 1)`),
    check('aula_submissions_manual_check', sql`manual IN (0, 1)`),
    check('aula_submissions_grade_check', sql`grade IS NULL OR (grade >= 0 AND grade <= 10)`),
    check('aula_submissions_published_check', sql`published IN (0, 1)`),
    check('aula_submissions_rubric_check', sql`rubric_scores IS NULL OR json_valid(rubric_scores)`),
  ],
);

// ---- Asistencia (migración 0003) ---------------------------------------------------------------

export const attendanceSettings = sqliteTable(
  'aula_attendance_settings',
  {
    course: text('course').primaryKey().references(() => courses.id),
    minPercent: real('min_percent').notNull().default(80),
    // Cuántos retardos equivalen a una falta (0 = el retardo cuenta como asistencia).
    latesPerAbsence: integer('lates_per_absence').notNull().default(0),
    // 'present': la falta justificada cuenta como asistencia; 'excluded': no se toma en cuenta.
    excusedCounts: text('excused_counts').notNull().default('present'),
    updated: text('updated').notNull(),
  },
  () => [
    check('aula_attendance_settings_min_check', sql`min_percent BETWEEN 0 AND 100`),
    check('aula_attendance_settings_lates_check', sql`lates_per_absence BETWEEN 0 AND 10`),
    check('aula_attendance_settings_excused_check', sql`excused_counts IN ('present', 'excluded')`),
  ],
);

export const classSessions = sqliteTable(
  'aula_sessions',
  {
    id: text('id').primaryKey(),
    course: text('course').notNull().references(() => courses.id),
    date: text('date').notNull(), // AAAA-MM-DD
    startTime: text('start_time').notNull().default(''), // HH:MM o vacío
    topic: text('topic').notNull().default(''),
    createdBy: text('created_by').notNull(),
    created: text('created').notNull(),
    // Registro con QR (migración 0004). El código solo existe mientras el registro está abierto.
    checkinCode: text('checkin_code'),
    checkinSecret: text('checkin_secret'),
    checkinPin: text('checkin_pin').notNull().default(''),
    checkinStarted: text('checkin_started'),
    checkinUntil: text('checkin_until'),
    checkinLateMinutes: integer('checkin_late_minutes').notNull().default(0),
  },
  (t) => [
    uniqueIndex('aula_sessions_course_date_time').on(t.course, t.date, t.startTime),
    uniqueIndex('aula_sessions_checkin_code').on(t.checkinCode).where(sql`checkin_code IS NOT NULL`),
    check('aula_sessions_late_check', sql`checkin_late_minutes BETWEEN 0 AND 240`),
    check('aula_sessions_date_check', sql`date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'`),
    check('aula_sessions_time_check', sql`start_time = '' OR start_time GLOB '[0-2][0-9]:[0-5][0-9]'`),
  ],
);

export const attendance = sqliteTable(
  'aula_attendance',
  {
    session: text('session')
      .notNull()
      .references(() => classSessions.id, { onDelete: 'cascade' }),
    member: text('member')
      .notNull()
      .references(() => members.id),
    status: text('status').notNull(), // present | late | absent | excused
    note: text('note').notNull().default(''),
    updatedBy: text('updated_by').notNull(),
    updated: text('updated').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.session, t.member] }),
    index('aula_attendance_member').on(t.member),
    check('aula_attendance_status_check', sql`status IN ('present', 'late', 'absent', 'excused')`),
  ],
);

/** Intento de evaluación (uno por alumno). La evaluación en sí vive en aula_records. */
// Cada registro con QR: teléfono usado, PIN fallidos y momento del registro (migración 0004).
export const checkins = sqliteTable(
  'aula_checkins',
  {
    session: text('session')
      .notNull()
      .references(() => classSessions.id, { onDelete: 'cascade' }),
    member: text('member')
      .notNull()
      .references(() => members.id),
    device: text('device').notNull(),
    failures: integer('failures').notNull().default(0),
    checkedIn: text('checked_in'),
  },
  (t) => [
    primaryKey({ columns: [t.session, t.member] }),
    // Un teléfono solo puede registrar a un alumno por sesión.
    uniqueIndex('aula_checkins_device').on(t.session, t.device).where(sql`checked_in IS NOT NULL`),
    check('aula_checkins_failures_check', sql`failures >= 0`),
  ],
);

export const attempts = sqliteTable(
  'aula_attempts',
  {
    id: text('id').primaryKey(),
    course: text('course')
      .notNull()
      .references(() => courses.id),
    quiz: text('quiz')
      .notNull()
      .references(() => records.id),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    answers: text('answers').notNull(),
    correct: integer('correct').notNull(),
    total: integer('total').notNull(),
    score: real('score').notNull(),
    created: text('created').notNull(),
    // Migración 0012: número de intento (varios intentos) y detalle por pregunta (valores y si fue correcta).
    attempt: integer('attempt').notNull().default(1),
    details: text('details'),
  },
  (t) => [
    uniqueIndex('aula_attempts_quiz_user_attempt').on(t.quiz, t.userId, t.attempt),
    index('aula_attempts_course').on(t.course),
    check('aula_attempts_answers_check', sql`json_valid(answers)`),
    check('aula_attempts_total_check', sql`total > 0`),
    check('aula_attempts_score_check', sql`score >= 0 AND score <= 10`),
  ],
);

/** Migración 0011: prórroga de una actividad para un alumno (nueva fecha de vencimiento y de cierre). */
export const extensions = sqliteTable(
  'aula_extensions',
  {
    task: text('task')
      .notNull()
      .references(() => tasks.id),
    member: text('member')
      .notNull()
      .references(() => members.id),
    due: text('due').notNull().default(''),
    endAt: text('end_at').notNull().default(''),
    reason: text('reason').notNull().default(''),
    createdBy: text('created_by').notNull(),
    created: text('created').notNull(),
  },
  (t) => [primaryKey({ columns: [t.task, t.member] })],
);

/** Migración 0012: inicio de cada intento de evaluación (para el tiempo límite; no se reinicia al recargar). */
export const attemptStarts = sqliteTable(
  'aula_attempt_starts',
  {
    quiz: text('quiz').notNull(),
    userId: text('user_id').notNull(),
    attempt: integer('attempt').notNull(),
    started: text('started').notNull(),
  },
  (t) => [primaryKey({ columns: [t.quiz, t.userId, t.attempt] })],
);
