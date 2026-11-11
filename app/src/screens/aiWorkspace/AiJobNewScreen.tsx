/**
 * AiJobNewScreen (AI Workspace W-4, docs/prd-ai-workspace.md §6) — a template with {{item}},
 * the items (one per line), the draft kind, model and thinking; "see the cost" shows BOTH
 * prices (now / off-peak), and the run time must be picked — no default (D-#1209).
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useClient, useMutation } from "urql";
import { AI_JOB_ESTIMATE, CREATE_AI_JOB, type AiJobEstimateT } from "../../graphql/aiWorkspaceJobs";
import type { AiWorkspaceStackParamList } from "../../navigation/types";
import { Screen, Card, Button, Field, Select, ErrorBanner, Muted, Notice } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { fill, isClaudeModel, kTokens, MODEL_OPTIONS, THINKING_OPTIONS, usd } from "./aiWorkspaceUi";
import { DRAFT_KINDS, kindLabel } from "./draftUi";
import { dhakaTime } from "./AiProjectChatScreen";

type Props = NativeStackScreenProps<AiWorkspaceStackParamList, "AiJobNew">;

export default function AiJobNewScreen({ route, navigation }: Props): React.ReactElement {
  const { projectId } = route.params;
  const client = useClient();
  const [, create] = useMutation(CREATE_AI_JOB);
  const [title, setTitle] = React.useState("");
  const [template, setTemplate] = React.useState("{{item}}");
  const [itemsText, setItemsText] = React.useState("");
  const [kind, setKind] = React.useState("free");
  const [model, setModel] = React.useState("deepseek-flash");
  const [thinking, setThinking] = React.useState("high");
  const [runAt, setRunAt] = React.useState<string | null>(null);
  const [estimate, setEstimate] = React.useState<AiJobEstimateT | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const items = itemsText.split("\n").map((s) => s.trim()).filter(Boolean);
  const vars = { projectId, title, kind, template, items, model, thinking };

  // Any change after an estimate makes it stale.
  React.useEffect(() => setEstimate(null), [title, kind, template, itemsText, model, thinking]);

  async function onEstimate(): Promise<void> {
    setBusy("estimate");
    setError(null);
    const res = await client.query(AI_JOB_ESTIMATE, vars, { requestPolicy: "network-only" }).toPromise();
    setBusy(null);
    if (res.error || !res.data) return setError(friendlyError(res.error as never));
    setEstimate(res.data.aiJobEstimate);
  }

  async function onStart(): Promise<void> {
    if (!runAt) return;
    setBusy("start");
    setError(null);
    const res = await create({ ...vars, runAt });
    setBusy(null);
    if (res.error || !res.data) return setError(friendlyError(res.error as never));
    navigation.replace("AiJob", { jobId: res.data.createAiJob.id });
  }

  return (
    <Screen scroll>
      <Card>
        <Field label={STR.awJobName} value={title} onChangeText={setTitle} autoCapitalize="sentences" />
        <Field label={STR.awJobTemplate} value={template} onChangeText={setTemplate} multiline inputStyle={{ minHeight: 140 }} />
        <Field label={STR.awJobItems} value={itemsText} onChangeText={setItemsText} multiline inputStyle={{ minHeight: 140 }} />
        <Select label={STR.awJobKind} value={kind} options={DRAFT_KINDS.map((k) => ({ label: kindLabel(k), value: k }))} onChange={setKind} />
        <Select label={STR.awModel} value={model} options={MODEL_OPTIONS()} onChange={setModel} />
        <Select label={STR.awThinking} value={thinking} options={THINKING_OPTIONS()} onChange={setThinking} />
        <View style={{ marginTop: space(1) }}>
          <Button title={STR.awJobEstimate} variant="secondary" loading={busy === "estimate"} disabled={title.trim().length < 2 || items.length === 0 || !template.includes("{{item}}")} onPress={() => void onEstimate()} />
        </View>
        {estimate ? (
          <>
            <Muted>{fill(STR.awJobEstimateLine, { items: estimate.items, input: kTokens(estimate.inputTokens), output: kTokens(estimate.outputTokens) })}</Muted>
            <Notice tone="info" message={`${fill(STR.awJobPriceNow, { usd: usd(estimate.nowUsd) })} · ${fill(STR.awJobPriceOff, { usd: usd(estimate.offpeakUsd), time: dhakaTime(estimate.offpeakStartsAt) })}`} />
            <Select
              label={STR.awRun}
              value={runAt}
              placeholder={STR.awJobRunPick}
              options={[
                { label: `${estimate.peakNow ? STR.awRunNowPeak : STR.awRunNowOff} (~$${usd(estimate.nowUsd)})`, value: "now" },
                { label: `${STR.awRunOffpeak} (~$${usd(estimate.offpeakUsd)})`, value: "offpeak" },
              ]}
              onChange={setRunAt}
            />
            {!runAt ? <Muted>{STR.awJobRunPick}</Muted> : null}
            {isClaudeModel(model) && runAt === "offpeak" ? <Muted>{STR.awClaudeNoOffpeak}</Muted> : null}
            <Button title={STR.awJobStart} loading={busy === "start"} disabled={!runAt} onPress={() => void onStart()} />
          </>
        ) : null}
        {error ? <ErrorBanner message={error} /> : null}
      </Card>
    </Screen>
  );
}
