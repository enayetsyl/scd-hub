/**
 * CommentReadPopup (D-#886) — a teacher's comment the Office sent opens on the guardian's
 * app by itself, and only "পড়েছি" closes it, so the school knows the family read it.
 *
 *  - Every delivered comment from this release on (positive and concern alike, owner);
 *    the server's queue is oldest first and holds only the family's own children.
 *  - No ✕ and no back-button close; the button unlocks after a short read so a reflex tap
 *    on the open pop-up cannot confirm it unread.
 *  - The confirmation is server state, so it clears on every device of the family; the
 *    next waiting comment follows straight after.
 *  - Waits while another system pop-up (meeting RSVP, Quran exam) is on screen, and
 *    announces itself so pop-up notices wait for it (D-#871).
 * Pop-up, never a notification (owner, D-#844). Fail-silent: a query error renders nothing.
 */
import React from "react";
import { Modal, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery } from "urql";
import { CONFIRM_STUDENT_COMMENT_READ, MY_UNREAD_STUDENT_COMMENTS_QUERY } from "../graphql/comments";
import { useAnnounceSystemPopup, useOtherSystemPopupActive } from "../lib/popupSlot";
import { useFileOpen } from "../lib/useFileOpen";
import { openStoredFile, FILE_VIEW_SUPPORTED } from "../lib/files";
import { useAuth } from "../auth/AuthContext";
import { Badge, Body, Button, Muted, Notice } from "./ui";
import { STR, bnNum, commentSentimentLabel, commentTypeLabel, isoDateTimeLabel } from "../lib/labels";
import { makeStyles, radius, space } from "../theme";

/** Seconds the "পড়েছি" button stays locked after each comment opens. */
export const COMMENT_READ_MIN_SEC = 3;

export function CommentReadPopup(): React.ReactElement | null {
  const { status, role } = useAuth();
  const isGuardian = status === "authed" && role === "GUARDIAN";
  const [q, reexec] = useQuery({ query: MY_UNREAD_STUDENT_COMMENTS_QUERY, pause: !isGuardian, requestPolicy: "network-only" });
  const [ack, confirm] = useMutation(CONFIRM_STUDENT_COMMENT_READ);
  const { openingId, runOpen } = useFileOpen();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const othersUp = useOtherSystemPopupActive("comment-read");
  const queue = q.data?.myUnreadStudentComments ?? [];
  const c = queue[0];
  const showing = !!(isGuardian && !q.error && c && !othersUp);
  useAnnounceSystemPopup("comment-read", showing);

  // The read lock restarts for every comment the pop-up shows.
  const [left, setLeft] = React.useState(COMMENT_READ_MIN_SEC);
  const [failed, setFailed] = React.useState(false);
  const shownId = showing ? c?.id : undefined;
  React.useEffect(() => {
    if (!shownId) return;
    setLeft(COMMENT_READ_MIN_SEC);
    setFailed(false);
    const t = setInterval(() => setLeft((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [shownId]);

  if (!showing || !c) return null;

  async function read() {
    const r = await confirm({ commentId: c!.id });
    if (r.error) {
      setFailed(true);
      return;
    }
    reexec({ requestPolicy: "network-only" });
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => undefined}>
      <View style={styles.wrap}>
        <View style={styles.backdrop} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]}>
          <ScrollView style={{ maxHeight: 520 }}>
            <Muted>{STR.cmrPopupKicker}</Muted>
            <Body style={{ fontWeight: "700", fontSize: 20 }}>{STR.cmrPopupTitle.replace("{name}", c.studentName)}</Body>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
              <Badge text={commentSentimentLabel(c.sentiment)} tone={c.sentiment === "CONCERN" ? "danger" : "ok"} />
              <Badge text={commentTypeLabel(c.type)} />
            </View>
            <View style={styles.text}>
              <Body>{c.text}</Body>
            </View>
            {c.attachmentIds.length > 0 && FILE_VIEW_SUPPORTED
              ? c.attachmentIds.map((fid) => (
                  <Button
                    key={fid}
                    title={STR.cmOpenAttachment}
                    variant="ghost"
                    loading={openingId === fid}
                    disabled={!!openingId}
                    onPress={() => runOpen(fid, () => openStoredFile(fid).catch(() => {}))}
                  />
                ))
              : null}
            <Muted style={{ marginTop: space(2) }}>{STR.cmrPopupSent.replace("{date}", isoDateTimeLabel(c.deliveredAt))}</Muted>
            {queue.length > 1 ? <Muted>{STR.cmrPopupMore.replace("{n}", bnNum(queue.length - 1))}</Muted> : null}
            <Muted style={{ marginTop: space(2) }}>{STR.cmrPopupHint}</Muted>
          </ScrollView>
          {failed ? <Notice message={STR.cmrPopupFailed} tone="danger" /> : null}
          <Button
            title={left > 0 ? STR.cmrPopupAckWait.replace("{n}", bnNum(left)) : STR.cmrPopupAck}
            disabled={left > 0}
            loading={ack.fetching}
            onPress={read}
            style={{ marginTop: space(3) }}
          />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(4),
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
  },
  text: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space(3), marginTop: space(3) },
}));
