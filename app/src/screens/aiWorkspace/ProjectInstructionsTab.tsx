/**
 * The Instructions tab (AI Workspace W-1, D-#1202): the current instructions, saved as a new
 * version (which becomes the current one), and the earlier versions (paged).
 */
import React from "react";
import { Pressable, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { AI_PROJECT_INSTRUCTIONS, SAVE_AI_PROJECT_INSTRUCTIONS, type AiProjectT } from "../../graphql/aiWorkspace";
import { Card, Body, Muted, Button, Field, Notice, Loader, ErrorBanner, Badge, breakAnywhere } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { usePageState } from "../../lib/paging";
import { useToast } from "../../state/ToastContext";
import { STR, isoDateTimeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { fill } from "./aiWorkspaceUi";

const PAGE_SIZE = 10;

export function ProjectInstructionsTab({ project, onChanged }: { project: AiProjectT; onChanged: () => void }): React.ReactElement {
  const toast = useToast();
  const [page, setPage] = usePageState(project.id);
  const [q, refetch] = useQuery({ query: AI_PROJECT_INSTRUCTIONS, variables: { projectId: project.id, page, pageSize: PAGE_SIZE }, requestPolicy: "cache-and-network" });
  const [, save] = useMutation(SAVE_AI_PROJECT_INSTRUCTIONS);
  const [body, setBody] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const canEdit = project.myRole !== "viewer";
  const current = q.data?.aiProjectInstructions ?? null;
  const versions = q.data?.aiProjectInstructionVersionsPage;
  const text = body ?? current?.body ?? "";

  async function onSave(): Promise<void> {
    setBusy(true);
    setError(null);
    const res = await save({ projectId: project.id, body: text, note: note || null });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error as never));
    setBody(null);
    setNote("");
    toast.show(STR.awSaved, "ok");
    refetch({ requestPolicy: "network-only" });
    onChanged();
  }

  if (q.fetching && !q.data) return <Loader />;
  if (q.error) return <ErrorBanner message={friendlyError(q.error as never)} />;
  return (
    <>
      <Card>
        <Muted>{STR.awInstructionsHelp}</Muted>
        {current ? <Muted>{fill(STR.awInstructionsVersion, { v: current.version, when: isoDateTimeLabel(current.createdAt), by: "" })}</Muted> : <Muted>{STR.awInstructionsNone}</Muted>}
        {canEdit ? (
          <>
            <Field label={STR.awInstructionsLabel} value={text} onChangeText={setBody} multiline autoCapitalize="sentences" inputStyle={{ minHeight: 220 }} />
            <Field label={STR.awInstructionsNote} value={note} onChangeText={setNote} autoCapitalize="sentences" />
            {error ? <Notice tone="danger" message={error} /> : null}
            <View style={{ marginTop: space(2) }}>
              <Button title={STR.awInstructionsSave} onPress={() => void onSave()} loading={busy} disabled={!text.trim() || text === current?.body} />
            </View>
          </>
        ) : current ? (
          <Body style={breakAnywhere}>{current.body}</Body>
        ) : null}
      </Card>
      {versions && versions.total > 1 ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.awVersionsTitle}</Body>
          {versions.rows.map((v) => (
            <View key={v.id} style={{ marginTop: space(1) }}>
              <Pressable accessibilityRole="button" onPress={() => setOpen(open === v.id ? null : v.id)}>
                <Body>{fill(STR.awInstructionsVersion, { v: v.version, when: isoDateTimeLabel(v.createdAt), by: v.createdByName ? ` · ${v.createdByName}` : "" })}</Body>
              </Pressable>
              {v.active ? <Badge text={STR.awActive} tone="ok" /> : null}
              {v.note ? <Muted>{v.note}</Muted> : null}
              {open === v.id ? <Muted style={breakAnywhere}>{v.body}</Muted> : null}
            </View>
          ))}
          <Pager page={page} pageSize={PAGE_SIZE} total={versions.total} onPage={setPage} />
        </Card>
      ) : null}
    </>
  );
}
