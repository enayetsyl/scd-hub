/**
 * The Files tab of a project (AI Workspace W-1, D-#1227): add a file, see how it was read
 * (text / OCR on the server / Gemini) and its tokens, pin / unpin, read it again with OCR or
 * Gemini, view the text, open the original, delete. Refreshes itself while a file is being read.
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import { AI_PROJECT_FILES_PAGE, DELETE_AI_PROJECT_FILE, REREAD_AI_PROJECT_FILE, UPDATE_AI_PROJECT_FILE, type AiProjectFileT, type AiProjectT } from "../../graphql/aiWorkspace";
import { Card, Body, Muted, Button, Notice, Loader, ErrorBanner, Badge } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { usePageState } from "../../lib/paging";
import { FILE_VIEW_SUPPORTED, openStoredFile, pickAndUploadAiWorkspaceFile } from "../../lib/files";
import { useConfirm } from "../../state/ConfirmContext";
import { useToast } from "../../state/ToastContext";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { fill, isScanLike, kTokens, textSourceLabel, tokenMethodLabel } from "./aiWorkspaceUi";

const PAGE_SIZE = 50;
const POLL_MS = 4000;

function FileCard({ f, canEdit, onViewText, onChanged }: { f: AiProjectFileT; canEdit: boolean; onViewText: () => void; onChanged: () => void }): React.ReactElement {
  const { confirmAction } = useConfirm();
  const toast = useToast();
  const [, update] = useMutation(UPDATE_AI_PROJECT_FILE);
  const [, reread] = useMutation(REREAD_AI_PROJECT_FILE);
  const [, del] = useMutation(DELETE_AI_PROJECT_FILE);
  const [busy, setBusy] = React.useState(false);

  async function run(p: Promise<{ error?: unknown }>, ok?: string): Promise<void> {
    setBusy(true);
    const res = await p;
    setBusy(false);
    if (res.error) toast.show(friendlyError(res.error as never), "danger");
    else if (ok) toast.show(ok, "ok");
    onChanged();
  }

  async function onDelete(): Promise<void> {
    const ok = await confirmAction({ title: STR.awDelete, message: STR.awDeleteConfirm, confirmLabel: STR.awDelete, tone: "danger" });
    if (ok) await run(del({ fileId: f.id }));
  }

  const status =
    f.status === "processing" ? (
      <Badge text={STR.awFileStatusProcessing} tone="info" />
    ) : f.status === "failed" ? (
      <Badge text={STR.awFileStatusFailed} tone="danger" />
    ) : (
      <Badge text={f.pinned ? STR.awPinned : STR.awFileStatusReady} tone={f.pinned ? "ok" : "muted"} />
    );

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(1), flexWrap: "wrap" }}>
        <Body style={{ fontWeight: "700", flexShrink: 1 }}>{f.name}</Body>
        {status}
      </View>
      {f.status === "ready" ? (
        <Muted>
          {fill(STR.awFileMeta, { tokens: kTokens(f.tokenCount), method: tokenMethodLabel(f.tokenMethod), source: textSourceLabel(f.textSource) })}
          {f.pages ? ` · ${f.pages} p` : ""}
        </Muted>
      ) : null}
      {f.error ? <Notice tone={f.status === "failed" ? "danger" : "info"} message={f.error} /> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
        {f.status === "ready" ? <Button title={STR.awViewText} variant="secondary" onPress={onViewText} /> : null}
        {canEdit && f.status === "ready" ? (
          <Button title={f.pinned ? STR.awUnpin : STR.awPin} variant="secondary" loading={busy} onPress={() => void run(update({ fileId: f.id, pinned: !f.pinned }))} />
        ) : null}
        {canEdit && f.status !== "processing" && isScanLike(f) ? (
          <>
            <Button title={STR.awReadOcr} variant="secondary" loading={busy} onPress={() => void run(reread({ fileId: f.id, mode: "tesseract" }))} />
            <Button title={STR.awReadGemini} variant="secondary" loading={busy} onPress={() => void run(reread({ fileId: f.id, mode: "gemini" }))} />
          </>
        ) : null}
        {FILE_VIEW_SUPPORTED && f.storedFileId ? <Button title={STR.awOpenOriginal} variant="secondary" onPress={() => void openStoredFile(f.storedFileId!)} /> : null}
        {canEdit && f.status !== "processing" ? <Button title={STR.awDelete} variant="danger" loading={busy} onPress={() => void onDelete()} /> : null}
      </View>
    </Card>
  );
}

export function ProjectFilesTab({ project, onViewText, onChanged }: { project: AiProjectT; onViewText: (fileId: string) => void; onChanged: () => void }): React.ReactElement {
  const toast = useToast();
  const [page, setPage] = usePageState(project.id);
  const [q, refetch] = useQuery({ query: AI_PROJECT_FILES_PAGE, variables: { projectId: project.id, page, pageSize: PAGE_SIZE }, requestPolicy: "cache-and-network" });
  const [uploading, setUploading] = React.useState(false);
  const canEdit = project.myRole !== "viewer";
  const data = q.data?.aiProjectFilesPage;
  const processing = !!data?.rows.some((r) => r.status === "processing");

  const refresh = React.useCallback(() => {
    refetch({ requestPolicy: "network-only" });
    onChanged();
  }, [refetch, onChanged]);

  // While a file is being read, look again every few seconds.
  React.useEffect(() => {
    if (!processing) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [processing, refresh]);

  async function onUpload(): Promise<void> {
    setUploading(true);
    try {
      const r = await pickAndUploadAiWorkspaceFile(project.id);
      if (r) toast.show(STR.awUploaded, "ok");
    } catch (e) {
      toast.show((e as Error).message, "danger");
    } finally {
      setUploading(false);
      refresh();
    }
  }

  return (
    <>
      {canEdit ? (
        <Card>
          <Button title={STR.awUpload} onPress={() => void onUpload()} loading={uploading} />
          <Muted>{STR.awUploadHelp}</Muted>
        </Card>
      ) : null}
      {q.fetching && !data ? <Loader /> : null}
      {q.error ? <ErrorBanner message={friendlyError(q.error as never)} /> : null}
      {data && data.rows.length === 0 ? <Muted>{STR.awFilesNone}</Muted> : null}
      {data?.rows.map((f) => (
        <FileCard key={f.id} f={f} canEdit={canEdit} onViewText={() => onViewText(f.id)} onChanged={refresh} />
      ))}
      {data ? <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} /> : null}
    </>
  );
}
