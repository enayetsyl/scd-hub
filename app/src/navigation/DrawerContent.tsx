/**
 * Custom drawer content (D-#258) — the EximusEdu-familiar grouped sidebar.
 *
 * Replaces React Navigation's default flat drawer-item list with collapsible
 * module GROUPS (Academics, Trackers, Reports) plus flat standalone items
 * (Attendance, Library, Finance, HR, …). It renders ONLY the routes the role actually holds:
 * the Drawer.Navigator registers a Drawer.Screen for a module only when its
 * permission gate passes (unchanged from the old bottom-tab gating), so
 * `state.routeNames` already reflects the role — we filter the config against it
 * and drop any group left empty. Staff + guardian route sets are mutually
 * exclusive, so one concatenated config serves both.
 *
 * Styling reuses the existing theme tokens (palette kept — D-#258); the active
 * route is tinted with `primaryContainer`.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { DrawerContentScrollView, type DrawerContentComponentProps } from "@react-navigation/drawer";
import { useQuery } from "urql";
import { roleHasPermission } from "@scd/shared";
import type { Role } from "@scd/shared";

import { STR } from "../lib/labels";
import { bnNum } from "../lib/labels";
import { PRINT_QUEUE_COUNTS } from "../graphql/printing";
import { CT_QUESTION_COUNTS } from "../graphql/classTest";
import { STAFF_LEAVE_PENDING_COUNT, COMMENT_REVIEW_COUNT, OBSERVATION_COUNTS } from "../graphql/operations";
import { subscribeLiveEvents } from "../lib/liveEvents";
import { useAuth } from "../auth/AuthContext";
import { useBasket } from "../state/BasketContext";
import { fonts, radius, space, typeScale, useColors } from "../theme";
import type { TabParamList } from "./types";

type RouteName = keyof TabParamList;
type LabelKey = keyof typeof STR;

/**
 * `screen` (optional) deep-links to a screen INSIDE the route's stack (with
 * `initial: false`, so back returns to the stack's home — the D-#311 lesson).
 * Used by the Reports group, whose leaves all live in the one ReportsTab stack.
 */
type NavLeaf = { route: RouteName; labelKey: LabelKey; icon: string; screen?: string };
type NavSection =
  | ({ type: "item" } & NavLeaf)
  | { type: "group"; titleKey: LabelKey; icon: string; items: NavLeaf[] };

/**
 * Module grouping. Names lean on EximusEdu vocabulary for familiarity; the leaf
 * labels reuse the existing `tab*` STR keys (so no double-translation), except
 * the generic Trackers tab which is shown as "Daily Tracker" to disambiguate it
 * from the "Trackers" group header.
 */
const STAFF_NAV: NavSection[] = [
  { type: "item", route: "HomeTab", labelKey: "drawerItemToday", icon: "🏠" },
  {
    type: "group",
    titleKey: "drawerGroupAcademics",
    icon: "📖",
    items: [
      { route: "ContentTab", labelKey: "tabContent", icon: "📚" },
      { route: "QuestionsTab", labelKey: "tabQuestions", icon: "❓" },
      { route: "SetsTab", labelKey: "tabSets", icon: "🗂️" },
      { route: "ReviewTab", labelKey: "tabReview", icon: "📝" },
      { route: "RoutineTab", labelKey: "tabRoutine", icon: "📅" },
      { route: "VocabTab", labelKey: "tabVocab", icon: "🔤" },
      // English Drive (D-#344) — entry point per owner decision #9.
      { route: "EnglishDriveTab", labelKey: "tabEnglishDrive", icon: "🅰️" },
    ],
  },
  {
    type: "group",
    titleKey: "drawerGroupTrackers",
    icon: "✅",
    items: [
      { route: "TrackersTab", labelKey: "drawerItemDailyTracker", icon: "✅" },
      { route: "HomeworkTab", labelKey: "tabHomework", icon: "📒" },
      { route: "AssignmentTab", labelKey: "tabAssignment", icon: "📋" },
      { route: "ClassTestTab", labelKey: "tabClassTest", icon: "🧪" },
      { route: "ExamsTab", labelKey: "tabExams", icon: "📝" },
      { route: "RevisionTab", labelKey: "tabRevision", icon: "🕌" },
    ],
  },
  { type: "item", route: "AttendanceTab", labelKey: "tabAttendance", icon: "🙋" },
  { type: "item", route: "PrintTab", labelKey: "tabPrint", icon: "🖨️" },
  { type: "item", route: "ClassNotesTab", labelKey: "drawerItemClassNotes", icon: "📓" },
  { type: "item", route: "CommentsTab", labelKey: "tabComments", icon: "🗣️" },
  { type: "item", route: "ObservationTab", labelKey: "tabObservation", icon: "👁️" },
  { type: "item", route: "FreeMixingTab", labelKey: "tabFreeMixing", icon: "🎥" },
  { type: "item", route: "LibraryTab", labelKey: "tabLibrary", icon: "📖" },
  { type: "item", route: "ChatTab", labelKey: "tabChat", icon: "💬" },
  { type: "item", route: "FinanceTab", labelKey: "tabFinance", icon: "💰" },
  { type: "item", route: "HrTab", labelKey: "tabHr", icon: "🧑‍💼" },
  {
    type: "group",
    titleKey: "tabReports",
    icon: "📊",
    items: [
      { route: "ReportsTab", labelKey: "clTitle", icon: "🧑‍🏫", screen: "TeacherClassLoad" },
      { route: "ReportsTab", labelKey: "alReportTitle", icon: "📋", screen: "AssignmentLoadReport" },
      // D-#340: the class-test oversight report.
      { route: "ReportsTab", labelKey: "ctReportTitle", icon: "🧪", screen: "ClassTestReport" },
      { route: "ReportsTab", labelKey: "attReportTitle", icon: "🙋", screen: "AttendanceReport" },
      { route: "ReportsTab", labelKey: "rtNoteReportTitle", icon: "📓", screen: "ClassNoteReport" },
      { route: "ReportsTab", labelKey: "rptHwDeclarePending", icon: "📕", screen: "HwDeclarePending" },
      { route: "ReportsTab", labelKey: "rptHwIssuePending", icon: "📒", screen: "HwIssuePending" },
      { route: "ReportsTab", labelKey: "rptAsDeclarePending", icon: "📋", screen: "AsDeclarePending" },
      { route: "ReportsTab", labelKey: "rptAsDeliverPending", icon: "📦", screen: "AsDeliverPending" },
      // Owner ask 2026-07-20: moved here from the Admin hub.
      { route: "ReportsTab", labelKey: "rrTitle", icon: "🔄", screen: "ReconciliationReport" },
      { route: "ReportsTab", labelKey: "hlrTitle", icon: "📘", screen: "HwLifecycleReport" },
    ],
  },
  { type: "item", route: "AdminTab", labelKey: "tabAdmin", icon: "⚙️" },
];

const GUARDIAN_NAV: NavSection[] = [
  { type: "item", route: "GuardianHomeTab", labelKey: "gpToday", icon: "🏠" },
  {
    type: "group",
    titleKey: "drawerGroupAcademics",
    icon: "📖",
    items: [
      { route: "GuardianRoutineTab", labelKey: "tabRoutine", icon: "📅" },
      { route: "GuardianHomeworkTab", labelKey: "tabHomework", icon: "📒" },
      { route: "GuardianAssignmentsTab", labelKey: "tabAssignment", icon: "📋" },
    ],
  },
];

const NAV: NavSection[] = [...STAFF_NAV, ...GUARDIAN_NAV];

export default function DrawerContent(props: DrawerContentComponentProps): React.ReactElement {
  const colors = useColors();
  const basket = useBasket();
  const { role } = useAuth();
  const present = React.useMemo(() => new Set(props.state.routeNames), [props.state.routeNames]);
  const focusedTab = props.state.routes[props.state.index];
  const activeRoute = focusedTab?.name as RouteName | undefined;
  // The focused screen INSIDE the active tab's stack (undefined until the stack
  // has navigated) — lets a deep-link leaf highlight only its own report.
  const nestedState = focusedTab?.state;
  const activeNested = nestedState?.routes?.[nestedState.index ?? nestedState.routes.length - 1]?.name;

  // Groups default to expanded (only two of them); a tap collapses/expands.
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  // D-#294: the print operator's queue counters — red = awaiting printing, yellow =
  // awaiting delivery. `additionalTypenames: ["PrintRequest"]` makes urql's document
  // cache invalidate (and refetch) this query the INSTANT any print mutation on this
  // device completes — create / mark printed / mark delivered / cancel — even though
  // the counts payload itself carries no PrintRequest object. The 60s poll remains
  // only for jobs arriving from OTHER devices; teachers (no roster:manage) never ask.
  const isPrintOperator = !!role && roleHasPermission(role as Role, "roster:manage");
  const countsContext = React.useMemo(() => ({ additionalTypenames: ["PrintRequest"] }), []);
  const [countsQ, refetchCounts] = useQuery({
    query: PRINT_QUEUE_COUNTS,
    pause: !isPrintOperator,
    requestPolicy: "cache-and-network",
    context: countsContext,
  });
  React.useEffect(() => {
    if (!isPrintOperator) return;
    const id = setInterval(() => refetchCounts({ requestPolicy: "network-only" }), 60_000);
    return () => clearInterval(id);
  }, [isPrintOperator, refetchCounts]);
  // D-#295: cross-device push — the SSE stream nudges the instant ANY device
  // creates/advances a print job (web; native keeps the poll above).
  React.useEffect(() => {
    if (!isPrintOperator) return;
    return subscribeLiveEvents(["print_queue"], () =>
      refetchCounts({ requestPolicy: "network-only" }),
    );
  }, [isPrintOperator, refetchCounts]);
  const printCounts = countsQ.data?.printQueueCounts;

  // Owner 2026-07-25: Class Test drawer badges mirroring Print — red = question
  // requests the office still owes a paper on (REQUESTED/CHANGES_REQUESTED),
  // yellow = papers in the teacher's review (IN_REVIEW). Office/Principal see the
  // whole pipeline; a teacher sees their own (server-scoped). Same cache-nudge on
  // any CT-question mutation via the shared typename.
  const canClassTestBadge = !!role && (roleHasPermission(role as Role, "roster:manage") || roleHasPermission(role as Role, "tracker:write"));
  const ctCountsContext = React.useMemo(() => ({ additionalTypenames: ["CtQuestionRequest"] }), []);
  const [ctCountsQ, refetchCtCounts] = useQuery({
    query: CT_QUESTION_COUNTS,
    pause: !canClassTestBadge,
    requestPolicy: "cache-and-network",
    context: ctCountsContext,
  });
  React.useEffect(() => {
    if (!canClassTestBadge) return;
    const id = setInterval(() => refetchCtCounts({ requestPolicy: "network-only" }), 60_000);
    return () => clearInterval(id);
  }, [canClassTestBadge, refetchCtCounts]);
  const ctCounts = ctCountsQ.data?.ctQuestionCounts;

  // Owner 2026-07-26: Staff drawer badge — leave applications awaiting approval
  // (Principal/Office, leave:manage). Refreshes on any StaffLeaveApplication mutation.
  const canLeaveBadge = !!role && roleHasPermission(role as Role, "leave:manage");
  const leaveCountContext = React.useMemo(() => ({ additionalTypenames: ["StaffLeaveApplication"] }), []);
  const [leaveCountQ, refetchLeaveCount] = useQuery({
    query: STAFF_LEAVE_PENDING_COUNT,
    pause: !canLeaveBadge,
    requestPolicy: "cache-and-network",
    context: leaveCountContext,
  });
  React.useEffect(() => {
    if (!canLeaveBadge) return;
    const id = setInterval(() => refetchLeaveCount({ requestPolicy: "network-only" }), 60_000);
    return () => clearInterval(id);
  }, [canLeaveBadge, refetchLeaveCount]);
  const leavePending = leaveCountQ.data?.staffLeavePendingCount ?? 0;

  // Owner 2026-07-26: Comments drawer badge — undelivered comments awaiting
  // Principal/Office review (roster:manage), mirroring Print. Refreshes on any
  // StudentComment mutation (record / edit / deliver).
  const canCommentBadge = !!role && roleHasPermission(role as Role, "roster:manage");
  const commentCountContext = React.useMemo(() => ({ additionalTypenames: ["StudentComment"] }), []);
  const [commentCountQ, refetchCommentCount] = useQuery({
    query: COMMENT_REVIEW_COUNT,
    pause: !canCommentBadge,
    requestPolicy: "cache-and-network",
    context: commentCountContext,
  });
  React.useEffect(() => {
    if (!canCommentBadge) return;
    const id = setInterval(() => refetchCommentCount({ requestPolicy: "network-only" }), 60_000);
    return () => clearInterval(id);
  }, [canCommentBadge, refetchCommentCount]);
  const commentPending = commentCountQ.data?.commentReviewCount ?? 0;

  // Owner 2026-07-26: Observation drawer badge — red = observations assigned to me
  // awaiting my review (observation:review); yellow = reviewed awaiting publish
  // (observation:upload). Any observation participant (observation:read) asks; each
  // count is server-scoped and 0 without the matching permission. Refreshes on any
  // ClassroomObservation mutation.
  const canObservationBadge = !!role && roleHasPermission(role as Role, "observation:read");
  const obsCountContext = React.useMemo(() => ({ additionalTypenames: ["ClassroomObservation"] }), []);
  const [obsCountQ, refetchObsCount] = useQuery({
    query: OBSERVATION_COUNTS,
    pause: !canObservationBadge,
    requestPolicy: "cache-and-network",
    context: obsCountContext,
  });
  React.useEffect(() => {
    if (!canObservationBadge) return;
    const id = setInterval(() => refetchObsCount({ requestPolicy: "network-only" }), 60_000);
    return () => clearInterval(id);
  }, [canObservationBadge, refetchObsCount]);
  const obsCounts = obsCountQ.data?.observationCounts;

  const badgeFor = (route: RouteName): number | undefined =>
    route === "QuestionsTab" && basket.count > 0 ? basket.count : undefined;

  /** Extra tinted badges (D-#294): [count, background] pairs, rendered when > 0. */
  const tintedBadgesFor = (route: RouteName): Array<{ count: number; bg: string }> => {
    if (route === "PrintTab" && isPrintOperator && printCounts) {
      const out: Array<{ count: number; bg: string }> = [];
      if (printCounts.requested > 0) out.push({ count: printCounts.requested, bg: colors.error });
      if (printCounts.printed > 0) out.push({ count: printCounts.printed, bg: colors.warning });
      return out;
    }
    if (route === "ClassTestTab" && canClassTestBadge && ctCounts) {
      const out: Array<{ count: number; bg: string }> = [];
      if (ctCounts.pending > 0) out.push({ count: ctCounts.pending, bg: colors.error });
      if (ctCounts.inReview > 0) out.push({ count: ctCounts.inReview, bg: colors.warning });
      return out;
    }
    if (route === "HrTab" && canLeaveBadge && leavePending > 0) {
      return [{ count: leavePending, bg: colors.error }];
    }
    if (route === "CommentsTab" && canCommentBadge && commentPending > 0) {
      return [{ count: commentPending, bg: colors.error }];
    }
    if (route === "ObservationTab" && canObservationBadge && obsCounts) {
      const out: Array<{ count: number; bg: string }> = [];
      if (obsCounts.toReview > 0) out.push({ count: obsCounts.toReview, bg: colors.error });
      if (obsCounts.toPublish > 0) out.push({ count: obsCounts.toPublish, bg: colors.warning });
      return out;
    }
    return [];
  };

  const go = (leaf: NavLeaf): void => {
    // navigate bubbles to the drawer and (in slide-over mode) closes it.
    // Deep-link leaves keep the stack's back button via `initial: false` (D-#311).
    // The route name is dynamic, so it can't satisfy the per-literal tuple
    // overloads of the drawer helpers' navigate — hence the unknown-cast.
    const navigate = props.navigation.navigate as unknown as (name: string, params?: object) => void;
    if (leaf.screen) navigate(leaf.route, { screen: leaf.screen, initial: false });
    else navigate(leaf.route);
  };

  const Leaf = ({ leaf, indent }: { leaf: NavLeaf; indent?: boolean }): React.ReactElement | null => {
    if (!present.has(leaf.route)) return null;
    const active = leaf.route === activeRoute && (!leaf.screen || leaf.screen === activeNested);
    const badge = badgeFor(leaf.route);
    const tinted = tintedBadgesFor(leaf.route);
    return (
      <Pressable
        onPress={() => go(leaf)}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space(3),
          minHeight: 48,
          paddingVertical: space(2),
          paddingHorizontal: space(4),
          paddingLeft: indent ? space(7) : space(4),
          backgroundColor: active ? colors.primaryContainer : "transparent",
          borderRadius: radius.md,
          marginHorizontal: space(2),
          marginBottom: space(1),
        }}
      >
        <Text style={{ fontSize: 18 }}>{leaf.icon}</Text>
        <Text
          style={{
            ...typeScale.button,
            color: active ? colors.onPrimaryContainer : colors.textPrimary,
            flex: 1,
          }}
          numberOfLines={1}
        >
          {STR[leaf.labelKey]}
        </Text>
        {badge !== undefined ? (
          <View
            style={{
              backgroundColor: colors.primary,
              borderRadius: radius.pill,
              minWidth: 20,
              height: 20,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 6,
            }}
          >
            <Text style={{ color: colors.onPrimary, ...typeScale.caption, fontFamily: fonts.bold }}>
              {bnNum(badge)}
            </Text>
          </View>
        ) : null}
        {/* D-#294: the print operator's red (to print) + yellow (to deliver) counters. */}
        {tinted.map((b, i) => (
          <View
            key={i}
            style={{
              backgroundColor: b.bg,
              borderRadius: radius.pill,
              minWidth: 20,
              height: 20,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 6,
              marginLeft: i > 0 || badge !== undefined ? 4 : 0,
            }}
          >
            <Text style={{ color: colors.onPrimary, ...typeScale.caption, fontFamily: fonts.bold }}>
              {bnNum(b.count)}
            </Text>
          </View>
        ))}
      </Pressable>
    );
  };

  const renderSection = (section: NavSection, idx: number): React.ReactElement | null => {
    if (section.type === "item") {
      return <Leaf key={section.route} leaf={section} />;
    }
    const visible = section.items.filter((it) => present.has(it.route));
    if (visible.length === 0) return null;
    const key = `${section.titleKey}-${idx}`;
    const isCollapsed = collapsed[key] ?? false;
    return (
      <View key={key} style={{ marginTop: space(1) }}>
        <Pressable
          onPress={() => setCollapsed((c) => ({ ...c, [key]: !isCollapsed }))}
          accessibilityRole="button"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space(3),
            minHeight: 44,
            paddingVertical: space(2),
            paddingHorizontal: space(4),
          }}
        >
          <Text style={{ fontSize: 18 }}>{section.icon}</Text>
          <Text style={{ ...typeScale.bodyStrong, color: colors.textSecondary, flex: 1 }} numberOfLines={1}>
            {STR[section.titleKey]}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14 }}>{isCollapsed ? "▸" : "▾"}</Text>
        </Pressable>
        {isCollapsed ? null : visible.map((it) => <Leaf key={`${it.route}:${it.screen ?? ""}`} leaf={it} indent />)}
      </View>
    );
  };

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={{ paddingTop: 0 }}>
      <View
        style={{
          paddingVertical: space(4),
          paddingHorizontal: space(4),
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          marginBottom: space(2),
        }}
      >
        <Text style={{ ...typeScale.sectionTitle, color: colors.primary }}>{STR.appName}</Text>
        <Text style={{ ...typeScale.caption, color: colors.textSecondary }} numberOfLines={2}>
          {STR.appSub}
        </Text>
      </View>
      {NAV.map(renderSection)}
    </DrawerContentScrollView>
  );
}
