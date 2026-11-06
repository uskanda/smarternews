import { useEffect, useRef } from "react";

/**
 * The first field a keyboard user would reach in `root`: an input, select or text area that can be used. In a group
 * of radio buttons only the chosen one counts, or the first of the group when none is chosen, as Tab does.
 */
export function firstField(root: HTMLElement): HTMLElement | null {
  const fields = root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea");
  for (const field of fields) {
    if (field.disabled) continue;
    if (field instanceof HTMLInputElement && field.type === "hidden") continue;
    if (field instanceof HTMLInputElement && field.type === "radio" && !field.checked) {
      const group = [...fields].filter((other) => other instanceof HTMLInputElement && other.type === "radio" && other.name === field.name && !other.disabled);
      const chosen = group.find((other) => (other as HTMLInputElement).checked);
      if (chosen) continue;
      if (group[0] !== field) continue;
    }
    return field;
  }
  return null;
}

/**
 * The focus of a form opened in place by an "edit" button. Put `region` on the element around the form and `opener`
 * on the button: when the form opens, the focus goes to its first field, and when it closes, back to the button.
 * The focus moves after the render, once the button or the form is on the page.
 */
export function useInlineEditFocus<Region extends HTMLElement = HTMLDivElement>(editing: boolean) {
  const region = useRef<Region>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (editing && !wasEditing.current && region.current) firstField(region.current)?.focus();
    if (!editing && wasEditing.current) opener.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  return { region, opener };
}
