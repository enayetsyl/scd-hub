/**
 * DataChatScreen (docs/prd-data-assistant-mcp.md §11, DA-2) — one data chat.
 *
 *   turns     oldest first, opening at the last page (D-#761); a running answer is polled every
 *             1.5 s; Stop while it runs
 *   chips     under each answer, the data it looked at ("উপস্থিতি", "বাড়ির কাজ"…) and an
 *             "অনুমতি নেই" chip when a tool said no permission; the price of the answer
 *   picker    the model, Claude Sonnet 5.5 by default; choosing DeepSeek shows the warning that
 *             names, individual pay and comment texts also go to DeepSeek — every time it is
 *             chosen (owner Q6) — and asks to confirm
 *   View as   a banner when the Principal is testing as another login (owner Q11)
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  ASK_DATA_ASSISTANT,
  DATA_CHAT_MESSAGES_PAGE,
  DATA_CHAT_SETUP,
  SET_DATA_CHAT_MODEL,
  STOP_DATA_ANSWER,
  type DataChatMessageT,
} from "../../graphql/dataAssistant";
import type { DataAssistantStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Field, Notice, Loader, ErrorBanner, Select, Badge, breakAnywhere } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { useToast } from "../../state/ToastContext";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { fill, modelLabel, usd } from "../aiWorkspace/aiWorkspaceUi";

type Props = NativeStackScreenProps<DataAssistantStackParamList, "DataChat">;
const PAGE_SIZE = 30;
const POLL_MS = 1500;

function MessageCard({ m, onStop }: { m: DataChatMessageT; onStop: () => void }): React.ReactElement {
  const mine = m.role === "user";
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{mine ? STR.daYou : STR.daAi}</Body>
      {m.text ? <Body style={breakAnywhere}>{m.text}</Body> : null}
      {m.status === "running" ? <Badge text={STR.daWriting} tone="info" /> : null}
      {m.status === "failed" && m.error ? <Notice tone="danger" message={m.error} /> : null}
      {m.status === "stopped" ? <Muted>{STR.daStopped}</Muted> : null}
      {!mine && m.tools.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
          {[...new Map(m.tools.map((t) => [t.labelBn, t])).values()].map((t) => (
            <Badge key={t.tool} text={t.labelBn} tone={t.outcome === "ok" ? "info" : "warn"} />
          ))}
          {m.denied ? <Badge text={STR.daDenied} tone="danger" /> : null}
        </View>
      ) : null}
      {!mine && m.status === "done" ? <Muted>{`${modelLabel(m.modelName ?? "")}${m.costUsd !== null ? ` · ${fill(STR.daCost, { cost: `$${usd(m.costUsd)}` })}` : ""}`}</Muted> : null}
      {m.status === "running" ? (
        <View style={{ marginTop: space(1) }}>
          <Button title={STR.daStop} variant="danger" onPress={onStop} />
        </View>
      ) : null}
    </Card>
  );
}

export default function DataChatScreen({ route }: Props): React.ReactElement {
  const { sessionId } = route.params;
  const toast = useToast();
  const [page, setPage] = React.useState<number | null>(null);
  const [setup] = useQuery({ query: DATA_CHAT_SETUP, variables: { id: sessionId } });
  const [mq, refetch] = useQuery({ query: DATA_CHAT_MESSAGES_PAGE, variables: { sessionId, page, pageSize: PAGE_SIZE }, requestPolicy: "cache-and-network" });
  const [, ask] = useMutation(ASK_DATA_ASSISTANT);
  const [, stop] = useMutation(STOP_DATA_ANSWER);
  const [, setChatModel] = useMutation(SET_DATA_CHAT_MODEL);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [model, setModel] = React.useState<string | null>(null);
  const [pendingDeepseek, setPendingDeepseek] = React.useState<string | null>(null);
  const data = mq.data?.dataChatMessagesPage;
  const models = setup.data?.dataChatModels ?? [];
  const warning = setup.data?.dataChatDeepseekWarning ?? "";

  const refresh = React.useCallback(() => refetch({ requestPolicy: "network-only" }), [refetch]);
  const rows = data?.rows ?? [];
  const active = rows.find((m) => m.role === "assistant" && m.status === "running");
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [active, refresh]);

  if ((mq.fetching && !data) || (setup.fetching && !setup.data)) return <Screen><Loader /></Screen>;
  if (mq.error || setup.error || !data) return <Screen><ErrorBanner message={friendlyError((mq.error ?? setup.error) as never)} /></Screen>;

  const chat = setup.data?.dataChat;
  const picked = model ?? chat?.chatModel ?? models.find((m) => m.isDefault)?.id ?? "claude-sonnet-5-5";
  const viewAs = !!chat?.viewAs;

  function onPick(m: string): void {
    // DeepSeek: show the warning every time it is chosen, and wait for the confirm.
    if (models.find((x) => x.id === m)?.deepseek) setPendingDeepseek(m);
    else void choose(m);
  }

  async function choose(m: string): Promise<void> {
    setPendingDeepseek(null);
    setModel(m);
    const res = await setChatModel({ sessionId, model: m });
    if (res.error) toast.show(friendlyError(res.error as never), "danger");
  }

  async function onSend(): Promise<void> {
    setBusy(true);
    const res = await ask({ sessionId, text, model: picked });
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

  return (
    <Screen scroll>
      {viewAs ? <Notice tone="warn" message={STR.daViewAs} /> : null}
      {data.total > data.rows.length && data.page > 1 ? <Pager page={data.page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} /> : null}
      {rows.length === 0 ? <Notice tone="info" message={STR.daIntro} /> : null}
      {rows.map((m) => (
        <MessageCard key={m.id} m={m} onStop={() => void onStop(m.id)} />
      ))}
      {active ? <Muted>{STR.daPoll}</Muted> : null}
      <Card>
        <Select
          label={STR.daModel}
          value={picked}
          options={models.map((m) => ({ label: `${modelLabel(m.id)}${m.isDefault ? ` ${STR.daDefault}` : ""}`, value: m.id }))}
          onChange={onPick}
        />
        {pendingDeepseek ? (
          <>
            <Notice tone="warn" message={warning} />
            <Button title={STR.daDeepseekOk} variant="secondary" onPress={() => void choose(pendingDeepseek)} />
          </>
        ) : null}
        <Field label={STR.daQuestion} value={text} onChangeText={setText} multiline autoCapitalize="sentences" inputStyle={{ minHeight: 80 }} />
        <Muted>{STR.daPrivacy}</Muted>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
          <Button title={STR.daSend} onPress={() => void onSend()} loading={busy} disabled={!text.trim() || !!active || !!pendingDeepseek} />
        </View>
      </Card>
    </Screen>
  );
}
