/**
 * AttendanceHomeScreen (AT-2 entry) — role-aware landing.
 *   TEACHER (attendance:mark): today's marking worklist (myMarkingUnits, D-#278) —
 *     tap an attendance UNIT to mark its absentees. A unit is the caller's Quran
 *     group (Class 1–5, whose first class is the cross-section Quran double) or
 *     their Nursery/KG section. Only the unit's marker-of-the-day sees it (CT-2).
 *   PRINCIPAL/OFFICE (attendance:manage): entries to the teacher-Excel upload,
 *     the absentee report surface, and marker assignment.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { roleHasPermission } from "@scd/shared";
import { MY_MARKING_UNITS } from "../../graphql/operations";
import type { AttendanceStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Badge, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AttendanceStackParamList, "AttendanceHome">;

const todayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function AttendanceHomeScreen({ navigation }: Props): React.ReactElement {
  const { role } = useAuth();
  const canMark = !!role && roleHasPermission(role, "attendance:mark");
  const canManage = !!role && roleHasPermission(role, "attendance:manage");
  const [dateKey, setDateKey] = useState(todayKey());

  const [unitsQ, refetch] = useQuery({
    query: MY_MARKING_UNITS,
    variables: { dateKey },
    pause: !canMark,
  });
  const units = unitsQ.data?.myMarkingUnits ?? [];

  return (
    <Screen scroll>
      {canManage ? (
        <>
          {/* D-#292: mark/amend ANY class for ANY (past) day — the admin escape hatch. */}
          <Card onPress={() => navigation.navigate("AttendanceAdmin")}>
            <Body style={{ fontWeight: "700" }}>🗓️ {STR.attAdminTitle}</Body>
            <Muted>{STR.attAdminHint}</Muted>
          </Card>
          <Card onPress={() => navigation.navigate("TeacherAttendanceImport")}>
            <Body style={{ fontWeight: "700" }}>📥 {STR.attUploadTitle}</Body>
            <Muted>{STR.attUploadHint}</Muted>
          </Card>
          <Card onPress={() => navigation.navigate("AttendanceReport")}>
            <Body style={{ fontWeight: "700" }}>📋 {STR.attReportTitle}</Body>
            <Muted>{STR.attAbsentNoApp} · {STR.attUnmarkedSections} · {STR.attStaffSummary}</Muted>
          </Card>
          <Card onPress={() => navigation.navigate("AssignMarker")}>
            <Body style={{ fontWeight: "700" }}>👤 {STR.attAssignMarkerTitle}</Body>
            <Muted>{STR.attActiveAssignments}</Muted>
          </Card>
        </>
      ) : null}

      {canMark ? (
        <>
          <H2>{STR.attMySections}</H2>
          <DateField label={STR.attDate} value={dateKey} onChange={setDateKey} />
          {unitsQ.error ? (
            <ErrorBanner message={friendlyError(unitsQ.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
          ) : unitsQ.fetching && units.length === 0 ? (
            <Loader label={STR.loading} />
          ) : units.length === 0 ? (
            <EmptyState message={STR.attNoSections} />
          ) : (
            units.map((u) => (
              <Card
                key={`${u.unitType}:${u.unitId}`}
                onPress={() =>
                  navigation.navigate("MarkAttendance", {
                    unitType: u.unitType,
                    unitId: u.unitId,
                    title: u.label,
                    dateKey,
                  })
                }
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{u.label}</Body>
                    <Muted>
                      {bnNum(u.studentCount)} {STR.attStudentsWord}
                      {u.viaAssignment ? ` · ${STR.attViaAssignment}` : ""}
                    </Muted>
                  </View>
                  <Badge text={u.marked ? STR.attMarked : STR.attPending} tone={u.marked ? "ok" : "warn"} />
                </View>
              </Card>
            ))
          )}
        </>
      ) : null}

      {!canMark && !canManage ? <EmptyState message={STR.empty} /> : null}
      <View style={{ height: space(4) }} />
    </Screen>
  );
}
