// Curso de ejemplo: una materia completa con alumnos ficticios para mostrar lo que hace Enlace.
//
// - Solo docentes y administración; el curso queda a nombre de quien lo crea y se elimina como cualquier otro.
// - Los alumnos son ficticios: correos @ejemplo.invalid (dominio reservado, nunca recibe correo) y sin cuenta,
//   así nadie puede entrar como ellos ni ver el curso.
// - Todo se escribe en un solo `batch` (si algo falla, no queda nada a medias) con altas masivas por json_each:
//   unas 15 consultas en total, lejos del límite de 50 por solicitud del plan gratuito.
// - Las fechas se calculan a partir de hoy: hay actividades vencidas y calificadas, por calificar y abiertas.

import { evaluate, gradeAttempt, quizFields, quizInstance } from './quizzes.js';
import { all, fail, json, nowIso } from './http.js';

export const DEMO_SUFFIX = ' (curso de ejemplo)';
export const DEMO_EMAIL_DOMAIN = 'ejemplo.invalid';
const MAX_DEMO_COURSES = 3;
const DAY = 86_400_000;

// Generador con semilla: el mismo curso cada vez (útil en pruebas) sin depender de Math.random.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** INSERT masivo: una consulta por tabla, con las filas en un solo parámetro JSON. */
function bulk(db, table, rows) {
  const cols = Object.keys(rows[0]);
  return db
    .prepare(`INSERT INTO ${table} (${cols.join(',')}) SELECT ${cols.map((c) => `json_extract(value,'$.${c}')`).join(',')} FROM json_each(?)`)
    .bind(JSON.stringify(rows));
}

const STUDENTS = [
  ['Ana Sofía', 'Hernández Ruiz'],
  ['Bruno', 'García López'],
  ['Camila', 'Martínez Flores'],
  ['Diego', 'Ramírez Torres'],
  ['Elena', 'Sánchez Cruz'],
  ['Fernando', 'Morales Díaz'],
  ['Gabriela', 'Reyes Vázquez'],
  ['Héctor', 'Jiménez Castillo'],
  ['Isabel', 'Mendoza Ortiz'],
  ['Jorge Luis', 'Aguilar Romero'],
  ['Karla', 'Domínguez Silva'],
  ['Luis Ángel', 'Vargas Medina'],
  ['Mariana', 'Castro Núñez'],
  ['Nicolás', 'Herrera Ríos'],
  ['Paola', 'Guzmán Salazar'],
  ['Ricardo', 'Navarro Peña'],
  ['Sofía', 'Estrada Campos'],
  ['Tomás', 'Rojas Lara'],
];

const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '.');

function period(date) {
  const year = date.getUTCFullYear();
  return date.getUTCMonth() >= 6 ? `Otoño ${year}` : `Primavera ${year}`;
}

/** Arma todas las filas del curso de ejemplo (sin tocar la base). */
export function demoCourse(user, now = new Date()) {
  const rand = seeded(20260928);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const id = () => crypto.randomUUID();
  const at = (days, hour = 9) => {
    const d = new Date(now.getTime() + days * DAY);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const day = (days) => at(days).slice(0, 10);
  const courseId = id();
  const teacher = user.id;
  const created = at(-45, 8);

  const course = {
    id: courseId,
    owner: teacher,
    name: 'Mecánica clásica' + DEMO_SUFFIX,
    group_name: 'Demostración',
    intro:
      'Curso de ejemplo creado automáticamente para conocer Enlace. **Los alumnos son ficticios** y no tienen cuenta: puedes calificar, pasar lista, editar o eliminar este curso sin afectar a nadie.',
    created,
    academy_id: user.academy_id ?? null,
    unit_id: user.unit_id ?? null,
    period: period(now),
  };

  // ---- Alumnos: cada uno con un perfil (qué tan bien le va y qué tanto asiste) ----
  const members = STUDENTS.map(([first, last], i) => ({
    id: id(),
    course: courseId,
    email: `${plain(first)}.${plain(last.split(' ')[0])}@${DEMO_EMAIL_DOMAIN}`,
    name: `${first} ${last}`,
    matricula: String(202600101 + i * 37),
    role: 'student',
  }));
  const profile = new Map(members.map((m, i) => [m.id, { skill: 0.45 + ((i * 7) % 11) / 20, attendance: i === 5 || i === 13 ? 0.62 : 0.8 + ((i * 3) % 5) / 25 }]));
  const gradeFor = (member, base = 0) => {
    const g = profile.get(member.id).skill * 10 + base + (rand() - 0.5) * 2.4;
    return Math.round(Math.min(10, Math.max(3, g)) * 10) / 10;
  };

  // ---- Contenido (aula_records) ----
  const records = [];
  let order = 0;
  const record = (kind, data, days, author = teacher) => {
    const r = { id: id(), course: courseId, kind, author, data: JSON.stringify(data), revision: 1, created: at(days, 8) + '', updated: at(days, 8) };
    // Mismo día: se ordenan por un segundo de diferencia para que la lista respete el orden en que se escribieron.
    r.created = new Date(Date.parse(r.created) + order++ * 1000).toISOString();
    records.push(r);
    return r.id;
  };

  const units = [
    {
      title: 'Unidad 1 · Cinemática',
      body: `## Objetivo
Describir el movimiento de una partícula en una y dos dimensiones.

## Temario
1. Posición, desplazamiento y trayectoria
2. Velocidad y rapidez media e instantánea
3. Movimiento rectilíneo uniformemente acelerado: $x = x_0 + v_0 t + \\tfrac{1}{2} a t^2$
4. Caída libre
5. Tiro parabólico

> Semanas 1 a 3. Evaluación: Tarea 1, Tarea 2 y evaluación diagnóstica.`,
      materials: [
        { title: 'Apuntes: ecuaciones del movimiento', body: 'Resumen de la clase.\n\n$$v^2 = v_0^2 + 2a\\,\\Delta x$$\n\n- Usa siempre un sistema de referencia.\n- Revisa las unidades al final.' },
        { title: 'Simulador: movimiento de proyectiles (PhET)', body: 'Cambia el ángulo y la rapidez inicial y observa el alcance.', url: 'https://phet.colorado.edu/es/simulations/projectile-motion' },
      ],
    },
    {
      title: 'Unidad 2 · Dinámica',
      body: `## Objetivo
Aplicar las leyes de Newton a sistemas de partículas.

## Temario
1. Fuerza y masa; primera ley de Newton
2. Segunda ley: $\\sum \\vec F = m\\vec a$
3. Tercera ley y diagramas de cuerpo libre
4. Fricción estática y cinética
5. Plano inclinado`,
      materials: [
        { title: 'Guía para dibujar diagramas de cuerpo libre', body: '1. Aísla el cuerpo.\n2. Dibuja **todas** las fuerzas que actúan sobre él.\n3. Elige ejes convenientes (en el plano inclinado, uno paralelo a la superficie).' },
        { title: 'Simulador: fuerzas y movimiento (PhET)', body: 'Explora la fricción y la fuerza neta.', url: 'https://phet.colorado.edu/es/simulations/forces-and-motion-basics' },
        { title: 'Práctica de laboratorio: plano inclinado', body: 'Material, procedimiento y formato del reporte. Se trabaja por equipos de laboratorio.' },
      ],
    },
    {
      title: 'Unidad 3 · Trabajo y energía',
      body: `## Objetivo
Resolver problemas de movimiento con el teorema trabajo-energía y la conservación de la energía.

## Temario
1. Trabajo de una fuerza constante: $W = F d \\cos\\theta$
2. Energía cinética y teorema trabajo-energía
3. Energía potencial gravitacional y elástica
4. Conservación de la energía mecánica
5. Potencia`,
      materials: [{ title: 'Simulador: pista de patinaje y energía (PhET)', body: 'Observa cómo se reparte la energía entre cinética y potencial.', url: 'https://phet.colorado.edu/es/simulations/energy-skate-park-basics' }],
    },
    {
      title: 'Unidad 4 · Momento lineal y colisiones',
      body: 'En preparación. **Esta unidad está oculta para los alumnos** hasta que la publiques.',
      visible: false,
      materials: [{ title: 'Simulador: laboratorio de colisiones (PhET)', body: '', url: 'https://phet.colorado.edu/es/simulations/collision-lab' }],
    },
  ];
  units.forEach((u, n) => {
    const moduleId = record('module', { title: u.title, body: u.body, visible: u.visible !== false, fileIds: [] }, -44 + n);
    for (const m of u.materials) record('material', { title: m.title, body: m.body, visible: u.visible !== false, module: moduleId, url: m.url || '', fileIds: [] }, -44 + n);
  });

  record('notice', { title: '¡Bienvenidos al curso!', body: 'En **Contenido** encontrarán el temario por unidad. Las tareas se entregan aquí mismo, desde el celular o la computadora (pueden tomar fotos de su cuaderno y Enlace las une en un PDF).', visible: true }, -44);
  record('notice', { title: 'Cambio de salón el jueves', body: 'Esta semana la clase del jueves será en el **laboratorio 3**. El registro de asistencia será con código QR.', visible: true }, -12);
  record('notice', { title: 'Recordatorio: Tarea 4', body: 'La Tarea 4 (trabajo y energía) vence la próxima semana. Revisen los simuladores de la Unidad 3.', visible: true }, -1);
  // Publicación programada: los alumnos la verán (y recibirán el aviso) dentro de tres días.
  record('notice', { title: 'Guía para el segundo parcial', body: 'Ya está disponible la guía de repaso de las Unidades 2 y 3.', visible: true, publishAt: at(3, 8) }, -1);

  // Foros con participación de los alumnos (las publicaciones llevan el nombre de la lista del curso).
  const dudas = record('forum', { title: 'Dudas de la Unidad 1', body: 'Pregunten aquí sus dudas de cinemática. Si conocen la respuesta, ¡ayuden a sus compañeros!', visible: true }, -40);
  const presentaciones = record('forum', { title: 'Preséntate', body: 'Cuéntanos tu nombre, de qué carrera vienes y qué esperas del curso.', visible: true }, -44);
  const s = (i) => members[i];
  const post = (forum, i, title, body, days) => record('post', { forum, title, body, name: s(i).name }, days, 'demo:' + s(i).id);
  post(presentaciones, 0, 'Hola a todos', 'Soy Ana Sofía, vengo de Ingeniería Mecatrónica. Espero entender por fin el tiro parabólico.', -43);
  post(presentaciones, 3, 'Saludos', 'Soy Diego, de Física. Me gusta programar simulaciones.', -43);
  post(presentaciones, 8, 'Hola', 'Isabel, de Actuaría. ¡Nos vemos en clase!', -42);
  post(dudas, 1, '¿El signo de g?', 'En caída libre, ¿g se toma negativa o positiva?', -30);
  record('post', { forum: dudas, title: 'Re: ¿El signo de g?', body: 'Depende del sistema de referencia: si el eje *y* apunta hacia arriba, $a = -g$. Lo importante es ser consistentes.', name: 'Docente del curso' }, -30);
  post(dudas, 6, 'Alcance máximo', 'Comprobé con el simulador que el alcance máximo es con 45° cuando no hay fricción del aire.', -26);
  post(dudas, 12, 'Unidades en la Tarea 2', '¿La rapidez inicial se da en m/s o km/h? En mi hoja dice km/h.', -22);

  // Equipos de laboratorio: cuatro equipos, todos los alumnos en alguno.
  const TEAM_CATEGORY = 'Equipos de laboratorio';
  const teams = [0, 1, 2, 3].map((t) => members.filter((_, i) => i % 4 === t).map((m) => m.id));
  teams.forEach((ids, t) => record('group', { title: `Equipo ${t + 1}`, body: '', visible: true, members: ids, category: TEAM_CATEGORY }, -38));

  // ---- Evaluaciones: diagnóstica con intentos y una abierta sin intentos ----
  const diagnostic = {
    title: 'Evaluación diagnóstica',
    body: 'No cuenta para la calificación: sirve para saber de dónde partimos.',
    visible: true,
    ...quizFields({
      questions: [
        { type: 'choice', text: '¿Cuál es la unidad de la aceleración en el SI?', options: ['m/s', 'm/s²', 'N', 'km/h'], correct: 1 },
        { type: 'choice', text: 'Un objeto se mueve con velocidad constante. Su aceleración es…', options: ['cero', 'constante distinta de cero', 'creciente', 'no se puede saber'], correct: 0 },
        {
          type: 'numeric',
          text: 'Un auto parte del reposo y acelera a {a} m/s² durante {t} s. ¿Qué distancia recorre?',
          answer: '0.5*a*t^2',
          tolerance: 2,
          unit: 'm',
          variables: [
            { name: 'a', min: 2, max: 5, decimals: 0 },
            { name: 't', min: 3, max: 8, decimals: 0 },
          ],
        },
        { type: 'choice', text: 'En el punto más alto de un tiro vertical, la velocidad es…', options: ['máxima', 'igual a g', 'cero', 'negativa'], correct: 2 },
        { type: 'numeric', text: 'Se deja caer una piedra desde {h} m. ¿Cuánto tarda en llegar al suelo? (g = 9.81 m/s²)', answer: 'sqrt(2*h/g)', tolerance: 3, unit: 's', variables: [{ name: 'h', min: 5, max: 45, decimals: 0 }] },
      ],
      settings: { attempts: 1, timeLimit: 30, shuffle: true },
    }),
  };
  const diagnosticId = record('quiz', diagnostic, -42);
  record(
    'quiz',
    {
      title: 'Cuestionario de la Unidad 2',
      body: 'Dos intentos; cuenta el mejor. Tienes 20 minutos por intento.',
      visible: true,
      ...quizFields({
        questions: [
          { type: 'choice', text: 'La segunda ley de Newton relaciona…', options: ['fuerza y velocidad', 'fuerza neta y aceleración', 'masa y peso', 'trabajo y energía'], correct: 1 },
          { type: 'numeric', text: 'Una fuerza neta de {F} N actúa sobre una masa de {m} kg. ¿Cuál es su aceleración?', answer: 'F/m', tolerance: 2, unit: 'm/s²', variables: [{ name: 'F', min: 10, max: 60, decimals: 0 }, { name: 'm', min: 2, max: 10, decimals: 0 }] },
          { type: 'choice', text: 'La fricción cinética es, en general,…', options: ['mayor que la estática máxima', 'menor o igual que la estática máxima', 'independiente de la normal', 'siempre cero'], correct: 1 },
        ],
        settings: { attempts: 2, timeLimit: 20 },
      }),
    },
    -2,
  );
  const quiz = { id: diagnosticId, data: diagnostic };
  const attempts = [];
  members.forEach((m, i) => {
    if (i === 5 || i === 13) return; // dos alumnos no la contestaron
    const userId = 'demo:' + m.id;
    const instance = quizInstance(quiz, userId, 1);
    const skill = profile.get(m.id).skill;
    const answers = {};
    for (const item of instance) {
      const q = diagnostic.questions[item.index];
      const right = rand() < skill + 0.1;
      if (q.type === 'choice') answers[item.index] = right ? q.correct : (q.correct + 1) % q.options.length;
      else {
        const exact = evaluate(q.answer, item.values);
        answers[item.index] = right ? String(Math.round(exact * 100) / 100) : String(Math.round(exact * 1.4 * 100) / 100);
      }
    }
    const graded = gradeAttempt(quiz, instance, answers);
    attempts.push({
      id: `attempt:${diagnosticId}:${userId}`,
      course: courseId,
      quiz: diagnosticId,
      user_id: userId,
      name: m.name,
      answers: JSON.stringify(answers),
      correct: graded.correct,
      total: graded.total,
      score: graded.score,
      created: at(-41 + (i % 3), 10 + (i % 6)),
      attempt: 1,
      details: JSON.stringify(graded.details),
    });
  });

  // ---- Calificación: por categorías, con asistencia como una de ellas ----
  const cat = { tareas: id(), lab: id(), examen: id(), asistencia: id() };
  // El cuestionario de la Unidad 2 cuenta en «Exámenes» (el diagnóstico no cuenta: es de práctica).
  for (const r of records.filter((x) => x.kind === 'quiz')) {
    const data = JSON.parse(r.data);
    if (data.title === 'Cuestionario de la Unidad 2') r.data = JSON.stringify({ ...data, grade: { category: cat.examen, points: 5, policy: 'best' } });
  }
  // Seguimiento del contenido: cada alumno completó parte de los materiales publicados, según su perfil.
  const visibleUnits = new Set(records.filter((r) => r.kind === 'module' && JSON.parse(r.data).visible !== false).map((r) => r.id));
  const published = records.filter((r) => r.kind === 'material' && visibleUnits.has(JSON.parse(r.data).module));
  const progress = [];
  members.forEach((m, i) => {
    published.forEach((mat, k) => {
      const skill = profile.get(m.id).skill;
      const r = rand();
      if (r < skill - k * 0.06) progress.push({ member: m.id, record: mat.id, course: courseId, opened_at: at(-40 + k * 4, 18 + (i % 4)), completed_at: at(-40 + k * 4, 19 + (i % 4)) });
      else if (r < skill + 0.2) progress.push({ member: m.id, record: mat.id, course: courseId, opened_at: at(-38 + k * 4, 20), completed_at: null });
    });
  });
  const categories = [
    { id: cat.tareas, course: courseId, name: 'Tareas', weight: 35, source: 'tasks', position: 0, updated: created },
    { id: cat.lab, course: courseId, name: 'Laboratorio', weight: 20, source: 'tasks', position: 1, updated: created },
    { id: cat.examen, course: courseId, name: 'Exámenes', weight: 35, source: 'tasks', position: 2, updated: created },
    { id: cat.asistencia, course: courseId, name: 'Asistencia', weight: 10, source: 'attendance', position: 3, updated: created },
  ];
  const settings = { course: courseId, revision: 1, updated: created, updated_by: teacher, scheme: 'categories', final_decimals: 1, final_rounding: 'half_up', passing_grade: 6, missing_as_zero: 1 };

  const rubricId = id();
  const levels = [
    { name: 'Excelente', points: 4 },
    { name: 'Bien', points: 3 },
    { name: 'Suficiente', points: 2 },
    { name: 'Insuficiente', points: 1 },
  ];
  const criteria = [
    { name: 'Planteamiento', descriptors: ['Identifica datos, incógnitas y el modelo adecuado.', 'Planteamiento correcto con omisiones menores.', 'Planteamiento incompleto.', 'No identifica el modelo.'] },
    { name: 'Desarrollo', descriptors: ['Procedimiento claro y sin errores.', 'Errores menores de cálculo.', 'Errores de procedimiento.', 'Sin procedimiento.'] },
    { name: 'Resultado y unidades', descriptors: ['Resultado correcto con unidades y análisis.', 'Resultado correcto sin análisis.', 'Resultado con errores o sin unidades.', 'Sin resultado.'] },
  ];
  const rubric = { id: rubricId, owner: teacher, title: 'Resolución de problemas (ejemplo)', definition: JSON.stringify({ levels, criteria }), shared: 0, revision: 1, created, updated: created };

  const tasks = [];
  const task = (days, fields) => {
    const t = {
      id: id(),
      course: courseId,
      author: teacher,
      title: fields.title,
      body: fields.body,
      visible: fields.visible === false ? 0 : 1,
      submission_mode: fields.mode || 'both',
      max_files: 5,
      extensions: JSON.stringify(fields.extensions || []),
      file_ids: '[]',
      allow_resubmit: 1,
      due: fields.due ?? at(days, 23),
      start_at: '',
      end_at: fields.end ?? '',
      category: fields.category,
      points: fields.points || 10,
      rubric: fields.rubric || null,
      group_category: fields.team ? TEAM_CATEGORY : '',
      revision: 1,
      created: at(days - 10, 8),
      updated: at(days - 10, 8),
    };
    tasks.push(t);
    return t;
  };
  const t1 = task(-35, { title: 'Tarea 1 · Movimiento rectilíneo', body: 'Resuelve los problemas 2.5, 2.9 y 2.14 del libro. Puedes entregar fotos de tu cuaderno.', category: cat.tareas });
  const t2 = task(-21, { title: 'Tarea 2 · Tiro parabólico', body: 'Resuelve los tres problemas de la hoja y compara con el simulador de la Unidad 1. **Se evalúa con rúbrica.**', category: cat.tareas, rubric: rubricId });
  const lab = task(-10, { title: 'Práctica 1 · Plano inclinado (por equipo)', body: 'Un integrante entrega el reporte en PDF y cuenta para todo el equipo.', category: cat.lab, team: true, mode: 'files', extensions: ['pdf'] });
  const t3 = task(-2, { title: 'Tarea 3 · Leyes de Newton', body: 'Dibuja los diagramas de cuerpo libre y resuelve los problemas 4.3 a 4.8.', category: cat.tareas });
  const exam = task(-14, { title: 'Examen parcial 1', body: 'Examen escrito en el salón (Unidades 1 y 2). La calificación se captura directamente.', category: cat.examen, mode: 'text' });
  const t4 = task(7, { title: 'Tarea 4 · Trabajo y energía', body: 'Problemas 7.2, 7.10 y 8.4. Incluye unidades en cada resultado.', category: cat.tareas, end: at(10, 23) });
  task(40, { title: 'Proyecto final', body: 'Propuesta y reporte de un experimento de mecánica. Se publicará más adelante.', category: cat.examen, visible: false });

  const submissions = [];
  const history = [];
  const submission = (t, m, fields) =>
    submissions.push({
      id: id(),
      course: courseId,
      task: t.id,
      member: m.id,
      author: fields.manual ? teacher : 'demo:' + m.id,
      body: fields.body ?? '',
      file_ids: '[]',
      submitted: fields.submitted ?? '',
      late: fields.late ? 1 : 0,
      manual: fields.manual ? 1 : 0,
      grade: fields.grade ?? null,
      feedback: fields.feedback ?? '',
      published: fields.published === false ? 0 : 1,
      rubric_scores: fields.rubricScores ?? null,
      graded_by: fields.grade === undefined ? null : teacher,
      graded_at: fields.grade === undefined ? null : fields.gradedAt,
      revision: 1,
      created: fields.submitted || fields.gradedAt,
      updated: fields.gradedAt || fields.submitted,
    });
  const feedbackFor = (g) =>
    g >= 9 ? pick(['Excelente trabajo, muy claro.', '¡Muy bien! Procedimiento impecable.']) : g >= 7 ? pick(['Bien. Revisa las unidades en el último problema.', 'Buen planteamiento; cuida los signos.']) : pick(['Revisa el sistema de referencia y vuelve a intentar el problema 2.', 'Te recomiendo venir a asesoría.']);
  const answer = (m) => `Adjunto mi solución. — ${m.name.split(' ')[0]}`;

  members.forEach((m, i) => {
    // Tarea 1: casi todos entregaron; calificada y publicada.
    if (i !== 13) {
      const late = i === 5;
      const g = gradeFor(m, 0.5);
      submission(t1, m, { body: answer(m), submitted: at(-35 - (late ? -1 : 1), 20), late, grade: late ? Math.max(0, g - 1) : g, feedback: feedbackFor(g) + (late ? ' (Entrega tardía: −1)' : ''), gradedAt: at(-32, 12) });
    }
    // Tarea 2: con rúbrica.
    if (i !== 5 && i !== 13) {
      const skill = profile.get(m.id).skill;
      const scores = criteria.map(() => Math.min(3, Math.max(0, Math.round((1 - skill) * 3 + (rand() - 0.5) * 1.6))));
      const items = criteria.map((c, k) => ({ criterion: c.name, level: levels[scores[k]].name, points: levels[scores[k]].points, max: 4, comment: '' }));
      const total = items.reduce((n, it) => n + it.points, 0);
      const g = Math.round((total / 12) * 100) / 10;
      submission(t2, m, { body: answer(m), submitted: at(-22, 21), grade: g, feedback: feedbackFor(g), rubricScores: JSON.stringify({ title: rubric.title, scores, items, total, max: 12 }), gradedAt: at(-19, 12) });
    }
    // Examen parcial: calificación capturada sin entrega.
    if (i !== 13) {
      const g = gradeFor(m);
      submission(exam, m, { manual: true, grade: g, feedback: '', gradedAt: at(-12, 13) });
    }
    // Tarea 3: entregada hace poco; unas calificadas en borrador (sin publicar), otras por calificar.
    if (![5, 9, 13, 16].includes(i)) {
      const graded = i < 6;
      const g = gradeFor(m);
      submission(t3, m, { body: answer(m), submitted: at(-2 - (i % 2), 18 + (i % 5)), ...(graded ? { grade: g, feedback: feedbackFor(g), published: false, gradedAt: at(-1, 11) } : {}) });
    }
    // Tarea 4: abierta; algunos ya entregaron.
    if (i % 4 === 1) submission(t4, m, { body: answer(m), submitted: at(-1, 22) });
  });
  // Práctica por equipo: la entrega y la calificación se copian a cada integrante.
  teams.forEach((ids, t) => {
    const g = [9.5, 8.0, 8.8, 7.2][t];
    for (const memberId of ids) {
      const m = members.find((x) => x.id === memberId);
      submission(lab, m, { body: `Reporte del Equipo ${t + 1}.`, submitted: at(-10, 19), grade: g, feedback: t === 3 ? 'Faltó el análisis de errores. Revisen la sección 4 del formato.' : 'Buen reporte; las gráficas son claras.', gradedAt: at(-7, 12) });
    }
  });
  for (const sub of submissions) {
    if (sub.grade === null || !sub.published) continue;
    history.push({ id: id(), course: courseId, task: sub.task, member: sub.member, old_grade: null, new_grade: sub.grade, old_published: null, new_published: 1, feedback_changed: sub.feedback ? 1 : 0, reason: 'calificación', changed_by: teacher, changed_at: sub.graded_at });
  }

  // ---- Asistencia: martes y jueves de las últimas seis semanas ----
  const sessions = [];
  const topics = ['Presentación del curso', 'Posición y velocidad', 'MRUA', 'Caída libre', 'Tiro parabólico', 'Repaso Unidad 1', 'Leyes de Newton', 'Diagramas de cuerpo libre', 'Fricción', 'Examen parcial 1', 'Plano inclinado (laboratorio)', 'Trabajo'];
  for (let back = 42, n = 0; back >= 1 && n < topics.length; back--) {
    const d = new Date(now.getTime() - back * DAY);
    if (![2, 4].includes(d.getUTCDay())) continue;
    sessions.push({ id: id(), course: courseId, date: day(-back), start_time: '07:00', topic: topics[n++], created_by: teacher, created: at(-back, 7) });
  }
  const attendance = [];
  sessions.forEach((session, k) => {
    for (const m of members) {
      const p = profile.get(m.id).attendance;
      const r = rand();
      let status = r < p ? 'present' : r < p + 0.08 ? 'late' : 'absent';
      let note = '';
      if (status === 'absent' && rand() < 0.25) {
        status = 'excused';
        note = 'Justificante médico';
      }
      if (status === 'present' && k === sessions.length - 1 && rand() < 0.3) note = 'Registro con QR';
      attendance.push({ session: session.id, member: m.id, status, note, updated_by: teacher, updated: session.created });
    }
  });
  const attendanceSettings = { course: courseId, min_percent: 80, lates_per_absence: 3, excused_counts: 'present', updated: created };

  return { course, members, records, rubric, categories, settings, tasks, submissions, history, attempts, sessions, attendance, attendanceSettings, progress };
}

export const demoRoutes = {
  'POST /api/demo-course': async ({ db, user }) => {
    if (!['teacher', 'admin'].includes(user.role)) fail('Solo el personal docente puede crear el curso de ejemplo.', 403);
    const existing = await all(
      db,
      'SELECT id FROM aula_courses WHERE owner=? AND name LIKE ? AND id NOT IN (SELECT course FROM aula_deleted_courses)',
      user.id,
      '%' + DEMO_SUFFIX,
    );
    if (existing.length >= MAX_DEMO_COURSES) fail(`Ya tienes ${MAX_DEMO_COURSES} cursos de ejemplo. Elimina alguno antes de crear otro.`, 409);
    const d = demoCourse(user);
    await db.batch([
      bulk(db, 'aula_courses', [d.course]),
      bulk(db, 'aula_members', d.members),
      bulk(db, 'aula_records', d.records),
      bulk(db, 'aula_rubrics', [d.rubric]),
      bulk(db, 'aula_grade_categories', d.categories),
      bulk(db, 'aula_grade_settings', [d.settings]),
      bulk(db, 'aula_tasks', d.tasks),
      bulk(db, 'aula_submissions', d.submissions),
      bulk(db, 'aula_grade_history', d.history),
      bulk(db, 'aula_attempts', d.attempts),
      bulk(db, 'aula_sessions', d.sessions),
      bulk(db, 'aula_attendance', d.attendance),
      bulk(db, 'aula_attendance_settings', [d.attendanceSettings]),
      bulk(db, 'aula_progress', d.progress),
    ]);
    return json({ id: d.course.id, updated: nowIso() }, 201);
  },
};
