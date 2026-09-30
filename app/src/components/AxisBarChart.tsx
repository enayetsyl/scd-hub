/**
 * AxisBarChart — a percent bar chart that can be READ, not just glanced at: a 0–100
 * y-axis with gridlines and tick labels, the value printed on every bar, an x-axis
 * label under every bar, and an optional dashed reference line (the class average).
 * Owner report 2026-09-30: the MiniBarChart bars had no axis values and were "not easy
 * to understand". SVG (react-native-svg), like PieChart; it measures its own width.
 */
import React, { useState } from "react";
import { View } from "react-native";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";
import { Muted } from "./ui";
import { bnNum } from "../lib/labels";
import { space, useColors } from "../theme";

export interface AxisBarDatum {
  label: string;
  /** 0–100. */
  value: number;
  /** false paints the bar as a fail; null/undefined = neutral. */
  pass?: boolean | null;
}

const TICKS = [0, 25, 50, 75, 100];
const LEFT = 34;
const BOTTOM = 22;
const TOP = 18;

export function AxisBarChart({
  data,
  height = 190,
  reference,
  accessibilityLabel,
}: {
  data: AxisBarDatum[];
  height?: number;
  /** A dashed horizontal line, e.g. the class average for this subject. */
  reference?: { value: number; label: string } | null;
  accessibilityLabel: string;
}): React.ReactElement {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const plotW = Math.max(0, width - LEFT - 8);
  const plotH = height - TOP - BOTTOM;
  const y = (v: number) => TOP + plotH - (Math.max(0, Math.min(100, v)) / 100) * plotH;
  const slot = data.length ? plotW / data.length : 0;
  const barW = Math.min(44, slot * 0.6);

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ width: "100%", gap: space(1) }}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          {TICKS.map((t) => (
            <React.Fragment key={t}>
              <Line x1={LEFT} x2={LEFT + plotW} y1={y(t)} y2={y(t)} stroke={colors.border} strokeWidth={1} />
              <SvgText x={LEFT - 6} y={y(t) + 4} fontSize={11} fill={colors.textSecondary} textAnchor="end">
                {`${bnNum(t)}%`}
              </SvgText>
            </React.Fragment>
          ))}
          {data.map((d, i) => {
            const cx = LEFT + slot * i + slot / 2;
            const top = y(d.value);
            const fill = d.pass === false ? colors.error : colors.primary;
            return (
              <React.Fragment key={`${d.label}-${i}`}>
                <Rect x={cx - barW / 2} y={top} width={barW} height={TOP + plotH - top} fill={fill} rx={3} />
                <SvgText x={cx} y={top - 4} fontSize={11} fontWeight="700" fill={colors.textPrimary} textAnchor="middle">
                  {`${bnNum(Math.round(d.value))}%`}
                </SvgText>
                <SvgText x={cx} y={height - 6} fontSize={11} fill={colors.textSecondary} textAnchor="middle">
                  {d.label}
                </SvgText>
              </React.Fragment>
            );
          })}
          {reference ? (
            <Line
              x1={LEFT}
              x2={LEFT + plotW}
              y1={y(reference.value)}
              y2={y(reference.value)}
              stroke={colors.gold}
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          ) : null}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
      {reference ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
          <View style={{ width: 18, height: 0, borderTopWidth: 2, borderStyle: "dashed", borderColor: colors.gold }} />
          <Muted style={{ fontSize: 12 }}>
            {reference.label}: {bnNum(Math.round(reference.value))}%
          </Muted>
        </View>
      ) : null}
    </View>
  );
}
