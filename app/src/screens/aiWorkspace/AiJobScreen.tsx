/**
 * AiJobScreen (AI Workspace W-4) — one batch job: progress, cost against the estimate, each
 * item's state (and its draft once done), cancel the rest. Refreshes while it runs.
 */
import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { AI_JOB, CANCEL_AI_JOB } from "../../graphql/aiWorkspaceJobs";
import type { AiWorkspaceStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Notice, Loader, ErrorBanner, Badge } from "../../components/ui";
import { useConfirm } from "../../state/ConfirmContext";
import { useToast } from "../../state/ToastContext";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { fill, modelLabel, usd } from "./aiWorkspaceUi";
import { jobStatusLabel } from "./jobUi";
import { kindLabel } from "./draftUi";

type Props = NativeStackScreenProps<AiWorkspaceStackParamList, "AiJob">;

export default function AiJobScreen({ route, navigation }: Props): React.ReactElement {
  const { jobId } = route.params;
  const toast = useToast();
  const { confirmAction } = useConfirm();
  const [q, refetch] = useQuery({ query: AI_JOB, variables: { id: jobId }, requestPolicy: "cache-and-network" });
  const [cancelState, cancel] = useMutation(CANCEL_AI_JOB);
  const j = q.data?.aiJob;
  const active = j && (j.status === "queued" || j.status === "running");

  React.useEffect(() => {
    if (j) navigation.setOptions({ title: j.title });
  }, [j, navigation]);
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => refetch({ requestPolicy: "network-only" }), 5000);
    return () => clearInterval(t);
  }, [active, refetch]);

  if (q.fetching && !j) return <Screen><Loader /></Screen>;
  if (q.error || !j) return <Screen><ErrorBanner message={friendlyError(q.error as never)} /></Screen>;

  async function onCancel(): Promise<void> {
    const ok = await confirmAction({ title: STR.awJobCancel, message: STR.awJobCancelConfirm, confirmLabel: STR.awJobCancel, tone: "danger" });
    if (!ok) return;
    const res = await cancel({ id: jobId });
    if (res.error) toast.show(friendlyError(res.error as never), "danger");
  }

  return (
    <Screen scroll>
      <Card>
        <Badge text={jobStatusLabel(j.status)} tone={j.status === "done" ? "ok" : j.status === "failed" ? "danger" : "info"} />
        <Muted>{`${kindLabel(j.kind)} · ${modelLabel(j.model)} · ${STR.awThinking}: ${j.thinking} · ${j.runAt === "offpeak" ? STR.awRunOffpeak : STR.awRunNow}`}</Muted>
        <Muted>{fill(STR.awJobProgress, { done: j.done, total: j.total, failed: j.failed, cost: usd(j.costUsd) })}</Muted>
        <Muted>{`${fill(STR.awJobPriceNow, { usd: usd(j.estimateNowUsd) })} · ${fill(STR.awJobPriceOffShort, { usd: usd(j.estimateOffpeakUsd) })}`}</Muted>
        {j.status === "queued" && j.runAt === "offpeak" ? <Notice tone="info" message={STR.awJobWaitsOffpeak} /> : null}
        {active ? <Button title={STR.awJobCancel} variant="danger" loading={cancelState.fetching} onPress={() => void onCancel()} /> : null}
      </Card>
      {j.items.map((it) => (
        <Card key={it.id}>
          <Body>{it.value}</Body>
          <Muted>{fill(STR.awJobItemMeta, { status: jobStatusLabel(it.status), fixes: it.fixes ? ` · ${it.fixes}×` : "", cost: it.costUsd ? ` · $${usd(it.costUsd)}` : "" })}</Muted>
          {it.error ? <Notice tone={it.status === "failed" ? "danger" : "info"} message={it.error} /> : null}
          {it.draftId ? <Button title={STR.awJobOpenDraft} variant="secondary" onPress={() => navigation.navigate("AiDraft", { draftId: it.draftId! })} /> : null}
        </Card>
      ))}
    </Screen>
  );
}
