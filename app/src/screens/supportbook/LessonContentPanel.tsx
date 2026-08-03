/**
 * LessonContentPanel (SB-3b, D-#440) — the পাঠ as the reviewer reads it, with a comment
 * thread on every block and every image slot.
 *
 * THIS IS WHAT MAKES THE CHECKLIST MEAN ANYTHING. Before it, the review screen asked a
 * reviewer to tick "register vs NCTB" and "outcome coverage" against content they could
 * not see, because the server exposed `blockCount` and not the blocks.
 *
 * Blocks and slots render IN READING ORDER, together — a reviewer judging "the picture
 * does not match the text" needs them adjacent, not on two screens.
 *
 * COMMENTS ARE PER ITEM AND RESOLVABLE, and unresolved ones block sign-off. A note that
 * nobody has to answer is a note that gets skipped in a busy week; that is the whole
 * reason this is not a bigger feedback box. Resolving records that the point was dealt
 * with — it changes no text, because text still moves only through a validated patch.
 *
 * `json` is rendered behind a toggle rather than dropped: the typed fields cover what a
 * reviewer reads, but a block carrying something unusual must not be invisible just
 * because this screen has no field for it.
 */
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import {
  SUPPORT_BOOK_LESSON_CONTENT, SUPPORT_BOOK_COMMENTS,
  COMMENT_ON_SUPPORT_BOOK_ITEM, RESOLVE_SUPPORT_BOOK_COMMENT,
  type SupportBookLessonContentT, type SupportBookCommentT,
} from "../../graphql/supportBook";
import { Body, Muted, Badge, Button, Field, Divider } from "../../components/ui";
import { STR, bnNum, isoDateTimeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space, useColors } from "../../theme";

interface ItemRef {
  target: "BLOCK" | "IMAGE_SLOT" | "LESSON";
  targetId: string | null;
  label: string;
}

function CommentThread({
  bookId,
  lessonNo,
  item,
  comments,
  canComment,
  canResolve,
  onChanged,
}: {
  bookId: string;
  lessonNo: number;
  item: ItemRef;
  comments: SupportBookCommentT[];
  canComment: boolean;
  canResolve: boolean;
  onChanged: () => void;
}): React.ReactElement {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");

  const [addRes, addComment] = useMutation(COMMENT_ON_SUPPORT_BOOK_ITEM);
  const [resRes, resolveComment] = useMutation(RESOLVE_SUPPORT_BOOK_COMMENT);

  const unresolved = comments.filter((c) => !c.resolved).length;

  async function onAdd(): Promise<void> {
    setNote(null);
    if (!body.trim()) return;
    const r = await addComment({
      bookId, lessonNo, target: item.target, targetId: item.targetId, body: body.trim(),
    });
    if (r.error) { setNote({ text: friendlyError(r.error), bad: true }); return; }
    setBody("");
    setNote({ text: STR.sbCommentAdded, bad: false });
    onChanged();
  }

  async function onResolve(commentId: string): Promise<void> {
    setNote(null);
    const r = await resolveComment({ commentId, resolutionNote: resolutionNote.trim() || undefined });
    if (r.error) { setNote({ text: friendlyError(r.error), bad: true }); return; }
    setResolvingId(null);
    setResolutionNote("");
    onChanged();
  }

  return (
    <View style={{ marginTop: space(2) }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
        <Button
          title={`${STR.sbComments}${comments.length ? ` (${bnNum(comments.length)})` : ""}`}
          variant="ghost"
          onPress={() => setOpen((v) => !v)}
        />
        {/* Unresolved count sits on the COLLAPSED header on purpose: the reviewer must
            see there is outstanding work without opening every item. */}
        {unresolved > 0 ? (
          <View style={{ marginLeft: space(2) }}>
            <Badge text={`${bnNum(unresolved)} ${STR.sbOpenComments}`} tone="warn" />
          </View>
        ) : null}
      </View>

      {open ? (
        <View style={{ paddingLeft: space(3), borderLeftWidth: 2, borderLeftColor: colors.border }}>
          {comments.length === 0 ? <Muted>{STR.sbNoComments}</Muted> : null}

          {comments.map((c) => (
            <View key={c.commentId} style={{ paddingVertical: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
                <Muted style={{ fontSize: 12 }}>{isoDateTimeLabel(c.createdAt)}</Muted>
                {c.resolved ? (
                  <View style={{ marginLeft: space(2) }}>
                    <Badge text={STR.sbCommentResolved} tone="ok" />
                  </View>
                ) : null}
              </View>
              <Body style={{ fontSize: 14 }}>{c.body}</Body>
              {c.resolutionNote ? (
                <Muted style={{ fontSize: 12 }}>{`${STR.sbResolutionNote}: ${c.resolutionNote}`}</Muted>
              ) : null}

              {!c.resolved && canResolve ? (
                resolvingId === c.commentId ? (
                  <>
                    <Field
                      label={STR.sbResolutionNote}
                      value={resolutionNote}
                      onChangeText={setResolutionNote}
                      autoCapitalize="sentences"
                    />
                    <View style={{ flexDirection: "row", marginTop: 4 }}>
                      <Button
                        title={STR.sbResolveComment}
                        onPress={() => { void onResolve(c.commentId); }}
                        loading={resRes.fetching}
                        disabled={resRes.fetching}
                        style={{ marginRight: space(2) }}
                      />
                      <Button title={STR.cancel} variant="ghost" onPress={() => setResolvingId(null)} />
                    </View>
                  </>
                ) : (
                  <Button
                    title={STR.sbResolveComment}
                    variant="ghost"
                    onPress={() => { setResolvingId(c.commentId); setResolutionNote(""); }}
                    style={{ alignSelf: "flex-start" }}
                  />
                )
              ) : null}
            </View>
          ))}

          {canComment ? (
            <>
              <Field
                label={STR.sbAddComment}
                value={body}
                onChangeText={setBody}
                placeholder={STR.sbCommentPlaceholder}
                multiline
                autoCapitalize="sentences"
              />
              <Button
                title={STR.sbAddComment}
                variant="secondary"
                onPress={() => { void onAdd(); }}
                loading={addRes.fetching}
                disabled={!body.trim() || addRes.fetching}
                style={{ alignSelf: "flex-start", marginTop: 4 }}
              />
            </>
          ) : null}

          {note ? (
            <Muted style={{ marginTop: 4, color: note.bad ? colors.error : colors.primary }}>
              {note.text}
            </Muted>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function RawToggle({ json }: { json: string }): React.ReactElement {
  const [show, setShow] = useState(false);
  return (
    <View>
      <Button title={STR.sbShowRaw} variant="ghost" onPress={() => setShow((v) => !v)} style={{ alignSelf: "flex-start" }} />
      {show ? <Muted style={{ fontSize: 11 }}>{json}</Muted> : null}
    </View>
  );
}

export function LessonContentPanel({
  bookId,
  lessonNo,
  canComment,
  canResolve,
}: {
  bookId: string;
  lessonNo: number;
  canComment: boolean;
  canResolve: boolean;
}): React.ReactElement {
  const colors = useColors();
  const [contentQ, refetchContent] = useQuery<{ supportBookLessonContent: SupportBookLessonContentT | null }>({
    query: SUPPORT_BOOK_LESSON_CONTENT,
    variables: { bookId, lessonNo },
  });
  // ALL comments, not just open ones: a resolved note is the record of a decision, and
  // hiding it makes the same point get raised twice.
  const [commentsQ, refetchComments] = useQuery<{ supportBookComments: SupportBookCommentT[] }>({
    query: SUPPORT_BOOK_COMMENTS,
    variables: { bookId, lessonNo, openOnly: false },
  });

  const content = contentQ.data?.supportBookLessonContent ?? null;
  const comments = commentsQ.data?.supportBookComments ?? [];

  // One pass — a পাঠ can carry dozens of items, and a filter per item is the shape
  // that gets slow quietly.
  const byItem = useMemo(() => {
    const m = new Map<string, SupportBookCommentT[]>();
    for (const c of comments) {
      const key = `${c.target}:${c.targetId ?? ""}`;
      const list = m.get(key);
      if (list) list.push(c);
      else m.set(key, [c]);
    }
    return m;
  }, [comments]);

  const refetchAll = (): void => {
    refetchContent({ requestPolicy: "network-only" });
    refetchComments({ requestPolicy: "network-only" });
  };

  const at = (target: ItemRef["target"], targetId: string | null): SupportBookCommentT[] =>
    byItem.get(`${target}:${targetId ?? ""}`) ?? [];

  const openTotal = comments.filter((c) => !c.resolved).length;

  if (contentQ.fetching && !content) return <Muted>{STR.loading}</Muted>;
  if (!content) return <Muted>{STR.sbNoContent}</Muted>;

  return (
    <View>
      {openTotal > 0 ? (
        <Muted style={{ color: colors.warning, marginBottom: space(2) }}>
          {`${STR.sbBlocksSignoff} — ${bnNum(openTotal)}`}
        </Muted>
      ) : null}

      {/* Whole-lesson notes: the ones that are not about any single block. */}
      <CommentThread
        bookId={bookId}
        lessonNo={lessonNo}
        item={{ target: "LESSON", targetId: null, label: `${STR.sbLesson} ${bnNum(lessonNo)}` }}
        comments={at("LESSON", null)}
        canComment={canComment}
        canResolve={canResolve}
        onChanged={refetchAll}
      />

      <Divider />

      {content.blocks.length === 0 ? <Muted>{STR.sbNoContent}</Muted> : null}

      {content.blocks.map((b, i) => (
        <View key={`${b.id || i}`} style={{ paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
            <Muted style={{ fontSize: 12 }}>{`${STR.sbBlock} ${b.id || bnNum(i + 1)}`}</Muted>
            {b.layoutHint ? <Muted style={{ fontSize: 12, marginLeft: space(2) }}>{b.layoutHint}</Muted> : null}
          </View>
          {/* The text as authored, newlines intact — a poem block's line breaks ARE
              its content, so this must never be collapsed to one paragraph. */}
          {b.textBn ? <Body style={{ marginTop: 2 }}>{b.textBn}</Body> : <Muted>—</Muted>}
          <RawToggle json={b.json} />
          <CommentThread
            bookId={bookId}
            lessonNo={lessonNo}
            item={{ target: "BLOCK", targetId: b.id, label: b.id }}
            comments={at("BLOCK", b.id)}
            canComment={canComment}
            canResolve={canResolve}
            onChanged={refetchAll}
          />
        </View>
      ))}

      {content.imageSlots.map((s, i) => (
        <View key={`slot-${s.id || i}`} style={{ paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
            <Muted style={{ fontSize: 12 }}>{`${STR.sbImageSlot} ${s.id || bnNum(i + 1)}`}</Muted>
            {s.imageClass ? <Muted style={{ fontSize: 12, marginLeft: space(2) }}>{s.imageClass}</Muted> : null}
            {s.aspect ? <Muted style={{ fontSize: 12, marginLeft: space(2) }}>{s.aspect}</Muted> : null}
          </View>
          {s.sceneDescription ? <Body style={{ marginTop: 2 }}>{s.sceneDescription}</Body> : null}
          <RawToggle json={s.json} />
          <CommentThread
            bookId={bookId}
            lessonNo={lessonNo}
            item={{ target: "IMAGE_SLOT", targetId: s.id, label: s.id }}
            comments={at("IMAGE_SLOT", s.id)}
            canComment={canComment}
            canResolve={canResolve}
            onChanged={refetchAll}
          />
        </View>
      ))}
    </View>
  );
}
