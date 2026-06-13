/**
 * NotificationCenterScreen (N-3, N3.2/N3.3) — the in-app inbox, reachable from
 * the 🔔 in every stack header (a root-level modal, so one screen serves every
 * tab and both staff + guardian sessions).
 *
 *   • newest-first (server order), unread-first (client partition)
 *   • Bangla title/body + the kind label chip; unread rows highlighted
 *   • tap = markRead + deep-link to the row's surface (lib/notificationNav);
 *     mark-all-read button on top
 *   • the shared badge context is refreshed after every mutation so the 🔔
 *     count snaps without waiting for the next poll
 */
import React from "react";
import { View, Text } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  MY_NOTIFICATIONS_QUERY,
  MARK_NOTIFICATION_READ,
  MARK_ALL_NOTIFICATIONS_READ,
  type NotificationT,
} from "../../graphql/operations";
import { useAuth } from "../../auth/AuthContext";
import { useNotifications } from "../../state/NotificationContext";
import { notificationTarget } from "../../lib/notificationNav";
import { Screen, Card, Body, Muted, Badge, Button, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { STR, notificationKindLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";

/** Root-stack navigation, structurally typed (the root stack is untyped). */
interface RootNav {
  navigate: (name: string, params?: unknown) => void;
  goBack: () => void;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local short timestamp (YYYY-MM-DD HH:mm), Bangla digits in Bangla mode. */
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
  const [markAllState, markAllRead] = useMutation(MARK_ALL_NOTIFICATIONS_READ);

  const rows = data?.myNotifications ?? [];
  // Server is newest-first; partition unread-first without losing that order.
  const sorted = [...rows.filter((r) => !r.readAt), ...rows.filter((r) => !!r.readAt)];
  const unread = rows.filter((r) => !r.readAt).length;

  const onRowPress = async (row: NotificationT) => {
    if (!row.readAt) {
      await markRead({ id: row.id });
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

  return (
    <Screen scroll>
      {unread > 0 ? (
        <View style={{ marginBottom: space(3) }}>
          <Button
            title={STR.notifMarkAllRead}
            variant="secondary"
            onPress={() => void onMarkAll()}
            disabled={markAllState.fetching}
          />
        </View>
      ) : null}

      {error ? (
        <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : fetching && rows.length === 0 ? (
        <Loader label={STR.loading} />
      ) : sorted.length === 0 ? (
        <EmptyState message={STR.notifEmpty} />
      ) : (
        sorted.map((row) => {
          const isUnread = !row.readAt;
          return (
            <Card
              key={row.id}
              onPress={() => void onRowPress(row)}
              style={isUnread ? { borderColor: colors.primary, borderWidth: 1 } : undefined}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
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
        })
      )}
    </Screen>
  );
}
