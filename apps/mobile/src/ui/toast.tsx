import { usePathname } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/theme";
import { Button } from "./controls";
import { Txt } from "./Txt";

export interface ToastInput {
  message: string;
  /** How long it stays. An action needs time to be read and pressed. */
  durationMs?: number;
  action?: { label: string; run: () => void };
}

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

export function useToast(): (toast: ToastInput) => void {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast needs a ToastProvider above it");
  return value;
}

/** One short message at the bottom of the screen, announced to screen readers, with at most one action. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastInput | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: ToastInput) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(next);
    const asked = next.durationMs ?? 4000;
    timer.current = setTimeout(() => setToast(null), asked);
    // People who use a screen reader or a switch have told the device how long they need: use that if longer.
    void AccessibilityInfo.getRecommendedTimeoutMillis(asked).then((recommended) => {
      if (recommended <= asked || !timer.current) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(null), recommended);
    });
  }, []);

  // A message belongs to the screen it was shown on.
  const pathname = usePathname();
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, [pathname]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            position: "absolute",
            left: theme.spacing.lg,
            right: theme.spacing.lg,
            bottom: insets.bottom + theme.spacing.lg,
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.md,
            padding: theme.spacing.md,
            borderWidth: 1,
            borderColor: theme.colors["outline-strong"],
            borderRadius: theme.rounded.md,
            backgroundColor: theme.colors.surface,
          }}
        >
          <Txt variant="body-md" style={{ flex: 1 }}>
            {toast.message}
          </Txt>
          {toast.action ? (
            <Button
              label={toast.action.label}
              variant="quiet"
              onPress={() => {
                toast.action!.run();
                setToast(null);
              }}
            />
          ) : null}
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}
