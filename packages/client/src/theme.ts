// The colour scheme the user chooses. Each browser and each device keeps its own choice; the server holds none.

/** The three colour schemes of DESIGN.md. */
export type ColorScheme = "light" | "dark" | "darkblue";

/** What the user chooses: one of the schemes, or to follow the setting of the device. */
export type ThemeChoice = "system" | ColorScheme;

export const DEFAULT_THEME_CHOICE: ThemeChoice = "system";

/** In the order the settings show them. */
export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark", "darkblue"];

export const THEME_LABEL: Record<ThemeChoice, string> = {
  system: "端末に従う",
  light: "ライト",
  dark: "ダーク",
  darkblue: "ダークブルー",
};

/** The key the choice is stored under. Following the device is stored as no value at all. */
export const THEME_STORAGE_KEY = "smarternews.theme";

/** The choice a stored value stands for. Nothing, or a value this version does not know, follows the device. */
export function parseThemeChoice(stored: string | null): ThemeChoice {
  return stored === "light" || stored === "dark" || stored === "darkblue" ? stored : DEFAULT_THEME_CHOICE;
}

/** The scheme to draw with: the chosen one, or the one that goes with the setting of the device. */
export function schemeFor(choice: ThemeChoice, deviceDark: boolean): ColorScheme {
  if (choice !== "system") return choice;
  return deviceDark ? "darkblue" : "light";
}
