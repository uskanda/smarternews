import { describe, expect, it } from "vitest";
import { renderNativeTokens, renderTokens } from "./design-tokens.ts";

const DESIGN = `---
version: alpha
name: sample
colors:
  primary: "#24418F"
  surface: "#FFFFFF"
  primary-dark: "#9CB6FF"
  surface-dark: "#171D25"
typography:
  body-lg:
    fontFamily: "'Shippori Mincho', 'Yu Mincho', serif"
    fontSize: 17px
    fontWeight: 500
    lineHeight: 1.95
spacing:
  sm: 8px
  nav: 200px
rounded:
  md: 4px
---

# sample design system
`;

describe("renderTokens", () => {
  const css = renderTokens(DESIGN);

  it("declares each light colour as a Tailwind theme colour and drops Tailwind's own palette", () => {
    expect(css).toContain("--color-*: initial;");
    expect(css).toContain("--color-primary: #24418F;");
    expect(css).toContain("--color-surface: #FFFFFF;");
  });

  it("keeps the dark values out of the theme and swaps them in for a dark colour scheme", () => {
    expect(css).not.toContain("--color-primary-dark");
    const dark = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
    expect(dark).toContain("--color-primary: #9CB6FF;");
    expect(dark).toContain("--color-surface: #171D25;");
    expect(dark).toContain("color-scheme: dark;");
  });

  it("writes a font stack as a list of families, not as one quoted string", () => {
    expect(css).toContain("font-family: 'Shippori Mincho', 'Yu Mincho', serif;");
  });

  it("gives each typography role one utility with size, weight and line height", () => {
    const block = css.slice(css.indexOf("@utility type-body-lg"), css.indexOf("}", css.indexOf("@utility type-body-lg")));
    expect(block).toContain("font-size: 17px;");
    expect(block).toContain("font-weight: 500;");
    expect(block).toContain("line-height: 1.95;");
  });

  it("declares spacing and radius under Tailwind's names", () => {
    expect(css).toContain("--spacing-sm: 8px;");
    expect(css).toContain("--spacing-nav: 200px;");
    expect(css).toContain("--radius-md: 4px;");
  });

  it("says that the file is generated", () => {
    expect(css.split("\n")[0]).toContain("Generated from DESIGN.md");
  });

  it("refuses a dark colour without a light counterpart", () => {
    expect(() => renderTokens(DESIGN.replace('  surface: "#FFFFFF"\n', ""))).toThrow(/surface-dark/);
  });
});

describe("renderNativeTokens", () => {
  const source = renderNativeTokens(DESIGN);

  it("says that the file is generated", () => {
    expect(source.split("\n")[0]).toContain("Generated from DESIGN.md");
  });

  it("gives the light and the dark colours as two sets with the same names", () => {
    expect(source).toContain('light: {\n    primary: "#24418F",\n    surface: "#FFFFFF",\n  }');
    expect(source).toContain('dark: {\n    primary: "#9CB6FF",\n    surface: "#171D25",\n  }');
  });

  it("falls back to the light value for a colour without a dark one", () => {
    const partial = renderNativeTokens(DESIGN.replace('  surface-dark: "#171D25"\n', ""));
    expect(partial).toContain('dark: {\n    primary: "#9CB6FF",\n    surface: "#FFFFFF",\n  }');
  });

  it("writes lengths in pixels as plain numbers and leaves out lengths in other units", () => {
    const withEm = renderNativeTokens(DESIGN.replace("  nav: 200px\n", "  nav: 200px\n  measure: 36em\n"));
    expect(withEm).toContain("sm: 8,");
    expect(withEm).toContain("nav: 200,");
    expect(withEm).not.toContain("measure");
    expect(withEm).toContain("md: 4,");
  });

  it("names the bundled font file for the first family and the weight, and turns the line height into pixels", () => {
    expect(source).toContain('"body-lg": { fontFamily: "ShipporiMincho_500Medium", fontSize: 17, lineHeight: 33 },');
  });

  it("refuses a weight that has no bundled font file", () => {
    expect(() => renderNativeTokens(DESIGN.replace("fontWeight: 500", "fontWeight: 450"))).toThrow(/fontWeight 450/);
  });
});
