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
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "urql";
import { MY_NOTIFICATIONS_QUERY, type NotificationT } from "../../graphql/operations";
import { useAuth } from "../../auth/AuthContext";
import { notificationTarget, type NotificationTarget } from "../../lib/notificationNav";
import { navigationRef } from "../../navigation/navigationRef";
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

/** Is this drawer tab currently mounted? A D-#467 view mode hides the tabs of the hat
 *  the user is not wearing. Reads the live navigator rather than re-deriving AppTabs'
 *  gate list, so the two can never drift. Unknown answers TRUE — navigate and let the
 *  navigator decide, which is exactly the pre-D-#467 behaviour. */
function drawerHasTab(tab: string): boolean {
  if (!navigationRef.isReady()) return true;
  const root = navigationRef.getRootState() as
    | { routes?: Array<{ name?: string; state?: { routeNames?: string[] } }> }
    | undefined;
  const names = root?.routes?.find((r) => r.name === "App")?.state?.routeNames;
  return !names || names.includes(tab);
}

export default function NotificationDetailScreen({
  navigation,
  route,
}: {
  navigation: RootNav;
  route: { params?: { id?: string } };
}): React.ReactElement {
  const { role, viewMode, setViewMode } = useAuth();
  const id = route.params?.id;
  const [pendingTarget, setPendingTarget] = useState<NotificationTarget | null>(null);

  // The inbox query is already warm in the cache, so this resolves without a
  // round-trip in the normal flow (and refetches by itself if opened cold).
  const [{ data, fetching }] = useQuery({
    query: MY_NOTIFICATIONS_QUERY,
    variables: { limit: 100 },
    requestPolicy: "cache-first",
  });
  const row: NotificationT | undefined = (data?.myNotifications ?? []).find((n) => n.id === id);

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
    if (viewMode && !drawerHasTab(target.tab)) {
      setPendingTarget(target);
      setViewMode(null);
      return;
    }
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
