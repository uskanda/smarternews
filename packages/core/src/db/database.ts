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

/** Runs `fn` inside one transaction and rolls back when it throws. */
export function transaction<T>(db: Database, fn: () => T): T {
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
    transaction(db, () => {
      db.exec(readFileSync(join(dir, name), "utf8"));
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        version,
        new Date().toISOString(),
      );
    });
  }
}
