/**
 * GuardianQuranExamCard (D-#877) — the guardian's Today section: the selected child's
 * Quran exam sittings (date, time, portion; never the examiner), from publish until the
 * child's last sitting day ends. Own query → mounted beside the home QueryGate.
 */
import React from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { QX_MY_SCHEDULE } from "../graphql/quranExam";
import { Body, Card, Muted } from "./ui";
import { STR, dhakaDateKey, fullDateLabel } from "../lib/labels";
import { qxLevelLabel, qxRange } from "../lib/quranExam";
import { space } from "../theme";

export function GuardianQuranExamCard({ studentId }: { studentId: string | null }): React.ReactElement | null {
  const [q] = useQuery({ query: QX_MY_SCHEDULE });
  const today = dhakaDateKey();
  const child = (q.data?.myQuranExamSchedule ?? []).find((c) => c.studentId === studentId);
  if (!child) return null;
  const upcoming = child.sittings.filter((s) => s.dateKey >= today);
  if (!upcoming.length) return null;
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>
        {STR.qxGpCard} · {qxLevelLabel(child.level)}
      </Body>
      <View style={{ gap: space(1), marginTop: space(1) }}>
        {upcoming.map((s, i) => (
          <Muted key={i}>
            {fullDateLabel(s.dateKey)} · {qxRange(s.start, s.end)} · {s.portionLabel}
          </Muted>
        ))}
      </View>
    </Card>
  );
}
