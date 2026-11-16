/**
 * ReviewSupervisionChart (RS-4) - the batch's daily work: one stacked column per day (the last 14
 * days that have a row), one colour per reviewer with a named legend, the day's total printed above
 * it, and under it the running total as a line. Built from plain Views like the other mini charts
 * (no chart library); every column is `flex: 1`, so 14 of them fit a 360 dp phone without scrolling.
 *
 * MiniStackedBars only knows four tones and draws horizontal share rows, so it cannot give seven
 * reviewers seven colours - the stack is drawn here with a small fixed palette instead. Rows with a
 * null reviewerId (the batch-wide series) are drawn as one "everyone" colour.
 */
import React, { useState } from "react";
import { View, Text, Pressable, useWindowDimensions } from "react-native";
import { Muted } from "./ui";
import { MiniLineChart } from "./MiniCharts";
import { STR, bnNum } from "../lib/labels";
import { compactNum } from "../lib/reviewSupervision";
import type { ReviewPointT } from "../graphql/reviewSupervision";
import { useColors } from "../theme";
import { space } from "../theme/tokens";

const SHOWN_DAYS = 14;
const COLUMN_AREA = 110;
/** Mid-tone colours that read on both the light and the dark surface. */
const PALETTE = ["#2E7D6B", "#D9822B", "#3F6FD1", "#B8479B", "#8A9A2B", "#C4453A", "#6B5BC9", "#2A93A8"];

export function ReviewSupervisionChart({
  points,
  totalCount,
}: {
  points: readonly ReviewPointT[];
  /** What "everything" is, so the running-total line has a ceiling (plans + questions in the batch). */
  totalCount: number;
}): React.ReactElement {
  const colors = useColors();
  const { width } = useWindowDimensions();
  // A phone column is ~20 dp wide: numbers would overprint, so they show on tap (and on wide screens for every column).
  const showAll = width >= 700;
  const [picked, setPicked] = useState<string | null>(null);
  const dayKeys = [...new Set(points.map((p) => p.dateKey))].sort().slice(-SHOWN_DAYS);
  if (dayKeys.length === 0) return <Muted>{STR.rspChartEmpty}</Muted>;

  // Stable colour order: reviewers by name, so a person keeps her colour while the days scroll.
  const reviewers = new Map<string, string>();
  for (const p of points) reviewers.set(p.reviewerId ?? "all", p.reviewerId ? p.reviewerName ?? "-" : STR.rspChartAll);
  const order = [...reviewers.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const colorOf = new Map(order.map(([id], i) => [id, PALETTE[i % PALETTE.length] as string]));

  const days = dayKeys.map((k) => {
    const rows = points.filter((p) => p.dateKey === k);
    return {
      key: k,
      total: rows.reduce((n, r) => n + r.doneCount, 0),
      cumulative: rows.reduce((n, r) => n + r.cumulativeDone, 0),
      estimated: rows.some((r) => r.estimated),
      parts: rows.filter((r) => r.doneCount > 0).map((r) => ({ id: r.reviewerId ?? "all", n: r.doneCount })),
    };
  });
  const pickedDay = days.find((d) => d.key === picked) ?? null;
  const peak = Math.max(1, ...days.map((d) => d.total));
  const ceiling = Math.max(1, totalCount, ...days.map((d) => d.cumulative));
  const anyEstimated = days.some((d) => d.estimated);

  return (
    <View accessible accessibilityLabel={STR.rspChartTitle}>
      <Muted style={{ minHeight: 18 }}>
        {pickedDay ? `${bnNum(pickedDay.key)} · ${bnNum(pickedDay.total)}` : ""}
      </Muted>
      <View style={{ flexDirection: "row", alignItems: "flex-end", height: COLUMN_AREA + 16, gap: 3 }}>
        {days.map((d) => (
          <Pressable
            key={d.key}
            onPress={() => setPicked(picked === d.key ? null : d.key)}
            accessibilityLabel={`${bnNum(d.key)} ${bnNum(d.total)}`}
            style={{ flex: 1, minWidth: 0, alignItems: "center", justifyContent: "flex-end", height: "100%" }}
          >
            <Text style={{ fontSize: 9, color: colors.textSecondary }} numberOfLines={1}>
              {d.total > 0 && (showAll || picked === d.key) ? compactNum(d.total) : ""}
            </Text>
            <View style={{ width: "70%", opacity: d.estimated ? 0.55 : 1, borderTopLeftRadius: 3, borderTopRightRadius: 3, overflow: "hidden" }}>
              {d.parts.map((part) => (
                <View
                  key={part.id}
                  style={{ height: Math.max(2, (part.n / peak) * COLUMN_AREA), backgroundColor: colorOf.get(part.id) }}
                />
              ))}
            </View>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 3, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 2 }}>
        {days.map((d) => (
          <Text key={d.key} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 9, color: colors.textSecondary }} numberOfLines={1}>
            {bnNum(Number(d.key.slice(8, 10)))}
          </Text>
        ))}
      </View>
      {/* The legend names every colour - colour alone is never the only cue. */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space(3), rowGap: 2, marginTop: space(2) }}>
        {order.map(([id, name]) => (
          <View key={id} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: colorOf.get(id) }} />
            <Text style={{ fontSize: 12, color: colors.textSecondary }}>{name}</Text>
          </View>
        ))}
      </View>
      <Muted style={{ marginTop: space(1) }}>{STR.rspChartPerDay} {STR.rspChartTapHint}</Muted>

      <View style={{ marginTop: space(3) }}>
        <Muted style={{ marginBottom: space(1) }}>{STR.rspCumulative}</Muted>
        <MiniLineChart
          points={days.map((d) => ({ label: bnNum(Number(d.key.slice(8, 10))), value: d.cumulative }))}
          maxValue={ceiling}
          height={64}
          accessibilityLabel={STR.rspCumulative}
        />
      </View>
      {anyEstimated ? <Muted style={{ marginTop: space(2) }}>{STR.rspChartEstimated}</Muted> : null}
    </View>
  );
}
