// The note on a whole article being written and not saved, kept for each article in the tab: it outlives moving
// to another article and a reload, as a phone's browser does when it comes back, and goes with the tab. Where the
// browser refuses the storage, nothing is kept.

const keyOf = (articleId: number) => `smarternews.noteDraft.${articleId}`;

/** The draft kept for the article, or null when none is. */
export function noteDraftOf(articleId: number): string | null {
  try {
    return window.sessionStorage.getItem(keyOf(articleId));
  } catch {
    return null;
  }
}

export function keepNoteDraft(articleId: number, text: string): void {
  try {
    window.sessionStorage.setItem(keyOf(articleId), text);
  } catch {
    // Not kept; the field still holds it while the article is open.
  }
}

export function forgetNoteDraft(articleId: number): void {
  try {
    window.sessionStorage.removeItem(keyOf(articleId));
  } catch {
    // Nothing was kept.
  }
}
