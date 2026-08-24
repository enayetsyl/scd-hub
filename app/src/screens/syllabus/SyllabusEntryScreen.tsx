/**
 * SyllabusEntryScreen (SY-4) — the Office coverage board.
 *
 * The board answers ONE question before anything is opened: what is still
 * missing? Hence the "২৮ / ৪২ বিষয়" line at the top and a per-subject row that
 * says who is holding it. A three-actor chain without that holder line is a queue
 * nobody can chase.
 *
 * A subject with no mark rows reads "বাকি" rather than rendering as an ordinary
 * DRAFT row — a half-written row that looks finished is the failure this board
 * exists to prevent.
 */
import React, { useMemo } from "react";
import { RefreshControl, Pressable, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { EXAM_SYLLABUS_CLASS, type SyllabusT } from "../../graphql/examSyllabus";
import type { SyllabusStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Select, Badge, Button, EmptyState, Notice } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, routineSubjectLabel, examTermLabel } from "../../lib/labels";
import { useSyllabusPickers } from "../../lib/useSyllabusPickers";
import { usePullRefresh } from "../../lib/useRefresh";
import { useColors } from "../../theme";
import { space, typeScale } from "../../theme/tokens";

type Props = NativeStackScreenProps<SyllabusStackParamList, "SyllabusEntry">;

type Tone = "muted" | "info" | "gold" | "ok" | "warn";

/** Status → (label, tone). "বাকি" is a DERIVED state, not a stored one: a DRAFT
 *  row with no mark rows has not really been started. */
function statusChip(row: SyllabusT): { label: string; tone: Tone } {
  if (row.pending || row.marks.length === 0) return { label: STR.syNotWritten, tone: "warn" };
  switch (row.status) {
    case "PUBLISHED":
      return { label: STR.syStatPublished, tone: "ok" };
    case "PRINCIPAL_REVIEW":
      return { label: STR.syStatPrincipal, tone: "gold" };
    case "TEACHER_REVIEW":
      return { label: STR.syStatTeacher, tone: "info" };
    default:
      return { label: STR.syStatDraft, tone: "muted" };
  }
}

export default function SyllabusEntryScreen({ navigation }: Props): React.ReactElement {
  const colors = useColors();
  const pick = useSyllabusPickers();

  const [syllabusQ, refetch] = useQuery({
    query: EXAM_SYLLABUS_CLASS,
    variables: { examId: pick.examId ?? "", classId: pick.classId ?? "" },
    pause: !pick.examId || !pick.classId,
  });
  const view = syllabusQ.data?.examSyllabusClass ?? null;

  const refresh = usePullRefresh(syllabusQ.fetching, () => {
    pick.refetch();
    refetch({ requestPolicy: "network-only" });
  });

  // Coverage counts the subjects that actually have a distribution, not the rows
  // that merely exist — an empty row is the thing being counted as missing.
  const written = useMemo(
    () => (view?.subjects ?? []).filter((s) => !s.pending && s.marks.length > 0).length,
    [view?.subjects],
  );
  const totalSubjects = view?.subjects.length ?? 0;

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
        options={pick.exams.map((e) => ({ label: e.name, value: e.id, hint: examTermLabel(e.term) }))}
        onChange={pick.setExamId}
      />
      <Select
        label={STR.syPickClass}
        value={pick.classId}
        options={pick.classes.map((c) => ({ label: c.label, value: c.id }))}
        onChange={pick.setClassId}
      />

      <QueryGate result={syllabusQ} onRetry={() => refetch({ requestPolicy: "network-only" })}>
        {view ? (
          <View style={{ gap: space(3), marginTop: space(3) }}>
            {/* The per-class footer is a CLASS fact covering all eight subjects
                (§5.5); an unwritten one is called out here because nothing on the
                subject rows would ever reveal that it is missing. */}
            {!view.noteMd ? <Notice message={STR.syClassNoteMissing} tone="warn" /> : null}
            <Button
              title={STR.syClassNote}
              variant="secondary"
              onPress={() =>
                navigation.navigate("SyllabusClassNote", {
                  examId: view.examId,
                  classId: view.classId,
                  title: `${view.classLabel} — ${STR.syClassNote}`,
                })
              }
            />
            <Card>
              <Body style={{ ...typeScale.bodyStrong }}>{view.classLabel}</Body>
              <Muted>
                {bnNum(totalSubjects)} {STR.syOf} {bnNum(written)} {STR.syCoverage}
              </Muted>
            </Card>

            {/* An empty Card rendered as a bare white box on prod when a class had
                no subjects yet. There is always something to say instead. */}
            {view.subjects.length === 0 ? (
              <EmptyState message={STR.syNoSubjects} />
            ) : (
            <Card>
              {view.subjects.map((s) => {
                const chip = statusChip(s);
                return (
                  <Pressable
                    key={s.subject}
                    onPress={() =>
                      navigation.navigate("SyllabusEditor", {
                        examId: view.examId,
                        classId: view.classId,
                        subject: s.subject,
                        title: `${view.classLabel} — ${routineSubjectLabel(s.subject)}`,
                      })
                    }
                    accessibilityLabel={routineSubjectLabel(s.subject)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space(2),
                      paddingVertical: space(3),
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Body>{routineSubjectLabel(s.subject)}</Body>
                      {/* The row's second line is deliberately the most actionable
                          thing known about it: the send-back reason if there is one,
                          otherwise the distribution state. */}
                      <Muted>
                        {s.marks.length === 0
                          ? STR.syMustBe100
                          : `${STR.syMarks} ${bnNum(s.totalMarks)} · ${bnNum(s.marks.length)}`}
                      </Muted>
                    </View>
                    <Badge tone={chip.tone} text={chip.label} />
                  </Pressable>
                );
              })}
            </Card>
            )}
          </View>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
