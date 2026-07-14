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
import { notificationTarget } from "../../lib/notificationNav";
import { Screen, Card, Body, Muted, Badge, Button, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { STR, notificationKindLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
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
  const { role } = useAuth();
  const colors = useColors();
  const { refresh } = useNotifications();

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

  const onRowPress = async (row: NotificationT) => {
    if (!row.readAt) {
      await markRead({ id: row.id });
      if (selected.has(row.id)) toggleSelect(row.id);
      refresh();
      refetch({ requestPolicy: "network-only" });
    }
    const target = notificationTarget(row.kind, row.refs, role);
    if (target) {
      navigation.navigate("App", {
        screen: target.tab,
        params: target.params ? { screen: target.screen, params: target.params } : { screen: target.screen },
      });
    }
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
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                {isUnread ? (
                  <Pressable
                    onPress={() => toggleSelect(row.id)}
                    hitSlop={10}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSelected }}
                    style={{ marginRight: space(2) }}
                  >
                    <Text style={{ fontSize: 20, color: colors.primary }}>{isSelected ? "☑" : "☐"}</Text>
                  </Pressable>
                ) : null}
                <Body style={{ flex: 1, fontWeight: isUnread ? "700" : "400" }}>{row.titleBn}</Body>
                <Badge text={notificationKindLabel(row.kind)} tone={isUnread ? "brand" : "muted"} />
              </View>
              <Body style={{ marginTop: 4 }}>{row.bodyBn}</Body>
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
