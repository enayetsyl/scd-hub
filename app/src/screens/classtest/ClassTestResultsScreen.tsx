/**
 * ClassTestResultsScreen (CT-5 / J3, tracker:write) — the per-student entry grid for
 * one printed exam. Pick a student → PRESENT (+ marks) or ABSENT, plus weakness +
 * teacher-action (internal) + guardian-action; %/pass-fail are DERIVED server-side
 * (D-#85). Prior results prefill the form. enterClassTestResult rides tracker:write +
 * the server section verify (only on/after the exam date) — the Bangla deny surfaces
 * inline. → Publish for the same exam.
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { STUDENTS_QUERY } from "../../graphql/operations";
import {
  CLASS_TEST_QUERY,
  CLASS_TEST_RESULTS_QUERY,
  ENTER_CLASS_TEST_RESULT,
} from "../../graphql/classTest";
import { Screen, Card, Body, Muted, Button, Badge, Chip, Field, Loader, Notice } from "../../components/ui";
import { STR, hwSubjectLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ClassTestStackParamList, "ClassTestResults">;
type Nav = NativeStackNavigationProp<ClassTestStackParamList>;

export default function ClassTestResultsScreen({ route }: Props): React.ReactElement {
  const { testId, title } = route.params;
  const nav = useNavigation<Nav>();

  const [testQ] = useQuery({ query: CLASS_TEST_QUERY, variables: { id: testId } });
  const test = testQ.data?.classTest ?? null;
  const [studentsQ] = useQuery({ query: STUDENTS_QUERY, variables: { sectionId: test?.sectionId ?? "" }, pause: !test });
  const students = (studentsQ.data?.studentsInSection ?? []).filter((s) => s.active);
  const [resultsQ, refetch] = useQuery({ query: CLASS_TEST_RESULTS_QUERY, variables: { testId } });
  const results = resultsQ.data?.classTestResults ?? [];
  const byStudent = useMemo(() => {
    const m = new Map<string, (typeof results)[number]>();
    for (const r of results) m.set(r.studentId, r);
    return m;
  }, [results]);

  const [, enter] = useMutation(ENTER_CLASS_TEST_RESULT);

  const [openId, setOpenId] = useState<string | null>(null);
  const [status, setStatus] = useState<"PRESENT" | "ABSENT">("PRESENT");
  const [marks, setMarks] = useState("");
  const [weakness, setWeakness] = useState("");
  const [teacherAction, setTeacherAction] = useState("");
  const [guardianAction, setGuardianAction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openStudent(studentId: string): void {
    setError(null);
    setOk(null);
    const existing = byStudent.get(studentId);
    setOpenId(studentId);
    setStatus((existing?.status as "PRESENT" | "ABSENT") ?? "PRESENT");
    setMarks(existing?.marks != null ? String(existing.marks) : "");
    setWeakness(existing?.weakness ?? "");
    setTeacherAction(existing?.teacherAction ?? "");
    setGuardianAction(existing?.guardianAction ?? "");
  }

  async function onSave(): Promise<void> {
    if (!openId) return;
    setError(null);
    setOk(null);
    setBusy(true);
    const res = await enter({
      testId,
      studentId: openId,
      status,
      marks: status === "PRESENT" && marks.trim() ? Number(marks) : null,
      weakness: weakness.trim() || null,
      teacherAction: teacherAction.trim() || null,
      guardianAction: guardianAction.trim() || null,
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.ctResultSaved);
    setOpenId(null);
    refetch({ requestPolicy: "network-only" });
  }

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
  if (test.status !== "PRINTED") {
    return (
      <Screen>
        <Notice message={STR.ctNotPrinted} tone="warn" />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700" }}>{title}</Body>
          <Muted>
            {hwSubjectLabel(test.subject)} · {STR.ctTotalMarks} {bnNum(test.totalMarks)} · {STR.ctPassMark}{" "}
            {bnNum(test.passMark)}
          </Muted>
          <View style={{ marginTop: space(2) }}>
            <Button
              title={STR.ctPublishTitle}
              variant="secondary"
              onPress={() => nav.navigate("ClassTestPublish", { testId, title })}
            />
          </View>
        </Card>

        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {studentsQ.fetching ? (
          <Loader label={STR.loading} />
        ) : students.length === 0 ? (
          <Card>
            <Muted>{STR.ctNoStudents}</Muted>
          </Card>
        ) : (
          students.map((s) => {
            const existing = byStudent.get(s.id);
            const isOpen = openId === s.id;
            return (
              <Card key={s.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{s.name}</Body>
                    <Muted>{s.schoolId}</Muted>
                  </View>
                  {existing ? (
                    existing.status === "ABSENT" ? (
                      <Badge text={STR.ctAbsent} tone="muted" />
                    ) : (
                      <Badge
                        text={`${bnNum(existing.marks ?? 0)}/${bnNum(existing.totalMarks)} · ${existing.pass ? STR.ctPass : STR.ctFail}`}
                        tone={existing.pass ? "ok" : "danger"}
                      />
                    )
                  ) : null}
                </View>

                {!isOpen ? (
                  <View style={{ marginTop: space(2) }}>
                    <Button title={STR.ctMark} variant="secondary" onPress={() => openStudent(s.id)} />
                  </View>
                ) : (
                  <View style={{ marginTop: space(2) }}>
                    <View style={{ flexDirection: "row", gap: space(2) }}>
                      <Chip label={STR.ctPresent} selected={status === "PRESENT"} onPress={() => setStatus("PRESENT")} />
                      <Chip label={STR.ctAbsent} selected={status === "ABSENT"} onPress={() => setStatus("ABSENT")} />
                    </View>
                    {status === "PRESENT" ? (
                      <Field label={`${STR.ctMarks} (0–${bnNum(test.totalMarks)})`} value={marks} onChangeText={setMarks} keyboardType="number-pad" />
                    ) : null}
                    <Field label={STR.ctWeakness} value={weakness} onChangeText={setWeakness} />
                    <Field label={STR.ctTeacherAction} value={teacherAction} onChangeText={setTeacherAction} helper={STR.ctTeacherActionHint} />
                    <Field label={STR.ctGuardianAction} value={guardianAction} onChangeText={setGuardianAction} />
                    <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                      <Button title={STR.ctSaveResult} onPress={onSave} loading={busy} disabled={busy} />
                      <Button title={STR.cancel} variant="ghost" onPress={() => setOpenId(null)} />
                    </View>
                  </View>
                )}
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}
