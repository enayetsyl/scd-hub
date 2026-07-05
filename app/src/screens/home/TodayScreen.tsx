/**
 * TodayScreen (UX-4, prd-ux-improvements.md §4.4, D-#265) — the staff landing
 * dashboard: the caller's day at a glance via the ONE `myDay` read.
 *   date header      — today + the Bangla day name
 *   My periods       — the caller's own routine slots (time · subject · class),
 *                      day-type empty state on holidays/off days
 *   Pending work     — tappable count rows deep-linking straight into the exact
 *                      work queue (checking / homework home / attendance)
 *   Quick actions    — chips into the highest-traffic entry forms, rendered only
 *                      when the role holds the target tab's EXISTING gate (the
 *                      same roleHasPermission checks AppTabs uses — no new gating)
 * Refetches on focus (the HomeworkHome pattern) so counts never go stale.
 */
import React, { useCallback, useRef } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useQuery } from "urql";
import { DAYS_OF_WEEK, roleHasPermission } from "@scd/shared";
import type { Role } from "@scd/shared";
import { MY_DAY_QUERY } from "../../graphql/operations";
import { Screen, H2, Body, Muted, Card, Chip, ChipRow, Badge, Loader, ErrorBanner } from "../../components/ui";
import { STR, bnNum, dayOfWeekLabel, dayTypeLabel, routineSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme/tokens";

const todayISO = (): string => new Date().toISOString().slice(0, 10);

/** Cross-tab navigation (the Basket→Sets convention): navigate bubbles up to the drawer. */
type CrossNav = { navigate: (name: string, params?: object) => void };

export default function TodayScreen(): React.ReactElement {
  const nav = useNavigation() as unknown as CrossNav;
  const { role } = useAuth();
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

  // The SAME gates AppTabs uses for the target tabs (no new gating logic).
  const canDeclare = !!role && roleHasPermission(role as Role, "tracker:read");
  const canAttendance =
    !!role &&
    (roleHasPermission(role as Role, "attendance:mark") || roleHasPermission(role as Role, "attendance:manage"));
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

        {q.error ? (
          <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
        ) : null}
        {q.fetching && !day ? <Loader label={STR.loading} /> : null}

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
