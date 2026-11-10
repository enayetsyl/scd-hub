/**
 * Claude connection (AI Workspace W-5, D-#1214) — on the workspace home, Principal only
 * (`ai_workspace:admin`): the connector address for Claude / Claude Code, the clients holding
 * live tokens with their use in the last 30 days, and "disconnect" (revokes their tokens).
 */
import React from "react";
import { useMutation, useQuery } from "urql";
import { AI_MCP_CONNECTIONS, REVOKE_AI_MCP_CONNECTION } from "../../graphql/aiWorkspaceMcp";
import { Card, Body, Muted, Button, Notice } from "../../components/ui";
import { REST_BASE } from "../../graphql/client";
import { useConfirm } from "../../state/ConfirmContext";
import { useToast } from "../../state/ToastContext";
import { STR, isoDateTimeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { fill } from "./aiWorkspaceUi";

export function ClaudeConnectionCard(): React.ReactElement {
  const toast = useToast();
  const { confirmAction } = useConfirm();
  const [q, refetch] = useQuery({ query: AI_MCP_CONNECTIONS, requestPolicy: "cache-and-network" });
  const [, revoke] = useMutation(REVOKE_AI_MCP_CONNECTION);
  const url = `${REST_BASE}/mcp`;
  const rows = q.data?.aiMcpConnections ?? [];

  async function onRevoke(clientId: string): Promise<void> {
    const ok = await confirmAction({ title: STR.awClaudeRevoke, message: STR.awClaudeRevokeConfirm, confirmLabel: STR.awClaudeRevoke, tone: "danger" });
    if (!ok) return;
    const res = await revoke({ clientId });
    if (res.error) toast.show(friendlyError(res.error as never), "danger");
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.awClaudeTitle}</Body>
      <Muted>{STR.awClaudeHelp}</Muted>
      <Body>{fill(STR.awClaudeUrl, { url })}</Body>
      <Muted>{fill(STR.awClaudeCode, { cmd: `claude mcp add --transport http scd-hub ${url}` })}</Muted>
      {q.error ? <Notice tone="danger" message={friendlyError(q.error as never)} /> : null}
      {q.data && rows.length === 0 ? <Muted>{STR.awClaudeNone}</Muted> : null}
      {rows.map((c) => (
        <React.Fragment key={c.clientId}>
          <Muted>
            {fill(STR.awClaudeLine, {
              name: c.clientName,
              since: isoDateTimeLabel(c.connectedAt),
              last: c.lastUsedAt ? isoDateTimeLabel(c.lastUsedAt) : STR.awNever,
              calls: c.calls30d,
              kb: c.replyKb30d,
            })}
          </Muted>
          <Button title={STR.awClaudeRevoke} variant="danger" onPress={() => void onRevoke(c.clientId)} />
        </React.Fragment>
      ))}
    </Card>
  );
}
