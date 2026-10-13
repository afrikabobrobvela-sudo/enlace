// Código para unirse a un curso (12.68). El docente lo activa en «Administración del curso → Código para unirse»
// y lo comparte (código, enlace …/#unirse=CÓDIGO o QR). Cualquier persona con sesión que lo tenga queda inscrita como
// alumno; nadie lo puede ver salvo quien enseña (publicCourse() y /api/courses lo quitan de las respuestas).
// 12.74: cada sección puede tener su propio código (aula_sections.join_code, desde «Listado de alumnos → Código QR
// para unirse»): quien se une con él queda en esa sección. Las respuestas del curso nunca leen esa columna.
import { access, requireTeacher } from './access.js';
import { fail, json, one, readJson, run } from './http.js';
import { sectionOf } from './sections.js';

// Sin letras ni cifras que se confunden (I/1, O/0, L): 8 caracteres de 31 posibles, unos 850 mil millones de códigos.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** Un código que no use ya otro curso ni otra sección (los dos comparten el mismo espacio en /api/join). */
async function newCode(db) {
  for (;;) {
    const code = randomCode();
    const taken = await one(
      db,
      "SELECT 1 AS x FROM aula_courses WHERE join_code=?1 UNION ALL SELECT 1 FROM aula_sections WHERE join_code=?1 LIMIT 1",
      code,
    );
    if (!taken) return code;
  }
}

/** La sección pedida (del mismo curso) o null para el código general del curso. */
const targetSection = (db, course, id) => (id ? sectionOf(db, course, id) : null);

/** Lo que escribe la persona («abcd-2345», con espacios o guiones) a la forma guardada. */
export const normalizeCode = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);

export const joinRoutes = {
  /** Código del curso o, con `section`, el de esa sección. */
  async 'GET /api/course/join-code'({ db, user, url }) {
    const a = await access(db, user, url.searchParams.get('course'));
    requireTeacher(a);
    const section = await targetSection(db, a.course.id, url.searchParams.get('section'));
    return json({ code: (section ? section.join_code : a.course.join_code) || '', section: section?.id || '' });
  },

  /** Activa (con un código nuevo si no tenía o si se pide otro) o desactiva el código del curso o de una sección. */
  async 'POST /api/course/join-code'({ db, user, request }) {
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    requireTeacher(a);
    const section = await targetSection(db, a.course.id, body.section);
    const old = (section ? section.join_code : a.course.join_code) || '';
    let code = '';
    if (body.enabled === true) code = !old || body.regenerate === true ? await newCode(db) : old;
    if (section) await run(db, 'UPDATE aula_sections SET join_code=? WHERE id=? AND course=?', code, section.id, a.course.id);
    else await run(db, 'UPDATE aula_courses SET join_code=? WHERE id=?', code, a.course.id);
    return json({ code, section: section?.id || '' });
  },

  /** La persona con sesión se inscribe como alumno en el curso de ese código. */
  async 'POST /api/join'({ db, user, request }) {
    const body = await readJson(request);
    const code = normalizeCode(body.code);
    if (code.length < 6) fail('Escribe el código completo que te dio tu docente.');
    // El código es del curso (sin sección) o de una de sus secciones.
    const course = await one(
      db,
      `SELECT c.id, c.name, c.owner, c.archived_at, c.student_visible, hit.section, s.name AS section_name,
         (SELECT m.id FROM aula_members m WHERE m.course=c.id AND (m.user_id=?2 OR m.email=?3) ORDER BY m.user_id IS NULL LIMIT 1) AS member,
         (SELECT m.role FROM aula_members m WHERE m.course=c.id AND (m.user_id=?2 OR m.email=?3) ORDER BY m.user_id IS NULL LIMIT 1) AS role,
         (SELECT m.section FROM aula_members m WHERE m.course=c.id AND (m.user_id=?2 OR m.email=?3) ORDER BY m.user_id IS NULL LIMIT 1) AS my_section
       FROM (SELECT id AS course, '' AS section FROM aula_courses WHERE join_code=?1
             UNION ALL SELECT course, id FROM aula_sections WHERE join_code=?1 LIMIT 1) hit
       JOIN aula_courses c ON c.id=hit.course
       LEFT JOIN aula_sections s ON s.id=hit.section
       WHERE NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)`,
      code,
      user.id,
      user.email,
    );
    if (!course) fail('Ese código no es de ningún curso. Revísalo con tu docente; puede que lo haya cambiado.', 404);
    const result = { course: course.id, name: course.name, section: course.section_name || '' };
    if (course.owner === user.id || course.role === 'teacher') return json({ ...result, section: '', already: true });
    if (course.role === 'student') {
      // Quien ya estaba sin sección queda en la del código; a quien ya tiene una no se le cambia (eso lo decide el docente).
      if (course.section && !course.my_section && !course.archived_at) {
        await run(db, "UPDATE aula_members SET section=? WHERE id=? AND role='student' AND section=''", course.section, course.member);
        return json({ ...result, already: true, placed: true });
      }
      return json({ ...result, section: course.section && course.my_section === course.section ? result.section : '', already: true });
    }
    if (course.role === 'removed') fail('Tu docente te dio de baja de este curso. Si es un error, comunícate con él.', 403);
    if (course.archived_at) fail('Este curso ya terminó y no admite nuevas inscripciones.', 409);
    if (course.student_visible === 0) fail('Este curso todavía no está abierto a los alumnos.', 409);
    await run(
      db,
      `INSERT INTO aula_members (id,course,email,user_id,name,matricula,role,section) VALUES (?,?,?,?,?,'','student',?)
       ON CONFLICT(course,email) DO NOTHING`,
      crypto.randomUUID(),
      course.id,
      user.email,
      user.id,
      String(user.name || user.email).slice(0, 150),
      course.section || '',
    );
    return json({ ...result, already: false }, 201);
  },
};
