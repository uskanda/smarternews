import { useEffect, useRef } from "react";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Runs an action when its single key is pressed. Keys are ignored while the user types in a field, and
 * when a modifier is held, so browser shortcuts keep working.
 */
export function useHotkeys(actions: Record<string, (() => void) | undefined>): void {
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      const action = latest.current[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
