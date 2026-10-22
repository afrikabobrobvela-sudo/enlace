// Aviso de privacidad: versión vigente y registro de su aceptación.
// Al cambiar el fondo de src/public/privacidad.html, sube PRIVACY_VERSION: todas las personas lo aceptan de nuevo.
import { json, nowIso, run } from './http.js';

// 2026-10b: ubicación al registrar asistencia con código. 2026-10c: aviso completo (responsable, domicilio, contacto,
// fotografía, evaluaciones, proveedores, plazos y derechos).
export const PRIVACY_VERSION = '2026-10c';

export const privacyAccepted = (user) => user.privacy_version === PRIVACY_VERSION;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Página del aviso con los datos del responsable que vienen de la configuración (wrangler.toml): el domicilio
 * (AVISO_DOMICILIO) y el correo de contacto (AULA_OWNER_EMAIL, que se pone al publicar y no está en el repositorio).
 */
export function privacyPage(template, env) {
  const email = String(env.AULA_OWNER_EMAIL || '').trim();
  const contact = /^[^\s@<>"']+@[^\s@<>"']+$/.test(email) && email !== 'tu-correo@gmail.com' ? email : '';
  const address = String(env.AVISO_DOMICILIO || '').trim();
  return template
    .replaceAll('{{AVISO_DOMICILIO}}', escapeHtml(address || 'Se proporciona por correo a quien lo solicite.'))
    .replace(/<a href="mailto:\{\{AVISO_CORREO\}\}">\{\{AVISO_CORREO\}\}<\/a>/g, contact ? `<a href="mailto:${escapeHtml(contact)}">${escapeHtml(contact)}</a>` : 'la administración de Enlace')
    .replaceAll('{{AVISO_CORREO}}', escapeHtml(contact));
}

export const privacyRoutes = {
  'POST /api/privacy/accept': async ({ db, user }) => {
    await run(db, 'UPDATE aula_users SET privacy_version=?, privacy_accepted_at=? WHERE id=?', PRIVACY_VERSION, nowIso(), user.id);
    return json({ version: PRIVACY_VERSION });
  },
};
