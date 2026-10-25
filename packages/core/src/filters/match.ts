// Matching the conditions of filters against feed articles. Pure functions without Node imports: the web app
// may load them too. No model is involved: a filter is a plain comparison of text.
import type { FilterCondition, FilterField } from "../api.ts";
import type { FieldError } from "../errors.ts";
import { normalizeForMatch } from "../search/text.ts";

// The same normalization as article search, so that a filter and a search treat a text alike.
export { normalizeForMatch };

/** The value a condition stores to compare with: NFKC, and lower case for a part of the text. */
export function normalizedValue(condition: Pick<FilterCondition, "match" | "value">): string {
  return condition.match === "regex" ? condition.value.normalize("NFKC") : normalizeForMatch(condition.value);
}

/** What of a feed article the conditions look at: the original title and content, never a translation. */
export interface MatchableArticle {
  title: string;
  /** The content without markup and link targets. */
  contentText: string;
  author: string | null;
  /** The article's page. */
  url: string | null;
}

export interface CompiledCondition {
  fields: FilterField[];
  /** Whether the text of one field matches. */
  test(text: Texts, field: FilterField): boolean;
}

/** The fields of one article in the forms the two methods compare, each computed once when first asked. */
export class Texts {
  private readonly nfkc = new Map<FilterField, string | null>();
  private readonly lower = new Map<FilterField, string | null>();

  private readonly article: MatchableArticle;

  constructor(article: MatchableArticle) {
    this.article = article;
  }

  private raw(field: FilterField): string | null {
    switch (field) {
      case "title":
        return this.article.title;
      case "content":
        return this.article.contentText;
      case "author":
        return this.article.author;
      case "url":
        return this.article.url;
    }
  }

  normalized(field: FilterField): string | null {
    if (!this.nfkc.has(field)) this.nfkc.set(field, this.raw(field)?.normalize("NFKC") ?? null);
    return this.nfkc.get(field)!;
  }

  lowered(field: FilterField): string | null {
    if (!this.lower.has(field)) this.lower.set(field, this.normalized(field)?.toLowerCase() ?? null);
    return this.lower.get(field)!;
  }
}

/**
 * Prepares conditions for matching. A regular expression is not lowered: that would change what `\D`, `\S`
 * or `\W` mean. The `i` flag makes case not matter instead. Throws on a value that is not a regular
 * expression; check with `conditionProblems` first.
 */
export function compileConditions(conditions: Array<Pick<FilterCondition, "fields" | "match" | "value">>): CompiledCondition[] {
  return conditions.map((condition) => {
    if (condition.match === "regex") {
      const pattern = new RegExp(normalizedValue(condition), "iu");
      return {
        fields: condition.fields,
        test: (texts, field) => {
          const text = texts.normalized(field);
          return text !== null && pattern.test(text);
        },
      };
    }
    const value = normalizedValue(condition);
    return {
      fields: condition.fields,
      test: (texts, field) => texts.lowered(field)?.includes(value) ?? false,
    };
  });
}

/** Whether the article meets every condition: for each, one of its fields matches. A field the article lacks never does. */
export function matchesAll(conditions: CompiledCondition[], article: MatchableArticle | Texts): boolean {
  const texts = article instanceof Texts ? article : new Texts(article);
  return conditions.every((condition) => condition.fields.some((field) => condition.test(texts, field)));
}

/** Why the value is not a regular expression the server can use, or null when it is one. */
export function regexProblem(value: string): string | null {
  try {
    new RegExp(value.normalize("NFKC"), "iu");
    return null;
  } catch (error) {
    return `is not a valid regular expression: ${(error as Error).message}`;
  }
}

/** The conditions whose regular expression cannot be used, each named by its position. */
export function conditionProblems(conditions: Array<Pick<FilterCondition, "match" | "value">>, prefix = "conditions"): FieldError[] {
  const problems: FieldError[] = [];
  conditions.forEach((condition, index) => {
    if (condition.match !== "regex") return;
    const problem = regexProblem(condition.value);
    if (problem !== null) problems.push({ path: `${prefix}.${index}.value`, message: problem });
  });
  return problems;
}
