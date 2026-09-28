// Lectura de respaldos de D1 (`wrangler d1 export`) para poder restaurarlos en una base nueva.
//
// La exportación de D1 escribe las tablas en el orden en que se crearon y cada INSERT justo después de su tabla.
// Con las llaves foráneas activas (D1 siempre las revisa), insertar en aula_courses falla si aula_units todavía no
// existe ("no such table: main.aula_units"), así que el archivo tal cual NO se puede cargar en una base vacía.
// `orderDump()` lo reordena: primero todas las tablas, después los datos (padres antes que hijos) y al final los
// índices. `verifyDump()` lo carga en una base SQLite en memoria para comprobar que el respaldo se puede restaurar.

/** Divide un script SQL en sentencias, respetando ; y saltos de línea dentro de textos e identificadores. */
export function splitStatements(sql) {
  const out = [];
  let start = 0;
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) {
        if (sql[i + 1] === quote) i++; // '' dentro de un texto
        else quote = null;
      }
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '[') quote = ']';
    else if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end;
    } else if (ch === ';') {
      // Los comentarios antes de la sentencia se quitan para reconocer su tipo (CREATE, INSERT…).
      const statement = sql.slice(start, i).replace(/^(\s*--[^\n]*(\n|$))+/, '').trim();
      if (statement) out.push(statement);
      start = i + 1;
    }
  }
  const rest = sql.slice(start).replace(/^(\s*--[^\n]*(\n|$))+/, '').trim();
  if (rest) out.push(rest);
  return out;
}

const unquote = (name) => name.replace(/^["`[]|["`\]]$/g, '');
const NAME = String.raw`("[^"]+"|` + '`[^`]+`' + String.raw`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)`;
const CREATE_TABLE = new RegExp(String.raw`^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${NAME}`, 'i');
const INSERT = new RegExp(String.raw`^INSERT\s+(?:OR\s+\w+\s+)?INTO\s+${NAME}`, 'i');
const REFERENCES = new RegExp(String.raw`REFERENCES\s+${NAME}`, 'gi');

/** Reordena un respaldo para que se pueda cargar en una base vacía. Devuelve el SQL y las tablas en orden. */
export function orderDump(sql) {
  const statements = splitStatements(sql);
  const creates = new Map(); // tabla → CREATE TABLE
  const inserts = new Map(); // tabla → INSERTs
  const after = []; // índices, disparadores, vistas
  for (const s of statements) {
    if (/^PRAGMA\b/i.test(s) || /^(BEGIN|COMMIT)\b/i.test(s)) continue;
    const table = s.match(CREATE_TABLE)?.[1];
    if (table) {
      creates.set(unquote(table), s);
      continue;
    }
    const target = s.match(INSERT)?.[1];
    if (target) {
      const name = unquote(target);
      if (!inserts.has(name)) inserts.set(name, []);
      inserts.get(name).push(s);
      continue;
    }
    after.push(s);
  }
  // Tablas internas de SQLite (sqlite_sequence) no se crean a mano.
  for (const name of [...creates.keys()]) if (name.startsWith('sqlite_')) creates.delete(name);
  // Orden de datos: cada tabla después de las tablas a las que hace referencia.
  const deps = new Map([...creates].map(([name, s]) => [name, new Set([...s.matchAll(REFERENCES)].map((m) => unquote(m[1])).filter((d) => d !== name && creates.has(d)))]));
  const order = [];
  const visiting = new Set();
  const visit = (name) => {
    if (order.includes(name) || visiting.has(name)) return; // un ciclo se resuelve con defer_foreign_keys
    visiting.add(name);
    for (const d of deps.get(name) || []) visit(d);
    visiting.delete(name);
    order.push(name);
  };
  for (const name of creates.keys()) visit(name);
  const unknown = [...inserts.keys()].filter((t) => !creates.has(t) && !t.startsWith('sqlite_'));
  if (unknown.length) throw new Error(`El respaldo tiene datos de tablas que no crea: ${unknown.join(', ')}`);
  const body = [
    'PRAGMA defer_foreign_keys=TRUE',
    ...order.map((t) => creates.get(t)),
    ...order.flatMap((t) => inserts.get(t) || []),
    ...[...inserts.keys()].filter((t) => t.startsWith('sqlite_')).flatMap((t) => inserts.get(t)),
    ...after,
  ];
  return { sql: body.join(';\n') + ';\n', tables: order, rows: Object.fromEntries(order.map((t) => [t, (inserts.get(t) || []).length])) };
}

/**
 * Carga el respaldo (ya reordenado) en una base SQLite en memoria con las llaves foráneas activas, como D1.
 * Devuelve el número de filas por tabla; lanza un error si algo no se puede cargar o no cuadra.
 */
export async function verifyDump(sql) {
  const { DatabaseSync } = await import('node:sqlite');
  const { sql: ordered, tables, rows } = orderDump(sql);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    db.exec('BEGIN');
    try {
      db.exec(ordered);
    } catch (error) {
      throw new Error(`no se pudo cargar (${error.message}).`);
    }
    // Antes de cerrar la transacción (las llaves se revisan al final por defer_foreign_keys).
    const broken = db.prepare('PRAGMA foreign_key_check').all();
    if (broken.length) throw new Error(`${broken.length} filas apuntan a registros que no existen (por ejemplo, en ${broken[0].table}).`);
    db.exec('COMMIT');
    const counts = {};
    for (const t of tables) counts[t] = db.prepare(`SELECT count(*) AS n FROM "${t}"`).get().n;
    for (const t of tables) if (counts[t] !== rows[t]) throw new Error(`La tabla ${t} tiene ${counts[t]} filas y el respaldo ${rows[t]}.`);
    return counts;
  } finally {
    db.close();
  }
}
