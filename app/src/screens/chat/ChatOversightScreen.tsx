/**
 * ChatOversightScreen (M-6 app pass) — the Principal oversight browser
 * (`chat:oversee`). Lists EVERY conversation (DIRECT + groups + archived) from
 * the existing `oversightConversations` query; tapping one opens the read-only
 * oversight thread (where the audited `openConversationOversight` fires). The
 * entry to this screen is itself gated `chat:oversee` in ChatHome. No server
 * change — consumes the M-6 resolvers as-is.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { useFocusEffect } from "@react-navigation/native";
import { OVERSIGHT_CONVERSATIONS_QUERY, type ConversationT } from "../../graphql/operations";
import type { ChatStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Badge, Notice, EmptyState, Loader } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum } from "../../lib/labels";
import { conversationTitle, conversationKindLabel } from "../../lib/chat";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ChatStackParamList, "ChatOversight">;

export default function ChatOversightScreen({ navigation }: Props): React.ReactElement {
  const { user } = useAuth();
  const myUserId = user?.id ?? "";

  const [q, refetch] = useQuery({ query: OVERSIGHT_CONVERSATIONS_QUERY });
  useFocusEffect(
    React.useCallback(() => {
      refetch({ requestPolicy: "cache-and-network" });
    }, [refetch]),
  );

  const conversations: ConversationT[] = q.data?.oversightConversations ?? [];

  return (
    <Screen>
      <Notice message={STR.chatOversightReadOnly} tone="info" />
      {q.fetching && conversations.length === 0 ? (
        <Loader label={STR.loading} />
      ) : conversations.length === 0 ? (
        <EmptyState message={STR.chatNoConversations} />
      ) : (
        conversations.map((c) => {
          const title = conversationTitle(c, myUserId);
          return (
            <Card
              key={c.id}
              onPress={() => navigation.navigate("ChatOversightThread", { conversationId: c.id, title })}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flexShrink: 1 }}>
                  <Body style={{ fontWeight: "700" }}>{title}</Body>
                  <Muted>
                    {conversationKindLabel(c.kind)}
                    {c.kind !== "DIRECT" ? ` · ${bnNum(c.members.length)} ${STR.chatMembersWord}` : ""}
                    {c.active === false ? " · 🗄" : ""}
                  </Muted>
                </View>
                <View style={{ alignItems: "flex-end", gap: space(1) }}>
                  {c.postingPolicy === "ANNOUNCEMENT" ? (
                    <Badge text={STR.chatAnnouncementBadge} tone="info" />
                  ) : null}
                  {c.lastMessageAt ? <Muted>{bnNum(c.lastMessageAt.slice(0, 10))}</Muted> : null}
                </View>
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
