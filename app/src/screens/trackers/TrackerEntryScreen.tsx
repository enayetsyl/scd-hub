/**
 * TrackerEntryScreen (S11 / J4.1–J4.3) — per-student entry against an open
 * tracker. The roster comes from studentsInSection (identity plane, staff-only);
 * recordEntry de-identifies server-side (ADR-005 — entries are pseudonymised).
 * Row input depends on tracker kind: classtest → score, assignment → submitted,
 * homework → complete. AS non-submitters get a reminder hand-off to WaLink.
 * Close → TrackerSummary.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  TRACKER_QUERY,
  STUDENTS_QUERY,
  ASSESSMENT_SET_QUERY,
  RECORD_ENTRY,
  CLOSE_TRACKER,
  type StudentT,
} from "../../graphql/operations";
import type { TrackersStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Chip,
  ChipRow,
  Badge,
  Button,
  Field,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
  Divider,
} from "../../components/ui";
import { STR, trackerKindLabel, setTypeLabel, bnNum, markRangeMsg } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<TrackersStackParamList, "TrackerEntry">;

interface RowSaveResult {
  ok: boolean;
  message?: string;
}

type RecordFn = (studentId: string, payload: { score?: number; submitted?: boolean; complete?: boolean }) => Promise<RowSaveResult>;

function StudentRow({
  student,
  mode,
  totalMarks,
  record,
  onReminder,
}: {
  student: StudentT;
  mode: string;
  totalMarks: number;
  record: RecordFn;
  onReminder: (name: string) => void;
}): React.ReactElement {
  const [score, setScore] = useState("");
  const [submitted, setSubmitted] = useState<boolean | null>(null);
  const [complete, setComplete] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSave(): Promise<void> {
    if (saving) return;
    setErr(null);
    let payload: { score?: number; submitted?: boolean; complete?: boolean };

    if (mode === "classtest") {
      const n = Number(score);
      if (score.trim() === "" || Number.isNaN(n) || n < 0 || n > totalMarks) {
        setErr(markRangeMsg(0, totalMarks));
        return;
      }
      payload = { score: n };
    } else if (mode === "assignment") {
      if (submitted === null) return;
      payload = { submitted };
    } else if (mode === "homework") {
      if (complete === null) return;
      payload = { complete };
    } else {
      // generic — treat as score if provided
      const n = Number(score);
      payload = score.trim() !== "" && !Number.isNaN(n) ? { score: n } : {};
    }

    setSaving(true);
    const res = await record(student.id, payload);
    setSaving(false);
    if (res.ok) setSaved(true);
    else setErr(res.message ?? STR.errGeneric);
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
        <Body style={{ flex: 1, fontWeight: "600" }}>{student.name}</Body>
        <Muted>{student.schoolId}</Muted>
      </View>

      {mode === "classtest" ? (
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space(2), marginTop: space(2) }}>
          <View style={{ flex: 1 }}>
            <Field
              label={`SCORE (0–${totalMarks})`}
              value={score}
              onChangeText={setScore}
              keyboardType="numeric"
              placeholder="0"
            />
          </View>
        </View>
      ) : mode === "assignment" ? (
        <ChipRow>
          <Chip label={STR.submitted} selected={submitted === true} onPress={() => setSubmitted(true)} />
          <Chip label={STR.notSubmitted} selected={submitted === false} onPress={() => setSubmitted(false)} />
        </ChipRow>
      ) : mode === "homework" ? (
        <ChipRow>
          <Chip label={STR.complete} selected={complete === true} onPress={() => setComplete(true)} />
          <Chip label={STR.incomplete} selected={complete === false} onPress={() => setComplete(false)} />
        </ChipRow>
      ) : (
        <Field label="SCORE" value={score} onChangeText={setScore} keyboardType="numeric" />
      )}

      {err ? <Notice message={err} tone="danger" /> : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginTop: space(2) }}>
        <View style={{ flex: 1 }}>
          <Button title={saving ? STR.saving : saved ? STR.saved : STR.save} onPress={onSave} loading={saving} variant={saved ? "secondary" : "primary"} />
        </View>
        {mode === "assignment" && submitted === false ? (
          <View style={{ flex: 1 }}>
            <Button title={STR.sendReminder} variant="ghost" onPress={() => onReminder(student.name)} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

export default function TrackerEntryScreen({ route, navigation }: Props): React.ReactElement {
  const { trackerId } = route.params;
  const [{ data: tData, fetching: tFetching, error: tErr }, refetchT] = useQuery({
    query: TRACKER_QUERY,
    variables: { id: trackerId },
  });
  const tracker = tData?.tracker;

  const [{ data: sData, fetching: sFetching }] = useQuery({
    query: STUDENTS_QUERY,
    variables: { sectionId: tracker?.sectionId ?? "" },
    pause: !tracker,
  });
  const [{ data: setData }] = useQuery({
    query: ASSESSMENT_SET_QUERY,
    variables: { id: tracker?.setId ?? "" },
    pause: !tracker,
  });

  const [, recordEntry] = useMutation(RECORD_ENTRY);
  const [, closeTracker] = useMutation(CLOSE_TRACKER);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const students = sData?.studentsInSection ?? [];
  const set = setData?.assessmentSet;
  const totalMarks = set?.totalMarks ?? 0;
  const setTitle = set ? setTypeLabel(set.setType) : tracker ? trackerKindLabel(tracker.trackerKind) : "";

  const record: RecordFn = async (studentId, payload) => {
    const res = await recordEntry({ trackerId, studentId, ...payload });
    if (res.error) return { ok: false, message: friendlyError(res.error) };
    return { ok: true };
  };

  async function onClose(): Promise<void> {
    if (closing) return;
    setClosing(true);
    setCloseError(null);
    const res = await closeTracker({ trackerId });
    setClosing(false);
    if (res.error) {
      setCloseError(friendlyError(res.error));
      return;
    }
    navigation.replace("TrackerSummary", { trackerId });
  }

  if (tFetching) return <Loader label={STR.loading} />;
  if (tErr) {
    return (
      <Screen>
        <ErrorBanner message={friendlyError(tErr)} onRetry={() => refetchT({ requestPolicy: "network-only" })} />
      </Screen>
    );
  }
  if (!tracker) {
    return (
      <Screen>
        <Notice message={STR.empty} tone="warn" />
      </Screen>
    );
  }

  if (tracker.status === "closed") {
    return (
      <Screen>
        <Notice message={STR.statusClosed} tone="warn" />
        <Button title={STR.trackerSummary} onPress={() => navigation.replace("TrackerSummary", { trackerId })} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <H2>{trackerKindLabel(tracker.trackerKind)}</H2>
        <Badge text={STR.statusOpen} tone="ok" />
      </View>

      {sFetching ? (
        <Loader label={STR.loading} />
      ) : students.length === 0 ? (
        <EmptyState message={STR.noStudents} />
      ) : (
        students.map((stu) => (
          <StudentRow
            key={stu.id}
            student={stu}
            mode={tracker.trackerKind}
            totalMarks={totalMarks}
            record={record}
            onReminder={(name) => navigation.navigate("WaLink", { studentName: name, setTitle })}
          />
        ))
      )}

      <Divider />
      {closeError ? <Notice message={closeError} tone="danger" /> : null}
      <Button title={closing ? STR.saving : STR.closeTracker} onPress={onClose} loading={closing} variant="danger" />
    </Screen>
  );
}
