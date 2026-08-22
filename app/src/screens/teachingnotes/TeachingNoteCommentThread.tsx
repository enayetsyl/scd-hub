/**
 * TeachingNoteCommentThread (TN-2, prd-teaching-notes) — the improvement-comment
 * thread under a note, plus the compose box.
 *
 * Two things this renders that the data model exists to make possible:
 *  - a comment written against an EARLIER version is badged as such, so nobody
 *    has to work out whether the current file already answers it;
 *  - OPEN vs ADDRESSED is visible per comment, because a suggestion nobody has
 *    to answer is one that gets skipped.
 */
import React, { useCallback, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  TEACHING_NOTE_COMMENTS,
  ADD_TEACHING_NOTE_COMMENT,
  SET_TEACHING_NOTE_COMMENT_STATUS,
  DELETE_TEACHING_NOTE_COMMENT,
  type TeachingNoteCommentT,
} from "../../graphql/teachingNotes";
import { Body, Muted, Card, Badge, Button, Field, Notice } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum, isoDateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

interface Props {
  noteId: string;
  /** The uploader of the current version — they may close comments. */
  uploaderIsMe: boolean;
  onCountsChanged?: () => void;
}

export default function TeachingNoteCommentThread({
  noteId,
  uploaderIsMe,
  onCountsChanged,
}: Props): React.ReactElement {
  const { user, can } = useAuth();
  const canManage = can("roster:manage");
  const mayAddress = canManage || uploaderIsMe;

  const [q, refetch] = useQuery({ query: TEACHING_NOTE_COMMENTS, variables: { noteId } });
  const comments = q.data?.teachingNoteComments ?? [];

  const [, addComment] = useMutation(ADD_TEACHING_NOTE_COMMENT);
  const [, setStatus] = useMutation(SET_TEACHING_NOTE_COMMENT_STATUS);
  const [, removeComment] = useMutation(DELETE_TEACHING_NOTE_COMMENT);

  const [body, setBody] = useState("");
  const [anchor, setAnchor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback((): void => {
    refetch({ requestPolicy: "network-only" });
    onCountsChanged?.();
  }, [refetch, onCountsChanged]);

  const submit = useCallback(async (): Promise<void> => {
    if (body.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    const res = await addComment({
      noteId,
      bodyBn: body.trim(),
      anchor: anchor.trim() === "" ? null : anchor.trim(),
    });
    setBusy(false);
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    setBody("");
    setAnchor("");
    reload();
  }, [body, anchor, busy, addComment, noteId, reload]);

  const changeStatus = useCallback(
    async (c: TeachingNoteCommentT, next: string): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setError(null);
      const res = await setStatus({ commentId: c.id, status: next });
      setBusy(false);
      if (res.error) {
        setError(friendlyError(res.error));
        return;
      }
      reload();
    },
    [busy, setStatus, reload],
  );

  const remove = useCallback(
    async (c: TeachingNoteCommentT): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setError(null);
      const res = await removeComment({ commentId: c.id });
      setBusy(false);
      if (res.error) {
        setError(friendlyError(res.error));
        return;
      }
      reload();
    },
    [busy, removeComment, reload],
  );

  return (
    <Card>
      <Muted style={{ fontWeight: "700", marginBottom: space(2) }}>
        {STR.tnComments}
        {comments.length > 0 ? ` (${bnNum(comments.length)})` : ""}
      </Muted>

      {error ? <Notice message={error} tone="danger" /> : null}

      {comments.length === 0 && !q.fetching ? <Muted>{STR.tnNoComments}</Muted> : null}

      {comments.map((c) => {
        const isOpen = c.status === "OPEN";
        const mine = c.authorId === user?.id;
        return (
          <View
            key={c.id}
            style={{
              paddingVertical: space(3),
              borderTopWidth: 1,
              borderTopColor: "rgba(127,127,127,0.2)",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                flexWrap: "wrap",
                gap: space(2),
                marginBottom: space(1),
              }}
            >
              <Body style={{ fontWeight: "600" }}>{c.authorName ?? "—"}</Body>
              <Badge
                text={isOpen ? STR.tnStatusOpen : STR.tnStatusAddressed}
                tone={isOpen ? "warn" : "ok"}
              />
              {/* The whole reason the thread is anchored to the identity: a reader
                  can tell at a glance whether the current file already answers this. */}
              {c.staleForCurrentVersion ? (
                <Badge text={STR.tnWrittenOn.replace("{v}", bnNum(c.versionSeen))} tone="muted" />
              ) : null}
            </View>

            {c.anchor ? <Muted style={{ marginBottom: space(1) }}>▸ {c.anchor}</Muted> : null}
            <Body>{c.bodyBn}</Body>
            <Muted style={{ marginTop: space(1) }}>{isoDateLabel(c.createdAt)}</Muted>

            {!isOpen && (c.addressedNote || c.addressedByName) ? (
              <Muted style={{ marginTop: space(1) }}>
                ✓ {c.addressedByName ?? "—"}
                {c.addressedNote ? ` — ${c.addressedNote}` : ""}
              </Muted>
            ) : null}

            <View
              style={{ flexDirection: "row", gap: space(2), marginTop: space(2), flexWrap: "wrap" }}
            >
              {mayAddress ? (
                <Button
                  title={isOpen ? STR.tnMarkAddressed : STR.tnReopen}
                  variant="secondary"
                  disabled={busy}
                  onPress={() => void changeStatus(c, isOpen ? "ADDRESSED" : "OPEN")}
                />
              ) : null}
              {mine || canManage ? (
                <Button
                  title={STR.tnDeleteComment}
                  variant="secondary"
                  disabled={busy}
                  onPress={() => void remove(c)}
                />
              ) : null}
            </View>
          </View>
        );
      })}

      <View style={{ marginTop: space(3) }}>
        <Field
          label={STR.tnAddComment}
          value={body}
          onChangeText={setBody}
          placeholder={STR.tnCommentPlaceholder}
          multiline
          inputStyle={{ minHeight: 90, textAlignVertical: "top" }}
        />
        <Field label={STR.tnCommentAnchor} value={anchor} onChangeText={setAnchor} />
        <Button
          title={STR.tnAddComment}
          onPress={submit}
          disabled={busy || body.trim() === ""}
        />
      </View>
    </Card>
  );
}
