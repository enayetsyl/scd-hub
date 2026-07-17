/**
 * FilterBar (ux-audit F4/F5) — a horizontal strip of ACTIVE filter chips, each
 * with a ✕ to clear just that filter, plus the [ফিল্টার] button (with a count
 * Badge) that opens the FilterSheet. Chip/badge text uses the shared tokens
 * (chip = 14sp — never below the 12sp floor; the published design-system page
 * had an 11px badge, deliberately not copied).
 */
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Badge, Button } from "./ui";
import { STR } from "../lib/labels";
import { makeStyles, radius, space, typeScale } from "../theme";

export interface FilterChip {
  key: string;
  label: string;
}

export function FilterBar({
  chips,
  count,
  onRemove,
  onOpen,
}: {
  /** Active filters, rendered as removable chips. */
  chips: FilterChip[];
  /** Active-filter count for the button badge (0 hides the badge). */
  count: number;
  onRemove: (key: string) => void;
  onOpen: () => void;
}): React.ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.row}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {chips.map((chip) => (
          <Pressable
            key={chip.key}
            onPress={() => onRemove(chip.key)}
            style={styles.chip}
            accessibilityRole="button"
            accessibilityLabel={`${chip.label} — ${STR.remove}`}
          >
            <Text style={styles.chipLabel} numberOfLines={1}>
              {chip.label}
            </Text>
            <Text style={styles.chipX}>✕</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.filterBtn}>
        <Button title={STR.filters} variant="secondary" onPress={onOpen} />
        {count > 0 ? (
          <View style={styles.badgeWrap} pointerEvents="none">
            <Badge text={String(count)} tone="brand" />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
  },
  scroll: { flex: 1, minWidth: 0 },
  chips: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingVertical: space(1),
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    minHeight: 36,
    paddingHorizontal: space(3),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryContainer,
    maxWidth: 220,
  },
  chipLabel: { ...typeScale.chip, color: colors.onPrimaryContainer, flexShrink: 1 },
  chipX: { ...typeScale.chip, color: colors.onPrimaryContainer },
  filterBtn: { position: "relative" },
  badgeWrap: { position: "absolute", top: -space(1), right: -space(1) },
}));
