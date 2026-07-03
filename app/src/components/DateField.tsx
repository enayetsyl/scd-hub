/**
 * DateField (native) — a labelled tap-to-open calendar using
 * @react-native-community/datetimepicker. Value is round-tripped as "YYYY-MM-DD".
 * The web variant (DateField.web.tsx) renders the browser's native date input;
 * Metro resolves `.web.tsx` on web so this native module never enters the web bundle.
 */
import React, { useState } from "react";
import { View, Text, Pressable, Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useColors } from "../theme";
import { radius, space } from "../theme/tokens";

export interface DateFieldProps {
  label?: string;
  value: string; // YYYY-MM-DD ("" = unset)
  onChange: (v: string) => void;
  min?: string; // YYYY-MM-DD
  max?: string; // YYYY-MM-DD
  helper?: string;
  error?: string;
}

function parseYMD(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
}
function toYMD(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function DateField({ label, value, onChange, min, max, helper, error }: DateFieldProps): React.ReactElement {
  const c = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ marginBottom: space(3) }}>
      {label ? <Text style={{ color: c.textSecondary, fontSize: 13, marginBottom: space(1) }}>{label}</Text> : null}
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label ?? "Date picker"}
        style={{
          borderWidth: 1,
          borderColor: error ? c.error : c.border,
          borderRadius: radius.md,
          paddingVertical: space(3),
          paddingHorizontal: space(3),
          backgroundColor: c.surface,
          flexDirection: "row",
          alignItems: "center",
          gap: space(2),
        }}
      >
        <Text style={{ color: c.textSecondary, fontSize: 16 }}>📅</Text>
        <Text style={{ color: c.textPrimary, fontSize: 16, flex: 1 }}>{value || "—"}</Text>
      </Pressable>
      {open ? (
        <DateTimePicker
          value={parseYMD(value)}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          minimumDate={min ? parseYMD(min) : undefined}
          maximumDate={max ? parseYMD(max) : undefined}
          onChange={(event: { type?: string }, selected?: Date) => {
            setOpen(false);
            if (selected && event.type !== "dismissed") onChange(toYMD(selected));
          }}
        />
      ) : null}
      {error ? (
        <Text style={{ color: c.error, fontSize: 13, marginTop: space(1) }}>⚠ {error}</Text>
      ) : helper ? (
        <Text style={{ color: c.textSecondary, fontSize: 13, marginTop: space(1) }}>{helper}</Text>
      ) : null}
    </View>
  );
}

export default DateField;
