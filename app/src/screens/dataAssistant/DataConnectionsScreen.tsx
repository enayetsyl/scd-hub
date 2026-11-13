/**
 * DataConnectionsScreen (docs/prd-data-assistant-mcp.md §11, DA-4) — "সব সংযোগ": every person's
 * Claude data connections, paged (D-#761), with Disconnect (data_assistant:audit, Principal). The W-5 "Claude
 * সংযোগ" card for the AI workspace stays where it is.
 */
import React from "react";
import { useMutation, useQuery } from "urql";
import { ALL_DATA_CONNECTIONS_PAGE, REVOKE_DATA_CONNECTION } from "../../graphql/dataAssistantAdmin";

import { Screen, Card, Body, Muted, Button, Loader, ErrorBanner } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { usePageState } from "../../lib/paging";
import { useConfirm } from "../../state/ConfirmContext";
import { useToast } from "../../state/ToastContext";
import { STR, isoDateTimeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { fill } from "../aiWorkspace/aiWorkspaceUi";

const PAGE_SIZE = 20;

export default function DataConnectionsScreen(): React.ReactElement {
  const toast = useToast();
  const { confirmAction } = useConfirm();
  const [page, setPage] = usePageState(false);
  const [q, refetch] = useQuery({ query: ALL_DATA_CONNECTIONS_PAGE, variables: { page, pageSize: PAGE_SIZE }, requestPolicy: "cache-and-network" });
  const [, revoke] = useMutation(REVOKE_DATA_CONNECTION);
  const data = q.data?.allDataConnectionsPage;
  const rows = data?.rows ?? [];

  async function onRevoke(clientId: string, userId: string): Promise<void> {
    const ok = await confirmAction({ title: STR.daAppsDisconnect, message: STR.daAppsDisconnectConfirm, confirmLabel: STR.daAppsDisconnect, tone: "danger" });
    if (!ok) return;
    const res = await revoke({ clientId, userId });
    if (res.error) toast.show(friendlyError(res.error as never), "danger");
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      {q.fetching && !q.data ? <Loader /> : null}
      {q.error ? <ErrorBanner message={friendlyError(q.error as never)} /> : null}
      {data && rows.length === 0 ? <Muted>{STR.daAppsNone}</Muted> : null}
      {rows.map((c) => (
        <Card key={`${c.userId}|${c.clientId}`}>
          <Body style={{ fontWeight: "700" }}>{`${c.userName ?? c.userId} · ${c.clientName}`}</Body>
          <Muted>{fill(STR.daAppsMeta, { since: isoDateTimeLabel(c.connectedAt), last: c.lastUsedAt ? isoDateTimeLabel(c.lastUsedAt) : "—", calls: c.calls30d, ends: isoDateTimeLabel(c.expiresAt) })}</Muted>
          <Button title={STR.daAppsDisconnect} variant="danger" onPress={() => void onRevoke(c.clientId, c.userId)} />
        </Card>
      ))}
      {data ? <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} /> : null}
    </Screen>
  );
}
