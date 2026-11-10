/**
 * AiProjectNewScreen (AI Workspace W-1) — name, description and the name-protection switch
 * (D-#1207; chosen at creation, OFF for content projects). Model and thinking start from the
 * workspace defaults set on the AI settings screen (D-#1206) and can be changed later.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation } from "urql";
import { CREATE_AI_PROJECT } from "../../graphql/aiWorkspace";
import type { AiWorkspaceStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Field, Chip, ChipRow, ErrorBanner } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AiWorkspaceStackParamList, "AiProjectNew">;

export default function AiProjectNewScreen({ navigation }: Props): React.ReactElement {
  const [, create] = useMutation(CREATE_AI_PROJECT);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [nameProtection, setNameProtection] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onCreate(): Promise<void> {
    setBusy(true);
    setError(null);
    const res = await create({ name, description: description || null, nameProtection });
    setBusy(false);
    if (res.error || !res.data) return setError(friendlyError(res.error as never));
    navigation.replace("AiProject", { projectId: res.data.createAiProject.id });
  }

  return (
    <Screen scroll>
      <Card>
        <Field label={STR.awName} value={name} onChangeText={setName} autoCapitalize="sentences" />
        <Field label={STR.awDescription} value={description} onChangeText={setDescription} multiline autoCapitalize="sentences" />
        <Body style={{ fontWeight: "700", marginTop: space(2) }}>{STR.awNameProtection}</Body>
        <Muted>{STR.awNameProtectionHelp}</Muted>
        <ChipRow>
          <Chip label={STR.awOff} selected={!nameProtection} onPress={() => setNameProtection(false)} />
          <Chip label={STR.awOn} selected={nameProtection} onPress={() => setNameProtection(true)} />
        </ChipRow>
        {error ? <ErrorBanner message={error} /> : null}
        <View style={{ marginTop: space(2) }}>
          <Button title={STR.awCreate} onPress={() => void onCreate()} loading={busy} disabled={name.trim().length < 2} />
        </View>
      </Card>
    </Screen>
  );
}
