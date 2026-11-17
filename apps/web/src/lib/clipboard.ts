/**
 * Copies a field's worth of text through a field of its own, for a page that has no clipboard API: one opened
 * over plain HTTP has none. The reader's selection and focus are put back after.
 */
function copyThroughField(value: string): boolean {
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.setAttribute("aria-hidden", "true");
  // Out of sight, and out of the way of the layout and of scrolling to it.
  field.style.position = "fixed";
  field.style.top = "0";
  field.style.left = "-9999px";
  field.style.opacity = "0";
  document.body.append(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
    // The focus first: moving it may move the selection as well.
    focused?.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}

/**
 * Writes the text to the clipboard: with the browser's clipboard API, or without it, or when it refuses, through
 * a field of its own. Tells whether the text was copied.
 */
export async function copyText(value: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // The page may not have the permission: the older way still copies on most browsers.
    }
  }
  return copyThroughField(value);
}
