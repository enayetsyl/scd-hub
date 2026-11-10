/**
 * AiDraftScreen (AI Workspace W-3, docs/prd-ai-workspace.md §5) — one draft.
 *
 *   read      the current version (Markdown / JSON; a lesson plan shows both parts)
 *   edit      saves the next version (an approved draft becomes a draft again)
 *   approve   owner — locks the current version
 *   revise    notes + the three pickers → DeepSeek writes the next version (now / off-peak)
 *   export    Word / PDF, no AI
 *   send      approved + the pipeline's permission: "check first" (dry run + what it replaces),
 *             then "confirm — send" (D-#1229). The validator decides; failures are shown as-is.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery, useClient } from "urql";
import {
  AI_DRAFT,
  AI_DRAFT_SEND_PREVIEW,
  AI_DRAFT_VERSIONS_PAGE,
  APPROVE_AI_DRAFT,
  CANCEL_AI_DRAFT_REVISION,
  REVISE_AI_DRAFT,
  SAVE_AI_DRAFT_VERSION,
  SEND_AI_DRAFT_TO_PIPELINE,
  SET_AI_DRAFT_ARCHIVED,
  SCORE_AI_DRAFT,
} from "../../graphql/aiWorkspaceDrafts";
import { AI_PROJECT } from "../../graphql/aiWorkspace";
import { AI_PRICE_CLOCK } from "../../graphql/aiWorkspaceChat";
import type { AiWorkspaceStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Field, Notice, Loader, ErrorBanner, Select, Badge, Chip, ChipRow, breakAnywhere } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { usePageState } from "../../lib/paging";
import { downloadAiDraft } from "../../lib/files";
import { useConfirm } from "../../state/ConfirmContext";
import { useToast } from "../../state/ToastContext";
import { STR, isoDateTimeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { fill, MODEL_OPTIONS, THINKING_OPTIONS } from "./aiWorkspaceUi";
import { dhakaTime } from "./AiProjectChatScreen";
import { isJsonKind, kindLabel, sourceLabel } from "./draftUi";

type Props = NativeStackScreenProps<AiWorkspaceStackParamList, "AiDraft">;
const CURATION_TAGS = ["KEEP_AS_IS", "NEEDS_REPLACEMENT", "FLEXIBLE"];
const pilotLabel = (s: string) => (s === "usable" ? STR.awPilotUsable : s === "minor" ? STR.awPilotMinor : STR.awPilotRewrite);

export default function AiDraftScreen({ route, navigation }: Props): React.ReactElement {
  const { draftId } = route.params;
  const toast = useToast();
  const client = useClient();
  const { confirmAction } = useConfirm();
  const [q, refetch] = useQuery({ query: AI_DRAFT, variables: { id: draftId }, requestPolicy: "cache-and-network" });
  const projectId = q.data?.aiDraft.draft.projectId;
  const [pq] = useQuery({ query: AI_PROJECT, variables: { id: projectId ?? "" }, pause: !projectId });
  const [cq] = useQuery({ query: AI_PRICE_CLOCK });
  const [vPage, setVPage] = usePageState(draftId);
  const [vq, refetchVersions] = useQuery({ query: AI_DRAFT_VERSIONS_PAGE, variables: { draftId, page: vPage, pageSize: 10 }, requestPolicy: "cache-and-network" });
  const [, saveVersion] = useMutation(SAVE_AI_DRAFT_VERSION);
  const [, approve] = useMutation(APPROVE_AI_DRAFT);
  const [, revise] = useMutation(REVISE_AI_DRAFT);
  const [, cancelRevise] = useMutation(CANCEL_AI_DRAFT_REVISION);
  const [, send] = useMutation(SEND_AI_DRAFT_TO_PIPELINE);
  const [, archive] = useMutation(SET_AI_DRAFT_ARCHIVED);
  const [, score] = useMutation(SCORE_AI_DRAFT);

  const [editing, setEditing] = React.useState(false);
  const [body, setBody] = React.useState("");
  const [planJson, setPlanJson] = React.useState("");
  const [note, setNote] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [model, setModel] = React.useState("deepseek-flash");
  const [thinking, setThinking] = React.useState("high");
  const [runAt, setRunAt] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<{ verdict: string | null; failChecks: string[]; replaces: string | null; adds: string } | null>(null);
  const [curation, setCuration] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const d = q.data?.aiDraft.draft;
  const v = q.data?.aiDraft.version;
  const role = pq.data?.aiProject.myRole ?? "viewer";
  const canEdit = role !== "viewer";
  const reviseActive = d?.revise && (d.revise.status === "running" || d.revise.status === "queued");

  const refresh = React.useCallback(() => {
    refetch({ requestPolicy: "network-only" });
    refetchVersions({ requestPolicy: "network-only" });
  }, [refetch, refetchVersions]);

  React.useEffect(() => {
    if (d) navigation.setOptions({ title: d.title });
  }, [d, navigation]);
  // A running revision: look again every few seconds.
  React.useEffect(() => {
    if (d?.revise?.status !== "running") return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [d?.revise?.status, refresh]);

  if (q.fetching && !d) return <Screen><Loader /></Screen>;
  if (q.error || !d || !v) return <Screen><ErrorBanner message={friendlyError(q.error as never)} /></Screen>;

  async function run<T>(key: string, p: Promise<{ error?: unknown; data?: T }>, ok?: string): Promise<T | undefined> {
    setBusy(key);
    const res = await p;
    setBusy(null);
    if (res.error) {
      toast.show(friendlyError(res.error as never), "danger");
      return undefined;
    }
    if (ok) toast.show(ok, "ok");
    refresh();
    return res.data;
  }

  async function onPreview(): Promise<void> {
    setBusy("preview");
    const res = await client.query(AI_DRAFT_SEND_PREVIEW, { draftId }, { requestPolicy: "network-only" }).toPromise();
    setBusy(null);
    if (res.error || !res.data) return toast.show(friendlyError(res.error as never), "danger");
    setPreview(res.data.aiDraftSendPreview);
  }

  async function onSend(): Promise<void> {
    const ok = await confirmAction({ title: STR.awSendTitle, message: STR.awSendConfirmMsg, confirmLabel: STR.awSendConfirm, tone: "danger" });
    if (!ok) return;
    const data = await run("send", send({ draftId, confirm: true, curationTag: curation }));
    if (data) {
      const r = data.sendAiDraftToPipeline;
      toast.show(fill(r.ok ? STR.awSendDone : STR.awSendFailed, { summary: [r.summary, ...r.failChecks].join(" · ") }), r.ok ? "ok" : "danger");
      setPreview(null);
    }
  }

  async function onExport(format: "docx" | "pdf"): Promise<void> {
    setBusy(format);
    try {
      await downloadAiDraft(draftId, format);
    } catch (e) {
      toast.show((e as Error).message, "danger");
    } finally {
      setBusy(null);
    }
  }

  const clock = cq.data?.aiPriceClock;
  return (
    <Screen scroll>
      <Card>
        <Muted>{fill(STR.awDraftMeta, { v: d.currentVersion, kind: kindLabel(d.kind), who: d.createdByName ?? "—" })}</Muted>
        <Badge text={d.status === "approved" ? STR.awStatusApproved : STR.awStatusDraft} tone={d.status === "approved" ? "ok" : "muted"} />
        {d.approvedVersion !== null ? <Muted>{fill(STR.awApprovedNote, { v: d.approvedVersion, who: d.approvedByName ?? "—" })}</Muted> : null}
        {d.approvedVersion !== null && d.status !== "approved" ? <Notice tone="warn" message={STR.awChangedSinceApproval} /> : null}
        {d.origin === "claude" ? <Badge text={STR.awFromClaude} tone="info" /> : null}
      </Card>

      {editing ? (
        <Card>
          <Field label={isJsonKind(d.kind) ? STR.awDraftJsonBody : STR.awDraftBody} value={body} onChangeText={setBody} multiline inputStyle={{ minHeight: 260 }} />
          {d.kind === "lesson_plan" ? <Field label={STR.awDraftPlanJson} value={planJson} onChangeText={setPlanJson} multiline inputStyle={{ minHeight: 160 }} /> : null}
          <Field label={STR.awDraftNote} value={note} onChangeText={setNote} />
          <View style={{ flexDirection: "row", gap: space(1), marginTop: space(1) }}>
            <Button
              title={STR.awDraftSaveVersion}
              loading={busy === "save"}
              onPress={async () => {
                const ok = await run("save", saveVersion({ draftId, body, planJson: d.kind === "lesson_plan" ? planJson : null, note: note || null }), STR.awSaved);
                if (ok) setEditing(false);
              }}
            />
            <Button title={STR.awCancel} variant="secondary" onPress={() => setEditing(false)} />
          </View>
        </Card>
      ) : (
        <Card>
          <Body style={breakAnywhere}>{v.body}</Body>
          {v.planJson ? <Muted style={breakAnywhere}>{v.planJson}</Muted> : null}
          <Muted>{fill(STR.awVersionLine, { v: v.version, source: sourceLabel(v.source), when: isoDateTimeLabel(v.at), by: v.createdByName ? ` · ${v.createdByName}` : "" })}</Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
            {canEdit && !reviseActive ? (
              <Button
                title={STR.awDraftEdit}
                variant="secondary"
                onPress={() => {
                  setBody(v.body);
                  setPlanJson(v.planJson ?? "");
                  setNote("");
                  setEditing(true);
                }}
              />
            ) : null}
            {role === "owner" && d.status !== "approved" ? <Button title={STR.awApprove} loading={busy === "approve"} onPress={() => void run("approve", approve({ draftId }), STR.awSaved)} /> : null}
            <Button title={STR.awExportDocx} variant="secondary" loading={busy === "docx"} onPress={() => void onExport("docx")} />
            <Button title={STR.awExportPdf} variant="secondary" loading={busy === "pdf"} onPress={() => void onExport("pdf")} />
          </View>
        </Card>
      )}

      {canEdit ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.awRevise}</Body>
          {d.revise?.status === "running" ? <Notice tone="info" message={STR.awReviseRunning} /> : null}
          {d.revise?.status === "queued" && d.revise.runAfter ? (
            <>
              <Notice tone="info" message={fill(STR.awReviseQueued, { time: dhakaTime(d.revise.runAfter) })} />
              <Button title={STR.awCancel} variant="secondary" onPress={() => void run("cancel", cancelRevise({ draftId }))} />
            </>
          ) : null}
          {d.revise?.status === "failed" && d.revise.error ? <Notice tone="danger" message={d.revise.error} /> : null}
          {!reviseActive ? (
            <>
              <Field label={STR.awReviseNotes} value={notes} onChangeText={setNotes} multiline autoCapitalize="sentences" />
              <Select label={STR.awModel} value={model} options={MODEL_OPTIONS()} onChange={setModel} />
              <Select label={STR.awThinking} value={thinking} options={THINKING_OPTIONS()} onChange={setThinking} />
              <Select
                label={STR.awRun}
                value={runAt}
                placeholder={STR.awRunPick}
                options={[
                  { label: clock?.peak ? STR.awRunNowPeak : STR.awRunNowOff, value: "now" },
                  { label: STR.awRunOffpeak, value: "offpeak" },
                ]}
                onChange={setRunAt}
              />
              <Button
                title={STR.awReviseRun}
                loading={busy === "revise"}
                disabled={notes.trim().length < 2 || !runAt}
                onPress={async () => {
                  const ok = await run("revise", revise({ draftId, notes, model, thinking, runAt: runAt! }));
                  if (ok) setNotes("");
                }}
              />
            </>
          ) : null}
        </Card>
      ) : null}

      {d.canSend && canEdit ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.awSendTitle}</Body>
          <Button title={STR.awSendCheck} variant="secondary" loading={busy === "preview"} onPress={() => void onPreview()} />
          {preview ? (
            <>
              {preview.replaces ? <Notice tone="warn" message={fill(STR.awSendReplaces, { what: preview.replaces })} /> : null}
              {preview.adds ? <Muted>{fill(STR.awSendAdds, { what: preview.adds })}</Muted> : null}
              {preview.verdict === "FAIL" ? <Notice tone="danger" message={`${STR.awSendVerdictFail} ${preview.failChecks.join(" · ")}`} /> : null}
              {d.kind === "question_bank" ? (
                <Select label={STR.awCuration} value={curation} options={CURATION_TAGS.map((t) => ({ label: t, value: t }))} onChange={setCuration} />
              ) : null}
              <Button
                title={STR.awSendConfirm}
                variant="danger"
                loading={busy === "send"}
                disabled={preview.verdict === "FAIL" || (d.kind === "question_bank" && !curation)}
                onPress={() => void onSend()}
              />
            </>
          ) : null}
        </Card>
      ) : null}

      {role === "owner" || d.review ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.awPilotTitle}</Body>
          <Muted>{STR.awPilotHelp}</Muted>
          {d.review ? <Muted>{fill(STR.awPilotDone, { score: pilotLabel(d.review.score), v: d.review.version, who: d.review.byName ?? "—" })}</Muted> : null}
          {role === "owner" ? (
            <ChipRow>
              {(["usable", "minor", "rewrite"] as const).map((s) => (
                <Chip key={s} label={pilotLabel(s)} selected={d.review?.score === s && d.review.version === d.currentVersion} onPress={() => void run("score", score({ draftId, score: s }), STR.awSaved)} />
              ))}
            </ChipRow>
          ) : null}
        </Card>
      ) : null}

      {d.sends.length ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.awSends}</Body>
          {d.sends.map((s, i) => (
            <Muted key={i}>{`${isoDateTimeLabel(s.at)} · v${s.version} · ${s.ok ? "✓" : "✗"} ${s.summary}`}</Muted>
          ))}
        </Card>
      ) : null}

      {vq.data && vq.data.aiDraftVersionsPage.total > 1 ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.awVersions}</Body>
          {vq.data.aiDraftVersionsPage.rows.map((x) => (
            <Muted key={x.id}>{fill(STR.awVersionLine, { v: x.version, source: sourceLabel(x.source), when: isoDateTimeLabel(x.at), by: x.createdByName ? ` · ${x.createdByName}` : "" })}</Muted>
          ))}
          <Pager page={vPage} pageSize={10} total={vq.data.aiDraftVersionsPage.total} onPage={setVPage} />
        </Card>
      ) : null}

      {canEdit ? (
        <Button title={STR.awArchive} variant="secondary" onPress={() => void run("archive", archive({ draftId, archived: true }), STR.awSaved).then(() => navigation.goBack())} />
      ) : null}
    </Screen>
  );
}
