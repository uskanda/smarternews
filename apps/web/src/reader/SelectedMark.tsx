/**
 * The line down the right edge of the selected row of a list, in a row that is positioned. The ground of the row
 * differs too little from the others to show the selection alone; the left edge holds the mark of importance.
 */
export function SelectedMark() {
  return <span aria-hidden="true" data-selected-mark className="selected-mark" />;
}
