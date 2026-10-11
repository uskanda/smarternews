import { describe, expect, it } from "vitest";
import { parseThemeChoice, schemeFor, THEME_CHOICES, THEME_LABEL } from "./theme.ts";

describe("the colour scheme the user chooses", () => {
  it("offers following the device first, then the three schemes", () => {
    expect(THEME_CHOICES.map((choice) => THEME_LABEL[choice])).toEqual(["端末に従う", "ライト", "ダーク", "ダークブルー"]);
  });

  it("reads a stored scheme, and follows the device when nothing or something unknown is stored", () => {
    expect(parseThemeChoice("light")).toBe("light");
    expect(parseThemeChoice("dark")).toBe("dark");
    expect(parseThemeChoice("darkblue")).toBe("darkblue");
    expect(parseThemeChoice(null)).toBe("system");
    expect(parseThemeChoice("system")).toBe("system");
    expect(parseThemeChoice("sepia")).toBe("system");
  });

  it("shows the chosen scheme whatever the device is set to", () => {
    expect(schemeFor("dark", false)).toBe("dark");
    expect(schemeFor("light", true)).toBe("light");
    expect(schemeFor("darkblue", false)).toBe("darkblue");
  });

  it("follows the device with light on a light one and dark blue on a dark one", () => {
    expect(schemeFor("system", false)).toBe("light");
    expect(schemeFor("system", true)).toBe("darkblue");
  });
});
