// Generated from DESIGN.md by scripts/design-tokens.ts. Do not edit: change DESIGN.md and run `pnpm run tokens`.

/** Lengths of the spacing scale, in pixels. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  nav: 200,
  "nav-min": 160,
  "nav-max": 400,
  "nav-indent": 16,
  list: 380,
  "list-min": 280,
  "list-max": 640,
  "article-min": 360,
  touch: 44,
  "touch-android": 48,
} as const;

/** The line height of each type style, in pixels: how far one line of text reaches. */
export const lineHeights = {
  "headline-lg": 38,
  "headline-md": 23,
  "body-lg": 33,
  "body-md": 22,
  "label-md": 20,
  "label-sm": 18,
} as const;
