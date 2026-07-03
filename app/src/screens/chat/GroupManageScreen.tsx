/**
 * GroupManageScreen (M-5, chat:manage = Principal/Office) — create a CUSTOM
 * group OR manage an existing non-DIRECT group: rename is server-owned, but the
 * manager can add/remove manual members, flip the posting policy
 * (OPEN ⇄ ANNOUNCEMENT), and archive a CUSTOM group. The member directory is
 * derived from conversation memberships (SCHOOL group). Consumes the existing
 * createGroupConversation / addConversationMember / removeConversationMember /
 * setPostingPolicy / archiveConversation mutations — no server change.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  MY_CONVERSATIONS_QUERY,
  CONVERSATION_QUERY,
  CREATE_GROUP_CONVERSATION,
  ADD_CONVERSATION_MEMBER,
  REMOVE_CONVERSATION_MEMBER,
  SET_POSTING_POLICY,
  ARCHIVE_CONVERSATION,
} from "../../graphql/operations";
import type { ChatStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Chip, ChipRow, Field, Notice, Badge, Loader, Divider } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum } from "../../lib/labels";
import { staffDirectoryFrom } from "../../lib/chat";
import { useConfirm } from "../../state/ConfirmContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ChatStackParamList, "GroupManage">;

export default function GroupManageScreen({ route, navigation }: Props): React.ReactElement {
  const conversationId = route.params?.conversationId;
  const isCreate = !conversationId;
  const { user } = useAuth();
  const { confirmAction } = useConfirm();
  const myUserId = user?.id ?? "";

  const [convListQ] = useQuery({ query: MY_CONVERSATIONS_QUERY });
  const [convQ, refetchConv] = useQuery({
    query: CONVERSATION_QUERY,
    variables: { id: conversationId ?? "" },
    pause: isCreate,
  });

  const [, createGroup] = useMutation(CREATE_GROUP_CONVERSATION);
  const [, addMember] = useMutation(ADD_CONVERSATION_MEMBER);
  const [, removeMember] = useMutation(REMOVE_CONVERSATION_MEMBER);
  const [, setPolicy] = useMutation(SET_POSTING_POLICY);
  const [, archive] = useMutation(ARCHIVE_CONVERSATION);

  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const directory = staffDirectoryFrom(convListQ.data?.myConversations ?? [], myUserId);
  const conv = convQ.data?.conversation ?? null;
  const memberIds = new Set((conv?.members ?? []).map((m) => m.userId));

  function toggle(userId: string): void {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function onCreate(): Promise<void> {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createGroup({
        title: title.trim(),
        memberIds: [...picked],
        postingPolicy: announcement ? "ANNOUNCEMENT" : "OPEN",
      });
      if (res.error) throw new Error(res.error.message);
      const created = res.data?.createGroupConversation;
      if (created) navigation.replace("ChatThread", { conversationId: created.id, title: created.title ?? STR.chatKindCustom });
    } catch (e) {
      setError(clean(e));
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(userId: string): Promise<void> {
    setError(null);
    const res = await addMember({ conversationId: conversationId!, userId });
    if (res.error) setError(clean(res.error));
    else refetchConv({ requestPolicy: "network-only" });
  }
  async function onRemove(userId: string): Promise<void> {
    setError(null);
    const res = await removeMember({ conversationId: conversationId!, userId });
    if (res.error) setError(clean(res.error));
    else refetchConv({ requestPolicy: "network-only" });
  }
  async function onSetPolicy(next: "OPEN" | "ANNOUNCEMENT"): Promise<void> {
    setError(null);
    const res = await setPolicy({ conversationId: conversationId!, policy: next });
    if (res.error) setError(clean(res.error));
    else refetchConv({ requestPolicy: "network-only" });
  }
  async function onArchive(): Promise<void> {
    if (!(await confirmAction({ confirmLabel: STR.chatArchive }))) return;
    setError(null);
    const res = await archive({ conversationId: conversationId! });
    if (res.error) setError(clean(res.error));
    else navigation.navigate("ChatHome");
  }

  // --- Create mode ----------------------------------------------------------
  if (isCreate) {
    return (
      <Screen>
        <Field label={STR.chatGroupTitleLabel} value={title} onChangeText={setTitle} placeholder={STR.chatGroupTitlePlaceholder} autoCapitalize="sentences" />

        <Muted style={{ marginTop: space(2) }}>{STR.chatPostingPolicy}</Muted>
        <ChipRow>
          <Chip label={STR.chatPolicyOpen} selected={!announcement} onPress={() => setAnnouncement(false)} />
          <Chip label={STR.chatPolicyAnnouncement} selected={announcement} onPress={() => setAnnouncement(true)} />
        </ChipRow>

        <Muted style={{ marginTop: space(2) }}>{STR.chatAddMembers}</Muted>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
          {directory.map((d) => (
            <Chip key={d.userId} label={d.name} selected={picked.has(d.userId)} onPress={() => toggle(d.userId)} />
          ))}
        </View>

        {error ? <Notice message={error} tone="danger" /> : null}
        <Button title={STR.chatCreate} onPress={() => void onCreate()} loading={busy} disabled={!title.trim()} style={{ marginTop: space(3) }} />
      </Screen>
    );
  }

  // --- Manage mode ----------------------------------------------------------
  if (convQ.fetching && !conv) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }
  if (!conv) {
    return (
      <Screen>
        <Notice message={STR.chatActionFailed} tone="danger" />
      </Screen>
    );
  }

  const notInGroup = directory.filter((d) => !memberIds.has(d.userId));

  return (
    <Screen>
      <Card>
        <Body style={{ fontWeight: "700" }}>{conv.title ?? STR.chatKindCustom}</Body>
        <View style={{ flexDirection: "row", gap: space(2), marginTop: space(1) }}>
          <Badge text={conv.postingPolicy === "ANNOUNCEMENT" ? STR.chatPolicyAnnouncement : STR.chatPolicyOpen} tone="info" />
          <Muted>{bnNum(conv.members.length)} {STR.chatMembersWord}</Muted>
        </View>
      </Card>

      {error ? <Notice message={error} tone="danger" /> : null}

      <Muted style={{ marginTop: space(2) }}>{STR.chatPostingPolicy}</Muted>
      <ChipRow>
        <Chip label={STR.chatPolicyOpen} selected={conv.postingPolicy === "OPEN"} onPress={() => void onSetPolicy("OPEN")} />
        <Chip label={STR.chatPolicyAnnouncement} selected={conv.postingPolicy === "ANNOUNCEMENT"} onPress={() => void onSetPolicy("ANNOUNCEMENT")} />
      </ChipRow>

      <Divider />
      <Muted>{STR.chatMembersWord}</Muted>
      {conv.members.map((m) => (
        <View key={m.userId} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: space(1) }}>
          <Body>👤 {m.name}</Body>
          {/* Only manual members are removable — auto members are owned by the
              provisioning sync (D-#100); the server no-ops a remove on them. */}
          {m.source === "manual" ? (
            <Button title={STR.chatRemove} variant="ghost" onPress={() => void onRemove(m.userId)} />
          ) : null}
        </View>
      ))}

      {notInGroup.length > 0 ? (
        <>
          <Divider />
          <Muted>{STR.chatAddMembers}</Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
            {notInGroup.map((d) => (
              <Chip key={d.userId} label={`${d.name} +`} onPress={() => void onAdd(d.userId)} />
            ))}
          </View>
        </>
      ) : null}

      {conv.kind === "CUSTOM" ? (
        <Button title={STR.chatArchive} variant="danger" onPress={() => void onArchive()} style={{ marginTop: space(3) }} />
      ) : null}
    </Screen>
  );
}

function clean(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^\[\w+\]\s*/, "") || STR.chatActionFailed;
}
