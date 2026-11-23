/**
 * AssignmentDraftReviewScreen (AL-8, PRD §4.6, journeys C2 + C6) — one weekly assignment, by id: every common-part
 * item with its reason ("দুর্বল: …", "ক্লাস মিস: …", "আবার"), swap / remove / add a bank question (the server re-checks §4.3
 * and its refusal is shown as worded), each child's Part B with NEEDS_REVIEW sheets highlighted and the ways to fix them,
 * the day split label, approve / finalise (budget refusal shown), and the Office / Principal comment thread.
 *
 * Reached from the week screen, the Office list and the AS_DRAFT_READY / AS_COMMENT notifications. A substitute or the
 * Office (finalise-on-leave) sees the same controls; the server decides who may act.
 */
import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  ADD_ASSIGNMENT_COMMENT,
  APPROVE_MASTERY_ASSIGNMENT_SHEETS,
  ASSIGNMENT_COMMENTS_QUERY,
  ASSIGNMENT_FOR_REVIEW_QUERY,
  EDIT_MASTERY_ASSIGNMENT_PART_A,
  SEND_MASTERY_ASSIGNMENT,
  type AssignmentCommentRow,
  type MasteryAssignmentData,
} from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Field, Loader, Notice, H2 } from "../../components/ui";
import { AsRefusalNotice } from "../../components/AsRefusalNotice";
import { AssignmentBankPicker } from "../../components/AssignmentBankPicker";
import { STR, bnNum, getActiveLang, hwSubjectLabel, isoDateTimeLabel, masteryBandLabel } from "../../lib/labels";
import { pickDayLabel } from "../../lib/asBudget";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../state/ToastContext";
import { space, useColors } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";
import { fill } from "./masteryStateUi";

type Props = NativeStackScreenProps<MasteryStackParamList, "AssignmentDraftReview">;

const bandTone = (b: string) => (b === "WEAK" ? "danger" : b === "IMPROVING" ? "warn" : b === "REVISION" ? "info" : b === "MISSED" ? "gold" : "muted");

export default function AssignmentDraftReviewScreen({ navigation, route }: Props): React.ReactElement {
  const { assignmentId } = route.params;
  const colors = useColors();
  const { can } = useAuth();
  const toast = useToast();
  const [{ data, fetching, error }, refetch] = useQuery({
    query: ASSIGNMENT_FOR_REVIEW_QUERY,
    variables: { assignmentId },
    requestPolicy: "cache-and-network",
  });
  const [editState, editPartA] = useMutation(EDIT_MASTERY_ASSIGNMENT_PART_A);
  const [approveState, approveAll] = useMutation(APPROVE_MASTERY_ASSIGNMENT_SHEETS);
  const [sendState, send] = useMutation(SEND_MASTERY_ASSIGNMENT);
  const [commentState, addComment] = useMutation(ADD_ASSIGNMENT_COMMENT);
  const [{ data: cData }, refetchComments] = useQuery({ query: ASSIGNMENT_COMMENTS_QUERY, variables: { assignmentId }, requestPolicy: "cache-and-network" });
  useEffect(() => {
    const unsub = navigation.addListener("focus", () => {
      refetch({ requestPolicy: "network-only" });
      refetchComments({ requestPolicy: "network-only" });
    });
    return unsub;
  }, [navigation, refetch, refetchComments]);

  const fresh = (editState.data?.editMasteryAssignmentPartA ?? approveState.data?.approveMasteryAssignmentSheets ?? sendState.data?.sendMasteryAssignment) as MasteryAssignmentData | undefined;
  const loaded = data?.assignmentForReview as MasteryAssignmentData | undefined;
  const a = fresh && fresh.id === assignmentId ? fresh : loaded;
  const comments = (cData?.assignmentComments ?? []) as AssignmentCommentRow[];

  const [msg, setMsg] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const busy = editState.fetching || approveState.fetching || sendState.fetching;

  if (fetching && !a) {
    return (
      <Screen>
        <Loader />
      </Screen>
    );
  }
  if (error || !a) {
    return (
      <Screen>
        <Notice message={error ? friendlyError(error) : STR.errGeneric} tone="danger" />
      </Screen>
    );
  }

  const draft = a.status !== "SENT";
  // The controls follow the server's own answer (the rule the mutations apply, incl. the Office on a teacher's Wed/Thu
  // leave day) — read from the loaded copy; a mutation result does not carry the flags.
  const canEdit = draft && loaded?.mayEdit === true;
  const canFinalise = draft && loaded?.mayFinalise === true;
  const canComment = can("assignment:comment");
  const counts = { DRAFT: 0, NEEDS_REVIEW: 0, APPROVED: 0 } as Record<string, number>;
  for (const s of a.sheets) counts[s.status] = (counts[s.status] ?? 0) + 1;
  const dayText = pickDayLabel(a.dayLabel, a.dayLabelEn, getActiveLang());
  const sg = a.suggestion;

  const edit = async (vars: { op: string; index?: number; qid?: string }): Promise<boolean> => {
    setMsg(null);
    const res = await editPartA({ assignmentId, ...vars });
    if (res.error) {
      setMsg(friendlyError(res.error));
      return false;
    }
    return true;
  };
  const onApproveAll = async () => {
    setMsg(null);
    const res = await approveAll({ assignmentId });
    if (res.error) setMsg(friendlyError(res.error));
  };
  const onSend = async () => {
    setMsg(null);
    const res = await send({ assignmentId });
    if (res.error) setMsg(friendlyError(res.error));
    else refetch({ requestPolicy: "network-only" });
  };
  const onComment = async () => {
    setMsg(null);
    const res = await addComment({ assignmentId, text: comment });
    if (res.error) {
      setMsg(friendlyError(res.error));
      return;
    }
    setComment("");
    toast.show(STR.al8CommentSent, "ok");
    refetchComments({ requestPolicy: "network-only" });
  };

  return (
    <Screen scroll>
      <H2>
        {STR.al8DraftTitle} · {hwSubjectLabel(a.subject)}
      </H2>
      <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap" }}>
        <Badge text={draft ? STR.al8StateDraft : STR.al8StateSent} tone={draft ? "info" : "ok"} />
        {sg ? <Badge text={sg.builtBy === "ENGINE" ? STR.al8BuiltEngine : STR.al8BuiltTeacher} tone="muted" /> : null}
        {sg?.edited ? <Badge text={STR.al8Edited} tone="warn" /> : null}
        {counts.NEEDS_REVIEW > 0 ? <Badge text={fill(STR.al8NeedsReview, { n: bnNum(counts.NEEDS_REVIEW) })} tone="gold" /> : null}
        {a.countedMinutes != null ? <Badge text={`${bnNum(a.countedMinutes)} ${STR.asMinutes}`} tone="muted" /> : null}
        {dayText ? <Badge text={dayText} tone="muted" /> : null}
      </View>
      <Muted>{bnNum(a.week)}</Muted>
      {sg && (sg.excludedHw > 0 || sg.excludedWindow > 0 || sg.excludedSeen > 0) ? (
        <Muted>{fill(STR.al8Excluded, { hw: bnNum(sg.excludedHw), win: bnNum(sg.excludedWindow), seen: bnNum(sg.excludedSeen) })}</Muted>
      ) : null}
      {sg?.noLessonMarks ? <Notice message={STR.al8NoLessonMarks} tone="warn" /> : null}
      {msg ? <AsRefusalNotice message={msg} sectionId={a.sectionId} subject={a.subject} /> : null}
      {!draft ? <Notice message={STR.al8FinalisedNote} tone="info" /> : null}
      {draft && !canEdit ? <Notice message={STR.al8ReadOnly} tone="info" /> : null}

      <Card>
        <Body style={{ fontWeight: "700" }}>
          {STR.al8PartA} · {bnNum(a.partA.reduce((s, q) => s + q.marks, 0))}
        </Body>
        {a.partA.length === 0 ? <Muted>{STR.msAsNothing}</Muted> : null}
        {a.partA.map((q, i) => (
          <View key={`${q.qid ?? q.textBn}-${i}`} style={{ gap: space(1), paddingVertical: space(1) }}>
            <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap", alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>{bnNum(i + 1)}.</Body>
              <Badge text={masteryBandLabel(q.band)} tone={bandTone(q.band)} />
              <Badge text={`${q.questionTypeCode} · ${bnNum(q.marks)}`} tone="muted" />
              {q.repeat ? <Badge text={STR.al8Again} tone="warn" /> : null}
            </View>
            <Body>{q.textBn ?? q.qid}</Body>
            <Muted style={{ fontSize: 12 }}>
              {q.loCode} · {q.labelBn}
              {q.qid ? ` · ${q.qid}` : ""}
            </Muted>
            {q.reasonBn ? <Muted>{q.reasonBn}</Muted> : null}
            {canEdit ? (
              <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap" }}>
                {q.origin === "BANK" ? <Button title={STR.msAsSwap} variant="secondary" disabled={busy} onPress={() => edit({ op: "SWAP", index: i })} /> : null}
                <Button title={STR.msAsRemove} variant="ghost" disabled={busy} onPress={() => edit({ op: "REMOVE", index: i })} />
              </View>
            ) : null}
          </View>
        ))}
      </Card>
      {canEdit ? <AssignmentBankPicker assignmentId={assignmentId} disabled={busy} onAdd={(q) => edit({ op: "ADD_BANK", qid: q })} /> : null}

      <Body style={{ fontWeight: "700" }}>{STR.al8ChildSheets}</Body>
      {a.sheets.map((s) => {
        const needs = s.status === "NEEDS_REVIEW";
        return (
          <Pressable
            key={s.studentId}
            accessibilityRole="link"
            onPress={() => navigation.navigate("MasteryAssignmentSheet", { assignmentId, studentId: s.studentId, subject: a.subject })}
            style={{
              backgroundColor: colors.surface,
              borderWidth: needs ? 2 : 1,
              borderColor: needs ? colors.onGoldContainer : colors.border,
              borderRadius: 12,
              padding: space(3),
              gap: space(1),
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
              <Body style={{ fontWeight: "700", flexShrink: 1 }}>
                {s.rollNumber ? `${bnNum(s.rollNumber)}. ` : ""}
                {s.name}
              </Body>
              <View style={{ flexDirection: "row", gap: space(1) }}>
                <Badge text={`${bnNum(s.marks)}/${bnNum(a.layout.partBMarks)}`} tone="muted" />
                <Badge text={s.status === "APPROVED" ? STR.msAsApprove : needs ? fill(STR.al8NeedsReview, { n: "" }).trim() : STR.msAsDraft} tone={s.status === "APPROVED" ? "ok" : needs ? "gold" : "muted"} />
              </View>
            </View>
            {needs ? (
              <>
                {s.warnings
                  .filter((w) => w.code === "NO_UNSEEN_QUESTION")
                  .map((w, i) => (
                    <Muted key={i}>
                      {STR.al8FixTitle}: {w.labelBn ?? w.loCode ?? ""}
                    </Muted>
                  ))}
                <Muted>{STR.al8FixOptions}</Muted>
                <Muted style={{ fontWeight: "700" }}>{STR.al8OpenSheet} ›</Muted>
              </>
            ) : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
              {s.items.map((it, i) => (
                <Badge key={`${it.loCode}-${i}`} text={`${it.labelBn} · ${masteryBandLabel(it.band)}`} tone={bandTone(it.band)} />
              ))}
            </View>
          </Pressable>
        );
      })}

      {canFinalise ? (
        <View style={{ gap: space(2) }}>
          <Muted>{STR.al8FinaliseNote}</Muted>
          <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
            <Button title={STR.msAsApproveAll} variant="secondary" onPress={onApproveAll} disabled={busy || (counts.DRAFT ?? 0) === 0} />
            <Button title={STR.al8Finalise} onPress={onSend} disabled={busy || a.sheets.length === 0 || a.sheets.some((s) => s.status !== "APPROVED")} />
          </View>
        </View>
      ) : null}

      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.al8CommentsTitle}</Body>
        {comments.length === 0 ? <Muted>{STR.al8NoComments}</Muted> : null}
        {comments.map((c) => (
          <View key={c.id} style={{ gap: 2 }}>
            <Muted>
              {c.authorName ? `${c.authorName} · ` : ""}
              {isoDateTimeLabel(c.createdAt)}
            </Muted>
            <Body>{c.textBn}</Body>
          </View>
        ))}
        {canComment ? (
          <View style={{ gap: space(2) }}>
            <Field label={STR.al8CommentField} value={comment} onChangeText={setComment} multiline />
            <Button title={STR.al8CommentSend} disabled={commentState.fetching || !comment.trim()} onPress={onComment} />
          </View>
        ) : null}
      </Card>
    </Screen>
  );
}
