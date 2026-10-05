// Adaptador mínimo que imita la API de Cloudflare D1 sobre node:sqlite, para pruebas locales.
// Activa las llaves foráneas (D1 las aplica siempre) y cuenta las consultas para vigilar
// el límite de 50 consultas por solicitud del plan gratuito.
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';

/** Parámetros que usa la consulta (?N numerados o ? sueltos), sin contar los que aparecen dentro de textos '…'. */
function paramCount(sql) {
  const code = sql.replace(/'(?:[^']|'')*'/g, "''");
  const numbered = [...code.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]));
  return numbered.length ? Math.max(...numbered) : (code.match(/\?/g) || []).length;
}

export function openD1(file, { migrations = 'all' } = {}) {
  let sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA foreign_keys = ON');
  const counter = { queries: 0 };
  // D1_PLANES=archivo: anota las consultas que recorren una tabla grande completa (SCAN), para revisarlas (12.30).
  const planes = process.env.D1_PLANES;
  const revisadas = new Set();
  const revisa = (sql, args) => {
    if (!planes || revisadas.has(sql)) return;
    revisadas.add(sql);
    try {
      const plan = sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args).map((p) => p.detail);
      const scans = plan.filter((d) => /^SCAN (\w+)(?! VIRTUAL)/.test(d) && !/USING (COVERING )?INDEX/.test(d));
      if (scans.length) appendFileSync(planes, `${scans.join(' | ')}\n    ${sql.replace(/\s+/g, ' ').slice(0, 400)}\n`);
    } catch {
      // EXPLAIN de algo que no es SELECT/UPDATE (p. ej. PRAGMA): no importa.
    }
  };
  const statement = (sql) => {
    // D1 limita un SELECT compuesto a 5 términos (SQLite local admite 500): se imita para detectarlo en las pruebas.
    if ((sql.match(/\bUNION\b/gi) || []).length + 1 > 5) throw new Error('D1_ERROR: too many terms in compound SELECT');
    let args = [];
    return {
      sql,
      bind(...params) {
        // Como D1: si la consulta usa ?1 y ?2 y se mandan tres valores, falla («Wrong number of parameter bindings»).
        // node:sqlite 22 los aceptaba en silencio y así se publicó un error que tumbaba la carga del curso (12.30).
        if (params.length !== paramCount(sql)) throw new Error(`D1_ERROR: Wrong number of parameter bindings for SQL query. (${params.length} valores para ${paramCount(sql)}: ${sql.replace(/\s+/g, ' ').slice(0, 120)})`);
        args = params;
        return this;
      },
      async first() {
        counter.queries++;
        revisa(sql, args);
        return sqlite.prepare(sql).get(...args) || null;
      },
      async all() {
        counter.queries++;
        revisa(sql, args);
        return { results: sqlite.prepare(sql).all(...args) };
      },
      async run() {
        counter.queries++;
        revisa(sql, args);
        return { meta: { changes: sqlite.prepare(sql).run(...args).changes } };
      },
    };
  };
  const DB = {
    prepare: statement,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const applyMigrations = (filter = () => true) => {
    const dir = new URL('../../drizzle/', import.meta.url);
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().filter(filter)) {
      sqlite.exec(readFileSync(new URL(name, dir), 'utf8'));
    }
  };
  if (migrations === 'all') applyMigrations();
  return {
    DB,
    counter,
    applyMigrations,
    raw: () => sqlite,
    reopen() {
      sqlite.close();
      sqlite = new DatabaseSync(file);
      sqlite.exec('PRAGMA foreign_keys = ON');
    },
    close: () => sqlite.close(),
  };
}

export function memoryBucket() {
  const blobs = new Map();
  return {
    blobs,
    async put(id, blob) {
      blobs.set(id, await blob.arrayBuffer());
    },
    // Igual que R2: acepta { range: { offset, length } } y devuelve un objeto con body y arrayBuffer().
    async get(id, options = {}) {
      if (!blobs.has(id)) return null;
      let data = blobs.get(id);
      if (options.range) {
        const { offset = 0, length } = options.range;
        data = data.slice(offset, length === undefined ? undefined : offset + length);
      }
      return { body: data, arrayBuffer: async () => data };
    },
    async head(id) {
      return blobs.has(id) ? { key: id, size: blobs.get(id).byteLength } : null;
    },
    async delete(id) {
      // Como R2: acepta una llave o un arreglo de llaves.
      for (const key of [].concat(id)) blobs.delete(key);
    },
  };
}
