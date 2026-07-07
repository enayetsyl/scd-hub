/**
 * ChatThreadScreen (M-5) — one conversation: paginated messages (newest-first,
 * _id-cursor "load older"), compose + send (with attachments), and per-message
 * reply / forward / react / edit / delete (own-only). Deleted messages render the
 * Bangla removed-placeholder. ANNOUNCEMENT groups hide the composer for
 * non-managers (reactions still allowed). markSeen fires on focus. All via the
 * existing M-1..M-4 server APIs — no server change.
 */
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useClient, useMutation } from "urql";
import { useFocusEffect } from "@react-navigation/native";
import { roleHasPermission } from "@scd/shared";
import {
  MESSAGES_QUERY,
  CONVERSATION_QUERY,
  MY_CONVERSATIONS_QUERY,
  SEND_MESSAGE,
  MARK_SEEN,
  EDIT_MESSAGE,
  DELETE_MESSAGE,
  TOGGLE_REACTION,
  FORWARD_MESSAGE,
  SET_CONVERSATION_MUTED,
  type ChatMessageT,
  type ConversationT,
} from "../../graphql/operations";
import type { ChatStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Badge, Chip, Field, Notice, Loader, EmptyState } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum } from "../../lib/labels";
import { aggregateReactions, conversationTitle, REACTION_PALETTE } from "../../lib/chat";
import { pickAndUploadChatFile, openStoredFile, FILE_VIEW_SUPPORTED, FileUploadError, type UploadedChatFile } from "../../lib/files";
import { useFileOpen } from "../../lib/useFileOpen";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ChatStackParamList, "ChatThread">;

const PAGE = 30;

/** The inline action currently expanded under a message (react palette / forward picker). */
type ActiveAction = { id: string; type: "react" | "forward" } | null;

export default function ChatThreadScreen({ route, navigation }: Props): React.ReactElement {
  const { conversationId } = route.params;
  const client = useClient();
  const { user, role } = useAuth();
  const myUserId = user?.id ?? "";
  const canManage = !!role && roleHasPermission(role, "chat:manage");

  const [messages, setMessages] = useState<ChatMessageT[]>([]); // newest-first
  const [conv, setConv] = useState<ConversationT | null>(null);
  const [otherConvs, setOtherConvs] = useState<ConversationT[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessageT | null>(null);
  const [editing, setEditing] = useState<ChatMessageT | null>(null);
  const [pending, setPending] = useState<UploadedChatFile[]>([]); // uploaded, not yet sent
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [busy, setBusy] = useState(false);

  const [, sendMessage] = useMutation(SEND_MESSAGE);
  const [, markSeen] = useMutation(MARK_SEEN);
  const [, editMessage] = useMutation(EDIT_MESSAGE);
  const [, deleteMessage] = useMutation(DELETE_MESSAGE);
  const [, toggleReaction] = useMutation(TOGGLE_REACTION);
  const [, forwardMessage] = useMutation(FORWARD_MESSAGE);
  const [, setConversationMuted] = useMutation(SET_CONVERSATION_MUTED);

  // M-7: the caller's own mute state for this conversation (own member row).
  const myMuted = conv?.members.find((m) => m.userId === myUserId)?.muted ?? false;

  const nameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const mem of conv?.members ?? []) m.set(mem.userId, mem.name);
    return m;
  }, [conv]);

  /** Load the newest page + the conversation (members/policy) + sibling convs. */
  const loadLatest = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [msgRes, convRes, listRes] = await Promise.all([
      client.query(MESSAGES_QUERY, { conversationId, limit: PAGE }).toPromise(),
      client.query(CONVERSATION_QUERY, { id: conversationId }).toPromise(),
      client.query(MY_CONVERSATIONS_QUERY, {}).toPromise(),
    ]);
    if (msgRes.error) setError(msgRes.error.message.replace(/^\[\w+\]\s*/, ""));
    setMessages(msgRes.data?.messages ?? []);
    setExhausted((msgRes.data?.messages?.length ?? 0) < PAGE);
    setConv(convRes.data?.conversation ?? null);
    setOtherConvs((listRes.data?.myConversations ?? []).filter((c) => c.id !== conversationId));
    setLoading(false);
    // Mark everything seen as soon as we open the thread.
    void markSeen({ conversationId });
  }, [client, conversationId, markSeen]);

  useFocusEffect(
    useCallback(() => {
      void loadLatest();
    }, [loadLatest]),
  );

  async function loadOlder(): Promise<void> {
    if (loadingOlder || exhausted || messages.length === 0) return;
    setLoadingOlder(true);
    const beforeId = messages[messages.length - 1].id;
    const res = await client.query(MESSAGES_QUERY, { conversationId, beforeId, limit: PAGE }).toPromise();
    const older = res.data?.messages ?? [];
    setMessages((prev) => [...prev, ...older]);
    if (older.length < PAGE) setExhausted(true);
    setLoadingOlder(false);
  }

  /** Replace a message in place after edit/delete/react. */
  function upsert(updated: ChatMessageT): void {
    setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  }

  async function onSend(): Promise<void> {
    const text = body.trim();
    if (!text && pending.length === 0 && !editing) return;
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        const res = await editMessage({ messageId: editing.id, body: text });
        if (res.error) throw new Error(res.error.message);
        if (res.data?.editMessage) upsert(res.data.editMessage);
        setEditing(null);
      } else {
        const res = await sendMessage({
          conversationId,
          body: text || null,
          replyToId: replyTo?.id ?? null,
          attachmentIds: pending.length ? pending.map((p) => p.fileId) : null,
        });
        if (res.error) throw new Error(res.error.message);
        if (res.data?.sendMessage) setMessages((prev) => [res.data!.sendMessage, ...prev]);
        setReplyTo(null);
        setPending([]);
      }
      setBody("");
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  async function onAttach(): Promise<void> {
    if (!FILE_VIEW_SUPPORTED) {
      setError(STR.chatAttachWebOnly);
      return;
    }
    setError(null);
    try {
      const file = await pickAndUploadChatFile(conversationId);
      if (file) setPending((prev) => [...prev, file]);
    } catch (e) {
      setError(e instanceof FileUploadError ? e.message : STR.chatActionFailed);
    }
  }

  async function onReact(messageId: string, emoji: string): Promise<void> {
    setActiveAction(null);
    const res = await toggleReaction({ messageId, emoji });
    if (res.data?.toggleReaction) upsert(res.data.toggleReaction);
  }

  async function onDelete(messageId: string): Promise<void> {
    const res = await deleteMessage({ messageId });
    if (res.data?.deleteMessage) upsert(res.data.deleteMessage);
  }

  async function onForward(messageId: string, toConversationId: string): Promise<void> {
    setActiveAction(null);
    setError(null);
    const res = await forwardMessage({ messageId, toConversationId });
    if (res.error) setError(friendly(res.error));
  }

  function startEdit(m: ChatMessageT): void {
    setEditing(m);
    setReplyTo(null);
    setBody(m.body);
  }

  async function onToggleMute(): Promise<void> {
    const next = !myMuted;
    const res = await setConversationMuted({ conversationId, muted: next });
    if (res.error) {
      setError(friendly(res.error));
      return;
    }
    // Reflect the new state locally on my own member row (no full refetch).
    setConv((prev) =>
      prev
        ? { ...prev, members: prev.members.map((m) => (m.userId === myUserId ? { ...m, muted: next } : m)) }
        : prev,
    );
  }

  async function onOpenFile(fileId: string): Promise<void> {
    setError(null);
    try {
      await openStoredFile(fileId);
    } catch (e) {
      setError(e instanceof FileUploadError ? e.message : STR.chatActionFailed);
    }
  }

  const announcementLocked = conv?.postingPolicy === "ANNOUNCEMENT" && !canManage;

  if (loading && messages.length === 0) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      {/* UX-7: FlatList (chat threads grow unbounded). Inverted — data stays
          newest-first, newest renders at the visual bottom; the header controls +
          "load older" live at the visual TOP, which for an inverted list is the
          ListFooterComponent. Non-inverted while empty so the empty state isn't
          flipped (the known inverted-list quirk). */}
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space(4) }}
        data={messages}
        inverted={messages.length > 0}
        keyExtractor={(m) => m.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<EmptyState message={STR.chatNoMessages} />}
        ListFooterComponent={
          <>
            {!exhausted && messages.length > 0 ? (
              <Button title={STR.chatLoadOlder} variant="ghost" loading={loadingOlder} onPress={() => void loadOlder()} />
            ) : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
              {canManage && conv && conv.kind !== "DIRECT" ? (
                <Button
                  title={`⚙ ${STR.chatManageGroup}`}
                  variant="ghost"
                  onPress={() => navigation.navigate("GroupManage", { conversationId })}
                />
              ) : null}
              {/* M-7: per-user push mute for this conversation (own-row toggle). */}
              {conv ? (
                <Button
                  title={myMuted ? `🔔 ${STR.chatUnmute}` : `🔕 ${STR.chatMute}`}
                  variant="ghost"
                  onPress={() => void onToggleMute()}
                />
              ) : null}
            </View>
          </>
        }
        renderItem={({ item: m }) => (
          <MessageBubble
            message={m}
            mine={m.senderId === myUserId}
            senderName={nameById.get(m.senderId) ?? ""}
            isGroup={conv?.kind !== "DIRECT"}
            composerLocked={announcementLocked}
            parent={m.replyToId ? messages.find((x) => x.id === m.replyToId) ?? null : null}
            myUserId={myUserId}
            active={activeAction}
            otherConvs={otherConvs}
            onReply={() => {
              setReplyTo(m);
              setEditing(null);
            }}
            onStartEdit={() => startEdit(m)}
            onDelete={() => void onDelete(m.id)}
            onToggleAction={(type) =>
              setActiveAction((cur) => (cur && cur.id === m.id && cur.type === type ? null : { id: m.id, type }))
            }
            onReact={(emoji) => void onReact(m.id, emoji)}
            onForward={(toId) => void onForward(m.id, toId)}
            onOpenFile={onOpenFile}
          />
        )}
      />

      {error ? <Notice message={error} tone="danger" /> : null}

      {/* Composer (hidden in ANNOUNCEMENT groups for non-managers — reactions stay) */}
      {announcementLocked ? (
        <Notice message={STR.chatAnnouncementOnly} tone="info" />
      ) : (
        <View style={{ padding: space(3), gap: space(2) }}>
          {editing ? (
            <ContextBanner label={STR.chatEditing} text={editing.body} onClear={() => { setEditing(null); setBody(""); }} />
          ) : replyTo ? (
            <ContextBanner label={STR.chatReplyingTo} text={replyTo.body} onClear={() => setReplyTo(null)} />
          ) : null}

          {pending.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
              {pending.map((p) => (
                <Chip
                  key={p.fileId}
                  label={`📎 ${p.originalName}  ✕`}
                  selected
                  onPress={() => setPending((prev) => prev.filter((x) => x.fileId !== p.fileId))}
                />
              ))}
            </View>
          ) : null}

          <Field
            value={body}
            onChangeText={setBody}
            placeholder={STR.chatComposePlaceholder}
            multiline
            autoCapitalize="sentences"
          />
          <View style={{ flexDirection: "row", gap: space(2) }}>
            {!editing ? (
              <Button title={STR.chatAttach} variant="secondary" onPress={() => void onAttach()} style={{ flexGrow: 1 }} />
            ) : null}
            <Button
              title={editing ? STR.chatEdit : STR.chatSend}
              onPress={() => void onSend()}
              loading={busy}
              disabled={!body.trim() && pending.length === 0}
              style={{ flexGrow: 2 }}
            />
          </View>
        </View>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^\[\w+\]\s*/, "") || STR.chatActionFailed;
}

/** Clip a quoted body to a single short line (Muted has no numberOfLines). */
function quote(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 80)}…` : oneLine;
}

function ContextBanner({
  label,
  text,
  onClear,
}: {
  label: string;
  text: string;
  onClear: () => void;
}): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <View style={{ flexShrink: 1 }}>
        <Muted>{label}</Muted>
        <Muted>{text.length > 60 ? `${text.slice(0, 60)}…` : text}</Muted>
      </View>
      <Button title="✕" variant="ghost" onPress={onClear} />
    </View>
  );
}

function MessageBubble({
  message: m,
  mine,
  senderName,
  isGroup,
  composerLocked,
  parent,
  myUserId,
  active,
  otherConvs,
  onReply,
  onStartEdit,
  onDelete,
  onToggleAction,
  onReact,
  onForward,
  onOpenFile,
}: {
  message: ChatMessageT;
  mine: boolean;
  senderName: string;
  isGroup: boolean;
  composerLocked: boolean;
  parent: ChatMessageT | null;
  myUserId: string;
  active: ActiveAction;
  otherConvs: ConversationT[];
  onReply: () => void;
  onStartEdit: () => void;
  onDelete: () => void;
  onToggleAction: (type: "react" | "forward") => void;
  onReact: (emoji: string) => void;
  onForward: (toConversationId: string) => void;
  onOpenFile: (fileId: string) => void;
}): React.ReactElement {
  const deleted = !!m.deletedAt;
  const reactions = aggregateReactions(m.reactions, myUserId);
  const { openingId, runOpen } = useFileOpen();

  return (
    <Card style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "92%", minWidth: "55%" }}>
      {isGroup && !mine ? <Muted style={{ fontWeight: "700" }}>{senderName}</Muted> : null}

      {m.forwardOfId ? <Badge text={STR.chatForwarded} tone="muted" /> : null}

      {parent ? (
        <View style={{ borderLeftWidth: 2, paddingLeft: space(2), marginVertical: space(1), opacity: 0.8 }}>
          <Muted>{quote(parent.deletedAt ? STR.chatDeletedPlaceholder : parent.body)}</Muted>
        </View>
      ) : null}

      <Body style={deleted ? { fontStyle: "italic" } : undefined}>
        {deleted ? STR.chatDeletedPlaceholder : m.body}
      </Body>

      {/* Attachments (M-4) — open via GET /files/:id (web) */}
      {!deleted && m.attachments.length > 0 ? (
        <View style={{ gap: space(1), marginTop: space(1) }}>
          {m.attachments.map((a) =>
            FILE_VIEW_SUPPORTED ? (
              <Button
                key={a.fileId}
                title={`📎 ${a.originalName}`}
                variant="secondary"
                loading={openingId === a.fileId}
                disabled={!!openingId}
                onPress={() => runOpen(a.fileId, () => onOpenFile(a.fileId))}
              />
            ) : (
              <Muted key={a.fileId}>📎 {a.originalName}</Muted>
            ),
          )}
        </View>
      ) : null}

      {/* Reactions */}
      {reactions.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
          {reactions.map((r) => (
            <Chip key={r.emoji} label={`${r.emoji} ${bnNum(r.count)}`} selected={r.mine} onPress={() => onReact(r.emoji)} />
          ))}
        </View>
      ) : null}

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(1) }}>
        <Muted>
          {bnNum(m.createdAt.slice(11, 16))}
          {m.editedAt && !deleted ? ` · ${STR.chatEdited}` : ""}
          {mine && m.seenCount > 0 ? ` · ✓ ${bnNum(m.seenCount)}` : ""}
        </Muted>
      </View>

      {/* Action row (skip for deleted) */}
      {!deleted ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
          {/* Reply + Edit feed the composer; in a locked ANNOUNCEMENT group the
              composer is hidden for non-managers, so suppress them (React /
              Forward / Delete do not post and stay available). */}
          {!composerLocked ? <Button title={STR.chatReply} variant="ghost" onPress={onReply} /> : null}
          <Button title={STR.chatReact} variant="ghost" onPress={() => onToggleAction("react")} />
          {otherConvs.length > 0 ? (
            <Button title={STR.chatForward} variant="ghost" onPress={() => onToggleAction("forward")} />
          ) : null}
          {mine && !composerLocked ? <Button title={STR.chatEdit} variant="ghost" onPress={onStartEdit} /> : null}
          {mine ? <Button title={STR.chatDelete} variant="ghost" onPress={onDelete} /> : null}
        </View>
      ) : null}

      {/* Inline react palette */}
      {active && active.id === m.id && active.type === "react" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
          {REACTION_PALETTE.map((e) => (
            <Chip key={e} label={e} onPress={() => onReact(e)} />
          ))}
        </View>
      ) : null}

      {/* Inline forward picker */}
      {active && active.id === m.id && active.type === "forward" ? (
        <View style={{ marginTop: space(1), gap: space(1) }}>
          <Muted>{STR.chatForwardTo}</Muted>
          {otherConvs.map((c) => (
            <Button
              key={c.id}
              title={conversationTitle(c, myUserId)}
              variant="secondary"
              onPress={() => onForward(c.id)}
            />
          ))}
        </View>
      ) : null}
    </Card>
  );
}
