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
import {
  pickAndUploadAssignmentFiles,
  openStoredFile,
  AS_MAX_ATTACHMENTS,
  FileUploadError,
  type UploadedFile,
} from "../../lib/files";
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
  const [estMinutes, setEstMinutes] = useState("");
  const [setId, setSetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Delivery-pass attachments (≤5, D-#298) — uploaded on pick, bound at deliver. */
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [pickBusy, setPickBusy] = useState(false);

  async function onPickFiles(): Promise<void> {
    if (pickBusy || files.length >= AS_MAX_ATTACHMENTS) return;
    setPickBusy(true);
    try {
      const res = await pickAndUploadAssignmentFiles(AS_MAX_ATTACHMENTS - files.length);
      if (res.uploaded.length > 0) setFiles((cur) => [...cur, ...res.uploaded]);
      if (res.failures.length > 0) setError(res.failures.join("\n"));
    } catch (e) {
      setError(e instanceof FileUploadError ? e.message : STR.errGeneric);
    } finally {
      setPickBusy(false);
    }
  }

  async function onDeliver(): Promise<void> {
    setError(null);
    setBusy(true);
    const marks = totalMarks.trim() === "" ? undefined : parseInt(totalMarks, 10);
    const mins = estMinutes.trim() === "" ? undefined : parseInt(estMinutes, 10);
    const res = await deliver({
      academicYearId,
      weekNumber,
      entryId,
      sectionId,
      roster: students.map((s) => ({ studentId: s.id, present: !absent[s.id] })),
      setId: setId.trim() === "" ? undefined : setId.trim(),
      totalMarks: marks,
      estMinutes: mins,
      attachmentIds: files.length > 0 ? files.map((f) => f.fileId) : undefined,
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
          <Field label={STR.asEstMinutes} value={estMinutes} onChangeText={setEstMinutes} keyboardType="number-pad" placeholder="20" />
          <Field label={STR.asTotalMarks} value={totalMarks} onChangeText={setTotalMarks} keyboardType="number-pad" />
          <Field label={STR.asSetId} value={setId} onChangeText={setSetId} />
        </Card>

        <Card>
          <Body style={{ fontWeight: "700", marginBottom: 4 }}>
            📎 {STR.cnAttachments} ({files.length}/{AS_MAX_ATTACHMENTS})
          </Body>
          {files.map((f, i) => (
            <View key={f.fileId} style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
              <Pressable
                style={{ flex: 1 }}
                onPress={() => void openStoredFile(f.fileId).catch(() => setError(STR.errGeneric))}
              >
                <Body>📎 {f.originalName}</Body>
              </Pressable>
              <Button
                title={STR.remove}
                variant="ghost"
                onPress={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
              />
            </View>
          ))}
          <Button
            title={pickBusy ? STR.saving : STR.cnAttachFile}
            variant="secondary"
            onPress={() => void onPickFiles()}
            loading={pickBusy}
            disabled={pickBusy || files.length >= AS_MAX_ATTACHMENTS}
          />
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
