/**
 * The Sunday mark-submission pop-ups (D-#889/#890, docs/prd-mark-submission-guard.md §2).
 *
 *   MarkReminderPopup    — a teacher of an assignment due today: MORNING on the first open
 *                          (closes with "ঠিক আছে"), then NINE from 09:00 while anything is
 *                          unmarked — no ✕, no back-button close, only "বুঝেছি" (unlocked
 *                          after 3 s).
 *   MarkEscalationPopup  — Office + Principal (`mark_submission:alerts`): the 09:30 list,
 *                          closed only by "বুঝেছি"; rows marked since say so.
 *
 * WHEN IT LOOKS. Both re-query when the app comes back to the foreground and every five
 * minutes, so a teacher who opened the app at 07:30 still meets the 09:00 pop-up. The
 * server decides what is due (and records "seen" per person per day), so every device
 * agrees. The teacher reminder waits its turn behind any other system pop-up (D-#871);
 * pop-up notices wait for both. Fail-silent on any query error.
 */
import React, { useEffect, useState } from "react";
import { AppState, Modal, ScrollView, View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  ACK_MARK_ESCALATION,
  ACK_MARK_REMINDER,
  MY_MARK_ESCALATION,
  MY_MARK_REMINDER,
} from "../graphql/markSubmission";
import { useAnnounceSystemPopup, useOtherSystemPopupActive } from "../lib/popupSlot";
import { useAuth } from "../auth/AuthContext";
import { openAppScreen } from "../navigation/navigationRef";
import { Body, Button, Muted } from "./ui";
import { STR, hwSubjectLabel } from "../lib/labels";
import { makeStyles, radius, space } from "../theme";

const REFRESH_MS = 5 * 60 * 1000;
const LOCK_MS = 3000;

/** Re-run `reexec` on foreground and on a timer while `active`. */
function useRefresh(active: boolean, reexec: (o: { requestPolicy: "network-only" }) => void): void {
  useEffect(() => {
    if (!active) return;
    const again = () => reexec({ requestPolicy: "network-only" });
    const timer = setInterval(again, REFRESH_MS);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") again();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [active, reexec]);
}

/** True for LOCK_MS after `key` changes — the read-before-close lock. */
function useLock(key: string | null): boolean {
  const [locked, setLocked] = useState(true);
  useEffect(() => {
    if (!key) return;
    setLocked(true);
    const t = setTimeout(() => setLocked(false), LOCK_MS);
    return () => clearTimeout(t);
  }, [key]);
  return locked;
}

function ItemLine({ text, done, doneLabel, pendingLabel }: { text: string; done: boolean; doneLabel: string; pendingLabel: string }) {
  const styles = useStyles();
  return (
    <View style={styles.line}>
      <Body style={{ flex: 1 }}>{text}</Body>
      <Muted style={done ? styles.done : styles.pending}>{done ? doneLabel : pendingLabel}</Muted>
    </View>
  );
}

export function MarkReminderPopup(): React.ReactElement | null {
  const { status, role, can } = useAuth();
  const staff = status === "authed" && role !== "GUARDIAN" && can("mark_submission:view_own");
  const [q, reexec] = useQuery({ query: MY_MARK_REMINDER, pause: !staff });
  const [ack, acknowledge] = useMutation(ACK_MARK_REMINDER);
  const waiting = useOtherSystemPopupActive("mark-reminder");
  const styles = useStyles();
  useRefresh(staff, reexec);

  const rem = q.data?.myMarkReminder ?? null;
  const nine = rem?.stage === "NINE";
  const showing = !!(staff && !q.error && rem && !waiting);
  useAnnounceSystemPopup("mark-reminder", showing);
  const locked = useLock(showing && nine ? `${rem!.dateKey}:NINE` : null);
  if (!showing || !rem) return null;

  async function close(open: boolean) {
    const r = await acknowledge({ stage: rem!.stage });
    if (!r.error) reexec({ requestPolicy: "network-only" });
    if (open) openAppScreen("AssignmentTab", "AssignmentWorkspace");
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      // NINE closes only through "বুঝেছি" (owner); MORNING may be dismissed like any reminder.
      onRequestClose={() => {
        if (!nine) void close(false);
      }}
    >
      <View style={styles.wrap}>
        <View style={styles.card}>
          <Muted>{STR.qxSchoolNotice}</Muted>
          <Body style={styles.title}>{nine ? STR.msgNineTitle : STR.msgMornTitle}</Body>
          <Body>{nine ? STR.msgNineBody : STR.msgMornBody}</Body>
          <ScrollView style={{ maxHeight: 260 }}>
            {rem.items.map((i) => (
              <ItemLine
                key={i.asItemId}
                text={`${i.sectionLabel} · ${hwSubjectLabel(i.subject)} (${i.asId})`}
                done={i.marked}
                doneLabel={STR.msgItemMarked}
                pendingLabel={STR.msgItemPending}
              />
            ))}
          </ScrollView>
          {nine ? (
            <Button title={STR.msgUnderstood} loading={ack.fetching} disabled={locked} onPress={() => close(false)} />
          ) : (
            <View style={styles.row}>
              <Button title={STR.msgMornOk} variant="secondary" loading={ack.fetching} onPress={() => close(false)} style={{ flex: 1 }} />
              <Button title={STR.msgMornOpen} loading={ack.fetching} onPress={() => close(true)} style={{ flex: 2 }} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

export function MarkEscalationPopup(): React.ReactElement | null {
  const { status, role, can } = useAuth();
  const holder = status === "authed" && role !== "GUARDIAN" && can("mark_submission:alerts");
  const [q, reexec] = useQuery({ query: MY_MARK_ESCALATION, pause: !holder });
  const [ack, acknowledge] = useMutation(ACK_MARK_ESCALATION);
  const styles = useStyles();
  useRefresh(holder, reexec);

  const esc = q.data?.myMarkEscalation ?? null;
  // Does NOT wait for other system pop-ups: two waiters would see each other and flicker
  // forever. The teacher reminder waits for this one instead (an Office member who also
  // teaches gets the list first).
  const showing = !!(holder && !q.error && esc);
  useAnnounceSystemPopup("mark-escalation", showing);
  const locked = useLock(showing ? esc!.dateKey : null);
  if (!showing || !esc) return null;

  async function close() {
    const r = await acknowledge({});
    if (!r.error) reexec({ requestPolicy: "network-only" });
  }

  return (
    // Only "বুঝেছি" closes it (owner): the back button does nothing.
    <Modal visible transparent animationType="fade" onRequestClose={() => undefined}>
      <View style={styles.wrap}>
        <View style={styles.card}>
          <Muted>{STR.qxSchoolNotice}</Muted>
          <Body style={styles.title}>{STR.msgEscTitle}</Body>
          <Body>{STR.msgEscBody}</Body>
          <ScrollView style={{ maxHeight: 320 }}>
            {esc.rows.map((r) => (
              <ItemLine
                key={r.asItemId}
                text={`${r.teacherNames.join(", ")} — ${r.sectionLabel} · ${hwSubjectLabel(r.subject)} (${r.asId})`}
                done={r.markedNow}
                doneLabel={STR.msgEscMarkedNow}
                pendingLabel={STR.msgItemPending}
              />
            ))}
          </ScrollView>
          <Button title={STR.msgUnderstood} loading={ack.fetching} disabled={locked} onPress={close} />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.5)", padding: space(4) },
  card: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(4),
    gap: space(2),
  },
  title: { fontWeight: "700", fontSize: 20 },
  row: { flexDirection: "row", gap: space(2), marginTop: space(2) },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingVertical: space(1.5),
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  done: { color: colors.success },
  pending: { color: colors.error, fontWeight: "700" },
}));
