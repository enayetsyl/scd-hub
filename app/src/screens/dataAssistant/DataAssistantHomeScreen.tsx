/**
 * DataAssistantHomeScreen (docs/prd-data-assistant-mcp.md §11, DA-2) — "তথ্য সহকারী": my data
 * chats (paged, D-#761) and "new chat". Answers follow the person's own permissions; the
 * Principal's "View as" test shows a banner. Below: connect Claude, connected apps and the
 * Principal's log / all-connections links (DataAssistantLinks, DA-4).
 */
import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { DATA_CHATS_PAGE, START_DATA_CHAT, type DataChatT } from "../../graphql/dataAssistant";
import type { DataAssistantStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Notice, Loader, ErrorBanner } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { usePageState } from "../../lib/paging";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useToast } from "../../state/ToastContext";
import { modelLabel } from "../aiWorkspace/aiWorkspaceUi";
import { DataAssistantLinks } from "./DataAssistantLinks";
import { useAuth } from "../../auth/AuthContext";

type Props = NativeStackScreenProps<DataAssistantStackParamList, "DataAssistantHome">;
const PAGE_SIZE = 20;

function ChatCard({ c, onPress }: { c: DataChatT; onPress: () => void }): React.ReactElement {
  return (
    <Card onPress={onPress}>
      <Body style={{ fontWeight: "700" }}>{c.title}</Body>
      <Muted>{`${modelLabel(c.chatModel)} · ${c.turns}`}</Muted>
    </Card>
  );
}

export default function DataAssistantHomeScreen({ navigation }: Props): React.ReactElement {
  const toast = useToast();
  const { can, viewAs } = useAuth();
  // The chat needs data_assistant:use (or the Principal's View-as test); a Claude-connect holder
  // without it sees only the Claude and connected-apps cards.
  const canChat = can("data_assistant:use") || !!viewAs;
  const [page, setPage] = usePageState(false);
  const [q] = useQuery({ query: DATA_CHATS_PAGE, variables: { page, pageSize: PAGE_SIZE }, requestPolicy: "cache-and-network", pause: !canChat });
  const [start, startChat] = useMutation(START_DATA_CHAT);
  const data = q.data?.dataChatsPage;

  async function onNew(): Promise<void> {
    const res = await startChat({});
    if (res.error || !res.data) return toast.show(friendlyError(res.error as never), "danger");
    navigation.navigate("DataChat", { sessionId: res.data.startDataChat.id });
  }

  return (
    <Screen scroll>
      <Notice tone="info" message={STR.daIntro} />
      <Muted>{STR.daPrivacy}</Muted>
      {canChat ? (
        <>
          <Button title={STR.daNewChat} onPress={() => void onNew()} loading={start.fetching} />
          <Body style={{ fontWeight: "700" }}>{STR.daChats}</Body>
          {q.fetching && !data ? <Loader /> : null}
          {q.error ? <ErrorBanner message={friendlyError(q.error as never)} /> : null}
          {data && data.rows.length === 0 ? <Muted>{STR.daNoChats}</Muted> : null}
          {data?.rows.map((c) => (
            <ChatCard key={c.id} c={c} onPress={() => navigation.navigate("DataChat", { sessionId: c.id })} />
          ))}
          {data ? <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} /> : null}
        </>
      ) : null}
      <DataAssistantLinks navigation={navigation} />
    </Screen>
  );
}
