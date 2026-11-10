/**
 * AiWorkspaceHomeScreen (AI Workspace W-1, docs/prd-ai-workspace.md §3) — my projects, newest
 * first (paged, D-#761), active or archived, and "new project". The Principal
 * (`ai_workspace:admin`) sees every project.
 */
import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { AI_PROJECTS_PAGE, type AiProjectT } from "../../graphql/aiWorkspace";
import type { AiWorkspaceStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Notice, Loader, ErrorBanner, Chip, ChipRow, Badge } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { usePageState } from "../../lib/paging";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { fill, modelLabel, roleLabel } from "./aiWorkspaceUi";
import { ClaudeConnectionCard } from "./ClaudeConnectionCard";
import { useAuth } from "../../auth/AuthContext";

type Props = NativeStackScreenProps<AiWorkspaceStackParamList, "AiWorkspaceHome">;
const PAGE_SIZE = 20;

function ProjectCard({ p, onPress }: { p: AiProjectT; onPress: () => void }): React.ReactElement {
  return (
    <Card onPress={onPress}>
      <Body style={{ fontWeight: "700" }}>{p.name}</Body>
      {p.description ? <Body numberOfLines={2}>{p.description}</Body> : null}
      <Muted>{fill(STR.awCardMeta, { files: p.fileCount, role: roleLabel(p.myRole), model: modelLabel(p.defaultModel) })}</Muted>
      {p.nameProtection ? <Badge text={`${STR.awNameProtection}: ${STR.awOn}`} tone="info" /> : null}
    </Card>
  );
}

export default function AiWorkspaceHomeScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const [archived, setArchived] = React.useState(false);
  const [page, setPage] = usePageState(archived);
  const [q] = useQuery({ query: AI_PROJECTS_PAGE, variables: { archived, page, pageSize: PAGE_SIZE }, requestPolicy: "cache-and-network" });
  const data = q.data?.aiProjectsPage;
  return (
    <Screen scroll>
      <Notice tone="info" message={STR.awIntro} />
      <Button title={STR.awNewProject} onPress={() => navigation.navigate("AiProjectNew")} />
      <ChipRow>
        <Chip label={STR.awActive} selected={!archived} onPress={() => setArchived(false)} />
        <Chip label={STR.awArchived} selected={archived} onPress={() => setArchived(true)} />
      </ChipRow>
      {q.fetching && !data ? <Loader /> : null}
      {q.error ? <ErrorBanner message={friendlyError(q.error as never)} /> : null}
      {data && data.rows.length === 0 ? <Muted>{STR.awNone}</Muted> : null}
      {data?.rows.map((p) => (
        <ProjectCard key={p.id} p={p} onPress={() => navigation.navigate("AiProject", { projectId: p.id })} />
      ))}
      {data ? <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} /> : null}
      {can("ai_workspace:admin") ? <ClaudeConnectionCard /> : null}
    </Screen>
  );
}
