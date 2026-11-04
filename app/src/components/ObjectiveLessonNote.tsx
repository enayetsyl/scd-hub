/**
 * ObjectiveLessonNote (OT-5, D-#950) — one line under a mastery row: was this objective taught in
 * the child's শাখা, and was the child there? On a WEAK row it is the split the PRD asks for:
 *   TAUGHT     → "পড়ানো হয়েছে, এখনও শেখেনি" (taught, not yet learnt)
 *   MISSED     → "যেদিন পড়ানো হয় সেদিন অনুপস্থিত ছিল" (missed that class)
 *   NOT_TAUGHT → "এখনও ক্লাসে পড়ানো হয়নি" (not taught yet)
 *   UNKNOWN    → taught, no attendance that day (never assumed present)
 * Self-contained so the mastery screens only mount it (OT-3 changes those screens in parallel).
 */
import React from "react";
import { View } from "react-native";
import type { ObjectiveLessonT } from "../graphql/mastery";
import { Muted, Badge } from "./ui";
import { STR } from "../lib/labels";
import { dayMonth } from "../screens/lessonprogress/lessonProgressUi";

type Tone = "ok" | "gold" | "danger" | "muted" | "info";

/** The words + tone for a status; `weak` picks "taught, not yet learnt" over plain "taught". Pure. */
export function objectiveLessonWords(l: Pick<ObjectiveLessonT, "status" | "onLeave">, weak: boolean): { text: string; tone: Tone } {
  switch (l.status) {
    case "MISSED":
      return { text: l.onLeave ? `${STR.otMissed} (${STR.lpOnLeave})` : STR.otMissed, tone: "danger" };
    case "TAUGHT":
      return weak ? { text: STR.otWeakTaught, tone: "gold" } : { text: STR.otTaught, tone: "ok" };
    case "UNKNOWN":
      return { text: STR.otTaughtUnknown, tone: "muted" };
    default:
      return { text: STR.otNotTaught, tone: "info" };
  }
}

export function ObjectiveLessonNote({
  lesson,
  state,
  showDates = false,
}: {
  lesson: ObjectiveLessonT | null | undefined;
  /** The row's mastery state (WEAK picks the "not yet learnt" wording). */
  state: string;
  showDates?: boolean;
}): React.ReactElement | null {
  if (!lesson) return null;
  const w = objectiveLessonWords(lesson, state === "WEAK");
  const dates = lesson.taughtOn
    .map((d) => `${dayMonth(d)}${lesson.absentOn.includes(d) ? ` (${STR.lpAbsent})` : ""}`)
    .join(", ");
  return (
    <View style={{ gap: 2, alignItems: "flex-start" }}>
      <Badge text={w.text} tone={w.tone} />
      {showDates && dates ? <Muted>{`${STR.otTaughtOn}: ${dates}`}</Muted> : null}
    </View>
  );
}
