import { schemeFor, type ColorScheme } from "@smarternews/client";
import { useColorScheme } from "react-native";
import { useThemeChoice } from "./store";
import { colors, rounded, spacing, typography } from "./tokens";

export type ColorName = keyof (typeof colors)["light"];
export type TypeRole = keyof typeof typography;
export type Palette = Record<ColorName, string>;

/** What dims the screen behind a sheet or the drawer. The one colour that is not a token: it is the same in every scheme. */
export const SCRIM = "rgba(0, 0, 0, 0.5)";

export interface Theme {
  /** True for both dark schemes: what the app draws over the ground has to be light. */
  dark: boolean;
  colors: Palette;
  spacing: typeof spacing;
  rounded: typeof rounded;
  type: typeof typography;
}

export function themeFor(scheme: ColorScheme): Theme {
  return { dark: scheme !== "light", colors: colors[scheme], spacing, rounded, type: typography };
}

/** The design tokens for the colour scheme the user chose, or for the one the device is set to. */
export function useTheme(): Theme {
  const choice = useThemeChoice();
  const deviceDark = useColorScheme() === "dark";
  return themeFor(schemeFor(choice, deviceDark));
}
