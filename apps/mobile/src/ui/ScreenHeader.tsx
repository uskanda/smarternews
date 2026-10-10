import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/theme";
import { Txt } from "./Txt";

/** The bar on top of a screen: one button on the left, the screen's name, and actions on the right. */
export function ScreenHeader({ title, left, right }: { title: string; left?: ReactNode; right?: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: theme.colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.outline,
      }}
    >
      <View style={{ minHeight: theme.spacing["touch-android"] + theme.spacing.sm, flexDirection: "row", alignItems: "center", paddingHorizontal: theme.spacing.xs }}>
        {left}
        <Txt variant="headline-md" heading numberOfLines={2} style={{ flex: 1, marginHorizontal: theme.spacing.sm }}>
          {title}
        </Txt>
        <View style={{ flexDirection: "row", alignItems: "center" }}>{right}</View>
      </View>
    </View>
  );
}
