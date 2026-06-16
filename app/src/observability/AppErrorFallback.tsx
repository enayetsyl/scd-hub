/**
 * The top-level ErrorBoundary fallback (MON-3, prd-observability.md §4). Shown when a
 * render crash escapes a screen (the web white-screen case especially). It is
 * deliberately SELF-CONTAINED — no Language/Auth/Theme/SafeArea context hooks — because
 * the crash may live in a provider above it; it reads only the module-level `STR` proxy
 * (safe — not a hook) and plain styles, so it renders even when the tree is broken.
 */
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { STR } from "../lib/labels";
import { reportProblem } from "./sentry";

export interface AppErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

export function AppErrorFallback({ error, resetError }: AppErrorFallbackProps): React.ReactElement {
  const [reported, setReported] = React.useState(false);

  const onReport = () => {
    // Auto-attach the crash message + boundary context (the user typed nothing).
    const ok = reportProblem(`[crash] ${error?.message ?? "render error"}`, {
      screen: "error-boundary",
    });
    setReported(ok);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.title}>{STR.errBoundaryTitle}</Text>
      <Text style={styles.body}>{STR.errBoundaryBody}</Text>
      <Pressable style={styles.primaryBtn} onPress={resetError} accessibilityLabel={STR.errBoundaryReload}>
        <Text style={styles.primaryText}>{STR.errBoundaryReload}</Text>
      </Pressable>
      <Pressable style={styles.secondaryBtn} onPress={onReport} disabled={reported} accessibilityLabel={STR.reportProblem}>
        <Text style={styles.secondaryText}>{reported ? STR.reportSent : STR.reportProblem}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#ffffff",
  },
  icon: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: "700", color: "#1a1a1a", textAlign: "center", marginBottom: 8 },
  body: { fontSize: 15, color: "#444", textAlign: "center", marginBottom: 24 },
  primaryBtn: {
    backgroundColor: "#1b5e20",
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 8,
    marginBottom: 12,
  },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryBtn: { paddingVertical: 10, paddingHorizontal: 20 },
  secondaryText: { color: "#1b5e20", fontSize: 15 },
});
