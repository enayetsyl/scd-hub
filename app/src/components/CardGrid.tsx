/**
 * CardGrid (RP-2, D-#355) — lay a list of cards out in responsive columns on a
 * laptop instead of one full-width stack. Purely presentational; drop any set of
 * card children in and it wraps them into as many columns as the available width
 * allows (≥ `minCardWidth` each), honouring the permanent web sidebar (300px when
 * shown and not collapsed — mirrors the AppTabs drawer). One column on a phone
 * (children stack full-width — no horizontal page scroll, PRD §4).
 *
 * Gutters are done with per-cell horizontal padding + a negative container margin
 * (not `gap` percentages) so the maths is exact on web AND native.
 */
import React from "react";
import { View, useWindowDimensions } from "react-native";
import { useSidebar, DRAWER_PERMANENT_MIN_WIDTH } from "../state/SidebarContext";
import { space } from "../theme/tokens";

/** Approx page chrome subtracted before dividing into columns. */
const PAGE_PADDING = 32;
const SIDEBAR_WIDTH = 300;

export function CardGrid({
  children,
  minCardWidth = 340,
}: {
  children: React.ReactNode;
  minCardWidth?: number;
}): React.ReactElement {
  const { width } = useWindowDimensions();
  const { collapsed } = useSidebar();

  const sidebar = width >= DRAWER_PERMANENT_MIN_WIDTH && !collapsed ? SIDEBAR_WIDTH : 0;
  const avail = width - sidebar - PAGE_PADDING;
  const columns = Math.max(1, Math.floor(avail / minCardWidth));

  const items = React.Children.toArray(children);
  // One column → plain stack; the cards keep their own vertical rhythm.
  if (columns <= 1) return <>{children}</>;

  const basis = `${100 / columns}%`;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -space(1) }}>
      {items.map((child, i) => (
        <View key={i} style={{ width: basis as unknown as number, paddingHorizontal: space(1) }}>
          {child}
        </View>
      ))}
    </View>
  );
}
