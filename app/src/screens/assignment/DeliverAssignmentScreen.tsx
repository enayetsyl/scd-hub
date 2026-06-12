/**
 * DeliverAssignmentScreen (AS-T2, AJ-3) — the Thursday pass. Section roster,
 * per-student GIVEN / ABSENT_REDELIVER (tap toggles absent), optional
 * totalMarks + AS-set link. Dates shown come from the §4 server resolution;
 * "# delivered" is computed from the records — never typed.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { STUDENTS_QUERY, DELIVER_ASSIGNMENT } from "../../graphql/operations";
import type { AssignmentStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Field, Loader, EmptyState, Notice } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, classLevelLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { Pressable } from "react-native";

type Props = NativeStackScreenProps<AssignmentStackParamList, "DeliverAssignment">;

const day = (iso: string): string => iso.slice(0, 10);

export default function DeliverAssignmentScreen({ route, navigation }: Props): React.ReactElement {
  const { academicYearId, entryId, weekNumber, sectionId, classId, classLevel, subject, deliveryDate, dueDate } =
    route.params;
  const [studentsQ] = useQuery({ query: STUDENTS_QUERY, variables: { sectionId } });
  const students = (studentsQ.data?.studentsInSection ?? []).filter((s) => s.active);

  const [, deliver] = useMutation(DELIVER_ASSIGNMENT);
  const [absent, setAbsent] = useState<Record<string, boolean>>({});
  const [totalMarks, setTotalMarks] = useState("");
  const [setId, setSetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onDeliver(): Promise<void> {
    setError(null);
    setBusy(true);
    const marks = totalMarks.trim() === "" ? undefined : parseInt(totalMarks, 10);
    const res = await deliver({
      academicYearId,
      weekNumber,
      entryId,
      sectionId,
      roster: students.map((s) => ({ studentId: s.id, present: !absent[s.id] })),
      setId: setId.trim() === "" ? undefined : setId.trim(),
      totalMarks: marks,
    });
    setBusy(false);
    if (res.error || !res.data?.deliverAssignment) return setError(friendlyError(res.error));
    navigation.goBack();
  }

  const absentCount = students.filter((s) => absent[s.id]).length;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>
            {classLevelLabel(classLevel)} — {hwSubjectLabel(subject)} · {STR.asWeek} {bnNum(weekNumber)}
          </Body>
          <Muted style={{ marginTop: 2 }}>
            {STR.asDeliverBy} {day(deliveryDate)} · {STR.asDueBy} {day(dueDate)}
          </Muted>
          <Field label={STR.asTotalMarks} value={totalMarks} onChangeText={setTotalMarks} keyboardType="number-pad" />
          <Field label={STR.asSetId} value={setId} onChangeText={setSetId} />
        </Card>

        {error ? <Notice message={error} tone="danger" /> : null}

        {studentsQ.fetching ? (
          <Loader label={STR.loading} />
        ) : students.length === 0 ? (
          <EmptyState message={STR.empty} />
        ) : (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: 4 }}>
              {STR.asPresent} {bnNum(students.length - absentCount)} · {STR.asAbsent} {bnNum(absentCount)}
            </Body>
            {students.map((s) => {
              const isAbsent = !!absent[s.id];
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setAbsent((m) => ({ ...m, [s.id]: !m[s.id] }))}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    minHeight: 48,
                  }}
                >
                  <Body>
                    {s.name} <Muted>({s.schoolId})</Muted>
                  </Body>
                  <Badge text={isAbsent ? STR.asAbsent : STR.asPresent} tone={isAbsent ? "warn" : "ok"} />
                </Pressable>
              );
            })}
            <View style={{ marginTop: 8 }}>
              <Button title={STR.asDeliver} onPress={onDeliver} loading={busy} disabled={busy || students.length === 0} />
            </View>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
