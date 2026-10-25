// Translation of feed articles: which way translates, the count of what goes to the translation API, the
// titles of articles as they are stored, and the content of an article when it is opened.
import type { ArticleTranslation, TranslationMethod, TranslationStatus } from "../api.ts";
import type { Clock } from "../clock.ts";
import { getArticle } from "../db/articles.ts";
import { transaction, type Database } from "../db/database.ts";
import { num, str } from "../db/rows.ts";
import { getSettings } from "../db/settings.ts";
import { reserveTranslationChars, saveArticleTranslation, saveTranslatedTitle, translationCharsOf, translationMonth, type StoredSegment } from "../db/translations.ts";
import { DomainError } from "../errors.ts";
import { LlmLimitError } from "../llm/runner.ts";
import type { TranslationItem, Translator } from "./adapter.ts";
import { googleChars } from "./google.ts";
import { splitSegments } from "./segments.ts";

export interface TranslationServiceOptions {
  db: Database;
  clock: Clock;
  /** The translation API, or null when no key is set. */
  google: Translator | null;
  /** The model. It translates only what a reader opened. */
  llm: Translator;
  /** No more characters than this go to the translation API in one month. */
  monthlyChars: number;
  /** Of one article's content, this much is translated, counted from its start. */
  maxCharsPerArticle: number;
  /** Where a failure is recorded. The messages hold no key. */
  log?: (message: string) => void;
}

export interface Translated {
  texts: string[];
  sourceLanguage: string | null;
  method: TranslationMethod;
}

function unavailable(): DomainError {
  return new DomainError("unavailable", "the article cannot be translated now");
}

export class TranslationService {
  readonly #options: TranslationServiceOptions;
  readonly #log: (message: string) => void;
  /** Translations under way, by article: a second request for the same article waits for the first. */
  readonly #underWay = new Map<number, Promise<ArticleTranslation>>();

  constructor(options: TranslationServiceOptions) {
    this.#options = options;
    this.#log = options.log ?? ((message) => console.error(message));
  }

  #month(): string {
    const { db, clock } = this.#options;
    return translationMonth(clock(), getSettings(db).timeZone);
  }

  /** What the translation API was sent this month. Holds no key. */
  status(): TranslationStatus {
    const month = this.#month();
    return {
      month,
      chars: translationCharsOf(this.#options.db, month),
      monthlyChars: this.#options.monthlyChars,
      apiKeyConfigured: this.#options.google !== null,
    };
  }

  /**
   * Translates into the output language. The translation API is used while a key is set and the month has
   * room; otherwise, and when the API fails, the model is — unless the caller does not allow it, as the
   * fetching of feeds does not. Null means that nothing could translate now.
   */
  async translate(items: TranslationItem[], options: { allowLlm: boolean }): Promise<Translated | null> {
    const { db, google, llm, monthlyChars } = this.#options;
    const target = getSettings(db).outputLanguage;
    // Counted before the request leaves: what the API was sent is the one thing this server knows for sure.
    if (google && reserveTranslationChars(db, this.#month(), googleChars(items), monthlyChars)) {
      try {
        const output = await google.translate(items, target);
        if (output.texts.length !== items.length) throw new Error(`${output.texts.length} translations for ${items.length} texts`);
        return { ...output, method: "google" };
      } catch (error) {
        this.#log(`translation: the translation API failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!options.allowLlm) return null;
    try {
      const output = await llm.translate(items, target);
      if (output.texts.length !== items.length) throw new Error(`${output.texts.length} translations for ${items.length} texts`);
      return { ...output, method: "llm" };
    } catch (error) {
      if (!(error instanceof LlmLimitError)) this.#log(`translation: the model failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Translates the titles of the given articles that have none yet and belong to a feed that translates.
   * Only the translation API is used: this is called while feeds are fetched, where no model is. Nothing is
   * thrown; an article whose title could not be translated stays as it is.
   */
  async translateTitles(ids: number[]): Promise<void> {
    const { db } = this.#options;
    try {
      const find = db.prepare(
        `SELECT a.id, a.title FROM articles a JOIN feeds f ON f.id = a.feed_id
          WHERE a.id = ? AND a.translated_title IS NULL AND f.translate = 1`,
      );
      const waiting = ids.flatMap((id) => find.all(id)).map((row) => ({ id: num(row.id), title: str(row.title) }));
      if (waiting.length === 0) return;
      const output = await this.translate(waiting.map((article) => ({ text: article.title, plain: true })), { allowLlm: false });
      if (output === null) return;
      waiting.forEach((article, index) =>
        saveTranslatedTitle(db, article.id, { original: article.title, title: output.texts[index]!, sourceLanguage: output.sourceLanguage }),
      );
    } catch (error) {
      this.#log(`translation: titles were not translated: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * The translation of a feed article's content, made and stored when there is none. The content is the full
   * content when the article has one, and what the feed delivered otherwise. The title is translated
   * with it when it has no translation yet. Refuses an article that is not of a feed that translates.
   */
  translateArticle(id: number): Promise<ArticleTranslation> {
    const running = this.#underWay.get(id);
    if (running) return running;
    const promise = this.#translateArticle(id).finally(() => this.#underWay.delete(id));
    this.#underWay.set(id, promise);
    return promise;
  }

  async #translateArticle(id: number): Promise<ArticleTranslation> {
    const { db, clock, maxCharsPerArticle } = this.#options;
    const article = getArticle(db, id);
    if (!article.translatable) {
      throw new DomainError("invalid", `article ${id} is not an article of a feed that translates`, [{ path: "id", message: "not an article to translate" }]);
    }
    if (article.translation !== null && article.translatedTitle !== null) return article.translation;

    const needsTitle = article.translatedTitle === null;
    // The full content when there is one; what the feed delivered otherwise.
    const source = article.fullContent?.body ?? article.body;
    const split = article.translation === null ? splitSegments(source, maxCharsPerArticle) : null;
    const items: TranslationItem[] = [
      ...(needsTitle ? [{ text: article.title, plain: true }] : []),
      ...(split?.segments.filter((segment) => segment.translate).map((segment) => ({ text: segment.original })) ?? []),
    ];
    const output = items.length > 0 ? await this.translate(items, { allowLlm: true }) : { texts: [], sourceLanguage: null, method: "llm" as const };
    if (output === null) throw unavailable();

    const texts = [...output.texts];
    const title = needsTitle ? texts.shift()! : null;
    return transaction(db, () => {
      // The feed may have rewritten the item, or the full content may have arrived, while the translation was
      // under way: what was translated must still be what the article shows.
      const now = db.prepare("SELECT title, CASE WHEN full_content_status = 'fetched' THEN full_content ELSE body END AS source FROM articles WHERE id = ?").get(id);
      if (!now || str(now.title) !== article.title || str(now.source) !== source) throw unavailable();
      if (title !== null) saveTranslatedTitle(db, id, { original: article.title, title, sourceLanguage: output.sourceLanguage });
      if (split !== null) {
        const segments: StoredSegment[] = split.segments.map((segment) => ({ original: segment.original, translated: segment.translate ? texts.shift()! : null }));
        saveArticleTranslation(db, id, { segments, method: output.method, truncated: split.truncated, now: clock().toISOString() });
      }
      return getArticle(db, id).translation!;
    });
  }
}
