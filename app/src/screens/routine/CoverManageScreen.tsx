/**
 * CoverManageScreen (R4.1–R4.3) — proxy-manage. For a group + date: list the day's
 * slots, and for an absence pick a cover from the availability view (free teachers
 * first, with each teacher's class count that day), then assign — backed by a
 * time-bounded proxy grant for Section slots. Active covers can be cancelled.
 * `routine:manage`.
 */
import React, { useState } from "react";
import { View, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  ROUTINE_FOR_DATE_QUERY,
  TEACHER_AVAILABILITY_QUERY,
  COVERS_FOR_DATE_QUERY,
  ASSIGN_COVER,
  CANCEL_COVER,
} from "../../graphql/operations";
import type { RoutineStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Button, Badge, Notice, Loader } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR, routineSubjectLabel, dayOfWeekLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { space } from "../../theme/tokens";

const todayISO = (): string => new Date().toISOString().slice(0, 10);

type Props = NativeStackScreenProps<RoutineStackParamList, "CoverManage">;

export default function CoverManageScreen({ route }: Props): React.ReactElement {
  const { groupType, groupId, title } = route.params;
  const { confirmAction } = useConfirm();
  const [date, setDate] = useState(todayISO());
  const [sel, setSel] = useState<{ slotId: string; period: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [slotsQ, refetchSlots] = useQuery({ query: ROUTINE_FOR_DATE_QUERY, variables: { groupType, groupId, date } });
  const [availQ] = useQuery({
    query: TEACHER_AVAILABILITY_QUERY,
    variables: { date, periodNumber: sel?.period ?? 0 },
    pause: !sel,
  });
  const [coversQ, refetchCovers] = useQuery({ query: COVERS_FOR_DATE_QUERY, variables: { date } });
  const [, assign] = useMutation(ASSIGN_COVER);
  const [, cancel] = useMutation(CANCEL_COVER);

  function refresh(): void {
    refetchSlots({ requestPolicy: "network-only" });
    refetchCovers({ requestPolicy: "network-only" });
  }

  async function doAssign(teacherId: string): Promise<void> {
    if (!sel) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await assign({ slotId: sel.slotId, date, coverTeacherId: teacherId });
    setBusy(false);
    if (res.error || !res.data?.assignCover) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.rtCoverAssigned);
    setSel(null);
    refresh();
  }

  async function doCancel(id: string): Promise<void> {
    if (!(await confirmAction({ confirmLabel: STR.cancel }))) return;
    setBusy(true);
    setError(null);
    const res = await cancel({ id });
    setBusy(false);
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.rtCoverCancelled);
    refresh();
  }

  const slots = (slotsQ.data?.routineForDate ?? []).filter((s) => !s.isBreak && s.teacherId);
  const covers = coversQ.data?.coversForDate ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        <Muted style={{ fontWeight: "700" }}>{title}</Muted>
        <DateField label={STR.rtDate} value={date} onChange={setDate} />
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {slotsQ.fetching ? <Loader /> : null}
        {!slotsQ.fetching && slots.length === 0 ? <Muted>{STR.rtNoSlots}</Muted> : null}

        {slots.map((s) => (
          <Card key={s.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "700" }}>
                  {dayOfWeekLabel(s.dayOfWeek)} · {STR.rtPeriodN} {bnNum(s.periodNumber)} · {routineSubjectLabel(s.subject)}
                </Body>
                <Muted>{s.coverTeacherId ? `${STR.rtCovered}: ${s.coverTeacherId}` : (s.teacherId ?? "—")}</Muted>
              </View>
              {s.coverTeacherId ? (
                <Badge text={STR.rtCovered} tone="warn" />
              ) : (
                <Button
                  title={STR.rtFindCover}
                  variant="secondary"
                  onPress={() => setSel({ slotId: s.id, period: s.periodNumber })}
                />
              )}
            </View>

            {sel?.slotId === s.id ? (
              <View style={{ marginTop: space(2), gap: space(1) }}>
                <Muted style={{ fontWeight: "700" }}>{STR.rtAvailableTeachers}</Muted>
                {availQ.fetching ? <Loader /> : null}
                {availQ.data?.teacherAvailability.map((a) => (
                  <View key={a.teacherId} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                    <View style={{ flex: 1 }}>
                      <Body>{a.name}</Body>
                      <Muted>
                        {bnNum(a.classCount)} {STR.rtClassesToday}
                      </Muted>
                    </View>
                    <Badge text={a.free ? STR.rtFree : STR.rtBusy} tone={a.free ? "ok" : "muted"} />
                    <Button title={STR.rtAssignCover} onPress={() => doAssign(a.teacherId)} disabled={busy || !a.free} />
                  </View>
                ))}
              </View>
            ) : null}
          </Card>
        ))}

        <Body style={{ fontWeight: "700", marginTop: space(2) }}>{STR.rtActiveCovers}</Body>
        {covers.length === 0 ? <Muted>{STR.rtNoCovers}</Muted> : null}
        {covers.map((c) => (
          <Card key={c.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
              <View style={{ flex: 1 }}>
                <Body>{c.coverTeacherId}</Body>
                <Muted>{c.reason ?? ""}</Muted>
              </View>
              <Button title={STR.cancel} variant="danger" onPress={() => doCancel(c.id)} disabled={busy} />
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
