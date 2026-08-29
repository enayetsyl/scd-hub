/**
 * SelectionTray (ux-audit F6) — sticky bottom bar that appears while questions
 * are selected: live "৫টি প্রশ্ন · ২০ নম্বর" summary, a ✕ to clear the selection,
 * and the primary [সেট তৈরি করুন] CTA. Rendered OUTSIDE the list (a sibling of
 * the FlatList) so it never scrolls away — the audit's core complaint about the
 * old top-anchored basket summary card.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "./ui";
import { STR, selectionSummaryLabel } from "../lib/labels";
import { makeStyles, radius, space, typeScale } from "../theme";

export function SelectionTray({
  count,
  totalMarks,
  examMinutes,
  onCreate,
  onClear,
}: {
  count: number;
  totalMarks: number;
  /** Basket exam minutes (QT-1, D-#574); the sheet doubles it for homework. */
  examMinutes?: number;
  onCreate: () => void;
  onClear: () => void;
}): React.ReactElement | null {
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  if (count === 0) return null;

  return (
    <View style={[styles.tray, { paddingBottom: Math.max(insets.bottom, space(3)) }]}>
      <Pressable
        onPress={onClear}
        style={styles.clear}
        accessibilityRole="button"
        accessibilityLabel={STR.qbClearSelection}
        hitSlop={4}
      >
        <Text style={styles.clearGlyph}>✕</Text>
      </Pressable>
      <Text style={styles.summary} numberOfLines={1}>
        {selectionSummaryLabel(count, totalMarks, examMinutes)}
      </Text>
      <Button title={STR.qbCreateSet} onPress={onCreate} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  tray: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    paddingHorizontal: space(4),
    paddingTop: space(3),
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  clear: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
  },
  clearGlyph: { ...typeScale.body, color: colors.textSecondary },
  summary: {
    flex: 1,
    minWidth: 0,
    ...typeScale.bodyStrong,
    color: colors.textPrimary,
  },
}));
