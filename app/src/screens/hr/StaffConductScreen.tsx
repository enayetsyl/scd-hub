/**
 * StaffConductScreen — the disciplinary conduct ladder (prd-hr §5.2, D-#113).
 * performance:manage records a DRAFT step (the server enforces ladder order, no
 * rung-skip; gross misconduct fast-tracks) and captures the hearing; **finalize is
 * PRINCIPAL-only (performance:signoff)** and requires a recorded hearing first
 * ('adl). A termination step writes employmentStatus → terminated (offboarding
 * trigger). Confidential — Principal/Office only (H5.5).
 */
import React from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import { CONDUCT_STAGES } from "@scd/shared";
import { roleHasPermission } from "@scd/shared";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  STAFF_CONDUCT_RECORDS_QUERY,
  RECORD_CONDUCT_STEP,
  RECORD_CONDUCT_HEARING,
  FINALIZE_CONDUCT_STEP,
} from "../../graphql/operations";
import type { HrStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Row,
  Divider,
  Field,
  Select,
  Button,
  Chip,
  Badge,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
} from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum, conductStageLabel, conductRecordStatusLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "StaffConduct">;

function statusTone(s: string): "info" | "ok" | "muted" | "danger" {
  return s === "finalized" ? "danger" : s === "hearing_held" ? "info" : s === "lapsed" ? "muted" : "info";
}

export default function StaffConductScreen({ route }: Props): React.ReactElement {
  const { staffProfileId } = route.params;
  const { confirmAction } = useConfirm();
  const { role } = useAuth();
  const canFinalize = !!role && roleHasPermission(role, "performance:signoff");

  // New-step form
  const [stage, setStage] = React.useState<string | null>(null);
  const [issue, setIssue] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [evidence, setEvidence] = React.useState("");
  const [gross, setGross] = React.useState(false);
  // Per-record hearing/finalize inputs
  const [hearing, setHearing] = React.useState<Record<string, string>>({});
  const [liveUntil, setLiveUntil] = React.useState<Record<string, string>>({});
  const [outcome, setOutcome] = React.useState<Record<string, string>>({});

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const [condQ, refetch] = useQuery({ query: STAFF_CONDUCT_RECORDS_QUERY, variables: { staffProfileId } });
  const [, record] = useMutation(RECORD_CONDUCT_STEP);
  const [, recordHearing] = useMutation(RECORD_CONDUCT_HEARING);
  const [, finalize] = useMutation(FINALIZE_CONDUCT_STEP);

  const records = condQ.data?.staffConductRecords ?? [];

  function reset(): void {
    setError(null);
    setOk(null);
  }

  async function runRecord(): Promise<void> {
    if (!stage || issue.trim() === "") return;
    setBusy(true);
    reset();
    const res = await record({
      staffProfileId,
      stage,
      issue: issue.trim(),
      category: category.trim() === "" ? undefined : category.trim(),
      evidence: evidence.trim() === "" ? undefined : evidence.trim(),
      grossMisconduct: gross,
    });
    setBusy(false);
    if (res.error || !res.data?.recordConductStep) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.hrConductRecorded);
    setStage(null);
    setIssue("");
    setCategory("");
    setEvidence("");
    setGross(false);
    refetch({ requestPolicy: "network-only" });
  }

  async function runHearing(recordId: string): Promise<void> {
    const note = hearing[recordId];
    if (!note || note.trim() === "") return;
    setBusy(true);
    reset();
    const res = await recordHearing({ recordId, hearingNote: note.trim() });
    setBusy(false);
    if (res.error || !res.data?.recordConductHearing) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.hrHearingRecorded);
    refetch({ requestPolicy: "network-only" });
  }

  async function runFinalize(recordId: string): Promise<void> {
    if (!(await confirmAction({ confirmLabel: STR.hrFinalize }))) return;
    setBusy(true);
    reset();
    const res = await finalize({
      recordId,
      liveUntilKey: liveUntil[recordId]?.trim() || undefined,
      outcome: outcome[recordId]?.trim() || undefined,
    });
    setBusy(false);
    if (res.error || !res.data?.finalizeConductStep) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.hrFinalized);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <H2>{STR.hrConduct}</H2>
      <Muted>{STR.hrConductConfidential}</Muted>
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      {/* Record a new step */}
      <Body style={{ fontWeight: "700", marginTop: space(3), marginBottom: space(2) }}>{STR.hrRecordConduct}</Body>
      <Card>
        <Select
          label={STR.hrConductStage}
          value={stage}
          options={CONDUCT_STAGES.map((s) => ({ label: conductStageLabel(s), value: s }))}
          onChange={setStage}
          placeholder={STR.hrConductStage}
        />
        <Field label={STR.hrConductIssue} value={issue} onChangeText={setIssue} placeholder={STR.hrConductIssuePlaceholder} multiline autoCapitalize="sentences" />
        <Field label={STR.hrConductCategory} value={category} onChangeText={setCategory} autoCapitalize="sentences" />
        <Field label={STR.hrConductEvidence} value={evidence} onChangeText={setEvidence} autoCapitalize="sentences" />
        <View style={{ marginBottom: space(3) }}>
          <Chip label={`${gross ? "☑" : "☐"} ${STR.hrConductGross}`} selected={gross} onPress={() => setGross((g) => !g)} />
        </View>
        <Button title={STR.hrObsSubmit} onPress={runRecord} loading={busy} disabled={busy || !stage || issue.trim() === ""} />
      </Card>

      {/* Ladder */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrConduct}</Body>
      {condQ.fetching ? (
        <Loader label={STR.loading} />
      ) : condQ.error ? (
        <ErrorBanner message={friendlyError(condQ.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : records.length === 0 ? (
        <EmptyState message={STR.empty} />
      ) : (
        records.map((c) => (
          <Card key={c.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>{conductStageLabel(c.stage)}{c.grossMisconduct ? " ⚠" : ""}</Body>
              <Badge text={conductRecordStatusLabel(c.status)} tone={statusTone(c.status)} />
            </View>
            <Row label={STR.hrConductIssue} value={c.issue} />
            {c.hearingNote ? <Muted>{STR.hrConductHearing}: {c.hearingNote}</Muted> : null}
            {c.outcome ? <Muted>{STR.hrConductOutcome}: {c.outcome}</Muted> : null}
            {c.liveUntil ? <Muted>{STR.hrFinalizeLiveUntil}: {bnNum(c.liveUntil.slice(0, 10))}</Muted> : null}

            {/* Record hearing (draft) */}
            {c.status === "draft" ? (
              <>
                <Divider />
                <Field
                  label={STR.hrHearingNote}
                  value={hearing[c.id] ?? ""}
                  onChangeText={(v) => setHearing((p) => ({ ...p, [c.id]: v }))}
                  multiline
                  autoCapitalize="sentences"
                />
                <Button title={STR.hrRecordHearing} variant="secondary" onPress={() => runHearing(c.id)} disabled={busy || !hearing[c.id]} />
              </>
            ) : null}

            {/* Finalize (hearing_held, Principal only) */}
            {c.status === "hearing_held" ? (
              <>
                <Divider />
                {canFinalize ? (
                  <>
                    <Field
                      label={STR.hrFinalizeLiveUntil}
                      value={liveUntil[c.id] ?? ""}
                      onChangeText={(v) => setLiveUntil((p) => ({ ...p, [c.id]: v }))}
                      placeholder="2026-12-31"
                      helper={STR.hrDateHint}
                    />
                    <Field
                      label={STR.hrFinalizeOutcome}
                      value={outcome[c.id] ?? ""}
                      onChangeText={(v) => setOutcome((p) => ({ ...p, [c.id]: v }))}
                      autoCapitalize="sentences"
                    />
                    <Button title={STR.hrFinalize} variant="danger" onPress={() => runFinalize(c.id)} disabled={busy} />
                  </>
                ) : (
                  <Notice message={STR.hrSignoffOnly} tone="info" />
                )}
              </>
            ) : null}
          </Card>
        ))
      )}
    </Screen>
  );
}
