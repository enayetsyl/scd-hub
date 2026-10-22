/**
 * LessonPlanBlock (LP-1, D-#820/#821) — the class-note card's "which session plan did you teach
 * today?" answer. The class × subject's session plans in book order; this শাখা's next session is
 * pre-selected; each picked session is শেষ হয়েছে (finished) or চলমান (continues next class).
 * Nothing picked → a reason is required instead.
 *
 * Controlled: the parent card owns the answer (`value`) and submits it with the note. `onApplies`
 * tells the parent whether an answer is needed at all (a period with no lesson plan needs none).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { LESSON_NONE_REASONS } from "@scd/shared";
import { LESSON_PLAN_FOR_SLOT_QUERY, type LessonPlanIn, type LessonPlanSessionT, type LessonDeliveryT } from "../graphql/operations";
import { Body, Muted, Chip, ChipRow, Field, Button } from "./ui";
import { STR, bnNum, lessonNoneReasonLabel as noneReasonLabel } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { space } from "../theme/tokens";

/** "অধ্যায় ২ · সেশন ১/২ · ভাগ — ধারণা" */
export function sessionLabel(s: { chapter: string; sessionIndex: number; sessionOf: number; titleBn: string; anchorWord?: string }): string {
  const chapter = `${s.anchorWord ? `${s.anchorWord} ` : ""}${bnNum(s.chapter)}`;
  return `${chapter} · ${STR.lpSession} ${bnNum(s.sessionIndex)}/${bnNum(s.sessionOf)} · ${s.titleBn}`;
}

/** One line for a published note: the sessions taught, or the reason. */
export function deliverySummary(d: LessonDeliveryT): string {
  if (d.sessions.length === 0) {
    return `${d.noneReason ? noneReasonLabel(d.noneReason) : ""}${d.noneNote ? ` — ${d.noneNote}` : ""}`;
  }
  return d.sessions.map((s) => `${sessionLabel(s)}${s.finished ? " ✓" : ` (${STR.lpStarted})`}`).join("\n");
}

/** The answer a delivery already holds, as the input shape. */
function fromDelivery(d: LessonDeliveryT): LessonPlanIn {
  return d.sessions.length > 0
    ? { sessions: d.sessions.map((s) => ({ key: s.key, finished: s.finished })) }
    : { sessions: [], noneReason: d.noneReason, noneNote: d.noneNote };
}

/** Client-side check matching the server (D-#821): null = complete. */
export function lessonPlanError(v: LessonPlanIn | null): string | null {
  if (!v) return STR.lpRequired;
  if ((v.sessions ?? []).length > 0) return null;
  return v.noneReason ? null : STR.lpRequired;
}

const WINDOW = 4;

export function LessonPlanBlock({
  slotId,
  date,
  value,
  onChange,
  onApplies,
  onTitles,
  error,
}: {
  slotId: string;
  date: string;
  value: LessonPlanIn | null;
  onChange: (v: LessonPlanIn) => void;
  onApplies: (applies: boolean) => void;
  /** The picked sessions as readable lines — the card uses them when "যা পড়ালাম" is left empty. */
  onTitles?: (titles: string[]) => void;
  error?: string;
}): React.ReactElement | null {
  const [q, refetch] = useQuery({ query: LESSON_PLAN_FOR_SLOT_QUERY, variables: { slotId, date }, requestPolicy: "network-only" });
  const plan = q.data?.lessonPlanForSlot;
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (plan) onApplies(plan.applies);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.applies]);

  // Seed once: the note's own marks when it has them, else the suggested session as finished.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !plan?.applies || value) return;
    seeded.current = true;
    if (plan.delivery) onChange(fromDelivery(plan.delivery));
    else if (plan.suggestedKey) onChange({ sessions: [{ key: plan.suggestedKey, finished: true }] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  const byKey = useMemo(() => new Map((plan?.sessions ?? []).map((s) => [s.key, s])), [plan?.sessions]);
  const picked = value?.sessions ?? [];
  const pickedKeys = new Set(picked.map((p) => p.key));

  const titlesKey = picked.map((p) => `${p.key}:${p.finished}`).join("|");
  useEffect(() => {
    onTitles?.(
      picked
        .map((p) => byKey.get(p.key))
        .filter((s): s is LessonPlanSessionT => !!s)
        .map((s) => sessionLabel(s)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titlesKey, byKey]);

  // The quick row: the suggested session and the few after it in book order.
  const quick = useMemo(() => {
    const all = plan?.sessions ?? [];
    const start = Math.max(0, all.findIndex((s) => s.key === plan?.suggestedKey));
    return all.slice(start, start + WINDOW);
  }, [plan?.sessions, plan?.suggestedKey]);
  const shown: LessonPlanSessionT[] = showAll ? plan?.sessions ?? [] : quick;

  if (q.error) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <Muted style={{ flexShrink: 1, color: "#b00020" }}>⚠ {friendlyError(q.error)}</Muted>
        <Button title={STR.retry} variant="ghost" onPress={() => refetch({ requestPolicy: "network-only" })} />
      </View>
    );
  }
  if (!plan) return q.fetching ? <Muted>{STR.loading}</Muted> : null;
  if (!plan.applies) return null;

  function toggle(key: string): void {
    const next = pickedKeys.has(key) ? picked.filter((p) => p.key !== key) : [...picked, { key, finished: true }];
    onChange(next.length > 0 ? { sessions: next } : { sessions: [], noneReason: null, noneNote: null });
  }
  function setFinished(key: string, finished: boolean): void {
    onChange({ sessions: picked.map((p) => (p.key === key ? { ...p, finished } : p)) });
  }

  return (
    <View style={{ gap: space(1) }}>
      <Body style={{ fontWeight: "700" }}>{STR.lpBlockTitle}</Body>

      {picked.map((p) => {
        const s = byKey.get(p.key);
        if (!s) return null;
        return (
          <View key={p.key} style={{ gap: 4 }}>
            <Body>{sessionLabel(s)}</Body>
            <ChipRow>
              <Chip label={STR.lpFinished} selected={p.finished} onPress={() => setFinished(p.key, true)} />
              <Chip label={STR.lpStarted} selected={!p.finished} onPress={() => setFinished(p.key, false)} />
              <Chip label={`✕ ${STR.lpRemove}`} onPress={() => toggle(p.key)} />
            </ChipRow>
          </View>
        );
      })}

      <Muted>{showAll ? STR.lpShowAll : STR.lpNext}</Muted>
      <ChipRow>
        {shown.map((s) => {
          const done = s.finishedOn.length > 0;
          return (
            <Chip
              key={s.key}
              label={`${done ? "✓ " : ""}${bnNum(s.chapter)}.${bnNum(s.sessionIndex)} ${s.titleBn}`}
              selected={pickedKeys.has(s.key)}
              onPress={() => toggle(s.key)}
            />
          );
        })}
      </ChipRow>
      {(plan.sessions.length > quick.length || showAll) ? (
        <Button title={showAll ? STR.lpShowLess : STR.lpShowAll} variant="ghost" onPress={() => setShowAll((x) => !x)} />
      ) : null}

      {picked.length === 0 ? (
        <View style={{ gap: 4 }}>
          <Muted>{STR.lpNoneTitle}</Muted>
          <ChipRow>
            {LESSON_NONE_REASONS.map((r) => (
              <Chip
                key={r}
                label={noneReasonLabel(r)}
                selected={value?.noneReason === r}
                onPress={() => onChange({ sessions: [], noneReason: value?.noneReason === r ? null : r, noneNote: value?.noneNote ?? null })}
              />
            ))}
          </ChipRow>
          {value?.noneReason ? (
            <Field
              label={STR.lpNoneNote}
              value={value.noneNote ?? ""}
              onChangeText={(t) => onChange({ sessions: [], noneReason: value.noneReason, noneNote: t })}
            />
          ) : null}
        </View>
      ) : null}
      {error ? <Muted style={{ color: "#b00020" }}>⚠ {error}</Muted> : null}
    </View>
  );
}
