import { Text, type TextProps } from "react-native";
import { useTheme, type ColorName, type TypeRole } from "../theme/theme";

export interface TxtProps extends TextProps {
  /** The typography role from DESIGN.md. */
  variant?: TypeRole;
  color?: ColorName;
  /** Marks the text as a heading for screen readers. */
  heading?: boolean;
}

/** Text in one of the design system's roles. Every string on a screen goes through this. */
export function Txt({ variant = "body-md", color = "on-surface", heading, style, ...props }: TxtProps) {
  const theme = useTheme();
  return <Text accessibilityRole={heading ? "header" : undefined} {...props} style={[theme.type[variant], { color: theme.colors[color] }, style]} />;
}
