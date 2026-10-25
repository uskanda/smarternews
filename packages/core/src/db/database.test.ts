import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate, openDatabase, transaction } from "./database.ts";
import { deleteUnstarredFeedArticlesBefore } from "./articles.ts";
import { buildPendingFilterMatches, listFilters } from "./filters.ts";
import { searchText } from "../search/plain.ts";

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

describe("the migration to summaries of feed articles", () => {
  const SHIPPED = join(import.meta.dirname, "migrations");

  it("leaves the feeds that exist without summaries, and gives every article the time it was stored", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    for (const name of ["001_init.sql", "002_feeds.sql", "003_order.sql"]) copyFileSync(join(SHIPPED, name), join(dir, name));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (5, 'https://example.org/5', 'five', ?)").run(now);
    db.prepare(
      `INSERT INTO articles (id, origin, feed_id, item_key, kind, title, summary, body, first_published_at, updated_at)
       VALUES (1, 'feed', 5, 'k', 'news', 't', 's', 'b', ?, ?)`,
    ).run("2025-12-30T00:00:00.000Z", "2025-12-31T00:00:00.000Z");

    copyFileSync(join(SHIPPED, "004_auto_summary.sql"), join(dir, "004_auto_summary.sql"));
    migrate(db, dir);

    expect(db.prepare("SELECT auto_summarize, auto_summarize_since FROM feeds").get()).toEqual({ auto_summarize: 0, auto_summarize_since: null });
    expect(
      db.prepare("SELECT created_at, auto_summary, auto_summary_source, auto_summary_at, auto_summary_attempts, auto_summary_skipped FROM articles").get(),
    ).toEqual({
      created_at: "2025-12-31T00:00:00.000Z",
      auto_summary: null,
      auto_summary_source: null,
      auto_summary_at: null,
      auto_summary_attempts: 0,
      auto_summary_skipped: 0,
    });
  });
});

describe("the migration to translations of feed articles", () => {
  const SHIPPED = join(import.meta.dirname, "migrations");

  it("leaves the feeds that exist without translation, and the articles without a translated title", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    for (const name of ["001_init.sql", "002_feeds.sql", "003_order.sql", "004_auto_summary.sql"]) copyFileSync(join(SHIPPED, name), join(dir, name));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (5, 'https://example.org/5', 'five', ?)").run(now);
    db.prepare(
      `INSERT INTO articles (id, origin, feed_id, item_key, kind, title, summary, body, first_published_at, updated_at, created_at)
       VALUES (1, 'feed', 5, 'k', 'news', 't', 's', 'b', ?, ?, ?)`,
    ).run(now, now, now);

    copyFileSync(join(SHIPPED, "005_translation.sql"), join(dir, "005_translation.sql"));
    migrate(db, dir);

    expect(db.prepare("SELECT translate FROM feeds").get()).toEqual({ translate: 0 });
    expect(db.prepare("SELECT translated_title, source_language FROM articles").get()).toEqual({ translated_title: null, source_language: null });
    expect(tableNames(db)).toEqual(expect.arrayContaining(["article_translations", "translation_usage"]));
    expect(db.prepare("SELECT count(*) AS n FROM article_translations").get()).toEqual({ n: 0 });
  });

  it("removes the stored translation together with its article", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (5, 'https://example.org/5', 'five', ?)").run(now);
    db.prepare(
      `INSERT INTO articles (id, origin, feed_id, item_key, kind, title, summary, body, first_published_at, updated_at, created_at)
       VALUES (1, 'feed', 5, 'k', 'news', 't', 's', 'b', ?, ?, ?)`,
    ).run(now, now, now);
    db.prepare("INSERT INTO article_translations (article_id, segments, method, truncated, created_at) VALUES (1, '[]', 'google', 0, ?)").run(now);
    db.prepare("DELETE FROM feeds WHERE id = 5").run();
    expect(db.prepare("SELECT count(*) AS n FROM article_translations").get()).toEqual({ n: 0 });
  });
});

describe("the migration to retries of runs", () => {
  const SHIPPED = join(import.meta.dirname, "migrations");

  it("leaves the runs that exist as first attempts with no retry planned", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    for (const name of ["001_init.sql", "002_feeds.sql", "003_order.sql", "004_auto_summary.sql", "005_translation.sql"]) {
      copyFileSync(join(SHIPPED, name), join(dir, name));
    }
    const db = openDatabase(":memory:");
    migrate(db, dir);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare(
      `INSERT INTO categories (id, slug, name, kind, schedule, min_importance, max_articles_per_run, window_hours, created_at)
       VALUES (1, 'tools', 'Tools', 'news', '["05:00"]', 3, 5, 24, ?)`,
    ).run(now);
    db.prepare("INSERT INTO runs (id, category_id, trigger, slot, status, queued_at) VALUES (1, 1, 'schedule', '2026-01-01T05:00', 'failed', ?)").run(now);

    copyFileSync(join(SHIPPED, "006_run_retries.sql"), join(dir, "006_run_retries.sql"));
    migrate(db, dir);

    expect(db.prepare("SELECT status, attempt, retry_of, retry_at, retry_skipped FROM runs").all()).toEqual([
      { status: "failed", attempt: 0, retry_of: null, retry_at: null, retry_skipped: null },
    ]);
  });

  it("keeps a retry when the run it retries is removed, and refuses an unknown reason", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare(
      `INSERT INTO categories (id, slug, name, kind, schedule, min_importance, max_articles_per_run, window_hours, created_at)
       VALUES (1, 'tools', 'Tools', 'news', '["05:00"]', 3, 5, 24, ?)`,
    ).run(now);
    db.prepare("INSERT INTO runs (id, category_id, trigger, slot, status, queued_at) VALUES (1, 1, 'schedule', '2026-01-01T05:00', 'failed', ?)").run(now);
    db.prepare("INSERT INTO runs (id, category_id, trigger, status, queued_at, attempt, retry_of) VALUES (2, 1, 'schedule', 'succeeded', ?, 1, 1)").run(now);

    db.prepare("DELETE FROM runs WHERE id = 1").run();

    expect(db.prepare("SELECT id, attempt, retry_of FROM runs").all()).toEqual([{ id: 2, attempt: 1, retry_of: null }]);
    expect(() => db.prepare("UPDATE runs SET retry_skipped = 'bored' WHERE id = 2").run()).toThrow();
  });
});

describe("the migration that switches moving on after marking all as read on", () => {
  const SHIPPED = join(import.meta.dirname, "migrations");

  it("switches it on for a server that has settings already", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    const before = ["001_init.sql", "002_feeds.sql", "003_order.sql", "004_auto_summary.sql", "005_translation.sql", "006_run_retries.sql", "007_summary_requests.sql"];
    for (const name of before) copyFileSync(join(SHIPPED, name), join(dir, name));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    db.prepare("INSERT INTO settings (id, reader_info, output_language, time_zone, search_language, search_region) VALUES (1, '', 'ja', 'UTC', 'ja', 'JP')").run();
    expect(db.prepare("SELECT advance_after_mark_all FROM settings").get()).toEqual({ advance_after_mark_all: 0 });

    copyFileSync(join(SHIPPED, "008_advance_by_default.sql"), join(dir, "008_advance_by_default.sql"));
    migrate(db, dir);

    expect(db.prepare("SELECT advance_after_mark_all FROM settings").get()).toEqual({ advance_after_mark_all: 1 });
  });
});

describe("the migration from stop words to filters", () => {
  const SHIPPED = join(import.meta.dirname, "migrations");
  const BEFORE = [
    "001_init.sql",
    "002_feeds.sql",
    "003_order.sql",
    "004_auto_summary.sql",
    "005_translation.sql",
    "006_run_retries.sql",
    "007_summary_requests.sql",
    "008_advance_by_default.sql",
  ];

  function withStopWords() {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    for (const name of BEFORE) copyFileSync(join(SHIPPED, name), join(dir, name));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO stop_words (id, text, normalized, scope, created_at) VALUES (1, '特売', '特売', 'title', ?)").run("2025-12-01T00:00:00.000Z");
    db.prepare("INSERT INTO stop_words (id, text, normalized, scope, created_at) VALUES (2, 'ＰＲ', 'pr', 'title_and_content', ?)").run("2025-12-02T00:00:00.000Z");
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (5, 'https://example.org/5', 'five', ?)").run(now);
    const insert = db.prepare(
      `INSERT INTO articles (id, origin, feed_id, item_key, kind, title, summary, body, content_text, first_published_at, updated_at, created_at, stop_word_id, is_read, starred, auto_summary, translated_title)
       VALUES (?, 'feed', 5, ?, 'news', ?, 's', 'b', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(1, "k1", "春の特売", "", now, now, now, 1, 0, 0, null, null);
    insert.run(2, "k2", "新製品", "PRです", now, now, now, 2, 1, 0, "要約", "訳");
    insert.run(3, "k3", "決算", "", now, now, now, null, 0, 1, null, null);
    copyFileSync(join(SHIPPED, "009_filters.sql"), join(dir, "009_filters.sql"));
    return { db, dir };
  }

  it("turns each stop word into a hide filter over everything, with its fields and time", () => {
    const { db, dir } = withStopWords();

    migrate(db, dir);

    expect(db.prepare("SELECT id, action, scope, category_id, feed_id, enabled, created_at FROM filters ORDER BY id").all()).toEqual([
      { id: 1, action: "hide", scope: "all", category_id: null, feed_id: null, enabled: 1, created_at: "2025-12-01T00:00:00.000Z" },
      { id: 2, action: "hide", scope: "all", category_id: null, feed_id: null, enabled: 1, created_at: "2025-12-02T00:00:00.000Z" },
    ]);
    expect(db.prepare("SELECT filter_id, position, fields, method, value, normalized FROM filter_conditions ORDER BY filter_id").all()).toEqual([
      { filter_id: 1, position: 0, fields: '["title"]', method: "contains", value: "特売", normalized: "特売" },
      { filter_id: 2, position: 0, fields: '["title","content"]', method: "contains", value: "ＰＲ", normalized: "pr" },
    ]);
    expect(tableNames(db)).not.toContain("stop_words");
  });

  it("keeps the articles, and hides what a stop word hid", () => {
    const { db, dir } = withStopWords();

    migrate(db, dir);

    expect(db.prepare("SELECT id, filtered, is_read, starred, auto_summary, translated_title FROM articles ORDER BY id").all()).toEqual([
      { id: 1, filtered: 1, is_read: 0, starred: 0, auto_summary: null, translated_title: null },
      { id: 2, filtered: 1, is_read: 1, starred: 0, auto_summary: "要約", translated_title: "訳" },
      { id: 3, filtered: 0, is_read: 0, starred: 1, auto_summary: null, translated_title: null },
    ]);
    const columns = db.prepare("SELECT name FROM pragma_table_info('articles')").all().map((row) => row.name);
    expect(columns).not.toContain("stop_word_id");
    // The first start matches the filters again.
    expect(db.prepare("SELECT count(*) AS n FROM filter_matches_pending").get()).toEqual({ n: 1 });
  });

  it("matches the filters once at the first start, and what the words hid stays hidden", () => {
    const { db, dir } = withStopWords();
    migrate(db, dir);
    // The server starts on the schema of today: the later migrations run before it matches.
    for (const name of readdirSync(SHIPPED).filter((file) => file > "010")) copyFileSync(join(SHIPPED, name), join(dir, name));
    migrate(db, dir);

    expect(buildPendingFilterMatches(db)).toBe(true);

    expect(db.prepare("SELECT filter_id, article_id FROM filter_matches ORDER BY filter_id").all()).toEqual([
      { filter_id: 1, article_id: 1 },
      { filter_id: 2, article_id: 2 },
    ]);
    expect(db.prepare("SELECT id FROM articles WHERE filtered = 1 ORDER BY id").all()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(listFilters(db).map((filter) => filter.hiddenCount)).toEqual([1, 1]);
    expect(buildPendingFilterMatches(db)).toBe(false);
  });

  it("leaves nothing to match on a server without stop words", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    expect(db.prepare("SELECT count(*) AS n FROM filter_matches_pending").get()).toEqual({ n: 0 });
  });
});

describe("the migration to duplicate removal", () => {
  const SHIPPED = join(import.meta.dirname, "migrations");
  const BEFORE = [
    "001_init.sql",
    "002_feeds.sql",
    "003_order.sql",
    "004_auto_summary.sql",
    "005_translation.sql",
    "006_run_retries.sql",
    "007_summary_requests.sql",
    "008_advance_by_default.sql",
    "009_filters.sql",
  ];

  it("leaves the feed articles that exist without values to compare and not duplicates, and switches removal on", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    for (const name of BEFORE) copyFileSync(join(SHIPPED, name), join(dir, name));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO settings (id, reader_info, output_language, time_zone, search_language, search_region) VALUES (1, '', 'ja', 'UTC', 'ja', 'JP')").run();
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (5, 'https://example.org/5', 'five', ?)").run(now);
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (6, 'https://example.org/6', 'six', ?)").run(now);
    const insert = db.prepare(
      `INSERT INTO articles (id, origin, feed_id, item_key, kind, title, summary, body, first_published_at, updated_at, created_at)
       VALUES (?, 'feed', ?, 'k', 'news', 'The same long title', 's', 'b', ?, ?, ?)`,
    );
    insert.run(1, 5, now, now, now);
    insert.run(2, 6, now, now, now);
    db.prepare("INSERT INTO article_refs (article_id, url, site_name, title, position) VALUES (1, 'https://example.org/a', '', 't', 0)").run();
    db.prepare("INSERT INTO article_refs (article_id, url, site_name, title, position) VALUES (2, 'https://example.org/a', '', 't', 0)").run();

    copyFileSync(join(SHIPPED, "010_feed_dedup.sql"), join(dir, "010_feed_dedup.sql"));
    migrate(db, dir);

    expect(db.prepare("SELECT id, dedup_url, dedup_title, duplicate_of FROM articles ORDER BY id").all()).toEqual([
      { id: 1, dedup_url: null, dedup_title: null, duplicate_of: null },
      { id: 2, dedup_url: null, dedup_title: null, duplicate_of: null },
    ]);
    expect(db.prepare("SELECT remove_duplicates FROM settings").get()).toEqual({ remove_duplicates: 1 });
  });
});

describe("removing the article that duplicates were recorded against", () => {
  function withDuplicates() {
    const db = openDatabase(":memory:");
    migrate(db);
    const stored = (day: number) => `2026-03-0${day}T00:00:00.000Z`;
    for (const id of [1, 2, 3]) db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (?, ?, ?, ?)").run(id, `https://example.org/${id}`, `feed ${id}`, stored(1));
    const insert = db.prepare(
      `INSERT INTO articles (id, origin, feed_id, item_key, kind, title, summary, body, first_published_at, updated_at, created_at, duplicate_of)
       VALUES (?, 'feed', ?, 'k', 'news', 't', 's', 'b', ?, ?, ?, ?)`,
    );
    // Article 1 of feed 1 is kept; feed 3's copy was stored before feed 2's, so it is the first duplicate.
    insert.run(1, 1, stored(1), stored(1), stored(1), null);
    insert.run(2, 2, stored(3), stored(3), stored(3), 1);
    insert.run(3, 3, stored(2), stored(2), stored(2), 1);
    return db;
  }
  const duplicates = (db: ReturnType<typeof openDatabase>) => db.prepare("SELECT id, duplicate_of FROM articles ORDER BY id").all();

  it("keeps the duplicate stored first, and records the others against it, when the feed goes", () => {
    const db = withDuplicates();
    db.prepare("DELETE FROM feeds WHERE id = 1").run();
    expect(duplicates(db)).toEqual([
      { id: 2, duplicate_of: 3 },
      { id: 3, duplicate_of: null },
    ]);
  });

  it("does the same when the kept article outlives its retention period", () => {
    const db = withDuplicates();
    db.prepare("UPDATE articles SET updated_at = '2025-01-01T00:00:00.000Z' WHERE id = 1").run();
    expect(deleteUnstarredFeedArticlesBefore(db, "2026-01-01T00:00:00.000Z")).toBe(1);
    expect(duplicates(db)).toEqual([
      { id: 2, duplicate_of: 3 },
      { id: 3, duplicate_of: null },
    ]);
  });

  it("leaves no duplicate behind when every copy goes at once", () => {
    const db = withDuplicates();
    db.prepare("DELETE FROM articles").run();
    expect(duplicates(db)).toEqual([]);
  });
});

describe("the migration to read times", () => {
  const SHIPPED = join(import.meta.dirname, "migrations");

  it("leaves the articles read before it without a read time", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    for (const name of readdirSync(SHIPPED).filter((file) => file < "011")) copyFileSync(join(SHIPPED, name), join(dir, name));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (5, 'https://example.org/5', 'five', ?)").run(now);
    const insert = db.prepare(
      `INSERT INTO articles (id, origin, feed_id, item_key, kind, title, summary, body, first_published_at, updated_at, created_at, is_read)
       VALUES (?, 'feed', 5, ?, 'news', 't', 's', 'b', ?, ?, ?, ?)`,
    );
    insert.run(1, "k1", now, now, now, 1);
    insert.run(2, "k2", now, now, now, 0);

    copyFileSync(join(SHIPPED, "011_read_at.sql"), join(dir, "011_read_at.sql"));
    migrate(db, dir);

    expect(db.prepare("SELECT id, is_read, read_at FROM articles ORDER BY id").all()).toEqual([
      { id: 1, is_read: 1, read_at: null },
      { id: 2, is_read: 0, read_at: null },
    ]);
  });
});

describe("the search text function", () => {
  it("is there before the migrations run, and gives the fields as search matches them", () => {
    const db = openDatabase(":memory:");
    const row = db
      .prepare("SELECT sn_search_text('generated', 'ＡＩ', NULL, '要約', NULL, '[本文](https://example.org)', '', '影響', 'ホール') AS text")
      .get();
    expect(row?.text).toBe(
      searchText({
        origin: "generated",
        title: "ＡＩ",
        translatedTitle: null,
        summary: "要約",
        autoSummary: null,
        body: "[本文](https://example.org)",
        contentText: "",
        impact: "影響",
        venue: "ホール",
      }),
    );
    expect(row?.text).toBe("ai\n要約\n本文\n影響\nホール");
  });
});

describe("the migration to article search", () => {
  const SHIPPED = join(import.meta.dirname, "migrations");

  it("makes the articles stored before it searchable", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    for (const name of readdirSync(SHIPPED).filter((file) => file < "012")) copyFileSync(join(SHIPPED, name), join(dir, name));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (5, 'https://example.org/5', 'five', ?)").run(now);
    db.prepare(
      `INSERT INTO articles (id, origin, feed_id, item_key, kind, title, summary, body, content_text, first_published_at, updated_at, created_at)
       VALUES (1, 'feed', 5, 'k1', 'news', 'Title', 's', 'b', '新しい電池の話', ?, ?, ?)`,
    ).run(now, now, now);

    for (const name of readdirSync(SHIPPED).filter((file) => file >= "012")) copyFileSync(join(SHIPPED, name), join(dir, name));
    migrate(db, dir);

    expect(db.prepare("SELECT rowid FROM article_search WHERE article_search MATCH '\"新しい\"'").all()).toEqual([{ rowid: 1 }]);
    expect(db.prepare("SELECT text FROM article_search WHERE rowid = 1").get()).toEqual({ text: "title\ns\n新しい電池の話" });
  });
});

describe("the shipped search index", () => {
  it("has its three triggers and a row for every article", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'articles' AND name LIKE 'articles_search_%' ORDER BY name")
      .all()
      .map((row) => String(row.name));
    expect(triggers).toEqual(["articles_search_delete", "articles_search_insert", "articles_search_update"]);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (5, 'https://example.org/5', 'five', ?)").run(now);
    const insert = db.prepare(
      `INSERT INTO articles (origin, feed_id, item_key, kind, title, summary, body, first_published_at, updated_at, created_at)
       VALUES ('feed', 5, ?, 'news', 't', 's', 'b', ?, ?, ?)`,
    );
    for (const key of ["a", "b", "c"]) insert.run(key, now, now, now);
    const count = (table: string) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n);
    expect(count("article_search")).toBe(count("articles"));
    expect(count("articles")).toBe(3);
  });
});

describe("the migration to full content", () => {
  const SHIPPED = join(import.meta.dirname, "migrations");

  it("leaves the feeds that exist without full content fetching, and the articles without a state", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    for (const name of readdirSync(SHIPPED).filter((file) => file < "013")) copyFileSync(join(SHIPPED, name), join(dir, name));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (5, 'https://example.org/5', 'five', ?)").run(now);
    db.prepare(
      `INSERT INTO articles (id, origin, feed_id, item_key, kind, title, summary, body, first_published_at, updated_at, created_at)
       VALUES (1, 'feed', 5, 'k1', 'news', 't', 's', 'b', ?, ?, ?)`,
    ).run(now, now, now);

    for (const name of readdirSync(SHIPPED).filter((file) => file >= "013")) copyFileSync(join(SHIPPED, name), join(dir, name));
    migrate(db, dir);

    expect(db.prepare("SELECT fetch_full_content, fetch_full_content_since FROM feeds").all()).toEqual([
      { fetch_full_content: 0, fetch_full_content_since: null },
    ]);
    expect(
      db
        .prepare(
          `SELECT full_content, full_content_text, full_content_at, full_content_status, full_content_error, full_content_error_detail
             FROM articles`,
        )
        .all(),
    ).toEqual([
      {
        full_content: null,
        full_content_text: null,
        full_content_at: null,
        full_content_status: null,
        full_content_error: null,
        full_content_error_detail: null,
      },
    ]);
    // The search triggers survive: the table is not rebuilt.
    expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'articles_search_%'").get()).toEqual({ n: 3 });
  });
});

describe("the migration to term highlights", () => {
  const SHIPPED = join(import.meta.dirname, "migrations");

  it("adds the two tables and leaves the articles and settings as they were", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    for (const name of readdirSync(SHIPPED).filter((file) => file < "014")) copyFileSync(join(SHIPPED, name), join(dir, name));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (5, 'https://example.org/5', 'five', ?)").run(now);
    db.prepare(
      `INSERT INTO articles (id, origin, feed_id, item_key, kind, title, summary, body, first_published_at, updated_at, created_at, is_read, starred)
       VALUES (1, 'feed', 5, 'k1', 'news', '規制の話', 's', 'b', ?, ?, ?, 1, 1)`,
    ).run(now, now, now);
    const articles = () => db.prepare("SELECT * FROM articles ORDER BY id").all();
    const settings = () => db.prepare("SELECT * FROM settings").all();
    const before = { articles: articles(), settings: settings() };

    for (const name of readdirSync(SHIPPED).filter((file) => file >= "014" && file < "016")) copyFileSync(join(SHIPPED, name), join(dir, name));
    migrate(db, dir);

    expect({ articles: articles(), settings: settings() }).toEqual(before);
    expect(tableNames(db)).toEqual(expect.arrayContaining(["term_groups", "highlight_terms"]));
    db.prepare("INSERT INTO term_groups (id, name, color, position, created_at) VALUES (1, 'A', 'green', 1, ?)").run(now);
    db.prepare("INSERT INTO highlight_terms (group_id, text, normalized, created_at) VALUES (1, '規制', '規制', ?)").run(now);
    expect(() => db.prepare("INSERT INTO highlight_terms (group_id, text, normalized, created_at) VALUES (1, '規制', '規制', ?)").run(now)).toThrow();
    expect(() => db.prepare("INSERT INTO term_groups (name, color, position, created_at) VALUES ('B', 'yellow', 2, ?)").run(now)).toThrow();
    db.prepare("DELETE FROM term_groups WHERE id = 1").run();
    expect(db.prepare("SELECT count(*) AS n FROM highlight_terms").get()).toEqual({ n: 0 });
  });
});

describe("the migration to list views", () => {
  const SHIPPED = join(import.meta.dirname, "migrations");

  it("adds the table and leaves the rows that exist as they were", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    for (const name of readdirSync(SHIPPED).filter((file) => file < "015")) copyFileSync(join(SHIPPED, name), join(dir, name));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO categories (id, slug, name, kind, schedule, min_importance, max_articles_per_run, created_at) VALUES (3, 'tools', 'Tools', 'news', '[]', 3, 10, ?)").run(now);
    db.prepare("INSERT INTO feeds (id, url, title, category_id, created_at) VALUES (5, 'https://example.org/5', 'five', 3, ?)").run(now);
    db.prepare(
      `INSERT INTO articles (id, origin, feed_id, category_id, item_key, kind, title, summary, body, first_published_at, updated_at, created_at, is_read, starred)
       VALUES (1, 'feed', 5, 3, 'k1', 'news', 't', 's', 'b', ?, ?, ?, 1, 1)`,
    ).run(now, now, now);
    const rows = () => ({
      articles: db.prepare("SELECT * FROM articles ORDER BY id").all(),
      categories: db.prepare("SELECT * FROM categories ORDER BY id").all(),
      feeds: db.prepare("SELECT * FROM feeds ORDER BY id").all(),
      settings: db.prepare("SELECT * FROM settings").all(),
    });
    const before = rows();

    copyFileSync(join(SHIPPED, "015_list_views.sql"), join(dir, "015_list_views.sql"));
    migrate(db, dir);

    expect(rows()).toEqual(before);
    expect(db.prepare("SELECT count(*) AS n FROM list_views").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'articles_search_%'").get()).toEqual({ n: 3 });
  });

  it("holds one row per entry, and only the pairs of entry kind and target that make sense", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO categories (id, slug, name, kind, schedule, min_importance, max_articles_per_run, created_at) VALUES (3, 'tools', 'Tools', 'news', '[]', 3, 10, ?)").run(now);
    db.prepare("INSERT INTO feeds (id, url, title, category_id, created_at) VALUES (5, 'https://example.org/5', 'five', 3, ?)").run(now);
    const insert = (list: string, categoryId: number | null, feedId: number | null, sort = "oldest") =>
      db.prepare("INSERT INTO list_views (list, category_id, feed_id, sort) VALUES (?, ?, ?, ?)").run(list, categoryId, feedId, sort);

    insert("unread", null, null);
    insert("category", 3, null);
    insert("category_generated", 3, null);
    insert("feed", null, 5);
    expect(db.prepare("SELECT sort FROM list_views WHERE list = 'unread'").get()).toEqual({ sort: "oldest" });

    expect(() => insert("unread", null, null)).toThrow();
    expect(() => insert("category", 3, null)).toThrow();
    expect(() => insert("feed", null, 5)).toThrow();
    expect(() => insert("unread", 3, null)).toThrow();
    expect(() => insert("category", null, null)).toThrow();
    expect(() => insert("category", 3, 5)).toThrow();
    expect(() => insert("feed", 3, null)).toThrow();
    expect(() => insert("recently_read", null, null)).toThrow();
    expect(() => insert("all", null, null, "random")).toThrow();
  });
});

describe("the migration to feed stats", () => {
  const SHIPPED = join(import.meta.dirname, "migrations");

  it("gives each feed the time its newest article was stored, leaves open times empty, and adds the days", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    for (const name of readdirSync(SHIPPED).filter((file) => file < "016")) copyFileSync(join(SHIPPED, name), join(dir, name));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    const created = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO settings (id, reader_info, output_language, time_zone, search_language, search_region) VALUES (1, '', 'ja', 'UTC', 'ja', 'JP')").run();
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (5, 'https://example.org/5', 'five', ?)").run(created);
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (6, 'https://example.org/6', 'six', ?)").run(created);
    const insert = db.prepare(
      `INSERT INTO articles (id, origin, feed_id, item_key, kind, title, summary, body, first_published_at, updated_at, created_at, is_read, read_at)
       VALUES (?, 'feed', 5, ?, 'news', 't', 's', 'b', ?, ?, ?, ?, ?)`,
    );
    insert.run(1, "k1", created, created, "2026-02-01T00:00:00.000Z", 1, "2026-02-02T00:00:00.000Z");
    insert.run(2, "k2", created, created, "2026-03-01T00:00:00.000Z", 0, null);

    copyFileSync(join(SHIPPED, "016_feed_stats.sql"), join(dir, "016_feed_stats.sql"));
    migrate(db, dir);

    expect(db.prepare("SELECT id, last_new_item_at FROM feeds ORDER BY id").all()).toEqual([
      { id: 5, last_new_item_at: "2026-03-01T00:00:00.000Z" },
      { id: 6, last_new_item_at: null },
    ]);
    expect(db.prepare("SELECT id, is_read, opened_at FROM articles ORDER BY id").all()).toEqual([
      { id: 1, is_read: 1, opened_at: null },
      { id: 2, is_read: 0, opened_at: null },
    ]);
    expect(db.prepare("SELECT stale_feed_days FROM settings").get()).toEqual({ stale_feed_days: 60 });
    expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'articles_feed_created'").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'articles_search_%'").get()).toEqual({ n: 3 });
  });
});

describe("the annotation text function", () => {
  it("gives the quote and the note, one to a line and normalized, the note's Markdown left as written", () => {
    const db = openDatabase(":memory:");
    const text = (quote: string | null, note: string | null) => db.prepare("SELECT sn_annotation_text(?, ?) AS text").get(quote, note)?.text;
    expect(text("ＡＩの電池", "**比較** する [link](https://example.org)")).toBe("aiの電池\n**比較** する [link](https://example.org)");
    expect(text("電池", null)).toBe("電池");
    expect(text(null, "あとで比べる")).toBe("あとで比べる");
  });
});

describe("the migration to annotations", () => {
  const SHIPPED = join(import.meta.dirname, "migrations");

  function before017() {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    for (const name of readdirSync(SHIPPED).filter((file) => file < "017")) copyFileSync(join(SHIPPED, name), join(dir, name));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    return { db, dir };
  }

  it("leaves the articles, the search results and the rows of the index as they were", () => {
    const { db, dir } = before017();
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (5, 'https://example.org/5', 'five', ?)").run(now);
    const insert = db.prepare(
      `INSERT INTO articles (id, origin, feed_id, item_key, kind, title, summary, body, content_text, first_published_at, updated_at, created_at, starred)
       VALUES (?, 'feed', 5, ?, 'news', ?, 's', 'b', ?, ?, ?, ?, ?)`,
    );
    insert.run(1, "k1", "電池の話", "新しい電池の工場", now, now, now, 1);
    insert.run(2, "k2", "Title", "量子の話", now, now, now, 0);
    const rows = () => ({
      articles: db.prepare("SELECT * FROM articles ORDER BY id").all(),
      index: db.prepare("SELECT rowid, text FROM article_search ORDER BY rowid").all(),
      found: db.prepare("SELECT rowid FROM article_search WHERE article_search MATCH '\"電池の\"'").all(),
    });
    const earlier = rows();

    copyFileSync(join(SHIPPED, "017_annotations.sql"), join(dir, "017_annotations.sql"));
    migrate(db, dir);

    expect(rows()).toEqual(earlier);
    expect(earlier.index).toHaveLength(2);
    expect(tableNames(db)).toContain("annotations");
    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%_search_%' ORDER BY name")
      .all()
      .map((row) => String(row.name));
    expect(triggers).toEqual([
      "annotations_search_delete",
      "annotations_search_insert",
      "annotations_search_update",
      "articles_search_delete",
      "articles_search_insert",
      "articles_search_update",
    ]);
  });

  it("holds one note per article, and only the fields each kind has", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (5, 'https://example.org/5', 'five', ?)").run(now);
    db.prepare(
      `INSERT INTO articles (id, origin, feed_id, item_key, kind, title, summary, body, first_published_at, updated_at, created_at)
       VALUES (1, 'feed', 5, 'k1', 'news', 't', 's', 'b', ?, ?, ?)`,
    ).run(now, now, now);
    const insert = (kind: string, quote: string | null, prefix: string | null, suffix: string | null, position: number | null, note: string | null) =>
      db
        .prepare("INSERT INTO annotations (article_id, kind, quote, prefix, suffix, position, note, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(kind, quote, prefix, suffix, position, note, now, now);

    insert("highlight", "電池", "", "", 0, null);
    insert("highlight", "電池", "前", "後", 3, "メモ");
    insert("note", null, null, null, null, "あとで比べる");
    expect(() => insert("note", null, null, null, null, "二つ目")).toThrow();
    expect(() => insert("highlight", null, "", "", 0, null)).toThrow();
    expect(() => insert("highlight", "電池", "", "", -1, null)).toThrow();
    expect(() => insert("highlight", "電池", null, "", 0, null)).toThrow();
    expect(() => insert("note", null, null, null, null, null)).toThrow();
    expect(() => insert("note", "電池", null, null, null, "メモ")).toThrow();
    expect(() => insert("comment", null, null, null, null, "メモ")).toThrow();

    db.prepare("DELETE FROM articles WHERE id = 1").run();
    expect(db.prepare("SELECT count(*) AS n FROM annotations").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT count(*) AS n FROM article_search").get()).toEqual({ n: 0 });
  });

  it("does not change the migration that built the search index", () => {
    const sql = readFileSync(join(SHIPPED, "012_article_search.sql"), "utf8");
    expect(sql).not.toContain("annotation");
    expect(sql).toContain("sn_search_text(NEW.origin, NEW.title, NEW.translated_title, NEW.summary, NEW.auto_summary, NEW.body,");
  });
});

describe("the migration to model costs", () => {
  const SHIPPED = join(import.meta.dirname, "migrations");

  it("leaves the calls that exist without a cost and outside the budget, and the runs without a limit", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    for (const name of readdirSync(SHIPPED).filter((file) => file < "018")) copyFileSync(join(SHIPPED, name), join(dir, name));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    const at = "2026-10-01T00:00:00.000Z";
    db.prepare(
      `INSERT INTO categories (id, slug, name, kind, schedule, min_importance, max_articles_per_run, window_hours, created_at)
       VALUES (1, 'c', 'c', 'news', '["05:00"]', 3, 5, 24, ?)`,
    ).run(at);
    db.prepare("INSERT INTO runs (id, category_id, trigger, status, queued_at) VALUES (1, 1, 'manual', 'stopped_by_limit', ?)").run(at);
    db.prepare("INSERT INTO llm_calls (run_id, task, provider, duration_ms, ok, created_at) VALUES (1, 'judge', 'fast', 10, 1, ?)").run(at);

    copyFileSync(join(SHIPPED, "018_llm_costs.sql"), join(dir, "018_llm_costs.sql"));
    migrate(db, dir);

    expect(
      db
        .prepare("SELECT input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches, cost_usd, billable FROM llm_calls")
        .get(),
    ).toEqual({ input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null, web_searches: null, cost_usd: null, billable: 0 });
    expect(db.prepare("SELECT stopped_by FROM runs").get()).toEqual({ stopped_by: null });
    db.prepare("UPDATE runs SET stopped_by = 'budget'").run();
    expect(() => db.prepare("UPDATE runs SET stopped_by = 'week'").run()).toThrow();
  });
});

describe("the migration to mentions", () => {
  const SHIPPED = join(import.meta.dirname, "migrations");

  function before019() {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    for (const name of readdirSync(SHIPPED).filter((file) => file < "019")) copyFileSync(join(SHIPPED, name), join(dir, name));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    return { db, dir };
  }

  it("leaves the articles and the search results as they were, and gives no article a name", () => {
    const { db, dir } = before019();
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare(
      `INSERT INTO categories (id, slug, name, kind, schedule, min_importance, max_articles_per_run, window_hours, created_at)
       VALUES (1, 'economy', 'Economy', 'news', '["05:00"]', 3, 5, 24, ?)`,
    ).run(now);
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (5, 'https://example.org/5', 'five', ?)").run(now);
    db.prepare(
      `INSERT INTO articles (id, origin, category_id, kind, title, summary, body, importance, first_published_at, updated_at, created_at)
       VALUES (1, 'generated', 1, 'news', '日本銀行が利上げ', 's', '日本銀行の本文', 3, ?, ?, ?)`,
    ).run(now, now, now);
    db.prepare(
      `INSERT INTO articles (id, origin, feed_id, item_key, kind, title, summary, body, auto_summary, first_published_at, updated_at, created_at)
       VALUES (2, 'feed', 5, 'k2', 'news', 'Title', 's', 'b', '日本銀行の要約', ?, ?, ?)`,
    ).run(now, now, now);
    const rows = () => ({
      articles: db.prepare("SELECT * FROM articles ORDER BY id").all(),
      found: db.prepare("SELECT rowid FROM article_search WHERE article_search MATCH '\"日本銀\"' ORDER BY rowid").all(),
      calls: db.prepare("SELECT count(*) AS n FROM llm_calls").get(),
    });
    const earlier = rows();

    copyFileSync(join(SHIPPED, "019_mentions.sql"), join(dir, "019_mentions.sql"));
    migrate(db, dir);

    expect(rows()).toEqual(earlier);
    expect(earlier.found).toEqual([{ rowid: 1 }, { rowid: 2 }]);
    expect(earlier.calls).toEqual({ n: 0 });
    expect(db.prepare("SELECT count(*) AS n FROM article_mentions").get()).toEqual({ n: 0 });
  });

  it("holds names of four kinds, each once an article, and lets them go with their article", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (5, 'https://example.org/5', 'five', ?)").run(now);
    db.prepare(
      `INSERT INTO articles (id, origin, feed_id, item_key, kind, title, summary, body, first_published_at, updated_at, created_at)
       VALUES (1, 'feed', 5, 'k1', 'news', 't', 's', 'b', ?, ?, ?)`,
    ).run(now, now, now);
    const insert = (position: number, name: string, kind: string) =>
      db.prepare("INSERT INTO article_mentions (article_id, position, name, name_key, kind) VALUES (1, ?, ?, ?, ?)").run(position, name, name.toLowerCase(), kind);

    insert(0, "OpenAI", "organization");
    insert(1, "Sam Altman", "person");
    insert(2, "ChatGPT", "product");
    insert(3, "San Francisco", "place");
    expect(() => insert(4, "openai", "product")).toThrow();
    expect(() => insert(3, "Tokyo", "place")).toThrow();
    expect(() => insert(5, "Summit", "event")).toThrow();
    const plan = db.prepare("EXPLAIN QUERY PLAN SELECT article_id FROM article_mentions WHERE name_key = ?").all("openai");
    expect(JSON.stringify(plan)).toMatch(/USING (COVERING )?INDEX/);

    db.prepare("DELETE FROM articles WHERE id = 1").run();
    expect(db.prepare("SELECT count(*) AS n FROM article_mentions").get()).toEqual({ n: 0 });
  });
});

describe("the migration to web feeds", () => {
  const SHIPPED = join(import.meta.dirname, "migrations");

  function before020() {
    const dir = mkdtempSync(join(tmpdir(), "sn-mig-"));
    for (const name of readdirSync(SHIPPED).filter((file) => file < "020")) copyFileSync(join(SHIPPED, name), join(dir, name));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    return { db, dir };
  }

  it("makes every subscribed feed a feed without selectors and keeps its articles", () => {
    const { db, dir } = before020();
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO feeds (id, url, title, created_at) VALUES (5, 'https://example.org/5', 'five', ?)").run(now);
    db.prepare(
      `INSERT INTO articles (id, origin, feed_id, item_key, kind, title, summary, body, first_published_at, updated_at, created_at)
       VALUES (1, 'feed', 5, 'k1', 'news', 't', 's', 'b', ?, ?, ?)`,
    ).run(now, now, now);
    const articles = db.prepare("SELECT * FROM articles").all();

    const file = readdirSync(SHIPPED).find((name) => name.startsWith("020"))!;
    copyFileSync(join(SHIPPED, file), join(dir, file));
    migrate(db, dir);

    expect(db.prepare("SELECT format, page_selectors FROM feeds").all()).toEqual([{ format: "feed", page_selectors: null }]);
    expect(db.prepare("SELECT * FROM articles").all()).toEqual(articles);
    expect(() => db.prepare("UPDATE feeds SET format = 'html' WHERE id = 5").run()).toThrow();
  });
});
