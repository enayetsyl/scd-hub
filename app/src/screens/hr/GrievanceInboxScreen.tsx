/**
 * GrievanceInboxScreen — the confidential grievance inbox (prd-hr §5.2, H5.4/H5.5).
 * performance:manage reads all grievances (filter by status) and moves them
 * under_review / resolved / closed with a note. Confidential — Principal/Office only.
 */
import React from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import { GRIEVANCE_STATUSES } from "@scd/shared";
import { GRIEVANCES_QUERY, UPDATE_GRIEVANCE, STAFF_QUERY } from "../../graphql/operations";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Divider,
  Chip,
  ChipRow,
  Field,
  Select,
  Button,
  Badge,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
} from "../../components/ui";
import { STR, grievanceStatusLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

function statusTone(s: string): "info" | "ok" | "muted" {
  return s === "resolved" || s === "closed" ? "ok" : s === "under_review" ? "info" : "muted";
}

export default function GrievanceInboxScreen(): React.ReactElement {
  const [status, setStatus] = React.useState<string | null>("open");
  const [newStatus, setNewStatus] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const [grievQ, refetch] = useQuery({ query: GRIEVANCES_QUERY, variables: { status: status ?? undefined } });
  const [staffQ] = useQuery({ query: STAFF_QUERY, variables: {} });
  const [, update] = useMutation(UPDATE_GRIEVANCE);

  const grievances = grievQ.data?.grievances ?? [];
  const staffName = new Map((staffQ.data?.staff ?? []).map((s) => [s.id, s.nameBn || s.name]));

  async function runUpdate(grievanceId: string): Promise<void> {
    const next = newStatus[grievanceId];
    if (!next) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await update({ grievanceId, status: next, resolutionNote: note[grievanceId]?.trim() || undefined });
    setBusy(false);
    if (res.error || !res.data?.updateGrievance) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.hrGrievanceUpdated);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <H2>{STR.hrGrievances}</H2>
      <Muted>{STR.hrGrievanceConfidential}</Muted>
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      <Muted style={{ marginTop: space(2), marginBottom: space(1) }}>{STR.hrLeaveStatusFilter}</Muted>
      <ChipRow>
        {GRIEVANCE_STATUSES.map((s) => (
          <Chip key={s} label={grievanceStatusLabel(s)} selected={status === s} onPress={() => setStatus(s)} />
        ))}
        <Chip label={STR.allCategories} selected={status === null} onPress={() => setStatus(null)} />
      </ChipRow>

      {grievQ.fetching ? (
        <Loader label={STR.loading} />
      ) : grievQ.error ? (
        <ErrorBanner message={friendlyError(grievQ.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : grievances.length === 0 ? (
        <EmptyState message={STR.empty} />
      ) : (
        grievances.map((g) => (
          <Card key={g.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700", flex: 1 }}>{g.subject}</Body>
              <Badge text={grievanceStatusLabel(g.status)} tone={statusTone(g.status)} />
            </View>
            <Muted>{STR.hrRaisedBy}: {staffName.get(g.raisedByStaffProfileId) ?? "—"}</Muted>
            <Muted>{g.detail}</Muted>
            {g.resolutionNote ? <Muted>“{g.resolutionNote}”</Muted> : null}
            <Divider />
            <Select
              label={STR.hrGrievanceUpdate}
              value={newStatus[g.id] ?? null}
              options={GRIEVANCE_STATUSES.map((s) => ({ label: grievanceStatusLabel(s), value: s }))}
              onChange={(v) => setNewStatus((p) => ({ ...p, [g.id]: v }))}
              placeholder={STR.hrGrievanceUpdate}
            />
            <Field
              label={STR.hrGrievanceResolution}
              value={note[g.id] ?? ""}
              onChangeText={(v) => setNote((p) => ({ ...p, [g.id]: v }))}
              autoCapitalize="sentences"
            />
            <Button title={STR.hrGrievanceUpdate} onPress={() => runUpdate(g.id)} loading={busy} disabled={busy || !newStatus[g.id]} />
          </Card>
        ))
      )}
    </Screen>
  );
}
