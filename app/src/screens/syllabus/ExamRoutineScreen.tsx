/**
 * ExamRoutineScreen (D-#883) — "পরীক্ষার রুটিন", in the syllabus section so the routine,
 * the syllabus and the mark distribution sit in one place. Every class's routine (a class
 * chip narrows it) and the Quran exam's days.
 *
 * Teachers see it once published; the Office sees the draft too, with Edit and Publish.
 * Takes no params, so it may sit anywhere in the stack.
 */
import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { EXAM_ROUTINE, PUBLISH_EXAM_ROUTINE } from "../../graphql/examRoutine";
import type { SyllabusStackParamList } from "../../navigation/types";
import { Badge, Body, Button, Card, Chip, ChipRow, EmptyState, ErrorBanner, Muted, Screen, Select } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { QuranDaysCard, RoutineSlots, currentExamId } from "../../components/ExamRoutineView";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../state/ConfirmContext";
import { useSyllabusPickers } from "../../lib/useSyllabusPickers";
import { usePullRefresh } from "../../lib/useRefresh";
import { friendlyError } from "../../lib/errors";
import { STR, dhakaDateKey, examTermLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<SyllabusStackParamList, "ExamRoutine">;

export default function ExamRoutineScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const { confirmAction } = useConfirm();
  const pick = useSyllabusPickers();
  const [chosen, setChosen] = useState<string | null>(null);
  const examId = chosen ?? currentExamId(pick.exams, dhakaDateKey());
  const [classFilter, setClassFilter] = useState<string | null>(null);

  const [q, refetch] = useQuery({ query: EXAM_ROUTINE, variables: { examId: examId ?? "" }, pause: !examId });
  const [pub, publish] = useMutation(PUBLISH_EXAM_ROUTINE);
  const refresh = usePullRefresh(q.fetching, () => {
    pick.refetch();
    if (examId) refetch({ requestPolicy: "network-only" });
  });
  const r = q.data?.examRoutine ?? null;
  const canManage = can("exam_routine:manage");
  const canPublish = can("exam_routine:publish");
  const office = canManage || canPublish;

  async function togglePublish() {
    if (!r) return;
    const on = !r.published;
    if (!(await confirmAction({ title: on ? STR.exrPublish : STR.exrUnpublish, message: on ? STR.exrPublishConfirm : STR.exrUnpublishConfirm }))) return;
    await publish({ examId: r.examId, publish: on });
  }

  if (!pick.loading && pick.exams.length === 0) {
    return (
      <Screen scroll>
        <EmptyState message={STR.syNoExam} />
      </Screen>
    );
  }

  const classes = (r?.classes ?? []).filter((c) => office || c.slots.length > 0);
  const shown = classFilter ? classes.filter((c) => c.classId === classFilter) : classes;
  const hasSlots = classes.some((c) => c.slots.length > 0);

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />}>
      <Select
        label={STR.syPickExam}
        value={examId}
        options={pick.exams.map((e) => ({ label: e.name, value: e.id, hint: examTermLabel(e.term) }))}
        onChange={(v) => {
          setChosen(v);
          setClassFilter(null);
        }}
      />
      <QueryGate result={q} onRetry={() => examId && refetch({ requestPolicy: "network-only" })}>
        {r ? (
          <View style={{ gap: space(3), marginTop: space(3) }}>
            {office ? (
              <Card>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
                  <Body style={{ flexGrow: 1, fontWeight: "700" }}>{r.examName}</Body>
                  <Badge text={r.published ? STR.exrPublished : STR.exrDraft} tone={r.published ? "ok" : "gold"} />
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                  {canManage ? (
                    <Button title={STR.exrEdit} variant="secondary" onPress={() => navigation.navigate("ExamRoutineEdit", { examId: r.examId })} />
                  ) : null}
                  {canPublish && hasSlots ? (
                    <Button
                      title={r.published ? STR.exrUnpublish : STR.exrPublish}
                      variant={r.published ? "ghost" : "primary"}
                      loading={pub.fetching}
                      onPress={() => void togglePublish()}
                    />
                  ) : null}
                </View>
                {pub.error ? <ErrorBanner message={friendlyError(pub.error)} /> : null}
              </Card>
            ) : null}

            {!r.published && !office ? <EmptyState message={STR.exrNotPublished} /> : null}

            {classes.length > 1 ? (
              <ChipRow>
                <Chip label={STR.exrAllClasses} selected={classFilter === null} onPress={() => setClassFilter(null)} />
                {classes.map((c) => (
                  <Chip key={c.classId} label={c.labelBn} selected={classFilter === c.classId} onPress={() => setClassFilter(c.classId)} />
                ))}
              </ChipRow>
            ) : null}

            {shown.map((c) => (
              <Card key={c.classId}>
                <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{c.labelBn}</Body>
                <RoutineSlots slots={c.slots} />
              </Card>
            ))}

            {r.noteBn && hasSlots ? <Muted>{r.noteBn}</Muted> : null}

            {classFilter === null ? <QuranDaysCard days={r.quranDays} /> : null}
          </View>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
