import { useColorScheme } from "react-native";
import { colors, rounded, spacing, typography } from "./tokens";

export type ColorName = keyof (typeof colors)["light"];
export type TypeRole = keyof typeof typography;
export type Palette = Record<ColorName, string>;

/** What dims the screen behind a sheet or the drawer. The one colour that is not a token: it is the same in both schemes. */
export const SCRIM = "rgba(0, 0, 0, 0.5)";

export interface Theme {
  dark: boolean;
  colors: Palette;
  spacing: typeof spacing;
  rounded: typeof rounded;
  type: typeof typography;
}

export function themeFor(scheme: "light" | "dark"): Theme {
  const dark = scheme === "dark";
  return { dark, colors: dark ? colors.dark : colors.light, spacing, rounded, type: typography };
}

/** The design tokens for the colour scheme the device is set to. */
export function useTheme(): Theme {
  return themeFor(useColorScheme() === "dark" ? "dark" : "light");
}
