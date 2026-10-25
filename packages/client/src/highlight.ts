// Colouring the terms of term groups in the texts of lists and articles. The terms are matched as stop words
// were and as filters match: case and width do not matter, symbols are symbols. Pure functions without a UI
// library: the web app and the Android app draw the parts they return in their own way. No model is involved.
import { matchRanges, normalizeForMatch, normalizeWithMap, type TermGroup } from "@smarternews/core/api";

/** A part of a text, coloured by one group or by none. */
export interface TermPart {
  text: string;
  group: TermGroup | null;
}

/** A part of a text, coloured by one group or none, and marked as a match of the search or not. */
export interface HighlightPart extends TermPart {
  search: boolean;
}

/** How many texts a matcher keeps the parts of: the rows of a long list and the blocks of an article. */
const KEPT_TEXTS = 2000;

const NONE = -1;

export interface TermMatcher {
  /** The groups, in their order. */
  readonly groups: readonly TermGroup[];
  /** Whether there is any term to colour. */
  readonly empty: boolean;
  /** The text cut into parts that each have one group or none. The same text twice gives the same parts. */
  split(text: string): readonly TermPart[];
  /**
   * For each UTF-16 unit of the text, the position of the group that colours it, or -1. Where groups overlap,
   * the upper one wins.
   */
  owners(text: string): Int32Array;
  /** The groups whose terms occur in any of the texts, in the order of the groups, each once. */
  groupsIn(texts: ReadonlyArray<string | null | undefined>): TermGroup[];
}

/**
 * Prepares the groups, in their order, for colouring texts. The terms are normalized once here, and the parts
 * of each text are kept, so that drawing a list again does not match it again.
 */
export function createTermMatcher(groups: readonly TermGroup[]): TermMatcher {
  const prepared = groups.map((group) => [...new Set(group.terms.map((term) => normalizeForMatch(term.text)).filter((term) => term.length > 0))]);
  const empty = prepared.every((terms) => terms.length === 0);
  const kept = new Map<string, readonly TermPart[]>();

  function owners(text: string): Int32Array {
    const owner = new Int32Array(text.length).fill(NONE);
    if (empty || text.length === 0) return owner;
    const { normalized, starts, ends } = normalizeWithMap(text);
    // From the lowest group up, so that an upper group writes over where they overlap.
    for (let index = prepared.length - 1; index >= 0; index -= 1) {
      for (const term of prepared[index]!) {
        let from = normalized.indexOf(term);
        while (from !== -1) {
          owner.fill(index, starts[from]!, ends[from + term.length - 1]!);
          from = normalized.indexOf(term, from + 1);
        }
      }
    }
    return owner;
  }

  function split(text: string): readonly TermPart[] {
    const known = kept.get(text);
    if (known) return known;
    const owner = owners(text);
    const parts: TermPart[] = [];
    let start = 0;
    for (let at = 1; at <= text.length; at += 1) {
      if (at < text.length && owner[at] === owner[start]) continue;
      const index = owner[start]!;
      parts.push({ text: text.slice(start, at), group: index === NONE ? null : groups[index]! });
      start = at;
    }
    if (kept.size >= KEPT_TEXTS) kept.delete(kept.keys().next().value!);
    kept.set(text, parts);
    return parts;
  }

  function groupsIn(texts: ReadonlyArray<string | null | undefined>): TermGroup[] {
    if (empty) return [];
    const found = new Set<number>();
    for (const text of texts) {
      if (!text) continue;
      const normalized = normalizeWithMap(text).normalized;
      prepared.forEach((terms, index) => {
        if (!found.has(index) && terms.some((term) => normalized.includes(term))) found.add(index);
      });
    }
    return groups.filter((_, index) => found.has(index));
  }

  return { groups, empty, split, owners, groupsIn };
}

/**
 * The text cut into parts by the groups of `matcher` and by the terms of a search, which are marked apart: a
 * part may have a group, be a match of the search, both, or neither. The search terms are those the server
 * matched with.
 */
export function splitHighlights(text: string, matcher: TermMatcher | null, search: readonly string[] | undefined): HighlightPart[] {
  if (text.length === 0) return [];
  const searched = search && search.length > 0 ? matchRanges(text, search) : [];
  if (searched.length === 0) return (matcher ? matcher.split(text) : [{ text, group: null }]).map((part) => ({ ...part, search: false }));
  const owner = matcher && !matcher.empty ? matcher.owners(text) : null;
  const inSearch = new Uint8Array(text.length);
  for (const [start, end] of searched) inSearch.fill(1, start, end);
  const groupAt = (at: number) => (owner ? owner[at]! : NONE);
  const parts: HighlightPart[] = [];
  let start = 0;
  for (let at = 1; at <= text.length; at += 1) {
    if (at < text.length && groupAt(at) === groupAt(start) && inSearch[at] === inSearch[start]) continue;
    const index = groupAt(start);
    parts.push({ text: text.slice(start, at), group: index === NONE ? null : (matcher!.groups[index] ?? null), search: inSearch[start] === 1 });
    start = at;
  }
  return parts;
}

/** Parts in runs that share a group, so that one place a group colours is drawn as one mark. */
export function groupRuns(parts: readonly HighlightPart[]): Array<{ group: TermGroup | null; parts: HighlightPart[] }> {
  const runs: Array<{ group: TermGroup | null; parts: HighlightPart[] }> = [];
  for (const part of parts) {
    const last = runs.at(-1);
    if (last && last.group === part.group) last.parts.push(part);
    else runs.push({ group: part.group, parts: [part] });
  }
  return runs;
}
