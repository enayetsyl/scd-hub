/**
 * AI features & limits (AI-1/AI-2/AI-5; D-#1122, D-#1126, D-#1101) — on the AI settings
 * screen. Per feature: switch on/off (switching on tests the chosen AI first), which AI
 * and model, fallback, and the caps; then the school's monthly budget and alert percent.
 * The Bangla-name count sits on top: the checker should not go on before every child has
 * one (PRD P11). `system_health:ai_key` (LOCKED).
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import { AI_BUDGET, AI_FEATURE_SETTINGS, SET_AI_BUDGET, SET_AI_FEATURE_SETTING, type AiFeatureSettingT, type AiProviderT } from "../graphql/aiSettings";
import { BANGLA_NAME_READINESS } from "../graphql/studentBanglaName";
import { Card, Body, Muted, Field, Button, Notice, Chip, ChipRow, Badge, Select } from "./ui";
import { STR } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { space } from "../theme/tokens";

const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));
const num = (s: string): number | null => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

function FeatureCard({ f }: { f: AiFeatureSettingT }): React.ReactElement {
  const [, save] = useMutation(SET_AI_FEATURE_SETTING);
  const [provider, setProvider] = React.useState<AiProviderT>(f.provider);
  const [model, setModel] = React.useState(f.modelSaved ?? "");
  const [fallback, setFallback] = React.useState(f.fallback);
  const [daily, setDaily] = React.useState(String(f.dailyPerUser));
  const [monthly, setMonthly] = React.useState(String(f.monthlyUsd));
  const [perSession, setPerSession] = React.useState(f.perSessionTurns == null ? "" : String(f.perSessionTurns));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  async function run(vars: Parameters<typeof save>[0]): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(false);
    const res = await save(vars);
    setBusy(false);
    if (res.error) setError(friendlyError(res.error as never));
    else setDone(true);
  }

  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{f.labelBn}</Body>
      <Badge text={f.enabled ? STR.aifOn : STR.aifOff} tone={f.enabled ? "ok" : "muted"} />
      <Muted>{fill(STR.aifModelNow, { model: f.model })}</Muted>
      {!f.providerReady ? <Notice tone="warn" message={STR.aifNoKey} /> : null}

      <Muted style={{ marginTop: space(2) }}>{STR.aifProvider}</Muted>
      <ChipRow>
        <Chip label="DeepSeek" selected={provider === "deepseek"} onPress={() => setProvider("deepseek")} />
        <Chip label="Gemini" selected={provider === "gemini"} onPress={() => setProvider("gemini")} />
      </ChipRow>
      <Field label={STR.aifModel} value={model} onChangeText={setModel} placeholder={provider === "deepseek" ? "deepseek-flash" : "gemini-flash-latest"} />
      <ChipRow>
        <Chip label={fallback ? STR.aifFallbackOn : STR.aifFallbackOff} selected={fallback} onPress={() => setFallback(!fallback)} />
      </ChipRow>
      <Field label={STR.aifDaily} value={daily} onChangeText={setDaily} keyboardType="number-pad" />
      <Field label={STR.aifMonthly} value={monthly} onChangeText={setMonthly} keyboardType="decimal-pad" />
      {f.feature === "assistant" ? <Field label={STR.aifPerSession} value={perSession} onChangeText={setPerSession} keyboardType="number-pad" /> : null}

      {error ? <Notice tone="danger" message={error} /> : null}
      {done ? <Notice tone="ok" message={STR.aifSaved} /> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
        <Button
          title={STR.aifSave}
          variant="secondary"
          loading={busy}
          onPress={() =>
            void run({
              feature: f.feature,
              provider,
              model: model.trim(),
              fallback,
              dailyPerUser: num(daily),
              monthlyUsd: num(monthly),
              perSessionTurns: f.feature === "assistant" ? num(perSession) : null,
            })
          }
        />
        <Button title={f.enabled ? STR.aifTurnOff : STR.aifTurnOn} variant={f.enabled ? "secondary" : "primary"} loading={busy} onPress={() => void run({ feature: f.feature, enabled: !f.enabled })} />
      </View>
    </Card>
  );
}

function BudgetCard(): React.ReactElement | null {
  const [q] = useQuery({ query: AI_BUDGET, requestPolicy: "cache-and-network" });
  const [, save] = useMutation(SET_AI_BUDGET);
  const b = q.data?.aiBudget;
  const [monthly, setMonthly] = React.useState<string | null>(null);
  const [pct, setPct] = React.useState<string | null>(null);
  const [wsCap, setWsCap] = React.useState<string | null>(null);
  const [wsModel, setWsModel] = React.useState<string | null>(null);
  const [wsThinking, setWsThinking] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  if (!b) return null;
  async function onSave(): Promise<void> {
    setBusy(true);
    setMsg(null);
    const res = await save({
      monthlyUsd: num(monthly ?? String(b!.monthlyUsd)),
      alertPct: num(pct ?? String(b!.alertPct)),
      workspaceMonthlyUsd: num(wsCap ?? String(b!.workspaceMonthlyUsd)),
      workspaceDefaultModel: wsModel ?? b!.workspaceDefaultModel,
      workspaceDefaultThinking: wsThinking ?? b!.workspaceDefaultThinking,
    });
    setBusy(false);
    setMsg(res.error ? { tone: "danger", text: friendlyError(res.error as never) } : { tone: "ok", text: STR.aifSaved });
  }
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.aifBudgetTitle}</Body>
      <Muted>{STR.aifBudgetHelp}</Muted>
      <Field label={STR.aifBudgetMonthly} value={monthly ?? String(b.monthlyUsd)} onChangeText={setMonthly} keyboardType="decimal-pad" />
      <Field label={STR.aifBudgetAlert} value={pct ?? String(b.alertPct)} onChangeText={setPct} keyboardType="number-pad" />
      {/* AI Workspace (D-#1225: every budget figure in this one place; D-#1206 defaults). */}
      <Field label={STR.aifWsCap} helper={STR.aifWsCapHelp} value={wsCap ?? String(b.workspaceMonthlyUsd)} onChangeText={setWsCap} keyboardType="decimal-pad" />
      <Select
        label={STR.aifWsModel}
        value={wsModel ?? b.workspaceDefaultModel}
        options={[
          { label: STR.awModelFlash, value: "deepseek-flash" },
          { label: STR.awModelPro, value: "deepseek-v4-pro" },
        ]}
        onChange={setWsModel}
      />
      <Select
        label={STR.aifWsThinking}
        value={wsThinking ?? b.workspaceDefaultThinking}
        options={[
          { label: STR.awThinkingOff, value: "off" },
          { label: STR.awThinkingLow, value: "low" },
          { label: STR.awThinkingHigh, value: "high" },
        ]}
        onChange={setWsThinking}
      />
      {b.capsOverBudget ? <Notice tone="warn" message={fill(STR.aifCapsOver, { caps: b.capsTotalUsd, budget: b.monthlyUsd })} /> : null}
      {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
      <View style={{ marginTop: space(2) }}>
        <Button title={STR.aifSave} variant="secondary" onPress={() => void onSave()} loading={busy} />
      </View>
    </Card>
  );
}

export function AiFeaturesSection(): React.ReactElement {
  const [q] = useQuery({ query: AI_FEATURE_SETTINGS, requestPolicy: "cache-and-network" });
  const [rq] = useQuery({ query: BANGLA_NAME_READINESS, requestPolicy: "cache-and-network" });
  const r = rq.data?.banglaNameReadiness;
  return (
    <>
      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.aifTitle}</Body>
        <Muted>{STR.aifIntro}</Muted>
        {r ? (
          <Notice
            tone={r.missingBanglaName > 0 ? "info" : "ok"}
            message={r.missingBanglaName > 0 ? fill(STR.aifNamesMissing, { have: r.withBanglaName, all: r.activeStudents }) : STR.aifNamesDone}
          />
        ) : null}
      </Card>
      {q.error ? <Notice tone="danger" message={friendlyError(q.error as never)} /> : null}
      {(q.data?.aiFeatureSettings ?? []).map((f) => (
        <FeatureCard key={`${f.feature}-${f.updatedAt ?? ""}-${f.enabled}`} f={f} />
      ))}
      <BudgetCard />
    </>
  );
}
