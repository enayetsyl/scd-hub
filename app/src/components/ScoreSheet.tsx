/**
 * ScoreSheet (ux-audit F1): bottom-sheet numeric marks entry for one student
 * (classtest / generic trackers). Same Modal pattern as ConfirmSheet (web
 * parity, backdrop/back-button cancel, top radius 12 — §6; the prototype's
 * 20 was off-token). Quick-pick chips (full / ~80% / ~50% / absent-0) plus a
 * localized-digit numpad; value is clamped to 0..fullMarks when a cap exists.
 */
import React from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Chip, ChipRow } from "./ui";
import { STR, bnNum } from "../lib/labels";
import { makeStyles, radius, space, typeScale, useColors } from "../theme";

const DASH = "—";

export function ScoreSheet({
  visible,
  studentName,
  rollLabel,
  fullMarks,
  initialValue,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  studentName: string;
  rollLabel: string;
  /** 0 (or negative) = uncapped (generic tracker without an assessment set). */
  fullMarks: number;
  initialValue: number | null;
  onSubmit: (score: number) => void;
  onCancel: () => void;
}): React.ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const capped = fullMarks > 0;

  const [input, setInput] = React.useState("");
  React.useEffect(() => {
    if (visible) setInput(initialValue != null ? String(initialValue) : "");
  }, [visible, initialValue]);

  function padDigit(d: string): void {
    const next = (input + d).replace(/^0+(?=\d)/, "");
    const num = parseInt(next || "0", 10);
    setInput(String(capped ? Math.min(num, fullMarks) : num));
  }

  function padBack(): void {
    setInput(input.slice(0, -1));
  }

  function confirm(): void {
    if (input === "") return;
    onSubmit(parseInt(input, 10));
  }

  // Quick picks: full / ~80% / ~50% / absent(0) — deduped; uncapped kinds only get 0.
  const quicks: Array<{ label: string; value: number }> = [];
  if (capped) {
    const seen = new Set<number>();
    for (const q of [
      { label: STR.trkFullMarks, value: fullMarks },
      { label: bnNum(Math.round(fullMarks * 0.8)), value: Math.round(fullMarks * 0.8) },
      { label: bnNum(Math.round(fullMarks * 0.5)), value: Math.round(fullMarks * 0.5) },
    ]) {
      if (q.value > 0 && !seen.has(q.value)) {
        seen.add(q.value);
        quicks.push(q);
      }
    }
  }
  quicks.push({ label: STR.trkAbsent, value: 0 });

  const keyRows: Array<Array<{ key: string; label: string; onPress: () => void; kind: "digit" | "back" | "ok" }>> = [
    ["1", "2", "3"].map((d) => ({ key: d, label: bnNum(d), onPress: () => padDigit(d), kind: "digit" as const })),
    ["4", "5", "6"].map((d) => ({ key: d, label: bnNum(d), onPress: () => padDigit(d), kind: "digit" as const })),
    ["7", "8", "9"].map((d) => ({ key: d, label: bnNum(d), onPress: () => padDigit(d), kind: "digit" as const })),
    [
      { key: "back", label: STR.trkDelete, onPress: padBack, kind: "back" as const },
      { key: "0", label: bnNum("0"), onPress: () => padDigit("0"), kind: "digit" as const },
      { key: "ok", label: STR.trkSubmit, onPress: confirm, kind: "ok" as const },
    ],
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdropWrap}>
        <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel={STR.cancel} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]}>
          <View style={styles.handle} />

          <View style={styles.headRow}>
            <View style={styles.headLeft}>
              <Text style={styles.name} numberOfLines={1}>
                {studentName}
              </Text>
              <Text style={styles.roll} numberOfLines={1}>
                {rollLabel}
              </Text>
            </View>
            <View style={styles.scoreRow}>
              <Text style={styles.scoreValue}>{input === "" ? DASH : bnNum(input)}</Text>
              {capped ? <Text style={styles.scoreFull}>/ {bnNum(fullMarks)}</Text> : null}
            </View>
          </View>

          <ChipRow>
            {quicks.map((q) => (
              <Chip key={q.label} label={q.label} onPress={() => onSubmit(q.value)} />
            ))}
          </ChipRow>

          <View style={styles.pad}>
            {keyRows.map((row, i) => (
              <View key={i} style={styles.padRow}>
                {row.map((k) => (
                  <Pressable
                    key={k.key}
                    onPress={k.onPress}
                    accessibilityRole="button"
                    accessibilityLabel={k.label}
                    accessibilityState={k.kind === "ok" ? { disabled: input === "" } : undefined}
                    style={({ pressed }) => [
                      styles.key,
                      k.kind === "back" && { backgroundColor: colors.surfaceAlt },
                      k.kind === "ok" && {
                        backgroundColor: colors.primary,
                        borderColor: colors.primary,
                        opacity: input === "" ? 0.5 : 1,
                      },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[
                        k.kind === "digit" || k.kind === "back" ? styles.keyText : styles.keyOkText,
                        k.kind === "back" && styles.keyBackText,
                      ]}
                    >
                      {k.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdropWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(4),
    gap: space(3),
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    alignSelf: "center",
  },
  headRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: space(2),
  },
  headLeft: { flexShrink: 1, minWidth: 0 },
  name: { ...typeScale.bodyStrong, color: colors.textPrimary },
  roll: { ...typeScale.secondary, color: colors.textSecondary },
  scoreRow: { flexDirection: "row", alignItems: "baseline", gap: space(1) },
  scoreValue: { ...typeScale.display, color: colors.primary },
  scoreFull: { ...typeScale.body, color: colors.textSecondary },
  pad: { gap: space(2) },
  padRow: { flexDirection: "row", gap: space(2) },
  key: {
    flex: 1,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  keyText: { ...typeScale.pageTitle, color: colors.textPrimary },
  keyBackText: { ...typeScale.chip, color: colors.textPrimary },
  keyOkText: { ...typeScale.bodyStrong, color: colors.onPrimary },
  pressed: { opacity: 0.7 },
}));
