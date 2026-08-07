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
import { notificationTarget, type NotificationTarget } from "../../lib/notificationNav";
import { navigationRef } from "../../navigation/navigationRef";
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

/** Is this drawer tab currently mounted? A D-#467 view mode hides the tabs of the hat
 *  the user is not wearing, and an inbox row may point at one of them. Reads the live
 *  navigator rather than re-deriving AppTabs' gate list, so the two can never drift.
 *  Unknown (ref not ready, drawer not mounted yet) answers TRUE — navigate and let the
 *  navigator decide, which is exactly the pre-D-#467 behaviour. */
function drawerHasTab(tab: string): boolean {
  if (!navigationRef.isReady()) return true;
  const root = navigationRef.getRootState() as
    | { routes?: Array<{ name?: string; state?: { routeNames?: string[] } }> }
    | undefined;
  const names = root?.routes?.find((r) => r.name === "App")?.state?.routeNames;
  return !names || names.includes(tab);
}

export default function NotificationCenterScreen({ navigation }: { navigation: RootNav }): React.ReactElement {
  const { role, viewMode, setViewMode } = useAuth();
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
  // A deep-link held back until the view mode has been dropped (see onRowPress).
  const [pendingTarget, setPendingTarget] = useState<NotificationTarget | null>(null);

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

  /** `initial: false` keeps the tab's home screen beneath the deep-linked screen —
   *  without it the target becomes the stack's FIRST screen and loses its back button
   *  (owner report: Reconciliation report). */
  const go = React.useCallback(
    (target: NotificationTarget) => {
      navigation.navigate("App", {
        screen: target.tab,
        params: target.params
          ? { screen: target.screen, params: target.params, initial: false }
          : { screen: target.screen, initial: false },
      });
    },
    [navigation],
  );

  // Runs after the hat switch has re-rendered the drawer, so the target tab exists.
  React.useEffect(() => {
    if (pendingTarget && !viewMode) {
      go(pendingTarget);
      setPendingTarget(null);
    }
  }, [pendingTarget, viewMode, go]);

  const onRowPress = async (row: NotificationT) => {
    if (!row.readAt) {
      await markRead({ id: row.id });
      if (selected.has(row.id)) toggleSelect(row.id);
      refresh();
      refetch({ requestPolicy: "network-only" });
    }
    const target = notificationTarget(row.kind, row.refs, role);
    if (target) {
      // D-#467: the row points at a tab this hat does not show (an office item read
      // while wearing the teacher hat). Un-narrow first and navigate once the drawer
      // has re-rendered with the full tab set — `pendingTarget` above. Only when the
      // tab is genuinely missing, so a same-hat tap never disturbs the chosen view.
      if (viewMode && !drawerHasTab(target.tab)) {
        setPendingTarget(target);
        setViewMode(null);
        return;
      }
      go(target);
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
