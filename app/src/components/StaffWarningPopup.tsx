/**
 * StaffWarningPopup (D-#940/#941, docs/prd-staff-mistakes.md §9) — a staff member who
 * reached a warning step sees it on their next app open: how many mistakes were counted in
 * how many days, the list, and (once booked) the face-to-face meeting time. Closed only by
 * "বুঝেছি" (or "অন্য সময় চাই" when a meeting is booked); the server records it, so every
 * device agrees. Waits its turn behind other system pop-ups (D-#871). Fail-silent.
 */
import React, { useEffect } from "react";
import { AppState, Modal, ScrollView, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { ACK_STAFF_WARNING, MY_STAFF_WARNING } from "../graphql/staffMistakes";
import { useAnnounceSystemPopup, useOtherSystemPopupActive } from "../lib/popupSlot";
import { useAuth } from "../auth/AuthContext";
import { Body, Button, Muted } from "./ui";
import { STR, bnNum, fullDateLabel } from "../lib/labels";
import { dhakaWhen, staffMistakeKindLabel } from "../lib/staffMistakeLabels";
import { makeStyles, radius, space } from "../theme";

const REFRESH_MS = 5 * 60 * 1000;

const STEP_LINE: Record<string, () => string> = {
  WARNING: () => STR.smwStepWarning,
  MEETING: () => STR.smwStepMeeting,
  CONDUCT: () => STR.smwStepConduct,
};

export function StaffWarningPopup(): React.ReactElement | null {
  const { status, role, can } = useAuth();
  const staff = status === "authed" && role !== "GUARDIAN" && can("staff_mistakes:view_own");
  const [q, reexec] = useQuery({ query: MY_STAFF_WARNING, pause: !staff });
  const [ack, acknowledge] = useMutation(ACK_STAFF_WARNING);
  const waiting = useOtherSystemPopupActive("staff-warning");
  const styles = useStyles();

  useEffect(() => {
    if (!staff) return;
    const again = () => reexec({ requestPolicy: "network-only" });
    const timer = setInterval(again, REFRESH_MS);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") again();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [staff, reexec]);

  const w = q.data?.myStaffWarning ?? null;
  const showing = !!(staff && !q.error && w && !waiting);
  useAnnounceSystemPopup("staff-warning", showing);
  if (!showing || !w) return null;

  async function close(otherTime: boolean) {
    const r = await acknowledge({ id: w!.id, otherTime });
    if (!r.error) reexec({ requestPolicy: "network-only" });
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => undefined}>
      <View style={styles.wrap}>
        <View style={styles.card}>
          <Body style={styles.title}>{STR.smwTitle}</Body>
          <Muted>
            {STR.smwCountLine.replace("{days}", bnNum(w.windowDays)).replace("{n}", bnNum(Math.round(w.weightedCount * 10) / 10))}
          </Muted>
          <ScrollView style={styles.list}>
            {w.mistakes.map((m, i) => (
              <Body key={`${m.dateKey}-${i}`} style={styles.line}>
                {fullDateLabel(m.dateKey)} · {staffMistakeKindLabel(m.kind)}
              </Body>
            ))}
          </ScrollView>
          {w.meetingAt ? (
            <View style={styles.meeting}>
              <Body style={{ fontWeight: "700" }}>
                {STR.smwMeetingLine.replace("{when}", dhakaWhen(w.meetingAt)).replace("{place}", w.meetingPlace ?? "")}
              </Body>
            </View>
          ) : null}
          <Body>{STEP_LINE[w.step]?.() ?? ""}</Body>
          {w.meetingAt ? (
            <View style={{ gap: space(2) }}>
              <Button title={STR.smwOkTime} loading={ack.fetching} onPress={() => void close(false)} />
              <Button title={STR.smwOtherTime} variant="secondary" disabled={ack.fetching} onPress={() => void close(true)} />
            </View>
          ) : (
            <Button title={STR.smwOk} loading={ack.fetching} onPress={() => void close(false)} />
          )}
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
    padding: space(4),
    gap: space(3),
  },
  title: { fontWeight: "700", fontSize: 20 },
  list: { maxHeight: 220, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  line: { paddingVertical: space(2), paddingHorizontal: space(3), borderBottomWidth: 1, borderBottomColor: colors.border },
  meeting: { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, padding: space(3) },
}));
