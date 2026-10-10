import type { SourceKind } from "../api.ts";

/** One page found by a source, before any judgement. */
export interface RawCandidate {
  /** Normalised URL of the page. */
  url: string;
  /** Other URLs that identify the same result, such as a search engine's redirect link. */
  aliases: string[];
  /** False when `url` is a redirect link that could not be resolved: the page itself must not be fetched. */
  fetchable: boolean;
  title: string;
  snippet: string;
  siteName: string;
  publishedAt: Date | null;
  sourceKind: SourceKind;
}

/** What a run accepts. `since` is null when publication time does not matter (event categories). */
export interface CollectWindow {
  since: Date | null;
  hours: number | null;
}
