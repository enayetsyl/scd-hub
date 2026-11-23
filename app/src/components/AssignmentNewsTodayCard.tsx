/**
 * AssignmentNewsTodayCard (AL-8, journey C2 / C3) — Today's card for the weekly-assignment notices still unread:
 * "খসড়া তৈরি" (AS_DRAFT_READY), the swap card (AS_SWAP_SUGGESTED) and an Office / Principal comment (AS_COMMENT).
 * A row opens the screen the notice is about (the same deep-link as the notification) and marks the notice read.
 *
 * Self-contained (own query); renders nothing while loading, when empty and on error. Shown only to a holder of
 * `assignment:suggest`; the notices themselves only exist with the 2027 release switch on.
 */
import React from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery } from "urql";
import { MARK_NOTIFICATION_READ, MY_NOTIFICATIONS_QUERY, type NotificationT } from "../graphql/operations";
import { MASTERY_LOOP_POLICY_QUERY } from "../graphql/mastery";
import { Badge, Body, Button, Muted } from "./ui";
import { FoldCard } from "./FoldCard";
import { STR, bnNum } from "../lib/labels";
import { notificationTarget } from "../lib/notificationNav";
import { useAuth } from "../auth/AuthContext";
import { space } from "../theme";

const KINDS = ["AS_DRAFT_READY", "AS_SWAP_SUGGESTED", "AS_COMMENT"];
type CrossNav = { navigate: (name: string, params?: object) => void };

export function AssignmentNewsTodayCard(): React.ReactElement | null {
  const { role } = useAuth();
  const nav = useNavigation() as unknown as CrossNav;
  // The notices exist only with the 2027 switch on (§3.6): off → no query at all. The kind filter runs on the server, so an
  // old unread notice is never cut off by 50 newer unrelated ones.
  const [loopQ] = useQuery({ query: MASTERY_LOOP_POLICY_QUERY });
  const loopOn = loopQ.data?.masteryPolicy?.resolved?.academicLoop2027On === true;
  const [q, refetch] = useQuery({ query: MY_NOTIFICATIONS_QUERY, variables: { unreadOnly: true, limit: 5, kinds: KINDS }, pause: !loopOn, requestPolicy: "cache-and-network" });
  const [, markRead] = useMutation(MARK_NOTIFICATION_READ);
  const rows = loopOn ? ((q.data?.myNotifications ?? []) as NotificationT[]) : [];
  if (q.error || rows.length === 0) return null;

  const open = async (n: NotificationT): Promise<void> => {
    const target = notificationTarget(n.kind, n.refs, role);
    void markRead({ id: n.id }).then(() => refetch({ requestPolicy: "network-only" }));
    if (target) nav.navigate(target.tab, target.params ? { screen: target.screen, params: target.params, initial: false } : { screen: target.screen, initial: false });
  };

  return (
    <FoldCard id="today:assignmentNews" title={`📝 ${STR.al8TodayTitle}`} aside={<Badge text={bnNum(rows.length)} tone="info" />}>
      {rows.map((n) => (
        <View key={n.id} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), marginTop: space(3) }}>
          <View style={{ flexBasis: 200, flexGrow: 1, flexShrink: 1 }}>
            <Body style={{ fontWeight: "700" }}>{n.titleBn}</Body>
            <Muted>{n.bodyBn}</Muted>
          </View>
          <Button title={STR.al8TodayOpen} variant="secondary" onPress={() => void open(n)} />
        </View>
      ))}
    </FoldCard>
  );
}
