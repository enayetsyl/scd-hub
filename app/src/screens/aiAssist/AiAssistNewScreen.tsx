/**
 * AiAssistNewScreen (AI-6, D-#1096) — open a conversation: pick the class and subject, then
 * a chapter (and, if you like, one session). Only class/subject pairs with lesson plans in
 * the app are offered, because the assistant answers from those plans.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { AI_ASSIST_TOPICS, START_AI_ASSIST_SESSION } from "../../graphql/aiAssist";
import type { AiAssistStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Notice, Loader, ErrorBanner, Chip, ChipRow } from "../../components/ui";
import { STR, subjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AiAssistStackParamList, "AiAssistNew">;
const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));

export default function AiAssistNewScreen({ navigation }: Props): React.ReactElement {
  const [q] = useQuery({ query: AI_ASSIST_TOPICS, requestPolicy: "cache-and-network" });
  const [, start] = useMutation(START_AI_ASSIST_SESSION);
  const [topicIdx, setTopicIdx] = React.useState<number | null>(null);
  const [chapter, setChapter] = React.useState<string | null>(null);
  const [session, setSession] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const topics = q.data?.aiAssistTopics;
  if (q.fetching && !topics) return <Loader />;
  if (q.error || !topics) return <ErrorBanner message={friendlyError(q.error as never)} />;
  const topic = topicIdx === null ? null : topics[topicIdx];
  const ch = topic?.chapters.find((c) => c.chapter === chapter) ?? null;

  async function onStart(): Promise<void> {
    if (!topic) return;
    setBusy(true);
    setError(null);
    const res = await start({ classLevel: topic.classLevel, subject: topic.subject, chapter, sessionIndex: session });
    setBusy(false);
    if (res.error || !res.data) {
      setError(friendlyError(res.error as never));
      return;
    }
    navigation.replace("AiAssistChat", { sessionId: res.data.startAiAssistSession.id });
  }

  return (
    <Screen scroll>
      {topics.length === 0 ? <Notice tone="warn" message={STR.aasNoPlans} /> : null}
      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.aasPickClass}</Body>
        <ChipRow>
          {topics.map((t, i) => (
            <Chip
              key={`${t.classLevel}-${t.subject}`}
              label={fill(STR.aasClassSubject, { c: t.classLevel, s: subjectLabel(t.subject) })}
              selected={topicIdx === i}
              onPress={() => {
                setTopicIdx(i);
                setChapter(null);
                setSession(null);
              }}
            />
          ))}
        </ChipRow>
      </Card>
      {topic ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.aasPickChapter}</Body>
          <ChipRow>
            {topic.chapters.map((c) => (
              <Chip
                key={c.chapter}
                label={c.title ? `${c.chapter}. ${c.title}` : fill(STR.aasChapter, { n: c.chapter })}
                selected={chapter === c.chapter}
                onPress={() => {
                  setChapter(c.chapter);
                  setSession(null);
                }}
              />
            ))}
          </ChipRow>
        </Card>
      ) : null}
      {ch ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.aasPickSession}</Body>
          <Muted>{STR.aasPickSessionHelp}</Muted>
          <ChipRow>
            {ch.sessions.map((s) => (
              <Chip key={s.sessionIndex} label={`${s.sessionIndex}. ${s.titleBn}`} selected={session === s.sessionIndex} onPress={() => setSession(session === s.sessionIndex ? null : s.sessionIndex)} />
            ))}
          </ChipRow>
        </Card>
      ) : null}
      {error ? <Notice tone="danger" message={error} /> : null}
      <View style={{ marginTop: space(2) }}>
        <Button title={STR.aasStart} onPress={() => void onStart()} loading={busy} disabled={!topic || !chapter} />
      </View>
    </Screen>
  );
}
