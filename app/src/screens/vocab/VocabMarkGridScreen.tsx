/**
 * VocabMarkGridScreen (VC-5 / J4) — the student × position marking grid. Pick a
 * student → mark PRESENT/ABSENT; for a PRESENT student tap the wrong cells per
 * position (a 2-field DICTATION shows two sub-fields), then submit WHOLESALE
 * (submitVocabStudentResult replaces that student's mistakes). Score/wrong-count are
 * DERIVED server-side (D-#85). Marking rides tracker:write + the server operator gate
 * (assigned/covering tester) — the Bangla deny surfaces inline if the caller can't.
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { VOCAB_DICTATION_FIELDS, type VocabProgram } from "@scd/shared";
import {
  VOCAB_TEST_QUERY,
  VOCAB_TEST_POSITIONS_QUERY,
  VOCAB_WORDS_QUERY,
  STUDENTS_QUERY,
  VOCAB_TEST_RESULTS_QUERY,
  SUBMIT_VOCAB_STUDENT_RESULT,
  type VocabMistakeIn,
} from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Badge, Chip, Loader, Notice } from "../../components/ui";
import { STR, vocabDirectionLabel, vocabProgramLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { VocabStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<VocabStackParamList, "VocabMarkGrid">;

export default function VocabMarkGridScreen({ route }: Props): React.ReactElement {
  const { testId } = route.params;

  const [testQ] = useQuery({ query: VOCAB_TEST_QUERY, variables: { testId } });
  const test = testQ.data?.vocabTest ?? null;
  const [posQ] = useQuery({ query: VOCAB_TEST_POSITIONS_QUERY, variables: { testId } });
  const positions = posQ.data?.vocabTestPositions ?? [];
  const [wordsQ] = useQuery({
    query: VOCAB_WORDS_QUERY,
    variables: { program: test?.program ?? "", classLevel: test?.classLevel ?? 0, includeInactive: true },
    pause: !test,
  });
  const wordById = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of wordsQ.data?.vocabWords ?? []) m.set(w.id, w.headword);
    return m;
  }, [wordsQ.data]);
  const [studentsQ] = useQuery({
    query: STUDENTS_QUERY,
    variables: { sectionId: test?.sectionId ?? "" },
    pause: !test,
  });
  const students = (studentsQ.data?.studentsInSection ?? []).filter((s) => s.active);
  const [resultsQ, refetchResults] = useQuery({ query: VOCAB_TEST_RESULTS_QUERY, variables: { testId } });
  const results = resultsQ.data?.vocabTestResults ?? [];
  const resultByStudent = useMemo(() => {
    const m = new Map<string, (typeof results)[number]>();
    for (const r of results) m.set(r.studentId, r);
    return m;
  }, [results]);

  const [, submit] = useMutation(SUBMIT_VOCAB_STUDENT_RESULT);

  // Per-student editing state (one open at a time).
  const [openId, setOpenId] = useState<string | null>(null);
  const [status, setStatus] = useState<"PRESENT" | "ABSENT">("PRESENT");
  const [wrongMap, setWrongMap] = useState<Record<string, number[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fieldCount = (direction: string): number =>
    direction === "DICTATION" && test ? VOCAB_DICTATION_FIELDS[test.program as VocabProgram] : 1;

  function openStudent(studentId: string): void {
    setError(null);
    setOk(null);
    const existing = resultByStudent.get(studentId);
    setOpenId(studentId);
    setStatus((existing?.status as "PRESENT" | "ABSENT") ?? "PRESENT");
    const map: Record<string, number[]> = {};
    for (const w of existing?.wrongWords ?? []) map[w.positionId] = [...w.wrongFields];
    setWrongMap(map);
  }

  function toggleField(positionId: string, field: number): void {
    setWrongMap((prev) => {
      const cur = prev[positionId] ?? [];
      const next = cur.includes(field) ? cur.filter((f) => f !== field) : [...cur, field];
      const copy = { ...prev };
      if (next.length === 0) delete copy[positionId];
      else copy[positionId] = next;
      return copy;
    });
  }

  async function onSubmit(): Promise<void> {
    if (!openId) return;
    setError(null);
    setOk(null);
    const mistakes: VocabMistakeIn[] =
      status === "ABSENT"
        ? []
        : Object.entries(wrongMap)
            .filter(([, fields]) => fields.length > 0)
            .map(([positionId, wrongFields]) => ({ positionId, wrongFields: [...wrongFields].sort() }));
    setBusy(true);
    const res = await submit({ testId, studentId: openId, status, mistakes });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.vbResultSaved);
    setOpenId(null);
    refetchResults({ requestPolicy: "network-only" });
  }

  if (testQ.fetching || posQ.fetching) {
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
  if (positions.length === 0) {
    return (
      <Screen>
        <Notice message={STR.vbNoPositions} tone="warn" />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>
            {vocabProgramLabel(test.program)} · {test.label}
          </Body>
          <Muted>
            {STR.vbTotalMarks}: {bnNum(test.totalMarks)} · {STR.vbTapWrong}
          </Muted>
        </Card>

        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {studentsQ.fetching ? (
          <Loader label={STR.loading} />
        ) : students.length === 0 ? (
          <Card>
            <Muted>{STR.vbNoStudents}</Muted>
          </Card>
        ) : (
          students.map((s) => {
            const existing = resultByStudent.get(s.id);
            const isOpen = openId === s.id;
            return (
              <Card key={s.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{s.name}</Body>
                    <Muted>{s.schoolId}</Muted>
                  </View>
                  {existing ? (
                    <Badge
                      text={
                        existing.status === "ABSENT"
                          ? STR.vbAbsent
                          : `${STR.vbScore} ${bnNum(existing.score ?? 0)}/${bnNum(existing.totalMarks)}`
                      }
                      tone={existing.status === "ABSENT" ? "muted" : "ok"}
                    />
                  ) : null}
                </View>

                {!isOpen ? (
                  <View style={{ marginTop: space(2) }}>
                    <Button title={STR.vbMark} variant="secondary" onPress={() => openStudent(s.id)} />
                  </View>
                ) : (
                  <View style={{ marginTop: space(2) }}>
                    <View style={{ flexDirection: "row", gap: space(2) }}>
                      <Chip label={STR.vbPresent} selected={status === "PRESENT"} onPress={() => setStatus("PRESENT")} />
                      <Chip label={STR.vbAbsent} selected={status === "ABSENT"} onPress={() => setStatus("ABSENT")} />
                    </View>

                    {status === "PRESENT" ? (
                      <View style={{ marginTop: space(2) }}>
                        {positions.map((p) => {
                          const fc = fieldCount(p.direction);
                          const wrong = wrongMap[p.id] ?? [];
                          return (
                            <View key={p.id} style={{ marginTop: space(2) }}>
                              <Muted>
                                {bnNum(p.qNumber)}. {wordById.get(p.wordId) ?? "—"} · {vocabDirectionLabel(p.direction)}
                              </Muted>
                              <View style={{ flexDirection: "row", gap: space(2), marginTop: space(1) }}>
                                {fc === 1 ? (
                                  <Chip
                                    label={STR.vbWrongCount}
                                    selected={wrong.includes(1)}
                                    onPress={() => toggleField(p.id, 1)}
                                  />
                                ) : (
                                  [1, 2].map((f) => (
                                    <Chip
                                      key={f}
                                      label={f === 1 ? STR.vbField1 : STR.vbField2}
                                      selected={wrong.includes(f)}
                                      onPress={() => toggleField(p.id, f)}
                                    />
                                  ))
                                )}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    ) : null}

                    <View style={{ flexDirection: "row", gap: space(2), marginTop: space(3) }}>
                      <Button title={STR.vbSubmitStudent} onPress={onSubmit} loading={busy} disabled={busy} />
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
