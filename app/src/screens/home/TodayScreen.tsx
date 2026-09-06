/**
 * TodayScreen "আজকের কাজ" (ux-audit F7 redesign, D-#265/#279/#280/#290/#318 logic
 * kept) — the teacher landing dashboard. Every daily job — INCLUDING the
 * question-bank sets loop — starts here in ≤2 taps; the screen answers "what
 * needs me right now?" before anything else.
 *
 *   Header          — full Bangla date ("বুধবার, ১৬ জুলাই ২০২৬") + class-teacher
 *                     duty line (D-#290)
 *   Alert stack     — SAME alert logic/deep-links as before (D-#279/#280),
 *                     restyled: errorContainer/goldContainer filled cards with a
 *                     1dp matching border, 22dp icon + text (never color alone)
 *   আমার পিরিয়ড     — horizontal timeline of today's slots; past slots dimmed,
 *                     the CURRENT slot highlighted primaryContainer + "এখন"
 *                     badge (12sp — caption floor); tap → class notes
 *   অমীমাংসিত কাজ   — count rows with display-scale Bangla numerals; each row
 *                     one-tap deep-links into the exact queue
 *   Quick actions   — 8-tile lucide-icon grid (F7 core: adds প্রশ্নব্যাংক /
 *                     আমার সেট / ট্র্যাকার / ছুটির আবেদন to the old four), gated
 *                     exactly like the target tabs (AppTabs' checks — no new
 *                     gating), Bangla accessibilityLabel on every tile
 *   সাম্প্রতিক সেট   — the caller's last 2 sets (new myRecentSets read) with a
 *                     one-tap [ট্র্যাকার খুলুন]: routes to the EXISTING open
 *                     tracker when there is one (openTracker is not idempotent),
 *                     else opens one — TrackerEntry in 2 taps from login
 *
 * QueryGate wraps the aggregate myDay sections; the quick-action grid renders
 * OUTSIDE the gate so the empty-day state ("আজ কোনো নির্ধারিত কাজ নেই।") still
 * offers every entry point. Pull-to-refresh + focus-refetch keep counts fresh.
 * No emoji — Icon (lucide) only (F19 seed).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useMutation, useQuery } from "urql";
import type { Role } from "@scd/shared";
import {
  MY_DAY_QUERY,
  MY_WORK_CLAIMS_QUERY,
  MY_SECTION_ATTENDANCE,
  MY_RECENT_SETS,
  MY_HW_LIFECYCLE_QUERY,
  MY_AS_LIFECYCLE_QUERY,
  OPEN_TRACKER,
  type RecentSetT,
  type RoutineSlotT,
  type AssignmentPrepT,
  type HwPendingStage,
} from "../../graphql/operations";
import { CLASS_TEST_REPORTS_STATUS_QUERY } from "../../graphql/classTest";
import { HwPendingSheet, type HwPendingTarget } from "../../components/HwPendingSheet";
import { useSectionContext } from "../../state/SectionContext";
import { Screen, H1, H2, Body, Muted, Card, Badge, Button, EmptyState, Notice } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { WorkClaimTeacherCard } from "../../components/WorkClaimTeacherCard";
import { ReturningStudentsCard } from "../../components/ReturningStudentsCard";
import { Icon, type IconName } from "../../components/Icon";
import {
  STR,
  bnNum,
  classLevelLabel,
  dayTypeLabel,
  fullDateLabel,
  hwSubjectLabel,
  routineSubjectLabel,
  selectionSummaryLabel,
  setTypeLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { useColors } from "../../theme";
import { radius, space, typeScale } from "../../theme/tokens";
import { usePullRefresh } from "../../lib/useRefresh";
import { dateKey } from "../../lib/dates";

const todayISO = (): string => dateKey();

/** Cross-tab navigation (the Basket→Sets convention): navigate bubbles up to the drawer. */
type CrossNav = { navigate: (name: string, params?: object) => void };

/** "HH:MM" for the local clock — comparable against the slots' zero-padded times. */
const hhmm = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

type SlotPhase = "past" | "current" | "upcoming";
const slotPhase = (s: RoutineSlotT, nowHM: string): SlotPhase => {
  if (!s.startTime || !s.endTime) return "upcoming";
  if (s.endTime <= nowHM) return "past";
  if (s.startTime <= nowHM) return "current";
  return "upcoming";
};

export default function TodayScreen(): React.ReactElement {
  const nav = useNavigation() as unknown as CrossNav;
  const { role, user, can } = useAuth();
  const colors = useColors();
  const date = todayISO();

  const [q, refetch] = useQuery({ query: MY_DAY_QUERY, variables: { date } });
  // GC-4: the caller's own open guardian claims. The server field is
  // authenticated-only and returns [] for a caller with none, so this needs no
  // permission probe — the D-#535 lesson about probes that can white-screen.
  const [claimsQ, refetchClaims] = useQuery({ query: MY_WORK_CLAIMS_QUERY, variables: {} });

  // The SAME gates AppTabs uses for the target tabs (no new gating logic).
  const canDeclare = can("tracker:read");
  const canManage = can("attendance:manage");
  const canAttendance =
    !!role &&
    (can("attendance:mark") || can("attendance:manage"));
  const canClassTest =
    !!role && (can("tracker:read") || can("roster:manage"));
  const canClassNotes = can("routine:read");
  const canQuestions = can("question:read");
  const canSets = can("set:read");
  const canTrackers = can("tracker:read");
  const canHr = !!role && role !== "GUARDIAN";

  // D-#318: the teacher's OWN sections' attendance at a glance (admins land on
  // the card dashboard instead, so no pause needed beyond the guardian gate).
  const [mySectionsQ, refetchMySections] = useQuery({
    query: MY_SECTION_ATTENDANCE,
    variables: { dateKey: date },
    pause: canManage,
  });
  const mySections = mySectionsQ.data?.mySectionAttendance ?? [];

  // ux-audit F7: the caller's last 2 sets — the shortcut back into tracking.
  const [recentQ, refetchRecent] = useQuery({
    query: MY_RECENT_SETS,
    variables: { limit: 2 },
    pause: !canSets,
  });
  const recentSets = recentQ.data?.myRecentSets ?? [];

  // D-#340: MY class tests already held but with incomplete result entry — each
  // renders as a pending alert that deep-links into its entry grid. Self-scoped
  // read (teacherId = me), so no section context is needed.
  const canFileTests = can("tracker:write");
  const [ctPendingQ, refetchCtPending] = useQuery({
    query: CLASS_TEST_REPORTS_STATUS_QUERY,
    variables: { teacherId: user?.id ?? null },
    pause: !canFileTests || !user?.id,
  });
  // The teacher's OWN leg ends at SUBMIT, not at release. `state` has been
  // publish-anchored since D-#603 (`complete` === publishComplete, and `overdue`
  // stays true until the office publishes), so filtering on it kept a test the
  // teacher had entered 17/17 AND submitted sitting in her red "ফলাফল এন্ট্রি বাকি"
  // stack for as long as the office sat on it — blaming her for the office's leg.
  // `submitComplete` is that boundary (deriveReportOwnership), and the office's
  // share is already tracked separately as publishOverdue.
  const ctPending = (ctPendingQ.data?.classTestReportsStatus ?? []).filter(
    (r) => !r.submitComplete && dateKey(new Date(r.examDate)) <= date,
  );

  // Owner 2026-07-25: the teacher's OWN homework lifecycle at a glance — totals +
  // the four pending pills, each tapping the pending drill (HwPendingSheet). Same
  // routine attribution (D-#351) as the admin report; self-scoped read.
  const hwLcFrom = dateKey(new Date(Date.now() - 14 * 86_400_000));
  const hwLcTo = dateKey(new Date());
  const [hwLcQ, refetchHwLc] = useQuery({
    query: MY_HW_LIFECYCLE_QUERY,
    variables: { from: hwLcFrom, to: hwLcTo },
    pause: !canTrackers,
  });
  const myHwLc = hwLcQ.data?.myHomeworkLifecycle ?? null;
  // D-#471: the same card for assignments, over the same 14-day window so the two read
  // side by side. Pills open the assignment workspace (where the work is actually done)
  // rather than a drill sheet — assignments have no pending-drill resolver, and the
  // owner asked for this card "for easy navigation".
  const [asLcQ, refetchAsLc] = useQuery({
    query: MY_AS_LIFECYCLE_QUERY,
    variables: { from: hwLcFrom, to: hwLcTo },
    pause: !canTrackers,
  });
  const myAsLc = asLcQ.data?.myAssignmentLifecycle ?? null;
  // The workspace reads its class/section from here, so a drill row can point it.
  const { setSection } = useSectionContext();
  const [hwLcTarget, setHwLcTarget] = useState<HwPendingTarget | null>(null);
  const [hwLcSheetOpen, setHwLcSheetOpen] = useState(false);
  const openHwLcDrill = (stage: HwPendingStage, label: string): void => {
    if (!user?.id) return;
    setHwLcTarget({ teacherId: user.id, teacherName: myHwLc?.teacherName ?? "", stage, stageLabel: label });
    setHwLcSheetOpen(true);
  };

  const refetchAll = useCallback(() => {
    refetch({ requestPolicy: "network-only" });
    if (!canManage) refetchMySections({ requestPolicy: "network-only" });
    if (canSets) refetchRecent({ requestPolicy: "network-only" });
    if (canFileTests && user?.id) refetchCtPending({ requestPolicy: "network-only" });
    if (canTrackers) refetchHwLc({ requestPolicy: "network-only" });
    if (canTrackers) refetchAsLc({ requestPolicy: "network-only" });
  }, [refetch, refetchMySections, refetchRecent, refetchCtPending, refetchHwLc, refetchAsLc, canManage, canSets, canFileTests, canTrackers, user?.id]);

  // Focus-refetch (HomeworkHome pattern): skip the first focus — the queries
  // already run on mount — then refresh whenever the user returns. Also picks
  // up a just-opened tracker's id for the recent-set shortcut.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      refetchAll();
    }, [refetchAll]),
  );

  const { refreshing, onRefresh } = usePullRefresh(
    q.fetching || mySectionsQ.fetching || recentQ.fetching || ctPendingQ.fetching,
    refetchAll,
  );

  const day = q.data?.myDay;
  const slots = day?.slots ?? [];
  const hw = day?.homework;
  const alerts = day?.alerts ?? [];
  const ctOf = day?.classTeacherOf ?? [];
  const prep = day?.assignmentPrep ?? null;
  const handout = day?.assignmentHandout ?? [];

  // ONE always-on minute tick drives both the amber countdown and the timeline's
  // past/current highlighting (the old interval only ran while `prep` existed).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowHM = hhmm(now);

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

  /** Each alert deep-links into the screen that clears it (unchanged, D-#279). */
  const alertTarget = (kind: string): void => {
    if (kind === "attendance") nav.navigate("AttendanceTab", { screen: "AttendanceHome" });
    else if (kind === "class_note") nav.navigate("ClassNotesTab", { screen: "MyClassNotes" });
    else if (kind === "hw_reconcile") nav.navigate("HomeworkTab", { screen: "HomeworkHome" });
    else nav.navigate("AssignmentTab", { screen: "AssignmentHome" });
  };

  // Recent-set → tracker shortcut. openTracker is NOT idempotent, so when the
  // server says a tracker is already open we route straight into it.
  const [, openTracker] = useMutation(OPEN_TRACKER);
  const [busySetId, setBusySetId] = useState<string | null>(null);
  const [trackerError, setTrackerError] = useState<string | null>(null);
  const gotoTracker = (trackerId: string): void =>
    nav.navigate("TrackersTab", { screen: "TrackerEntry", params: { trackerId }, initial: false });
  const onOpenTracker = async (s: RecentSetT): Promise<void> => {
    if (busySetId) return;
    if (s.openTrackerId) {
      gotoTracker(s.openTrackerId);
      return;
    }
    setBusySetId(s.id);
    setTrackerError(null);
    const res = await openTracker({ setId: s.id, sectionId: s.sectionId });
    setBusySetId(null);
    if (res.error || !res.data?.openTracker) {
      setTrackerError(friendlyError(res.error));
      return;
    }
    gotoTracker(res.data.openTracker.trackerId);
  };

  // Empty day: the aggregate loaded and there is literally nothing scheduled or
  // owed. The quick-action grid still renders below (outside the gate).
  const counts = [hw?.pendingChecking ?? 0, hw?.activeChases ?? 0, hw?.openResubmissions ?? 0];
  const emptyDay =
    !!day &&
    slots.length === 0 &&
    alerts.length === 0 &&
    !prep &&
    handout.length === 0 &&
    ctPending.length === 0 &&
    counts.every((c) => c === 0) &&
    !day.attendancePending;

  // ---------------------------------------------------------------------------
  // Section pieces
  // ---------------------------------------------------------------------------

  /** The prep card names the (class × subject) cells still to prepare — the bare
   *  countdown didn't say WHAT to make (owner ask 2026-07-23). Caps the list so a
   *  teacher with many rotation cells still gets a readable one-liner. */
  const prepSubtitle = (p: AssignmentPrepT): string => {
    // "বাকি"/"left" only reads right while time REMAINS — once timeLeft() flips to
    // prepDueNow it would render "সময় শেষ বাকি" ("time's up left").
    const remaining = new Date(p.dueAt).getTime() - now;
    const head = remaining > 0 ? `${timeLeft(p.dueAt)} ${STR.prepLeft}` : timeLeft(p.dueAt);
    const cells = p.cells ?? [];
    if (cells.length === 0) return `${head} · ${bnNum(p.items)} ${STR.alertItems}`;
    const shown = cells
      .slice(0, 4)
      .map((c) => `${classLevelLabel(c.classLevel)} · ${hwSubjectLabel(c.subject)}`)
      .join(", ");
    const rest = cells.length - 4;
    return rest > 0 ? `${head} — ${shown} +${bnNum(rest)} ${STR.prepMore}` : `${head} — ${shown}`;
  };

  const AlertCard = ({
    icon,
    tone,
    title,
    sub,
    onPress,
  }: {
    icon: IconName;
    tone: "error" | "gold";
    title: string;
    sub: string;
    onPress: () => void;
  }): React.ReactElement => {
    const fg = tone === "error" ? colors.onErrorContainer : colors.onGoldContainer;
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${title} — ${sub}`}
        style={({ pressed }) => [
          {
            flexDirection: "row",
            alignItems: "center",
            gap: space(3),
            minHeight: 56,
            padding: space(3),
            borderRadius: radius.md,
            borderWidth: 1,
            backgroundColor: tone === "error" ? colors.errorContainer : colors.goldContainer,
            borderColor: tone === "error" ? colors.error : colors.gold,
            marginBottom: space(2),
          },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Icon name={icon} size={22} color={fg} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Body style={{ fontWeight: "700", color: fg }}>{title}</Body>
          <Body style={{ ...typeScale.secondary, color: fg }}>{sub}</Body>
        </View>
        <Icon name="chevron-right" size={20} color={fg} />
      </Pressable>
    );
  };

  const CountRow = ({
    label,
    count,
    color,
    onPress,
    last,
  }: {
    label: string;
    count: number;
    color: string;
    onPress: () => void;
    last?: boolean;
  }): React.ReactElement => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} — ${bnNum(count)}`}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space(3),
          minHeight: 56,
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: colors.border,
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Body style={{ flex: 1 }}>{label}</Body>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <Body style={{ ...typeScale.display, color }}>{bnNum(count)}</Body>
        <Icon name="chevron-right" size={20} color={colors.textSecondary} />
      </View>
    </Pressable>
  );

  type Tile = { key: string; icon: IconName; label: string; go: () => void };
  const tiles: (Tile | false)[] = [
    canDeclare && {
      key: "hw",
      icon: "book-open" as const,
      label: STR.hwDeclareTitle,
      go: () => nav.navigate("HomeworkTab", { screen: "DeclareHomework", initial: false }),
    },
    canAttendance && {
      key: "att",
      icon: "hand" as const,
      label: STR.tabAttendance,
      go: () => nav.navigate("AttendanceTab", { screen: "AttendanceHome" }),
    },
    canClassNotes && {
      key: "notes",
      icon: "square-pen" as const,
      label: STR.drawerItemClassNotes,
      go: () => nav.navigate("ClassNotesTab", { screen: "MyClassNotes" }),
    },
    canClassTest && {
      key: "ct",
      icon: "flask-conical" as const,
      label: STR.tabClassTest,
      go: () => nav.navigate("ClassTestTab", { screen: "RequestClassTest", initial: false }),
    },
    canQuestions && {
      key: "qbank",
      icon: "clipboard-list" as const,
      label: STR.tdQuestionBank,
      go: () => nav.navigate("QuestionsTab", { screen: "QuestionBank", initial: false }),
    },
    canSets && {
      key: "sets",
      icon: "star" as const,
      label: STR.tdMySets,
      go: () => nav.navigate("SetsTab", { screen: "SetList", initial: false }),
    },
    canTrackers && {
      key: "trackers",
      icon: "check-square" as const,
      label: STR.tabTrackers,
      go: () => nav.navigate("TrackersTab", { screen: "TrackerList", initial: false }),
    },
    canHr && {
      key: "leave",
      icon: "calendar" as const,
      label: STR.tdLeaveApply,
      go: () => nav.navigate("HrTab", { screen: "MyLeave", initial: false }),
    },
  ];
  const visibleTiles = tiles.filter((t): t is Tile => !!t);

  return (
    <Screen
      scroll
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Header — full Bangla date + class-teacher duty line (D-#290) */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <Icon name="calendar" size={20} color={colors.primary} />
        <H1>{fullDateLabel(date)}</H1>
      </View>
      {ctOf.length > 0 ? (
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginTop: space(1), marginBottom: space(2) }}
        >
          <Icon name="graduation-cap" size={16} color={colors.textSecondary} />
          <Muted style={{ flex: 1 }}>
            {STR.ctOfTitle}:{" "}
            {ctOf
              .map((s) => `${classLevelLabel(s.classLevel)}${s.nameBn ? ` — ${s.nameBn}` : ""}`)
              .join(", ")}
          </Muted>
        </View>
      ) : (
        <View style={{ height: space(2) }} />
      )}

      <QueryGate
        result={q}
        onRetry={refetchAll}
        isEmpty={emptyDay}
        empty={
          <View style={{ marginBottom: space(3) }}>
            {day && day.dayType !== "FULL" && day.dayType !== "QURAN_ONLY" ? (
              <Muted style={{ textAlign: "center", marginBottom: space(1) }}>{dayTypeLabel(day.dayType)}</Muted>
            ) : null}
            <EmptyState message={STR.tdEmptyDay} />
          </View>
        }
      >
        {/* Alert stack — restyled D-#279/#280 cards; deep-links unchanged */}
        {alerts.length > 0 || prep || ctPending.length > 0 ? (
          <View style={{ marginBottom: space(2) }}>
            <Muted style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.alertsTitle}</Muted>
            {prep ? (
              <AlertCard
                icon="clock"
                tone="gold"
                title={STR.prepAssignment}
                sub={prepSubtitle(prep)}
                onPress={() => nav.navigate("AssignmentTab", { screen: "AssignmentHome" })}
              />
            ) : null}
            {alerts.map((a) => (
              <AlertCard
                key={a.kind}
                icon="alert-triangle"
                tone="error"
                title={alertLabel(a.kind)}
                sub={`${bnNum(a.count)} ${a.kind === "assignment_entry" ? STR.alertItems : STR.alertDays}${
                  a.oldestDateKey && a.oldestDateKey !== date ? ` · ${STR.alertOldest}: ${bnNum(a.oldestDateKey)}` : ""
                }`}
                onPress={() => alertTarget(a.kind)}
              />
            ))}
            {/* D-#340: held exams with incomplete result entry → straight into the grid. */}
            {ctPending.map((r) => (
              <AlertCard
                key={r.testId}
                icon="flask-conical"
                tone={r.teacherOverdue ? "error" : "gold"}
                title={`${STR.tdCtResultPending}: ${hwSubjectLabel(r.subject)} · ${STR.ctTestNumber} ${bnNum(r.testNumber)}`}
                sub={`${bnNum(dateKey(new Date(r.examDate)))} · ${STR.ctEntered} ${bnNum(r.enteredCount)}/${bnNum(r.rosterCount)}${
                  r.teacherOverdue ? ` · ${STR.ctSchoolDaysLate} ${bnNum(r.schoolDaysLate)}` : ""
                }`}
                onPress={() =>
                  nav.navigate("ClassTestTab", {
                    screen: "ClassTestResults",
                    params: {
                      testId: r.testId,
                      title: `${hwSubjectLabel(r.subject)} · ${STR.ctTestNumber} ${bnNum(r.testNumber)}`,
                    },
                    initial: false,
                  })
                }
              />
            ))}
          </View>
        ) : null}

        {/* AS-T7 (D-#643) — শেষ পিরিয়ডে বিতরণ: the packets this teacher collects from
            the office and hands out, because a section's LAST period today is theirs.
            Server returns [] on every day that is not the delivery day, so the card's
            mere presence is the signal that today is the day. */}
        {handout.length > 0 ? (
          <Card onPress={() => nav.navigate("AssignmentTab", { screen: "AssignmentHandout", initial: false })}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginBottom: space(1) }}>
              <Icon name="package" size={18} color={colors.textPrimary} />
              <Body style={{ fontWeight: "700", flex: 1 }}>{STR.hoTodayTitle}</Body>
              <Icon name="chevron-right" size={20} color={colors.textSecondary} />
            </View>
            <Muted style={{ marginBottom: space(2) }}>{STR.hoCollect}</Muted>
            {handout.map((sec) => (
              <View key={sec.sectionId} style={{ marginBottom: space(2) }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space(1), flexWrap: "wrap" }}>
                  <Body style={{ fontWeight: "700" }}>
                    {classLevelLabel(sec.classLevel)}
                    {sec.sectionNameBn ? ` — ${sec.sectionNameBn}` : ""}
                  </Body>
                  {sec.lastPeriodNumber ? (
                    <Muted>
                      {STR.hoPeriodWord} {bnNum(sec.lastPeriodNumber)}
                    </Muted>
                  ) : null}
                  {sec.isCover ? <Badge text={STR.hoCover} tone="info" /> : null}
                  <Badge text={`${bnNum(sec.packets.length)} ${STR.hoSubjectsWord}`} tone="brand" />
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
                  {sec.packets.map((p) => (
                    <Badge
                      key={p.entryId}
                      text={p.printRequested ? hwSubjectLabel(p.subject) : `${hwSubjectLabel(p.subject)} ⚠`}
                      tone={p.printRequested ? "muted" : "warn"}
                    />
                  ))}
                </View>
                {sec.nilPackets.length > 0 ? (
                  <Muted style={{ marginTop: space(1) }}>
                    {STR.hoNilTitle}: {sec.nilPackets.map((p) => hwSubjectLabel(p.subject)).join(", ")}
                  </Muted>
                ) : null}
              </View>
            ))}
          </Card>
        ) : null}

        {/* আমার পিরিয়ড — horizontal timeline; current slot highlighted */}
        <H2>{STR.myPeriods}</H2>
        {day && slots.length === 0 ? (
          <Muted style={{ marginBottom: space(3) }}>
            {day.dayType !== "FULL" && day.dayType !== "QURAN_ONLY" ? dayTypeLabel(day.dayType) : STR.rtNoSlots}
          </Muted>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -space(4), marginBottom: space(3) }}
            contentContainerStyle={{ gap: space(2), paddingHorizontal: space(4), paddingVertical: space(1) }}
          >
            {slots.map((s) => {
              const phase = slotPhase(s, nowHM);
              const current = phase === "current";
              const fg = current ? colors.onPrimaryContainer : colors.textPrimary;
              const fgMuted = current ? colors.onPrimaryContainer : colors.textSecondary;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => nav.navigate("ClassNotesTab", { screen: "MyClassNotes" })}
                  accessibilityRole="button"
                  accessibilityLabel={`${STR.rtPeriodN} ${bnNum(s.periodNumber)} — ${routineSubjectLabel(s.subject)}${current ? ` — ${STR.tdNow}` : ""}`}
                  style={({ pressed }) => [
                    {
                      width: 136,
                      padding: space(3),
                      borderRadius: radius.md,
                      borderWidth: 1,
                      borderColor: current ? colors.primary : colors.border,
                      backgroundColor: current ? colors.primaryContainer : colors.surface,
                    },
                    phase === "past" && { opacity: 0.6 },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(1) }}>
                    <Body style={{ ...typeScale.caption, fontWeight: current ? "700" : "400", color: fgMuted }}>
                      {STR.rtPeriodN} {bnNum(s.periodNumber)}
                      {s.startTime ? ` · ${bnNum(s.startTime)}` : ""}
                    </Body>
                    {current ? (
                      <View
                        style={{
                          backgroundColor: colors.primary,
                          borderRadius: radius.pill,
                          paddingHorizontal: space(2),
                        }}
                      >
                        {/* 12sp minimum — the caption floor (the prototype's 11px is below it) */}
                        <Body style={{ ...typeScale.caption, fontWeight: "700", color: colors.onPrimary }}>
                          {STR.tdNow}
                        </Body>
                      </View>
                    ) : null}
                  </View>
                  <Body style={{ fontWeight: "700", color: fg }} numberOfLines={1}>
                    {routineSubjectLabel(s.subject)}
                  </Body>
                  <Body style={{ ...typeScale.caption, color: fgMuted }} numberOfLines={1}>
                    {s.groupName ?? "—"}
                    {s.isCovering && s.teacherName ? ` · ${STR.rtCoveringFor} ${s.teacherName}` : ""}
                    {!s.isCovering && s.coverTeacherName ? ` · ${STR.rtCovered}: ${s.coverTeacherName}` : ""}
                  </Body>
                  {s.isCovering ? (
                    <View style={{ alignSelf: "flex-start", marginTop: space(1) }}>
                      <Badge text={STR.rtCoveringFor} tone="warn" />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* GC-4 — অভিভাবকের জানানো: claims waiting on THIS teacher. Renders nothing
            when there are none, and myWorkClaims returns [] rather than refusing for
            a caller with no claims at all (D-#535). */}
        <WorkClaimTeacherCard
          rows={claimsQ.data?.myWorkClaims ?? []}
          onChanged={() => refetchClaims({ requestPolicy: "network-only" })}
        />

        {/* RL-1 — ছুটি শেষে ফিরেছে: who is back today, and what to ask them for. */}
        <ReturningStudentsCard rows={q.data?.myDay?.returningStudents ?? []} />

        {/* D-#318: the teacher's OWN sections' attendance at a glance — tap for names. */}
        {!canManage && mySections.length > 0 ? (
          <Card onPress={() => nav.navigate("AttendanceTab", { screen: "SectionAttendance", initial: false })}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginBottom: space(1) }}>
              <Icon name="hand" size={18} color={colors.textPrimary} />
              <Body style={{ fontWeight: "700", flex: 1 }}>{STR.attMySectionsToday}</Body>
              <Icon name="chevron-right" size={20} color={colors.textSecondary} />
            </View>
            {mySections.map((sec) => (
              <View
                key={sec.sectionId}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: space(1) }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: space(1), flex: 1 }}>
                  <Body>
                    {classLevelLabel(sec.classLevel)}
                    {sec.sectionNameBn ? ` — ${sec.sectionNameBn}` : ""}
                  </Body>
                  {!sec.complete ? <Badge text={STR.presenceIncomplete} tone="warn" /> : null}
                </View>
                <Muted>
                  {STR.presentWord}: {bnNum(sec.presentCount)} · {STR.absentWord}: {bnNum(sec.absentCount)} /{" "}
                  {bnNum(sec.totalCount)}
                </Muted>
              </View>
            ))}
          </Card>
        ) : null}

        {/* Owner 2026-07-25: my homework lifecycle — totals + tappable pending pills. */}
        {canTrackers && myHwLc && myHwLc.given > 0 ? (
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginBottom: space(1) }}>
              <Icon name="book-open" size={18} color={colors.textPrimary} />
              <Body style={{ fontWeight: "700", flex: 1 }}>{STR.tdMyHwLifecycle}</Body>
            </View>
            <Muted style={{ marginBottom: space(2) }}>
              {STR.hlrGiven} {bnNum(myHwLc.given)} · {STR.hlrSubmitted} {bnNum(myHwLc.submitted)} ·{" "}
              {STR.hlrChecked} {bnNum(myHwLc.checked)} · {STR.hlrReturned} {bnNum(myHwLc.returned)}
            </Muted>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
              {(
                [
                  { stage: "SUBMISSION", label: STR.hlrPendingSubmission, count: myHwLc.pendingSubmission },
                  { stage: "CHECK", label: STR.hlrPendingCheck, count: myHwLc.pendingChecking },
                  { stage: "RETURN", label: STR.hlrPendingReturn, count: myHwLc.pendingReturn },
                  { stage: "CHASE", label: STR.hlrChasedPending, count: myHwLc.chasedPending },
                ] as { stage: HwPendingStage; label: string; count: number }[]
              ).map((p) => {
                const active = p.count > 0;
                return (
                  <Pressable
                    key={p.stage}
                    onPress={() => (active ? openHwLcDrill(p.stage, p.label) : undefined)}
                    disabled={!active}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space(1),
                      paddingVertical: space(1),
                      paddingHorizontal: space(2),
                      borderRadius: radius.pill,
                      backgroundColor: active ? colors.errorContainer : colors.surfaceAlt,
                    }}
                  >
                    <Body style={{ fontWeight: "700", color: active ? colors.error : colors.textSecondary }}>
                      {bnNum(p.count)}
                    </Body>
                    <Muted style={{ color: active ? colors.textPrimary : colors.textSecondary }}>{p.label}</Muted>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        ) : null}

        {/* D-#471: my assignment lifecycle — the twin of the homework card above.
            Pills deep-link into the assignment workspace instead of a drill sheet. */}
        {canTrackers && myAsLc && myAsLc.given > 0 ? (
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginBottom: space(1) }}>
              <Icon name="clipboard-list" size={18} color={colors.textPrimary} />
              <Body style={{ fontWeight: "700", flex: 1 }}>{STR.tdMyAsLifecycle}</Body>
            </View>
            <Muted style={{ marginBottom: space(2) }}>
              {STR.hlrGiven} {bnNum(myAsLc.given)} · {STR.hlrSubmitted} {bnNum(myAsLc.submitted)} ·{" "}
              {STR.hlrChecked} {bnNum(myAsLc.checked)} · {STR.hlrReturned} {bnNum(myAsLc.returned)}
            </Muted>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
              {[
                { key: "SUBMISSION", label: STR.hlrPendingSubmission, count: myAsLc.pendingSubmission },
                { key: "CHECK", label: STR.hlrPendingCheck, count: myAsLc.pendingChecking },
                { key: "RETURN", label: STR.hlrPendingReturn, count: myAsLc.pendingReturn },
                { key: "CHASE", label: STR.hlrChasedPending, count: myAsLc.chasedPending },
              ].map((p) => {
                const active = p.count > 0;
                return (
                  <Pressable
                    key={p.key}
                    onPress={() =>
                      active
                        ? nav.navigate("AssignmentTab", { screen: "AssignmentWorkspace", initial: false })
                        : undefined
                    }
                    disabled={!active}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space(1),
                      paddingVertical: space(1),
                      paddingHorizontal: space(2),
                      borderRadius: radius.pill,
                      backgroundColor: active ? colors.errorContainer : colors.surfaceAlt,
                    }}
                  >
                    <Body style={{ fontWeight: "700", color: active ? colors.error : colors.textSecondary }}>
                      {bnNum(p.count)}
                    </Body>
                    <Muted style={{ color: active ? colors.textPrimary : colors.textSecondary }}>{p.label}</Muted>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        ) : null}

        {/* অমীমাংসিত কাজ — display-numeral count rows, one-tap deep links */}
        {day ? (
          <>
            <H2>{STR.pendingWork}</H2>
            <Card>
              <CountRow
                label={STR.hwCheckingTitle}
                count={hw?.pendingChecking ?? 0}
                color={colors.error}
                onPress={() => nav.navigate("HomeworkTab", { screen: "HomeworkWorkspace", initial: false })}
              />
              <CountRow
                label={STR.hwChaseList}
                count={hw?.activeChases ?? 0}
                color={colors.warning}
                onPress={() => nav.navigate("HomeworkTab", { screen: "HomeworkHome" })}
              />
              <CountRow
                label={STR.hwOpenResubmissions}
                count={hw?.openResubmissions ?? 0}
                color={colors.info}
                onPress={() => nav.navigate("HomeworkTab", { screen: "HomeworkWorkspace", initial: false })}
                last={!canAttendance}
              />
              {canAttendance ? (
                <CountRow
                  label={STR.attMarkTitle}
                  count={day.attendancePending ? 1 : 0}
                  color={colors.error}
                  onPress={() => nav.navigate("AttendanceTab", { screen: "AttendanceHome" })}
                  last
                />
              ) : null}
            </Card>
          </>
        ) : null}
      </QueryGate>

      {/* Quick actions — OUTSIDE the gate: reachable on empty days and errors too */}
      {visibleTiles.length > 0 ? (
        <>
          <H2>{STR.quickActions}</H2>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: space(3) }}>
            {visibleTiles.map((t) => (
              <Pressable
                key={t.key}
                onPress={t.go}
                accessibilityRole="button"
                accessibilityLabel={t.label}
                style={({ pressed }) => [
                  {
                    width: "25%",
                    minHeight: 96,
                    alignItems: "center",
                    paddingVertical: space(2),
                    paddingHorizontal: space(1),
                    gap: space(2),
                  },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: radius.md,
                    backgroundColor: colors.primaryContainer,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name={t.icon} size={24} color={colors.primary} />
                </View>
                <Body style={{ ...typeScale.caption, fontWeight: "500", textAlign: "center" }} numberOfLines={2}>
                  {t.label}
                </Body>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {/* সাম্প্রতিক সেট — assembly → tracking in 2 taps (F7 loop closure) */}
      {canSets && recentSets.length > 0 ? (
        <>
          <H2>{STR.tdRecentSets}</H2>
          {trackerError ? <Notice message={trackerError} tone="danger" /> : null}
          {recentSets.map((s) => (
            <Card key={s.id}>
              <Pressable
                onPress={() => nav.navigate("SetsTab", { screen: "SetDetail", params: { setId: s.id }, initial: false })}
                accessibilityRole="button"
                accessibilityLabel={s.name ?? setTypeLabel(s.setType)}
                style={({ pressed }) => [pressed && { opacity: 0.7 }]}
              >
                <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space(2) }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Body style={{ fontWeight: "700" }} numberOfLines={2}>
                      {s.name ?? setTypeLabel(s.setType)}
                    </Body>
                    <Muted>
                      {setTypeLabel(s.setType)} · {selectionSummaryLabel(s.itemCount, s.totalMarks ?? 0)}
                    </Muted>
                  </View>
                  <Badge
                    text={s.status === "assembled" ? STR.statusAssembled : STR.statusDraft}
                    tone={s.status === "assembled" ? "ok" : "warn"}
                  />
                </View>
              </Pressable>
              {s.status === "assembled" ? (
                <View style={{ marginTop: space(3) }}>
                  <Button
                    title={STR.openTracker}
                    variant="secondary"
                    loading={busySetId === s.id}
                    onPress={() => void onOpenTracker(s)}
                  />
                </View>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      {/* The pending drill behind a homework-lifecycle pill (self-scoped). */}
      <HwPendingSheet
        visible={hwLcSheetOpen}
        target={hwLcTarget}
        from={hwLcFrom}
        to={hwLcTo}
        classLevel={null}
        subject={null}
        onClose={() => setHwLcSheetOpen(false)}
        // Tapping a row opens the workspace on THAT card's class/section (owner ask
        // 2026-08-04). The workspace reads the shared SectionContext, so the selection
        // is set first and the sheet closed — otherwise it would open on whatever class
        // was last looked at, which is exactly the guesswork this drill removes.
        onOpenCard={(g) => {
          setSection({
            classId: g.classId,
            sectionId: g.sectionId,
            classLevel: g.classLevel,
            classNameBn: null,
            sectionCode: null,
            sectionNameBn: g.sectionNameBn,
          });
          setHwLcSheetOpen(false);
          nav.navigate("HomeworkTab", { screen: "HomeworkWorkspace", initial: false });
        }}
      />
    </Screen>
  );
}
