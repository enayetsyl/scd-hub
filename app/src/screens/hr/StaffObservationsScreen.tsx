/**
 * StaffObservationsScreen — a staff member's observations (prd-hr §5.1, H5.1).
 * Read `staffObservations` + submit a new one (`submitObservation`). Managers
 * (performance:manage) reach this; the server also allows supervisors within their
 * extent, but the staff picker that lands here is manager-gated.
 */
import React from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { STAFF_OBSERVATIONS_QUERY, SUBMIT_OBSERVATION, SUBJECTS_QUERY } from "../../graphql/operations";
import type { HrStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Field,
  Select,
  Button,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
} from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "StaffObservations">;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function StaffObservationsScreen({ route }: Props): React.ReactElement {
  const { staffProfileId } = route.params;
  const [dateKey, setDateKey] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [subjectId, setSubjectId] = React.useState<string | null>(null);
  const [followUp, setFollowUp] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const [obsQ, refetch] = useQuery({ query: STAFF_OBSERVATIONS_QUERY, variables: { staffProfileId } });
  const [subjectsQ] = useQuery({ query: SUBJECTS_QUERY });
  const [, submit] = useMutation(SUBMIT_OBSERVATION);

  const observations = obsQ.data?.staffObservations ?? [];
  const subjectName = new Map((subjectsQ.data?.subjects ?? []).map((s) => [s.id, s.nameBn]));

  const valid = ISO_DATE.test(dateKey) && notes.trim() !== "";

  async function runSubmit(): Promise<void> {
    if (!valid) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await submit({
      staffProfileId,
      dateKey,
      notes: notes.trim(),
      subjectId: subjectId ?? undefined,
      followUp: followUp.trim() === "" ? undefined : followUp.trim(),
    });
    setBusy(false);
    if (res.error || !res.data?.submitObservation) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.hrObsAdded);
    setDateKey("");
    setNotes("");
    setSubjectId(null);
    setFollowUp("");
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <H2>{STR.hrObservations}</H2>
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.hrAddObservation}</Body>
      <Card>
        <Field label={STR.hrObsDate} value={dateKey} onChangeText={setDateKey} placeholder="2026-06-15" helper={STR.hrDateHint} />
        <Select
          label={STR.hrObsSubject}
          value={subjectId}
          options={(subjectsQ.data?.subjects ?? []).map((s) => ({ label: s.nameBn, value: s.id }))}
          onChange={setSubjectId}
          placeholder={STR.hrObsSubject}
        />
        <Field label={STR.hrObsNotes} value={notes} onChangeText={setNotes} placeholder={STR.hrObsNotesPlaceholder} multiline autoCapitalize="sentences" />
        <Field label={STR.hrObsFollowUp} value={followUp} onChangeText={setFollowUp} autoCapitalize="sentences" />
        <Button title={STR.hrObsSubmit} onPress={runSubmit} loading={busy} disabled={busy || !valid} />
      </Card>

      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrObservations}</Body>
      {obsQ.fetching ? (
        <Loader label={STR.loading} />
      ) : obsQ.error ? (
        <ErrorBanner message={friendlyError(obsQ.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : observations.length === 0 ? (
        <EmptyState message={STR.empty} />
      ) : (
        observations.map((o) => (
          <Card key={o.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700", flex: 1 }}>{o.subjectId ? subjectName.get(o.subjectId) ?? STR.hrObservations : STR.hrObservations}</Body>
              <Muted>{bnNum(o.dateKey)}</Muted>
            </View>
            <Muted>{o.notes}</Muted>
            {o.followUp ? <Muted>{STR.hrFollowUp}: {o.followUp}</Muted> : null}
          </Card>
        ))
      )}
    </Screen>
  );
}
