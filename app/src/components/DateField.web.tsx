/**
 * DateField (web) - a labelled browser calendar.
 * Value is round-tripped as "YYYY-MM-DD" (the same shape the homework queries use).
 * Web-only; the native variant (DateField.tsx) uses @react-native-community/datetimepicker.
 */
import React, { useRef } from "react";
import { View, Text, Pressable } from "react-native";
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

export function DateField({ label, value, onChange, min, max, helper, error }: DateFieldProps): React.ReactElement {
  const c = useColors();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openPicker = (): void => {
    const input = inputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!input) return;
    input.focus();
    // showPicker throws NotAllowedError without a fresh user gesture; fall back to a click then.
    try {
      if (input.showPicker) return input.showPicker();
    } catch {
      /* fall through */
    }
    input.click();
  };

  return (
    <View style={{ marginBottom: space(3) }}>
      {label ? <Text style={{ color: c.textSecondary, fontSize: 13, marginBottom: space(1) }}>{label}</Text> : null}
      <Pressable
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel={label ?? "Date picker"}
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderColor: error ? c.error : c.border,
          borderRadius: radius.md,
          backgroundColor: c.surface,
          paddingHorizontal: space(3),
          paddingVertical: space(3),
          gap: space(2),
        }}
      >
        <Text style={{ color: c.textSecondary, fontSize: 16 }}>📅</Text>
        <Text style={{ color: value ? c.textPrimary : c.textSecondary, fontSize: 16, flex: 1 }}>
          {value || "Choose a date"}
        </Text>
        <input
          ref={inputRef}
          type="date"
          value={value}
          min={min}
          max={max}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.currentTarget.value)}
          // input.click() must not bubble back to the Pressable and re-enter openPicker.
          onClick={(e: React.MouseEvent<HTMLInputElement>) => e.stopPropagation()}
          aria-label={label ?? "Date picker"}
          tabIndex={-1}
          style={{
            position: "absolute",
            opacity: 0,
            width: 1,
            height: 1,
            left: 0,
            top: 0,
            border: "none",
            outline: "none",
            margin: 0,
            padding: 0,
            pointerEvents: "none",
          }}
        />
      </Pressable>
      {error ? (
        <Text style={{ color: c.error, fontSize: 13, marginTop: space(1) }}>⚠ {error}</Text>
      ) : helper ? (
        <Text style={{ color: c.textSecondary, fontSize: 13, marginTop: space(1) }}>{helper}</Text>
      ) : null}
    </View>
  );
}

export default DateField;
