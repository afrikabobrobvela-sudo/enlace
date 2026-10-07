import { roleFor } from './auth.js';
import { listCourses } from './course-list.js';
import { fail, json, one } from './http.js';

const MOBILE_SESSION_ERROR = 'La sesión móvil no es válida.';

function bearer(request) {
  const value = request.headers.get('authorization') || '';
  const match = /^Bearer\s+([^\s]+)$/i.exec(value);
  return match?.[1] || '';
}

function normalizedEmail(value) {
  const address = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : '';
}

/** Resuelve una identidad de Supabase contra una cuenta ya existente en Enlace. */
export async function mobileIdentity(request, env) {
  const token = bearer(request);
  if (!token) fail(MOBILE_SESSION_ERROR, 401);
  const base = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const publishable = String(env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!base || !publishable) fail('La identidad móvil no está configurada.', 503);

  let response;
  try {
    response = await fetch(`${base}/auth/v1/user`, {
      headers: { apikey: publishable, Authorization: `Bearer ${token}` },
    });
  } catch {
    fail('No se pudo verificar la identidad móvil.', 503);
  }
  if (!response.ok) fail(MOBILE_SESSION_ERROR, 401);
  let remote;
  try {
    remote = await response.json();
  } catch {
    fail(MOBILE_SESSION_ERROR, 401);
  }
  const email = normalizedEmail(remote?.email);
  if (!email || !remote?.email_confirmed_at) fail(MOBILE_SESSION_ERROR, 401);

  const user = await one(env.DB, 'SELECT id,email,name,photo,suspended_at FROM aula_users WHERE lower(email)=?', email);
  if (!user) fail('La cuenta no tiene acceso a Enlace.', 403);
  if (user.suspended_at) fail('Tu acceso a Enlace está suspendido.', 403);
  const role = await roleFor(env.DB, env, email);
  return { id: user.id, email, name: user.name, role, photo: null };
}

export async function mobileApi(request, env) {
  const user = await mobileIdentity(request, env);
  const route = `${request.method} ${new URL(request.url).pathname}`;
  if (route === 'GET /api/mobile/v1/me') return json(user);
  if (route === 'GET /api/mobile/v1/courses') {
    const courses = await listCourses(env.DB, user);
    return json(courses.map(({ id, name, group_name: groupName, period: term, canTeach }) => ({ id, name, groupName, term, canTeach })));
  }
  fail('Ruta no encontrada.', 404);
}
