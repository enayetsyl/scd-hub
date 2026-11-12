/**
 * CtWeakObjectivePicker (D-#1360, docs/prd-ct-weak-objectives.md) — on the class-test marks
 * screen, beside the weakness text: "কোন শিখনফলে দুর্বল". Lists the tagged, LOCKED objectives
 * of the test's class × subject grouped by chapter, searchable by code or label, code + label
 * on every row, multi-select up to the server's max (5).
 *
 * Renders NOTHING when the server says the picker is unavailable (no locked catalogue, a
 * group-anchored test, or the query could not run) — the screen is then exactly as before.
 * The level word comes from useMasteryLevelLabels, never a literal (D-#923).
 */
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useQuery } from "urql";
import { CT_WEAK_LO_OPTIONS_QUERY, type CtWeakLoOptionT } from "../graphql/classTest";
import { Body, Muted, Chip } from "./ui";
import { SearchField } from "./SearchField";
import { STR, bnNum, getActiveLang } from "../lib/labels";
import { useMasteryLevelLabels } from "../lib/useMasteryLevelLabels";
import { space } from "../theme/tokens";

const fill = (tpl: string, vars: Record<string, string>): string => tpl.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? "");

/** Bangla locative of the level word: "শিখনফল" → "শিখনফলে"; a word that does not end in a
 *  consonant takes "-এ" so a renamed word never gets a broken vowel sign. */
export function locativeBn(word: string): string {
  if (getActiveLang() === "en") return word;
  const last = word.charCodeAt(word.length - 1);
  const consonant = (last >= 0x0995 && last <= 0x09b9) || (last >= 0x09dc && last <= 0x09df);
  return consonant ? `${word}ে` : `${word}-এ`;
}

/** Whether the picker would show for this test — the screen uses it to send the field at all. */
export function useCtWeakLoAvailable(testId: string, pause = false): boolean {
  const [q] = useQuery({ query: CT_WEAK_LO_OPTIONS_QUERY, variables: { testId }, pause });
  return !!q.data?.classTestWeakObjectiveOptions.available;
}

type Group = { key: string; title: string; rows: CtWeakLoOptionT[] };

export function CtWeakObjectivePicker({
  testId,
  value,
  onChange,
  disabled = false,
}: {
  testId: string;
  value: string[];
  onChange: (codes: string[]) => void;
  disabled?: boolean;
}): React.ReactElement | null {
  const [q] = useQuery({ query: CT_WEAK_LO_OPTIONS_QUERY, variables: { testId } });
  const levels = useMasteryLevelLabels();
  const [term, setTerm] = useState("");
  const data = q.data?.classTestWeakObjectiveOptions;
  const options = data?.options ?? [];
  const max = data?.max ?? 5;

  const byCode = useMemo(() => new Map(options.map((o) => [o.code, o])), [options]);
  const groups = useMemo<Group[]>(() => {
    const t = term.trim().toLowerCase();
    const out = new Map<string, Group>();
    for (const o of options) {
      if (t && !o.code.toLowerCase().includes(t) && !o.labelBn.toLowerCase().includes(t)) continue;
      const key = o.chapterNumber != null ? `c${o.chapterNumber}` : "strand";
      const title =
        o.chapterNumber != null
          ? `${STR.gpChapter} ${bnNum(o.chapterNumber)}${o.chapterTitleBn ? `: ${o.chapterTitleBn}` : ""}`
          : STR.msStrands;
      const g = out.get(key) ?? { key, title, rows: [] };
      g.rows.push(o);
      out.set(key, g);
    }
    return [...out.values()];
  }, [options, term]);

  if (!data?.available) return null;

  const full = value.length >= max;
  const toggle = (code: string): void => {
    if (disabled) return;
    if (value.includes(code)) onChange(value.filter((c) => c !== code));
    else if (!full) onChange([...value, code]);
  };

  return (
    <View style={{ marginTop: space(2), gap: space(1) }}>
      <Body style={{ fontWeight: "700" }}>{fill(STR.ctWeakLoTitle, { w: locativeBn(levels.objective) })}</Body>
      <Muted>{fill(STR.ctWeakLoHint, { n: bnNum(max) })}</Muted>
      {value.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
          {value.map((code) => (
            <Chip key={code} label={`✕ ${code} · ${byCode.get(code)?.labelBn ?? ""}`} selected onPress={() => toggle(code)} />
          ))}
        </View>
      ) : null}
      {full ? <Muted>{fill(STR.ctWeakLoMax, { n: bnNum(max) })}</Muted> : null}
      <SearchField value={term} onSearch={setTerm} />
      <ScrollView style={{ maxHeight: 320 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {groups.length === 0 ? <Muted>{STR.noMatches}</Muted> : null}
        {groups.map((g) => (
          <View key={g.key} style={{ marginTop: space(1) }}>
            <Muted style={{ fontWeight: "700" }}>{g.title}</Muted>
            {g.rows.map((o) => {
              const on = value.includes(o.code);
              const sub = o.level === "SUB";
              return (
                <Pressable
                  key={o.code}
                  onPress={() => toggle(o.code)}
                  disabled={disabled || (!on && full)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: disabled || (!on && full) }}
                  style={{ flexDirection: "row", gap: space(2), paddingVertical: space(1), paddingLeft: sub ? space(3) : 0, opacity: !on && full ? 0.5 : 1 }}
                >
                  <Body>{on ? "☑" : "☐"}</Body>
                  <View style={{ flexShrink: 1 }}>
                    <Body>{o.labelBn}</Body>
                    <Muted>{sub ? `${o.code} · ${levels.sub}` : o.code}</Muted>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/** Read side (staff): the picked objectives' labels under the weakness text. Nothing when none. */
export function CtWeakObjectivesShown({ items }: { items: { code: string; labelBn: string }[] | null | undefined }): React.ReactElement | null {
  const levels = useMasteryLevelLabels();
  if (!items || items.length === 0) return null;
  return <Muted>{`${fill(STR.ctWeakLoShown, { w: levels.objective })}: ${items.map((i) => i.labelBn).join("; ")}`}</Muted>;
}
