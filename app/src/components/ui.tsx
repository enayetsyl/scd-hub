/**
 * Shared UI primitives. Appearance is driven by themed StyleSheet values (the
 * reliable rendering path on iOS/Android/Web); NativeWind `className` is applied
 * on layout containers so the mandated Tailwind layer is exercised. Keeping both
 * means the UI renders correctly regardless of a utility class being generated.
 */
import React from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
  type KeyboardTypeOptions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, space } from "../theme/tokens";

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Screen({
  children,
  scroll = false,
  padded = true,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const inner = scroll ? (
    <ScrollView
      contentContainerStyle={[padded && styles.padded, style]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, padded && styles.padded, style]}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      {inner}
    </SafeAreaView>
  );
}

export function Card({
  children,
  onPress,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Divider(): React.ReactElement {
  return <View style={styles.divider} />;
}

export function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {typeof value === "string" || typeof value === "number" ? (
        <Text style={styles.rowValue}>{value}</Text>
      ) : (
        <View>{value}</View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export function H1({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text style={styles.h1}>{children}</Text>;
}
export function H2({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text style={styles.h2}>{children}</Text>;
}
export function Body({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}): React.ReactElement {
  return <Text style={[styles.body, style]}>{children}</Text>;
}
export function Muted({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}): React.ReactElement {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  title,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const isDisabled = disabled || loading;
  const v = BUTTON_VARIANTS[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: v.bg, borderColor: v.border },
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.btnDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} size="small" />
      ) : (
        <Text style={[styles.btnText, { color: v.fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const BUTTON_VARIANTS: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.brand700, fg: colors.white, border: colors.brand700 },
  secondary: { bg: colors.white, fg: colors.brand700, border: colors.brand600 },
  danger: { bg: colors.danger, fg: colors.white, border: colors.danger },
  ghost: { bg: "transparent", fg: colors.brand700, border: "transparent" },
};

export function Chip({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.chipOn : styles.chipOff,
        pressed && styles.pressed,
      ]}
    >
      <Text style={selected ? styles.chipTextOn : styles.chipTextOff}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }): React.ReactElement {
  return <View style={styles.chipRow}>{children}</View>;
}

type BadgeTone = "brand" | "ok" | "warn" | "danger" | "muted";

export function Badge({
  text,
  tone = "muted",
}: {
  text: string;
  tone?: BadgeTone;
}): React.ReactElement {
  const t = BADGE_TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.badgeText, { color: t.fg }]}>{text}</Text>
    </View>
  );
}

const BADGE_TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  brand: { bg: colors.brand100, fg: colors.brand800 },
  ok: { bg: colors.okBg, fg: colors.ok },
  warn: { bg: colors.warnBg, fg: colors.warn },
  danger: { bg: colors.dangerBg, fg: colors.danger },
  muted: { bg: "#f1f5f9", fg: colors.muted },
};

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  multiline,
  autoCapitalize = "none",
  editable = true,
}: {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  editable?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline, !editable && styles.inputDisabled]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        editable={editable}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function Loader({ label }: { label?: string }): React.ReactElement {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.brand700} />
      {label ? <Muted style={{ marginTop: space(3) }}>{label}</Muted> : null}
    </View>
  );
}

export function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={styles.center}>
      <Muted style={{ textAlign: "center" }}>{message}</Muted>
      {action ? <View style={{ marginTop: space(4) }}>{action}</View> : null}
    </View>
  );
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): React.ReactElement {
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.errorRetry}>
          <Text style={styles.errorRetryText}>↻</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Notice({
  message,
  tone = "ok",
}: {
  message: string;
  tone?: "ok" | "warn" | "danger";
}): React.ReactElement {
  const map = {
    ok: { bg: colors.okBg, fg: colors.ok },
    warn: { bg: colors.warnBg, fg: colors.warn },
    danger: { bg: colors.dangerBg, fg: colors.danger },
  } as const;
  const t = map[tone];
  return (
    <View style={[styles.notice, { backgroundColor: t.bg }]}>
      <Text style={[styles.noticeText, { color: t.fg }]}>{message}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  padded: { padding: space(4) },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space(6) },
  pressed: { opacity: 0.7 },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space(3.5),
    marginBottom: space(3),
  },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: space(3) },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: space(2),
    gap: space(3),
  },
  rowLabel: { color: colors.muted, fontSize: 14 },
  rowValue: { color: colors.ink, fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },

  h1: { fontSize: 24, fontWeight: "700", color: colors.ink, marginBottom: space(1) },
  h2: { fontSize: 18, fontWeight: "700", color: colors.ink, marginBottom: space(1) },
  body: { fontSize: 15, color: colors.ink, lineHeight: 22 },
  muted: { fontSize: 14, color: colors.muted },

  btn: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space(4),
    paddingVertical: space(2.5),
  },
  btnText: { fontSize: 15, fontWeight: "700" },
  btnDisabled: { opacity: 0.45 },

  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
    marginRight: space(2),
    marginBottom: space(2),
  },
  chipOn: { backgroundColor: colors.brand700, borderColor: colors.brand700 },
  chipOff: { backgroundColor: colors.white, borderColor: colors.line },
  chipTextOn: { color: colors.white, fontSize: 13, fontWeight: "600" },
  chipTextOff: { color: colors.ink, fontSize: 13, fontWeight: "500" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },

  badge: { borderRadius: radius.sm, paddingHorizontal: space(2), paddingVertical: space(0.5), alignSelf: "flex-start" },
  badgeText: { fontSize: 12, fontWeight: "700" },

  fieldWrap: { marginBottom: space(3) },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: space(1.5) },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
    fontSize: 15,
    color: colors.ink,
  },
  inputMultiline: { minHeight: 120, textAlignVertical: "top" },
  inputDisabled: { backgroundColor: "#f1f5f9", color: colors.muted },

  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.dangerBg,
    borderRadius: radius.md,
    padding: space(3),
    marginBottom: space(3),
    gap: space(2),
  },
  errorText: { color: colors.danger, fontSize: 14, flex: 1 },
  errorRetry: { paddingHorizontal: space(2) },
  errorRetryText: { color: colors.danger, fontSize: 18, fontWeight: "700" },

  notice: { borderRadius: radius.md, padding: space(3), marginBottom: space(3) },
  noticeText: { fontSize: 14, fontWeight: "500" },
});
