/**
 * NewChatScreen (M-5) — start a 1:1 with any staff member. The directory is
 * DERIVED from the caller's conversation memberships (the SCHOOL auto-group
 * holds every active staff member), so a teacher needs no manager-only
 * `users`/`staff` query to open a DM. Picking a person calls
 * openDirectConversation (idempotent) and jumps into the thread. Managers also
 * get a shortcut into the group creator.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  MY_CONVERSATIONS_QUERY,
  OPEN_DIRECT_CONVERSATION,
} from "../../graphql/operations";
import type { ChatStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Button, Field, Notice, EmptyState, Loader } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { STR } from "../../lib/labels";
import { staffDirectoryFrom, conversationTitle } from "../../lib/chat";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ChatStackParamList, "NewChat">;

export default function NewChatScreen({ navigation }: Props): React.ReactElement {
  const { user, role, can } = useAuth();
  const myUserId = user?.id ?? "";
  const canManage = can("chat:manage");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [convQ] = useQuery({ query: MY_CONVERSATIONS_QUERY });
  const [, openDirect] = useMutation(OPEN_DIRECT_CONVERSATION);

  const directory = staffDirectoryFrom(convQ.data?.myConversations ?? [], myUserId);
  const q = search.trim().toLowerCase();
  const filtered = q ? directory.filter((d) => d.name.toLowerCase().includes(q)) : directory;

  async function onPick(userId: string): Promise<void> {
    setBusyId(userId);
    setError(null);
    try {
      const res = await openDirect({ otherUserId: userId });
      if (res.error) throw new Error(res.error.message);
      const conv = res.data?.openDirectConversation;
      if (conv) {
        navigation.replace("ChatThread", {
          conversationId: conv.id,
          title: conversationTitle(conv, myUserId),
        });
      }
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).replace(/^\[\w+\]\s*/, "") || STR.chatActionFailed);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Screen>
      {canManage ? (
        <Button
          title={STR.chatNewGroup}
          variant="secondary"
          onPress={() => navigation.navigate("GroupManage", {})}
          style={{ marginBottom: space(2) }}
        />
      ) : null}

      <Field label={STR.chatPickStaff} value={search} onChangeText={setSearch} placeholder={STR.chatPickStaff} />
      {error ? <Notice message={error} tone="danger" /> : null}

      {convQ.fetching && directory.length === 0 ? (
        <Loader label={STR.loading} />
      ) : filtered.length === 0 ? (
        <EmptyState message={STR.chatNoStaff} />
      ) : (
        filtered.map((d) => (
          <Card key={d.userId} onPress={() => void onPick(d.userId)}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>👤 {d.name}</Body>
              {busyId === d.userId ? <Body>…</Body> : <Body>›</Body>}
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}
