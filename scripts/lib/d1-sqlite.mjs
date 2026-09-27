// Adaptador mínimo que imita la API de Cloudflare D1 sobre node:sqlite, para pruebas locales.
// Activa las llaves foráneas (D1 las aplica siempre) y cuenta las consultas para vigilar
// el límite de 50 consultas por solicitud del plan gratuito.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export function openD1(file, { migrations = 'all' } = {}) {
  let sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA foreign_keys = ON');
  const counter = { queries: 0 };
  const statement = (sql) => {
    let args = [];
    return {
      sql,
      bind(...params) {
        args = params;
        return this;
      },
      async first() {
        counter.queries++;
        return sqlite.prepare(sql).get(...args) || null;
      },
      async all() {
        counter.queries++;
        return { results: sqlite.prepare(sql).all(...args) };
      },
      async run() {
        counter.queries++;
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
    async delete(id) {
      blobs.delete(id);
    },
  };
}
