import type { ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SCRIM, useTheme } from "../theme/theme";
import { Txt } from "./Txt";

/** A panel that rises from the bottom over a dimmed screen: a short list of actions, or a question. */
export function Sheet({ title, visible, onClose, children }: { title: string; visible: boolean; onClose: () => void; children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: SCRIM }}>
        {/* Touching outside closes the sheet. A screen reader uses the sheet's own button or the back button. */}
        <Pressable importantForAccessibility="no" accessible={false} onPress={onClose} style={{ flex: 1 }} />
        <View
          accessibilityViewIsModal
          style={{
            gap: theme.spacing.sm,
            padding: theme.spacing.lg,
            paddingBottom: insets.bottom + theme.spacing.lg,
            borderTopLeftRadius: theme.rounded.lg,
            borderTopRightRadius: theme.rounded.lg,
            backgroundColor: theme.colors.surface,
          }}
        >
          <Txt variant="headline-md" heading>
            {title}
          </Txt>
          {children}
        </View>
      </View>
    </Modal>
  );
}
