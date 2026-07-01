/**
 * ClassNoteReportScreen (R-5 admin view) — Principal/Office roll-up for a date:
 * each row groups a section or subject-group by the teacher who is actually
 * responsible that day, and shows which subjects were already posted vs still
 * pending. Rows jump back into the daily note editor.
 */
import React, { useState } from "react";
import { View, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { CLASS_NOTE_SUBMISSION_REPORT_QUERY } from "../../graphql/operations";
import type { RoutineStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Field, Notice, Loader } from "../../components/ui";
import { STR, bnNum, routineSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

const todayISO = (): string => new Date().toISOString().slice(0, 10);

type Props = NativeStackScreenProps<RoutineStackParamList, "ClassNoteReport">;

function SubjectList({
  subjects,
  emptyLabel,
  tone,
}: {
  subjects: string[];
  emptyLabel: string;
  tone: "ok" | "warn";
}): React.ReactElement {
  if (subjects.length === 0) return <Muted>{emptyLabel}</Muted>;
  return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
      {subjects.map((subject, index) => (
        <Badge key={`${subject}-${index}`} text={subject} tone={tone} />
      ))}
    </View>
  );
}

export default function ClassNoteReportScreen({ navigation, route }: Props): React.ReactElement {
  const [date, setDate] = useState(route.params?.date ?? todayISO());
  const [reportQ] = useQuery({ query: CLASS_NOTE_SUBMISSION_REPORT_QUERY, variables: { date } });

  const rows = reportQ.data?.classNoteSubmissionReport ?? [];
  const pendingTotal = rows.reduce((sum, row) => sum + row.pendingCount, 0);
  const postedTotal = rows.reduce((sum, row) => sum + row.publishedCount, 0);

  return (
    <Screen scroll>
      <Field label={STR.attDate} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
      {reportQ.error ? <Notice message={friendlyError(reportQ.error)} tone="danger" /> : null}
      {reportQ.fetching ? <Loader label={STR.loading} /> : null}

      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.rtNoteReportTitle}</Body>
        <Muted>{STR.rtNoteReportHint}</Muted>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
          <Badge text={`${STR.rtPendingSubjects}: ${bnNum(pendingTotal)}`} tone={pendingTotal > 0 ? "warn" : "ok"} />
          <Badge text={`${STR.rtPostedSubjects}: ${bnNum(postedTotal)}`} tone="ok" />
        </View>
      </Card>

      {rows.length === 0 && !reportQ.fetching ? <Notice message={STR.rtNoteReportEmpty} tone="ok" /> : null}

      <View style={{ gap: space(2), marginTop: space(2) }}>
        {rows.map((row) => {
          const primary = row.classNameBn ?? row.subjectGroupNameBn ?? STR.rtClassNote;
          const secondary = row.sectionNameBn;
          const title = secondary ? `${primary} · ${secondary}` : primary;
          return (
            <Card
              key={`${row.groupType}:${row.groupId}:${row.teacherId ?? "none"}`}
              onPress={() =>
                navigation.navigate("DailyNote", {
                  groupType: row.groupType,
                  groupId: row.groupId,
                  title,
                  date,
                })
              }
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: "700" }}>{primary}</Body>
                  {secondary ? <Muted>{secondary}</Muted> : null}
                  <Muted style={{ marginTop: 2 }}>
                    {STR.rtNoteTeacher}: {row.teacherName ?? "—"}
                    {row.teacherPhone ? ` · ${row.teacherPhone}` : ""}
                  </Muted>
                </View>
                <Badge text={`${STR.rtPendingSubjects}: ${bnNum(row.pendingCount)}`} tone={row.pendingCount > 0 ? "warn" : "ok"} />
              </View>

              <View style={{ marginTop: space(2), gap: space(2) }}>
                <View>
                  <Body style={{ fontWeight: "700" }}>{STR.rtPostedSubjects}</Body>
                  <SubjectList
                    subjects={row.publishedSubjects.map((subject) => routineSubjectLabel(subject))}
                    emptyLabel={STR.rtNoPostedSubjects}
                    tone="ok"
                  />
                </View>
                <View>
                  <Body style={{ fontWeight: "700" }}>{STR.rtPendingSubjects}</Body>
                  <SubjectList
                    subjects={row.pendingSubjects.map((subject) => routineSubjectLabel(subject))}
                    emptyLabel={STR.rtNoPendingSubjects}
                    tone="warn"
                  />
                </View>
              </View>
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}
