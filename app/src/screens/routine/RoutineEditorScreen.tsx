/**
 * RoutineEditorScreen (R3.3) — admin builds/edits a group's routine slots. The
 * server's conflict engine + scope binding run on create; a teacher/group/room
 * clash returns an error shown inline (conflict feedback), and an authority
 * warning surfaces as a notice. `routine:manage`.
 *
 * Breaks (Tiffin) are part of the period grid (R-1), not slots — every slot here
 * is a real subject assignment.
 */
import React, { useState } from "react";
import { View, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { DAYS_OF_WEEK, ROUTINE_SUBJECTS, PERIOD_TRACKS } from "@scd/shared";
import { ROUTINE_SLOTS_QUERY, CREATE_ROUTINE_SLOT, DELETE_ROUTINE_SLOT, TEACHERS_QUERY } from "../../graphql/operations";
import type { RoutineStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Field, Button, Chip, ChipRow, Notice } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { TeacherSelect, RoomSelect } from "../../components/selects";
import { STR, routineSubjectLabel, periodTrackLabel, dayOfWeekLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { space } from "../../theme/tokens";

const EDITOR_DAYS = DAYS_OF_WEEK.filter((d) => d !== "FRI");
const todayISO = (): string => new Date().toISOString().slice(0, 10);

type Props = NativeStackScreenProps<RoutineStackParamList, "RoutineEditor">;

export default function RoutineEditorScreen({ route }: Props): React.ReactElement {
  const { groupType, groupId, title } = route.params;
  const { confirmAction } = useConfirm();
  const [day, setDay] = useState<string>("SUN");
  const [period, setPeriod] = useState("1");
  const [subject, setSubject] = useState<string>(ROUTINE_SUBJECTS[0]);
  const [track, setTrack] = useState<string>("general");
  const [teacherId, setTeacherId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  const [slotsQ, refetch] = useQuery({ query: ROUTINE_SLOTS_QUERY, variables: { groupType, groupId } });
  const [{ data: teacherData }] = useQuery({ query: TEACHERS_QUERY });
  const teacherName = new Map((teacherData?.teachers ?? []).map((t) => [t.id, t.name]));
  const [, createSlot] = useMutation(CREATE_ROUTINE_SLOT);
  const [, deleteSlot] = useMutation(DELETE_ROUTINE_SLOT);

  async function submit(): Promise<void> {
    const p = parseInt(period, 10);
    if (!Number.isFinite(p) || p < 1) {
      setError(STR.errGeneric);
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    setWarn(null);
    const res = await createSlot({
      groupType,
      groupId,
      dayOfWeek: day,
      periodNumber: p,
      subject,
      track,
      isBreak: false,
      teacherId: teacherId.trim() || null,
      roomId: roomId.trim() || null,
      effectiveFrom: from.trim(),
      effectiveTo: null,
    });
    setBusy(false);
    if (res.error || !res.data?.createRoutineSlot) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.rtCreated);
    const ws = res.data.createRoutineSlot.warnings;
    if (ws.length > 0) setWarn(ws.join(" "));
    refetch({ requestPolicy: "network-only" });
  }

  async function remove(id: string): Promise<void> {
    if (!(await confirmAction({ confirmLabel: STR.remove }))) return;
    setBusy(true);
    setError(null);
    const res = await deleteSlot({ id });
    setBusy(false);
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.rtDeleted);
    refetch({ requestPolicy: "network-only" });
  }

  const slots = slotsQ.data?.routineSlots ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        <Muted style={{ fontWeight: "700" }}>{title}</Muted>
        <Muted>{STR.rtManageHint}</Muted>
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {warn ? <Notice message={warn} tone="warn" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.rtCreate}</Body>
          <Muted>{STR.rtDay}</Muted>
          <ChipRow>
            {EDITOR_DAYS.map((d) => (
              <Chip key={d} label={dayOfWeekLabel(d)} selected={day === d} onPress={() => setDay(d)} />
            ))}
          </ChipRow>
          <Field label={STR.rtPeriod} value={period} onChangeText={setPeriod} keyboardType="number-pad" />
          <Muted>{STR.rtSubjectF}</Muted>
          <ChipRow>
            {ROUTINE_SUBJECTS.map((s) => (
              <Chip key={s} label={routineSubjectLabel(s)} selected={subject === s} onPress={() => setSubject(s)} />
            ))}
          </ChipRow>
          <Muted>{STR.rtTrack}</Muted>
          <ChipRow>
            {PERIOD_TRACKS.map((tr) => (
              <Chip key={tr} label={periodTrackLabel(tr)} selected={track === tr} onPress={() => setTrack(tr)} />
            ))}
          </ChipRow>
          <TeacherSelect label={STR.rtTeacherId} value={teacherId} onChange={setTeacherId} />
          <RoomSelect label={STR.rtRoomId} value={roomId} onChange={setRoomId} />
          <DateField label={STR.rtFrom} value={from} onChange={setFrom} />
          <Button title={STR.rtCreate} onPress={submit} loading={busy} disabled={busy} style={{ marginTop: space(2) }} />
        </Card>

        <Body style={{ fontWeight: "700" }}>{STR.rtExisting}</Body>
        {slots.length === 0 ? <Muted>{STR.rtNoSlots}</Muted> : null}
        {slots.map((s) => (
          <Card key={s.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "700" }}>
                  {dayOfWeekLabel(s.dayOfWeek)} · {STR.rtPeriodN} {bnNum(s.periodNumber)}
                </Body>
                <Muted>
                  {routineSubjectLabel(s.subject)} · {periodTrackLabel(s.track)}
                  {s.teacherId ? ` · ${teacherName.get(s.teacherId) ?? s.teacherId}` : ""}
                </Muted>
              </View>
              <Button title={STR.remove} variant="danger" onPress={() => remove(s.id)} disabled={busy} />
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
