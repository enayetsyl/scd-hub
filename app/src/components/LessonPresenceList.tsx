/**
 * LessonPresenceList (LP-3, D-#823) — session plans as taught to one child, each with a presence
 * badge (উপস্থিত / আংশিক / অনুপস্থিত / অজানা, ছুটিতে when every absence was leave-covered) and the
 * days it was taught. Used by the student profile's পাঠ tab and the mastery outcome trail.
 */
import React from "react";
import { View } from "react-native";
import type { StudentLessonSessionT } from "../graphql/mastery";
import { Body, Muted, Badge } from "./ui";
import { STR, bnNum } from "../lib/labels";
import { space } from "../theme/tokens";
import { dayMonth } from "../screens/lessonprogress/lessonProgressUi";

const TONE: Record<string, "ok" | "gold" | "danger" | "muted"> = { PRESENT: "ok", PARTIAL: "gold", ABSENT: "danger", UNKNOWN: "muted" };

export function presenceLabel(s: Pick<StudentLessonSessionT, "presence" | "onLeave">): string {
  if (s.presence === "ABSENT" && s.onLeave) return STR.lpOnLeave;
  return s.presence === "PRESENT" ? STR.lpPresent : s.presence === "PARTIAL" ? STR.lpPartial : s.presence === "ABSENT" ? STR.lpAbsent : STR.lpUnknown;
}

export function LessonPresenceList({ sessions, showChapter = true }: { sessions: StudentLessonSessionT[]; showChapter?: boolean }): React.ReactElement {
  return (
    <View style={{ gap: space(1) }}>
      {sessions.map((s) => (
        <View key={`${s.subject}|${s.key}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: space(2) }}>
          <View style={{ flex: 1 }}>
            <Body>
              {showChapter ? `${s.anchorWord} ${bnNum(s.chapter)} · ` : ""}
              {STR.lpSession} {bnNum(s.sessionIndex)}/{bnNum(s.sessionOf)} · {s.titleBn}
            </Body>
            <Muted>
              {s.taughtOn
                .map((d) => `${dayMonth(d)}${s.absentOn.includes(d) ? ` (${STR.lpAbsent})` : s.unknownOn.includes(d) ? ` (${STR.lpUnknown})` : ""}`)
                .join(", ")}
            </Muted>
          </View>
          <Badge text={presenceLabel(s)} tone={TONE[s.presence] ?? "muted"} />
        </View>
      ))}
    </View>
  );
}
