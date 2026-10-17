/**
 * FoldCard (D-#758) — the Today screens' summary-first card. Owner ask 2026-10-17:
 * Today should show every card as a summary first, and tapping a card shows its details.
 * The D-#316 admin cards already worked this way, but the self-contained cards stacked
 * above them (class-test scripts, homework never issued, tasks, …) rendered their full
 * lists and pushed everything below them off the screen.
 *
 *   header   — title · optional `aside` (a count badge) · chevron. Always shown.
 *   summary  — a line or a row of badges under the header. Always shown. Tapping it
 *              toggles too; an interactive child (a badge that deep-links) keeps its
 *              own tap, because the innermost Pressable wins.
 *   children — the details. Mounted ONLY while open, so a long list costs nothing
 *              until someone asks for it.
 *
 * Every card starts closed. Opening one is remembered for the rest of the session
 * (module-level, keyed by `id`), so a refetch, a pull-to-refresh or a trip into a
 * detail screen and back does not slam the card shut under the user.
 */
import React from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { Body, Card } from "./ui";
import { Icon } from "./Icon";
import { STR } from "../lib/labels";
import { useColors } from "../theme";
import { space } from "../theme/tokens";

const openIds = new Set<string>();

export function FoldCard({
  id,
  title,
  icon,
  aside,
  summary,
  children,
  style,
}: {
  /** Stable, unique per card instance — remembers open/closed for the session. */
  id: string;
  title: React.ReactNode;
  /** Leading glyph (an Icon or an emoji Text). */
  icon?: React.ReactNode;
  /** Non-interactive, at the right of the header — typically the count badge. */
  aside?: React.ReactNode;
  summary?: React.ReactNode;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const colors = useColors();
  const [open, setOpen] = React.useState(() => openIds.has(id));
  const toggle = (): void => {
    if (open) openIds.delete(id);
    else openIds.add(id);
    setOpen(!open);
  };

  return (
    <Card style={style}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityHint={open ? STR.foldHideDetails : STR.foldShowDetails}
        style={({ pressed }) => [pressed && { opacity: 0.7 }]}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), minHeight: 32 }}>
          {icon}
          {typeof title === "string" ? <Body style={{ fontWeight: "700", flex: 1 }}>{title}</Body> : <View style={{ flex: 1 }}>{title}</View>}
          {aside}
          <Icon name={open ? "chevron-down" : "chevron-right"} size={20} color={colors.textSecondary} />
        </View>
        {summary ? <View style={{ marginTop: space(1) }}>{summary}</View> : null}
      </Pressable>
      {open ? <View style={{ marginTop: space(2) }}>{children}</View> : null}
    </Card>
  );
}
