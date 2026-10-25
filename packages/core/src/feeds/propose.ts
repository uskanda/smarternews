// Candidates for the selectors of a web feed, and the preview of one set of selectors. A candidate is asked of the
// model only here, and only when a reader asks for candidates: never while a web feed is fetched. When the model
// cannot be used, the candidates come from rules (`infer.ts`), and the answer says so; it is never an error.
import { parseHTML } from "linkedom";
import {
  pageSelectorsSchema,
  SELECTOR_PREVIEW_ITEMS,
  type PageCandidates,
  type PageSelectors,
  type SelectorFallback,
  type SelectorPreview,
} from "../api.ts";
import type { Database } from "../db/database.ts";
import { getSettings } from "../db/settings.ts";
import { DomainError } from "../errors.ts";
import type { PageFetcher } from "../fetch/pages.ts";
import { normalizeUrl } from "../fetch/url.ts";
import { LlmLimitError, TaskFailedError, type TaskRunner } from "../llm/runner.ts";
import type { ProposeSelectorsOutput } from "../llm/tasks.ts";
import { inferSelectors } from "./infer.ts";
import { extractPage, pageFailureReason } from "./page.ts";

/** The model reads this many characters of a page, counted after scripts, styles and embeds are taken out. */
export const MODEL_HTML_CHARS = 50_000;

/** Elements that say nothing about where the articles are: scripts, styles and embeds. */
const DROPPED = "script, noscript, template, style, link[rel~=stylesheet], iframe, embed, object";

interface CleanNode {
  readonly nodeType: number;
  readonly childNodes: ArrayLike<CleanNode>;
  readonly attributes?: ArrayLike<{ name: string }>;
  remove(): void;
  removeAttribute?(name: string): void;
}

/** Takes comments, `style` attributes and `on…` attributes out of a node and everything under it. */
function strip(node: CleanNode): void {
  for (const child of Array.from(node.childNodes)) {
    // A comment.
    if (child.nodeType === 8) {
      child.remove();
      continue;
    }
    if (child.nodeType !== 1) continue;
    for (const name of Array.from(child.attributes ?? []).map((attribute) => attribute.name)) {
      if (name === "style" || name.toLowerCase().startsWith("on")) child.removeAttribute?.(name);
    }
    strip(child);
  }
}

/**
 * The HTML of a page as the model reads it: without scripts, styles, embeds, comments, style attributes and
 * event handlers, cut to its first `max` characters. Classes and ids stay: they are what selectors are made of.
 */
export function pageForModel(html: string, max = MODEL_HTML_CHARS): string {
  const { document } = parseHTML(html) as unknown as {
    document: CleanNode & { querySelectorAll(selector: string): Iterable<CleanNode>; documentElement: { outerHTML: string } | null; toString(): string };
  };
  for (const element of [...document.querySelectorAll(DROPPED)]) element.remove();
  strip(document);
  const text = document.documentElement?.outerHTML ?? document.toString();
  return text.slice(0, max);
}

export interface ProposeDeps {
  db: Database;
  /** Fetches the page by the rules of full content fetching, robots.txt included. */
  pages: PageFetcher;
}

/** The page at `url`, or a refusal that says why it could not be had. */
async function fetchPageOrRefuse(pages: PageFetcher, url: string): Promise<{ html: string; url: string }> {
  const target = normalizeUrl(url);
  const page = await pages.fetchPage(target);
  if (!page.ok) {
    const message = `the page could not be fetched: ${pageFailureReason(page, target)}`;
    throw new DomainError("invalid", message, [{ path: "url", message }]);
  }
  return page;
}

function previewOf(html: string, pageUrl: string, selectors: PageSelectors, timeZone: string): SelectorPreview {
  const { items } = extractPage(html, pageUrl, selectors, timeZone);
  return {
    count: items.length,
    items: items.slice(0, SELECTOR_PREVIEW_ITEMS).map((item) => ({ title: item.title, url: item.url, publishedAt: item.publishedAt?.toISOString() ?? null })),
  };
}

/** What a set of selectors takes out of the page at `url`. No model is called and nothing is stored. */
export async function previewSelectors(deps: ProposeDeps, url: string, selectors: PageSelectors): Promise<SelectorPreview> {
  const page = await fetchPageOrRefuse(deps.pages, url);
  return previewOf(page.html, page.url, selectors, getSettings(deps.db).timeZone);
}

/** The model's candidates as selectors the API takes, without empty fields and without what it cannot read. */
function proposed(output: ProposeSelectorsOutput): PageSelectors[] {
  return output.candidates.flatMap((candidate) => {
    const parsed = pageSelectorsSchema.safeParse(Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== null && value !== undefined)));
    return parsed.success ? [parsed.data] : [];
  });
}

type Candidate = PageCandidates["candidates"][number];

/** The candidates that take at least one article out of the page, each once, with their previews. */
function usable(list: PageSelectors[], html: string, pageUrl: string, timeZone: string): Candidate[] {
  const seen = new Set<string>();
  const result: Candidate[] = [];
  for (const selectors of list) {
    const key = JSON.stringify(selectors);
    if (seen.has(key)) continue;
    seen.add(key);
    let preview: SelectorPreview;
    try {
      preview = previewOf(html, pageUrl, selectors, timeZone);
    } catch {
      // A selector the engine cannot use takes nothing out.
      continue;
    }
    if (preview.count > 0) result.push({ selectors, preview });
  }
  return result;
}

/**
 * Candidates for the selectors of the page at `url`, each with its preview. The model is asked once, when the
 * day has room for it; its candidates are tried on the page as it was fetched, which is what later fetches read.
 * On a day without room, when the task fails or runs out of time, and when none of its candidates takes an
 * article out, the candidates are found by rule. The list may be empty. Nothing is stored.
 */
export async function proposeSelectors(deps: ProposeDeps & { runner: TaskRunner }, url: string): Promise<PageCandidates> {
  const page = await fetchPageOrRefuse(deps.pages, url);
  const timeZone = getSettings(deps.db).timeZone;
  let fallback: SelectorFallback = "limit";
  if (deps.runner.canProposeSelectors()) {
    try {
      // A budget of its own: a proposal belongs to no run.
      const output = await deps.runner.run("proposeSelectors", { url: page.url, html: pageForModel(page.html) }, { runId: null, calls: 0 });
      const candidates = usable(proposed(output), page.html, page.url, timeZone);
      if (candidates.length > 0) return { candidates, usedModel: true, fallback: null };
      fallback = "empty";
    } catch (error) {
      if (error instanceof LlmLimitError) fallback = "limit";
      else if (error instanceof TaskFailedError) fallback = "failed";
      else throw error;
    }
  }
  return { candidates: usable(inferSelectors(page.html), page.html, page.url, timeZone), usedModel: false, fallback };
}
