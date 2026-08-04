/**
 * StaffAppraisalsScreen — annual appraisals (prd-hr §5.1, H5.2). performance:manage
 * prepares a DRAFT (goals + development needs); **sign-off is PRINCIPAL-only
 * (performance:signoff)** — the outcome form shows only with that permission, and
 * sign-off emits the development needs into the CPD log server-side.
 */
import React from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import { APPRAISAL_OUTCOMES } from "@scd/shared";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { STAFF_APPRAISALS_QUERY, UPSERT_APPRAISAL, SIGN_OFF_APPRAISAL } from "../../graphql/operations";
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
  Badge,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
} from "../../components/ui";
import { AcademicYearSelect } from "../../components/selects";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum, appraisalStatusLabel, appraisalOutcomeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "StaffAppraisals">;

const linesToList = (s: string): string[] => s.split("\n").map((l) => l.trim()).filter((l) => l !== "");

export default function StaffAppraisalsScreen({ route }: Props): React.ReactElement {
  const { staffProfileId } = route.params;
  const { role, can } = useAuth();
  const canSignoff = can("performance:signoff");

  const [yearId, setYearId] = React.useState("");
  const [goals, setGoals] = React.useState("");
  const [devNeeds, setDevNeeds] = React.useState("");
  const [outcomes, setOutcomes] = React.useState<Record<string, string>>({});
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const [apprQ, refetch] = useQuery({ query: STAFF_APPRAISALS_QUERY, variables: { staffProfileId } });
  const [, upsert] = useMutation(UPSERT_APPRAISAL);
  const [, signOff] = useMutation(SIGN_OFF_APPRAISAL);

  const appraisals = apprQ.data?.staffAppraisals ?? [];

  async function runPrepare(): Promise<void> {
    if (yearId === "") return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await upsert({
      staffProfileId,
      academicYearId: yearId,
      goals: linesToList(goals),
      developmentNeeds: linesToList(devNeeds),
    });
    setBusy(false);
    if (res.error || !res.data?.upsertAppraisal) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.hrAppraisalSaved);
    setGoals("");
    setDevNeeds("");
    refetch({ requestPolicy: "network-only" });
  }

  async function runSignOff(appraisalId: string): Promise<void> {
    const outcome = outcomes[appraisalId];
    if (!outcome) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await signOff({ appraisalId, outcome, outcomeNote: notes[appraisalId]?.trim() || undefined });
    setBusy(false);
    if (res.error || !res.data?.signOffAppraisal) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.hrSignedOff);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <H2>{STR.hrAppraisals}</H2>
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.hrPrepareAppraisal}</Body>
      <Card>
        <AcademicYearSelect label={STR.hrYear} value={yearId} onChange={setYearId} />
        <Field label={STR.hrGoals} value={goals} onChangeText={setGoals} multiline autoCapitalize="sentences" />
        <Field label={STR.hrDevNeeds} value={devNeeds} onChangeText={setDevNeeds} multiline autoCapitalize="sentences" />
        <Button title={STR.hrAppraisalSave} onPress={runPrepare} loading={busy} disabled={busy || yearId === ""} />
      </Card>

      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrAppraisals}</Body>
      {apprQ.fetching ? (
        <Loader label={STR.loading} />
      ) : apprQ.error ? (
        <ErrorBanner message={friendlyError(apprQ.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : appraisals.length === 0 ? (
        <EmptyState message={STR.empty} />
      ) : (
        appraisals.map((a) => (
          <Card key={a.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>{bnNum(a.createdAt.slice(0, 4))}</Body>
              <Badge text={appraisalStatusLabel(a.status)} tone={a.status === "signed_off" ? "ok" : "info"} />
            </View>
            {a.goals.length > 0 ? <Muted>{STR.hrAppraisalGoals}: {a.goals.join("; ")}</Muted> : null}
            {a.developmentNeeds.length > 0 ? <Muted>{STR.hrAppraisalDevNeeds}: {a.developmentNeeds.join("; ")}</Muted> : null}
            {a.overallOutcome ? <Row label={STR.hrAppraisalOutcome} value={appraisalOutcomeLabel(a.overallOutcome)} /> : null}
            {a.outcomeNote ? <Muted>“{a.outcomeNote}”</Muted> : null}

            {a.status === "draft" ? (
              <>
                <Divider />
                {canSignoff ? (
                  <>
                    <Select
                      label={STR.hrSignOffOutcome}
                      value={outcomes[a.id] ?? null}
                      options={APPRAISAL_OUTCOMES.map((o) => ({ label: appraisalOutcomeLabel(o), value: o }))}
                      onChange={(v) => setOutcomes((p) => ({ ...p, [a.id]: v }))}
                      placeholder={STR.hrSignOffOutcome}
                    />
                    <Field
                      label={STR.hrSignOffNote}
                      value={notes[a.id] ?? ""}
                      onChangeText={(v) => setNotes((p) => ({ ...p, [a.id]: v }))}
                      autoCapitalize="sentences"
                    />
                    <Button title={STR.hrSignOff} onPress={() => runSignOff(a.id)} loading={busy} disabled={busy || !outcomes[a.id]} />
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
