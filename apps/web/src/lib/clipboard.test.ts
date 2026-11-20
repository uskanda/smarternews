import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard.ts";

const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");

/** Gives the browser a clipboard API, or takes it away as a page over plain HTTP has none. */
function setClipboard(value: Pick<Clipboard, "writeText"> | undefined) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value });
}

/** Stands in for `document.execCommand`, which jsdom lacks; records the text selected when copy is called. */
function stubExecCommand(result: boolean | Error = true) {
  const copied: string[] = [];
  const exec = vi.fn((command: string) => {
    if (command !== "copy") return false;
    copied.push(document.getSelection()?.toString() || ((document.activeElement as HTMLTextAreaElement | null)?.value ?? ""));
    if (result instanceof Error) throw result;
    return result;
  });
  Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
  return { exec, copied };
}

/** A paragraph with its text selected, and a button that holds the focus, as when the reader chose a menu item. */
function selectParagraph() {
  const paragraph = document.createElement("p");
  paragraph.textContent = "Selected words";
  const button = document.createElement("button");
  document.body.append(paragraph, button);
  // The focus first: moving it clears the selection in jsdom.
  button.focus();
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
  return { paragraph, button };
}

afterEach(() => {
  if (original) Object.defineProperty(navigator, "clipboard", original);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  delete (document as { execCommand?: unknown }).execCommand;
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe("copyText", () => {
  it("writes the text with the clipboard API when the browser has one", async () => {
    const writeText = vi.fn(async () => {});
    setClipboard({ writeText });
    const { exec } = stubExecCommand();

    await expect(copyText("[A](https://example.com/a)")).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("[A](https://example.com/a)");
    expect(exec).not.toHaveBeenCalled();
  });

  it("copies the text through a field of its own without the API, and puts back the selection and the focus", async () => {
    setClipboard(undefined);
    const { exec, copied } = stubExecCommand();
    const { paragraph, button } = selectParagraph();

    await expect(copyText("[A](https://example.com/a)")).resolves.toBe(true);

    expect(exec).toHaveBeenCalledWith("copy");
    expect(copied).toEqual(["[A](https://example.com/a)"]);
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.getSelection()!.toString()).toBe("Selected words");
    expect(document.getSelection()!.getRangeAt(0).commonAncestorContainer).toBe(paragraph);
    expect(document.activeElement).toBe(button);
  });

  it("falls back to the field when the API refuses", async () => {
    setClipboard({ writeText: vi.fn(async () => Promise.reject(new Error("denied"))) });
    const { copied } = stubExecCommand();
    selectParagraph();

    await expect(copyText("text")).resolves.toBe(true);

    expect(copied).toEqual(["text"]);
    expect(document.getSelection()!.toString()).toBe("Selected words");
  });

  it("fails when the browser does not copy either way", async () => {
    setClipboard(undefined);
    stubExecCommand(false);
    await expect(copyText("text")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("fails when the command throws", async () => {
    setClipboard(undefined);
    stubExecCommand(new Error("not allowed"));
    await expect(copyText("text")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });
});
