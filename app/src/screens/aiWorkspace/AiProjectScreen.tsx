/**
 * AiProjectScreen (AI Workspace W-1, docs/prd-ai-workspace.md §3) — one project: the context
 * budget (instructions + pinned files in tokens, the cost of that prefix per message, this
 * month's spend) and the tabs Files / Instructions / Members / Settings.
 */
import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { AI_PROJECT, type AiProjectBudgetT } from "../../graphql/aiWorkspace";
import type { AiWorkspaceStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Notice, Loader, ErrorBanner, Chip, ChipRow } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { fill, kTokens, modelLabel, roleLabel, thinkingLabel, usd } from "./aiWorkspaceUi";
import { ProjectFilesTab } from "./ProjectFilesTab";
import { ProjectChatsTab } from "./ProjectChatsTab";
import { ProjectDraftsTab } from "./ProjectDraftsTab";
import { ProjectInstructionsTab } from "./ProjectInstructionsTab";
import { ProjectMembersTab } from "./ProjectMembersTab";
import { ProjectSettingsTab } from "./ProjectSettingsTab";

type Props = NativeStackScreenProps<AiWorkspaceStackParamList, "AiProject">;
type Tab = "chats" | "drafts" | "files" | "instructions" | "members" | "settings";

function BudgetCard({ b }: { b: AiProjectBudgetT }): React.ReactElement {
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.awBudgetTitle}</Body>
      <Muted>{fill(STR.awBudgetLine, { i: kTokens(b.instructionTokens), n: b.pinnedFiles, f: kTokens(b.fileTokens), t: kTokens(b.totalTokens), max: kTokens(b.maxTokens) })}</Muted>
      <Muted>{fill(STR.awBudgetCost, { hit: usd(b.costPerMessageCacheHitUsd), miss: usd(b.costPerMessageCacheMissUsd) })}</Muted>
      <Muted>
        {fill(STR.awBudgetSpent, { spent: usd(b.spentThisMonthUsd) })}
        {b.monthlyCapUsd !== null ? fill(STR.awBudgetCapOf, { cap: usd(b.monthlyCapUsd) }) : ""}
      </Muted>
      {b.over ? <Notice tone="danger" message={STR.awBudgetOver} /> : b.warn ? <Notice tone="warn" message={STR.awBudgetWarn} /> : null}
    </Card>
  );
}

export default function AiProjectScreen({ route, navigation }: Props): React.ReactElement {
  const { projectId } = route.params;
  const [tab, setTab] = React.useState<Tab>("chats");
  const [q, refetch] = useQuery({ query: AI_PROJECT, variables: { id: projectId }, requestPolicy: "cache-and-network" });
  const refresh = React.useCallback(() => refetch({ requestPolicy: "network-only" }), [refetch]);
  const p = q.data?.aiProject;
  const b = q.data?.aiProjectContextBudget;

  React.useEffect(() => {
    if (p) navigation.setOptions({ title: p.name });
  }, [p, navigation]);

  if (q.fetching && !p) return <Screen><Loader /></Screen>;
  if (q.error || !p || !b) return <Screen><ErrorBanner message={friendlyError(q.error as never)} /></Screen>;

  return (
    <Screen scroll>
      <Card>
        {p.description ? <Body>{p.description}</Body> : null}
        <Muted>{`${roleLabel(p.myRole)} · ${modelLabel(p.defaultModel)} · ${STR.awThinking}: ${thinkingLabel(p.defaultThinking)}`}</Muted>
        <Muted>{`${STR.awNameProtection}: ${p.nameProtection ? STR.awOn : STR.awOff}`}</Muted>
        {p.archived ? <Notice tone="info" message={STR.awArchived} /> : null}
      </Card>
      <BudgetCard b={b} />
      <ChipRow>
        <Chip label={STR.awTabChats} selected={tab === "chats"} onPress={() => setTab("chats")} />
        <Chip label={STR.awTabDrafts} selected={tab === "drafts"} onPress={() => setTab("drafts")} />
        <Chip label={STR.awTabFiles} selected={tab === "files"} onPress={() => setTab("files")} />
        <Chip label={STR.awTabInstructions} selected={tab === "instructions"} onPress={() => setTab("instructions")} />
        <Chip label={STR.awTabMembers} selected={tab === "members"} onPress={() => setTab("members")} />
        <Chip label={STR.awTabSettings} selected={tab === "settings"} onPress={() => setTab("settings")} />
      </ChipRow>
      {tab === "chats" ? (
        <ProjectChatsTab project={p} onOpen={(sessionId) => navigation.navigate("AiProjectChat", { sessionId, canEdit: p.myRole !== "viewer" && !p.archived })} />
      ) : null}
      {tab === "drafts" ? (
        <ProjectDraftsTab project={p} onOpen={(draftId) => navigation.navigate("AiDraft", { draftId })} onNew={() => navigation.navigate("AiDraftNew", { projectId: p.id })} />
      ) : null}
      {tab === "files" ? <ProjectFilesTab project={p} onChanged={refresh} onViewText={(fileId) => navigation.navigate("AiProjectFileText", { fileId })} /> : null}
      {tab === "instructions" ? <ProjectInstructionsTab project={p} onChanged={refresh} /> : null}
      {tab === "members" ? <ProjectMembersTab project={p} onChanged={refresh} /> : null}
      {tab === "settings" ? <ProjectSettingsTab project={p} onChanged={refresh} /> : null}
    </Screen>
  );
}
