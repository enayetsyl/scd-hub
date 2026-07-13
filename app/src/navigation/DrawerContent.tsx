/**
 * Custom drawer content (D-#258) — the EximusEdu-familiar grouped sidebar.
 *
 * Replaces React Navigation's default flat drawer-item list with collapsible
 * module GROUPS (Academics, Trackers) plus flat standalone items (Attendance,
 * Library, Finance, HR, …). It renders ONLY the routes the role actually holds:
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
import { useAuth } from "../auth/AuthContext";
import { useBasket } from "../state/BasketContext";
import { fonts, radius, space, typeScale, useColors } from "../theme";
import type { TabParamList } from "./types";

type RouteName = keyof TabParamList;
type LabelKey = keyof typeof STR;

type NavLeaf = { route: RouteName; labelKey: LabelKey; icon: string };
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
      { route: "RevisionTab", labelKey: "tabRevision", icon: "🕌" },
    ],
  },
  { type: "item", route: "AttendanceTab", labelKey: "tabAttendance", icon: "🙋" },
  { type: "item", route: "PrintTab", labelKey: "tabPrint", icon: "🖨️" },
  { type: "item", route: "ClassNotesTab", labelKey: "drawerItemClassNotes", icon: "📓" },
  { type: "item", route: "CommentsTab", labelKey: "tabComments", icon: "🗣️" },
  { type: "item", route: "ObservationTab", labelKey: "tabObservation", icon: "👁️" },
  { type: "item", route: "LibraryTab", labelKey: "tabLibrary", icon: "📖" },
  { type: "item", route: "ChatTab", labelKey: "tabChat", icon: "💬" },
  { type: "item", route: "FinanceTab", labelKey: "tabFinance", icon: "💰" },
  { type: "item", route: "HrTab", labelKey: "tabHr", icon: "🧑‍💼" },
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
  const activeRoute = props.state.routes[props.state.index]?.name as RouteName | undefined;

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
  const printCounts = countsQ.data?.printQueueCounts;

  const badgeFor = (route: RouteName): number | undefined =>
    route === "QuestionsTab" && basket.count > 0 ? basket.count : undefined;

  /** Extra tinted badges (D-#294): [count, background] pairs, rendered when > 0. */
  const tintedBadgesFor = (route: RouteName): Array<{ count: number; bg: string }> => {
    if (route !== "PrintTab" || !isPrintOperator || !printCounts) return [];
    const out: Array<{ count: number; bg: string }> = [];
    if (printCounts.requested > 0) out.push({ count: printCounts.requested, bg: colors.error });
    if (printCounts.printed > 0) out.push({ count: printCounts.printed, bg: colors.warning });
    return out;
  };

  const go = (route: RouteName): void => {
    // navigate bubbles to the drawer and (in slide-over mode) closes it.
    props.navigation.navigate(route as never);
  };

  const Leaf = ({ leaf, indent }: { leaf: NavLeaf; indent?: boolean }): React.ReactElement | null => {
    if (!present.has(leaf.route)) return null;
    const active = leaf.route === activeRoute;
    const badge = badgeFor(leaf.route);
    const tinted = tintedBadgesFor(leaf.route);
    return (
      <Pressable
        onPress={() => go(leaf.route)}
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
        {isCollapsed ? null : visible.map((it) => <Leaf key={it.route} leaf={it} indent />)}
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
