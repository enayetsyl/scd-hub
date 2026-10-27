/**
 * MeetingCommentReminderPopup (D-#851, owner 2026-10-25) — once a day, a teacher who still
 * owes parents'-meeting comments is told how many, by when, and pointed at the guideline.
 *
 * WHAT COUNTS. Subject comments still due (myMeetingNoteWork `due`) plus class-teacher
 * summaries that can be written NOW (myMeetingSummaryWork `ready`). A summary still
 * WAITING on other teachers' notes is not counted: nagging someone about work they cannot
 * start teaches them to ignore the popup. Nothing owed → nothing shown.
 *
 * ONCE PER SCHOOL DAY, PER DEVICE — the AnnouncementPopup (D-#700) posture: the Dhaka day
 * key (dhakaDateKey, no device-timezone maths) is stored when the popup is DISMISSED, so
 * an app killed mid-render shows it again. Unlike the guardian meeting popup (D-#841) this
 * one closes: it is a reminder, and the Today cards already hold the work list.
 *
 * Mounted beside the navigator (not inside Today) so it fires on whichever screen the
 * teacher lands. Fail-silent: any query or storage error renders nothing.
 */
import React, { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "urql";
import { MY_MEETING_NOTE_WORK, MY_MEETING_SUMMARY_WORK } from "../graphql/meetingChain";
import { Button } from "./ui";
import { STR, bnNum, dhakaDateKey, fullDateLabel } from "../lib/labels";
import { getItem, setItem } from "../lib/storage";
import { useAuth } from "../auth/AuthContext";
import { openAppScreen } from "../navigation/navigationRef";
import { makeStyles, radius, space, typeScale } from "../theme";

const SEEN_KEY = "scd_meeting_comment_reminder_day";

/** The pure count + deadline, unit-sized so the rule reads in one place. */
export function reminderCounts(
  notes: { due: number; subjectDueKey: string }[],
  summaries: { summaryDueKey: string; sections: { ready: number }[] }[],
): { notes: number; summaries: number; dueKey: string | null } {
  let n = 0;
  let s = 0;
  const keys: string[] = [];
  for (const m of notes) {
    if (m.due > 0) {
      n += m.due;
      keys.push(m.subjectDueKey);
    }
  }
  for (const m of summaries) {
    const ready = m.sections.reduce((a, x) => a + x.ready, 0);
    if (ready > 0) {
      s += ready;
      keys.push(m.summaryDueKey);
    }
  }
  const dueKey = keys.filter(Boolean).sort()[0] ?? null;
  return { notes: n, summaries: s, dueKey };
}

export function MeetingCommentReminderPopup(): React.ReactElement | null {
  const { status, can } = useAuth();
  // The writer's own action (guardians never hold it) — the same gate as the Today cards.
  const eligible = status === "authed" && can("parents_meeting:write_notes");

  const [notesQ] = useQuery({ query: MY_MEETING_NOTE_WORK, pause: !eligible });
  const [sumQ] = useQuery({ query: MY_MEETING_SUMMARY_WORK, pause: !eligible });
  const settled = eligible && !notesQ.fetching && !sumQ.fetching && !notesQ.error && !sumQ.error && !!notesQ.data && !!sumQ.data;
  const counts = settled
    ? reminderCounts(notesQ.data?.myMeetingNoteWork ?? [], sumQ.data?.myMeetingSummaryWork ?? [])
    : null;
  const total = counts ? counts.notes + counts.summaries : 0;

  const today = dhakaDateKey();
  const [visible, setVisible] = useState(false);
  const [decided, setDecided] = useState(false);

  useEffect(() => {
    if (decided || !counts || total === 0) return;
    let cancelled = false;
    void (async () => {
      let last: string | null = null;
      try {
        last = await getItem(SEEN_KEY);
      } catch {
        last = null; // storage unavailable — better shown twice than never
      }
      if (cancelled) return;
      setDecided(true);
      if (last !== today) setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [decided, counts, total, today]);

  const styles = useStyles();
  const insets = useSafeAreaInsets();

  async function close(go?: "MeetingCommentGuide" | "Today"): Promise<void> {
    setVisible(false);
    try {
      await setItem(SEEN_KEY, today);
    } catch {
      /* non-fatal — at worst it shows again today */
    }
    if (go) {
      try {
        // Full path (App → HomeTab → screen): the bare "HomeTab" form left Android on Today.
        openAppScreen("HomeTab", go);
      } catch {
        // No Home tab for this login (should not happen for a writer) — closing is enough.
      }
    }
  }

  if (!eligible || !visible || !counts || total === 0) return null;
  const overdue = !!counts.dueKey && counts.dueKey < today;
  const dueLine = counts.dueKey
    ? (overdue ? STR.mcRemindOverdue : STR.mcRemindDue).replace("{d}", fullDateLabel(counts.dueKey))
    : null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => void close()}>
      <View style={styles.backdropWrap}>
        <Pressable style={styles.backdrop} onPress={() => void close()} accessibilityLabel={STR.mcRemindLater} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]}>
          <Text style={styles.title}>{STR.mcRemindTitle}</Text>
          <Text style={styles.big}>{STR.mcRemindBody.replace("{n}", bnNum(total))}</Text>
          {counts.notes > 0 ? <Text style={styles.line}>• {STR.mcRemindNotes.replace("{n}", bnNum(counts.notes))}</Text> : null}
          {counts.summaries > 0 ? (
            <Text style={styles.line}>• {STR.mcRemindSummaries.replace("{n}", bnNum(counts.summaries))}</Text>
          ) : null}
          {dueLine ? <Text style={[styles.line, overdue && styles.overdue]}>{dueLine}</Text> : null}
          <Text style={[styles.line, { marginTop: space(2) }]}>{STR.mcRemindAsap}</Text>
          <View style={styles.buttons}>
            <Button title={STR.mcRemindWrite} onPress={() => void close("Today")} />
            <Button title={STR.mcRemindGuide} variant="secondary" onPress={() => void close("MeetingCommentGuide")} />
            <Button title={STR.mcRemindLater} variant="ghost" onPress={() => void close()} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdropWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" },
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
  title: { ...typeScale.sectionTitle, color: colors.textPrimary, marginBottom: space(2) },
  big: { ...typeScale.body, color: colors.textPrimary, fontWeight: "700", marginBottom: space(1) },
  line: { ...typeScale.body, color: colors.textSecondary },
  overdue: { color: colors.error, fontWeight: "700" },
  buttons: { gap: space(2), marginTop: space(4) },
}));
