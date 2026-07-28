/**
 * AdminTodayScreen (D-#316) — the Principal/Office Today dashboard: the whole
 * school's day as collapsible summary cards from the ONE `adminToday` read.
 *
 * Interaction (owner spec): collapsed = icon · title · badges; tap → expands
 * INLINE to the top rows; the footer link (or tapping any row) deep-links to
 * the full screen (`initial: false`, so back returns here). Card keys map to
 * icon/title/target in the registry below — new cards are mostly server work.
 * Teachers keep the existing TodayScreen; AppTabs picks per role.
 */
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View, RefreshControl } from "react-native";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useQuery } from "urql";
import { DAYS_OF_WEEK } from "@scd/shared";
import { ADMIN_TODAY_QUERY, type AdminTodayCardT } from "../../graphql/operations";
import type { TabParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Badge, Loader, ErrorBanner } from "../../components/ui";
import { STR, bnNum, dayOfWeekLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme/tokens";
import { dateKey } from "../../lib/dates";

type BadgeTone = "ok" | "warn" | "danger" | "info" | "muted" | "brand";
const toneOf = (t: string): BadgeTone =>
  t === "ok" || t === "warn" || t === "danger" || t === "info" || t === "muted" ? t : "info";

type LabelKey = keyof typeof STR;
interface CardMeta {
  icon: string;
  titleKey: LabelKey;
  target: { tab: keyof TabParamList; screen: string };
}

/** key → icon/title/deep-link. The server decides card content; this decides looks. */
const REGISTRY: Record<string, CardMeta> = {
  attendance: { icon: "🙋", titleKey: "dcAttendance", target: { tab: "AttendanceTab", screen: "AttendanceReport" } },
  hwCycle: { icon: "📒", titleKey: "dcHwCycle", target: { tab: "AdminTab", screen: "ReconciliationReport" } },
  hwLifecycle: { icon: "📘", titleKey: "dcHwLifecycle", target: { tab: "AdminTab", screen: "HwLifecycleReport" } },
  assignments: { icon: "📋", titleKey: "dcAssignments", target: { tab: "ReportsTab", screen: "AsDeclarePending" } },
  leave: { icon: "🏖️", titleKey: "dcLeave", target: { tab: "HrTab", screen: "LeaveAdmin" } },
  observations: { icon: "👁️", titleKey: "dcObservations", target: { tab: "ObservationTab", screen: "ObservationHome" } },
  comments: { icon: "🗣️", titleKey: "dcComments", target: { tab: "CommentsTab", screen: "CommentReview" } },
  classTests: { icon: "🧪", titleKey: "dcClassTests", target: { tab: "ClassTestTab", screen: "ClassTestDashboard" } },
  print: { icon: "🖨️", titleKey: "dcPrint", target: { tab: "PrintTab", screen: "PrintHome" } },
};

/** badge key → label key (language-free wire keys, client labels). */
const BADGE_LABELS: Record<string, LabelKey> = {
  present: "dcbPresent",
  absent: "dcbAbsent",
  unmarked: "dcbUnmarked",
  pendingConfirm: "dcbPendingConfirm",
  notDeclared: "dcbNotDeclared",
  confirmed: "dcbConfirmed",
  autoIssued: "dcbAutoIssued",
  checkingBacklog: "dcbCheckingBacklog",
  declarePending: "dcbDeclarePending",
  deliverPending: "dcbDeliverPending",
  leavePending: "dcbLeavePending",
  needsCover: "dcbNeedsCover",
  obsUploaded: "dcbObsUploaded",
  obsAssigned: "dcbObsAssigned",
  obsReviewed: "dcbObsReviewed",
  obsResponded: "dcbObsResponded",
  obsAwaitingPublish: "dcbObsAwaitingPublish",
  commentsToday: "dcbCommentsToday",
  commentsPendingReview: "dcbCommentsPendingReview",
  ctPrintPending: "dcbCtPrintPending",
  ctAwaitingApproval: "dcbCtAwaitingApproval",
  printRequested: "dcbPrintRequested",
  printToDeliver: "dcbPrintToDeliver",
  error: "dcbError",
};

const badgeLabel = (key: string): string => (BADGE_LABELS[key] ? STR[BADGE_LABELS[key]] : key);

/** Badges that deep-link somewhere MORE specific than their card's target
 *  (owner ask 2026-07-21: tapping "awaiting publish" opens the filtered list).
 *  Badges without an entry fall back to the card target, like the rows. */
const BADGE_TARGETS: Record<string, CardMeta["target"] & { params?: object }> = {
  obsAwaitingPublish: {
    tab: "ObservationTab",
    screen: "AllObservations",
    // withheld:false so the opened list matches the badge's own count (CO-12, D-#369 —
    // the card excludes deliberately-withheld rows).
    params: { state: "REVIEWED", published: false, withheld: false },
  },
};

export default function AdminTodayScreen(): React.ReactElement {
  const nav = useNavigation<NavigationProp<TabParamList>>();
  const date = dateKey();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const [q, refetch] = useQuery({ query: ADMIN_TODAY_QUERY, variables: { date }, requestPolicy: "cache-and-network" });
  const cards = q.data?.adminToday ?? [];

  const { refreshing, onRefresh } = usePullRefresh(q.fetching, () => refetch({ requestPolicy: "network-only" }));

  // The registry's tab is a union, so the per-tab tuple overloads can't narrow —
  // route the call through a plain signature (params shape is the nested-navigate
  // standard: { screen, initial }).
  const goTarget = (target: CardMeta["target"] & { params?: object }): void =>
    (nav.navigate as unknown as (tab: string, params: object) => void)(target.tab, {
      screen: target.screen,
      initial: false,
      ...(target.params ? { params: target.params } : {}),
    });
  const goTo = (meta: CardMeta): void => goTarget(meta.target);

  const renderCard = (card: AdminTodayCardT): React.ReactElement | null => {
    const meta = REGISTRY[card.key];
    if (!meta) return null; // a future server card this app version doesn't know — skip
    const isOpen = !!open[card.key];
    return (
      <Card key={card.key} onPress={() => setOpen((m) => ({ ...m, [card.key]: !isOpen }))}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
          <Text style={{ fontSize: 18 }}>{meta.icon}</Text>
          <Body style={{ fontWeight: "700", flex: 1 }}>{STR[meta.titleKey]}</Body>
          <Text style={{ fontSize: 12 }}>{isOpen ? "▾" : "▸"}</Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
          {card.badges.map((b) => (
            <Pressable
              key={b.key}
              accessibilityRole="button"
              onPress={() => goTarget(BADGE_TARGETS[b.key] ?? meta.target)}
            >
              <Badge text={`${badgeLabel(b.key)}: ${bnNum(b.value)}`} tone={toneOf(b.tone)} />
            </Pressable>
          ))}
        </View>
        {isOpen ? (
          <View style={{ marginTop: space(2) }}>
            {card.rows.map((r, i) => (
              <Pressable
                key={`${card.key}-${i}`}
                onPress={() => goTo(meta)}
                style={{ flexDirection: "row", alignItems: "center", paddingVertical: space(1), gap: space(2) }}
              >
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: "600" }}>{r.title}</Body>
                  {r.subtitle ? <Muted>{r.subtitle}</Muted> : null}
                </View>
                {r.value ? <Badge text={r.value} tone={toneOf(r.tone)} /> : null}
              </Pressable>
            ))}
            {card.moreCount > 0 ? (
              <Muted style={{ marginTop: 2 }}>
                +{bnNum(card.moreCount)} {STR.dcMore}
              </Muted>
            ) : null}
            <Pressable onPress={() => goTo(meta)} style={{ marginTop: space(2) }} accessibilityRole="link">
              <Body style={{ fontWeight: "600" }}>{STR.dcOpen}</Body>
            </Pressable>
          </View>
        ) : null}
      </Card>
    );
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <H2>
          {bnNum(date)} · {dayOfWeekLabel(DAYS_OF_WEEK[new Date().getDay()])}
        </H2>

        {q.error ? (
          <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
        ) : null}
        {q.fetching && cards.length === 0 ? <Loader label={STR.loading} /> : null}

        {cards.map(renderCard)}

        {/* Static launcher card — the Reports hub (client-side, no server data). */}
        <Card onPress={() => goTo({ icon: "📊", titleKey: "dcReports", target: { tab: "ReportsTab", screen: "ReportsHome" } })}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
            <Text style={{ fontSize: 18 }}>📊</Text>
            <Body style={{ fontWeight: "700", flex: 1 }}>{STR.dcReports}</Body>
            <Text style={{ fontSize: 12 }}>→</Text>
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
