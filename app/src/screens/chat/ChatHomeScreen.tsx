/**
 * ChatHomeScreen (M-5) — the Chat tab landing: every conversation the caller
 * belongs to (DIRECT + auto SECTION/SUBJECT/SCHOOL + manual CUSTOM groups),
 * most-recent first (server orders by lastMessageAt). A "+" starts a new DM;
 * managers (chat:manage) also get a "new group" entry. Consumes myConversations
 * as-is — no server change.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { useFocusEffect } from "@react-navigation/native";
import { roleHasPermission } from "@scd/shared";
import { MY_CONVERSATIONS_QUERY, type ConversationT } from "../../graphql/operations";
import type { ChatStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Badge, EmptyState, Loader } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum } from "../../lib/labels";
import { conversationTitle, conversationKindLabel } from "../../lib/chat";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ChatStackParamList, "ChatHome">;

function ConversationRow({
  conv,
  myUserId,
  onPress,
}: {
  conv: ConversationT;
  myUserId: string;
  onPress: () => void;
}): React.ReactElement {
  const title = conversationTitle(conv, myUserId);
  const muted = conv.members.find((m) => m.userId === myUserId)?.muted ?? false;
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flexShrink: 1 }}>
          <Body style={{ fontWeight: "700" }}>
            {muted ? "🔕 " : ""}
            {title}
          </Body>
          <Muted>
            {conversationKindLabel(conv.kind)}
            {conv.kind !== "DIRECT" ? ` · ${bnNum(conv.members.length)} ${STR.chatMembersWord}` : ""}
          </Muted>
        </View>
        <View style={{ alignItems: "flex-end", gap: space(1) }}>
          {conv.postingPolicy === "ANNOUNCEMENT" ? (
            <Badge text={STR.chatAnnouncementBadge} tone="info" />
          ) : null}
          {muted ? <Badge text={STR.chatMutedBadge} tone="muted" /> : null}
          {conv.lastMessageAt ? <Muted>{bnNum(conv.lastMessageAt.slice(0, 10))}</Muted> : null}
        </View>
      </View>
    </Card>
  );
}

export default function ChatHomeScreen({ navigation }: Props): React.ReactElement {
  const { user, role } = useAuth();
  const myUserId = user?.id ?? "";
  const canManage = !!role && roleHasPermission(role, "chat:manage");
  const canOversee = !!role && roleHasPermission(role, "chat:oversee"); // PRINCIPAL
  const canWrite = !!role && roleHasPermission(role, "chat:write"); // staff (notice composer)

  const [convQ, refetch] = useQuery({ query: MY_CONVERSATIONS_QUERY });
  // Refresh the list (unread/last-activity) whenever the tab regains focus.
  useFocusEffect(
    React.useCallback(() => {
      refetch({ requestPolicy: "cache-and-network" });
    }, [refetch]),
  );

  const conversations = convQ.data?.myConversations ?? [];

  return (
    <Screen>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginBottom: space(2) }}>
        <Button title={STR.chatNewChat} onPress={() => navigation.navigate("NewChat")} style={{ flexGrow: 1 }} />
        {canManage ? (
          <Button
            title={STR.chatNewGroup}
            variant="secondary"
            onPress={() => navigation.navigate("GroupManage", {})}
            style={{ flexGrow: 1 }}
          />
        ) : null}
      </View>

      {/* M-6 entries — composer for any staff (server enforces the D-#45 per-scope
          rule); oversight browser for the Principal only (chat:oversee). */}
      {(canWrite || canOversee) ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginBottom: space(2) }}>
          {canWrite ? (
            <Button
              title={`📣 ${STR.chatNoticeEntry}`}
              variant="ghost"
              onPress={() => navigation.navigate("GuardianNotice")}
              style={{ flexGrow: 1 }}
            />
          ) : null}
          {canOversee ? (
            <Button
              title={`👁 ${STR.chatOversightEntry}`}
              variant="ghost"
              onPress={() => navigation.navigate("ChatOversight")}
              style={{ flexGrow: 1 }}
            />
          ) : null}
        </View>
      ) : null}

      {convQ.fetching && conversations.length === 0 ? (
        <Loader label={STR.loading} />
      ) : conversations.length === 0 ? (
        <EmptyState message={STR.chatNoConversations} />
      ) : (
        conversations.map((c) => (
          <ConversationRow
            key={c.id}
            conv={c}
            myUserId={myUserId}
            onPress={() =>
              navigation.navigate("ChatThread", { conversationId: c.id, title: conversationTitle(c, myUserId) })
            }
          />
        ))
      )}
    </Screen>
  );
}
