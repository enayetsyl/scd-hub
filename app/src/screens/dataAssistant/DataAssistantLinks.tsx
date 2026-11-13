/**
 * The data assistant home's extra cards (docs/prd-data-assistant-mcp.md §11, DA-4):
 *   connect Claude   the steps and the connector address (data_assistant:connect — the Principal in v1)
 *   connected apps   my own connections, with Disconnect (anyone with a connection)
 *   Principal        links to the tool-call log and every person's connections (data_assistant:audit)
 */
import React from "react";
import { useMutation, useQuery } from "urql";
import * as Clipboard from "expo-clipboard";
import { MY_DATA_CONNECTIONS, MY_DATA_TOOL_CALLS_PAGE, REVOKE_DATA_CONNECTION } from "../../graphql/dataAssistantAdmin";
import { Card, Body, Muted, Button, Notice } from "../../components/ui";
import { REST_BASE } from "../../graphql/client";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../state/ConfirmContext";
import { useToast } from "../../state/ToastContext";
import { STR, isoDateTimeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { fill } from "../aiWorkspace/aiWorkspaceUi";
import { Pager } from "../../components/Pager";
import { usePageState } from "../../lib/paging";

const MY_CALLS_PAGE_SIZE = 10;

type Nav = { navigate: (screen: "DataAssistantLog" | "DataConnections") => void };

/** The connector address: the API's own origin (the web build calls it relatively) + /mcp/data. */
export function dataConnectorUrl(): string {
  const base = /^https?:\/\//.test(REST_BASE) ? REST_BASE : `${typeof window !== "undefined" && window.location ? window.location.origin : ""}${REST_BASE}`;
  return `${base}/mcp/data`;
}

function ConnectClaudeCard(): React.ReactElement {
  const url = dataConnectorUrl();
  const [copied, setCopied] = React.useState(false);
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.daClaudeTitle}</Body>
      <Muted>{STR.daClaudeHelp}</Muted>
      <Body>{STR.daClaudeStep1}</Body>
      <Body>{fill(STR.daClaudeStep2, { url })}</Body>
      <Button
        title={copied ? STR.copied : STR.copy}
        variant="secondary"
        onPress={() => {
          void Clipboard.setStringAsync(url).then(() => setCopied(true));
        }}
      />
      <Body>{STR.daClaudeStep3}</Body>
      <Body>{STR.daClaudeStep4}</Body>
      <Muted>{STR.daClaudeNote}</Muted>
    </Card>
  );
}

function MyConnectionsCard(): React.ReactElement | null {
  const toast = useToast();
  const { confirmAction } = useConfirm();
  const [q, refetch] = useQuery({ query: MY_DATA_CONNECTIONS, requestPolicy: "cache-and-network" });
  const [, revoke] = useMutation(REVOKE_DATA_CONNECTION);
  const rows = q.data?.myDataConnections ?? [];
  if (!q.data && !q.error) return null;

  async function onRevoke(clientId: string): Promise<void> {
    const ok = await confirmAction({ title: STR.daAppsDisconnect, message: STR.daAppsDisconnectConfirm, confirmLabel: STR.daAppsDisconnect, tone: "danger" });
    if (!ok) return;
    const res = await revoke({ clientId });
    if (res.error) toast.show(friendlyError(res.error as never), "danger");
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.daAppsTitle}</Body>
      {q.error ? <Notice tone="danger" message={friendlyError(q.error as never)} /> : null}
      {rows.length === 0 ? <Muted>{STR.daAppsNone}</Muted> : null}
      {rows.map((c) => (
        <Card key={c.clientId}>
          <Body style={{ fontWeight: "700" }}>{c.clientName}</Body>
          <Muted>{fill(STR.daAppsMeta, { since: isoDateTimeLabel(c.connectedAt), last: c.lastUsedAt ? isoDateTimeLabel(c.lastUsedAt) : "—", calls: c.calls30d, ends: isoDateTimeLabel(c.expiresAt) })}</Muted>
          <Button title={STR.daAppsDisconnect} variant="danger" onPress={() => void onRevoke(c.clientId)} />
        </Card>
      ))}
    </Card>
  );
}

function MyCallsCard(): React.ReactElement | null {
  const [page, setPage] = usePageState(false);
  const [q] = useQuery({ query: MY_DATA_TOOL_CALLS_PAGE, variables: { page, pageSize: MY_CALLS_PAGE_SIZE }, requestPolicy: "cache-and-network" });
  const data = q.data?.myDataToolCallsPage;
  if (!data && !q.error) return null;
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.daMyCallsTitle}</Body>
      {q.error ? <Notice tone="danger" message={friendlyError(q.error as never)} /> : null}
      {data && data.rows.length === 0 ? <Muted>{STR.daMyCallsNone}</Muted> : null}
      {data?.rows.map((r) => (
        <Muted key={r.id}>{`${isoDateTimeLabel(r.at)} · ${r.surface === "claude" ? r.clientName ?? "Claude" : STR.daLogInApp} · ${r.tool} · ${r.outcome}`}</Muted>
      ))}
      {data ? <Pager page={page} pageSize={MY_CALLS_PAGE_SIZE} total={data.total} onPage={setPage} /> : null}
    </Card>
  );
}

export function DataAssistantLinks({ navigation }: { navigation: unknown }): React.ReactElement {
  const { can } = useAuth();
  const nav = navigation as Nav;
  return (
    <>
      {can("data_assistant:connect") ? <ConnectClaudeCard /> : null}
      <MyConnectionsCard />
      <MyCallsCard />
      {can("data_assistant:audit") ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.daAdminTitle}</Body>
          <Button title={STR.daLogTitle} variant="secondary" onPress={() => nav.navigate("DataAssistantLog")} />
          <Button title={STR.daAllConnTitle} variant="secondary" onPress={() => nav.navigate("DataConnections")} />
        </Card>
      ) : null}
    </>
  );
}
