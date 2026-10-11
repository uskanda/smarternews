import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate, openDatabase, transaction } from "./database.ts";

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

describe("transaction", () => {
  it("joins the transaction it is called in, so that the outer one undoes everything", () => {
    const db = openDatabase(":memory:");
    db.exec("CREATE TABLE t (a TEXT)");
    expect(() =>
      transaction(db, () => {
        transaction(db, () => db.exec("INSERT INTO t VALUES ('inner')"));
        throw new Error("outer fails");
      }),
    ).toThrow("outer fails");
    expect(db.prepare("SELECT count(*) AS n FROM t").get()).toEqual({ n: 0 });
  });
});

describe("a migration that rebuilds a table", () => {
  const PARENT_AND_CHILD = `
    CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent (id) ON DELETE CASCADE);
    INSERT INTO parent (id, name) VALUES (1, 'a');
    INSERT INTO child (id, parent_id) VALUES (10, 1);`;
  const REBUILD = `-- foreign_keys: off
    CREATE TABLE parent_new (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO parent_new SELECT id, name FROM parent;
    DROP TABLE parent;
    ALTER TABLE parent_new RENAME TO parent;`;

  it("keeps the rows that refer to the rebuilt table", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    writeFileSync(join(dir, "001_first.sql"), PARENT_AND_CHILD);
    writeFileSync(join(dir, "002_rebuild.sql"), REBUILD);
    const db = openDatabase(":memory:");

    migrate(db, dir);

    expect(db.prepare("SELECT count(*) AS n FROM child").get()).toEqual({ n: 1 });
    db.prepare("INSERT INTO parent (id, name) VALUES (2, NULL)").run();
    // Foreign keys are enforced again afterwards.
    expect(() => db.prepare("INSERT INTO child (id, parent_id) VALUES (11, 99)").run()).toThrow();
  });

  it("undoes the whole file when it leaves a broken reference", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    writeFileSync(join(dir, "001_first.sql"), PARENT_AND_CHILD);
    writeFileSync(join(dir, "002_break.sql"), "-- foreign_keys: off\nDELETE FROM parent;");
    const db = openDatabase(":memory:");

    expect(() => migrate(db, dir)).toThrow(/foreign key/i);
    expect(db.prepare("SELECT count(*) AS n FROM parent").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT version FROM schema_migrations").all()).toEqual([{ version: 1 }]);
    expect(() => db.prepare("INSERT INTO child (id, parent_id) VALUES (11, 99)").run()).toThrow();
  });

  it("copies a database file before rebuilding", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    writeFileSync(join(dir, "001_first.sql"), PARENT_AND_CHILD);
    const file = join(mkdtempSync(join(tmpdir(), "sn-db-")), "db.sqlite");
    const db = openDatabase(file);
    migrate(db, dir);
    expect(existsSync(`${file}.before-002`)).toBe(false);

    writeFileSync(join(dir, "002_rebuild.sql"), REBUILD);
    migrate(db, dir);

    const copy = openDatabase(`${file}.before-002`);
    expect(copy.prepare("SELECT version FROM schema_migrations").all()).toEqual([{ version: 1 }]);
    expect(copy.prepare("SELECT count(*) AS n FROM child").get()).toEqual({ n: 1 });
    copy.close();
    db.close();
  });
});

describe("the migration to feeds", () => {
  const SHIPPED = join(import.meta.dirname, "migrations");

  it("keeps articles, their references, topics and candidates", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    copyFileSync(join(SHIPPED, "001_init.sql"), join(dir, "001_init.sql"));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare(
      `INSERT INTO categories (id, slug, name, kind, schedule, min_importance, max_articles_per_run, window_hours, created_at)
       VALUES (1, 'tools', 'Tools', 'news', '["05:00"]', 3, 5, 24, ?)`,
    ).run(now);
    db.prepare("INSERT INTO topics (id, category_id, text, created_at) VALUES (1, 1, 'releases', ?)").run(now);
    db.prepare(
      `INSERT INTO articles (id, category_id, kind, title, summary, body, importance, first_published_at, updated_at, is_read, starred)
       VALUES (1, 1, 'news', 'first', 's', 'b', 4, ?, ?, 1, 1)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO articles (id, category_id, kind, title, summary, body, importance, first_published_at, updated_at, previous_article_id)
       VALUES (2, 1, 'news', 'second', 's', 'b', 3, ?, ?, 1)`,
    ).run(now, now);
    db.prepare("INSERT INTO article_refs (article_id, url, site_name, title, position) VALUES (1, 'https://example.org/a', 'Example', 't', 0)").run();
    db.prepare("INSERT INTO article_topics (article_id, topic_id) VALUES (1, 1)").run();
    db.prepare(
      "INSERT INTO candidates (id, category_id, url, title, source_kind, status, article_id, created_at) VALUES (1, 1, 'https://example.org/a', 't', 'feed', 'accepted', 1, ?)",
    ).run(now);

    copyFileSync(join(SHIPPED, "002_feeds.sql"), join(dir, "002_feeds.sql"));
    migrate(db, dir);

    expect(db.prepare("SELECT id, origin, feed_id, title, importance, is_read, starred, previous_article_id FROM articles ORDER BY id").all()).toEqual([
      { id: 1, origin: "generated", feed_id: null, title: "first", importance: 4, is_read: 1, starred: 1, previous_article_id: null },
      { id: 2, origin: "generated", feed_id: null, title: "second", importance: 3, is_read: 0, starred: 0, previous_article_id: 1 },
    ]);
    expect(db.prepare("SELECT count(*) AS n FROM article_refs").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT count(*) AS n FROM article_topics").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT article_id FROM candidates").get()).toEqual({ article_id: 1 });
    expect(db.prepare("SELECT feed_interval_minutes FROM settings").all()).toEqual([]);

    // The references still follow the rebuilt table.
    db.prepare("DELETE FROM articles WHERE id = 1").run();
    expect(db.prepare("SELECT count(*) AS n FROM article_refs").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT article_id FROM candidates").get()).toEqual({ article_id: null });
    expect(db.prepare("SELECT previous_article_id FROM articles WHERE id = 2").get()).toEqual({ previous_article_id: null });
  });

  it("lets a feed article have no category and no importance, and a generated one neither", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (1, 'https://example.org/feed', 'Example', ?)").run(now);
    db.prepare(
      `INSERT INTO articles (origin, feed_id, item_key, kind, title, summary, body, first_published_at, updated_at)
       VALUES ('feed', 1, 'k1', 'news', 't', 's', 'b', ?, ?)`,
    ).run(now, now);
    expect(() =>
      db
        .prepare("INSERT INTO articles (origin, kind, title, summary, body, first_published_at, updated_at) VALUES ('generated', 'news', 't', 's', 'b', ?, ?)")
        .run(now, now),
    ).toThrow();
    // The same item of the same feed is stored once.
    expect(() =>
      db
        .prepare(
          `INSERT INTO articles (origin, feed_id, item_key, kind, title, summary, body, first_published_at, updated_at)
           VALUES ('feed', 1, 'k1', 'news', 't', 's', 'b', ?, ?)`,
        )
        .run(now, now),
    ).toThrow();

    db.prepare("DELETE FROM feeds WHERE id = 1").run();
    expect(db.prepare("SELECT count(*) AS n FROM articles").get()).toEqual({ n: 0 });
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

describe("the migration to an order of categories and feeds", () => {
  const SHIPPED = join(import.meta.dirname, "migrations");

  it("keeps the rows in the order they were registered in, and leaves moving on switched off", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    for (const name of ["001_init.sql", "002_feeds.sql"]) copyFileSync(join(SHIPPED, name), join(dir, name));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    const now = "2026-01-01T00:00:00.000Z";
    for (const [id, slug] of [[3, "c"], [7, "a"]] as const) {
      db.prepare(
        `INSERT INTO categories (id, slug, name, kind, schedule, min_importance, max_articles_per_run, window_hours, created_at)
         VALUES (?, ?, ?, 'news', '["05:00"]', 3, 5, 24, ?)`,
      ).run(id, slug, slug, now);
    }
    db.prepare("INSERT INTO feeds (id, url, title, category_id, created_at) VALUES (5, 'https://example.org/5', 'five', 3, ?)").run(now);
    db.prepare("INSERT INTO feeds (id, url, title, category_id, created_at) VALUES (9, 'https://example.org/9', 'nine', 3, ?)").run(now);
    db.prepare("INSERT INTO settings (id, reader_info, output_language, time_zone, search_language, search_region) VALUES (1, '', 'ja', 'UTC', 'ja', 'JP')").run();

    copyFileSync(join(SHIPPED, "003_order.sql"), join(dir, "003_order.sql"));
    migrate(db, dir);

    expect(db.prepare("SELECT slug, position FROM categories ORDER BY position").all()).toEqual([
      { slug: "c", position: 3 },
      { slug: "a", position: 7 },
    ]);
    expect(db.prepare("SELECT title, position FROM feeds ORDER BY position").all()).toEqual([
      { title: "five", position: 5 },
      { title: "nine", position: 9 },
    ]);
    expect(db.prepare("SELECT advance_after_mark_all FROM settings").get()).toEqual({ advance_after_mark_all: 0 });
  });
});
