import type { ReactNode } from "react";
import { View } from "react-native";
import { useTheme } from "../theme/theme";
import { Txt } from "./Txt";

/** A titled group on a settings screen. Groups are separated by a rule, not boxed. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.md, padding: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.outline }}>
      <Txt variant="headline-md" heading>
        {title}
      </Txt>
      {children}
    </View>
  );
}
