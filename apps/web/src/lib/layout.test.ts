import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setFontSize, setViewport } from "../testing/setup.ts";
import { useLayout } from "./layout.ts";

describe("useLayout", () => {
  it("shows three panes from 1100px, two from 720px, and one below that at the default font size", () => {
    const { result } = renderHook(() => useLayout());
    const at = (width: number) => {
      act(() => setViewport(width));
      return result.current;
    };
    expect(at(1100)).toBe("wide");
    expect(at(1099)).toBe("medium");
    expect(at(720)).toBe("medium");
    expect(at(719)).toBe("narrow");
  });

  it("measures the screen in the font size the browser is set to, so that larger text takes fewer panes", () => {
    setFontSize(32);
    const { result } = renderHook(() => useLayout());
    const at = (width: number) => {
      act(() => setViewport(width));
      return result.current;
    };
    expect(at(2200)).toBe("wide");
    expect(at(2199)).toBe("medium");
    expect(at(1440)).toBe("medium");
    expect(at(1439)).toBe("narrow");
    expect(at(1280)).toBe("narrow");
  });
});
