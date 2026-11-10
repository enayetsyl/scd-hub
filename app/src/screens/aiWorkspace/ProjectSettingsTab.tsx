/**
 * The Settings tab (AI Workspace W-1): name, description, default model + thinking (D-#1206),
 * name protection (D-#1207), the project's own monthly limit (D-#1225) and archive. Owners
 * change them; everyone else reads them.
 */
import React from "react";
import { View } from "react-native";
import { useMutation } from "urql";
import { UPDATE_AI_PROJECT, type AiProjectT } from "../../graphql/aiWorkspace";
import { Card, Body, Muted, Button, Field, Notice, Select, Chip, ChipRow } from "../../components/ui";
import { useConfirm } from "../../state/ConfirmContext";
import { useToast } from "../../state/ToastContext";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { MODEL_OPTIONS, modelLabel, THINKING_OPTIONS, thinkingLabel } from "./aiWorkspaceUi";

export function ProjectSettingsTab({ project, onChanged }: { project: AiProjectT; onChanged: () => void }): React.ReactElement {
  const toast = useToast();
  const { confirmAction } = useConfirm();
  const [, update] = useMutation(UPDATE_AI_PROJECT);
  const [name, setName] = React.useState(project.name);
  const [description, setDescription] = React.useState(project.description ?? "");
  const [model, setModel] = React.useState(project.defaultModel);
  const [thinking, setThinking] = React.useState<string>(project.defaultThinking);
  const [nameProtection, setNameProtection] = React.useState(project.nameProtection);
  const [cap, setCap] = React.useState(project.monthlyCapUsd === null ? "" : String(project.monthlyCapUsd));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (project.myRole !== "owner") {
    return (
      <Card>
        <Muted>{`${STR.awModel}: ${modelLabel(project.defaultModel)} · ${STR.awThinking}: ${thinkingLabel(project.defaultThinking)}`}</Muted>
        <Muted>{`${STR.awNameProtection}: ${project.nameProtection ? STR.awOn : STR.awOff}`}</Muted>
      </Card>
    );
  }

  async function onSave(): Promise<void> {
    setBusy(true);
    setError(null);
    const capNum = cap.trim() === "" ? null : Number(cap);
    const res = await update({
      id: project.id,
      name,
      description,
      defaultModel: model,
      defaultThinking: thinking,
      nameProtection,
      ...(capNum === null ? { clearMonthlyCap: true } : { monthlyCapUsd: capNum }),
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error as never));
    toast.show(STR.awSaved, "ok");
    onChanged();
  }

  async function onArchive(): Promise<void> {
    if (!project.archived) {
      const ok = await confirmAction({ title: STR.awArchive, confirmLabel: STR.awArchive, tone: "danger" });
      if (!ok) return;
    }
    const res = await update({ id: project.id, archived: !project.archived });
    if (res.error) toast.show(friendlyError(res.error as never), "danger");
    onChanged();
  }

  return (
    <Card>
      <Field label={STR.awName} value={name} onChangeText={setName} autoCapitalize="sentences" />
      <Field label={STR.awDescription} value={description} onChangeText={setDescription} multiline autoCapitalize="sentences" />
      <Select label={STR.awModel} value={model} options={MODEL_OPTIONS()} onChange={setModel} />
      <Select label={STR.awThinking} value={thinking} options={THINKING_OPTIONS()} onChange={setThinking} />
      <Body style={{ fontWeight: "700", marginTop: space(2) }}>{STR.awNameProtection}</Body>
      <Muted>{STR.awNameProtectionHelp}</Muted>
      <ChipRow>
        <Chip label={STR.awOff} selected={!nameProtection} onPress={() => setNameProtection(false)} />
        <Chip label={STR.awOn} selected={nameProtection} onPress={() => setNameProtection(true)} />
      </ChipRow>
      <Field label={STR.awMonthlyCap} value={cap} onChangeText={setCap} keyboardType="decimal-pad" />
      {error ? <Notice tone="danger" message={error} /> : null}
      <View style={{ marginTop: space(2), gap: space(1) }}>
        <Button title={STR.awSettingsSave} onPress={() => void onSave()} loading={busy} />
        <Button title={project.archived ? STR.awUnarchive : STR.awArchive} variant={project.archived ? "secondary" : "danger"} onPress={() => void onArchive()} />
      </View>
    </Card>
  );
}
