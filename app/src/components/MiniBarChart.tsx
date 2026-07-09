/**
 * MiniBarChart (CT-9) — a dependency-free, hand-rolled bar chart (plain Views, no
 * react-native-svg). One vertical bar per data point, height ∝ value (0..maxValue),
 * colored by pass/fail so a student's trajectory reads at a glance (rising = improving,
 * falling = declining). Works on web + native. Absent/null points render as a muted stub.
 */
import React from "react";
import { View } from "react-native";
import { Muted } from "./ui";
import { useColors, space } from "../theme";

export interface BarDatum {
  label: string;
  /** 0..maxValue; null = no score (absent) → muted stub bar. */
  value: number | null;
  /** Colors the bar: true = pass (primary), false = fail (error), null = muted. */
  pass?: boolean | null;
}

export function MiniBarChart({
  data,
  maxValue = 100,
  height = 96,
}: {
  data: BarDatum[];
  maxValue?: number;
  height?: number;
}): React.ReactElement | null {
  const colors = useColors();
  if (data.length === 0) return null;

  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "flex-end", height, gap: space(1) }}>
        {data.map((d, i) => {
          const v = d.value ?? 0;
          const h = Math.max(3, (Math.min(v, maxValue) / maxValue) * height);
          const color =
            d.value == null ? colors.textDisabled : d.pass === false ? colors.error : colors.primary;
          return (
            <View key={i} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end" }}>
              <View
                style={{
                  width: "72%",
                  height: h,
                  backgroundColor: color,
                  opacity: d.value == null ? 0.4 : 1,
                  borderTopLeftRadius: 3,
                  borderTopRightRadius: 3,
                }}
              />
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", gap: space(1), marginTop: 2 }}>
        {data.map((d, i) => (
          <View key={i} style={{ flex: 1, alignItems: "center" }}>
            <Muted style={{ fontSize: 10 }}>{d.label}</Muted>
          </View>
        ))}
      </View>
    </View>
  );
}
