/**
 * PieChart — a small pie with a legend that names every slice with its count and
 * share. The first SVG chart in the app (the Mini* charts are View-based): a pie
 * cannot be drawn from rectangles. `react-native-svg` is already a declared
 * dependency, so it is autolinked into the native builds and renders on web.
 *
 * ACCESSIBILITY: colour never carries meaning alone — the legend repeats every
 * slice as text, and the chart takes an `accessibilityLabel`.
 */
import React from "react";
import { View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { Body, Muted } from "./ui";
import { bnNum } from "../lib/labels";
import { space, useColors } from "../theme";

export interface PieSlice {
  label: string;
  value: number;
  color: string;
}

/** SVG arc path for a slice from `start` to `end` (fractions of a turn, 0 = 12 o'clock). */
function slicePath(cx: number, cy: number, r: number, start: number, end: number): string {
  const point = (f: number) => {
    const a = 2 * Math.PI * f - Math.PI / 2;
    return `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
  };
  const large = end - start > 0.5 ? 1 : 0;
  return `M ${cx} ${cy} L ${point(start)} A ${r} ${r} 0 ${large} 1 ${point(end)} Z`;
}

export function PieChart({
  title,
  slices,
  size = 132,
  emptyText,
  accessibilityLabel,
}: {
  title?: string;
  slices: PieSlice[];
  size?: number;
  emptyText: string;
  accessibilityLabel: string;
}): React.ReactElement {
  const colors = useColors();
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = size / 2;
  const shown = slices.filter((s) => s.value > 0);

  let cursor = 0;
  const paths = shown.map((s) => {
    const start = cursor;
    cursor += s.value / total;
    return { ...s, start, end: cursor };
  });

  return (
    <View style={{ gap: space(2) }} accessibilityLabel={accessibilityLabel}>
      {title ? <Body style={{ fontWeight: "700" }}>{title}</Body> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(4) }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {total === 0 ? (
            <Circle cx={r} cy={r} r={r - 1} fill="none" stroke={colors.border} strokeWidth={2} />
          ) : paths.length === 1 ? (
            // A single 100% slice: an arc from 0 to 1 degenerates, so draw the disc.
            <Circle cx={r} cy={r} r={r} fill={paths[0].color} />
          ) : (
            paths.map((p) => <Path key={p.label} d={slicePath(r, r, r, p.start, p.end)} fill={p.color} />)
          )}
        </Svg>
        <View style={{ gap: space(1), flexShrink: 1 }}>
          {total === 0 ? <Muted>{emptyText}</Muted> : null}
          {slices.map((s) => (
            <View key={s.label} style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
              <View style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: s.color }} />
              <Muted style={{ flexShrink: 1 }}>
                {s.label}: {bnNum(s.value)}
                {total > 0 ? ` (${bnNum(Math.round((s.value / total) * 100))}%)` : ""}
              </Muted>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
