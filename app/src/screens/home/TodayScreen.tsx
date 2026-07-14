/**
 * TodayScreen (UX-4, prd-ux-improvements.md §4.4, D-#265) — the staff landing
 * dashboard: the caller's day at a glance via the ONE `myDay` read.
 *   date header      — today + the Bangla day name
 *   Pending (red)    — backlog alerts (D-#279): attendance / class notes / assignment
 *                      entry owed TODAY or on a previous school day (7-day look-back).
 *                      Each row deep-links into the screen that clears it. Above them
 *                      sits the AMBER assignment-prep countdown (D-#280) — the work that
 *                      has not slipped yet; it ticks locally off the server's absolute
 *                      `dueAt`, vanishes on delivery, and becomes a red row once overdue.
 *   Class presence   — Principal/Office only: per-class present/absent for today,
 *                      followed by the sections nobody has marked yet (D-#279)
 *   My periods       — the caller's own routine slots (time · subject · class),
 *                      day-type empty state on holidays/off days
 *   Pending work     — tappable count rows deep-linking straight into the exact
 *                      work queue (checking / homework home / attendance)
 *   Quick actions    — chips into the highest-traffic entry forms, rendered only
 *                      when the role holds the target tab's EXISTING gate (the
 *                      same roleHasPermission checks AppTabs uses — no new gating)
 * Refetches on focus (the HomeworkHome pattern) so counts never go stale.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useQuery } from "urql";
import { DAYS_OF_WEEK, roleHasPermission } from "@scd/shared";
import type { Role } from "@scd/shared";
import { MY_DAY_QUERY, UNMARKED_SECTIONS } from "../../graphql/operations";
import { Screen, H2, Body, Muted, Card, Chip, ChipRow, Badge, Loader, ErrorBanner } from "../../components/ui";
import { STR, bnNum, classLevelLabel, dayOfWeekLabel, dayTypeLabel, routineSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";
import { dateKey } from "../../lib/dates";

const todayISO = (): string => dateKey();

/** Cross-tab navigation (the Basket→Sets convention): navigate bubbles up to the drawer. */
type CrossNav = { navigate: (name: string, params?: object) => void };

export default function TodayScreen(): React.ReactElement {
  const nav = useNavigation() as unknown as CrossNav;
  const { role } = useAuth();
  const colors = useColors();
  const date = todayISO();

  const [q, refetch] = useQuery({ query: MY_DAY_QUERY, variables: { date } });

  // Focus-refetch (HomeworkHome pattern): skip the first focus — the query already
  // runs on mount — then refresh whenever the user returns to the dashboard.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );

  const day = q.data?.myDay;
  const slots = day?.slots ?? [];
  const hw = day?.homework;
  const alerts = day?.alerts ?? [];
  const presence = day?.classPresence ?? [];
  const ctOf = day?.classTeacherOf ?? [];

  // The SAME gates AppTabs uses for the target tabs (no new gating logic).
  const canDeclare = !!role && roleHasPermission(role as Role, "tracker:read");
  const canManage = !!role && roleHasPermission(role as Role, "attendance:manage");
  const canAttendance =
    !!role &&
    (roleHasPermission(role as Role, "attendance:mark") || roleHasPermission(role as Role, "attendance:manage"));

  // Manager-only: who still hasn't marked today (reuses the existing §8 query).
  const [unmarkedQ] = useQuery({ query: UNMARKED_SECTIONS, variables: { dateKey: date }, pause: !canManage });
  const unmarked = unmarkedQ.data?.unmarkedSections ?? [];

  // The countdown ticks locally (the server sends an absolute `dueAt` instant), so the
  // remaining time stays truthful without re-querying. One tick a minute is enough —
  // the row is rendered to minute precision.
  const prep = day?.assignmentPrep ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!prep) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [prep?.dueAt]); // eslint-disable-line react-hooks/exhaustive-deps

  /** "3d 4h" / "4h 20m" / "20m" — coarsest two units, minute precision at the end. */
  const timeLeft = (dueAt: string): string => {
    const ms = new Date(dueAt).getTime() - now;
    if (ms <= 0) return STR.prepDueNow;
    const totalMinutes = Math.floor(ms / 60_000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${bnNum(days)}${STR.prepDays} ${bnNum(hours)}${STR.prepHours}`;
    if (hours > 0) return `${bnNum(hours)}${STR.prepHours} ${bnNum(minutes)}${STR.prepMinutes}`;
    return `${bnNum(minutes)}${STR.prepMinutes}`;
  };

  const alertLabel = (kind: string): string =>
    kind === "attendance"
      ? STR.alertAttendance
      : kind === "class_note"
        ? STR.alertClassNote
        : kind === "hw_reconcile"
          ? STR.alertHwReconcile
          : kind === "as_reconcile"
            ? STR.alertAsReconcile
            : STR.alertAssignmentEntry;

  /** Each alert deep-links into the screen that clears it. */
  const alertTarget = (kind: string): void => {
    if (kind === "attendance") nav.navigate("AttendanceTab", { screen: "AttendanceHome" });
    else if (kind === "class_note") nav.navigate("ClassNotesTab", { screen: "MyClassNotes" });
    else if (kind === "hw_reconcile") nav.navigate("HomeworkTab", { screen: "HomeworkHome" });
    else nav.navigate("AssignmentTab", { screen: "AssignmentHome" });
  };
  const canClassTest =
    !!role && (roleHasPermission(role as Role, "tracker:read") || roleHasPermission(role as Role, "roster:manage"));
  const canClassNotes = !!role && roleHasPermission(role as Role, "routine:read");

  const PendingRow = ({
    label,
    count,
    onPress,
    danger,
  }: {
    label: string;
    count: number;
    onPress: () => void;
    danger?: boolean;
  }): React.ReactElement => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          minHeight: 48,
          paddingVertical: space(2),
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Body style={{ flex: 1 }}>{label}</Body>
      <Badge text={bnNum(count)} tone={count > 0 ? (danger ? "danger" : "warn") : "ok"} />
    </Pressable>
  );

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        {/* Date header — today + the Bangla day name */}
        <H2>
          {bnNum(date)} · {dayOfWeekLabel(DAYS_OF_WEEK[new Date().getDay()])}
        </H2>

        {/* D-#290: name the class-teacher duty — the reconcile alerts have an owner. */}
        {ctOf.length > 0 ? (
          <Muted style={{ marginBottom: space(2) }}>
            🎓 {STR.ctOfTitle}:{" "}
            {ctOf
              .map((s) => `${classLevelLabel(s.classLevel)}${s.nameBn ? ` — ${s.nameBn}` : ""}`)
              .join(", ")}
          </Muted>
        ) : null}

        {q.error ? (
          <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
        ) : null}
        {q.fetching && !day ? <Loader label={STR.loading} /> : null}

        {/* Red backlog alerts (D-#279) — anything owed TODAY or on a previous school day.
            Each row deep-links into the screen that clears it. Empty ⇒ nothing renders. */}
        {alerts.length > 0 || prep ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(1), color: colors.error }}>
              ⚠ {STR.alertsTitle}
            </Body>

            {/* Amber countdown (D-#280) — sits above the red rows: it is the thing that
                has NOT slipped yet. Vanishes the moment the item is delivered, and turns
                into the red `assignment_entry` row once the deadline passes. */}
            {prep ? (
              <Pressable
                onPress={() => nav.navigate("AssignmentTab", { screen: "AssignmentHome" })}
                accessibilityRole="button"
                accessibilityLabel={STR.prepAssignment}
                style={({ pressed }) => [{ paddingVertical: space(2) }, pressed && { opacity: 0.7 }]}
              >
                <Body style={{ fontWeight: "600", color: colors.warning }}>
                  ⏳ {STR.prepAssignment} · {timeLeft(prep.dueAt)} {STR.prepLeft}
                </Body>
                <Muted>
                  {STR.prepDeadline}: {bnNum(prep.deliveryDateKey)} · {bnNum(prep.items)} {STR.alertItems}
                </Muted>
              </Pressable>
            ) : null}

            {alerts.map((a) => (
              <Pressable
                key={a.kind}
                onPress={() => alertTarget(a.kind)}
                accessibilityRole="button"
                accessibilityLabel={alertLabel(a.kind)}
                style={({ pressed }) => [{ paddingVertical: space(2) }, pressed && { opacity: 0.7 }]}
              >
                <Body style={{ fontWeight: "600", color: colors.error }}>
                  {alertLabel(a.kind)} · {bnNum(a.count)}{" "}
                  {a.kind === "assignment_entry" ? STR.alertItems : STR.alertDays}
                </Body>
                {a.oldestDateKey && a.oldestDateKey !== date ? (
                  <Muted>
                    {STR.alertOldest}: {bnNum(a.oldestDateKey)}
                  </Muted>
                ) : null}
              </Pressable>
            ))}
          </Card>
        ) : null}

        {/* Principal/Office: per-class presence for today, then who still hasn't marked. */}
        {canManage && presence.length > 0 ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.classPresenceTitle}</Body>
            {presence.map((c) => (
              <View
                key={c.classId}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: space(2) }}
              >
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: "600" }}>{classLevelLabel(c.classLevel)}</Body>
                  <Muted>
                    {STR.presentWord}: {bnNum(c.presentCount)} · {STR.absentWord}: {bnNum(c.absentCount)} /{" "}
                    {bnNum(c.totalCount)}
                  </Muted>
                </View>
                {c.complete ? (
                  <Badge text={bnNum(c.presentCount)} tone="ok" />
                ) : (
                  <Badge text={STR.presenceIncomplete} tone="warn" />
                )}
              </View>
            ))}
          </Card>
        ) : null}

        {canManage && unmarked.length > 0 ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(1), color: colors.error }}>
              ⚠ {STR.attUnmarkedSections} · {bnNum(unmarked.length)}
            </Body>
            {/* Same shape as Attendance → Report: name the still-missing UNITS (the Quran
                GROUPS for Class 1–5), so the Office can see which teacher to chase from
                here too — the two screens must not disagree. */}
            {unmarked.map((u) => (
              <View key={u.sectionId} style={{ paddingVertical: space(2) }}>
                <Body style={{ fontWeight: "600" }}>
                  {classLevelLabel(u.classLevel)}
                  {u.sectionNameBn ? ` — ${u.sectionNameBn}` : ""}
                </Body>
                {u.pendingUnits.map((p) => (
                  <View
                    key={`${p.unitType}:${p.unitId}`}
                    style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: space(1) }}
                  >
                    <Muted style={{ flex: 1 }}>
                      {p.unitType === "subjectgroup" ? "🕌 " : ""}
                      {p.label}
                    </Muted>
                    <Muted>{p.markerName ?? "—"}</Muted>
                  </View>
                ))}
              </View>
            ))}
          </Card>
        ) : null}

        {/* My periods */}
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.myPeriods}</Body>
          {day && slots.length === 0 ? (
            <Muted>{day.dayType !== "FULL" && day.dayType !== "QURAN_ONLY" ? dayTypeLabel(day.dayType) : STR.rtNoSlots}</Muted>
          ) : null}
          {slots.map((s) => (
            <View key={s.id} style={{ paddingVertical: space(2) }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                <Body style={{ fontWeight: "600", flex: 1 }}>
                  {STR.rtPeriodN} {bnNum(s.periodNumber)}
                  {s.startTime && s.endTime ? ` · ${bnNum(s.startTime)}–${bnNum(s.endTime)}` : ""}
                </Body>
                {s.isCovering ? <Badge text={STR.rtCoveringFor} tone="warn" /> : null}
              </View>
              <Muted>
                {routineSubjectLabel(s.subject)}
                {s.groupName ? ` · ${s.groupName}` : ""}
                {s.isCovering && s.teacherName ? ` · ${STR.rtCoveringFor} ${s.teacherName}` : ""}
                {!s.isCovering && s.coverTeacherName ? ` · ${STR.rtCovered}: ${s.coverTeacherName}` : ""}
              </Muted>
            </View>
          ))}
        </Card>

        {/* Pending work — each count opens the exact queue in one tap */}
        {day ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.pendingWork}</Body>
            <PendingRow
              label={STR.hwCheckingTitle}
              count={hw?.pendingChecking ?? 0}
              onPress={() => nav.navigate("HomeworkTab", { screen: "CheckingQueue" })}
            />
            <PendingRow
              label={STR.hwChaseList}
              count={hw?.activeChases ?? 0}
              danger
              onPress={() => nav.navigate("HomeworkTab", { screen: "HomeworkHome" })}
            />
            <PendingRow
              label={STR.hwOpenResubmissions}
              count={hw?.openResubmissions ?? 0}
              onPress={() => nav.navigate("HomeworkTab", { screen: "HomeworkRecords" })}
            />
            {canAttendance ? (
              <PendingRow
                label={STR.attMarkTitle}
                count={day.attendancePending ? 1 : 0}
                danger
                onPress={() => nav.navigate("AttendanceTab", { screen: "AttendanceHome" })}
              />
            ) : null}
          </Card>
        ) : null}

        {/* Quick actions — gated exactly like the target tabs */}
        {canDeclare || canAttendance || canClassTest ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.quickActions}</Body>
            <ChipRow>
              {canDeclare ? (
                <Chip
                  label={`📒 ${STR.hwDeclareTitle}`}
                  onPress={() => nav.navigate("HomeworkTab", { screen: "DeclareHomework" })}
                />
              ) : null}
              {canAttendance ? (
                <Chip label={`🙋 ${STR.tabAttendance}`} onPress={() => nav.navigate("AttendanceTab", { screen: "AttendanceHome" })} />
              ) : null}
              {/* UX-8 §4.8 note 5: the Class Notes deep link (same routine:read gate). */}
              {canClassNotes ? (
                <Chip
                  label={`📓 ${STR.drawerItemClassNotes}`}
                  onPress={() => nav.navigate("ClassNotesTab", { screen: "MyClassNotes" })}
                />
              ) : null}
              {canClassTest ? (
                <Chip
                  label={`🧪 ${STR.tabClassTest}`}
                  onPress={() => nav.navigate("ClassTestTab", { screen: "RequestClassTest" })}
                />
              ) : null}
            </ChipRow>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
