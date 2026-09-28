// Aviso de privacidad: versión vigente y registro de su aceptación.
// Al cambiar el fondo de src/public/privacidad.html, sube PRIVACY_VERSION: todas las personas lo aceptan de nuevo.
import { json, nowIso, run } from './http.js';

export const PRIVACY_VERSION = '2026-10';

export const privacyAccepted = (user) => user.privacy_version === PRIVACY_VERSION;

export const privacyRoutes = {
  'POST /api/privacy/accept': async ({ db, user }) => {
    await run(db, 'UPDATE aula_users SET privacy_version=?, privacy_accepted_at=? WHERE id=?', PRIVACY_VERSION, nowIso(), user.id);
    return json({ version: PRIVACY_VERSION });
  },
};
