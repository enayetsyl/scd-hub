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
import { useMutation, useQuery } from "urql";
import { roleHasPermission } from "@scd/shared";
import {
  ACADEMIC_YEARS_QUERY,
  AS_SCHEDULE_QUERY,
  EXPECTED_AS_WEEK,
  MY_AS_PREP_PROMPTS,
  MY_SECTIONS_AS_CLASS_TEACHER_QUERY,
  DELETE_ASSIGNMENT_ITEM,
  DECLARE_NO_ASSIGNMENT,
  REMOVE_NO_ASSIGNMENT,
  type ExpectedAsItemT,
} from "../../graphql/operations";
import type { AssignmentStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Chip, ChipRow, EmptyState, Notice } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { AssignmentEditSheet, type AssignmentEditTarget } from "../../components/AssignmentEditSheet";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { STR, bnNum, hwSubjectLabel, classLevelLabel, monthLabel, HW_NIL_REASONS, hwNilReasonLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../state/ToastContext";
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
  const toast = useToast();

  const [yearsQ, refetchYears] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const year = (yearsQ.data?.academicYears ?? []).find((y) => y.current) ?? yearsQ.data?.academicYears?.[0];
  const yearId = year?.id ?? "";

  const [scheduleQ, refetchSchedule] = useQuery({ query: AS_SCHEDULE_QUERY, variables: { academicYearId: yearId }, pause: !yearId });
  const schedule = scheduleQ.data?.assignmentSchedule ?? null;

  // D-#353 — edit / delete a delivered assignment (own cell, or Principal/Office).
  const [editTarget, setEditTarget] = useState<AssignmentEditTarget | null>(null);
  const [delTarget, setDelTarget] = useState<{ itemId: string; label: string } | null>(null);
  const [, deleteItem] = useMutation(DELETE_ASSIGNMENT_ITEM);
  const [, declareNil] = useMutation(DECLARE_NO_ASSIGNMENT);
  const [, removeNil] = useMutation(REMOVE_NO_ASSIGNMENT);
  const [nilReasonByEntry, setNilReasonByEntry] = useState<Record<string, string | null>>({});
  const [nilBusyEntry, setNilBusyEntry] = useState<string | null>(null);

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

  /** D-#353: the cell's own subject teacher, or Principal/Office — mirrors the server gate. */
  function canEditItem(item: ExpectedAsItemT): boolean {
    if (!item.asItemId) return false;
    return role !== "TEACHER" || item.teacherId === user?.id;
  }

  function openEdit(item: ExpectedAsItemT): void {
    setEditTarget({
      itemId: item.asItemId as string,
      asId: item.asId ?? "",
      label: `${classLevelLabel(item.classLevel)} — ${hwSubjectLabel(item.subject)}`,
      issued: item.status === "ISSUED",
      estMinutes: item.estMinutes,
      totalMarks: item.totalMarks,
    });
  }

  function openDeliver(item: ExpectedAsItemT): void {
    if (!expected?.deliveryDate || !expected.dueDate) return;
    navigation.navigate("DeliverAssignment", {
      academicYearId: yearId,
      entryId: item.entryId,
      weekNumber,
      // Carry the home screen's human label so the detail screen shows the SAME
      // week ("July · Week 4"), not the continuous term-anchored index.
      month: expected.month,
      weekOfMonth: expected.weekOfMonth,
      sectionId: item.sectionId,
      classId: item.classId,
      classLevel: item.classLevel,
      subject: item.subject,
      deliveryDate: expected.deliveryDate,
      dueDate: expected.dueDate,
    });
  }

  function canDeclareNil(item: ExpectedAsItemT): boolean {
    if (item.delivered) return false;
    return canTrackerRead && (item.teacherId === user?.id || role !== "TEACHER");
  }

  async function onDeclareNil(item: ExpectedAsItemT): Promise<void> {
    const reason = nilReasonByEntry[item.entryId];
    if (!reason || nilBusyEntry) {
      if (!reason) toast.show(STR.asNilPickReason, "danger");
      return;
    }
    setNilBusyEntry(item.entryId);
    const res = await declareNil({
      academicYearId: yearId,
      weekNumber,
      entryId: item.entryId,
      sectionId: item.sectionId,
      reason,
    });
    setNilBusyEntry(null);
    if (res.error || !res.data?.declareNoAssignment) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.asNilDeclaredOk, "ok");
    setNilReasonByEntry((cur) => ({ ...cur, [item.entryId]: null }));
    refetchExpected({ requestPolicy: "network-only" });
    refetchPrompts({ requestPolicy: "network-only" });
  }

  async function onRemoveNil(item: ExpectedAsItemT): Promise<void> {
    if (nilBusyEntry) return;
    setNilBusyEntry(item.entryId);
    const res = await removeNil({
      academicYearId: yearId,
      weekNumber,
      entryId: item.entryId,
      sectionId: item.sectionId,
    });
    setNilBusyEntry(null);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.asNilRemovedOk, "ok");
    refetchExpected({ requestPolicy: "network-only" });
    refetchPrompts({ requestPolicy: "network-only" });
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
              {/* Wraps on a narrow screen (owner report 2026-07-29): the title and the
                  week stepper could not both fit on a phone, and the row did not wrap,
                  so the ▶ (next week) chip was pushed off the right edge — the week was
                  navigable backwards only. */}
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: space(2),
                }}
              >
                <Body style={{ fontWeight: "700", flexShrink: 1 }}>{STR.asThisWeek}</Body>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), flexShrink: 0 }}>
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
                      text={
                        item.status === "ISSUED"
                          ? STR.asDelivered
                          : item.delivered
                            ? STR.asDraft
                            : item.nilDeclared
                              ? STR.asNilBadge
                              : STR.asNotDelivered
                      }
                      tone={item.status === "ISSUED" ? "ok" : item.delivered || item.nilDeclared ? "brand" : "warn"}
                    />
                  </View>
                  {item.asId ? <Muted style={{ marginTop: 2 }}>{item.asId}</Muted> : null}
                  <View style={{ marginTop: 8 }}>
                    {item.status === "ISSUED" && item.asItemId ? (
                      // RP-4 (D-#356): one workspace replaces সংগ্রহ + যাচাই.
                      <ChipRow>
                        <Chip
                          label={STR.asWorkspace}
                          onPress={() =>
                            navigation.navigate("AssignmentWorkspace", {
                              sectionId: item.sectionId,
                              classId: item.classId,
                            })
                          }
                        />
                        {canEditItem(item) ? (
                          <Chip label={`✎ ${STR.asEdit}`} onPress={() => openEdit(item)} />
                        ) : null}
                      </ChipRow>
                    ) : item.delivered ? (
                      // DRAFT — awaiting the weekly confirm (AS-T6)
                      <View>
                        <Muted style={{ marginBottom: 6 }}>{STR.asAwaitingConfirm}</Muted>
                        <ChipRow>
                          <Chip
                            label={`⚖️ ${STR.asReconcileTitle}`}
                            onPress={() =>
                              navigation.navigate("AssignmentReconcile", {
                                academicYearId: yearId,
                                sectionId: item.sectionId,
                                classId: item.classId,
                                weekNumber,
                                month: expected?.month,
                                weekOfMonth: expected?.weekOfMonth,
                              })
                            }
                          />
                          {canEditItem(item) ? (
                            <>
                              <Chip label={`✎ ${STR.asEdit}`} onPress={() => openEdit(item)} />
                              <Chip
                                label={`🗑 ${STR.asDelete}`}
                                onPress={() =>
                                  setDelTarget({
                                    itemId: item.asItemId as string,
                                    label: `${classLevelLabel(item.classLevel)} — ${hwSubjectLabel(item.subject)}`,
                                  })
                                }
                              />
                            </>
                          ) : null}
                        </ChipRow>
                      </View>
                    ) : !item.nilDeclared && canTrackerRead && (item.teacherId === user?.id || role !== "TEACHER") ? (
                      // Only the subject teacher (or an unscoped admin) delivers; a
                      // class teacher reconciles but doesn't deliver others' subjects.
                      <Button title={STR.asDeliver} onPress={() => openDeliver(item)} />
                    ) : null}
                    {canDeclareNil(item) ? (
                      <View style={{ marginTop: space(2) }}>
                        <Body style={{ fontWeight: "700", marginBottom: 4 }}>{STR.asNilTitle}</Body>
                        {item.nilDeclared ? (
                          <>
                            <Muted>
                              ✓ {STR.asNilDeclaredNotice} — {hwNilReasonLabel(item.nilReason)}
                            </Muted>
                            <Button
                              title={STR.asNilRemove}
                              variant="ghost"
                              onPress={() => void onRemoveNil(item)}
                              loading={nilBusyEntry === item.entryId}
                              disabled={!!nilBusyEntry}
                              style={{ marginTop: space(1) }}
                            />
                          </>
                        ) : (
                          <>
                            <ChipRow>
                              {HW_NIL_REASONS.map((r) => (
                                <Chip
                                  key={r}
                                  label={hwNilReasonLabel(r)}
                                  selected={nilReasonByEntry[item.entryId] === r}
                                  onPress={() =>
                                    setNilReasonByEntry((cur) => ({
                                      ...cur,
                                      [item.entryId]: cur[item.entryId] === r ? null : r,
                                    }))
                                  }
                                />
                              ))}
                            </ChipRow>
                            <Button
                              title={STR.asNilButton}
                              variant="secondary"
                              onPress={() => void onDeclareNil(item)}
                              loading={nilBusyEntry === item.entryId}
                              disabled={!!nilBusyEntry || !nilReasonByEntry[item.entryId]}
                              style={{ marginTop: space(1) }}
                            />
                          </>
                        )}
                      </View>
                    ) : null}
                  </View>
                </Card>
              ))
            )}

            <Card>
              <ChipRow>
                {/* D-#385: browse the whole section by class chip, without first
                    drilling into one week's cell — the homework workspace entry. */}
                {canTrackerRead ? (
                  <Chip label={`📋 ${STR.asWorkspace}`} onPress={() => navigation.navigate("AssignmentWorkspace")} />
                ) : null}
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

        <AssignmentEditSheet
          visible={!!editTarget}
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => refetchExpected({ requestPolicy: "network-only" })}
        />
        <ConfirmSheet
          visible={!!delTarget}
          title={STR.asDelete}
          message={`${delTarget?.label ?? ""}
${STR.asDeleteConfirm}`}
          confirmLabel={STR.asDelete}
          onCancel={() => setDelTarget(null)}
          onConfirm={async () => {
            const id = delTarget?.itemId;
            setDelTarget(null);
            if (!id) return;
            await deleteItem({ itemId: id });
            refetchExpected({ requestPolicy: "network-only" });
          }}
        />
      </ScrollView>
    </Screen>
  );
}
