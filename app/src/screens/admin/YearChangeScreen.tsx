/**
 * YearChangeScreen "শিক্ষাবর্ষ পরিবর্তন" (YC-5, docs/prd-year-change.md section 3 + 5) - the
 * Principal's year-change screen. Three steps - Prepare, Cut-over, Undo - and the history of
 * runs. Gated `year_change:view`; each button needs its own `year_change:*` right, and the server
 * re-gates every call. Each step shows a dry run before anything is written.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { YEAR_CHANGE_RUNS_QUERY, type YcRunT } from "../../graphql/yearChange";
import type { AdminStackParamList } from "../../navigation/types";
import { Badge, Body, Card, Chip, ChipRow, Divider, EmptyState, ErrorBanner, H2, Muted, Notice, Screen } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme/tokens";
import PrepareStep from "./yearChange/PrepareStep";
import CutoverStep from "./yearChange/CutoverStep";
import UndoStep from "./yearChange/UndoStep";

type Props = NativeStackScreenProps<AdminStackParamList, "YearChange">;
type Step = 1 | 2 | 3;

const statusLabel = (s: string): string =>
  s === "PREPARED" ? STR.ycStPrepared : s === "CUTTING_OVER" ? STR.ycStCutting : s === "CUT_OVER" ? STR.ycStCutOver : s;
const statusTone = (s: string): "info" | "warn" | "ok" => (s === "PREPARED" ? "info" : s === "CUTTING_OVER" ? "warn" : "ok");

export default function YearChangeScreen(_props: Props): React.ReactElement {
  const { can } = useAuth();
  const [{ data, error }, refetch] = useQuery({ query: YEAR_CHANGE_RUNS_QUERY, requestPolicy: "network-only" });
  const [step, setStep] = useState<Step>(1);
  const [pickedRun, setPickedRun] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );

  const runs = data?.yearChangeRuns ?? [];
  // The run the steps work on: the one picked from the history, else the newest unfinished one, else the newest.
  const run: YcRunT | null = runs.find((r) => r.runId === pickedRun) ?? runs.find((r) => r.status !== "CUT_OVER") ?? runs[0] ?? null;
  const runId = run?.runId ?? null;

  // The first time the list arrives with a prepared run, open on the cut-over step.
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    if (landed || !data) return;
    setLanded(true);
    if (runs.some((r) => r.status === "PREPARED")) setStep(2);
  }, [data, landed, runs]);

  const reload = (): void => refetch({ requestPolicy: "network-only" });

  return (
    <Screen scroll>
      <H2>{STR.ycTitle}</H2>
      <Notice message={STR.ycIntro} tone="info" />
      {error ? <ErrorBanner message={friendlyError(error)} onRetry={reload} /> : null}

      <ChipRow>
        <Chip label={STR.ycStep1} selected={step === 1} onPress={() => setStep(1)} />
        <Chip label={STR.ycStep2} selected={step === 2} onPress={() => setStep(2)} />
        <Chip label={STR.ycStep3} selected={step === 3} onPress={() => setStep(3)} />
      </ChipRow>

      <View style={{ marginTop: space(2) }}>
        {step === 1 ? (
          <PrepareStep
            canPrepare={can("year_change:prepare")}
            onPrepared={(id) => {
              setPickedRun(id);
              reload();
              setStep(2);
            }}
          />
        ) : !run ? (
          <EmptyState message={STR.ycNoRun} />
        ) : step === 2 ? (
          <CutoverStep key={runId} run={run} canCutOver={can("year_change:cut_over")} onChanged={reload} />
        ) : (
          <UndoStep key={`${runId}:${run.status}`} run={run} canUndo={can("year_change:undo")} onChanged={reload} />
        )}
      </View>

      <Divider />
      <H2>{STR.ycHistory}</H2>
      {runs.length === 0 ? (
        <Muted>{STR.ycNoRun}</Muted>
      ) : (
        runs.map((r) => (
          <Card key={r.runId} onPress={() => setPickedRun(r.runId)}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
              <Body style={{ fontWeight: "700" }}>{`${r.fromLabel} → ${r.toLabel}`}</Body>
              <Badge text={statusLabel(r.status)} tone={statusTone(r.status)} />
            </View>
            <Muted>{`${r.runId}${r.runId === runId ? ` · ${STR.ycSelected}` : ""}`}</Muted>
            <Muted>{r.cutOverAt ? `${STR.ycCutOverAt}: ${r.cutOverAt.slice(0, 10)}` : `${STR.ycPreparedAt}: ${r.createdAt.slice(0, 10)}`}</Muted>
          </Card>
        ))
      )}
    </Screen>
  );
}
