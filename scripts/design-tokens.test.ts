import { describe, expect, it } from "vitest";
import { renderTokens } from "./design-tokens.ts";

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
