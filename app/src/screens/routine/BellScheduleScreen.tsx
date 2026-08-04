/**
 * BellScheduleScreen (R5.1) — the bell-ring trigger schedule for a date + audience:
 * each period's end time and the bell-duty admin who rings it. Admins assign the
 * whole-day bell-duty admin here (D-#54). Delivery (the actual reminder push) rides
 * the deferred messaging pipeline. `routine:read`; assign is `routine:manage`.
 */
import React, { useState } from "react";
import { View, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { BELL_SCHEDULE_QUERY, ASSIGN_BELL_DUTY, TEACHERS_QUERY } from "../../graphql/operations";
import type { RoutineStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Field, Button, Badge, Notice, Loader } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { TeacherSelect } from "../../components/selects";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme/tokens";
import { dateKey } from "../../lib/dates";

const todayISO = (): string => dateKey();

type Props = NativeStackScreenProps<RoutineStackParamList, "BellSchedule">;

export default function BellScheduleScreen(_props: Props): React.ReactElement {
  const { role, can } = useAuth();
  const canManage = can("routine:manage");
  const [date, setDate] = useState(todayISO());
  const [audienceKey, setAudienceKey] = useState("class_1_5");
  const [adminId, setAdminId] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [schedQ, refetch] = useQuery({ query: BELL_SCHEDULE_QUERY, variables: { date, audienceKey } });
  const [{ data: teacherData }] = useQuery({ query: TEACHERS_QUERY });
  const teacherName = new Map((teacherData?.teachers ?? []).map((t) => [t.id, t.name]));
  const [, assign] = useMutation(ASSIGN_BELL_DUTY);

  async function assignDuty(): Promise<void> {
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await assign({ date, adminId: adminId.trim() });
    setBusy(false);
    if (res.error || !res.data?.assignBellDuty) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.rtBellAssigned);
    setAdminId("");
    refetch({ requestPolicy: "network-only" });
  }

  const sched = schedQ.data?.bellSchedule ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        <DateField label={STR.rtDate} value={date} onChange={setDate} />
        <Field label={STR.rtAudienceKey} value={audienceKey} onChangeText={setAudienceKey} />
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {canManage ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.rtBellAdmin}</Body>
            <TeacherSelect label={STR.rtAdminId} value={adminId} onChange={setAdminId} />
            <Button title={STR.rtAssignBell} onPress={assignDuty} loading={busy} disabled={busy || adminId.trim() === ""} style={{ marginTop: space(2) }} />
          </Card>
        ) : null}

        {schedQ.fetching ? <Loader /> : null}
        {!schedQ.fetching && sched.length === 0 ? <Muted>{STR.rtNoSlots}</Muted> : null}
        {sched.map((b) => (
          <Card key={b.periodNumber}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>
                {STR.rtPeriodN} {bnNum(b.periodNumber)} · {STR.rtBellEnds} {b.endHHMM}
              </Body>
              {b.bellAdminId ? (
                <Badge text={teacherName.get(b.bellAdminId) ?? b.bellAdminId} tone="brand" />
              ) : (
                <Badge text="—" tone="muted" />
              )}
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
