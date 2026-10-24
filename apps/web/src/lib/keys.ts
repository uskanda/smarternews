import { useEffect, useRef } from "react";

type Actions = Record<string, (() => void) | undefined>;

interface Caller {
  actions: { current: Actions };
  /** The clock the caller was given, if any. */
  now: { current: (() => Date) | undefined };
}

/** How long a `g` waits for the key that follows it. */
export const SEQUENCE_MS = 1000;

// Every caller's table, and one wait for the second key of a pair shared by all of them: a key that ends a
// pair is used up for every caller, so `r` after `g` never also runs a caller's `r`.
const callers = new Set<Caller>();
let waitingUntil: number | null = null;

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph", "Fn", "OS"]);
/** What Space presses when it has the focus. A link is not among them: Space does not follow a link. */
const PRESSED_BY_SPACE = new Set(["button", "menuitem", "checkbox", "switch", "tab"]);

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function isPressedBySpace(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "BUTTON" || target.tagName === "SUMMARY") return true;
  return PRESSED_BY_SPACE.has(target.getAttribute("role") ?? "");
}

/**
 * The name a table looks a key up by: a letter in small case, or as `Shift+A` when Shift is held — Caps Lock
 * alone does not make it one. Space is `Space` or `Shift+Space`. Any other key keeps the character it types,
 * so `?` is `?`. Null for a key that is no action of its own.
 */
export function keyName(event: KeyboardEvent): string | null {
  const { key } = event;
  if (MODIFIERS.has(key)) return null;
  if (key === " ") return event.shiftKey ? "Shift+Space" : "Space";
  if (/^[a-z]$/i.test(key)) return event.shiftKey ? `Shift+${key.toUpperCase()}` : key.toLowerCase();
  return key;
}

function run(name: string): boolean {
  const found = [...callers].map((caller) => caller.actions.current[name]).filter((action) => action !== undefined);
  for (const action of found) action();
  return found.length > 0;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
  const name = keyName(event);
  if (name === null) return;
  if ((name === "Space" || name === "Shift+Space") && isPressedBySpace(event.target)) return;
  const clock = [...callers].map((caller) => caller.now.current).find((now) => now !== undefined);
  const now = (clock ?? (() => new Date()))().getTime();

  if (waitingUntil !== null) {
    const waiting = now <= waitingUntil;
    waitingUntil = null;
    if (waiting) {
      // The second key of a pair: run the pair if someone has it, and never the key on its own.
      if (run(`g ${name}`)) event.preventDefault();
      return;
    }
  }
  if (name === "g" && [...callers].some((caller) => Object.keys(caller.actions.current).some((key) => key.startsWith("g ") && caller.actions.current[key]))) {
    waitingUntil = now + SEQUENCE_MS;
    event.preventDefault();
    return;
  }
  if (run(name)) event.preventDefault();
}

/** Forgets a `g` that is waiting for its second key. For tests. */
export function resetHotkeys(): void {
  waitingUntil = null;
}

/**
 * Runs an action when its key is pressed: `j`, `Shift+A`, `Space`, `?`, or a pair such as `g a`, whose second
 * key must come within a second of `g`. Keys are ignored while the user types in a field, and when Ctrl, Alt
 * or Meta is held, so browser shortcuts keep working. Space is left to a focused button, which it presses.
 * `now` is the clock the second of a pair is measured with; the first clock any caller gives is used.
 */
export function useHotkeys(actions: Actions, options: { now?: () => Date } = {}): void {
  const latest = useRef(actions);
  const clock = useRef(options.now);
  useEffect(() => {
    latest.current = actions;
    clock.current = options.now;
  });
  useEffect(() => {
    const caller: Caller = { actions: latest, now: clock };
    if (callers.size === 0) window.addEventListener("keydown", onKeyDown);
    callers.add(caller);
    return () => {
      callers.delete(caller);
      if (callers.size === 0) window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
