/**
 * Where a list has to scroll so that the row chosen with a key is in view, or null when the whole row already is.
 * Moving forward puts the row at the top edge and moving back at the bottom edge, so one press past an edge turns
 * the page. Positions are measured from the start of the content.
 */
export function followScroll({
  top,
  height,
  rowTop,
  rowBottom,
  step,
}: {
  /** How far the list is scrolled. */
  top: number;
  /** The height of the part of the list that shows. */
  height: number;
  rowTop: number;
  rowBottom: number;
  /** Positive after a move to a later row, negative after a move to an earlier one. */
  step: number;
}): number | null {
  if (rowTop >= top && rowBottom <= top + height) return null;
  // a row taller than the view shows from its start
  return Math.max(0, step > 0 ? rowTop : Math.min(rowTop, rowBottom - height));
}
