/**
 * The Drafts tab of a project (AI Workspace W-3): drafts newest first, active or archived,
 * and "new draft". Approved drafts show their badge.
 */
import React from "react";
import { useQuery } from "urql";
import { AI_DRAFTS_PAGE } from "../../graphql/aiWorkspaceDrafts";
import type { AiProjectT } from "../../graphql/aiWorkspace";
import { Card, Body, Muted, Button, Loader, ErrorBanner, Badge, Chip, ChipRow } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { usePageState } from "../../lib/paging";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { fill } from "./aiWorkspaceUi";
import { kindLabel } from "./draftUi";

const PAGE_SIZE = 20;

export function ProjectDraftsTab({ project, onOpen, onNew }: { project: AiProjectT; onOpen: (draftId: string) => void; onNew: () => void }): React.ReactElement {
  const [archived, setArchived] = React.useState(false);
  const [page, setPage] = usePageState(`${project.id}:${archived}`);
  const [q] = useQuery({ query: AI_DRAFTS_PAGE, variables: { projectId: project.id, archived, page, pageSize: PAGE_SIZE }, requestPolicy: "cache-and-network" });
  const data = q.data?.aiDraftsPage;
  return (
    <>
      {project.myRole !== "viewer" && !project.archived ? <Button title={STR.awNewDraft} onPress={onNew} /> : null}
      <ChipRow>
        <Chip label={STR.awActive} selected={!archived} onPress={() => setArchived(false)} />
        <Chip label={STR.awArchived} selected={archived} onPress={() => setArchived(true)} />
      </ChipRow>
      {q.fetching && !data ? <Loader /> : null}
      {q.error ? <ErrorBanner message={friendlyError(q.error as never)} /> : null}
      {data && data.rows.length === 0 ? <Muted>{STR.awDraftsNone}</Muted> : null}
      {data?.rows.map((d) => (
        <Card key={d.id} onPress={() => onOpen(d.id)}>
          <Body style={{ fontWeight: "700" }}>{d.title}</Body>
          <Muted>{fill(STR.awDraftMeta, { v: d.currentVersion, kind: kindLabel(d.kind), who: d.createdByName ?? "—" })}</Muted>
          <Badge text={d.status === "approved" ? STR.awStatusApproved : STR.awStatusDraft} tone={d.status === "approved" ? "ok" : "muted"} />
          {d.origin === "claude" ? <Badge text={STR.awFromClaude} tone="info" /> : null}
        </Card>
      ))}
      {data ? <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} /> : null}
    </>
  );
}
