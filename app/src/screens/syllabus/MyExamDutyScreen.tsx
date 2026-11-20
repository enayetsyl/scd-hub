/**
 * MyExamDutyScreen (D-#1660) — "আমার পরীক্ষার ডিউটি": the caller's own upcoming exam duties,
 * grouped by day (date, time, class, room). Opened from the sidebar, the Today card and
 * the notification a teacher gets when a duty is given, changed or taken off.
 */
import React from "react";
import { RefreshControl, View } from "react-native";
import { useQuery } from "urql";
import { MY_EXAM_DUTIES, type MyExamDutyT } from "../../graphql/examDuty";
import { Body, Card, EmptyState, Muted, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { usePullRefresh } from "../../lib/useRefresh";
import { STR, fullDateLabel, routineSubjectLabel } from "../../lib/labels";
import { qxRange } from "../../lib/quranExam";
import { space, typeScale } from "../../theme/tokens";

export function dutyWhen(d: Pick<MyExamDutyT, "kind" | "start" | "end">): string {
  const kind = d.kind === "ORAL" ? STR.exrOral : STR.exrWritten;
  return `${kind} · ${d.start && d.end ? qxRange(d.start, d.end) : STR.exrClassTime}`;
}

export function dutyWhere(d: Pick<MyExamDutyT, "classLabelBn" | "room">): string {
  return d.room ? `${d.classLabelBn} · ${STR.edRoomPrefix.replace("{room}", d.room)}` : d.classLabelBn;
}

export default function MyExamDutyScreen(): React.ReactElement {
  const [q, reexec] = useQuery({ query: MY_EXAM_DUTIES });
  const refresh = usePullRefresh(q.fetching, () => reexec({ requestPolicy: "network-only" }));
  const rows = q.data?.mySittingDuties ?? [];
  const days = [...new Set(rows.map((r) => r.dateKey))];

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />}>
      <QueryGate result={q} onRetry={() => reexec({ requestPolicy: "network-only" })}>
        {rows.length === 0 ? (
          <EmptyState message={STR.edMyEmpty} />
        ) : (
          <View style={{ gap: space(3) }}>
            <Muted>{STR.edHint}</Muted>
            {days.map((day) => (
              <Card key={day}>
                <Body style={{ ...typeScale.bodyStrong }}>{fullDateLabel(day)}</Body>
                <View style={{ gap: space(2), marginTop: space(2) }}>
                  {rows
                    .filter((r) => r.dateKey === day)
                    .map((r) => (
                      <View key={r.id} style={{ gap: 2 }}>
                        <Body style={{ ...typeScale.bodyStrong }}>{routineSubjectLabel(r.subject)}</Body>
                        <Muted>{dutyWhen(r)}</Muted>
                        <Muted>{dutyWhere(r)}</Muted>
                      </View>
                    ))}
                </View>
              </Card>
            ))}
          </View>
        )}
      </QueryGate>
    </Screen>
  );
}
