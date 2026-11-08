/**
 * AiRuleEditScreen (AI-3, D-#1093) — write the next version of an AI rules document,
 * starting from an existing version's text (or blank). Saved OFF; the Principal switches it
 * on from the document screen. `ai_assist:edit_rules`.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { AI_POLICY_VERSION, SAVE_AI_POLICY_VERSION } from "../../graphql/aiPolicies";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, Card, Field, Button, Notice, Loader, ErrorBanner } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "AiRuleEdit">;

export default function AiRuleEditScreen({ navigation, route }: Props): React.ReactElement {
  const { key, fromId } = route.params;
  const [q] = useQuery({ query: AI_POLICY_VERSION, variables: { id: fromId ?? "" }, pause: !fromId });
  const [, save] = useMutation(SAVE_AI_POLICY_VERSION);
  const [body, setBody] = React.useState<string | null>(fromId ? null : "");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (body === null && q.data?.aiPolicyVersion) setBody(q.data.aiPolicyVersion.body);
  }, [q.data, body]);

  if (fromId && q.fetching && body === null) return <Loader />;
  if (fromId && q.error) return <ErrorBanner message={friendlyError(q.error as never)} />;

  async function onSave(): Promise<void> {
    setBusy(true);
    setError(null);
    const res = await save({ key, body: body ?? "", note: note.trim() || null });
    setBusy(false);
    if (res.error || !res.data) {
      setError(friendlyError(res.error as never));
      return;
    }
    navigation.navigate("AiRule", { key });
  }

  return (
    <Screen scroll>
      <Card>
        <Field label={STR.airBody} value={body ?? ""} onChangeText={setBody} multiline helper={STR.airBodyHelp} />
        <Field label={STR.airNote} value={note} onChangeText={setNote} />
        {error ? <Notice tone="danger" message={error} /> : null}
        <View style={{ marginTop: space(2) }}>
          <Button title={STR.airSave} onPress={() => void onSave()} loading={busy} disabled={!body || body.trim().length < 20} />
        </View>
      </Card>
    </Screen>
  );
}
