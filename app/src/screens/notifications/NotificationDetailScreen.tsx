/**
 * NotificationDetailScreen — one notification, read in full.
 *
 * Owner report 2026-08-15: tapping the weekly homework report "does not open the
 * details". It never did: the inbox tap deep-linked straight to the child's
 * homework list, so a digest's own text — which items are still outstanding, what
 * was set today, when each is due — had nowhere to be read. Kinds with no deep-link
 * target did nothing at all on tap.
 *
 * So the tap now lands here: the whole body, untruncated and selectable, with the
 * kind, the timestamp, and the deep-link demoted to a button. The inbox row keeps a
 * 3-line preview, which also stops one digest from filling the whole list.
 *
 * The D-#467 hat dance moved here with the deep-link: a row can point at a tab the
 * current view mode hides, so drop the mode first and navigate once the drawer has
 * re-rendered with the full tab set.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { MY_NOTIFICATION_QUERY, MARK_NOTIFICATION_READ, type NotificationT } from "../../graphql/operations";
import { useAuth } from "../../auth/AuthContext";
import { useNotifications } from "../../state/NotificationContext";
import { notificationTarget, type NotificationTarget } from "../../lib/notificationNav";
import { Screen, Card, Body, Muted, Badge, Button, Loader, EmptyState } from "../../components/ui";
import { STR, notificationKindLabel, bnNum } from "../../lib/labels";
import { space } from "../../theme/tokens";

interface RootNav {
  navigate: (name: string, params?: unknown) => void;
  goBack: () => void;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

function longTime(iso: string): string {
  const d = new Date(iso);
  return bnNum(
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  );
}

export default function NotificationDetailScreen({
  navigation,
  route,
}: {
  navigation: RootNav;
  route: { params?: { id?: string } };
}): React.ReactElement {
  const { role } = useAuth();
  const id = route.params?.id;

  // D-#761: read the ONE row by id. It used to be looked up inside the inbox's newest
  // 100, so a deep link to anything older opened an empty screen.
  const [{ data, fetching }] = useQuery({
    query: MY_NOTIFICATION_QUERY,
    variables: { id: id ?? "" },
    pause: !id,
    requestPolicy: "cache-first",
  });
  const row: NotificationT | undefined = data?.myNotification ?? undefined;

  // D-#773: a push tap lands here without passing the inbox, which is where a row used
  // to be marked read — so opening it marks it (an inbox tap already has: no-op).
  const { refresh } = useNotifications();
  const [, markRead] = useMutation(MARK_NOTIFICATION_READ);
  const markedId = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!row || row.readAt || markedId.current === row.id) return;
    markedId.current = row.id;
    void markRead({ id: row.id }).then(() => refresh());
  }, [row, markRead, refresh]);

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

  if (fetching && !row) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }
  if (!row) {
    return (
      <Screen>
        <EmptyState message={STR.notifEmpty} />
      </Screen>
    );
  }

  const target = notificationTarget(row.kind, row.refs, role);

  const onOpenTarget = (): void => {
    if (!target) return;
    go(target);
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          {/* Badge on its own line: a kind label can be a full English sentence, and
              beside a title it crushed the title to one character per line. */}
          <Badge text={notificationKindLabel(row.kind)} tone="brand" maxWidthPct={100} />
          <Body style={{ fontWeight: "700", marginTop: space(2) }}>{row.titleBn}</Body>
          <Muted style={{ marginTop: space(1) }}>{longTime(row.createdAt)}</Muted>
        </Card>

        {/* The point of this screen: the body, whole — no numberOfLines cap. */}
        <Card>
          <Body>{row.bodyBn}</Body>
        </Card>

        {target ? (
          <Button title={STR.notifOpenRelated} onPress={onOpenTarget} style={{ marginTop: space(2) }} />
        ) : null}
        <Button
          title={STR.close}
          variant="ghost"
          onPress={() => navigation.goBack()}
          style={{ marginTop: space(2) }}
        />
      </ScrollView>
    </Screen>
  );
}
