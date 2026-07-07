/**
 * AssignmentHomeScreen (AS-T1/AS-T2 landing) — the weekly AS-… channel.
 *
 * - D-#89 prep prompts (Sun/Mon, the teacher's undelivered items this week)
 * - the computed expected grid for a week (± navigation), per entry:
 *   Deliver (undelivered, own/admin) or Collect/Check (delivered)
 * - admin entries: schedule editor (roster:manage), Office chase list
 *   (Principal/Office, D-#88), roll-ups (tracker:read)
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { roleHasPermission } from "@scd/shared";
import {
  ACADEMIC_YEARS_QUERY,
  AS_SCHEDULE_QUERY,
  EXPECTED_AS_WEEK,
  MY_AS_PREP_PROMPTS,
  type ExpectedAsItemT,
} from "../../graphql/operations";
import type { AssignmentStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Chip, ChipRow, Loader, EmptyState, Notice } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, classLevelLabel } from "../../lib/labels";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AssignmentStackParamList, "AssignmentHome">;

/** Client-side mirror of the server's week numbering (week 1 starts on the
 *  term anchor; 7-day windows). Only used to INITIALIZE the week selector —
 *  every date shown comes from the server resolver. */
function currentWeekNumber(termStartDate: string, today = new Date()): number {
  const start = new Date(termStartDate);
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (d < s) return 1;
  return Math.floor(Math.round((d - s) / 86_400_000) / 7) + 1;
}

const day = (iso?: string | null): string => (iso ? iso.slice(0, 10) : "—");

export default function AssignmentHomeScreen({ navigation }: Props): React.ReactElement {
  const { role, user } = useAuth();
  const canTrackerRead = !!role && roleHasPermission(role, "tracker:read");
  const canSchedule = !!role && roleHasPermission(role, "roster:manage");
  const isFollowUpAdmin = role === "PRINCIPAL" || role === "OFFICE";

  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const year = (yearsQ.data?.academicYears ?? []).find((y) => y.current) ?? yearsQ.data?.academicYears?.[0];
  const yearId = year?.id ?? "";

  const [scheduleQ] = useQuery({ query: AS_SCHEDULE_QUERY, variables: { academicYearId: yearId }, pause: !yearId });
  const schedule = scheduleQ.data?.assignmentSchedule ?? null;

  const [week, setWeek] = useState<number | null>(null);
  const weekNumber = week ?? (schedule ? currentWeekNumber(schedule.termStartDate) : 1);

  const [expectedQ] = useQuery({
    query: EXPECTED_AS_WEEK,
    variables: { academicYearId: yearId, weekNumber },
    pause: !yearId || !schedule,
  });
  const expected = expectedQ.data?.expectedAssignmentsForWeek ?? null;

  const [promptsQ] = useQuery({
    query: MY_AS_PREP_PROMPTS,
    variables: { academicYearId: yearId },
    pause: !yearId || !canTrackerRead,
  });
  const prompts = promptsQ.data?.myAssignmentPrepPrompts ?? [];

  // A teacher sees their own rotation rows; Principal/Office see all.
  const visibleItems = useMemo(() => {
    const items = expected?.items ?? [];
    if (role === "TEACHER" && user) return items.filter((i) => i.teacherId === user.id);
    return items;
  }, [expected, role, user]);

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
        {yearsQ.fetching || scheduleQ.fetching ? (
          <Loader label={STR.loading} />
        ) : !schedule ? (
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
                    {STR.asWeek} {bnNum(weekNumber)}
                  </Body>
                  <Chip label="▶" onPress={() => setWeek(Math.min(53, weekNumber + 1))} />
                </View>
              </View>
              {expected ? (
                <Muted style={{ marginTop: 4 }}>
                  {STR.asCycleWeek} {bnNum(expected.cycleWeek)} · {STR.asDeliverBy} {day(expected.deliveryDate)} · {STR.asDueBy} {day(expected.dueDate)}
                </Muted>
              ) : null}
            </Card>

            {expectedQ.fetching ? (
              <Loader label={STR.loading} />
            ) : expected?.suspended ? (
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
                    ) : canTrackerRead ? (
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
      </ScrollView>
    </Screen>
  );
}
