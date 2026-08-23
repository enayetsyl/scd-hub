/**
 * ChildSyllabusScreen (SY-6) — the selected child's exam syllabus.
 *
 * Read-only and link-scoped server-side (`guardian:read_child` +
 * `assertGuardianOfStudent`), and PUBLISHED rows only — the server applies that
 * predicate in the guardian resolver itself rather than through a role branch, so
 * a guardian never depends on a role test to be kept out of drafts.
 *
 * Same shape as the staff read screen, deliberately: subject-name buttons first,
 * the syllabus and mark distribution behind one tap. A parent's first question is
 * "which subjects, which dates" — the button face answers it.
 */
import React, { useState } from "react";
import { RefreshControl, Pressable, View } from "react-native";
import { useQuery } from "urql";
import { GUARDIAN_CHILD_SYLLABUS, type SyllabusT } from "../../graphql/examSyllabus";
import { Screen, Body, Muted, Card, Select, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import SyllabusView from "../../components/SyllabusView";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { useSyllabusPickers } from "../../lib/useSyllabusPickers";
import { usePullRefresh } from "../../lib/useRefresh";
import { STR, bnNum, routineSubjectLabel, examTermLabel } from "../../lib/labels";
import { useColors } from "../../theme";
import { space, typeScale, radius } from "../../theme/tokens";

export default function ChildSyllabusScreen(): React.ReactElement {
  const colors = useColors();
  const { selected } = useGuardianChild();
  const pick = useSyllabusPickers();
  const [openSubject, setOpenSubject] = useState<string | null>(null);

  const [q, refetch] = useQuery({
    query: GUARDIAN_CHILD_SYLLABUS,
    variables: { examId: pick.examId ?? "", studentId: selected?.studentId ?? "" },
    pause: !pick.examId || !selected,
  });
  const view = q.data?.guardianChildSyllabus ?? null;
  const refresh = usePullRefresh(q.fetching, () => {
    pick.refetch();
    refetch({ requestPolicy: "network-only" });
  });

  const opened: SyllabusT | null =
    view?.subjects.find((s) => s.subject === openSubject) ?? null;

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />}>
      <ChildSwitcher />

      {pick.exams.length === 0 && !pick.loading ? (
        <EmptyState message={STR.syNoExam} />
      ) : (
        <>
          <Select
            label={STR.syPickExam}
            value={pick.examId}
            options={pick.exams.map((e) => ({
              label: e.name,
              value: e.id,
              hint: examTermLabel(e.term),
            }))}
            onChange={(v) => {
              pick.setExamId(v);
              setOpenSubject(null);
            }}
          />

          <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })}>
            {view ? (
              <View style={{ gap: space(3), marginTop: space(3) }}>
                <Card>
                  <Body style={typeScale.bodyStrong}>{view.classLabel}</Body>
                  {/* The class footer, once at the top — as on the printed sheet. */}
                  {view.noteMd ? <Muted>{view.noteMd}</Muted> : null}
                </Card>

                {view.subjects.length === 0 ? (
                  <EmptyState message={STR.syNoSubjects} />
                ) : (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                    {view.subjects.map((s) => {
                      const active = s.subject === openSubject;
                      return (
                        <Pressable
                          key={s.subject}
                          onPress={() => setOpenSubject(active ? null : s.subject)}
                          accessibilityLabel={routineSubjectLabel(s.subject)}
                          style={{
                            flexGrow: 1,
                            flexBasis: "46%",
                            minHeight: 64,
                            justifyContent: "center",
                            borderRadius: radius.md,
                            borderWidth: active ? 2 : 1,
                            borderColor: active ? colors.primary : colors.border,
                            backgroundColor: colors.surface,
                            paddingVertical: space(3),
                            paddingHorizontal: space(3),
                          }}
                        >
                          <Body style={typeScale.bodyStrong}>
                            {routineSubjectLabel(s.subject)}
                          </Body>
                          <Muted>
                            {s.examDateKey ? `${s.examDateKey} · ` : ""}
                            {bnNum(s.totalMarks)}
                          </Muted>
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                {opened ? <SyllabusView row={opened} /> : null}
              </View>
            ) : null}
          </QueryGate>
        </>
      )}
    </Screen>
  );
}
