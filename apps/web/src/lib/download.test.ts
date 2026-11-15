import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVOKE_DELAY_MS, saveBlob } from "./download.ts";

describe("saveBlob", () => {
  let links: HTMLAnchorElement[];

  beforeEach(() => {
    vi.useFakeTimers();
    links = [];
    URL.createObjectURL = vi.fn(() => "blob:file");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      links.push(this);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("clicks a link that saves the blob under the given name", () => {
    const blob = new Blob(["x"], { type: "text/plain" });
    saveBlob(blob, "file.txt");

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(links).toHaveLength(1);
    expect(links[0]!.href).toBe("blob:file");
    expect(links[0]!.download).toBe("file.txt");
  });

  it("keeps the URL alive until the download has had time to start", () => {
    saveBlob(new Blob(["x"]), "file.txt");

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVOKE_DELAY_MS - 1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:file");
  });
});
