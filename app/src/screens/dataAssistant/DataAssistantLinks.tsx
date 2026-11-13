/**
 * The data assistant home's extra cards (docs/prd-data-assistant-mcp.md §11, DA-4):
 *   connect Claude   the steps and the connector address (data_assistant:connect — the Principal in v1)
 *   connected apps   my own connections, with Disconnect (anyone with a connection)
 *   Principal        links to the tool-call log and every person's connections (data_assistant:audit)
 */
import React from "react";
import { useMutation, useQuery } from "urql";
import { MY_DATA_CONNECTIONS, REVOKE_DATA_CONNECTION } from "../../graphql/dataAssistantAdmin";
import { Card, Body, Muted, Button, Notice } from "../../components/ui";
import { REST_BASE } from "../../graphql/client";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../state/ConfirmContext";
import { useToast } from "../../state/ToastContext";
import { STR, isoDateTimeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { fill } from "../aiWorkspace/aiWorkspaceUi";

type Nav = { navigate: (screen: "DataAssistantLog" | "DataConnections") => void };

/** The connector address: the API's own origin (the web build calls it relatively) + /mcp/data. */
export function dataConnectorUrl(): string {
  const base = /^https?:\/\//.test(REST_BASE) ? REST_BASE : `${typeof window !== "undefined" && window.location ? window.location.origin : ""}${REST_BASE}`;
  return `${base}/mcp/data`;
}

function ConnectClaudeCard(): React.ReactElement {
  const url = dataConnectorUrl();
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.daClaudeTitle}</Body>
      <Muted>{STR.daClaudeHelp}</Muted>
      <Body>{STR.daClaudeStep1}</Body>
      <Body>{fill(STR.daClaudeStep2, { url })}</Body>
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

export function DataAssistantLinks({ navigation }: { navigation: unknown }): React.ReactElement {
  const { can } = useAuth();
  const nav = navigation as Nav;
  return (
    <>
      {can("data_assistant:connect") ? <ConnectClaudeCard /> : null}
      <MyConnectionsCard />
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
