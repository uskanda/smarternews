import type { StopWord, StopWordCreate, StopWordDeleteResult, StopWordScope, StopWordUpdate } from "../api.ts";
import type { Clock } from "../clock.ts";
import { DomainError, notFound } from "../errors.ts";
import { transaction, type Database } from "./database.ts";
import { num, str, type Row } from "./rows.ts";

// A stop word hides the feed articles whose title, or title and content, contain it. The verdict is kept on
// the article (`stop_word_id`): lists and counts leave out a row that has one and no star. Generated articles
// are never judged.

/** The form in which words and texts are compared: full-width and half-width alike, upper and lower case alike. */
export function normalizeForMatch(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

interface Matcher {
  id: number;
  normalized: string;
  scope: StopWordScope;
}

function matchers(db: Database): Matcher[] {
  return db
    .prepare("SELECT id, normalized, scope FROM stop_words ORDER BY id")
    .all()
    .map((row) => ({ id: num(row.id), normalized: str(row.normalized), scope: str(row.scope) as StopWordScope }));
}

function firstMatch(words: Matcher[], title: string, content: string): number | null {
  if (words.length === 0) return null;
  const inTitle = normalizeForMatch(title);
  let inContent: string | null = null;
  for (const word of words) {
    if (inTitle.includes(word.normalized)) return word.id;
    if (word.scope === "title_and_content") {
      inContent ??= normalizeForMatch(content);
      if (inContent.includes(word.normalized)) return word.id;
    }
  }
  return null;
}

/** The oldest stop word the given title and content contain, or null. */
export function findStopWordFor(db: Database, title: string, content: string): number | null {
  return firstMatch(matchers(db), title, content);
}

/** Judges the given feed articles again against every word. Returns how many are matched now. */
function judge(db: Database, where: string, params: Array<string | number>): number {
  const words = matchers(db);
  const update = db.prepare("UPDATE articles SET stop_word_id = ? WHERE id = ?");
  let matched = 0;
  for (const row of db.prepare(`SELECT id, title, content_text, stop_word_id FROM articles WHERE origin = 'feed' AND ${where}`).all(...params)) {
    const verdict = firstMatch(words, str(row.title), str(row.content_text));
    if (verdict !== null) matched += 1;
    if (verdict !== (row.stop_word_id === null ? null : num(row.stop_word_id))) update.run(verdict, num(row.id));
  }
  return matched;
}

/** Judges one feed article, after it was stored or its content changed. */
export function applyStopWords(db: Database, articleId: number): void {
  judge(db, "id = ?", [articleId]);
}

function toStopWord(row: Row): StopWord {
  return {
    id: num(row.id),
    text: str(row.text),
    scope: str(row.scope) as StopWordScope,
    hiddenCount: num(row.hidden_count),
    createdAt: str(row.created_at),
  };
}

const WORD_COLUMNS = `w.id, w.text, w.scope, w.created_at,
  (SELECT count(*) FROM articles a WHERE a.stop_word_id = w.id AND a.starred = 0) AS hidden_count`;

export function listStopWords(db: Database): StopWord[] {
  return db.prepare(`SELECT ${WORD_COLUMNS} FROM stop_words w ORDER BY w.id`).all().map(toStopWord);
}

export function getStopWord(db: Database, id: number): StopWord {
  const row = db.prepare(`SELECT ${WORD_COLUMNS} FROM stop_words w WHERE w.id = ?`).get(id);
  if (!row) throw notFound("stop word", id);
  return toStopWord(row);
}

/** Adds a word, and hides the stored feed articles that contain it and are not hidden yet. */
export function createStopWord(db: Database, input: StopWordCreate, clock: Clock): StopWord {
  const normalized = normalizeForMatch(input.text);
  if (db.prepare("SELECT 1 FROM stop_words WHERE normalized = ?").get(normalized)) {
    throw new DomainError("conflict", `the stop word "${input.text}" is already registered`, [{ path: "text", message: "already registered" }]);
  }
  return transaction(db, () => {
    const result = db
      .prepare("INSERT INTO stop_words (text, normalized, scope, created_at) VALUES (?, ?, ?, ?)")
      .run(input.text, normalized, input.scope ?? "title", clock().toISOString());
    // An article another word already hides stays with that word: the older word counts it.
    judge(db, "stop_word_id IS NULL", []);
    return getStopWord(db, num(result.lastInsertRowid));
  });
}

export function updateStopWord(db: Database, id: number, patch: StopWordUpdate): StopWord {
  getStopWord(db, id);
  return transaction(db, () => {
    db.prepare("UPDATE stop_words SET scope = ? WHERE id = ?").run(patch.scope, id);
    judge(db, "(stop_word_id IS NULL OR stop_word_id = ?)", [id]);
    return getStopWord(db, id);
  });
}

/** Removes a word. What it hid comes back unless another word matches it too. Returns how many came back. */
export function deleteStopWord(db: Database, id: number): StopWordDeleteResult {
  getStopWord(db, id);
  return transaction(db, () => {
    const held = JSON.stringify(
      db
        .prepare("SELECT id FROM articles WHERE stop_word_id = ?")
        .all(id)
        .map((row) => num(row.id)),
    );
    // Deleting the word clears it from its articles (ON DELETE SET NULL); they are then judged by the rest.
    db.prepare("DELETE FROM stop_words WHERE id = ?").run(id);
    judge(db, "id IN (SELECT value FROM json_each(?))", [held]);
    const restored = num(
      db
        .prepare("SELECT count(*) AS n FROM articles WHERE id IN (SELECT value FROM json_each(?)) AND stop_word_id IS NULL AND starred = 0")
        .get(held)!.n,
    );
    return { restored };
  });
}
