/**
 * AiAssistChatScreen (AI-6, D-#1096) — one conversation: the turns, oldest first, and a box
 * to ask the next question. The Principal reading another teacher's conversation sees it
 * read-only. Answers render as Markdown.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { AI_ASSIST_MESSAGES_PAGE, ASK_AI_ASSISTANT } from "../../graphql/aiAssist";
import type { AiAssistStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Field, Notice, Loader, ErrorBanner, Badge } from "../../components/ui";
import Markdown from "../../components/Markdown";
import { useAuth } from "../../auth/AuthContext";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AiAssistStackParamList, "AiAssistChat">;

export default function AiAssistChatScreen({ route }: Props): React.ReactElement {
  const { sessionId } = route.params;
  const { user } = useAuth();
  const userId = user?.id;
  const [q, refetch] = useQuery({ query: AI_ASSIST_MESSAGES_PAGE, variables: { sessionId, page: 1, pageSize: 100 }, requestPolicy: "cache-and-network" });
  const [, ask] = useMutation(ASK_AI_ASSISTANT);
  const [question, setQuestion] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const page = q.data?.aiAssistMessagesPage;
  if (q.fetching && !page) return <Loader />;
  if (q.error || !page) return <ErrorBanner message={friendlyError(q.error as never)} />;
  const own = !userId || page.session.teacherId === userId;

  async function onAsk(): Promise<void> {
    setBusy(true);
    setError(null);
    const res = await ask({ sessionId, question: question.trim() });
    setBusy(false);
    if (res.error) {
      setError(friendlyError(res.error as never));
      return;
    }
    setQuestion("");
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <Card>
        <Body style={{ fontWeight: "700" }}>{page.session.title}</Body>
        {!own && page.session.teacherName ? <Muted>{page.session.teacherName}</Muted> : null}
      </Card>
      {page.rows.length === 0 ? <Muted>{STR.aasEmpty}</Muted> : null}
      {page.rows.map((m) => (
        <Card key={m.id}>
          <Badge text={m.role === "user" ? STR.aasYou : STR.aasAssistant} tone={m.role === "user" ? "muted" : "info"} />
          <View style={{ marginTop: space(1) }}>{m.role === "assistant" ? <Markdown source={m.text} /> : <Body>{m.text}</Body>}</View>
        </Card>
      ))}
      {own ? (
        <Card>
          <Field label={STR.aasQuestion} value={question} onChangeText={setQuestion} multiline placeholder={STR.aasQuestionHelp} />
          {error ? <Notice tone="danger" message={error} /> : null}
          <View style={{ marginTop: space(2) }}>
            <Button title={busy ? STR.aasThinking : STR.aasAsk} onPress={() => void onAsk()} loading={busy} disabled={busy || question.trim().length < 2} />
          </View>
        </Card>
      ) : (
        <Notice tone="info" message={STR.aasReadOnly} />
      )}
    </Screen>
  );
}
