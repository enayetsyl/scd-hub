/**
 * AttendanceHomeScreen (AT-2 entry) — role-aware landing.
 *   TEACHER (attendance:mark): today's marking worklist (myMarkingSections) —
 *     tap a section to mark its absentees (CT-2: only the marker-of-the-day).
 *   PRINCIPAL/OFFICE (attendance:manage): entries to the teacher-Excel upload,
 *     the absentee report surface, and marker assignment.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { roleHasPermission } from "@scd/shared";
import { MY_MARKING_SECTIONS } from "../../graphql/operations";
import type { AttendanceStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Badge, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR, bnNum, classLevelLabel } from "../../lib/labels";
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

  const [sectionsQ, refetch] = useQuery({
    query: MY_MARKING_SECTIONS,
    variables: { dateKey },
    pause: !canMark,
  });
  const sections = sectionsQ.data?.myMarkingSections ?? [];

  return (
    <Screen scroll>
      {canManage ? (
        <>
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
          {sectionsQ.error ? (
            <ErrorBanner message={friendlyError(sectionsQ.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
          ) : sectionsQ.fetching && sections.length === 0 ? (
            <Loader label={STR.loading} />
          ) : sections.length === 0 ? (
            <EmptyState message={STR.attNoSections} />
          ) : (
            sections.map((s) => (
              <Card
                key={s.sectionId}
                onPress={() =>
                  navigation.navigate("MarkAttendance", {
                    sectionId: s.sectionId,
                    title: `${classLevelLabel(s.classLevel)} — ${s.sectionNameBn || s.sectionCode}`,
                    dateKey,
                  })
                }
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: "700" }}>
                      {classLevelLabel(s.classLevel)} — {s.sectionNameBn || s.sectionCode}
                    </Body>
                    <Muted>
                      {bnNum(s.studentCount)} {STR.attStudentsWord}
                      {s.viaAssignment ? ` · ${STR.attViaAssignment}` : ""}
                    </Muted>
                  </View>
                  <Badge text={s.marked ? STR.attMarked : STR.attPending} tone={s.marked ? "ok" : "warn"} />
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
