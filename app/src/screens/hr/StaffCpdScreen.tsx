/**
 * StaffCpdScreen — a staff member's CPD development log (prd-hr §5.3, H5.4).
 * performance:manage reads + adds entries; appraisal sign-off also emits dev needs
 * here server-side (sourceAppraisalId set on those).
 */
import React from "react";
import { useQuery, useMutation } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { STAFF_DEVELOPMENT_LOG_QUERY, ADD_DEVELOPMENT_LOG } from "../../graphql/operations";
import type { HrStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Field,
  Button,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
} from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "StaffCpd">;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function StaffCpdScreen({ route }: Props): React.ReactElement {
  const { staffProfileId } = route.params;
  const [activity, setActivity] = React.useState("");
  const [dateKey, setDateKey] = React.useState("");
  const [outcome, setOutcome] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const [cpdQ, refetch] = useQuery({ query: STAFF_DEVELOPMENT_LOG_QUERY, variables: { staffProfileId } });
  const [, add] = useMutation(ADD_DEVELOPMENT_LOG);
  const cpd = cpdQ.data?.staffDevelopmentLog ?? [];

  const valid = activity.trim() !== "" && (dateKey === "" || ISO_DATE.test(dateKey));

  async function runAdd(): Promise<void> {
    if (!valid) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await add({
      staffProfileId,
      activity: activity.trim(),
      dateKey: dateKey === "" ? undefined : dateKey,
      outcome: outcome.trim() === "" ? undefined : outcome.trim(),
    });
    setBusy(false);
    if (res.error || !res.data?.addDevelopmentLog) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.hrCpdAdded);
    setActivity("");
    setDateKey("");
    setOutcome("");
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <H2>{STR.hrCpd}</H2>
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.hrAddCpd}</Body>
      <Card>
        <Field label={STR.hrCpdActivity} value={activity} onChangeText={setActivity} multiline autoCapitalize="sentences" />
        <DateField label={STR.hrCpdDate} value={dateKey} onChange={setDateKey} helper={STR.hrDateHint} />
        <Field label={STR.hrCpdOutcome} value={outcome} onChangeText={setOutcome} autoCapitalize="sentences" />
        <Button title={STR.hrObsSubmit} onPress={runAdd} loading={busy} disabled={busy || !valid} />
      </Card>

      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrCpd}</Body>
      {cpdQ.fetching ? (
        <Loader label={STR.loading} />
      ) : cpdQ.error ? (
        <ErrorBanner message={friendlyError(cpdQ.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : cpd.length === 0 ? (
        <EmptyState message={STR.empty} />
      ) : (
        cpd.map((d) => (
          <Card key={d.id}>
            <Body style={{ fontWeight: "700" }}>{d.activity}</Body>
            <Muted>{bnNum(d.dateKey)}</Muted>
            {d.outcome ? <Muted>{STR.hrCpdOutcome}: {d.outcome}</Muted> : null}
          </Card>
        ))
      )}
    </Screen>
  );
}
