// Turns the tokens in DESIGN.md into the CSS the web app builds on and the constants the Android app styles
// with. Run by `pnpm run tokens`; `--check` (used by `make verify`) fails when a generated file no longer
// matches DESIGN.md.
//
// `designmd export --format css-tailwind` is not used: it writes a font stack as one quoted string and
// leaves out line heights, so its output cannot style text.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

/** The name part that the bundled font files carry for a weight, as in `ShipporiMincho_500Medium`. */
const WEIGHT_NAME: Record<string, string> = { "400": "Regular", "500": "Medium", "600": "SemiBold", "700": "Bold" };

const pixels = (value: string | number): number | null => {
  const match = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(String(value));
  return match ? Number(match[1]) : null;
};

function nativeFont(role: string, type: Typography): string {
  const family = /^\s*['"]?([^,'"]+)/.exec(type.fontFamily)?.[1]?.replace(/\s+/g, "");
  const weight = WEIGHT_NAME[String(type.fontWeight)];
  if (!family || !weight) throw new Error(`typography.${role}: fontWeight ${type.fontWeight} has no bundled font file`);
  return `${family}_${type.fontWeight}${weight}`;
}

const key = (name: string): string => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name));

/**
 * The same tokens for React Native: colours as a light and a dark set, lengths as numbers, and each typography
 * role with the name of its bundled font file. React Native has no font stacks and takes line heights in pixels.
 */
export function renderNativeTokens(designMd: string): string {
  const tokens = frontMatter(designMd);
  const colors = Object.entries(tokens.colors ?? {});
  const light = colors.filter(([name]) => !DARK.test(name));
  const darkValues = new Map(colors.filter(([name]) => DARK.test(name)).map(([name, value]) => [name.replace(DARK, ""), value]));
  const lengths = (group: Record<string, string | number> | undefined) =>
    Object.entries(group ?? {})
      .map(([name, value]) => [name, pixels(value)] as const)
      .filter(([, value]) => value !== null)
      .map(([name, value]) => `  ${key(name)}: ${value},`);

  const lines = [
    "// Generated from DESIGN.md by scripts/design-tokens.ts. Do not edit: change DESIGN.md and run `pnpm run tokens`.",
    "",
    "export const colors = {",
    "  light: {",
    ...light.map(([name, value]) => `    ${key(name)}: ${JSON.stringify(value)},`),
    "  },",
    "  dark: {",
    ...light.map(([name, value]) => `    ${key(name)}: ${JSON.stringify(darkValues.get(name) ?? value)},`),
    "  },",
    "} as const;",
    "",
    "export const spacing = {",
    ...lengths(tokens.spacing),
    "} as const;",
    "",
    "export const rounded = {",
    ...lengths(tokens.rounded),
    "} as const;",
    "",
    "export const typography = {",
    ...Object.entries(tokens.typography ?? {}).map(([name, type]) => {
      const size = pixels(type.fontSize);
      if (size === null) throw new Error(`typography.${name}: fontSize ${type.fontSize} is not in pixels`);
      const lineHeight = Math.round(size * Number(type.lineHeight));
      return `  ${key(name)}: { fontFamily: ${JSON.stringify(nativeFont(name, type))}, fontSize: ${size}, lineHeight: ${lineHeight} },`;
    }),
    "} as const;",
  ];
  return `${lines.join("\n")}\n`;
}

const OUTPUTS = [
  { path: "apps/web/src/styles/tokens.css", render: renderTokens },
  { path: "apps/mobile/src/theme/tokens.ts", render: renderNativeTokens },
];

function main(): void {
  const root = join(import.meta.dirname, "..");
  const design = readFileSync(join(root, "DESIGN.md"), "utf8");
  const check = process.argv.includes("--check");
  let stale = false;
  for (const output of OUTPUTS) {
    const target = join(root, output.path);
    const text = output.render(design);
    if (!check) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
      console.log(`wrote ${target}`);
      continue;
    }
    let current = "";
    try {
      current = readFileSync(target, "utf8");
    } catch {
      // a missing file is reported as out of date below
    }
    if (current === text) {
      console.log(`[tokens] ${output.path} matches DESIGN.md`);
    } else {
      console.error(`${output.path} is out of date with DESIGN.md. Run \`pnpm run tokens\`.`);
      stale = true;
    }
  }
  if (stale) process.exit(1);
}

if (import.meta.main) main();
