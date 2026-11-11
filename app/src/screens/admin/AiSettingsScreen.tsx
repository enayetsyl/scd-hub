/**
 * AiSettingsScreen (D-#967, D-#1090) — the Principal changes each AI service's key and
 * model here instead of editing the server's .env. `system_health:ai_key` (LOCKED).
 * Three services: Gemini (voice tasks, monthly comments, the observation rota, the book
 * author), DeepSeek (the new AI features of docs/prd-ai-assist.md) and Claude (the school's
 * Claude API credit — used only where a feature or a workspace picker chooses it). Keys are write-only:
 * the screen shows where a key comes from and its last 4 characters, never the key.
 * Saving is tested against the service first, so a wrong key or an unknown model is refused.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { AI_SETTINGS_QUERY, CLEAR_AI_KEY, SET_AI_SETTINGS, type AiProviderT } from "../../graphql/aiSettings";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Field, Notice, Loader, ErrorBanner, Chip, ChipRow } from "../../components/ui";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { AiFeaturesSection } from "../../components/AiFeaturesSection";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "AiSettings">;

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));

const PROVIDERS: Array<{ id: AiProviderT; label: string }> = [
  { id: "gemini", label: "Gemini" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "anthropic", label: "Claude" },
];

export default function AiSettingsScreen(_props: Props): React.ReactElement {
  const [provider, setProvider] = React.useState<AiProviderT>("gemini");
  const [q, refetch] = useQuery({ query: AI_SETTINGS_QUERY, variables: { provider }, requestPolicy: "network-only" });
  const [, save] = useMutation(SET_AI_SETTINGS);
  const [, clear] = useMutation(CLEAR_AI_KEY);
  const [key, setKey] = React.useState("");
  const [model, setModel] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);

  // Only the answer for the CHOSEN service counts — a stale one from the other chip is ignored.
  const s = q.data?.aiSettings && q.data.aiSettings.provider === provider ? q.data.aiSettings : undefined;
  React.useEffect(() => {
    if (s && model === null) setModel(s.modelSaved ?? "");
  }, [s, model]);

  function pick(p: AiProviderT): void {
    if (p === provider) return;
    setProvider(p);
    setKey("");
    setModel(null);
    setError(null);
    setDone(false);
  }

  const chips = (
    <Card>
      <Muted>{STR.aiProviderPick}</Muted>
      <ChipRow>
        {PROVIDERS.map((p) => (
          <Chip key={p.id} label={p.label} selected={p.id === provider} onPress={() => pick(p.id)} />
        ))}
      </ChipRow>
    </Card>
  );

  if (q.fetching && !s) return <Screen scroll>{chips}<Loader /></Screen>;
  if (q.error || !s) return <Screen scroll>{chips}<ErrorBanner message={friendlyError(q.error as never)} /></Screen>;

  const isDeepseek = provider === "deepseek";
  const isClaude = provider === "anthropic";
  const modelChanged = model !== null && model.trim() !== (s.modelSaved ?? "");
  const canSave = key.trim().length > 0 || modelChanged;

  async function onSave(): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(false);
    const res = await save({ apiKey: key.trim() || null, model: modelChanged ? model!.trim() : null, provider });
    setBusy(false);
    if (res.error) {
      setError(friendlyError(res.error as never));
      return;
    }
    setKey("");
    setDone(true);
    refetch({ requestPolicy: "network-only" });
  }

  async function onClear(): Promise<void> {
    setConfirmClear(false);
    setBusy(true);
    const res = await clear({ provider });
    setBusy(false);
    if (res.error) setError(friendlyError(res.error as never));
    else refetch({ requestPolicy: "network-only" });
  }

  const sourceText = s.source === "SETTING" ? STR.aiSourceSetting : s.source === "ENV" ? STR.aiSourceEnv : STR.aiSourceNone;

  return (
    <Screen scroll>
      {chips}
      <Card>
        <Notice tone={s.source === "NONE" ? "warn" : "ok"} message={sourceText} />
        {s.keyLast4 ? <Body>{fill(STR.aiKeyEnds, { last4: `••••${s.keyLast4}` })}</Body> : null}
        <Body>{fill(STR.aiModelNow, { model: s.model })}</Body>
        {s.updatedAt && s.updatedByName ? (
          <Muted>{fill(STR.aiUpdated, { name: s.updatedByName, when: new Date(s.updatedAt).toLocaleString() })}</Muted>
        ) : null}
        {isDeepseek ? <Muted>{STR.aiDeepseekNote}</Muted> : null}
        {isClaude ? <Muted>{STR.aiClaudeNote}</Muted> : null}
      </Card>

      <Card>
        <Field
          label={isClaude ? STR.aiNewKeyClaude : isDeepseek ? STR.aiNewKeyDeepseek : STR.aiNewKey}
          value={key}
          onChangeText={setKey}
          secureTextEntry
          secureToggle
          helper={isClaude ? STR.aiNewKeyHelpClaude : isDeepseek ? STR.aiNewKeyHelpDeepseek : STR.aiNewKeyHelp}
        />
        <Field
          label={isDeepseek || isClaude ? fill(STR.aiModelDeepseek, { model: s.defaultModel }) : STR.aiModel}
          value={model ?? ""}
          onChangeText={setModel}
          helper={isClaude ? STR.aiModelHelpClaude : isDeepseek ? STR.aiModelHelpDeepseek : STR.aiModelHelp}
          placeholder={s.defaultModel}
        />
        {error ? <Notice tone="danger" message={error} /> : null}
        {done ? <Notice tone="ok" message={STR.aiSaved} /> : null}
        <View style={{ marginTop: space(2) }}>
          <Button title={STR.aiSave} onPress={() => void onSave()} loading={busy} disabled={!canSave} />
        </View>
        {s.source === "SETTING" ? (
          <View style={{ marginTop: space(2) }}>
            <Button title={STR.aiClear} variant="secondary" onPress={() => setConfirmClear(true)} disabled={busy} />
          </View>
        ) : null}
      </Card>

      {/* AI-5 (D-#1122/#1126): which AI answers each feature, the switches and the limits. */}
      <AiFeaturesSection />

      <ConfirmSheet
        visible={confirmClear}
        title={STR.aiClearConfirm}
        confirmLabel={STR.aiClear}
        tone="danger"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => void onClear()}
      />
    </Screen>
  );
}
