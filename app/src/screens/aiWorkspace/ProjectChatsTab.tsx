/**
 * The Chats tab of a project (AI Workspace W-2): the project's chats, newest first, and
 * "new chat" (editors — a chat spends money). Every member can read every chat.
 */
import React from "react";
import { useMutation, useQuery } from "urql";
import { AI_PROJECT_CHATS_PAGE, START_AI_PROJECT_CHAT } from "../../graphql/aiWorkspaceChat";
import type { AiProjectT } from "../../graphql/aiWorkspace";
import { Card, Body, Muted, Button, Loader, ErrorBanner } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { usePageState } from "../../lib/paging";
import { useToast } from "../../state/ToastContext";
import { STR, isoDateTimeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { fill } from "./aiWorkspaceUi";

const PAGE_SIZE = 20;

export function ProjectChatsTab({ project, onOpen }: { project: AiProjectT; onOpen: (sessionId: string) => void }): React.ReactElement {
  const toast = useToast();
  const [page, setPage] = usePageState(project.id);
  const [q] = useQuery({ query: AI_PROJECT_CHATS_PAGE, variables: { projectId: project.id, page, pageSize: PAGE_SIZE }, requestPolicy: "cache-and-network" });
  const [startState, start] = useMutation(START_AI_PROJECT_CHAT);
  const data = q.data?.aiProjectChatsPage;
  const canEdit = project.myRole !== "viewer" && !project.archived;

  async function onNew(): Promise<void> {
    const res = await start({ projectId: project.id });
    if (res.error || !res.data) return toast.show(friendlyError(res.error as never), "danger");
    onOpen(res.data.startAiProjectChat.id);
  }

  return (
    <>
      {canEdit ? <Button title={STR.awNewChat} onPress={() => void onNew()} loading={startState.fetching} /> : null}
      {q.fetching && !data ? <Loader /> : null}
      {q.error ? <ErrorBanner message={friendlyError(q.error as never)} /> : null}
      {data && data.rows.length === 0 ? <Muted>{STR.awChatsNone}</Muted> : null}
      {data?.rows.map((c) => (
        <Card key={c.id} onPress={() => onOpen(c.id)}>
          <Body style={{ fontWeight: "700" }}>{c.title}</Body>
          <Muted>{fill(STR.awChatMeta, { turns: c.turns, who: c.startedByName ?? "—", when: isoDateTimeLabel(c.lastAt) })}</Muted>
        </Card>
      ))}
      {data ? <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} /> : null}
    </>
  );
}
