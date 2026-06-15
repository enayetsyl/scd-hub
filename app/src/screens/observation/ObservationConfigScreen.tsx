/**
 * ObservationConfigScreen (CO-3, observation:manage) — the teacher-response escalation
 * cadence (CALENDAR days since release): 1st reminder / 2nd reminder / Principal flag
 * (observationEscalationConfig / setObservationEscalationConfig). The days must be
 * strictly increasing; the server validates (the Bangla deny surfaces inline).
 */
import React, { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { useQuery, useMutation } from "urql";
import {
  OBSERVATION_ESCALATION_CONFIG_QUERY,
  SET_OBSERVATION_ESCALATION_CONFIG,
} from "../../graphql/observation";
import { Screen, Card, Body, Muted, Button, Field, Notice } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

export default function ObservationConfigScreen(): React.ReactElement {
  const [cfgQ, refetch] = useQuery({ query: OBSERVATION_ESCALATION_CONFIG_QUERY, variables: {} });
  const cfg = cfgQ.data?.observationEscalationConfig ?? null;
  const [, setCfg] = useMutation(SET_OBSERVATION_ESCALATION_CONFIG);

  const [r1, setR1] = useState("");
  const [r2, setR2] = useState("");
  const [flag, setFlag] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cfg) {
      setR1(String(cfg.reminderDays1));
      setR2(String(cfg.reminderDays2));
      setFlag(String(cfg.principalFlagDays));
    }
  }, [cfg]);

  async function onSave(): Promise<void> {
    setError(null);
    setOk(null);
    setBusy(true);
    const res = await setCfg({
      reminderDays1: Number(r1),
      reminderDays2: Number(r2),
      principalFlagDays: Number(flag),
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.obsConfigSaved);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.obsEscalationTitle}</Body>
          {cfg?.isDefault ? <Muted>{STR.obsUsingDefaults}</Muted> : null}
          <Field label={STR.obsReminder1} value={r1} onChangeText={setR1} keyboardType="number-pad" />
          <Field label={STR.obsReminder2} value={r2} onChangeText={setR2} keyboardType="number-pad" />
          <Field label={STR.obsPrincipalFlag} value={flag} onChangeText={setFlag} keyboardType="number-pad" />
          <Button title={STR.obsSaveConfig} onPress={onSave} loading={busy} disabled={busy} />
        </Card>
      </ScrollView>
    </Screen>
  );
}
