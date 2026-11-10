/**
 * AiDraftNewScreen (AI Workspace W-3) — a new draft: from a finished AI answer ("save as
 * draft" in a chat — a ```json block becomes the JSON part), or written by hand.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation } from "urql";
import { CREATE_AI_DRAFT, SAVE_AI_DRAFT_FROM_MESSAGE, type AiDraftKindT } from "../../graphql/aiWorkspaceDrafts";
import type { AiWorkspaceStackParamList } from "../../navigation/types";
import { Screen, Card, Button, Field, Select, ErrorBanner, Muted } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { DRAFT_KINDS, isJsonKind, kindLabel } from "./draftUi";

type Props = NativeStackScreenProps<AiWorkspaceStackParamList, "AiDraftNew">;

export default function AiDraftNewScreen({ route, navigation }: Props): React.ReactElement {
  const { projectId, messageId } = route.params;
  const [, create] = useMutation(CREATE_AI_DRAFT);
  const [, fromMessage] = useMutation(SAVE_AI_DRAFT_FROM_MESSAGE);
  const [title, setTitle] = React.useState("");
  const [kind, setKind] = React.useState<AiDraftKindT>("free");
  const [body, setBody] = React.useState("");
  const [planJson, setPlanJson] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onCreate(): Promise<void> {
    setBusy(true);
    setError(null);
    const res = messageId
      ? await fromMessage({ messageId, title, kind })
      : await create({ projectId, title, kind, body, planJson: kind === "lesson_plan" ? planJson : null });
    setBusy(false);
    if (res.error || !res.data) return setError(friendlyError(res.error as never));
    const id = "saveAiDraftFromMessage" in res.data ? res.data.saveAiDraftFromMessage.id : res.data.createAiDraft.id;
    navigation.replace("AiDraft", { draftId: id });
  }

  return (
    <Screen scroll>
      <Card>
        <Field label={STR.awDraftTitleField} value={title} onChangeText={setTitle} autoCapitalize="sentences" />
        <Select label={STR.awDraftKind} value={kind} options={DRAFT_KINDS.map((k) => ({ label: kindLabel(k), value: k }))} onChange={setKind} />
        {messageId ? (
          <Muted>{STR.awSaveAsDraft}</Muted>
        ) : (
          <>
            <Field label={isJsonKind(kind) ? STR.awDraftJsonBody : STR.awDraftBody} value={body} onChangeText={setBody} multiline inputStyle={{ minHeight: 200 }} />
            {kind === "lesson_plan" ? <Field label={STR.awDraftPlanJson} value={planJson} onChangeText={setPlanJson} multiline inputStyle={{ minHeight: 160 }} /> : null}
          </>
        )}
        {error ? <ErrorBanner message={error} /> : null}
        <View style={{ marginTop: space(2) }}>
          <Button title={STR.awDraftCreate} onPress={() => void onCreate()} loading={busy} disabled={title.trim().length < 2 || (!messageId && !body.trim())} />
        </View>
      </Card>
    </Screen>
  );
}
