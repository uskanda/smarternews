// Turns the tokens in DESIGN.md into the CSS the web app builds on. Run by `pnpm run tokens`;
// `--check` (used by `make verify`) fails when the generated file no longer matches DESIGN.md.
//
// `designmd export --format css-tailwind` is not used: it writes a font stack as one quoted string and
// leaves out line heights, so its output cannot style text.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

interface Typography {
  fontFamily: string;
  fontSize: string;
  fontWeight: number | string;
  lineHeight: number | string;
  letterSpacing?: string;
}

interface DesignTokens {
  colors?: Record<string, string>;
  typography?: Record<string, Typography>;
  spacing?: Record<string, string | number>;
  rounded?: Record<string, string>;
}

const DARK = /-dark$/;

function frontMatter(text: string): DesignTokens {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error("DESIGN.md has no front matter");
  return parse(match[1]!) as DesignTokens;
}

export function renderTokens(designMd: string): string {
  const tokens = frontMatter(designMd);
  const colors = Object.entries(tokens.colors ?? {});
  const light = colors.filter(([name]) => !DARK.test(name));
  const dark = colors.filter(([name]) => DARK.test(name)).map(([name, value]) => [name.replace(DARK, ""), value] as const);
  for (const [name] of dark) {
    if (!light.some(([lightName]) => lightName === name)) {
      throw new Error(`colors.${name}-dark has no light counterpart colors.${name}`);
    }
  }

  const lines = [
    "/* Generated from DESIGN.md by scripts/design-tokens.ts. Do not edit: change DESIGN.md and run `pnpm run tokens`. */",
    "@theme {",
    "  --color-*: initial;",
    ...light.map(([name, value]) => `  --color-${name}: ${value};`),
    "  --radius-*: initial;",
    ...Object.entries(tokens.rounded ?? {}).map(([name, value]) => `  --radius-${name}: ${value};`),
    ...Object.entries(tokens.spacing ?? {}).map(([name, value]) => `  --spacing-${name}: ${value};`),
    "}",
    "",
    "/* The dark values replace the light ones when the device asks for a dark colour scheme. */",
    "@media (prefers-color-scheme: dark) {",
    "  :root {",
    "    color-scheme: dark;",
    ...dark.map(([name, value]) => `    --color-${name}: ${value};`),
    "  }",
    "}",
  ];
  for (const [name, type] of Object.entries(tokens.typography ?? {})) {
    lines.push(
      "",
      `@utility type-${name} {`,
      `  font-family: ${type.fontFamily};`,
      `  font-size: ${type.fontSize};`,
      `  font-weight: ${type.fontWeight};`,
      `  line-height: ${type.lineHeight};`,
      ...(type.letterSpacing ? [`  letter-spacing: ${type.letterSpacing};`] : []),
      "}",
    );
  }
  return `${lines.join("\n")}\n`;
}

function main(): void {
  const root = join(import.meta.dirname, "..");
  const target = join(root, "apps/web/src/styles/tokens.css");
  const css = renderTokens(readFileSync(join(root, "DESIGN.md"), "utf8"));
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(target, "utf8");
    } catch {
      // a missing file is reported as out of date below
    }
    if (current !== css) {
      console.error("apps/web/src/styles/tokens.css is out of date with DESIGN.md. Run `pnpm run tokens`.");
      process.exit(1);
    }
    console.log("[tokens] apps/web/src/styles/tokens.css matches DESIGN.md");
    return;
  }
  writeFileSync(target, css);
  console.log(`wrote ${target}`);
}

if (import.meta.main) main();
