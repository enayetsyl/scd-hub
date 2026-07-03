/**
 * VocabAssignmentScreen (VC-5 / J2) — the admin weekly (section × program) tester
 * assignment (roster:manage; append-only, D-#106). Pick program + section + week +
 * teacher → assignVocabTester; the current tester + append-only history read below.
 * A covering teacher still rides their D-#20 proxy at mark time (no UI here).
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery, useMutation } from "urql";
import {
  ASSIGN_VOCAB_TESTER,
  VOCAB_TESTER_ASSIGNMENT_QUERY,
  VOCAB_ASSIGNMENT_HISTORY_QUERY,
  TEACHERS_QUERY,
} from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Badge, Loader, Notice } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { ProgramSelect, ClassSectionSelect, type SectionPick } from "../../components/vocabPickers";
import { TeacherSelect } from "../../components/selects";
import { AcademicYearSelect } from "../../components/selects";
import { STR, vocabProgramLabel, vocabAssignmentSourceLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

export default function VocabAssignmentScreen(): React.ReactElement {
  const [yearId, setYearId] = useState("");
  const [program, setProgram] = useState<string | null>(null);
  const [section, setSection] = useState<SectionPick | null>(null);
  const [week, setWeek] = useState("");
  const [teacherId, setTeacherId] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = !!program && !!section && !!week;
  const [currentQ, refetchCurrent] = useQuery({
    query: VOCAB_TESTER_ASSIGNMENT_QUERY,
    variables: { sectionId: section?.sectionId ?? "", program: program ?? "", weekOf: week },
    pause: !ready,
  });
  const [historyQ, refetchHistory] = useQuery({
    query: VOCAB_ASSIGNMENT_HISTORY_QUERY,
    variables: { sectionId: section?.sectionId ?? "", program: program ?? "" },
    pause: !section || !program,
  });
  const [teachersQ] = useQuery({ query: TEACHERS_QUERY });
  const teacherName = (id: string): string => teachersQ.data?.teachers.find((t) => t.id === id)?.name ?? id;

  const [, assign] = useMutation(ASSIGN_VOCAB_TESTER);

  async function onAssign(): Promise<void> {
    setError(null);
    setOk(null);
    if (!ready || !teacherId) return setError(STR.errGeneric);
    setBusy(true);
    const res = await assign({ sectionId: section!.sectionId, program: program!, weekOf: week, teacherId });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.vbAssigned);
    refetchCurrent({ requestPolicy: "network-only" });
    refetchHistory({ requestPolicy: "network-only" });
  }

  const current = currentQ.data?.vocabTesterAssignment ?? null;
  const history = historyQ.data?.vocabAssignmentHistory ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.vbAssignTitle}</Body>
          <AcademicYearSelect value={yearId} onChange={setYearId} />
          <ProgramSelect value={program} onChange={setProgram} />
          {yearId ? <ClassSectionSelect academicYearId={yearId} value={section} onChange={setSection} /> : null}
          <DateField label={STR.vbWeek} value={week} onChange={setWeek} />
          <TeacherSelect label={STR.vbAssignTester} value={teacherId} onChange={setTeacherId} />
          <View style={{ marginTop: space(2) }}>
            <Button title={STR.vbAssignTester} onPress={onAssign} loading={busy} disabled={busy} />
          </View>
        </Card>

        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {ready ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.vbCurrentTester}</Body>
            {currentQ.fetching ? (
              <Loader label={STR.loading} />
            ) : current ? (
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}>
                <Body>{teacherName(current.assignedTeacherId)}</Body>
                <Badge text={vocabAssignmentSourceLabel(current.source)} tone="brand" />
              </View>
            ) : (
              <Muted style={{ marginTop: space(2) }}>{STR.vbNoAssignment}</Muted>
            )}
          </Card>
        ) : null}

        {section && program ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.vbAssignHistory}</Body>
            {historyQ.fetching ? (
              <Loader label={STR.loading} />
            ) : history.length === 0 ? (
              <Muted style={{ marginTop: space(2) }}>{STR.empty}</Muted>
            ) : (
              history.map((a) => (
                <View key={a.id} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(2) }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body>{teacherName(a.assignedTeacherId)}</Body>
                    <Muted>
                      {vocabProgramLabel(a.program)} · {new Date(a.weekOf).toLocaleDateString()}
                    </Muted>
                  </View>
                  <Badge text={vocabAssignmentSourceLabel(a.source)} tone="muted" />
                </View>
              ))
            )}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
