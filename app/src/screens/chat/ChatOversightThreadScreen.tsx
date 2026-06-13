/**
 * ChatOversightThreadScreen (M-6 app pass) — read-only Principal oversight of one
 * conversation (`chat:oversee`). On open it fires `openConversationOversight` —
 * the AUDITED entry (CHAT_OVERSIGHT_OPENED), accountability both ways — and uses
 * its returned conversation for member names, then pages `oversightMessages`
 * (_id-cursor "load older", same as ChatThread). Messages are UN-masked: deleted
 * originals render normally (the server returns the original body), flagged with
 * a small "deleted" badge so it's clear they were removed. No composer, no
 * actions — oversight is strictly read-only. No server change.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useClient, useMutation } from "urql";
import {
  OVERSIGHT_MESSAGES_QUERY,
  OPEN_CONVERSATION_OVERSIGHT,
  type ChatMessageT,
  type ConversationT,
} from "../../graphql/operations";
import type { ChatStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Badge, Notice, Loader, EmptyState } from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ChatStackParamList, "ChatOversightThread">;

const PAGE = 30;

export default function ChatOversightThreadScreen({ route }: Props): React.ReactElement {
  const { conversationId } = route.params;
  const client = useClient();

  const [messages, setMessages] = useState<ChatMessageT[]>([]); // newest-first
  const [conv, setConv] = useState<ConversationT | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [, openOversight] = useMutation(OPEN_CONVERSATION_OVERSIGHT);

  const nameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const mem of conv?.members ?? []) m.set(mem.userId, mem.name);
    return m;
  }, [conv]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      // The AUDITED open (CHAT_OVERSIGHT_OPENED) — fire it on entry, then read.
      const openRes = await openOversight({ conversationId });
      if (openRes.error) {
        if (!cancelled) {
          setError(openRes.error.message.replace(/^\[\w+\]\s*/, ""));
          setLoading(false);
        }
        return;
      }
      const msgRes = await client
        .query(OVERSIGHT_MESSAGES_QUERY, { conversationId, limit: PAGE })
        .toPromise();
      if (cancelled) return;
      if (msgRes.error) setError(msgRes.error.message.replace(/^\[\w+\]\s*/, ""));
      setConv(openRes.data?.openConversationOversight ?? null);
      setMessages(msgRes.data?.oversightMessages ?? []);
      setExhausted((msgRes.data?.oversightMessages?.length ?? 0) < PAGE);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || exhausted || messages.length === 0) return;
    setLoadingOlder(true);
    const beforeId = messages[messages.length - 1].id;
    const res = await client
      .query(OVERSIGHT_MESSAGES_QUERY, { conversationId, beforeId, limit: PAGE })
      .toPromise();
    const older = res.data?.oversightMessages ?? [];
    setMessages((prev) => [...prev, ...older]);
    if (older.length < PAGE) setExhausted(true);
    setLoadingOlder(false);
  }, [client, conversationId, messages, exhausted, loadingOlder]);

  if (loading && messages.length === 0) {
    return (
      <Screen>
        <Loader label={STR.chatOversightOpening} />
      </Screen>
    );
  }

  const ordered = [...messages].reverse(); // oldest → newest

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Notice message={STR.chatOversightReadOnly} tone="info" />
        {!exhausted && messages.length > 0 ? (
          <Button title={STR.chatLoadOlder} variant="ghost" loading={loadingOlder} onPress={() => void loadOlder()} />
        ) : null}

        {ordered.length === 0 ? (
          <EmptyState message={STR.chatNoMessages} />
        ) : (
          ordered.map((m) => (
            <OversightBubble key={m.id} message={m} senderName={nameById.get(m.senderId) ?? STR.chatKindCustom} />
          ))
        )}
      </ScrollView>

      {error ? <Notice message={error} tone="danger" /> : null}
    </Screen>
  );
}

/** A read-only message bubble for oversight. Deleted originals are shown normally
 *  (the server un-masks them for chat:oversee) with a "deleted" badge. */
function OversightBubble({
  message: m,
  senderName,
}: {
  message: ChatMessageT;
  senderName: string;
}): React.ReactElement {
  return (
    <Card style={{ alignSelf: "flex-start", maxWidth: "92%", minWidth: "55%" }}>
      <Muted style={{ fontWeight: "700" }}>{senderName}</Muted>
      {m.forwardOfId ? <Badge text={STR.chatForwarded} tone="muted" /> : null}
      {m.deletedAt ? <Badge text={STR.chatDelete} tone="danger" /> : null}

      <Body>{m.body}</Body>

      {m.attachments.length > 0 ? (
        <View style={{ gap: space(1), marginTop: space(1) }}>
          {m.attachments.map((a) => (
            <Muted key={a.fileId}>📎 {a.originalName}</Muted>
          ))}
        </View>
      ) : null}

      <Muted style={{ marginTop: space(1) }}>
        {bnNum(m.createdAt.slice(0, 10))} {bnNum(m.createdAt.slice(11, 16))}
        {m.editedAt ? ` · ${STR.chatEdited}` : ""}
      </Muted>
    </Card>
  );
}
