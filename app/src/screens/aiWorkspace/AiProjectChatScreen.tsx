/**
 * AiProjectChatScreen (AI Workspace W-2, docs/prd-ai-workspace.md §4) — one project chat.
 *
 *   header   the price clock (peak / off-peak in Bangladesh time, D-#1205) and the context
 *            meter; from 80 % it suggests a new chat (never shortens on its own, D-#1204)
 *   turns    oldest first, opening at the last page; an answer being written streams in
 *            (web: SSE; phone: polled every 1.5 s)
 *   composer the three pickers — Model (with its price now), Thinking, Run (now / off-peak;
 *            no default for a new chat) — the message, Send, and Stop while an answer runs
 *   files    a file attached to THIS chat only (after the project's pinned files)
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  AI_PROJECT_CHAT,
  AI_PROJECT_CHAT_MESSAGES_PAGE,
  SEND_AI_PROJECT_MESSAGE,
  START_AI_PROJECT_CHAT,
  STOP_AI_PROJECT_MESSAGE,
  type AiChatMessageT,
  type AiPriceClockT,
  type AiProjectChatT,
} from "../../graphql/aiWorkspaceChat";
import type { AiWorkspaceStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Field, Notice, Loader, ErrorBanner, Select, Badge, breakAnywhere } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { pickAndUploadAiWorkspaceFile } from "../../lib/files";
import { watchAiAnswer } from "../../lib/aiChatStream";
import { useToast } from "../../state/ToastContext";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { fill, isClaudeModel, kTokens, modelLabel, THINKING_OPTIONS, usd } from "./aiWorkspaceUi";
import { Platform } from "react-native";

type Props = NativeStackScreenProps<AiWorkspaceStackParamList, "AiProjectChat">;
const PAGE_SIZE = 40;
const POLL_MS = 1500;
const DHAKA_MS = 6 * 60 * 60 * 1000;

/** "4:00 PM" in Bangladesh time, with "আগামীকাল" / the date when it is not today. */
export function dhakaTime(iso: string, now: Date = new Date()): string {
  const d = new Date(new Date(iso).getTime() + DHAKA_MS);
  const today = new Date(now.getTime() + DHAKA_MS);
  const h = d.getUTCHours();
  const t = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  const days = Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86_400_000);
  if (days === 0) return t;
  if (days === 1) return `${STR.awTomorrow} ${t}`;
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1} ${t}`;
}

function ClockCard({ clock, chat, onNewChat }: { clock: AiPriceClockT; chat: AiProjectChatT; onNewChat: () => void }): React.ReactElement {
  const pct = Math.round(chat.contextUsed * 100);
  return (
    <Card>
      <Notice tone={clock.peak ? "warn" : "ok"} message={fill(clock.peak ? STR.awClockPeak : STR.awClockOff, { time: dhakaTime(clock.changesAt) })} />
      <Muted>{fill(STR.awMeter, { used: kTokens(chat.contextTokens), window: kTokens(chat.windowTokens), pct })}</Muted>
      {chat.suggestNewChat ? (
        <>
          <Notice tone="info" message={STR.awMeterSuggest} />
          <Button title={STR.awNewChat} variant="secondary" onPress={onNewChat} />
        </>
      ) : null}
    </Card>
  );
}

function MessageCard({ m, onStop, canStop, onSaveDraft }: { m: AiChatMessageT; onStop: () => void; canStop: boolean; onSaveDraft: () => void }): React.ReactElement {
  const mine = m.role === "user";
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{mine ? m.authorName ?? STR.awYou : STR.awAi}</Body>
      {m.text ? <Body style={breakAnywhere}>{m.text}</Body> : null}
      {m.warning ? <Notice tone="warn" message={m.warning} /> : null}
      {m.status === "running" ? <Badge text={STR.awWriting} tone="info" /> : null}
      {m.status === "queued" && m.runAfter ? <Notice tone="info" message={fill(STR.awQueued, { time: dhakaTime(m.runAfter) })} /> : null}
      {m.status === "failed" && m.error ? <Notice tone="danger" message={m.error} /> : null}
      {m.status === "stopped" ? <Muted>{STR.awStopped}</Muted> : null}
      {!mine && m.status === "done" && m.tokens !== null ? (
        <Muted>{fill(STR.awAnswerMeta, { model: modelLabel(m.modelName ?? ""), tokens: kTokens(m.tokens), cost: usd(m.costUsd ?? 0) })}</Muted>
      ) : null}
      {canStop && !mine && m.status === "done" && m.text ? (
        <View style={{ marginTop: space(1) }}>
          <Button title={STR.awSaveAsDraft} variant="secondary" onPress={onSaveDraft} />
        </View>
      ) : null}
      {canStop && (m.status === "running" || m.status === "queued") ? (
        <View style={{ marginTop: space(1) }}>
          <Button title={STR.awStop} variant="danger" onPress={onStop} />
        </View>
      ) : null}
    </Card>
  );
}

export default function AiProjectChatScreen({ route, navigation }: Props): React.ReactElement {
  const { sessionId, canEdit } = route.params;
  const toast = useToast();
  const [page, setPage] = React.useState<number | null>(null);
  const [cq, refetchChat] = useQuery({ query: AI_PROJECT_CHAT, variables: { id: sessionId }, requestPolicy: "cache-and-network" });
  const [mq, refetchMessages] = useQuery({ query: AI_PROJECT_CHAT_MESSAGES_PAGE, variables: { sessionId, page, pageSize: PAGE_SIZE }, requestPolicy: "cache-and-network" });
  const [, send] = useMutation(SEND_AI_PROJECT_MESSAGE);
  const [, stop] = useMutation(STOP_AI_PROJECT_MESSAGE);
  const [, startChat] = useMutation(START_AI_PROJECT_CHAT);
  const chat = cq.data?.aiProjectChat;
  const clock = cq.data?.aiPriceClock;
  const files = cq.data?.aiProjectChatFiles ?? [];
  const data = mq.data?.aiProjectChatMessagesPage;

  const [text, setText] = React.useState("");
  const [model, setModel] = React.useState<string | null>(null);
  const [thinking, setThinking] = React.useState<string | null>(null);
  const [runAt, setRunAt] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [live, setLive] = React.useState<Record<string, { text: string; status: AiChatMessageT["status"]; error: string | null }>>({});
  const [uploading, setUploading] = React.useState(false);

  React.useEffect(() => {
    if (chat) navigation.setOptions({ title: chat.title });
  }, [chat, navigation]);

  const rows = (data?.rows ?? []).map((m) => (live[m.id] ? { ...m, ...live[m.id] } : m));
  const active = rows.find((m) => m.role === "assistant" && (m.status === "running" || m.status === "queued"));
  const refresh = React.useCallback(() => {
    refetchMessages({ requestPolicy: "network-only" });
    refetchChat({ requestPolicy: "network-only" });
  }, [refetchMessages, refetchChat]);

  // Stream the running answer on the web; poll on the phone (and for a queued one anywhere).
  const activeId = active?.id ?? null;
  const activeStatus = active?.status ?? null;
  React.useEffect(() => {
    if (!activeId) return;
    if (activeStatus === "running") {
      const off = watchAiAnswer(
        activeId,
        (d) => setLive((prev) => ({ ...prev, [activeId]: d })),
        () => refresh(),
      );
      if (off) return off;
    }
    const t = setInterval(refresh, activeStatus === "queued" ? 30_000 : POLL_MS);
    return () => clearInterval(t);
  }, [activeId, activeStatus, refresh]);

  if ((cq.fetching && !chat) || (mq.fetching && !data)) return <Screen><Loader /></Screen>;
  if (cq.error || mq.error || !chat || !clock || !data) return <Screen><ErrorBanner message={friendlyError((cq.error ?? mq.error) as never)} /></Screen>;

  const pickedModel = model ?? chat.model;
  const pickedThinking = thinking ?? chat.thinking;
  const pickedRun = runAt ?? chat.runAt;
  const price = (m: string) => (m === "deepseek-v4-pro" ? clock.proPerMillion : clock.claudePerMillion?.find((c) => c.model === m) ?? clock.flashPerMillion);

  async function onSend(): Promise<void> {
    if (!pickedRun) return;
    setBusy(true);
    const res = await send({ sessionId, text, model: pickedModel, thinking: pickedThinking, runAt: pickedRun });
    setBusy(false);
    if (res.error) return toast.show(friendlyError(res.error as never), "danger");
    setText("");
    setPage(null);
    refresh();
  }

  async function onStop(id: string): Promise<void> {
    const res = await stop({ messageId: id });
    if (res.error) toast.show(friendlyError(res.error as never), "danger");
    refresh();
  }

  async function onNewChat(): Promise<void> {
    const res = await startChat({ projectId: chat!.projectId });
    if (res.error || !res.data) return toast.show(friendlyError(res.error as never), "danger");
    navigation.replace("AiProjectChat", { sessionId: res.data.startAiProjectChat.id, canEdit });
  }

  async function onAttach(): Promise<void> {
    setUploading(true);
    try {
      const r = await pickAndUploadAiWorkspaceFile(chat!.projectId, sessionId);
      if (r) toast.show(STR.awUploaded, "ok");
    } catch (e) {
      toast.show((e as Error).message, "danger");
    } finally {
      setUploading(false);
      refresh();
    }
  }

  return (
    <Screen scroll>
      <ClockCard clock={clock} chat={chat} onNewChat={() => void onNewChat()} />
      {data.total > data.rows.length && data.page > 1 ? <Pager page={data.page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} /> : null}
      {rows.map((m) => (
        <MessageCard key={m.id} m={m} canStop={canEdit} onStop={() => void onStop(m.id)} onSaveDraft={() => navigation.navigate("AiDraftNew", { projectId: chat.projectId, messageId: m.id })} />
      ))}
      {Platform.OS !== "web" && active?.status === "running" ? <Muted>{STR.awPhoneStream}</Muted> : null}
      {files.length ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.awAttachedFiles}</Body>
          {files.map((f) => (
            <Muted key={f.id}>{`${f.name} · ${f.status === "ready" ? `${kTokens(f.tokenCount)}` : f.status === "processing" ? STR.awFileStatusProcessing : STR.awFileStatusFailed}`}</Muted>
          ))}
        </Card>
      ) : null}
      {canEdit ? (
        <Card>
          <Select
            label={STR.awModel}
            value={pickedModel}
            options={["deepseek-flash", "deepseek-v4-pro", ...(clock.claudePerMillion ?? []).map((c) => c.model)].map((m) => ({ label: fill(STR.awModelPrice, { name: modelLabel(m), out: price(m).output.toFixed(2) }), value: m }))}
            onChange={setModel}
          />
          <Select label={STR.awThinking} value={pickedThinking} options={THINKING_OPTIONS()} onChange={setThinking} />
          <Select
            label={STR.awRun}
            value={pickedRun}
            placeholder={STR.awRunPick}
            options={[
              { label: clock.peak ? STR.awRunNowPeak : STR.awRunNowOff, value: "now" },
              { label: STR.awRunOffpeak, value: "offpeak" },
            ]}
            onChange={setRunAt}
          />
          {!pickedRun ? <Muted>{STR.awRunPick}</Muted> : null}
          {isClaudeModel(pickedModel) && pickedRun === "offpeak" ? <Muted>{STR.awClaudeNoOffpeak}</Muted> : null}
          <Field label={STR.awMessage} value={text} onChangeText={setText} multiline autoCapitalize="sentences" inputStyle={{ minHeight: 100 }} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
            <Button title={STR.awSend} onPress={() => void onSend()} loading={busy} disabled={!text.trim() || !pickedRun || !!active} />
            <Button title={STR.awAttach} variant="secondary" onPress={() => void onAttach()} loading={uploading} />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
