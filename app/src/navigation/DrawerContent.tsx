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

import { STR } from "../lib/labels";
import { bnNum } from "../lib/labels";
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
  const present = React.useMemo(() => new Set(props.state.routeNames), [props.state.routeNames]);
  const activeRoute = props.state.routes[props.state.index]?.name as RouteName | undefined;

  // Groups default to expanded (only two of them); a tap collapses/expands.
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  const badgeFor = (route: RouteName): number | undefined =>
    route === "QuestionsTab" && basket.count > 0 ? basket.count : undefined;

  const go = (route: RouteName): void => {
    // navigate bubbles to the drawer and (in slide-over mode) closes it.
    props.navigation.navigate(route as never);
  };

  const Leaf = ({ leaf, indent }: { leaf: NavLeaf; indent?: boolean }): React.ReactElement | null => {
    if (!present.has(leaf.route)) return null;
    const active = leaf.route === activeRoute;
    const badge = badgeFor(leaf.route);
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
