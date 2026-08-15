/**
 * DeliverAssignmentScreen (AS-T2, AJ-3) — the Thursday pass. Section roster,
 * per-student GIVEN / ABSENT_REDELIVER (tap toggles absent), optional
 * totalMarks + AS-set link. Dates shown come from the §4 server resolution;
 * "# delivered" is computed from the records — never typed.
 */
import React, { useState, useRef, useEffect } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { STUDENTS_QUERY, DELIVER_ASSIGNMENT, HOMEWORK_ISSUE_ROSTER } from "../../graphql/operations";
import {
  pickAndUploadAssignmentFiles,
  uploadAssignmentWebFiles,
  openStoredFile,
  AS_MAX_ATTACHMENTS,
  FileUploadError,
  type UploadedFile,
  type MultiUploadResult,
} from "../../lib/files";
import { UploadDropZone } from "../../components/UploadDropZone";
import type { AssignmentStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Field, Loader, EmptyState, Notice } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, classLevelLabel, monthLabel } from "../../lib/labels";
import { isLikelyObjectId } from "../../lib/validate";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { Pressable } from "react-native";

type Props = NativeStackScreenProps<AssignmentStackParamList, "DeliverAssignment">;

const day = (iso: string): string => iso.slice(0, 10);

export default function DeliverAssignmentScreen({ route, navigation }: Props): React.ReactElement {
  const { academicYearId, entryId, weekNumber, month, weekOfMonth, sectionId, classId, classLevel, subject, deliveryDate, dueDate } =
    route.params;

  // `weekNumber` is the CONTINUOUS term-anchored index (the server key), not the number
  // shown on the Assignments home ("July · Week 4" = week-of-month). Label with the home
  // screen's form when passed so one week never shows two different numbers.
  const weekLabel =
    month != null && weekOfMonth != null
      ? `${monthLabel(month)} · ${STR.asWeek} ${bnNum(weekOfMonth)}`
      : `${STR.asWeek} ${bnNum(weekNumber)}`;
  const [studentsQ] = useQuery({ query: STUDENTS_QUERY, variables: { sectionId } });
  const students = (studentsQ.data?.studentsInSection ?? []).filter((s) => s.active);

  const [, deliver] = useMutation(DELIVER_ASSIGNMENT);
  const [absent, setAbsent] = useState<Record<string, boolean>>({});

  // D-#325: attendance-backed prefill (mirrors the homework reconcile, D-#320) —
  // the delivery-date's absentees come pre-crossed off the same section roster
  // read. A manual toggle wins and stops further auto-fills for this date.
  const deliveryKey = day(deliveryDate);
  const [attRosterQ] = useQuery({
    query: HOMEWORK_ISSUE_ROSTER,
    variables: { sectionId, classId, date: deliveryKey },
  });
  const rosterTouched = useRef(false);
  useEffect(() => {
    rosterTouched.current = false;
    setAbsent({});
  }, [sectionId, deliveryKey]);
  const attRoster = attRosterQ.data?.homeworkIssueRoster;
  useEffect(() => {
    if (!attRoster?.complete || rosterTouched.current) return;
    const next: Record<string, boolean> = {};
    for (const e of attRoster.entries) if (!e.present) next[e.studentId] = true;
    setAbsent(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attRoster]);
  const [totalMarks, setTotalMarks] = useState("");
  // D-#478: required. Without it a guardian looking at a late assignment sees an
  // AS_ID and nothing else — and unlike homework there is no class note to fall
  // back on, because an assignment is weekly and links to no slot.
  const [description, setDescription] = useState("");
  const [descError, setDescError] = useState<string | undefined>(undefined);
  const [estMinutes, setEstMinutes] = useState("");
  const [setId, setSetId] = useState("");
  const [setIdError, setSetIdError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Delivery-pass attachments (≤5, D-#298) — uploaded on pick, bound at deliver. */
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [pickBusy, setPickBusy] = useState(false);

  /** Shared upload tail for both entry points — the pick button and the web drop. */
  async function runAttachmentUpload(upload: () => Promise<MultiUploadResult>): Promise<void> {
    if (pickBusy || files.length >= AS_MAX_ATTACHMENTS) return;
    setPickBusy(true);
    try {
      const res = await upload();
      if (res.uploaded.length > 0) setFiles((cur) => [...cur, ...res.uploaded]);
      if (res.failures.length > 0) setError(res.failures.join("\n"));
    } catch (e) {
      setError(e instanceof FileUploadError ? e.message : STR.errGeneric);
    } finally {
      setPickBusy(false);
    }
  }

  async function onPickFiles(): Promise<void> {
    await runAttachmentUpload(() => pickAndUploadAssignmentFiles(AS_MAX_ATTACHMENTS - files.length));
  }

  /** Web only: files dragged onto the attach button, same cap + failure handling. */
  async function onDropFiles(dropped: File[]): Promise<void> {
    await runAttachmentUpload(() => uploadAssignmentWebFiles(dropped, AS_MAX_ATTACHMENTS - files.length));
  }

  async function onDeliver(): Promise<void> {
    setError(null);
    setSetIdError(undefined);
    setDescError(undefined);
    // Caught here so the teacher gets an inline message rather than the server's
    // rejection after the roster round-trip.
    if (description.trim() === "") {
      setDescError(STR.asDescRequired);
      setError(STR.asDescRequired);
      return;
    }
    // The set-id link is optional, but a non-blank value must be a real id —
    // else the server rejects it. Catch it here so the teacher gets a clear
    // inline message instead of a failed delivery.
    const trimmedSetId = setId.trim();
    if (trimmedSetId !== "" && !isLikelyObjectId(trimmedSetId)) {
      setSetIdError(STR.invalidIdField);
      return;
    }
    setBusy(true);
    const marks = totalMarks.trim() === "" ? undefined : parseInt(totalMarks, 10);
    const mins = estMinutes.trim() === "" ? undefined : parseInt(estMinutes, 10);
    const res = await deliver({
      academicYearId,
      weekNumber,
      entryId,
      sectionId,
      roster: students.map((s) => ({ studentId: s.id, present: !absent[s.id] })),
      description: description.trim(),
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
            {classLevelLabel(classLevel)} — {hwSubjectLabel(subject)} · {weekLabel}
          </Body>
          <Muted style={{ marginTop: 2 }}>
            {STR.asDeliverBy} {day(deliveryDate)} · {STR.asDueBy} {day(dueDate)}
          </Muted>
          {/* D-#478: first field on the form — it is the one the family reads. */}
          <Field
            label={STR.asDescLabel}
            value={description}
            onChangeText={setDescription}
            multiline
            error={descError}
          />
          <Field label={STR.asEstMinutes} value={estMinutes} onChangeText={setEstMinutes} keyboardType="number-pad" placeholder="20" />
          <Field label={STR.asTotalMarks} value={totalMarks} onChangeText={setTotalMarks} keyboardType="number-pad" />
          <Field label={STR.asSetId} value={setId} onChangeText={setSetId} helper={STR.asSetIdHint} error={setIdError} />
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
          <UploadDropZone
            onFiles={(dropped) => void onDropFiles(dropped)}
            disabled={pickBusy || files.length >= AS_MAX_ATTACHMENTS}
          >
            <Button
              title={pickBusy ? STR.saving : STR.cnAttachFile}
              variant="secondary"
              onPress={() => void onPickFiles()}
              loading={pickBusy}
              disabled={pickBusy || files.length >= AS_MAX_ATTACHMENTS}
            />
          </UploadDropZone>
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
            {attRoster?.complete ? (
              <Muted style={{ marginBottom: 6 }}>✓ {STR.hwRosterFromAttendance}</Muted>
            ) : attRosterQ.data && !attRoster?.complete ? (
              <Muted style={{ marginBottom: 6 }}>{STR.hwRosterAttendanceIncomplete}</Muted>
            ) : null}
            {students.map((s) => {
              const isAbsent = !!absent[s.id];
              return (
                <Pressable
                  key={s.id}
                  onPress={() => {
                    rosterTouched.current = true; // D-#325: manual edits win over the prefill
                    setAbsent((m) => ({ ...m, [s.id]: !m[s.id] }));
                  }}
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
