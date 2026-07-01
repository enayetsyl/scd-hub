/**
 * DateField (web) — a labelled native browser calendar (`<input type="date">`).
 * Value is round-tripped as "YYYY-MM-DD" (the same shape the homework queries use).
 * Web-only; the native variant (DateField.tsx) uses @react-native-community/datetimepicker.
 */
import React from "react";
import { View, Text } from "react-native";
import { useColors } from "../theme";
import { radius, space } from "../theme/tokens";

export interface DateFieldProps {
  label?: string;
  value: string; // YYYY-MM-DD
  onChange: (v: string) => void;
}

export function DateField({ label, value, onChange }: DateFieldProps): React.ReactElement {
  const c = useColors();
  return (
    <View style={{ marginBottom: space(3) }}>
      {label ? <Text style={{ color: c.textSecondary, fontSize: 13, marginBottom: space(1) }}>{label}</Text> : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: radius.md,
          backgroundColor: c.surface,
          paddingHorizontal: space(3),
          gap: space(2),
        }}
      >
        <Text style={{ color: c.textSecondary, fontSize: 16 }}>📅</Text>
        <input
          type="date"
          value={value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.currentTarget.value)}
          style={{
            padding: 12,
            border: "none",
            outline: "none",
            backgroundColor: "transparent",
            color: c.textPrimary,
            fontSize: 16,
            boxSizing: "border-box",
            fontFamily: "inherit",
            flex: 1,
            minWidth: 0,
          }}
        />
      </View>
    </View>
  );
}

export default DateField;
