/**
 * NotificationCenterScreen (N-3, N3.2/N3.3) — the in-app inbox, reachable from
 * the 🔔 in every stack header (a root-level modal, so one screen serves every
 * tab and both staff + guardian sessions).
 *
 *   • newest-first (server order), unread-first (client partition)
 *   • Bangla title/body + the kind label chip; unread rows highlighted
 *   • tap = markRead + deep-link to the row's surface (lib/notificationNav);
 *     mark-all-read button on top
 *   • D-#307: each unread row carries a checkbox — pick some, then the
 *     "mark selected read" button on top flips just those (one bulk call)
 *   • the shared badge context is refreshed after every mutation so the 🔔
 *     count snaps without waiting for the next poll
 */
import React, { useState } from "react";
import { View, Text, FlatList, RefreshControl, Pressable } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  MY_NOTIFICATIONS_QUERY,
  MARK_NOTIFICATION_READ,
  MARK_NOTIFICATIONS_READ,
  MARK_ALL_NOTIFICATIONS_READ,
  type NotificationT,
} from "../../graphql/operations";
import { useAuth } from "../../auth/AuthContext";
import { useNotifications } from "../../state/NotificationContext";
import { Screen, Card, Body, Muted, Badge, Button, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { STR, notificationKindLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { useRecordView } from "../../lib/useRecordView";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";

/** Root-stack navigation, structurally typed (the root stack is untyped). */
interface RootNav {
  navigate: (name: string, params?: unknown) => void;
  goBack: () => void;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local short timestamp (ISO date + HH:mm), Bangla digits in Bangla mode. */
function shortTime(iso: string): string {
  const d = new Date(iso);
  return bnNum(
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  );
}

export default function NotificationCenterScreen({ navigation }: { navigation: RootNav }): React.ReactElement {
  useAuth();
  const colors = useColors();
  const { refresh } = useNotifications();
  // GE-2: this screen serves staff and guardians alike; the hook itself no-ops for
  // any non-GUARDIAN session, so staff inbox opens never enter the family figures.
  useRecordView("NOTIFICATIONS");

  const [{ data, fetching, error }, refetch] = useQuery({
    query: MY_NOTIFICATIONS_QUERY,
    variables: { limit: 100 },
    requestPolicy: "cache-and-network",
  });
  const [, markRead] = useMutation(MARK_NOTIFICATION_READ);
  const [markManyState, markManyRead] = useMutation(MARK_NOTIFICATIONS_READ);
  const [markAllState, markAllRead] = useMutation(MARK_ALL_NOTIFICATIONS_READ);

  // D-#307: the picked unread rows (checkbox multi-select).
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = data?.myNotifications ?? [];
  // Server is newest-first; partition unread-first without losing that order.
  const sorted = [...rows.filter((r) => !r.readAt), ...rows.filter((r) => !!r.readAt)];
  const unread = rows.filter((r) => !r.readAt).length;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onMarkSelected = async () => {
    if (selected.size === 0) return;
    await markManyRead({ ids: [...selected] });
    setSelected(new Set());
    refresh();
    refetch({ requestPolicy: "network-only" });
  };

  /**
   * Owner report 2026-08-15: tapping the weekly homework report "does not open the
   * details" — it deep-linked straight to the homework list, so the report's own
   * text (the whole point of a digest: which items are outstanding, what was set
   * today) was never readable on a page of its own. A tap now opens the DETAIL
   * screen, which shows the body whole and offers the deep-link as a button. Kinds
   * with no target used to do nothing at all on tap; they now open too.
   */
  const onRowPress = async (row: NotificationT) => {
    if (!row.readAt) {
      await markRead({ id: row.id });
      if (selected.has(row.id)) toggleSelect(row.id);
      refresh();
      refetch({ requestPolicy: "network-only" });
    }
    navigation.navigate("NotificationDetail", { id: row.id });
  };

  const onMarkAll = async () => {
    await markAllRead({});
    refresh();
    refetch({ requestPolicy: "network-only" });
  };

  // UX-7: pull-to-refresh + FlatList (this inbox is the app's fastest-growing list).
  const { refreshing, onRefresh } = usePullRefresh(fetching, () => {
    refresh();
    refetch({ requestPolicy: "network-only" });
  });

  return (
    <Screen padded={false}>
      <FlatList
        data={sorted}
        keyExtractor={(row) => row.id}
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListHeaderComponent={
          unread > 0 ? (
            <View style={{ marginBottom: space(3), gap: space(2) }}>
              {selected.size > 0 ? (
                <Button
                  title={`${STR.notifMarkSelectedRead} (${bnNum(selected.size)})`}
                  onPress={() => void onMarkSelected()}
                  disabled={markManyState.fetching}
                />
              ) : null}
              <Button
                title={STR.notifMarkAllRead}
                variant="secondary"
                onPress={() => void onMarkAll()}
                disabled={markAllState.fetching}
              />
            </View>
          ) : null
        }
        ListEmptyComponent={
          error ? (
            <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
          ) : fetching && rows.length === 0 ? (
            <Loader label={STR.loading} />
          ) : (
            <EmptyState message={STR.notifEmpty} />
          )
        }
        renderItem={({ item: row }) => {
          const isUnread = !row.readAt;
          const isSelected = selected.has(row.id);
          return (
            <Card
              onPress={() => void onRowPress(row)}
              style={isUnread ? { borderColor: colors.primary, borderWidth: 1 } : undefined}
            >
              {/* Owner report 2026-08-15: the title used to sit beside the kind badge
                  and wrapped ONE CHARACTER PER LINE — a long English kind label
                  ("Leave application awaiting approval") kept its intrinsic width and
                  crushed the flexible title. The badge now shrinks (ui.tsx) AND the
                  title owns its own full-width line, so no label length can squeeze
                  it. `alignItems: flex-start` keeps the checkbox on the first line. */}
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(2) }}>
                {isUnread ? (
                  <Pressable
                    onPress={() => toggleSelect(row.id)}
                    hitSlop={10}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSelected }}
                  >
                    <Text style={{ fontSize: 20, color: colors.primary }}>{isSelected ? "☑" : "☐"}</Text>
                  </Pressable>
                ) : null}
                <View style={{ flex: 1, gap: space(1) }}>
                  <Body style={{ fontWeight: isUnread ? "700" : "400" }}>{row.titleBn}</Body>
                  <Badge text={notificationKindLabel(row.kind)} tone={isUnread ? "brand" : "muted"} maxWidthPct={100} />
                </View>
              </View>
              {/* The list is a PREVIEW — a digest body runs to a dozen lines and used
                  to make one row fill the screen. The detail screen shows it whole. */}
              <Body style={{ marginTop: 4 }} numberOfLines={3}>
                {row.bodyBn}
              </Body>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                <Muted>{shortTime(row.createdAt)}</Muted>
                {isUnread ? <Text style={{ color: colors.primary, fontSize: 12 }}>● {STR.notifUnreadBadge}</Text> : null}
              </View>
            </Card>
          );
        }}
      />
    </Screen>
  );
}
