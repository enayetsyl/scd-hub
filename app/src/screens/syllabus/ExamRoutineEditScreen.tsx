/**
 * ExamRoutineEditScreen (D-#883) — the Office writes one class's routine: date, subject,
 * written/oral, time and a note per row. Saving replaces that class's rows and writes each
 * subject's date onto the class's syllabus buttons (the server does both).
 */
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { ROUTINE_SUBJECTS } from "@scd/shared";
import { EXAM_ROUTINE, SAVE_EXAM_ROUTINE_CLASS, type ExamRoutineSlotT } from "../../graphql/examRoutine";
import type { SyllabusStackParamList } from "../../navigation/types";
import { Body, Button, Card, ErrorBanner, Field, Muted, Screen, Select } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { friendlyError } from "../../lib/errors";
import { STR, routineSubjectLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<SyllabusStackParamList, "ExamRoutineEdit">;

const BLANK: ExamRoutineSlotT = { dateKey: "", subject: "BAN", kind: "WRITTEN", start: "", end: "", note: "" };

export default function ExamRoutineEditScreen({ route }: Props): React.ReactElement {
  const { examId } = route.params;
  const [q, refetch] = useQuery({ query: EXAM_ROUTINE, variables: { examId } });
  const [save, saveRoutine] = useMutation(SAVE_EXAM_ROUTINE_CLASS);
  const r = q.data?.examRoutine ?? null;
  const [classId, setClassId] = useState<string | null>(null);
  const [rows, setRows] = useState<ExamRoutineSlotT[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Load the picked class's rows (and the note once) whenever the class changes.
  const cls = r?.classes.find((c) => c.classId === classId) ?? null;
  useEffect(() => {
    if (!classId && r?.classes.length) setClassId(r.classes[0]!.classId);
  }, [r, classId]);
  useEffect(() => {
    setRows(cls ? cls.slots.map((s) => ({ ...s })) : []);
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, r?.examId]);
  useEffect(() => {
    if (note === null && r) setNote(r.noteBn);
  }, [r, note]);

  const set = (i: number, patch: Partial<ExamRoutineSlotT>) => {
    setSaved(false);
    setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };

  async function onSave() {
    if (!classId) return;
    const res = await saveRoutine({ examId, classId, slots: rows.map(({ dateKey, subject, kind, start, end, note: n }) => ({ dateKey: dateKey.trim(), subject, kind, start: start.trim(), end: end.trim(), note: n })), noteBn: note ?? "" });
    if (!res.error) {
      setSaved(true);
      refetch({ requestPolicy: "network-only" });
    }
  }

  return (
    <Screen scroll>
      <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })}>
        {r ? (
          <View style={{ gap: space(3) }}>
            <Select
              label={STR.exrPickClass}
              value={classId}
              options={r.classes.map((c) => ({ label: c.labelBn, value: c.classId }))}
              onChange={setClassId}
            />
            <Muted>{STR.exrTimeHint}</Muted>
            {rows.map((s, i) => (
              <Card key={i}>
                <Field label={STR.exrDate} value={s.dateKey} onChangeText={(t) => set(i, { dateKey: t })} placeholder="2026-12-01" />
                <Select
                  label={STR.exrSubject}
                  value={s.subject}
                  options={ROUTINE_SUBJECTS.map((x) => ({ label: routineSubjectLabel(x), value: x as string }))}
                  onChange={(v) => set(i, { subject: v })}
                />
                <Select
                  label={STR.exrKind}
                  value={s.kind}
                  options={[
                    { label: STR.exrWritten, value: "WRITTEN" },
                    { label: STR.exrOral, value: "ORAL" },
                  ]}
                  onChange={(v) => set(i, { kind: v as ExamRoutineSlotT["kind"] })}
                />
                <View style={{ flexDirection: "row", gap: space(2) }}>
                  <View style={{ flex: 1 }}>
                    <Field label={STR.exrStart} value={s.start} onChangeText={(t) => set(i, { start: t })} placeholder="08:00" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label={STR.exrEnd} value={s.end} onChangeText={(t) => set(i, { end: t })} placeholder="11:00" />
                  </View>
                </View>
                <Field label={STR.exrNote} value={s.note} onChangeText={(t) => set(i, { note: t })} />
                <Button title={STR.exrRemoveRow} variant="ghost" onPress={() => setRows(rows.filter((_, j) => j !== i))} />
              </Card>
            ))}
            <Button title={STR.exrAddRow} variant="secondary" onPress={() => setRows([...rows, { ...BLANK, dateKey: rows[rows.length - 1]?.dateKey ?? "" }])} />
            <Field label={STR.exrRoutineNote} value={note ?? ""} onChangeText={(t) => { setNote(t); setSaved(false); }} multiline />
            {save.error ? <ErrorBanner message={friendlyError(save.error)} /> : null}
            {saved ? <Body>{STR.exrSaved}</Body> : null}
            <Button title={STR.exrSave} loading={save.fetching} disabled={!classId} onPress={() => void onSave()} />
          </View>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
