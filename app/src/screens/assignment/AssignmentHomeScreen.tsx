/**
 * AssignmentHomeScreen (AS-T1/AS-T2 landing) — the weekly AS-… channel.
 *
 * - D-#89 prep prompts (Sun/Mon, the teacher's undelivered items this week)
 * - the computed expected grid for a week (± navigation), per entry:
 *   Deliver (undelivered, own/admin) or Collect/Check (delivered)
 * - admin entries: schedule editor (roster:manage), Office chase list
 *   (Principal/Office, D-#88), roll-ups (tracker:read)
 */
import React, { useCallback, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery } from "urql";
import { roleHasPermission } from "@scd/shared";
import {
  ACADEMIC_YEARS_QUERY,
  AS_SCHEDULE_QUERY,
  EXPECTED_AS_WEEK,
  MY_AS_PREP_PROMPTS,
  MY_SECTIONS_AS_CLASS_TEACHER_QUERY,
  type ExpectedAsItemT,
} from "../../graphql/operations";
import type { AssignmentStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Chip, ChipRow, EmptyState, Notice } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, hwSubjectLabel, classLevelLabel, monthLabel } from "../../lib/labels";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AssignmentStackParamList, "AssignmentHome">;

/** Client-side mirror of the server's CONTINUOUS calendar-week index (D-#275):
 *  weeks are Sun–Sat; week 1 = the calendar week containing the term anchor.
 *  Only used to INITIALIZE the selector — the month-week label + every date come
 *  from the server resolver. */
function currentWeekNumber(termStartDate: string, today = new Date()): number {
  const sunday = (dt: Date): number => {
    const m = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    m.setDate(m.getDate() - m.getDay());
    return m.getTime();
  };
  const first = sunday(new Date(termStartDate));
  const wk = sunday(today);
  if (wk < first) return 1;
  return Math.round((wk - first) / (7 * 86_400_000)) + 1;
}

const day = (iso?: string | null): string => (iso ? iso.slice(0, 10) : "—");

export default function AssignmentHomeScreen({ navigation }: Props): React.ReactElement {
  const { role, user } = useAuth();
  const canTrackerRead = !!role && roleHasPermission(role, "tracker:read");
  const canSchedule = !!role && roleHasPermission(role, "roster:manage");
  const isFollowUpAdmin = role === "PRINCIPAL" || role === "OFFICE";

  const [yearsQ, refetchYears] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const year = (yearsQ.data?.academicYears ?? []).find((y) => y.current) ?? yearsQ.data?.academicYears?.[0];
  const yearId = year?.id ?? "";

  const [scheduleQ, refetchSchedule] = useQuery({ query: AS_SCHEDULE_QUERY, variables: { academicYearId: yearId }, pause: !yearId });
  const schedule = scheduleQ.data?.assignmentSchedule ?? null;

  const [week, setWeek] = useState<number | null>(null);
  const weekNumber = week ?? (schedule ? currentWeekNumber(schedule.termStartDate) : 1);

  const [expectedQ, refetchExpected] = useQuery({
    query: EXPECTED_AS_WEEK,
    variables: { academicYearId: yearId, weekNumber },
    pause: !yearId || !schedule,
  });
  const expected = expectedQ.data?.expectedAssignmentsForWeek ?? null;

  // Refresh when the screen regains focus (returning from Deliver / Reconcile /
  // Collect / Check) so a just-delivered DRAFT or just-confirmed ISSUED item shows
  // immediately instead of stale cache.
  useFocusEffect(
    useCallback(() => {
      if (yearId && schedule) refetchExpected({ requestPolicy: "network-only" });
    }, [yearId, schedule, weekNumber, refetchExpected]),
  );

  const [promptsQ, refetchPrompts] = useQuery({
    query: MY_AS_PREP_PROMPTS,
    variables: { academicYearId: yearId },
    pause: !yearId || !canTrackerRead,
  });
  const prompts = promptsQ.data?.myAssignmentPrepPrompts ?? [];

  // Sections where this teacher is the class teacher — they own the weekly reconcile
  // for those sections even when they don't personally teach the subjects (AS-T6).
  const [ctQ, refetchCt] = useQuery({ query: MY_SECTIONS_AS_CLASS_TEACHER_QUERY, pause: role !== "TEACHER" });
  const myCtSectionIds = useMemo(
    () => new Set((ctQ.data?.mySectionsAsClassTeacher ?? []).map((s) => s.id)),
    [ctQ.data],
  );

  // A teacher sees their own rotation rows PLUS every subject in the sections they
  // class-teach (so they can reconcile the week); Principal/Office see all.
  const visibleItems = useMemo(() => {
    const items = expected?.items ?? [];
    if (role === "TEACHER" && user) {
      return items.filter((i) => i.teacherId === user.id || myCtSectionIds.has(i.sectionId));
    }
    return items;
  }, [expected, role, user, myCtSectionIds]);

  function openDeliver(item: ExpectedAsItemT): void {
    if (!expected?.deliveryDate || !expected.dueDate) return;
    navigation.navigate("DeliverAssignment", {
      academicYearId: yearId,
      entryId: item.entryId,
      weekNumber,
      sectionId: item.sectionId,
      classId: item.classId,
      classLevel: item.classLevel,
      subject: item.subject,
      deliveryDate: expected.deliveryDate,
      dueDate: expected.dueDate,
    });
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        <QueryGate
          results={[yearsQ, scheduleQ, expectedQ, promptsQ, ctQ]}
          onRetry={() => {
            refetchYears({ requestPolicy: "network-only" });
            refetchSchedule({ requestPolicy: "network-only" });
            refetchExpected({ requestPolicy: "network-only" });
            refetchPrompts({ requestPolicy: "network-only" });
            refetchCt({ requestPolicy: "network-only" });
          }}
          loaderLabel={STR.loading}
        >
        {!schedule ? (
          <>
            <EmptyState message={STR.asNoSchedule} />
            {canSchedule ? (
              <Button title={STR.asScheduleTitle} onPress={() => navigation.navigate("AssignmentSchedule")} />
            ) : null}
          </>
        ) : (
          <>
            {prompts.length > 0 ? (
              <Card>
                <Body style={{ fontWeight: "700", marginBottom: 4 }}>🔔 {STR.asPrepPrompts}</Body>
                <Muted>{STR.asPrepHint}</Muted>
                {prompts.map((p) => (
                  <View key={p.entryId} style={{ marginTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Body>
                      {classLevelLabel(p.classLevel)} — {hwSubjectLabel(p.subject)}
                    </Body>
                    <Muted>
                      {STR.asDeliverBy} {day(p.deliveryDate)}
                    </Muted>
                  </View>
                ))}
              </Card>
            ) : null}

            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700" }}>{STR.asThisWeek}</Body>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                  <Chip label="◀" onPress={() => setWeek(Math.max(1, weekNumber - 1))} />
                  <Body>
                    {expected
                      ? `${monthLabel(expected.month)} · ${STR.asWeek} ${bnNum(expected.weekOfMonth)}`
                      : `${STR.asWeek} ${bnNum(weekNumber)}`}
                  </Body>
                  <Chip label="▶" onPress={() => setWeek(Math.min(53, weekNumber + 1))} />
                </View>
              </View>
              {/* D-#330/#331: the rotation keys off the delivery Thursday's week-of-month,
                  wrapping every 4 (D-#275) — surface the real cycle week (from the server)
                  so e.g. a 5th Thursday visibly uses week 1's subjects. */}
              {expected ? (
                <>
                  <Muted style={{ marginTop: 4 }}>
                    {STR.asCycleWeekShort} {bnNum(expected.cycleWeek)}
                  </Muted>
                  <Muted style={{ marginTop: 4 }}>
                    {STR.asDeliverBy} {day(expected.deliveryDate)} · {STR.asDueBy} {day(expected.dueDate)}
                  </Muted>
                </>
              ) : null}
            </Card>

            {expected?.suspended ? (
              <Notice message={STR.asSuspendedWeek} tone="info" />
            ) : visibleItems.length === 0 ? (
              <EmptyState message={STR.asNoItems} />
            ) : (
              visibleItems.map((item) => (
                <Card key={item.entryId}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Body style={{ fontWeight: "700" }}>
                      {classLevelLabel(item.classLevel)} — {hwSubjectLabel(item.subject)}
                    </Body>
                    <Badge
                      text={item.status === "ISSUED" ? STR.asDelivered : item.delivered ? STR.asDraft : STR.asNotDelivered}
                      tone={item.status === "ISSUED" ? "ok" : item.delivered ? "brand" : "warn"}
                    />
                  </View>
                  {item.asId ? <Muted style={{ marginTop: 2 }}>{item.asId}</Muted> : null}
                  <View style={{ marginTop: 8 }}>
                    {item.status === "ISSUED" && item.asItemId ? (
                      <ChipRow>
                        <Chip
                          label={STR.asCollectTitle}
                          onPress={() =>
                            navigation.navigate("CollectAssignment", {
                              itemId: item.asItemId as string,
                              sectionId: item.sectionId,
                              classId: item.classId,
                              asId: item.asId ?? "",
                            })
                          }
                        />
                        <Chip
                          label={STR.asCheckTitle}
                          onPress={() =>
                            navigation.navigate("AssignmentChecking", {
                              itemId: item.asItemId as string,
                              sectionId: item.sectionId,
                              classId: item.classId,
                              asId: item.asId ?? "",
                            })
                          }
                        />
                      </ChipRow>
                    ) : item.delivered ? (
                      // DRAFT — awaiting the weekly confirm (AS-T6)
                      <View>
                        <Muted style={{ marginBottom: 6 }}>{STR.asAwaitingConfirm}</Muted>
                        <Chip
                          label={`⚖️ ${STR.asReconcileTitle}`}
                          onPress={() =>
                            navigation.navigate("AssignmentReconcile", {
                              academicYearId: yearId,
                              sectionId: item.sectionId,
                              classId: item.classId,
                              weekNumber,
                            })
                          }
                        />
                      </View>
                    ) : canTrackerRead && (item.teacherId === user?.id || role !== "TEACHER") ? (
                      // Only the subject teacher (or an unscoped admin) delivers; a
                      // class teacher reconciles but doesn't deliver others' subjects.
                      <Button title={STR.asDeliver} onPress={() => openDeliver(item)} />
                    ) : null}
                  </View>
                </Card>
              ))
            )}

            <Card>
              <ChipRow>
                {canSchedule ? (
                  <Chip label={`⚙️ ${STR.asScheduleTitle}`} onPress={() => navigation.navigate("AssignmentSchedule")} />
                ) : null}
                {isFollowUpAdmin ? (
                  <Chip label={`📣 ${STR.asChaseTitle}`} onPress={() => navigation.navigate("AssignmentChase")} />
                ) : null}
                {canTrackerRead ? (
                  <Chip
                    label={`📊 ${STR.asRollupsTitle}`}
                    onPress={() => navigation.navigate("AssignmentRollups", { academicYearId: yearId })}
                  />
                ) : null}
              </ChipRow>
            </Card>
          </>
        )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
