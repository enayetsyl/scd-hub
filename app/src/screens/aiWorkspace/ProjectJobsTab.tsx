/**
 * The Batch jobs tab of a project (AI Workspace W-4): jobs newest first with progress and
 * cost, and "new batch job" (editors).
 */
import React from "react";
import { useQuery } from "urql";
import { AI_JOBS_PAGE } from "../../graphql/aiWorkspaceJobs";
import type { AiProjectT } from "../../graphql/aiWorkspace";
import { Card, Body, Muted, Button, Loader, ErrorBanner, Badge } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { usePageState } from "../../lib/paging";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { fill, usd } from "./aiWorkspaceUi";
import { jobStatusLabel } from "./jobUi";

const PAGE_SIZE = 20;

export function ProjectJobsTab({ project, onOpen, onNew }: { project: AiProjectT; onOpen: (jobId: string) => void; onNew: () => void }): React.ReactElement {
  const [page, setPage] = usePageState(project.id);
  const [q] = useQuery({ query: AI_JOBS_PAGE, variables: { projectId: project.id, page, pageSize: PAGE_SIZE }, requestPolicy: "cache-and-network" });
  const data = q.data?.aiJobsPage;
  return (
    <>
      <Muted>{STR.awJobWorkerNote}</Muted>
      {project.myRole !== "viewer" && !project.archived ? <Button title={STR.awNewJob} onPress={onNew} /> : null}
      {q.fetching && !data ? <Loader /> : null}
      {q.error ? <ErrorBanner message={friendlyError(q.error as never)} /> : null}
      {data && data.rows.length === 0 ? <Muted>{STR.awJobsNone}</Muted> : null}
      {data?.rows.map((j) => (
        <Card key={j.id} onPress={() => onOpen(j.id)}>
          <Body style={{ fontWeight: "700" }}>{j.title}</Body>
          <Badge text={jobStatusLabel(j.status)} tone={j.status === "done" ? "ok" : j.status === "failed" ? "danger" : "info"} />
          <Muted>{fill(STR.awJobProgress, { done: j.done, total: j.total, failed: j.failed, cost: usd(j.costUsd) })}</Muted>
          {j.origin === "claude" ? <Badge text={STR.awFromClaude} tone="info" /> : null}
        </Card>
      ))}
      {data ? <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} /> : null}
    </>
  );
}
