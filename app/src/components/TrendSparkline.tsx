/**
 * TrendSparkline (SH-4, D-#416) — a dense single-series trend for a stat card.
 *
 * `MiniLineChart` labels every point, which is right for twelve months and unreadable
 * for ninety days, so this is its dense sibling: baseline-anchored stems, no per-point
 * labels, and only the two endpoints named. Built from plain Views like its siblings —
 * `react-native-svg` is in the tree but nothing uses it, and a chart is not the place to
 * introduce a second rendering path.
 *
 * ONE SERIES, ONE HUE (magnitude over time, not identity), so there is no legend to get
 * wrong. ESTIMATED points — days reconstructed from document timestamps rather than
 * measured — are drawn in the muted ink AND named in the caption: the distinction never
 * rests on colour alone, because a reader who cannot see the difference would otherwise
 * read invented bytes as measured ones.
 */
import React from "react";
import { View } from "react-native";
import { Muted } from "./ui";
import { useColors, space } from "../theme";

export interface TrendPoint {
  /** `YYYY-MM-DD`; only the first and last are rendered as labels. */
  dateKey: string;
  /** Null renders as a gap — an unmeasured day is not a zero. */
  value: number | null;
  estimated?: boolean;
}

export function TrendSparkline({
  points,
  height = 56,
  /** Drawn as a dashed rule across the plot — the ceiling the series is heading for. */
  limit,
  accessibilityLabel,
}: {
  points: TrendPoint[];
  height?: number;
  limit?: number | null;
  accessibilityLabel?: string;
}): React.ReactElement | null {
  const colors = useColors();
  const real = points.filter((p): p is TrendPoint & { value: number } => typeof p.value === "number");
  if (real.length === 0) return null;

  // Scale to the DATA, not to the limit: at 15% of a cap, scaling to the cap would flatten
  // every movement into one indistinguishable line at the bottom. The limit rule is drawn
  // only when it is close enough to sit inside the plot.
  const maxValue = Math.max(...real.map((p) => p.value));
  const minValue = Math.min(...real.map((p) => p.value));
  // A flat series must not divide by zero, and its stems should sit mid-plot rather than
  // collapse to nothing.
  const span = maxValue - minValue || maxValue || 1;
  const floor = maxValue === minValue ? maxValue - span : minValue;
  const limitInPlot = typeof limit === "number" && limit > floor && limit <= maxValue;

  const heightFor = (v: number): number =>
    Math.max(2, Math.round(((v - floor) / (maxValue - floor || 1)) * (height - 4)) + 2);

  return (
    <View accessible accessibilityLabel={accessibilityLabel} style={{ marginTop: space(2) }}>
      <View
        style={{
          height,
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 1,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        {limitInPlot ? (
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: heightFor(limit as number),
              height: 1,
              backgroundColor: colors.warning,
              opacity: 0.6,
            }}
          />
        ) : null}
        {points.map((p, i) => {
          if (typeof p.value !== "number") {
            return <View key={i} style={{ flex: 1 }} />;
          }
          return (
            <View
              key={i}
              style={{
                flex: 1,
                height: heightFor(p.value),
                borderTopLeftRadius: 2,
                borderTopRightRadius: 2,
                backgroundColor: p.estimated ? colors.textDisabled : colors.primary,
                opacity: p.estimated ? 0.55 : 0.85,
              }}
            />
          );
        })}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
        <Muted style={{ fontSize: 10 }}>{points[0]?.dateKey.slice(5)}</Muted>
        <Muted style={{ fontSize: 10 }}>{points[points.length - 1]?.dateKey.slice(5)}</Muted>
      </View>
    </View>
  );
}
