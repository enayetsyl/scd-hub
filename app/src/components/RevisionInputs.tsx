/**
 * Shared Saturday-revision inputs: the surah:ayah picker, the whole-juz shortcut and the
 * one-tap +/− counter. Used by the group grid (SR-5, D-#833..#836), the weekly target
 * screen and the listener's marking screen (SR-6, D-#1170/#1172).
 */
import React from "react";
import { View } from "react-native";
import { SURAHS, JUZ_COUNT } from "@scd/shared";
import { Body, Chip, Select } from "./ui";
import { STR, bnNum } from "../lib/labels";
import { space } from "../theme/tokens";

export const SURAH_OPTIONS = SURAHS.map((s) => ({ label: `${bnNum(s.n)}. ${s.bn}`, value: String(s.n), hint: `${s.n} ${s.ar}` }));
export const JUZ_OPTIONS = Array.from({ length: JUZ_COUNT }, (_, i) => ({
  label: `${STR.revJuz} ${bnNum(i + 1)}`,
  value: String(i + 1),
  hint: String(i + 1),
}));

export function ayahOptions(surah: string | null): { label: string; value: string; hint: string }[] {
  const s = surah ? SURAHS[Number(surah) - 1] : undefined;
  if (!s) return [];
  return Array.from({ length: s.ayahs }, (_, i) => ({ label: bnNum(i + 1), value: String(i + 1), hint: String(i + 1) }));
}

/** A one-tap +1 / −1 counter (D-#836). */
export function Counter({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginTop: space(1) }}>
      <Body style={{ flex: 1 }}>{label}</Body>
      {!disabled ? <Chip label="−" onPress={() => onChange(Math.max(0, value - 1))} /> : null}
      <Body style={{ minWidth: 28, textAlign: "center", fontWeight: "700" }}>{bnNum(value)}</Body>
      {!disabled ? <Chip label="+" onPress={() => onChange(value + 1)} /> : null}
    </View>
  );
}

/** Start or end of a range: surah + ayah dropdowns. */
export function SurahAyahPicker({
  label,
  surah,
  ayah,
  onChange,
}: {
  label: string;
  surah: string | null;
  ayah: string | null;
  onChange: (surah: string | null, ayah: string | null) => void;
}): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", gap: space(2) }}>
      <View style={{ flex: 2 }}>
        <Select
          label={label}
          value={surah}
          options={SURAH_OPTIONS}
          onChange={(v) => onChange(v, null)}
          placeholder={STR.revPickSurah}
          searchable
        />
      </View>
      <View style={{ flex: 1 }}>
        <Select
          label={STR.revPickAyah}
          value={ayah}
          options={ayahOptions(surah)}
          onChange={(v) => onChange(surah, v)}
          placeholder={STR.revPickAyah}
          searchable
        />
      </View>
    </View>
  );
}
