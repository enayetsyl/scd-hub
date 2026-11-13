/**
 * Step 2 of the year change - Cut-over (YC-5, docs/prd-year-change.md section 3).
 *
 * Shows the dry run of the prepared run (refusals in red) and applies it behind a TYPED
 * confirmation of the new year ("২০২৭"). The engine re-checks everything on the server.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useClient, useMutation } from "urql";
import {
  APPLY_YEAR_CHANGE_CUTOVER,
  YEAR_CHANGE_CUTOVER_PLAN_QUERY,
  type YcCutoverPlanT,
  type YcRunT,
} from "../../../graphql/yearChange";
import { Body, Button, Card, Field, H2, Loader, Muted, Notice } from "../../../components/ui";
import { STR, bnNum } from "../../../lib/labels";
import { friendlyError } from "../../../lib/errors";
import { confirmMatchesYear } from "../../../lib/yearHandling";
import { useConfirm } from "../../../state/ConfirmContext";
import { space } from "../../../theme/tokens";

/** Make the Principal's own app re-read the years and classes after the flip. */
const REFRESH = { additionalTypenames: ["AcademicYear", "Class", "Section"] };

export default function CutoverStep({ run, canCutOver, onChanged }: { run: YcRunT; canCutOver: boolean; onChanged: () => void }): React.ReactElement {
  const client = useClient();
  const { confirmAction } = useConfirm();
  const [, apply] = useMutation(APPLY_YEAR_CHANGE_CUTOVER);
  const [plan, setPlan] = useState<YcCutoverPlanT | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const [full, setFull] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setErr(null);
    const res = await client.query(YEAR_CHANGE_CUTOVER_PLAN_QUERY, { runId: run.runId }, { requestPolicy: "network-only" }).toPromise();
    setLoading(false);
    if (res.error || !res.data) {
      setErr(friendlyError(res.error));
      return;
    }
    setPlan(res.data.yearChangeCutoverPlan);
  }, [client, run.runId]);

  useEffect(() => {
    setPlan(null);
    setTyped("");
    void load();
  }, [load]);

  const done = run.status === "CUT_OVER";
  const typedOk = confirmMatchesYear(typed, run.toLabel);

  async function onApply(): Promise<void> {
    if (!plan || busy || !typedOk) return;
    const ok = await confirmAction({
      title: STR.ycCutConfirmTitle,
      message: `${STR.ycCutConfirmMsg} ${run.toLabel}`,
      confirmLabel: STR.ycCutApply,
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setErr(null);
    const res = await apply({ runId: run.runId }, REFRESH);
    setBusy(false);
    if (res.error || !res.data) {
      setErr(friendlyError(res.error));
      return;
    }
    const bad = res.data.applyYearChangeCutover.invariantAfter;
    setMsg(bad.length ? `${STR.ycCutDone} ${STR.ycInvariantAfter}: ${bad.join("; ")}` : STR.ycCutDone);
    setTyped("");
    onChanged();
    void load();
  }

  return (
    <View style={{ gap: space(3) }}>
      <Notice message={STR.ycCutHint} tone="info" />
      {done ? <Notice message={STR.ycCutAlready} tone="ok" /> : null}
      {err ? <Notice message={err} tone="danger" /> : null}
      {msg ? <Notice message={msg} tone="ok" /> : null}
      <H2>{`${run.fromLabel} → ${run.toLabel}`}</H2>
      <Button title={STR.ycDryRun} variant="secondary" onPress={load} loading={loading} />
      {loading && !plan ? <Loader label={STR.loading} /> : null}
      {plan ? (
        <>
          <Muted>{`${STR.ycStarts} ${plan.startKey} · ${STR.ycOldEnds} ${plan.closeKey}`}</Muted>
          {plan.refusals.map((r, i) => (
            <Notice key={i} message={r} tone="danger" />
          ))}
          {plan.refusals.length === 0 && !done ? <Notice message={STR.ycNoBlock} tone="ok" /> : null}
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.ycTotals}</Body>
            <Muted>{`${STR.ycPromote} ${bnNum(plan.promoted)} · ${STR.ycRepeat} ${bnNum(plan.repeated)} · ${STR.ycLeft} ${bnNum(plan.left)} · ${STR.ycAdmitted} ${bnNum(plan.admitted)}`}</Muted>
            <Muted>{`${STR.ycActivating} ${bnNum(plan.activating)} · ${STR.ycStudentsChanged} ${bnNum(plan.studentsChanged)} · ${STR.ycScholarshipCleared} ${bnNum(plan.scholarshipCleared)}`}</Muted>
            <Muted>{`${STR.ycImprovementEnds} ${bnNum(plan.improvementToEnd)}`}</Muted>
          </Card>
          {plan.copyLines.map((l, i) => (
            <Muted key={i}>{l}</Muted>
          ))}
          <Button title={full ? STR.ycHideDetail : STR.ycShowDetail} variant="ghost" onPress={() => setFull((v) => !v)} />
          {full ? (
            <Card>
              <Body>{plan.printText}</Body>
            </Card>
          ) : null}
          {canCutOver && !done ? (
            <>
              <Field label={`${STR.ycTypeToConfirm} ${run.toLabel}`} value={typed} onChangeText={setTyped} />
              <Button
                title={STR.ycCutApply}
                variant="danger"
                onPress={onApply}
                loading={busy}
                disabled={!typedOk || plan.refusals.length > 0 || busy}
              />
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
