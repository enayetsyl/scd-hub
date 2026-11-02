/**
 * InsightCharts — the three chart forms of "What moves the marks" (D-#905), in the
 * AxisBarChart idiom: react-native-svg, theme ink for every text, a value printed on
 * every bar (the report's identity is never colour alone), each chart measures its own
 * width.
 *
 *   HBarChart    one bar per measure, label at left, value at the end — strength / effect
 *   ColumnChart  groups of 1–3 columns on a 0–100 axis, optional dashed divider — thirds, bands
 *   ScatterChart one dot per child + dashed least-squares line; tap a dot to read it
 *
 * Series colours are the dataviz reference categorical slots 1–3, validated against the
 * app's own light (#FFFFFF) and dark (#1A211D) surfaces; the light aqua's sub-3:1 contrast
 * is why every column carries its printed value.
 */
import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import Svg, { Circle, Line, Rect, Text as SvgText } from "react-native-svg";
import { Muted } from "./ui";
import { bnNum } from "../lib/labels";
import { darkColors, space, useColors } from "../theme";

/** Categorical slots 1–3 (blue, orange, aqua), stepped per scheme. */
export function useSeriesColors(): [string, string, string] {
  const dark = useColors().bg === darkColors.bg;
  return dark ? ["#3987e5", "#d95926", "#199e70"] : ["#2a78d6", "#eb6834", "#1baf7a"];
}

// ---------------------------------------------------------------------------
// Horizontal bars
// ---------------------------------------------------------------------------

export interface HBarDatum {
  label: string;
  value: number;
  valueLabel: string;
  /** false paints the bar neutral grey (e.g. "not distinguishable from chance"). */
  strong?: boolean;
  note?: string;
}

export function HBarChart({
  data,
  max,
  accessibilityLabel,
}: {
  data: HBarDatum[];
  max: number;
  accessibilityLabel: string;
}): React.ReactElement {
  const colors = useColors();
  const [series] = useSeriesColors();
  return (
    <View accessibilityLabel={accessibilityLabel} style={{ gap: space(2) }}>
      {data.map((d) => {
        const w = Math.max(1.5, Math.min(100, (Math.max(0, d.value) / max) * 100));
        return (
          <View key={d.label} style={{ gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
              <Text
                style={{ width: 128, fontSize: 13, color: colors.textPrimary, fontWeight: d.strong === false ? "400" : "600" }}
                numberOfLines={2}
              >
                {d.label}
              </Text>
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space(2) }}>
                <View style={{ flex: 1, height: 16, justifyContent: "center" }}>
                  <View
                    style={{
                      width: `${w}%`,
                      height: 16,
                      borderRadius: 4,
                      backgroundColor: d.strong === false ? colors.textDisabled : series,
                    }}
                  />
                </View>
                <Text style={{ minWidth: 44, fontSize: 13, fontWeight: "700", color: colors.textPrimary, textAlign: "right" }}>
                  {d.valueLabel}
                </Text>
              </View>
            </View>
            {d.note ? <Muted style={{ fontSize: 11, marginLeft: 128 + space(2) }}>{d.note}</Muted> : null}
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Grouped columns on a 0–100 axis
// ---------------------------------------------------------------------------

export interface ColumnGroup {
  label: string;
  /** Printed above the group's columns (e.g. "১০ জন"). */
  caption?: string;
  bars: Array<{ value: number | null; color: string }>;
}

const TICKS = [0, 25, 50, 75, 100];
const LEFT = 34;
const TOP = 30;
const BOTTOM = 26;

export function ColumnChart({
  groups,
  legend,
  divider,
  height = 220,
  accessibilityLabel,
}: {
  groups: ColumnGroup[];
  legend?: Array<{ label: string; color: string }>;
  /** A dashed vertical line BEFORE this group index, with a label. */
  divider?: { before: number; label: string } | null;
  height?: number;
  accessibilityLabel: string;
}): React.ReactElement {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const plotW = Math.max(0, width - LEFT - 8);
  const plotH = height - TOP - BOTTOM;
  const y = (v: number) => TOP + plotH - (Math.max(0, Math.min(100, v)) / 100) * plotH;
  const slot = groups.length ? plotW / groups.length : 0;
  const per = Math.max(1, ...groups.map((g) => g.bars.length));
  const barW = Math.min(per === 1 ? 40 : 30, (slot * 0.8) / per - 2);

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ width: "100%", gap: space(2) }}
    >
      {legend && legend.length > 1 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3) }}>
          {legend.map((l) => (
            <View key={l.label} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 11, height: 11, borderRadius: 2, backgroundColor: l.color }} />
              <Muted style={{ fontSize: 12 }}>{l.label}</Muted>
            </View>
          ))}
        </View>
      ) : null}
      {width > 0 ? (
        <Svg width={width} height={height}>
          {TICKS.map((t) => (
            <React.Fragment key={t}>
              <Line x1={LEFT} x2={LEFT + plotW} y1={y(t)} y2={y(t)} stroke={colors.border} strokeWidth={1} />
              <SvgText x={LEFT - 6} y={y(t) + 4} fontSize={11} fill={colors.textSecondary} textAnchor="end">
                {bnNum(t)}
              </SvgText>
            </React.Fragment>
          ))}
          {groups.map((g, gi) => {
            const gx = LEFT + slot * gi;
            const used = g.bars.length * (barW + 2) - 2;
            const top = Math.min(...g.bars.map((b) => (b.value == null ? TOP + plotH : y(b.value))));
            return (
              <React.Fragment key={`${g.label}-${gi}`}>
                {g.bars.map((b, bi) => {
                  if (b.value == null) return null;
                  const x = gx + (slot - used) / 2 + bi * (barW + 2);
                  const by = y(b.value);
                  return (
                    <React.Fragment key={bi}>
                      <Rect x={x} y={by} width={barW} height={Math.max(0, TOP + plotH - by)} fill={b.color} rx={3} />
                      <SvgText x={x + barW / 2} y={by - 4} fontSize={11} fontWeight="700" fill={colors.textPrimary} textAnchor="middle">
                        {bnNum(Math.round(b.value))}
                      </SvgText>
                    </React.Fragment>
                  );
                })}
                {g.caption ? (
                  <SvgText x={gx + slot / 2} y={Math.max(11, top - 18)} fontSize={10} fill={colors.textSecondary} textAnchor="middle">
                    {g.caption}
                  </SvgText>
                ) : null}
                <SvgText x={gx + slot / 2} y={height - 8} fontSize={11} fill={colors.textSecondary} textAnchor="middle">
                  {g.label}
                </SvgText>
              </React.Fragment>
            );
          })}
          {divider ? (
            <Line
              x1={LEFT + slot * divider.before}
              x2={LEFT + slot * divider.before}
              y1={TOP - 8}
              y2={TOP + plotH}
              stroke={colors.error}
              strokeWidth={2}
              strokeDasharray="4 3"
            />
          ) : null}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
      {divider ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
          <View style={{ width: 2, height: 14, borderLeftWidth: 2, borderStyle: "dashed", borderColor: colors.error }} />
          <Muted style={{ fontSize: 12 }}>{divider.label}</Muted>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Scatter
// ---------------------------------------------------------------------------

export interface ScatterDatum {
  x: number;
  y: number;
  /** Read out when the dot is tapped. */
  caption: string;
}

export function ScatterChart({
  data,
  xMin = 0,
  xLabel,
  height = 240,
  accessibilityLabel,
}: {
  data: ScatterDatum[];
  xMin?: number;
  xLabel: string;
  height?: number;
  accessibilityLabel: string;
}): React.ReactElement {
  const colors = useColors();
  const [series] = useSeriesColors();
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const L = 34;
  const T = 10;
  const B = 24;
  // Room for the last x tick ("১০০%") centred on the right edge.
  const plotW = Math.max(0, width - L - 22);
  const plotH = height - T - B;
  const X = (v: number) => L + ((Math.max(xMin, Math.min(100, v)) - xMin) / (100 - xMin)) * plotW;
  const Y = (v: number) => T + plotH - (Math.max(0, Math.min(100, v)) / 100) * plotH;

  // Least-squares trend over the plotted points.
  let trend: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (data.length >= 3) {
    const mx = data.reduce((s, d) => s + d.x, 0) / data.length;
    const my = data.reduce((s, d) => s + d.y, 0) / data.length;
    let num = 0;
    let den = 0;
    for (const d of data) {
      num += (d.x - mx) * (d.y - my);
      den += (d.x - mx) ** 2;
    }
    if (den > 0) {
      const slope = num / den;
      const lo = Math.max(xMin, Math.min(...data.map((d) => d.x)));
      const hi = Math.max(...data.map((d) => d.x));
      trend = { x1: lo, y1: my + slope * (lo - mx), x2: hi, y2: my + slope * (hi - mx) };
    }
  }
  const xTicks: number[] = [];
  for (let v = Math.ceil(xMin / 20) * 20; v <= 100; v += 20) xTicks.push(v);

  const REACH = 18;
  const nearest = (px: number, py: number): number | null => {
    let best: number | null = null;
    let bestD = REACH * REACH;
    data.forEach((d, i) => {
      const dd = (X(d.x) - px) ** 2 + (Y(d.y) - py) ** 2;
      if (dd <= bestD) {
        bestD = dd;
        best = i;
      }
    });
    return best === picked ? null : best;
  };

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ width: "100%", gap: space(1) }}
    >
      {width > 0 ? (
        // One tap target for the whole plot: the nearest dot within reach of the finger wins.
        // (react-native-svg's per-shape onPress does not fire on web, and a 4.4 dot is too
        // small to hit anyway.) The SVG ignores pointers so the tap is relative to the plot:
        // locationX/Y on native; on web the press carries the DOM click, whose offsetX/Y are.
        <Pressable
          accessibilityLabel={accessibilityLabel}
          onPress={(e) => {
            const n = e.nativeEvent as unknown as { locationX?: number; locationY?: number; offsetX?: number; offsetY?: number };
            const px = n.locationX ?? n.offsetX;
            const py = n.locationY ?? n.offsetY;
            if (px != null && py != null) setPicked(nearest(px, py));
          }}
        >
        <View pointerEvents="none">
        <Svg width={width} height={height}>
          {TICKS.map((t) => (
            <React.Fragment key={`y${t}`}>
              <Line x1={L} x2={L + plotW} y1={Y(t)} y2={Y(t)} stroke={colors.border} strokeWidth={1} />
              <SvgText x={L - 6} y={Y(t) + 4} fontSize={10} fill={colors.textSecondary} textAnchor="end">
                {bnNum(t)}
              </SvgText>
            </React.Fragment>
          ))}
          {xTicks.map((t) => (
            <SvgText key={`x${t}`} x={X(t)} y={height - 8} fontSize={10} fill={colors.textSecondary} textAnchor="middle">
              {`${bnNum(t)}%`}
            </SvgText>
          ))}
          {trend ? (
            <Line
              x1={X(trend.x1)}
              y1={Y(trend.y1)}
              x2={X(trend.x2)}
              y2={Y(trend.y2)}
              stroke={colors.textSecondary}
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeLinecap="round"
            />
          ) : null}
          {data.map((d, i) => (
            <React.Fragment key={i}>
              <Circle cx={X(d.x)} cy={Y(d.y)} r={5.6} fill={colors.surface} />
              <Circle
                cx={X(d.x)}
                cy={Y(d.y)}
                r={picked === i ? 6 : 4.4}
                fill={series}
                fillOpacity={picked === i ? 1 : 0.7}
                stroke={picked === i ? colors.textPrimary : series}
                strokeWidth={picked === i ? 2 : 1}
              />
            </React.Fragment>
          ))}
        </Svg>
        </View>
        </Pressable>
      ) : (
        <View style={{ height }} />
      )}
      <Muted style={{ fontSize: 12, textAlign: "center" }}>{xLabel}</Muted>
      {picked != null && data[picked] ? (
        <Pressable onPress={() => setPicked(null)}>
          <Text style={{ fontSize: 13, color: colors.textPrimary, textAlign: "center" }}>{data[picked].caption}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
