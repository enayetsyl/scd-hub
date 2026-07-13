/**
 * AttendanceAdminScreen (D-#292) — Principal/Office mark or amend ANY class's
 * attendance for ANY day (today or past). Pick a date → every populated
 * attendance unit for that date (Quran groups / sections; pre-cutover dates are
 * all sections) with its marked state + responsible marker → tap into the
 * shared roster screen in AMEND mode (audited, the O2 unlock path).
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { ATTENDANCE_UNITS_FOR_DATE } from "../../graphql/operations";
import type { AttendanceStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Badge, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AttendanceStackParamList, "AttendanceAdmin">;

const todayKey = (): string => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
};

export default function AttendanceAdminScreen({ navigation }: Props): React.ReactElement {
  const [dateKey, setDateKey] = useState<string>(todayKey());

  const [q, refetch] = useQuery({
    query: ATTENDANCE_UNITS_FOR_DATE,
    variables: { dateKey },
    requestPolicy: "cache-and-network",
  });
  const units = q.data?.attendanceUnitsForDate ?? [];
  const pendingCount = units.filter((u) => !u.marked).length;

  return (
    <Screen scroll>
      <H2>{STR.attAdminTitle}</H2>
      <Muted style={{ marginBottom: space(2) }}>{STR.attAdminHint}</Muted>

      <DateField label={STR.attAdminDate} value={dateKey} onChange={setDateKey} max={todayKey()} />

      {q.error ? (
        <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : null}
      {q.fetching && units.length === 0 ? <Loader label={STR.loading} /> : null}

      {!q.fetching && units.length === 0 && !q.error ? (
        <EmptyState message={STR.attAdminNoUnits} />
      ) : null}

      {units.length > 0 ? (
        <Muted style={{ marginBottom: space(1) }}>
          {STR.attAdminPending}: {bnNum(pendingCount)} / {bnNum(units.length)}
        </Muted>
      ) : null}

      {units.map((u) => (
        <Card
          key={`${u.unitType}:${u.unitId}`}
          onPress={() =>
            navigation.navigate("MarkAttendance", {
              unitType: u.unitType,
              unitId: u.unitId,
              title: u.label,
              dateKey,
              amend: true,
            })
          }
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
            <View style={{ flex: 1 }}>
              <Body style={{ fontWeight: "700" }}>
                {u.unitType === "subjectgroup" ? "🕌 " : ""}
                {u.label}
              </Body>
              {u.sublabel ? <Muted>{u.sublabel}</Muted> : null}
              <Muted>
                {bnNum(u.studentCount)} {STR.attStudentsWord}
                {u.markerName ? ` · ${STR.attMarkerWord}: ${u.markerName}` : ""}
              </Muted>
            </View>
            <Badge text={u.marked ? STR.attMarked : STR.attAdminUnmarked} tone={u.marked ? "ok" : "danger"} />
          </View>
        </Card>
      ))}
      <View style={{ height: space(4) }} />
    </Screen>
  );
}
