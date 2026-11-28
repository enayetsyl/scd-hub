/**
 * Change after final (RF-2, owner 25 Nov 2026).
 *
 *   GoldChangeAsk     — on a row of the reviewer's "চূড়ান্ত" fold: "পরিবর্তনের প্রস্তাব" (comment mandatory,
 *                       an optional corrected text for a question). Shows the request's state once sent,
 *                       including the Principal's "বাতিল" + note.
 *   GoldChangeSection — the Principal's "চূড়ান্তের পরিবর্তন অনুরোধ (n)": for each request the reviewer's
 *                       comment at the TOP and the gold item BELOW it (the question with its options and
 *                       answer, or the plan folded), then অনুমোদন / বাতিল on the same card (owner add 26 Nov).
 *   PlanMarkdownFold  — the plan text in a closed fold; loads only when opened.
 *
 * Approving takes the item OUT of gold (back to draft) — the owner's option A.
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import { ARTIFACT_QUERY } from "../graphql/operations";
import {
  DECIDE_GOLD_CHANGE,
  GOLD_CHANGE_REQUESTS,
  REQUEST_GOLD_CHANGE,
  type GoldChangeRequestT,
} from "../graphql/reviewFolds";
import { Badge, Body, Button, Card, EmptyState, ErrorBanner, Field, Loader, Muted, Notice } from "./ui";
import { FoldCard } from "./FoldCard";
import Markdown from "./Markdown";
import { AnswerCarrier } from "./QuestionAnswer";
import { STR, bnNum, classLevelLabel, subjectLabel, docTypeLabel } from "../lib/labels";
import { parsePayload } from "../lib/question";
import { friendlyError } from "../lib/errors";
import { useColors } from "../theme";
import { space } from "../theme/tokens";

/** The plan's text, in a closed fold; the query runs only once it is opened. */
export function PlanMarkdownFold({ artifactId }: { artifactId: string }): React.ReactElement {
  return (
    <FoldCard id={`rfplan:${artifactId}`} title={STR.rfPlanFold}>
      <PlanMarkdownBody artifactId={artifactId} />
    </FoldCard>
  );
}

function PlanMarkdownBody({ artifactId }: { artifactId: string }): React.ReactElement {
  const [{ data, fetching, error }] = useQuery({ query: ARTIFACT_QUERY, variables: { id: artifactId } });
  if (fetching) return <Loader label={STR.loading} />;
  if (error) return <ErrorBanner message={friendlyError(error)} />;
  const md = data?.artifact?.renderedMarkdown;
  return md ? <Markdown source={md} /> : <Notice message={STR.noMarkdown} tone="warn" />;
}

/** "subject · class · পাঠ N [· সেশন K]" */
function requestTitle(r: GoldChangeRequestT): string {
  const session = r.docType === "session_plan" && r.sessionIndex != null ? ` · ${STR.spSession} ${bnNum(r.sessionIndex)}` : "";
  const title = r.title ? ` · ${r.title}` : "";
  return `${subjectLabel(r.subject)} · ${classLevelLabel(r.classLevel)} · ${r.anchorWord} ${bnNum(r.addressNumber)}${session}${title}`;
}

// ---------------------------------------------------------------------------
// The reviewer's side
// ---------------------------------------------------------------------------

export function GoldChangeAsk({
  artifactId,
  isQuestion,
  existing,
  onSent,
}: {
  artifactId: string;
  isQuestion: boolean;
  /** The caller's latest request on this item, if any. */
  existing: GoldChangeRequestT | undefined;
  onSent: () => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [comment, setComment] = React.useState("");
  const [proposal, setProposal] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [, request] = useMutation(REQUEST_GOLD_CHANGE);

  async function send(): Promise<void> {
    if (comment.trim() === "" || busy) return;
    setBusy(true);
    setFailure(null);
    const res = await request({
      artifactId,
      comment: comment.trim(),
      proposal: isQuestion && proposal.trim() !== "" ? proposal.trim() : undefined,
    });
    setBusy(false);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    setOpen(false);
    setComment("");
    setProposal("");
    onSent();
  }

  if (existing?.status === "OPEN") return <Notice message={STR.rfRequestWaiting} tone="info" />;
  return (
    <View style={{ marginTop: space(2) }}>
      {existing?.status === "REJECTED" ? (
        <Notice message={`${STR.rfRequestRejected}${existing.note ? `: ${existing.note}` : ""}`} tone="warn" />
      ) : null}
      {open ? (
        <View>
          <Field label={STR.rfRequestComment} value={comment} onChangeText={setComment} multiline />
          {isQuestion ? <Field label={STR.rfProposalText} value={proposal} onChangeText={setProposal} multiline /> : null}
          {failure ? <ErrorBanner message={failure} /> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
            <Button title={STR.rfSendRequest} loading={busy} disabled={comment.trim() === ""} onPress={() => void send()} />
            <Button title={STR.cancel} variant="ghost" onPress={() => setOpen(false)} />
          </View>
        </View>
      ) : (
        <Button title={STR.rfRequestChange} variant="secondary" onPress={() => setOpen(true)} />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The Principal's side
// ---------------------------------------------------------------------------

function RequestCard({ r, onDecided }: { r: GoldChangeRequestT; onDecided: (status: string) => void }): React.ReactElement {
  const colors = useColors();
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<"approve" | "reject" | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [, decide] = useMutation(DECIDE_GOLD_CHANGE);
  const isQuestion = r.docType === "question";

  async function run(approve: boolean): Promise<void> {
    setBusy(approve ? "approve" : "reject");
    setFailure(null);
    const res = await decide({ requestId: r.id, approve, note: note.trim() !== "" ? note.trim() : undefined });
    setBusy(null);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    onDecided(res.data?.decideGoldChange?.status ?? "");
  }

  return (
    <Card style={{ marginBottom: space(3) }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginBottom: space(1) }}>
        <Badge text={docTypeLabel(r.docType)} tone="info" />
        <Badge text={subjectLabel(r.subject)} />
        <Badge text={classLevelLabel(r.classLevel)} />
      </View>
      <Body style={{ fontWeight: "700" }}>{requestTitle(r)}</Body>
      {/* The comment FIRST, the item right under it - the Principal decides with both on one screen. */}
      <Muted style={{ marginTop: space(2) }}>
        {STR.rfGcComment}
        {r.reviewerName ? ` · ${r.reviewerName}` : ""}
      </Muted>
      <Body>{r.comment}</Body>
      {r.proposalJson ? (
        <>
          <Muted style={{ marginTop: space(2) }}>{STR.rfGcProposal}</Muted>
          <Body>{r.proposalJson}</Body>
        </>
      ) : null}
      <View style={{ marginTop: space(2) }}>
        <Muted>{STR.rfGcItem}</Muted>
        {isQuestion ? (
          <>
            <Body>{r.questionText ?? r.qid ?? "—"}</Body>
            <View style={{ marginTop: space(1) }}>
              <AnswerCarrier payload={parsePayload(r.payloadJson)} correctColor={colors.primary} />
            </View>
          </>
        ) : (
          <PlanMarkdownFold artifactId={r.artifactId} />
        )}
      </View>
      <Field label={STR.rfGcNote} value={note} onChangeText={setNote} multiline />
      <Muted>{STR.rfGcApproveHint}</Muted>
      {failure ? <ErrorBanner message={failure} /> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
        <Button title={STR.rfGcApprove} loading={busy === "approve"} disabled={busy !== null} onPress={() => void run(true)} />
        <Button title={STR.rfGcReject} variant="danger" loading={busy === "reject"} disabled={busy !== null} onPress={() => void run(false)} />
      </View>
    </Card>
  );
}

/**
 * The Principal's open requests. `kind` narrows to plans or questions (the publish screen shows
 * questions only); the server already limits the list to the kinds the caller may decide.
 */
export function GoldChangeSection({
  kind,
  enabled,
  onChanged,
}: {
  kind?: "plan" | "question";
  enabled: boolean;
  onChanged?: () => void;
}): React.ReactElement | null {
  const [{ data, fetching, error }, refetch] = useQuery({
    query: GOLD_CHANGE_REQUESTS,
    variables: { status: "OPEN" },
    pause: !enabled,
    requestPolicy: "cache-and-network",
  });
  const [done, setDone] = React.useState<string | null>(null);
  if (!enabled) return null;
  const rows = (data?.goldChangeRequests ?? []).filter((r) =>
    kind === "question" ? r.docType === "question" : kind === "plan" ? r.docType !== "question" : true,
  );
  // Nothing waiting and nothing to say: stay out of the way.
  if (!fetching && !error && rows.length === 0 && !done) return null;
  return (
    <FoldCard
      id={`rfgc:${kind ?? "all"}`}
      title={STR.rfGcTitle}
      aside={<Badge text={bnNum(rows.length)} tone={rows.length > 0 ? "warn" : "muted"} />}
    >
      {error ? <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} /> : null}
      {done ? <Notice message={done === "OBSOLETE" ? STR.rfGcObsolete : STR.rfGcDone} tone={done === "OBSOLETE" ? "warn" : "ok"} /> : null}
      {fetching && rows.length === 0 ? <Loader label={STR.loading} /> : null}
      {!fetching && rows.length === 0 ? <EmptyState message={STR.rfGcNone} /> : null}
      {rows.map((r) => (
        <RequestCard
          key={r.id}
          r={r}
          onDecided={(status) => {
            setDone(status || "DONE");
            refetch({ requestPolicy: "network-only" });
            onChanged?.();
          }}
        />
      ))}
    </FoldCard>
  );
}
