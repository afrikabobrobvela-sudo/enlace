// Safe Exam Browser con un solo botón (12.28). Enlace arma la configuración de SEB de cada evaluación (la dirección de
// inicio es la evaluación misma), la sirve en /seb/<evaluación>.seb y calcula su Config Key, así el docente solo marca
// «Exigir Safe Exam Browser» y el alumno toca «Abrir en Safe Exam Browser» (enlace sebs://, que abre SEB con esa
// configuración). SEB manda en cada solicitud X-SafeExamBrowser-ConfigKeyHash = SHA-256(URL completa + Config Key).
//
// La Config Key es el SHA-256 del JSON de la configuración, sin «originatorVersion», con las llaves ordenadas sin
// distinguir mayúsculas y sin espacios (el mismo cálculo que hace Moodle con quizaccess_seb).
import { SECURITY_HEADERS, one, parseJson } from './http.js';

const unpack = (row) => (row ? { ...row, data: parseJson(row.data, {}) } : null);

const SEB_KEY = /^[0-9a-f]{64}$/;

async function sha256hex(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Dirección de la evaluación dentro de Enlace (la ruta que entiende navegacion.js). */
export const quizStartUrl = (origin, quiz) => `${origin}/#c=${encodeURIComponent(quiz.course)}&s=quiz&d=${encodeURIComponent(quiz.id)}`;

/**
 * Configuración de SEB de una evaluación: empieza en ella, manda las llaves en cada solicitud y deja recargar.
 * Las restricciones se declaran explícitamente porque sus valores predeterminados cambian entre Windows, macOS e iOS.
 */
export function sebSettings(origin, quiz) {
  return {
    originatorVersion: 'Enlace',
    configPurpose: 0, // 0 = presentar un examen (no configurar el equipo)
    startURL: quizStartUrl(origin, quiz),
    sendBrowserExamKey: true, // sin esto SEB no manda las cabeceras que revisa Enlace
    allowQuit: true,
    quitURLConfirm: true,
    browserWindowAllowReload: true,
    showReloadButton: true,
    showTaskBar: true,
    showTime: true,
    allowSwitchToApplications: false,
    allowUserSwitching: false,
    allowSiri: false,
    allowDictation: false,
    allowScreenCapture: false,
    allowWindowCapture: false,
    allowScreenSharing: false,
    enablePrintScreen: false,
    allowAudioCapture: false,
    allowVideoCapture: false,
    allowVirtualMachine: false,
    allowDeveloperConsole: false,
    allowDictionaryLookup: false,
    monitorProcesses: true,
    allowSpellCheck: false,
    URLFilterEnable: false,
  };
}

const sortKeys = (keys) => [...keys].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));

/** JSON canónico de la Config Key (llaves ordenadas sin distinguir mayúsculas, sin espacios). */
export function sebKeyJson(settings) {
  const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${sortKeys(Object.keys(value)).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    return JSON.stringify(value);
  };
  const { originatorVersion: _o, ...rest } = settings;
  return canonical(rest);
}

export const sebConfigKey = (settings) => sha256hex(sebKeyJson(settings));

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** El archivo .seb (lista de propiedades XML sin cifrar). */
export function sebPlist(settings) {
  const value = (v) => (v === true ? '<true/>' : v === false ? '<false/>' : Number.isInteger(v) ? `<integer>${v}</integer>` : `<string>${xmlEscape(v)}</string>`);
  const body = Object.entries(settings)
    .map(([k, v]) => `\t<key>${xmlEscape(k)}</key>\n\t${value(v)}`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`;
}

/**
 * ¿La solicitud viene de Safe Exam Browser con una configuración permitida? La de Enlace para esta evaluación siempre
 * vale; además, las llaves de un archivo .seb propio del docente, si pegó alguna. true si la evaluación no lo exige.
 */
export async function sebAllows(quiz, request) {
  const seb = quiz.data.settings?.seb;
  if (!seb?.required) return true;
  const url = request.url.split('#')[0];
  const sent = [request.headers.get('X-SafeExamBrowser-ConfigKeyHash'), request.headers.get('X-SafeExamBrowser-RequestHash')]
    .map((h) => String(h || '').trim().toLowerCase())
    .filter((h) => SEB_KEY.test(h));
  if (!sent.length) return false;
  const keys = [await sebConfigKey(sebSettings(new URL(request.url).origin, quiz)), ...(seb.keys || [])];
  for (const key of keys) if (sent.includes(await sha256hex(url + key))) return true;
  return false;
}

/** ¿La evaluación exige SEB y la solicitud viene de él con su configuración? (entonces no hay «salidas» que contar) */
export async function sebVerified(quiz, request) {
  return Boolean(quiz.data.settings?.seb?.required) && (await sebAllows(quiz, request));
}

/**
 * GET /seb/<evaluación>.seb: la configuración para abrir la evaluación en SEB. No pide sesión (SEB la descarga con su
 * propio navegador) y solo contiene la dirección de la evaluación; existe solo si la evaluación exige SEB.
 */
export async function serveSebConfig(db, id, origin) {
  const row = /^[A-Za-z0-9-]{1,64}$/.test(id) ? unpack(await one(db, "SELECT * FROM aula_records WHERE id=? AND kind='quiz' AND deleted_at IS NULL", id)) : null;
  if (!row?.data?.settings?.seb?.required) return new Response('No encontrado', { status: 404, headers: SECURITY_HEADERS });
  return new Response(sebPlist(sebSettings(origin, row)), {
    headers: {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/seb',
      'Content-Disposition': `attachment; filename="evaluacion-${id}.seb"`,
      'Cache-Control': 'no-store',
    },
  });
}
