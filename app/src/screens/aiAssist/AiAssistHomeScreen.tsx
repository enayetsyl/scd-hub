/**
 * AiAssistHomeScreen (AI-6, D-#1096 / D-#1104) — my conversations with the AI assistant,
 * newest first (paged, D-#761), and "start a new one". The Principal (`read_all_chats`)
 * can switch to every teacher's conversations. Teachers are told, every time, that the
 * Principal can read their conversations.
 */
import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { AI_ASSISTANT_AVAILABLE, ALL_AI_ASSIST_SESSIONS_PAGE, MY_AI_ASSIST_SESSIONS_PAGE, type AiAssistSessionT } from "../../graphql/aiAssist";
import type { AiAssistStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Notice, Loader, ErrorBanner, Chip, ChipRow } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { useAuth } from "../../auth/AuthContext";
import { usePageState } from "../../lib/paging";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";

type Props = NativeStackScreenProps<AiAssistStackParamList, "AiAssistHome">;
const PAGE_SIZE = 20;
const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));

function SessionCard({ s, showTeacher, onPress }: { s: AiAssistSessionT; showTeacher: boolean; onPress: () => void }): React.ReactElement {
  return (
    <Card onPress={onPress}>
      <Body style={{ fontWeight: "700" }}>{s.title}</Body>
      {showTeacher && s.teacherName ? <Muted>{s.teacherName}</Muted> : null}
      <Muted>{fill(STR.aasTurns, { n: s.turns, when: new Date(s.lastAt).toLocaleDateString() })}</Muted>
    </Card>
  );
}

export default function AiAssistHomeScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const canChat = can("ai_assist:chat");
  const canAll = can("ai_assist:read_all_chats");
  const [all, setAll] = React.useState(!canChat && canAll);
  const [page, setPage] = usePageState(all);
  const [avail] = useQuery({ query: AI_ASSISTANT_AVAILABLE, pause: !canChat, requestPolicy: "cache-and-network" });
  const [mine] = useQuery({ query: MY_AI_ASSIST_SESSIONS_PAGE, variables: { page, pageSize: PAGE_SIZE }, pause: all || !canChat, requestPolicy: "cache-and-network" });
  const [every] = useQuery({ query: ALL_AI_ASSIST_SESSIONS_PAGE, variables: { page, pageSize: PAGE_SIZE }, pause: !all, requestPolicy: "cache-and-network" });
  const q = all ? every : mine;
  const data = all ? every.data?.allAiAssistSessionsPage : mine.data?.myAiAssistSessionsPage;

  return (
    <Screen scroll>
      <Notice tone="info" message={STR.aasPrivacy} />
      {canChat && avail.data && !avail.data.aiAssistantAvailable ? <Notice tone="warn" message={STR.aasNotOn} /> : null}
      {canChat ? <Button title={STR.aasNew} onPress={() => navigation.navigate("AiAssistNew")} disabled={!avail.data?.aiAssistantAvailable} /> : null}
      {canAll ? (
        <ChipRow>
          {canChat ? <Chip label={STR.aasMine} selected={!all} onPress={() => setAll(false)} /> : null}
          <Chip label={STR.aasAll} selected={all} onPress={() => setAll(true)} />
        </ChipRow>
      ) : null}
      {q.fetching && !data ? <Loader /> : null}
      {q.error ? <ErrorBanner message={friendlyError(q.error as never)} /> : null}
      {data && data.rows.length === 0 ? <Muted>{STR.aasNone}</Muted> : null}
      {data?.rows.map((s) => (
        <SessionCard key={s.id} s={s} showTeacher={all} onPress={() => navigation.navigate("AiAssistChat", { sessionId: s.id })} />
      ))}
      {data ? <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} /> : null}
    </Screen>
  );
}
