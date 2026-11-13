/**
 * Step 3 of the year change - Undo (YC-5, docs/prd-year-change.md section 3).
 *
 * "প্রস্তুতি বাতিল" (before the cut-over) / "পরিবর্তন ফিরিয়ে নিন" (after). Each shows its dry run
 * FIRST; the apply button opens only after that dry run came back with nothing blocking.
 */
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useClient, useMutation } from "urql";
import { UNDO_YEAR_CHANGE, YEAR_CHANGE_UNDO_PLAN_QUERY, type UndoKindT, type YcRunT, type YcUndoPlanT } from "../../../graphql/yearChange";
import { Body, Button, Card, H2, Loader, Muted, Notice } from "../../../components/ui";
import { STR } from "../../../lib/labels";
import { friendlyError } from "../../../lib/errors";
import { useConfirm } from "../../../state/ConfirmContext";
import { space } from "../../../theme/tokens";

/** Make the Principal's own app re-read the years and classes after the flip. */
const REFRESH = { additionalTypenames: ["AcademicYear", "Class", "Section"] };

export default function UndoStep({ run, canUndo, onChanged }: { run: YcRunT; canUndo: boolean; onChanged: () => void }): React.ReactElement {
  const client = useClient();
  const { confirmAction } = useConfirm();
  const [, undo] = useMutation(UNDO_YEAR_CHANGE);
  const kind: UndoKindT = run.status === "PREPARED" ? "PREPARE" : "CUTOVER";
  const [plan, setPlan] = useState<YcUndoPlanT | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setPlan(null);
    setMsg(null);
  }, [run.runId, kind]);

  async function dryRun(): Promise<void> {
    setLoading(true);
    setErr(null);
    const res = await client.query(YEAR_CHANGE_UNDO_PLAN_QUERY, { runId: run.runId, kind }, { requestPolicy: "network-only" }).toPromise();
    setLoading(false);
    if (res.error || !res.data) {
      setErr(friendlyError(res.error));
      return;
    }
    setPlan(res.data.yearChangeUndoPlan);
  }

  async function onApply(): Promise<void> {
    if (!plan || busy) return;
    const ok = await confirmAction({
      title: kind === "PREPARE" ? STR.ycUndoPrepareTitle : STR.ycUndoCutTitle,
      message: kind === "PREPARE" ? STR.ycUndoPrepareMsg : STR.ycUndoCutMsg,
      confirmLabel: kind === "PREPARE" ? STR.ycUndoPrepare : STR.ycUndoCut,
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setErr(null);
    const res = await undo({ runId: run.runId, kind }, REFRESH);
    setBusy(false);
    if (res.error || !res.data) {
      setErr(friendlyError(res.error));
      return;
    }
    setMsg(STR.ycUndone);
    setPlan(null);
    onChanged();
  }

  return (
    <View style={{ gap: space(3) }}>
      <Notice message={kind === "PREPARE" ? STR.ycUndoPrepareHint : STR.ycUndoCutHint} tone="info" />
      {err ? <Notice message={err} tone="danger" /> : null}
      {msg ? <Notice message={msg} tone="ok" /> : null}
      <H2>{kind === "PREPARE" ? STR.ycUndoPrepare : STR.ycUndoCut}</H2>
      <Muted>{`${run.fromLabel} → ${run.toLabel}`}</Muted>
      <Button title={STR.ycDryRun} variant="secondary" onPress={dryRun} loading={loading} />
      {loading && !plan ? <Loader label={STR.loading} /> : null}
      {plan ? (
        <>
          {kind === "CUTOVER" && plan.createdAfter.length > 0 ? <Notice message={STR.ycCreatedBlocked} tone="danger" /> : null}
          {plan.refusals.map((r, i) => (
            <Notice key={i} message={r} tone="danger" />
          ))}
          {plan.notes.map((n, i) => (
            <Notice key={`n${i}`} message={n} tone="warn" />
          ))}
          {plan.changedAfter.length ? <Notice message={`${STR.ycChangedAfter}: ${plan.changedAfter.join(", ")}`} tone="warn" /> : null}
          {plan.createdAfter.length ? <Notice message={`${STR.ycCreatedAfter}: ${plan.createdAfter.join(", ")}`} tone="warn" /> : null}
          <Card>
            <Body>{plan.printText}</Body>
          </Card>
          {canUndo ? (
            <Button
              title={kind === "PREPARE" ? STR.ycUndoPrepare : STR.ycUndoCut}
              variant="danger"
              onPress={onApply}
              loading={busy}
              disabled={plan.refusals.length > 0 || busy || (kind === "CUTOVER" && plan.createdAfter.length > 0)}
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
}
