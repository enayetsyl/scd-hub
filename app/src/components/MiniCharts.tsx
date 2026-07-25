/**
 * MiniCharts (SP-3, prd-student-profile §8.2) — two siblings of `MiniBarChart`, built
 * the same way: plain Views, no charting dependency, works on web + native.
 * (`react-native-svg` is in the tree but nothing uses it; keeping these View-based
 * matches MiniBarChart and avoids a native-only rendering path.)
 *
 *   MiniStackedBars — one bar per category, split into segments. Used for the
 *                     CORRECT / PARTIAL / WRONG outcome mix per subject, which is the
 *                     single chart the owner asked for by name.
 *   MiniLineChart   — a sparkline over an ordered series (attendance by month, exam
 *                     percents). Drawn as thin vertical stems + dots: a real polyline
 *                     needs SVG, and the stem form reads the same at this size.
 *
 * ACCESSIBILITY: colour never carries meaning alone — every segment is also named in
 * the legend with its count, and each chart takes an `accessibilityLabel`.
 */
import React from "react";
import { View } from "react-native";
import { Muted } from "./ui";
import { useColors, space } from "../theme";

export interface StackSegment {
  /** Legend label — required, because colour alone must never be the only cue. */
  label: string;
  value: number;
  tone: "ok" | "warn" | "danger" | "muted";
}

export interface StackedRow {
  label: string;
  segments: StackSegment[];
}

function useTone(): (tone: StackSegment["tone"]) => string {
  const colors = useColors();
  return (tone) =>
    tone === "ok"
      ? colors.success
      : tone === "warn"
        ? colors.warning
        : tone === "danger"
          ? colors.error
          : colors.textDisabled;
}

/**
 * Horizontal stacked bars — one row per category (a subject), each segment sized by
 * share of that row's total. Rows with no data render a muted empty track, so a
 * subject with nothing recorded is visibly different from a subject scoring zero.
 */
export function MiniStackedBars({
  rows,
  height = 14,
  accessibilityLabel,
}: {
  rows: StackedRow[];
  height?: number;
  accessibilityLabel?: string;
}): React.ReactElement | null {
  const colors = useColors();
  const toneColor = useTone();
  if (rows.length === 0) return null;

  return (
    <View accessible accessibilityLabel={accessibilityLabel} style={{ gap: space(2) }}>
      {rows.map((row) => {
        const total = row.segments.reduce((s, seg) => s + seg.value, 0);
        return (
          <View key={row.label}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Muted style={{ fontSize: 12 }}>{row.label}</Muted>
              <Muted style={{ fontSize: 12 }}>
                {row.segments
                  .filter((s) => s.value > 0)
                  .map((s) => `${s.label} ${s.value}`)
                  .join(" · ") || "—"}
              </Muted>
            </View>
            <View
              style={{
                flexDirection: "row",
                height,
                borderRadius: 4,
                overflow: "hidden",
                backgroundColor: colors.surfaceAlt,
                marginTop: 3,
              }}
            >
              {total === 0
                ? null
                : row.segments.map((seg, i) =>
                    seg.value === 0 ? null : (
                      <View
                        key={i}
                        style={{ flex: seg.value / total, backgroundColor: toneColor(seg.tone) }}
                      />
                    ),
                  )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** A shared legend for the stacked bars — the second cue that carries the meaning. */
export function ChartLegend({ items }: { items: StackSegment[] }): React.ReactElement {
  const toneColor = useTone();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3), marginTop: space(2) }}>
      {items.map((it) => (
        <View key={it.label} style={{ flexDirection: "row", alignItems: "center", gap: space(1) }}>
          <View
            style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: toneColor(it.tone) }}
          />
          <Muted style={{ fontSize: 12 }}>{it.label}</Muted>
        </View>
      ))}
    </View>
  );
}

export interface LinePoint {
  label: string;
  /** null = no data for that step (renders as a gap, never as zero). */
  value: number | null;
}

/**
 * A sparkline over an ordered series: a dot per point at its height, with a faint
 * stem to the baseline. `null` points render as a gap — plotting them as 0 would
 * invent a collapse that never happened.
 */
export function MiniLineChart({
  points,
  maxValue = 100,
  height = 72,
  accessibilityLabel,
}: {
  points: LinePoint[];
  maxValue?: number;
  height?: number;
  accessibilityLabel?: string;
}): React.ReactElement | null {
  const colors = useColors();
  if (points.length === 0) return null;

  return (
    <View accessible accessibilityLabel={accessibilityLabel}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", height, gap: space(1) }}>
        {points.map((p, i) => {
          const has = p.value != null;
          const h = has ? Math.max(2, (Math.min(p.value as number, maxValue) / maxValue) * height) : 0;
          return (
            <View key={i} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end" }}>
              {has ? (
                <>
                  <View
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 4,
                      backgroundColor: colors.primary,
                      marginBottom: -3,
                    }}
                  />
                  <View style={{ width: 2, height: h, backgroundColor: colors.primary, opacity: 0.35 }} />
                </>
              ) : (
                <View style={{ width: 2, height: 3, backgroundColor: colors.textDisabled }} />
              )}
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", gap: space(1), marginTop: 2 }}>
        {points.map((p, i) => (
          <View key={i} style={{ flex: 1, alignItems: "center" }}>
            <Muted style={{ fontSize: 10 }}>{p.label}</Muted>
          </View>
        ))}
      </View>
    </View>
  );
}
