import { describe, expect, it } from "vitest";
import { renderNativeTokens, renderTokens, renderWebSizes } from "./design-tokens.ts";

const DESIGN = `---
version: alpha
name: sample
colors:
  primary: "#24418F"
  surface: "#FFFFFF"
  mark: "#FFD84A"
  primary-darkblue: "#9CB6FF"
  surface-darkblue: "#171D25"
  mark-darkblue: "#E9C13A"
  primary-dark: "#A9BEFF"
  surface-dark: "#1B1B1B"
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

  /** The declarations of the first rule with this selector. */
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start));
  };

  it("keeps the dark values out of the theme", () => {
    expect(css).not.toContain("--color-primary-dark");
    expect(css.slice(0, css.indexOf("}"))).not.toContain("#9CB6FF");
  });

  it("swaps in dark blue for a dark device, unless the user chose a colour scheme", () => {
    const media = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
    const block = media.slice(0, media.indexOf("}"));
    expect(block).toContain(":root:not([data-theme]) {");
    expect(block).toContain("color-scheme: dark;");
    expect(block).toContain("--color-primary: #9CB6FF;");
    expect(block).toContain("--color-surface: #171D25;");
  });

  it("gives each chosen colour scheme its values under the attribute of the root element", () => {
    const dark = rule(':root[data-theme="dark"]');
    expect(dark).toContain("color-scheme: dark;");
    expect(dark).toContain("--color-primary: #A9BEFF;");
    expect(dark).toContain("--color-surface: #1B1B1B;");

    const darkblue = rule(':root[data-theme="darkblue"]');
    expect(darkblue).toContain("color-scheme: dark;");
    expect(darkblue).toContain("--color-primary: #9CB6FF;");
    expect(darkblue).toContain("--color-surface: #171D25;");
  });

  it("uses the dark blue value for a colour that dark does not define", () => {
    expect(rule(':root[data-theme="dark"]')).toContain("--color-mark: #E9C13A;");
  });

  it("keeps the light values for a chosen light scheme and only fixes the scheme of the browser's own controls", () => {
    const light = rule(':root[data-theme="light"]');
    expect(light).toContain("color-scheme: light;");
    expect(light).not.toContain("--color-");
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

  it("refuses a dark or dark blue colour without a light counterpart", () => {
    expect(() => renderTokens(DESIGN.replace('  surface: "#FFFFFF"\n', ""))).toThrow(/surface-dark/);
    expect(() => renderTokens(DESIGN.replace('  mark: "#FFD84A"\n', ""))).toThrow(/mark-darkblue/);
  });
});

describe("renderNativeTokens", () => {
  const source = renderNativeTokens(DESIGN);

  it("says that the file is generated", () => {
    expect(source.split("\n")[0]).toContain("Generated from DESIGN.md");
  });

  it("gives the light, the dark and the dark blue colours as three sets with the same names", () => {
    expect(source).toContain('light: {\n    primary: "#24418F",\n    surface: "#FFFFFF",\n    mark: "#FFD84A",\n  }');
    expect(source).toContain('dark: {\n    primary: "#A9BEFF",\n    surface: "#1B1B1B",\n    mark: "#E9C13A",\n  }');
    expect(source).toContain('darkblue: {\n    primary: "#9CB6FF",\n    surface: "#171D25",\n    mark: "#E9C13A",\n  }');
  });

  it("falls back to the dark blue value for a colour without a dark one, and to the light value without either", () => {
    const partial = renderNativeTokens(DESIGN.replace('  surface-dark: "#1B1B1B"\n', "").replace('  mark-darkblue: "#E9C13A"\n', ""));
    expect(partial).toContain('dark: {\n    primary: "#A9BEFF",\n    surface: "#171D25",\n    mark: "#FFD84A",\n  }');
    expect(partial).toContain('darkblue: {\n    primary: "#9CB6FF",\n    surface: "#171D25",\n    mark: "#FFD84A",\n  }');
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

describe("renderWebSizes", () => {
  it("gives the pixel lengths of the spacing scale as numbers, and says that the file is generated", () => {
    const text = renderWebSizes(DESIGN);
    expect(text).toContain("Generated from DESIGN.md");
    expect(text).toContain("  sm: 8,");
    expect(text).toContain("  nav: 200,");
  });

  it("leaves out lengths that are not in pixels", () => {
    expect(renderWebSizes(DESIGN.replace("  nav: 200px", "  nav: 200px\n  measure: 36em"))).not.toContain("measure");
  });
});
