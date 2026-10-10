import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "./database.ts";

function tableNames(db: ReturnType<typeof openDatabase>): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => String(row.name));
}

describe("migrate", () => {
  it("applies numbered files in order and records each once", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    writeFileSync(join(dir, "002_second.sql"), "ALTER TABLE first ADD COLUMN b TEXT;");
    writeFileSync(join(dir, "001_first.sql"), "CREATE TABLE first (a TEXT);");
    const db = openDatabase(":memory:");

    migrate(db, dir);
    migrate(db, dir);

    expect(tableNames(db)).toEqual(["first", "schema_migrations"]);
    expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([
      { version: 1 },
      { version: 2 },
    ]);
    db.prepare("INSERT INTO first (a, b) VALUES ('x', 'y')").run();
  });

  it("leaves the database unchanged when a file fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    writeFileSync(join(dir, "001_bad.sql"), "CREATE TABLE ok (a TEXT); CREATE TABLE broken (;");
    const db = openDatabase(":memory:");

    expect(() => migrate(db, dir)).toThrow();
    expect(tableNames(db)).toEqual(["schema_migrations"]);
  });
});

describe("the shipped schema", () => {
  it("removes topics, articles, candidates and runs with their category", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare(
      `INSERT INTO categories (id, slug, name, kind, schedule, min_importance, max_articles_per_run, window_hours, created_at)
       VALUES (1, 'security', 'Security', 'news', '["05:00"]', 3, 5, 24, ?)`,
    ).run(now);
    db.prepare("INSERT INTO topics (id, category_id, text, created_at) VALUES (1, 1, 'exploited bugs', ?)").run(now);
    db.prepare("INSERT INTO runs (id, category_id, trigger, status, queued_at) VALUES (1, 1, 'manual', 'succeeded', ?)").run(now);
    db.prepare(
      `INSERT INTO articles (id, category_id, kind, title, summary, body, importance, first_published_at, updated_at)
       VALUES (1, 1, 'news', 't', 's', 'b', 3, ?, ?)`,
    ).run(now, now);
    db.prepare("INSERT INTO article_refs (article_id, url, site_name, title, position) VALUES (1, 'https://example.org/a', 'Example', 't', 0)").run();
    db.prepare(
      "INSERT INTO candidates (id, category_id, run_id, url, title, source_kind, status, created_at) VALUES (1, 1, 1, 'https://example.org/a', 't', 'feed', 'rejected', ?)",
    ).run(now);
    db.prepare("INSERT INTO candidate_topics (candidate_id, topic_id) VALUES (1, 1)").run();
    db.prepare("INSERT INTO seen_urls (category_id, url, first_seen_at) VALUES (1, 'https://example.org/a', ?)").run(now);

    db.prepare("DELETE FROM categories WHERE id = 1").run();

    for (const table of ["topics", "runs", "articles", "article_refs", "candidates", "candidate_topics", "seen_urls"]) {
      expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 });
    }
  });

  it("can be applied twice without changing the result", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const before = tableNames(db);
    migrate(db);
    expect(tableNames(db)).toEqual(before);
  });
});
