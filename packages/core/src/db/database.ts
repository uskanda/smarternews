import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Database = DatabaseSync;

const SHIPPED_MIGRATIONS = join(import.meta.dirname, "migrations");

export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  return db;
}

/**
 * Runs `fn` inside one transaction and rolls back when it throws. Called inside a transaction, it joins
 * that one: the outer call commits or rolls back everything.
 */
export function transaction<T>(db: Database, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** A migration whose first line is this comment rebuilds tables, so it runs with foreign keys switched off. */
const REBUILD_MARK = /^--\s*foreign_keys:\s*off\b/;

function record(db: Database, version: number): void {
  db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
}

/**
 * Runs a migration that drops and recreates tables. With foreign keys on, dropping a table would delete
 * the rows that refer to it; so they are switched off, and the references are checked before committing.
 */
function rebuild(db: Database, sql: string, version: number, name: string, copyFirst: boolean): void {
  const file = db.location();
  // A copy to go back to, taken before the first statement. In-memory databases have no file.
  if (file && copyFirst) db.exec(`VACUUM INTO '${`${file}.before-${String(version).padStart(3, "0")}`.replaceAll("'", "''")}'`);
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    transaction(db, () => {
      db.exec(sql);
      const broken = db.prepare("PRAGMA foreign_key_check").all();
      if (broken.length > 0) {
        throw new Error(`migration ${name} leaves ${broken.length} broken foreign key reference(s), first in table ${String(broken[0]!.table)}`);
      }
      record(db, version);
    });
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

/** Applies the numbered SQL files of `dir` that the database has not seen yet, each in its own transaction. */
export function migrate(db: Database, dir: string = SHIPPED_MIGRATIONS): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => Number(row.version)),
  );
  const files = readdirSync(dir)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort();
  for (const name of files) {
    const version = Number.parseInt(name, 10);
    if (applied.has(version)) continue;
    const sql = readFileSync(join(dir, name), "utf8");
    if (REBUILD_MARK.test(sql)) {
      // A database created by this very call holds nothing worth copying.
      rebuild(db, sql, version, name, applied.size > 0);
      continue;
    }
    transaction(db, () => {
      db.exec(sql);
      record(db, version);
    });
  }
}
