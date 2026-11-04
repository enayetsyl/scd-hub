/**
 * AiSettingsScreen (D-#967) — the Principal changes the Gemini key and model here instead
 * of editing the server's .env. `system_health:ai_key` (LOCKED). The key is write-only:
 * the screen shows where the key comes from and its last 4 characters, never the key.
 * Saving is tested against Google first, so a wrong key or a retired model is refused.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { AI_SETTINGS_QUERY, CLEAR_AI_KEY, SET_AI_SETTINGS } from "../../graphql/aiSettings";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Field, Notice, Loader, ErrorBanner } from "../../components/ui";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "AiSettings">;

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));

export default function AiSettingsScreen(_props: Props): React.ReactElement {
  const [q, refetch] = useQuery({ query: AI_SETTINGS_QUERY, requestPolicy: "network-only" });
  const [, save] = useMutation(SET_AI_SETTINGS);
  const [, clear] = useMutation(CLEAR_AI_KEY);
  const [key, setKey] = React.useState("");
  const [model, setModel] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);

  const s = q.data?.aiSettings;
  React.useEffect(() => {
    if (s && model === null) setModel(s.modelSaved ?? "");
  }, [s, model]);

  if (q.fetching && !s) return <Loader />;
  if (q.error || !s) return <ErrorBanner message={friendlyError(q.error as never)} />;

  const modelChanged = model !== null && model.trim() !== (s.modelSaved ?? "");
  const canSave = key.trim().length > 0 || modelChanged;

  async function onSave(): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(false);
    const res = await save({ apiKey: key.trim() || null, model: modelChanged ? model!.trim() : null });
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
    const res = await clear({});
    setBusy(false);
    if (res.error) setError(friendlyError(res.error as never));
    else refetch({ requestPolicy: "network-only" });
  }

  const sourceText = s.source === "SETTING" ? STR.aiSourceSetting : s.source === "ENV" ? STR.aiSourceEnv : STR.aiSourceNone;

  return (
    <Screen scroll>
      <Card>
        <Notice tone={s.source === "NONE" ? "warn" : "ok"} message={sourceText} />
        {s.keyLast4 ? <Body>{fill(STR.aiKeyEnds, { last4: `••••${s.keyLast4}` })}</Body> : null}
        <Body>{fill(STR.aiModelNow, { model: s.model })}</Body>
        {s.updatedAt && s.updatedByName ? (
          <Muted>{fill(STR.aiUpdated, { name: s.updatedByName, when: new Date(s.updatedAt).toLocaleString() })}</Muted>
        ) : null}
      </Card>

      <Card>
        <Field label={STR.aiNewKey} value={key} onChangeText={setKey} secureTextEntry secureToggle helper={STR.aiNewKeyHelp} />
        <Field label={STR.aiModel} value={model ?? ""} onChangeText={setModel} helper={STR.aiModelHelp} placeholder="gemini-flash-latest" />
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
