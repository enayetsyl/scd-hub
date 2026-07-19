/**
 * OutcomeSegment (ux-audit F1 — এক ট্যাপে ট্র্যাকিং): one-tap per-row outcome
 * selector. Two mutually-exclusive options (e.g. সম্পন্ন/অসম্পূর্ণ or
 * জমা দিয়েছে/জমা দেয়নি); a single tap selects AND saves — no separate Save
 * button. Selected segment fills with the outcome's container color (ok →
 * primary family, danger → error family) plus a ✓/✕ glyph.
 *
 * Tokens only; labels at `typeScale.chip` (14sp — above the 12sp floor);
 * 48dp-tall segments (§6 touch targets).
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { makeStyles, radius, space, typeScale, useColors } from "../theme";

export type OutcomeTone = "ok" | "danger";

export interface OutcomeOption {
  value: string;
  label: string;
  tone: OutcomeTone;
}

export function OutcomeSegment({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: OutcomeOption[];
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
}): React.ReactElement {
  const styles = useStyles();
  const colors = useColors();

  const toneMap = {
    ok: { bg: colors.primaryContainer, fg: colors.onPrimaryContainer, border: colors.primary },
    danger: { bg: colors.errorContainer, fg: colors.onErrorContainer, border: colors.error },
  } as const;

  return (
    <View style={styles.host} accessibilityRole="radiogroup">
      {options.map((opt, i) => {
        const selected = value === opt.value;
        const t = toneMap[opt.tone];
        return (
          <Pressable
            key={opt.value}
            onPress={() => {
              if (!disabled) onChange(opt.value);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            style={({ pressed }) => [
              styles.segment,
              i > 0 && styles.segmentGap,
              selected
                ? { backgroundColor: t.bg, borderColor: t.border }
                : { backgroundColor: colors.surface, borderColor: colors.border },
              (pressed || disabled) && styles.dim,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[styles.label, { color: selected ? t.fg : colors.textSecondary }]}
            >
              {selected ? `${opt.tone === "ok" ? "✓" : "✕"} ` : ""}
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  host: { flexDirection: "row", flexShrink: 0 },
  segment: {
    minHeight: 48,
    minWidth: 84,
    paddingHorizontal: space(3),
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentGap: { marginLeft: space(2) },
  label: { ...typeScale.chip },
  dim: { opacity: 0.7 },
}));
