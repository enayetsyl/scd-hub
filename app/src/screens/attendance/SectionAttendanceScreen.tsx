/**
 * SectionAttendanceScreen (D-#318) — the TEACHER's own sections' attendance
 * detail for a date: per-section present/absent counts plus the absentee names
 * (roll, ID, leave-covered flag). Sections come from the caller's own scopes
 * server-side; the Today brief card links here.
 */
import React, { useState } from "react";
import { View, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { MY_SECTION_ATTENDANCE } from "../../graphql/operations";
import type { AttendanceStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Badge, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR, bnNum, classLevelLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { dateKey } from "../../lib/dates";

type Props = NativeStackScreenProps<AttendanceStackParamList, "SectionAttendance">;

export default function SectionAttendanceScreen({ navigation: nav }: Props): React.ReactElement {
  const [day, setDay] = useState(dateKey());
  const [q, refetch] = useQuery({
    query: MY_SECTION_ATTENDANCE,
    variables: { dateKey: day },
    requestPolicy: "cache-and-network",
  });
  const sections = q.data?.mySectionAttendance ?? [];

  return (
    <Screen scroll>
      <H2>{STR.attMySectionsToday}</H2>
      <DateField label={STR.attDate} value={day} onChange={setDay} />

      {q.error ? (
        <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : null}
      {q.fetching && sections.length === 0 ? <Loader label={STR.loading} /> : null}
      {!q.fetching && sections.length === 0 ? <EmptyState message={STR.attMySectionsTodayEmpty} /> : null}

      {sections.map((sec) => (
        <Card key={sec.sectionId}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700", flex: 1 }}>
              {classLevelLabel(sec.classLevel)}
              {sec.sectionNameBn ? ` — ${sec.sectionNameBn}` : ""}
            </Body>
            <View style={{ flexDirection: "row", gap: space(1) }}>
              <Badge text={`${STR.presentWord}: ${bnNum(sec.presentCount)}`} tone="ok" />
              <Badge
                text={`${STR.absentWord}: ${bnNum(sec.absentCount)} / ${bnNum(sec.totalCount)}`}
                tone={sec.absentCount > 0 ? "warn" : "ok"}
              />
            </View>
          </View>
          {!sec.complete ? <Muted style={{ marginTop: 2 }}>⚠ {STR.attNotFullyMarked}</Muted> : null}
          {/* SP-3 entry point: an absentee row is exactly where "why is this child
              missing so often?" gets asked — tap through to the profile's attendance. */}
          {sec.absentees.map((a) => (
            <Pressable
              key={a.studentId}
              onPress={() =>
                nav.navigate("StudentProfile", {
                  studentId: a.studentId,
                  studentName: a.nameBn || a.name,
                  initialPanel: "attendance",
                })
              }
              style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, marginTop: 2 }}
            >
              <Body style={{ flex: 1 }}>{a.nameBn || a.name}</Body>
              <Muted>
                {STR.attRoll}: {a.rollNumber ? bnNum(a.rollNumber) : "—"} · {STR.attIdNo}: {bnNum(a.schoolId)}
                {a.leaveCovered ? " · ✓" : ""}
              </Muted>
            </Pressable>
          ))}
        </Card>
      ))}
    </Screen>
  );
}
