import { fireEvent, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHotkeys } from "./keys.ts";

/** A clock the test moves by hand. */
function clock() {
  let time = 0;
  const now = () => new Date(time);
  return { now, advance: (ms: number) => (time += ms) };
}

const press = (key: string, init: KeyboardEventInit = {}, target: Element = document.body) =>
  fireEvent.keyDown(target, { key, ...init });

describe("key names", () => {
  it("tells a letter with Shift from the same letter without it", () => {
    const lower = vi.fn();
    const upper = vi.fn();
    renderHook(() => useHotkeys({ a: lower, "Shift+A": upper }));

    press("A", { shiftKey: true });
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();

    press("a");
    expect(lower).toHaveBeenCalledTimes(1);
    expect(upper).toHaveBeenCalledTimes(1);
  });

  it("takes a capital letter typed with Caps Lock and without Shift for the small one", () => {
    const j = vi.fn();
    const markAll = vi.fn();
    renderHook(() => useHotkeys({ j, "Shift+A": markAll }));

    press("A");
    press("J");

    expect(markAll).not.toHaveBeenCalled();
    expect(j).toHaveBeenCalledTimes(1);
  });

  it("tells Space from Shift+Space", () => {
    const down = vi.fn();
    const up = vi.fn();
    renderHook(() => useHotkeys({ Space: down, "Shift+Space": up }));

    press(" ");
    press(" ", { shiftKey: true });

    expect(down).toHaveBeenCalledTimes(1);
    expect(up).toHaveBeenCalledTimes(1);
  });

  it("still finds a sign by the character it types", () => {
    const help = vi.fn();
    renderHook(() => useHotkeys({ "?": help }));

    press("?", { shiftKey: true });

    expect(help).toHaveBeenCalledTimes(1);
  });

  it("does nothing while a modifier is held or the user types in a field", () => {
    const j = vi.fn();
    renderHook(() => useHotkeys({ j }));
    const field = document.createElement("input");
    document.body.append(field);

    press("j", { ctrlKey: true });
    press("j", {}, field);

    expect(j).not.toHaveBeenCalled();
    field.remove();
  });
});

describe("two keys in a row", () => {
  it("runs the pair when the second key comes within a second", () => {
    const time = clock();
    const starred = vi.fn();
    const star = vi.fn();
    renderHook(() => useHotkeys({ "g s": starred, s: star }, { now: time.now }));

    press("g");
    time.advance(900);
    press("s");

    expect(starred).toHaveBeenCalledTimes(1);
    expect(star).not.toHaveBeenCalled();
  });

  it("takes a key that comes after the second for itself", () => {
    const time = clock();
    const starred = vi.fn();
    const star = vi.fn();
    renderHook(() => useHotkeys({ "g s": starred, s: star }, { now: time.now }));

    press("g");
    time.advance(1001);
    press("s");

    expect(starred).not.toHaveBeenCalled();
    expect(star).toHaveBeenCalledTimes(1);
  });

  it("uses up a second key that no pair has, without running it", () => {
    const time = clock();
    const read = vi.fn();
    renderHook(() => useHotkeys({ "g a": vi.fn(), m: read }, { now: time.now }));

    press("g");
    press("m");
    expect(read).not.toHaveBeenCalled();

    press("m");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("does not wait after g when no caller has a pair", () => {
    const time = clock();
    const star = vi.fn();
    renderHook(() => useHotkeys({ s: star }, { now: time.now }));

    press("g");
    press("s");

    expect(star).toHaveBeenCalledTimes(1);
  });

  it("does not let another caller take the second key of a pair for itself", () => {
    const time = clock();
    const recent = vi.fn();
    const refresh = vi.fn();
    renderHook(() => useHotkeys({ r: refresh }, { now: time.now }));
    renderHook(() => useHotkeys({ "g r": recent }, { now: time.now }));

    press("g");
    press("r");

    expect(recent).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("lets Shift be pressed on its own while it waits", () => {
    const time = clock();
    const pair = vi.fn();
    renderHook(() => useHotkeys({ "g a": pair }, { now: time.now }));

    press("g");
    press("Shift", { shiftKey: true });
    press("a");

    expect(pair).toHaveBeenCalledTimes(1);
  });
});

describe("Space on a control", () => {
  it("leaves Space and Shift+Space to a focused button, which it presses", () => {
    const down = vi.fn();
    const up = vi.fn();
    renderHook(() => useHotkeys({ Space: down, "Shift+Space": up }));
    const button = document.createElement("button");
    button.textContent = "スターを付ける";
    document.body.append(button);
    button.focus();

    const kept = press(" ", {}, button);
    press(" ", { shiftKey: true }, button);

    expect(kept).toBe(true); // not prevented: the browser presses the button
    expect(down).not.toHaveBeenCalled();
    expect(up).not.toHaveBeenCalled();
    button.remove();
  });

  it("leaves Space to the other controls that Space presses", () => {
    const down = vi.fn();
    renderHook(() => useHotkeys({ Space: down }));
    const controls = [document.createElement("summary"), ...["menuitem", "checkbox", "switch", "tab"].map((role) => {
      const element = document.createElement("div");
      element.setAttribute("role", role);
      element.tabIndex = 0;
      return element;
    })];
    for (const control of controls) {
      document.body.append(control);
      press(" ", {}, control);
      control.remove();
    }
    expect(down).not.toHaveBeenCalled();
  });

  it("scrolls with Space while a link has the focus, as Space does not follow a link", () => {
    const down = vi.fn();
    renderHook(() => useHotkeys({ Space: down }));
    const link = document.createElement("a");
    link.href = "/all/1";
    document.body.append(link);

    const kept = press(" ", {}, link);

    expect(kept).toBe(false);
    expect(down).toHaveBeenCalledTimes(1);
    link.remove();
  });
});

describe("controls that take no text", () => {
  /** Puts an element into the page for one test, and returns it with a way to take it out. */
  function place<T extends HTMLElement>(element: T): T {
    document.body.append(element);
    return element;
  }
  function input(type: string): HTMLInputElement {
    const element = document.createElement("input");
    element.type = type;
    return element;
  }

  it("runs a one-letter key while a checkbox, a radio, a button or a select has the focus", () => {
    const j = vi.fn();
    renderHook(() => useHotkeys({ j }));
    const controls = [input("checkbox"), input("radio"), input("button"), input("submit"), document.createElement("select")].map(place);

    for (const control of controls) press("j", {}, control);

    expect(j).toHaveBeenCalledTimes(controls.length);
    for (const control of controls) control.remove();
  });

  it("keeps a one-letter key from a field the user types in", () => {
    const j = vi.fn();
    renderHook(() => useHotkeys({ j }));
    const fields = [input("text"), input("search"), input("url"), input("number"), document.createElement("textarea")].map(place);

    for (const field of fields) press("j", {}, field);

    expect(j).not.toHaveBeenCalled();
    for (const field of fields) field.remove();
  });

  it("leaves Space to a checkbox, a radio and a select", () => {
    const down = vi.fn();
    renderHook(() => useHotkeys({ Space: down }));
    const controls = [input("checkbox"), input("radio"), document.createElement("select")].map(place);

    for (const control of controls) expect(press(" ", {}, control)).toBe(true);

    expect(down).not.toHaveBeenCalled();
    for (const control of controls) control.remove();
  });
});

describe("the left pane of a narrow screen", () => {
  it("takes only the keys that move between entries and screens", () => {
    const actions = {
      "Shift+J": vi.fn(),
      "Shift+K": vi.fn(),
      "/": vi.fn(),
      "?": vi.fn(),
      "g a": vi.fn(),
      j: vi.fn(),
      s: vi.fn(),
      Space: vi.fn(),
      "Shift+A": vi.fn(),
    };
    renderHook(() => useHotkeys(actions));
    const pane = document.createElement("div");
    pane.dataset.hotkeys = "nav";
    const entry = document.createElement("a");
    entry.href = "/unread";
    pane.append(entry);
    document.body.append(pane);

    press("J", { shiftKey: true }, entry);
    press("K", { shiftKey: true }, entry);
    press("/", {}, entry);
    press("?", { shiftKey: true }, entry);
    press("g", {}, entry);
    press("a", {}, entry);
    press("j", {}, entry);
    press("s", {}, entry);
    press(" ", {}, entry);
    press("A", { shiftKey: true }, entry);

    for (const name of ["Shift+J", "Shift+K", "/", "?", "g a"] as const) expect(actions[name]).toHaveBeenCalledTimes(1);
    for (const name of ["j", "s", "Space", "Shift+A"] as const) expect(actions[name]).not.toHaveBeenCalled();
    pane.remove();
  });
});
