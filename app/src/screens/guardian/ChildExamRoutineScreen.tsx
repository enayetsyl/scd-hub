/**
 * ChildExamRoutineScreen (D-#883) — the selected child's exam routine: their class's
 * dated papers (once published) and their own Quran exam sittings, never the examiner.
 * Link-scoped server-side (`guardian:read_child` + assertGuardianOfStudent).
 */
import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useQuery } from "urql";
import { GUARDIAN_EXAM_ROUTINE } from "../../graphql/examRoutine";
import { Body, Card, EmptyState, Muted, Screen, Select } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { RoutineSlots, currentExamId } from "../../components/ExamRoutineView";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { useSyllabusPickers } from "../../lib/useSyllabusPickers";
import { usePullRefresh } from "../../lib/useRefresh";
import { STR, dhakaDateKey, examTermLabel, fullDateLabel } from "../../lib/labels";
import { qxLevelLabel, qxRange } from "../../lib/quranExam";
import { space, typeScale } from "../../theme/tokens";

export default function ChildExamRoutineScreen(): React.ReactElement {
  const { selected } = useGuardianChild();
  const pick = useSyllabusPickers();
  const [chosen, setChosen] = useState<string | null>(null);
  const examId = chosen ?? currentExamId(pick.exams, dhakaDateKey());
  const ready = !!examId && !!selected;
  const [q, refetch] = useQuery({
    query: GUARDIAN_EXAM_ROUTINE,
    variables: { examId: examId ?? "", studentId: selected?.studentId ?? "" },
    pause: !ready,
  });
  const refresh = usePullRefresh(q.fetching, () => {
    pick.refetch();
    if (ready) refetch({ requestPolicy: "network-only" });
  });
  const r = q.data?.guardianExamRoutine ?? null;

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />}>
      <ChildSwitcher />
      {pick.exams.length === 0 && !pick.loading ? (
        <EmptyState message={STR.syNoExam} />
      ) : (
        <>
          <Select
            label={STR.syPickExam}
            value={examId}
            options={pick.exams.map((e) => ({ label: e.name, value: e.id, hint: examTermLabel(e.term) }))}
            onChange={setChosen}
          />
          <QueryGate result={q} onRetry={() => ready && refetch({ requestPolicy: "network-only" })}>
            {r ? (
              <View style={{ gap: space(3), marginTop: space(3) }}>
                <Card>
                  <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{r.classLabelBn}</Body>
                  {r.published ? <RoutineSlots slots={r.slots} /> : <Muted>{STR.exrNotPublished}</Muted>}
                  {r.published && r.noteBn ? <Muted style={{ marginTop: space(2) }}>{r.noteBn}</Muted> : null}
                </Card>
                {r.quranSittings.length > 0 ? (
                  <Card>
                    <Body style={{ fontWeight: "700" }}>{STR.exrChildQuran}</Body>
                    <Muted>{qxLevelLabel(r.quranSittings[0]!.level)}</Muted>
                    <View style={{ gap: space(2), marginTop: space(2) }}>
                      {r.quranSittings.map((s) => (
                        <View key={`${s.dateKey}|${s.start}`} style={{ gap: 2 }}>
                          <Muted>{fullDateLabel(s.dateKey)}</Muted>
                          <Body style={{ ...typeScale.bodyStrong }}>{qxRange(s.start, s.end)}</Body>
                          {s.portionLabel ? <Muted>{s.portionLabel}</Muted> : null}
                        </View>
                      ))}
                    </View>
                  </Card>
                ) : null}
              </View>
            ) : null}
          </QueryGate>
        </>
      )}
    </Screen>
  );
}
