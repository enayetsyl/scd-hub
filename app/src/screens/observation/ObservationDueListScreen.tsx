/**
 * ObservationDueListScreen (CO-6, observation:manage) — the ranked due-for-review list
 * (observationDueList) with tier + overdue badges, plus a config editor for the review
 * cadence (observationScheduleConfig / setObservationScheduleConfig). This is a SUGGESTION
 * only — there is no auto-assign; a manager taps a row to open the teacher's observations
 * via the detail flow if a lastObservationId is present. Every action is re-gated
 * server-side (the Bangla deny surfaces inline).
 */
import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  OBSERVATION_DUE_LIST_QUERY,
  OBSERVATION_SCHEDULE_CONFIG_QUERY,
  SET_OBSERVATION_SCHEDULE_CONFIG,
} from "../../graphql/observation";
import { TEACHERS_QUERY } from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Field, Row, Badge, Loader, Notice } from "../../components/ui";
import { STR, obsTierLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { ObservationStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ObservationStackParamList>;

export default function ObservationDueListScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const [dueQ] = useQuery({ query: OBSERVATION_DUE_LIST_QUERY, variables: {} });
  const due = dueQ.data?.observationDueList ?? null;
  const [teachersQ] = useQuery({ query: TEACHERS_QUERY });
  const nameById = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of teachersQ.data?.teachers ?? []) m[t.id] = t.name;
    return m;
  }, [teachersQ.data]);
  const [cfgQ, refetchCfg] = useQuery({ query: OBSERVATION_SCHEDULE_CONFIG_QUERY, variables: {} });
  const cfg = cfgQ.data?.observationScheduleConfig ?? null;

  const [, setCfg] = useMutation(SET_OBSERVATION_SCHEDULE_CONFIG);

  const [base, setBase] = useState("");
  const [strong, setStrong] = useState("");
  const [needs, setNeeds] = useState("");
  const [minInt, setMinInt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cfg) {
      setBase(String(cfg.baseIntervalDays));
      setStrong(String(cfg.strongMultiplier));
      setNeeds(String(cfg.needsSupportMultiplier));
      setMinInt(String(cfg.minIntervalDays));
    }
  }, [cfg]);

  async function onSaveConfig(): Promise<void> {
    setError(null);
    setOk(null);
    setBusy(true);
    const res = await setCfg({
      baseIntervalDays: Number(base),
      strongMultiplier: Number(strong),
      needsSupportMultiplier: Number(needs),
      minIntervalDays: Number(minInt),
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.obsConfigSaved);
    refetchCfg({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.obsScheduleConfig}</Body>
          {cfg?.isDefault ? <Muted>{STR.obsUsingDefaults}</Muted> : null}
          <Field label={STR.obsBaseInterval} value={base} onChangeText={setBase} keyboardType="number-pad" />
          <Field label={STR.obsStrongMult} value={strong} onChangeText={setStrong} keyboardType="decimal-pad" />
          <Field label={STR.obsNeedsSupportMult} value={needs} onChangeText={setNeeds} keyboardType="decimal-pad" />
          <Field label={STR.obsMinInterval} value={minInt} onChangeText={setMinInt} keyboardType="number-pad" />
          <Button title={STR.obsSaveConfig} onPress={onSaveConfig} loading={busy} disabled={busy} />
        </Card>

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.obsDueListTitle}</Body>
          <Muted>{STR.obsDueListNote}</Muted>
        </Card>

        {dueQ.fetching ? (
          <Loader label={STR.loading} />
        ) : dueQ.error ? (
          <Card>
            <Muted>{friendlyError(dueQ.error)}</Muted>
          </Card>
        ) : !due || due.items.length === 0 ? (
          <Card>
            <Muted>{STR.obsNoDue}</Muted>
          </Card>
        ) : (
          due.items.map((it) => (
            <Card
              key={it.teacherId}
              onPress={
                it.lastObservationId
                  ? () => nav.navigate("ObservationDetail", { observationId: it.lastObservationId as string })
                  : undefined
              }
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flexShrink: 1 }}>
                  <Body style={{ fontWeight: "700" }}>{nameById[it.teacherId] ?? it.teacherId}</Body>
                  <Muted>
                    {it.neverReviewed ? STR.obsNeverReviewed : `${STR.obsDueDate}: ${new Date(it.dueDate).toLocaleDateString()}`}
                  </Muted>
                </View>
                <View style={{ alignItems: "flex-end", gap: space(1) }}>
                  <Badge text={obsTierLabel(it.tier)} tone="info" />
                  {it.overdueDays > 0 ? (
                    <Badge text={`${STR.obsOverdueDays}: ${bnNum(it.overdueDays)}`} tone="danger" />
                  ) : null}
                </View>
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
