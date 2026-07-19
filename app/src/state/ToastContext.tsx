/**
 * Global toast (UX-1, house rule R-Feedback — docs/prd-ux-improvements.md §3/§4.1):
 * every mutation outcome surfaces via `useToast().show(...)`, so the result is
 * visible even when Submit sits at the bottom of a long scrolled form. Inline
 * `Notice` remains only for persistent state, never as the sole submit feedback.
 *
 * Bottom-anchored, safe-area-aware pill; auto-dismisses after 3.5s; tap to
 * dismiss; max one visible (queue length 1 — newest wins). Token colors only.
 * Lives in `state/` (like SidebarContext) with a no-op default so `useToast()`
 * is safe even outside the provider (e.g. an error fallback).
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles, radius, space, typeScale, useColors } from "../theme";

export type ToastTone = "ok" | "danger" | "info";

/** Optional single action (e.g. আনডু) — pressing it dismisses the toast. */
export type ToastAction = { label: string; onPress: () => void };
export type ToastOptions = { action?: ToastAction; durationMs?: number };

type ToastState = { show: (message: string, tone?: ToastTone, opts?: ToastOptions) => void };

const ToastContext = React.createContext<ToastState>({ show: () => {} });

const TOAST_DISMISS_MS = 3500;

export function ToastProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [toast, setToast] = React.useState<{ message: string; tone: ToastTone; action?: ToastAction } | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = React.useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setToast(null);
  }, []);

  const show = React.useCallback((message: string, tone: ToastTone = "ok", opts?: ToastOptions) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, tone, action: opts?.action });
    timer.current = setTimeout(() => {
      timer.current = null;
      setToast(null);
    }, opts?.durationMs ?? TOAST_DISMISS_MS);
  }, []);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const value = React.useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      <View style={{ flex: 1 }}>
        {children}
        {toast ? <ToastPill message={toast.message} tone={toast.tone} action={toast.action} onPress={dismiss} /> : null}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  return React.useContext(ToastContext);
}

function ToastPill({
  message,
  tone,
  action,
  onPress,
}: {
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  onPress: () => void;
}): React.ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  // §7 status mapping (same as Notice): container fill + the matching `on…` text token.
  const map = {
    ok: { bg: colors.primaryContainer, fg: colors.onPrimaryContainer },
    danger: { bg: colors.errorContainer, fg: colors.onErrorContainer },
    info: { bg: colors.infoContainer, fg: colors.info },
  } as const;
  const t = map[tone];
  return (
    <View pointerEvents="box-none" style={[styles.host, { paddingBottom: insets.bottom + space(6) }]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={({ pressed }) => [styles.pill, { backgroundColor: t.bg }, pressed && styles.pressed]}
      >
        <View style={styles.pillRow}>
          <Text style={[styles.pillText, { color: t.fg }, action ? styles.pillTextWithAction : null]}>{message}</Text>
          {action ? (
            <Pressable
              onPress={() => {
                onPress(); // dismiss first — the action may re-show a toast
                action.onPress();
              }}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
            >
              <Text style={[styles.actionText, { color: t.fg }]}>{action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  host: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
  },
  pill: {
    minHeight: 48,
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space(4),
    paddingVertical: space(2),
    marginHorizontal: space(4),
    maxWidth: 520,
  },
  pillRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  pillText: { ...typeScale.secondary, fontFamily: typeScale.chip.fontFamily },
  pillTextWithAction: { flexShrink: 1 },
  actionBtn: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: space(2),
  },
  actionText: { ...typeScale.bodyStrong },
  pressed: { opacity: 0.7 },
}));
