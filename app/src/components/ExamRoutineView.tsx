/**
 * ExamRoutineView (D-#883) — one class's routine as dated rows, and the Quran exam's days.
 * Shared by the staff routine screen and the guardian's, so a teacher and a family read
 * the same lines.
 */
import React from "react";
import { View } from "react-native";
import type { ExamRoutineQuranDayT, ExamRoutineSlotT } from "../graphql/examRoutine";
import { Body, Card, Muted } from "./ui";
import { STR, fullDateLabel, routineSubjectLabel } from "../lib/labels";
import { qxLevelLabel, qxRange } from "../lib/quranExam";
import { space, typeScale } from "../theme/tokens";

/** "লিখিত · ৮:০০–১১:০০" / "মৌখিক · শ্রেণির সময়ে". */
export function slotWhen(s: Pick<ExamRoutineSlotT, "kind" | "start" | "end">): string {
  const kind = s.kind === "ORAL" ? STR.exrOral : STR.exrWritten;
  return `${kind} · ${s.start && s.end ? qxRange(s.start, s.end) : STR.exrClassTime}`;
}

export function RoutineSlots({ slots }: { slots: ExamRoutineSlotT[] }): React.ReactElement {
  if (slots.length === 0) return <Muted>{STR.exrNoSlots}</Muted>;
  return (
    <View style={{ gap: space(2) }}>
      {slots.map((s) => (
        <View key={`${s.dateKey}|${s.subject}|${s.kind}`} style={{ gap: 2 }}>
          <Muted>{fullDateLabel(s.dateKey)}</Muted>
          <Body style={{ ...typeScale.bodyStrong }}>{routineSubjectLabel(s.subject)}</Body>
          <Muted>{slotWhen(s)}</Muted>
          {s.note ? <Muted>{s.note}</Muted> : null}
        </View>
      ))}
    </View>
  );
}

export function QuranDaysCard({ days }: { days: ExamRoutineQuranDayT[] }): React.ReactElement | null {
  if (days.length === 0) return null;
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.exrQuranTitle}</Body>
      <Muted>{STR.exrQuranHint}</Muted>
      <View style={{ gap: space(2), marginTop: space(2) }}>
        {days.map((d) => (
          <View key={d.dateKey} style={{ gap: 2 }}>
            <Muted>{fullDateLabel(d.dateKey)}</Muted>
            <Body style={{ ...typeScale.bodyStrong }}>
              {d.levels.length ? d.levels.map(qxLevelLabel).join(", ") : STR.exrQuranMakeUp}
              {d.levels.length && d.makeUp ? ` · ${STR.exrQuranMakeUp}` : ""}
            </Body>
            {d.start && d.end ? <Muted>{qxRange(d.start, d.end)}</Muted> : null}
          </View>
        ))}
      </View>
    </Card>
  );
}

/** The exam a routine screen opens on: the first one not yet over, else the latest. */
export function currentExamId(exams: { id: string; endDateKey: string | null }[], todayKey: string): string | null {
  const open = exams
    .filter((e) => e.endDateKey && e.endDateKey >= todayKey)
    .sort((a, b) => (a.endDateKey ?? "").localeCompare(b.endDateKey ?? ""));
  return (open[0] ?? exams[0])?.id ?? null;
}
