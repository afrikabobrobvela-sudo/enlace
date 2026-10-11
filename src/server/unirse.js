// Código para unirse a un curso (12.68). El docente lo activa en «Administración del curso → Código para unirse»
// y lo comparte (código, enlace …/#unirse=CÓDIGO o QR). Cualquier persona con sesión que lo tenga queda inscrita como
// alumno; nadie lo puede ver salvo quien enseña (publicCourse() y /api/courses lo quitan de las respuestas).
import { access, requireTeacher } from './access.js';
import { fail, json, one, readJson, run } from './http.js';

// Sin letras ni cifras que se confunden (I/1, O/0, L): 8 caracteres de 31 posibles, unos 850 mil millones de códigos.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** Lo que escribe la persona («abcd-2345», con espacios o guiones) a la forma guardada. */
export const normalizeCode = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);

export const joinRoutes = {
  async 'GET /api/course/join-code'({ db, user, url }) {
    const a = await access(db, user, url.searchParams.get('course'));
    requireTeacher(a);
    return json({ code: a.course.join_code || '' });
  },

  /** Activa (con un código nuevo si no tenía o si se pide otro) o desactiva el código del curso. */
  async 'POST /api/course/join-code'({ db, user, request }) {
    const body = await readJson(request);
    const a = await access(db, user, body.course);
    requireTeacher(a);
    let code = '';
    if (body.enabled === true) {
      code = !a.course.join_code || body.regenerate === true ? newCode() : a.course.join_code;
    }
    await run(db, 'UPDATE aula_courses SET join_code=? WHERE id=?', code, a.course.id);
    return json({ code });
  },

  /** La persona con sesión se inscribe como alumno en el curso de ese código. */
  async 'POST /api/join'({ db, user, request }) {
    const body = await readJson(request);
    const code = normalizeCode(body.code);
    if (code.length < 6) fail('Escribe el código completo que te dio tu docente.');
    const course = await one(
      db,
      `SELECT c.id, c.name, c.owner, c.archived_at, c.student_visible,
         (SELECT m.role FROM aula_members m WHERE m.course=c.id AND (m.user_id=?2 OR m.email=?3) ORDER BY m.user_id IS NULL LIMIT 1) AS role
       FROM aula_courses c
       WHERE c.join_code=?1 AND NOT EXISTS (SELECT 1 FROM aula_deleted_courses d WHERE d.course=c.id)`,
      code,
      user.id,
      user.email,
    );
    if (!course) fail('Ese código no es de ningún curso. Revísalo con tu docente; puede que lo haya cambiado.', 404);
    if (course.owner === user.id || course.role === 'teacher' || course.role === 'student') {
      return json({ course: course.id, name: course.name, already: true });
    }
    if (course.role === 'removed') fail('Tu docente te dio de baja de este curso. Si es un error, comunícate con él.', 403);
    if (course.archived_at) fail('Este curso ya terminó y no admite nuevas inscripciones.', 409);
    if (course.student_visible === 0) fail('Este curso todavía no está abierto a los alumnos.', 409);
    await run(
      db,
      `INSERT INTO aula_members (id,course,email,user_id,name,matricula,role,section) VALUES (?,?,?,?,?,'','student','')
       ON CONFLICT(course,email) DO NOTHING`,
      crypto.randomUUID(),
      course.id,
      user.email,
      user.id,
      String(user.name || user.email).slice(0, 150),
    );
    return json({ course: course.id, name: course.name, already: false }, 201);
  },
};
