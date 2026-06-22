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
import { COMMENT_TYPES, COMMENT_SENTIMENTS } from "@scd/shared";
import {
  STUDENT_COMMENTS_QUERY,
  MY_STUDENT_COMMENTS_QUERY,
  RECORD_STUDENT_COMMENT,
  EDIT_STUDENT_COMMENT,
  DELIVER_STUDENT_COMMENT,
  type StudentCommentT,
  type CommentDeliveryOutcomeT,
} from "../../graphql/comments";
import { Screen, Card, Body, Muted, Button, Chip, ChipRow, Field, Badge, Notice, Loader } from "../../components/ui";
import { STR, commentTypeLabel, commentSentimentLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { pickAndUploadCommentFile, openStoredFile, FileUploadError, FILE_VIEW_SUPPORTED } from "../../lib/files";
import { space } from "../../theme/tokens";
import type { CommentsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<CommentsStackParamList, "CommentEntry">;

export default function CommentEntryScreen({ route }: Props): React.ReactElement {
  const { studentId, studentName, commentId: initialCommentId } = route.params;

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
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
    setError(null);
    setOk(null);
    if (!text.trim()) return setError(STR.errGeneric);
    setBusy(true);
    if (commentId) {
      const res = await editComment({ commentId, type, sentiment, text: text.trim() });
      setBusy(false);
      if (res.error) return setError(friendlyError(res.error));
      setOk(STR.cmSaved);
      refetchComment();
    } else {
      const res = await recordComment({ studentId, type, sentiment, text: text.trim() });
      setBusy(false);
      if (res.error) return setError(friendlyError(res.error));
      const created = res.data?.recordStudentComment;
      if (created) {
        setCommentId(created.id);
        setOk(STR.cmSaved);
        refetchComment();
      }
    }
  }

  async function onAttach(): Promise<void> {
    setError(null);
    setOk(null);
    if (!commentId) return setError(STR.cmAttachFirst);
    try {
      const f = await pickAndUploadCommentFile(commentId);
      if (f) {
        setOk(STR.cmSaved);
        refetchComment();
      }
    } catch (e) {
      setError(e instanceof FileUploadError ? e.message : STR.cmFileUploadFail);
    }
  }

  async function onOpenAttachment(fileId: string): Promise<void> {
    setError(null);
    if (!FILE_VIEW_SUPPORTED) return setError(STR.cmAttachWebOnly);
    try {
      await openStoredFile(fileId);
    } catch (e) {
      setError(e instanceof FileUploadError ? e.message : STR.cmFileUploadFail);
    }
  }

  async function onDeliver(): Promise<void> {
    setError(null);
    setOk(null);
    if (!commentId) return;
    setBusy(true);
    const res = await deliver({ commentId });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    const o = res.data?.deliverStudentComment;
    if (o) {
      setOutcome(o);
      setOk(STR.cmDelivered);
      refetchComment();
    }
  }

  const [, recordComment] = useMutation(RECORD_STUDENT_COMMENT);
  const [, editComment] = useMutation(EDIT_STUDENT_COMMENT);
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
        </Card>

        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}
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

        {/* Attachments — need a saved comment id; record first for a new comment. */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.cmAttachments}</Body>
          {attachmentIds.length === 0 ? (
            <Muted style={{ marginTop: space(1) }}>—</Muted>
          ) : (
            attachmentIds.map((fid) => (
              <View key={fid} style={{ marginTop: space(2) }}>
                <Button title={STR.cmOpenAttachment} variant="ghost" onPress={() => void onOpenAttachment(fid)} />
              </View>
            ))
          )}
          {!delivered ? (
            <View style={{ marginTop: space(2) }}>
              <Button
                title={STR.cmAttach}
                variant="secondary"
                onPress={onAttach}
                disabled={busy}
              />
              {!commentId ? <Muted style={{ marginTop: space(1) }}>{STR.cmAttachFirst}</Muted> : null}
            </View>
          ) : null}
        </Card>

        {/* Deliver — only for an undelivered, saved comment. */}
        {commentId && !delivered ? (
          <Card>
            <Button title={STR.cmDeliver} onPress={onDeliver} loading={busy} disabled={busy} />
          </Card>
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
