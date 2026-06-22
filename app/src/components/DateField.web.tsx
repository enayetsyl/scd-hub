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
      <input
        type="date"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.currentTarget.value)}
        style={{
          padding: 12,
          borderRadius: radius.md,
          border: `1px solid ${c.border}`,
          backgroundColor: c.surface,
          color: c.textPrimary,
          fontSize: 16,
          width: "100%",
          boxSizing: "border-box",
          fontFamily: "inherit",
        }}
      />
    </View>
  );
}

export default DateField;
