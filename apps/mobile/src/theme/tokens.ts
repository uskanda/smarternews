// Generated from DESIGN.md by scripts/design-tokens.ts. Do not edit: change DESIGN.md and run `pnpm run tokens`.

export const colors = {
  light: {
    primary: "#24418F",
    "on-primary": "#FFFFFF",
    background: "#F3F5F8",
    surface: "#FFFFFF",
    "on-surface": "#17202B",
    "on-surface-muted": "#586473",
    outline: "#D8DEE6",
    "outline-strong": "#7A8594",
    selected: "#E8EDF7",
    mark: "#FFD84A",
    "mark-fill": "#FFE98A",
    warning: "#8A5200",
    error: "#A1260D",
    "on-error": "#FFFFFF",
  },
  dark: {
    primary: "#9CB6FF",
    "on-primary": "#10151B",
    background: "#10151B",
    surface: "#171D25",
    "on-surface": "#E7EBF0",
    "on-surface-muted": "#9DA9B7",
    outline: "#2B3440",
    "outline-strong": "#66727F",
    selected: "#212B3A",
    mark: "#E9C13A",
    "mark-fill": "#5C4B12",
    warning: "#F0B45C",
    error: "#FFA08F",
    "on-error": "#10151B",
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  nav: 200,
  "nav-indent": 16,
  list: 380,
  touch: 44,
  "touch-android": 48,
} as const;

export const rounded = {
  sm: 3,
  md: 4,
  lg: 6,
} as const;

export const typography = {
  "headline-lg": { fontFamily: "ShipporiMincho_700Bold", fontSize: 25, lineHeight: 38 },
  "headline-md": { fontFamily: "IBMPlexSansJP_600SemiBold", fontSize: 15, lineHeight: 23 },
  "body-lg": { fontFamily: "ShipporiMincho_500Medium", fontSize: 17, lineHeight: 33 },
  "body-md": { fontFamily: "IBMPlexSansJP_400Regular", fontSize: 14, lineHeight: 22 },
  "label-md": { fontFamily: "IBMPlexSansJP_600SemiBold", fontSize: 14, lineHeight: 20 },
  "label-sm": { fontFamily: "IBMPlexSansJP_400Regular", fontSize: 12, lineHeight: 18 },
} as const;
