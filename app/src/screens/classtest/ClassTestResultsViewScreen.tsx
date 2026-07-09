/**
 * ClassTestResultsViewScreen (CT-6, tracker:read) — read-only view of EVERY student's
 * result for one exam: marks / % / pass-fail, plus weakness + teacher action (internal,
 * staff-only) + guardian action + release state. No edit, no publish — a teacher/admin
 * reviews the whole class without touching the entry form or the publish screen.
 * %/pass-fail are DERIVED server-side (D-#85); teacher scope is enforced server-side.
 */
import React, { useMemo } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { STUDENTS_QUERY } from "../../graphql/operations";
import { CLASS_TEST_QUERY, CLASS_TEST_RESULTS_QUERY } from "../../graphql/classTest";
import { Screen, Card, Body, Muted, Badge, Loader, Notice } from "../../components/ui";
import { STR, hwSubjectLabel, bnNum } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ClassTestStackParamList, "ClassTestResultsView">;

export default function ClassTestResultsViewScreen({ route }: Props): React.ReactElement {
  const { testId, title } = route.params;

  const [testQ] = useQuery({ query: CLASS_TEST_QUERY, variables: { id: testId } });
  const test = testQ.data?.classTest ?? null;
  const [studentsQ] = useQuery({ query: STUDENTS_QUERY, variables: { sectionId: test?.sectionId ?? "" }, pause: !test });
  const students = (studentsQ.data?.studentsInSection ?? []).filter((s) => s.active);
  const [resultsQ] = useQuery({ query: CLASS_TEST_RESULTS_QUERY, variables: { testId } });
  const byStudent = useMemo(() => {
    const m = new Map<string, NonNullable<typeof resultsQ.data>["classTestResults"][number]>();
    for (const r of resultsQ.data?.classTestResults ?? []) m.set(r.studentId, r);
    return m;
  }, [resultsQ.data]);

  if (testQ.fetching) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }
  if (!test) {
    return (
      <Screen>
        <Notice message={STR.errGeneric} tone="danger" />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{title}</Body>
          <Muted>
            {hwSubjectLabel(test.subject)} · {STR.ctTotalMarks} {bnNum(test.totalMarks)} · {STR.ctPassMark}{" "}
            {bnNum(test.passMark)}
          </Muted>
        </Card>

        {studentsQ.fetching || resultsQ.fetching ? (
          <Loader label={STR.loading} />
        ) : students.length === 0 ? (
          <Card>
            <Muted>{STR.ctNoStudents}</Muted>
          </Card>
        ) : (
          students.map((s) => {
            const r = byStudent.get(s.id);
            const published = !!r?.publishedAt;
            return (
              <Card key={s.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{s.name}</Body>
                    <Muted>{s.schoolId}</Muted>
                  </View>
                  {!r ? (
                    <Badge text={STR.ctNotEntered} tone="muted" />
                  ) : r.status === "ABSENT" ? (
                    <Badge text={STR.ctAbsent} tone="muted" />
                  ) : (
                    <Badge
                      text={`${bnNum(r.marks ?? 0)}/${bnNum(r.totalMarks)} · ${r.pass ? STR.ctPass : STR.ctFail}`}
                      tone={r.pass ? "ok" : "danger"}
                    />
                  )}
                </View>

                {r ? (
                  <View style={{ marginTop: space(2), gap: 2 }}>
                    {r.weakness ? <Muted>{STR.ctWeakness}: {r.weakness}</Muted> : null}
                    {r.teacherAction ? <Muted>{STR.ctTeacherAction}: {r.teacherAction}</Muted> : null}
                    {r.guardianAction ? <Muted>{STR.ctGuardianAction}: {r.guardianAction}</Muted> : null}
                    <View style={{ marginTop: space(1) }}>
                      <Badge
                        text={published ? STR.ctPublishedBadge : STR.ctUnpublishedBadge}
                        tone={published ? "ok" : "muted"}
                      />
                    </View>
                  </View>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}
