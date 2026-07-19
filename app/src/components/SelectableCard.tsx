/**
 * SelectableCard (ux-audit F6/F8) — a Card with a leading 48dp checkbox and a
 * selected surface state (primaryContainer fill + primary border, the app-wide
 * selection idiom). Tap the BODY = onPress (open preview); tap the CHECKBOX =
 * onToggle (select). The checkbox exposes accessibilityRole="checkbox" +
 * accessibilityState={{checked}} so TalkBack can tell selection state (F8).
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { STR } from "../lib/labels";
import { makeStyles, radius, space, typeScale } from "../theme";

export function SelectableCard({
  selected,
  onToggle,
  onPress,
  children,
}: {
  selected: boolean;
  onToggle: () => void;
  onPress: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const styles = useStyles();

  return (
    <View style={[styles.card, selected && styles.cardSelected]}>
      <Pressable
        onPress={onToggle}
        style={styles.checkbox}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={selected ? STR.qbDeselectQuestion : STR.qbSelectQuestion}
        hitSlop={4}
      >
        <View style={[styles.box, selected && styles.boxChecked]}>
          {selected ? <Text style={styles.tick}>✓</Text> : null}
        </View>
      </Pressable>
      <Pressable onPress={onPress} style={styles.body} accessibilityRole="button">
        {children}
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    marginBottom: space(3),
  },
  cardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryContainer,
  },
  checkbox: {
    width: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  boxChecked: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  tick: { ...typeScale.chip, color: colors.onPrimary, lineHeight: 20 },
  body: {
    flex: 1,
    minWidth: 0,
    paddingVertical: space(3),
    paddingRight: space(4),
    minHeight: 56,
  },
}));
