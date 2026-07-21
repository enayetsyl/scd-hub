/**
 * CommentEntryScreen (CM-6 / CM-1+CM-2, tracker:write) — record OR edit one daily
 * student comment, attach files, then deliver to guardians.
 *
 * Flow: pick a COMMENT_TYPE + COMMENT_SENTIMENT + multiline text. Attachments need a
 * comment id, so for a NEW comment the staff member saves first (recordStudentComment),
 * which yields the id; editing attaches directly. "Deliver" (deliverStudentComment)
 * shows the returned wa.me link (Linking.openURL) + unreachable/notified counts; once
 * delivered the server seals the comment immutable, and this form goes read-only to
 * reflect it. Every Bangla server deny (RBAC, sealed-edit, undelivered-only upload)
 * surfaces inline.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { COMMENT_TYPES, COMMENT_SENTIMENTS, roleHasPermission } from "@scd/shared";
import { useAuth } from "../../auth/AuthContext";
import {
  STUDENT_COMMENTS_QUERY,
  MY_STUDENT_COMMENTS_QUERY,
  RECORD_STUDENT_COMMENT,
  EDIT_STUDENT_COMMENT,
  REMOVE_COMMENT_ATTACHMENT,
  DELIVER_STUDENT_COMMENT,
  type StudentCommentT,
  type CommentDeliveryOutcomeT,
} from "../../graphql/comments";
import { Screen, Card, Body, Muted, Button, Chip, ChipRow, Field, Badge, Notice, Loader } from "../../components/ui";
import { STR, commentTypeLabel, commentSentimentLabel, bnNum, isoDateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { useToast } from "../../state/ToastContext";
import {
  pickAndUploadCommentFile,
  uploadCommentWebFile,
  openStoredFile,
  FileUploadError,
  FILE_VIEW_SUPPORTED,
  type UploadedChatFile,
} from "../../lib/files";
import { UploadDropZone } from "../../components/UploadDropZone";
import { useFileOpen } from "../../lib/useFileOpen";
import { space } from "../../theme/tokens";
import type { CommentsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<CommentsStackParamList, "CommentEntry">;

export default function CommentEntryScreen({ route }: Props): React.ReactElement {
  const { studentId, studentName, commentId: initialCommentId } = route.params;
  // Delivery to guardians is a Principal/Office action (D-#264); teachers author + edit
  // only — comments are released from the review dashboard.
  const { role } = useAuth();
  const { confirmAction } = useConfirm();
  const toast = useToast();
  const canDeliver = !!role && roleHasPermission(role, "roster:manage");

  // The edit/deliver path needs the live comment row. Load it from BOTH the section
  // timeline (`studentComments` — scoped; serves Principal/Office + section-scoped
  // teachers) AND the caller's own comments (`myStudentComments` — author path, allowed
  // regardless of section scope, D-#263). Either source locates the row.
  const [studentQ, refetchStudent] = useQuery({
    query: STUDENT_COMMENTS_QUERY,
    variables: { studentId },
    pause: !studentId,
  });
  const [mineQ, refetchMine] = useQuery({
    query: MY_STUDENT_COMMENTS_QUERY,
    variables: { studentId },
    pause: !studentId,
  });
  function refetchComment(): void {
    refetchStudent({ requestPolicy: "network-only" });
    refetchMine({ requestPolicy: "network-only" });
  }
  const [commentId, setCommentId] = useState<string | null>(initialCommentId ?? null);
  const existing: StudentCommentT | null = useMemo(() => {
    if (!commentId) return null;
    const all: StudentCommentT[] = [...(mineQ.data?.myStudentComments ?? []), ...(studentQ.data?.studentComments ?? [])];
    return all.find((c) => c.id === commentId) ?? null;
  }, [mineQ.data, studentQ.data, commentId]);
  const delivered = !!existing?.deliveredAt;

  const [type, setType] = useState<string>(COMMENT_TYPES[0]);
  const [sentiment, setSentiment] = useState<string>(COMMENT_SENTIMENTS[0]);
  const [text, setText] = useState("");
  // R-Validate (UX-1): the text field carries its own error; outcomes toast.
  const [textError, setTextError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const [removeBusyId, setRemoveBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CommentDeliveryOutcomeT | null>(null);

  // Seed the form from the loaded comment (once it resolves).
  useEffect(() => {
    if (existing) {
      setType(existing.type);
      setSentiment(existing.sentiment);
      setText(existing.text);
    }
  }, [existing]);

  const attachmentIds = existing?.attachmentIds ?? [];

  async function onSave(): Promise<void> {
    setTextError(undefined);
    if (!text.trim()) {
      const msg = `${STR.cmText} — ${STR.fieldRequired}`;
      setTextError(msg);
      toast.show(msg, "danger");
      return;
    }
    setBusy(true);
    if (commentId) {
      const res = await editComment({ commentId, type, sentiment, text: text.trim() });
      setBusy(false);
      if (res.error) return toast.show(friendlyError(res.error), "danger");
      toast.show(STR.cmSaved, "ok");
      refetchComment();
    } else {
      const res = await recordComment({ studentId, type, sentiment, text: text.trim() });
      setBusy(false);
      if (res.error) return toast.show(friendlyError(res.error), "danger");
      const created = res.data?.recordStudentComment;
      if (created) {
        setCommentId(created.id);
        toast.show(STR.cmSaved, "ok");
        refetchComment();
      }
    }
  }

  /** Shared attach path (pick button AND web drop): needs a saved comment id first;
      same busy flag, toasts and refetch either way. */
  async function runAttach(upload: (id: string) => Promise<UploadedChatFile | null>): Promise<void> {
    if (!commentId) return toast.show(STR.cmAttachFirst, "danger");
    setAttachBusy(true);
    try {
      const f = await upload(commentId);
      if (f) {
        toast.show(STR.cmSaved, "ok");
        refetchComment();
      }
    } catch (e) {
      toast.show(e instanceof FileUploadError ? e.message : STR.cmFileUploadFail, "danger");
    } finally {
      setAttachBusy(false);
    }
  }

  async function onAttach(): Promise<void> {
    await runAttach((id) => pickAndUploadCommentFile(id));
  }

  /** Web drop on the attach button — one file per drop (extras ignored). */
  function onDropAttach(files: File[]): void {
    void runAttach((id) => uploadCommentWebFile(id, files[0]));
  }

  async function onRemoveAttachment(fileId: string): Promise<void> {
    if (removeBusyId) return;
    if (!(await confirmAction({ confirmLabel: STR.cmRemove }))) return;
    setRemoveBusyId(fileId);
    const res = await removeAttachment({ commentId: commentId as string, fileId });
    setRemoveBusyId(null);
    if (res.error) return toast.show(friendlyError(res.error), "danger");
    toast.show(STR.cmAttachRemoved, "ok");
    refetchComment();
  }

  async function onOpenAttachment(fileId: string): Promise<void> {
    if (!FILE_VIEW_SUPPORTED) return toast.show(STR.cmAttachWebOnly, "danger");
    try {
      await openStoredFile(fileId);
    } catch (e) {
      toast.show(e instanceof FileUploadError ? e.message : STR.cmFileUploadFail, "danger");
    }
  }
  const { openingId, runOpen } = useFileOpen();

  async function onDeliver(): Promise<void> {
    if (!commentId) return;
    setBusy(true);
    const res = await deliver({ commentId });
    setBusy(false);
    if (res.error) return toast.show(friendlyError(res.error), "danger");
    const o = res.data?.deliverStudentComment;
    if (o) {
      setOutcome(o);
      toast.show(STR.cmDelivered, "ok");
      refetchComment();
    }
  }

  const [, recordComment] = useMutation(RECORD_STUDENT_COMMENT);
  const [, editComment] = useMutation(EDIT_STUDENT_COMMENT);
  const [, removeAttachment] = useMutation(REMOVE_COMMENT_ATTACHMENT);
  const [, deliver] = useMutation(DELIVER_STUDENT_COMMENT);

  // Loading the existing comment row (edit/deliver path).
  if (commentId && (studentQ.fetching || mineQ.fetching) && !existing) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700" }}>{studentName}</Body>
            {existing ? (
              <Badge text={delivered ? STR.cmDeliveredBadge : STR.cmDraftBadge} tone={delivered ? "ok" : "muted"} />
            ) : null}
          </View>
          {existing ? (
            <Muted style={{ marginTop: 2 }}>
              {STR.cmMadeOn}: {isoDateLabel(existing.createdAt)}
            </Muted>
          ) : null}
        </Card>

        {delivered ? <Notice message={STR.cmDeliveredLocked} tone="info" /> : null}

        <Card>
          <Muted style={{ marginBottom: space(1) }}>{STR.cmType}</Muted>
          <ChipRow>
            {COMMENT_TYPES.map((t) => (
              <Chip
                key={t}
                label={commentTypeLabel(t)}
                selected={type === t}
                onPress={() => !delivered && setType(t)}
              />
            ))}
          </ChipRow>

          <Muted style={{ marginTop: space(2), marginBottom: space(1) }}>{STR.cmSentiment}</Muted>
          <ChipRow>
            {COMMENT_SENTIMENTS.map((s) => (
              <Chip
                key={s}
                label={commentSentimentLabel(s)}
                selected={sentiment === s}
                onPress={() => !delivered && setSentiment(s)}
              />
            ))}
          </ChipRow>

          <View style={{ marginTop: space(2) }}>
            <Field
              label={STR.cmText}
              value={text}
              onChangeText={setText}
              placeholder={STR.cmTextPlaceholder}
              multiline
              error={textError}
              editable={!delivered}
            />
          </View>

          {!delivered ? (
            <Button
              title={commentId ? STR.cmEditComment : STR.cmSave}
              onPress={onSave}
              loading={busy}
              disabled={busy}
            />
          ) : null}
        </Card>

        {/* Attachments — need a saved comment id; record first for a new comment.
            Multiple files allowed; each can be opened (and removed before delivery). */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.cmAttachments}</Body>
          {attachmentIds.length === 0 ? (
            <Muted style={{ marginTop: space(1) }}>—</Muted>
          ) : (
            attachmentIds.map((fid, i) => (
              <View
                key={fid}
                style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginTop: space(2) }}
              >
                <Muted>{`${STR.cmAttachmentN} ${bnNum(i + 1)}`}</Muted>
                <View style={{ flex: 1 }} />
                <Button
                  title={STR.cmOpenAttachment}
                  variant="ghost"
                  loading={openingId === fid}
                  disabled={!!openingId}
                  onPress={() => runOpen(fid, () => onOpenAttachment(fid))}
                />
                {!delivered ? (
                  <Button
                    title={STR.cmRemove}
                    variant="danger"
                    onPress={() => void onRemoveAttachment(fid)}
                    loading={removeBusyId === fid}
                    disabled={removeBusyId !== null}
                  />
                ) : null}
              </View>
            ))
          )}
          {!delivered ? (
            <View style={{ marginTop: space(2) }}>
              {/* Drop zone mirrors the button's enablement (undelivered + not busy);
                  a drop before first save hits the same cmAttachFirst toast. */}
              <UploadDropZone onFiles={onDropAttach} disabled={busy || attachBusy || removeBusyId !== null}>
                <Button
                  title={attachBusy ? STR.cmUploading : STR.cmAttach}
                  variant="secondary"
                  onPress={onAttach}
                  loading={attachBusy}
                  disabled={busy || attachBusy || removeBusyId !== null}
                />
              </UploadDropZone>
              {!commentId ? <Muted style={{ marginTop: space(1) }}>{STR.cmAttachFirst}</Muted> : null}
            </View>
          ) : null}
        </Card>

        {/* Deliver — Principal/Office only (D-#264), for an undelivered, saved comment.
            Teachers see a note that delivery is handled by the review dashboard. */}
        {commentId && !delivered ? (
          canDeliver ? (
            <Card>
              <Button title={STR.cmDeliver} onPress={onDeliver} loading={busy} disabled={busy} />
            </Card>
          ) : (
            <Card>
              <Muted>{STR.cmDeliverByAdmin}</Muted>
            </Card>
          )
        ) : null}

        {outcome ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.cmDelivered}</Body>
            <Muted style={{ marginTop: space(1) }}>
              {STR.cmNotified}: {bnNum(outcome.notifiedGuardianIds.length)}
              {outcome.unreachableByWa ? ` · ${STR.cmUnreachable}` : ""}
            </Muted>
            {outcome.waLink ? (
              <View style={{ marginTop: space(2) }}>
                <Button title={STR.cmOpenWa} variant="secondary" onPress={() => void Linking.openURL(outcome.waLink as string)} />
              </View>
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
