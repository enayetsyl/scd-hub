/**
 * SyllabusHomeScreen (SY-6) — the staff read screen.
 *
 * The owner's shape: pick an exam and a class, then a GRID OF SUBJECT-NAME
 * BUTTONS; tapping one opens the syllabus and its mark distribution. The button
 * face carries only what a reader scans for — the subject and its exam date.
 *
 * A subject the caller teaches that is not published yet stays on the grid as a
 * dimmed "প্রকাশ হয়নি" button rather than disappearing: an absent button reads as
 * "this class does not sit Arabic", a dimmed one reads as "not ready yet", and
 * only the second is true.
 *
 * Registered FIRST in its stack — a param-requiring screen in that position
 * becomes the stack's initial route and crashes the tab at runtime, which neither
 * tsc nor `expo export` catches.
 */
import React from "react";
import { RefreshControl, Pressable, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { EXAM_SYLLABUS_CLASS } from "../../graphql/examSyllabus";
import type { SyllabusStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Select, EmptyState, Badge } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, routineSubjectLabel, examTermLabel } from "../../lib/labels";
import { useSyllabusPickers } from "../../lib/useSyllabusPickers";
import { usePullRefresh } from "../../lib/useRefresh";
import { useColors } from "../../theme";
import { space, typeScale, radius } from "../../theme/tokens";

type Props = NativeStackScreenProps<SyllabusStackParamList, "SyllabusHome">;

export default function SyllabusHomeScreen({ navigation }: Props): React.ReactElement {
  const colors = useColors();
  const pick = useSyllabusPickers();

  const [syllabusQ, refetchSyllabus] = useQuery({
    query: EXAM_SYLLABUS_CLASS,
    variables: { examId: pick.examId ?? "", classId: pick.classId ?? "" },
    pause: !pick.examId || !pick.classId,
  });
  const view = syllabusQ.data?.examSyllabusClass ?? null;

  const refresh = usePullRefresh(syllabusQ.fetching, () => {
    pick.refetch();
    refetchSyllabus({ requestPolicy: "network-only" });
  });

  if (!pick.loading && pick.exams.length === 0) {
    return (
      <Screen scroll>
        <EmptyState message={STR.syNoExam} />
      </Screen>
    );
  }

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />}>
      <Select
        label={STR.syPickExam}
        value={pick.examId}
        options={pick.exams.map((e) => ({
          label: e.name,
          value: e.id,
          hint: examTermLabel(e.term),
        }))}
        onChange={pick.setExamId}
      />
      <Select
        label={STR.syPickClass}
        value={pick.classId}
        options={pick.classes.map((c) => ({ label: c.label, value: c.id }))}
        onChange={pick.setClassId}
      />

      <QueryGate
        result={syllabusQ}
        onRetry={() => refetchSyllabus({ requestPolicy: "network-only" })}
      >
        {view ? (
          <View style={{ gap: space(3), marginTop: space(3) }}>
            {/* The per-CLASS footer, rendered ONCE at the top — matching the source
                sheet, where it is a single line per class, not one per subject. */}
            {view.noteMd ? (
              <Card>
                <Body style={{ fontWeight: "700" }}>{STR.syClassNote}</Body>
                <Muted>{view.noteMd}</Muted>
              </Card>
            ) : null}

            {view.subjects.length === 0 ? (
              <EmptyState message={STR.syNoSubjects} />
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                {view.subjects.map((s) => {
                  const disabled = s.pending;
                  return (
                    <Pressable
                      key={s.subject}
                      disabled={disabled}
                      onPress={() =>
                        navigation.navigate("SyllabusDetail", {
                          examId: view.examId,
                          classId: view.classId,
                          subject: s.subject,
                          title: routineSubjectLabel(s.subject),
                        })
                      }
                      accessibilityLabel={routineSubjectLabel(s.subject)}
                      style={{
                        flexGrow: 1,
                        flexBasis: "46%",
                        minHeight: 64,
                        justifyContent: "center",
                        borderRadius: radius.md,
                        borderWidth: s.isMine ? 2 : 1,
                        borderColor: s.isMine ? colors.primary : colors.border,
                        backgroundColor: disabled ? colors.surfaceAlt : colors.surface,
                        paddingVertical: space(3),
                        paddingHorizontal: space(3),
                      }}
                    >
                      <Body
                        style={{
                          ...typeScale.bodyStrong,
                          color: disabled ? colors.textDisabled : colors.textPrimary,
                        }}
                      >
                        {routineSubjectLabel(s.subject)}
                      </Body>
                      <Muted>
                        {disabled
                          ? STR.syNotPublished
                          : `${s.examDateKey ? `${s.examDateKey} · ` : ""}${bnNum(s.totalMarks)}`}
                      </Muted>
                      {s.isMine && !disabled ? <Badge tone="brand" text={STR.syMine} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
