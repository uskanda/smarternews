/**
 * How many articles a refresh brought into the list: those in `after` that were not on the screen `before`.
 * While pages were left unloaded (`complete` false), what comes after the last row seen before is taken for
 * articles moved up from those pages, once rows read went away, and is not counted.
 */
export function countNewArticles({ before, after, complete }: { before: readonly number[]; after: readonly number[]; complete: boolean }): number {
  const shown = new Set(before);
  let end = after.length;
  if (!complete && shown.size > 0) {
    end = 0;
    after.forEach((id, index) => {
      if (shown.has(id)) end = index + 1;
    });
  }
  return after.slice(0, end).filter((id) => !shown.has(id)).length;
}
