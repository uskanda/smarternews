import { messageFor } from "@smarternews/client";
import { useId, useState, type ReactNode, type Ref } from "react";
import { ActivityIndicator, Pressable, Switch, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { useTheme } from "../theme/theme";
import { Icon, type IconName } from "./Icon";
import { Txt } from "./Txt";

type Variant = "primary" | "secondary" | "danger" | "quiet";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  /** Shown instead of the label while the action runs; the button cannot be pressed then. */
  busyLabel?: string | null;
  /** For one choice among several: the chosen one is marked with a check, not by colour alone. */
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A button with words on it. At least 48dp high and wide. */
export function Button({ label, onPress, variant = "secondary", disabled = false, busyLabel = null, selected, style }: ButtonProps) {
  const theme = useTheme();
  const off = disabled || busyLabel !== null;
  const background = { primary: theme.colors.primary, secondary: theme.colors.surface, danger: theme.colors.error, quiet: "transparent" }[variant];
  const border = { primary: theme.colors.primary, secondary: theme.colors["outline-strong"], danger: theme.colors.error, quiet: "transparent" }[variant];
  const text = ({ primary: "on-primary", secondary: "on-surface", danger: "on-error", quiet: "primary" } as const)[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busyLabel ?? label}
      accessibilityState={{ disabled: off, busy: busyLabel !== null, ...(selected === undefined ? {} : { selected }) }}
      disabled={off}
      onPress={onPress}
      android_ripple={{ color: theme.colors.selected }}
      style={({ pressed }) => [
        {
          minHeight: theme.spacing["touch-android"],
          minWidth: theme.spacing["touch-android"],
          paddingHorizontal: theme.spacing.lg,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderRadius: theme.rounded.md,
          borderColor: pressed ? theme.colors.primary : border,
          backgroundColor: pressed && variant === "secondary" ? theme.colors.selected : background,
          opacity: off ? 0.5 : 1,
        },
        style,
      ]}
    >
      <Txt variant="label-md" color={text}>
        {selected ? `✓ ${busyLabel ?? label}` : (busyLabel ?? label)}
      </Txt>
    </Pressable>
  );
}

export interface IconButtonProps {
  /** What the button does, read out by screen readers. A button without words cannot exist without it. */
  label: string;
  icon: IconName;
  onPress: () => void;
  filled?: boolean;
  disabled?: boolean;
  /** The state the button shows, read out after its name, such as which of two views is shown. */
  value?: string;
}

/** A button that shows only a picture. 48dp square. */
export function IconButton({ label, icon, onPress, filled = false, disabled = false, value }: IconButtonProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      accessibilityValue={value === undefined ? undefined : { text: value }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: theme.colors.selected, borderless: true }}
      style={({ pressed }) => ({
        width: theme.spacing["touch-android"],
        height: theme.spacing["touch-android"],
        alignItems: "center",
        justifyContent: "center",
        borderRadius: theme.rounded.md,
        backgroundColor: pressed ? theme.colors.selected : "transparent",
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Icon name={icon} color={filled ? theme.colors.primary : theme.colors["on-surface"]} filled={filled} />
    </Pressable>
  );
}

export interface FieldProps extends Omit<TextInputProps, "style"> {
  ref?: Ref<TextInput>;
  label: string;
  hint?: string;
  error?: string | null;
}

/**
 * A labelled text field. The visible label names the field for a screen reader, and the field keeps no
 * description of its own: on Android a description would be read in place of what was typed.
 */
export function Field({ ref, label, hint, error, multiline, ...props }: FieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const labelId = useId();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Txt variant="label-md" nativeID={labelId}>
        {label}
      </Txt>
      {hint ? (
        <Txt variant="label-sm" color="on-surface-muted">
          {hint}
        </Txt>
      ) : null}
      <TextInput
        ref={ref}
        accessibilityLabelledBy={labelId}
        accessibilityHint={hint}
        multiline={multiline}
        placeholderTextColor={theme.colors["on-surface-muted"]}
        {...props}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        style={[
          theme.type["body-md"],
          {
            minHeight: multiline ? theme.spacing["touch-android"] * 4 : theme.spacing["touch-android"],
            textAlignVertical: multiline ? "top" : "center",
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            borderWidth: focused ? 2 : 1,
            borderRadius: theme.rounded.md,
            borderColor: error ? theme.colors.error : focused ? theme.colors.primary : theme.colors["outline-strong"],
            backgroundColor: theme.colors.surface,
            color: theme.colors["on-surface"],
          },
        ]}
      />
      {error ? (
        <Txt variant="label-sm" color="error" accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

/** A switch with its words. The whole row is the control. */
export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={{ minHeight: theme.spacing["touch-android"], flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}
    >
      <Switch
        value={value}
        onValueChange={onChange}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        trackColor={{ true: theme.colors.primary, false: theme.colors["outline-strong"] }}
        thumbColor={theme.colors.surface}
      />
      <Txt variant="body-md">{label}</Txt>
    </Pressable>
  );
}

/** Something the user should know, in a bordered block. `tone` picks the colour; the words carry the meaning. */
export function Notice({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "warning" | "error" }) {
  const theme = useTheme();
  const color = ({ plain: "on-surface", warning: "warning", error: "error" } as const)[tone];
  return (
    <View
      accessibilityRole={tone === "error" ? "alert" : undefined}
      accessibilityLiveRegion={tone === "plain" ? "none" : "polite"}
      style={{ padding: theme.spacing.md, borderWidth: 1, borderRadius: theme.rounded.md, borderColor: theme.colors[color === "on-surface" ? "outline-strong" : color] }}
    >
      <Txt variant="body-md" color={color}>
        {children}
      </Txt>
    </View>
  );
}

/** A failed call: what went wrong and one thing to do about it. */
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ margin: theme.spacing.lg, gap: theme.spacing.md }}>
      <Notice tone="error">{messageFor(error)}</Notice>
      {onRetry ? <Button label="やり直す" onPress={onRetry} style={{ alignSelf: "flex-start" }} /> : null}
    </View>
  );
}

export function Loading() {
  const theme = useTheme();
  return (
    <View accessibilityLabel="読み込み中" accessibilityRole="progressbar" style={{ padding: theme.spacing.xl, alignItems: "center" }}>
      <ActivityIndicator color={theme.colors.primary} />
    </View>
  );
}
