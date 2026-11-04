/**
 * OT-5 (prd-objective-tree §8.3, mock 6) — a শাখা's state per objective row: taught on which days
 * (or not yet), and who was absent that day. Shared by the class-note card (the picked sessions'
 * codes) and the lesson tracker (every row of the subject).
 *
 *   ObjectiveChips       — the labels a session teaches ("এই পাঠে পড়ানো হয়:")
 *   ObjectiveStatusRows  — one block per row: পড়ানো হয়েছে <dates> · সেদিন অনুপস্থিত N জন (names)
 */
import React from "react";
import { View } from "react-native";
import type { LessonObjectiveRowT } from "../graphql/operations";
import { Body, Muted, Badge } from "./ui";
import { STR, bnNum } from "../lib/labels";
import { space } from "../theme/tokens";
import { dayMonth } from "../screens/lessonprogress/lessonProgressUi";

/** The row's words: its catalogue label, else the bare code (a code the catalogue does not hold yet). */
export const objectiveLabel = (r: Pick<LessonObjectiveRowT, "code" | "labelBn">): string => r.labelBn ?? r.code;

/** "এই পাঠে পড়ানো হয়:" + one badge per code. Renders nothing for a session without codes. */
export function ObjectiveChips({ codes, rows }: { codes: string[]; rows: Map<string, LessonObjectiveRowT> }): React.ReactElement | null {
  if (codes.length === 0) return null;
  return (
    <View style={{ gap: 2 }}>
      <Muted>{STR.otTeaches}</Muted>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
        {codes.map((c) => {
          const r = rows.get(c);
          return <Badge key={c} text={r ? objectiveLabel(r) : c} tone="info" />;
        })}
      </View>
    </View>
  );
}

function absentLine(r: LessonObjectiveRowT): string | null {
  if (r.taught.length === 0) return null;
  const unknown = r.taught.some((t) => !t.attendanceTaken);
  if (r.absentCount === 0) return unknown ? `${STR.otAbsentThatDay}: ${STR.otNoAttendance}` : `${STR.otAbsentThatDay}: ${bnNum(0)}`;
  const names = [...new Set(r.taught.flatMap((t) => t.absent.map((a) => a.name)))].join(", ");
  return `${STR.otAbsentThatDay}: ${bnNum(r.absentCount)}${unknown ? "+" : ""}${STR.otPersons ? ` ${STR.otPersons}` : ""} — ${names}`;
}

export function ObjectiveStatusRows({ rows }: { rows: LessonObjectiveRowT[] }): React.ReactElement {
  return (
    <View style={{ gap: space(2) }}>
      {rows.map((r) => {
        const taught = r.taught.length > 0;
        const absent = absentLine(r);
        return (
          <View key={r.code} style={{ gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(2) }}>
              <Body style={{ flex: 1, fontWeight: "600" }}>{objectiveLabel(r)}</Body>
              <Badge text={taught ? STR.otTaughtOn : STR.otNotTaughtYet} tone={taught ? "ok" : "muted"} />
            </View>
            {taught ? <Muted>{`${STR.otTaughtOn}: ${r.taught.map((t) => dayMonth(t.dateKey)).join(", ")}`}</Muted> : null}
            {absent ? <Muted>{absent}</Muted> : null}
            {r.sessions.length === 0 ? <Muted>{STR.otNotInPlan}</Muted> : null}
          </View>
        );
      })}
    </View>
  );
}
