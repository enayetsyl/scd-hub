/**
 * Shared UI primitives, styled per docs/ui-guidelines.md (D-#61): token colors
 * only (light + dark via useColors), Noto Sans Bengali type scale, 48dp touch
 * targets, 12dp radius, 1dp borders instead of shadows. Screens emphasise text
 * with the existing `fontWeight` idiom; the text primitives resolve that to the
 * matching font face (resolveTextStyle), so weight renders correctly on Android.
 */
import React from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
  useWindowDimensions,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
  type KeyboardTypeOptions,
} from "react-native";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSidebar, DRAWER_PERMANENT_MIN_WIDTH } from "../state/SidebarContext";
import {
  makeStyles,
  resolveTextStyle,
  useColors,
  radius,
  space,
  typeScale,
  MAX_CONTENT_WIDTH,
  MAX_WIDE_CONTENT_WIDTH,
  type ThemeColors,
} from "../theme";

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Screen({
  children,
  scroll = false,
  padded = true,
  wide = false,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  /** Web/desktop: widen the centered frame for data-grid screens (master routine grid). */
  wide?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const { collapsed } = useSidebar();
  // When the web sidebar is collapsed (D-#258), the canvas is full-width — widen the
  // content frame to fill it, so the body expands/contracts with the sidebar.
  const expanded = collapsed && width >= DRAWER_PERMANENT_MIN_WIDTH;
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
      <View style={wide || expanded ? styles.frameWide : styles.frame}>{inner}</View>
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
  const styles = useStyles();
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, styles.cardTappable, pressed && styles.pressed, style]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Divider(): React.ReactElement {
  const styles = useStyles();
  return <View style={styles.divider} />;
}

export function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.ReactElement {
  const styles = useStyles();
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
  const styles = useStyles();
  return <Text style={styles.h1}>{children}</Text>;
}
export function H2({ children }: { children: React.ReactNode }): React.ReactElement {
  const styles = useStyles();
  return <Text style={styles.h2}>{children}</Text>;
}
export function Body({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}): React.ReactElement {
  const styles = useStyles();
  return (
    <Text style={resolveTextStyle(styles.body, StyleSheet.flatten(style) as TextStyle | undefined)}>
      {children}
    </Text>
  );
}
export function Muted({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}): React.ReactElement {
  const styles = useStyles();
  return (
    <Text style={resolveTextStyle(styles.muted, StyleSheet.flatten(style) as TextStyle | undefined)}>
      {children}
    </Text>
  );
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
  const styles = useStyles();
  const colors = useColors();
  const isDisabled = disabled || loading;
  const v = buttonVariants(colors)[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: v.bg, borderColor: v.border },
        pressed && !isDisabled && { backgroundColor: v.pressedBg, borderColor: v.pressedBg },
        isDisabled && styles.btnDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isDisabled ? colors.textDisabled : v.fg} size="small" />
      ) : (
        <Text style={[styles.btnText, { color: isDisabled ? colors.textDisabled : v.fg }]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

function buttonVariants(
  c: ThemeColors,
): Record<ButtonVariant, { bg: string; fg: string; border: string; pressedBg: string }> {
  return {
    primary: { bg: c.primary, fg: c.onPrimary, border: c.primary, pressedBg: c.primaryPressed },
    secondary: { bg: "transparent", fg: c.primary, border: c.primary, pressedBg: c.primaryContainer },
    danger: { bg: c.error, fg: c.onPrimary, border: c.error, pressedBg: c.error },
    ghost: { bg: "transparent", fg: c.primary, border: "transparent", pressedBg: c.primaryContainer },
  };
}

export function Chip({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}): React.ReactElement {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
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
  const styles = useStyles();
  return <View style={styles.chipRow}>{children}</View>;
}

type BadgeTone = "brand" | "ok" | "warn" | "danger" | "muted" | "info" | "gold";

export function Badge({
  text,
  tone = "muted",
}: {
  text: string;
  tone?: BadgeTone;
}): React.ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const t = badgeTones(colors)[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.badgeText, { color: t.fg }]}>{text}</Text>
    </View>
  );
}

/** §7 status-badge mapping: container fill + the matching `on…` text token. */
function badgeTones(c: ThemeColors): Record<BadgeTone, { bg: string; fg: string }> {
  return {
    brand: { bg: c.primaryContainer, fg: c.onPrimaryContainer },
    ok: { bg: c.primaryContainer, fg: c.onPrimaryContainer },
    warn: { bg: c.warningContainer, fg: c.warning },
    danger: { bg: c.errorContainer, fg: c.onErrorContainer },
    muted: { bg: c.surfaceAlt, fg: c.textSecondary },
    info: { bg: c.infoContainer, fg: c.info },
    gold: { bg: c.goldContainer, fg: c.onGoldContainer },
  };
}

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
  error,
  helper,
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
  error?: string;
  helper?: string;
}): React.ReactElement {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          !editable && styles.inputDisabled,
          !!error && styles.inputError,
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        editable={editable}
      />
      {error ? (
        <Text style={styles.fieldError}>⚠ {error}</Text>
      ) : helper ? (
        <Text style={styles.fieldHelper}>{helper}</Text>
      ) : null}
    </View>
  );
}

/** A tap-to-expand dropdown styled like Field. Options list inline below the
 *  trigger (scrolls past ~6 rows); picking one closes the menu. */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  emptyText,
  helper,
}: {
  label?: string;
  value: T | null;
  options: { label: string; value: T; hint?: string }[];
  onChange: (v: T) => void;
  placeholder?: string;
  emptyText?: string;
  helper?: string;
}): React.ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.value === value) ?? null;
  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <Pressable
        onPress={() => setOpen((o) => !o)}
        hitSlop={4}
        style={({ pressed }) => [styles.select, pressed && styles.pressed]}
      >
        <Text style={[styles.selectText, !selected && { color: colors.textSecondary }]} numberOfLines={1}>
          {selected ? selected.label : placeholder ?? ""}
        </Text>
        <Text style={styles.selectChevron}>{open ? "▴" : "▾"}</Text>
      </Pressable>
      {open ? (
        options.length === 0 ? (
          <View style={styles.selectMenu}>
            <Text style={styles.selectEmpty}>{emptyText ?? placeholder ?? ""}</Text>
          </View>
        ) : (
          <ScrollView style={styles.selectMenu} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {options.map((o) => {
              const isSel = o.value === value;
              return (
                <Pressable
                  key={o.value}
                  onPress={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.selectOption,
                    isSel && styles.selectOptionOn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.selectOptionText, isSel && styles.selectOptionTextOn]} numberOfLines={1}>
                    {o.label}
                  </Text>
                  {o.hint ? (
                    <Text style={styles.selectOptionHint} numberOfLines={1}>
                      {o.hint}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        )
      ) : null}
      {helper ? <Text style={styles.fieldHelper}>{helper}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function Loader({ label }: { label?: string }): React.ReactElement {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
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
  const styles = useStyles();
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
  const styles = useStyles();
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText}>⚠ {message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.errorRetry} hitSlop={12} accessibilityLabel="আবার চেষ্টা করুন">
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
  tone?: "ok" | "warn" | "danger" | "info";
}): React.ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const map = {
    ok: { bg: colors.primaryContainer, fg: colors.onPrimaryContainer },
    warn: { bg: colors.warningContainer, fg: colors.warning },
    danger: { bg: colors.errorContainer, fg: colors.onErrorContainer },
    info: { bg: colors.infoContainer, fg: colors.info },
  } as const;
  const t = map[tone];
  return (
    <View style={[styles.notice, { backgroundColor: t.bg }]}>
      <Text style={[styles.noticeText, { color: t.fg }]}>{message}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles (token-driven; created per color scheme)
// ---------------------------------------------------------------------------

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  // §6 web/desktop: the phone layout centered at max 720dp, bg filling the rest.
  frame: { flex: 1, width: "100%", maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center" },
  frameWide: { flex: 1, width: "100%", maxWidth: MAX_WIDE_CONTENT_WIDTH, alignSelf: "center" },
  flex: { flex: 1 },
  padded: { padding: space(4) },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space(6) },
  pressed: { opacity: 0.7 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(4),
    marginBottom: space(3),
  },
  cardTappable: { minHeight: 56, justifyContent: "center" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: space(3) },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: space(2),
    gap: space(3),
  },
  rowLabel: { ...typeScale.secondary, color: colors.textSecondary },
  rowValue: {
    ...typeScale.secondary,
    fontFamily: typeScale.bodyStrong.fontFamily,
    color: colors.textPrimary,
    flexShrink: 1,
    textAlign: "right",
  },

  h1: { ...typeScale.pageTitle, color: colors.textPrimary, marginBottom: space(1) },
  h2: { ...typeScale.sectionTitle, color: colors.textPrimary, marginBottom: space(1) },
  body: { ...typeScale.body, color: colors.textPrimary },
  muted: { ...typeScale.secondary, color: colors.textSecondary },

  btn: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space(4),
    paddingVertical: space(2),
  },
  btnText: typeScale.button,
  btnDisabled: { backgroundColor: colors.surfaceAlt, borderColor: colors.surfaceAlt },

  chip: {
    minHeight: 36,
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space(3),
    paddingVertical: space(1),
    marginRight: space(2),
    marginBottom: space(2),
  },
  chipOn: { backgroundColor: colors.primaryContainer, borderColor: colors.primary },
  chipOff: { backgroundColor: colors.surface, borderColor: colors.border },
  chipTextOn: { ...typeScale.chip, color: colors.onPrimaryContainer },
  chipTextOff: { ...typeScale.chip, color: colors.textPrimary },
  chipRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },

  badge: {
    borderRadius: radius.sm,
    paddingHorizontal: space(2),
    paddingVertical: space(1),
    alignSelf: "flex-start",
  },
  badgeText: typeScale.chip,

  fieldWrap: { marginBottom: space(4) },
  fieldLabel: { ...typeScale.secondary, color: colors.textSecondary, marginBottom: space(1) },
  fieldHelper: { ...typeScale.secondary, color: colors.textSecondary, marginTop: space(1) },
  fieldError: { ...typeScale.secondary, color: colors.error, marginTop: space(1) },
  input: {
    minHeight: 48,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    ...typeScale.body,
    color: colors.textPrimary,
  },
  inputMultiline: { minHeight: 120, textAlignVertical: "top" },
  inputDisabled: { backgroundColor: colors.surfaceAlt, color: colors.textSecondary },
  inputError: { borderColor: colors.error },

  select: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    gap: space(2),
  },
  selectText: { ...typeScale.body, color: colors.textPrimary, flex: 1 },
  selectChevron: { ...typeScale.body, color: colors.textSecondary },
  selectMenu: {
    marginTop: space(1),
    maxHeight: 260,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  selectEmpty: { ...typeScale.secondary, color: colors.textSecondary, padding: space(3) },
  selectOption: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  selectOptionOn: { backgroundColor: colors.primaryContainer },
  selectOptionText: { ...typeScale.body, color: colors.textPrimary },
  selectOptionTextOn: { color: colors.onPrimaryContainer, fontFamily: typeScale.bodyStrong.fontFamily },
  selectOptionHint: { ...typeScale.secondary, color: colors.textSecondary },

  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.errorContainer,
    borderRadius: radius.md,
    padding: space(3),
    marginBottom: space(3),
    gap: space(2),
  },
  errorText: { ...typeScale.secondary, color: colors.onErrorContainer, flex: 1 },
  errorRetry: { paddingHorizontal: space(2) },
  errorRetryText: { ...typeScale.sectionTitle, color: colors.onErrorContainer },

  notice: { borderRadius: radius.md, padding: space(3), marginBottom: space(3) },
  noticeText: { ...typeScale.secondary, fontFamily: typeScale.chip.fontFamily },
}));
