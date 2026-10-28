/**
 * QuranExamReminderPopup (D-#878) — an examiner whom the Office reminded sees, on their
 * next app open, how many of their Quran exam students still have no marks. "নম্বর দিন"
 * opens their duties; "পরে" dismisses it until the Office reminds again. The count is
 * live, and a reminder whose marks are all in has already cleared itself on the server.
 * Staff only; fail-silent on any query error.
 */
import React from "react";
import { Modal, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { QX_ACK_REMINDER, QX_MY_REMINDER } from "../graphql/quranExam";
import { useAnnounceSystemPopup } from "../lib/popupSlot";
import { useAuth } from "../auth/AuthContext";
import { openAppScreen } from "../navigation/navigationRef";
import { Body, Button, Muted } from "./ui";
import { STR, bnNum } from "../lib/labels";
import { makeStyles, radius, space } from "../theme";

export function QuranExamReminderPopup(): React.ReactElement | null {
  const { status, role, can } = useAuth();
  const staff = status === "authed" && role !== "GUARDIAN" && can("quran_exam:examine");
  const [q, reexec] = useQuery({ query: QX_MY_REMINDER, pause: !staff });
  const [ack, acknowledge] = useMutation(QX_ACK_REMINDER);
  const styles = useStyles();
  const rem = q.data?.myQuranExamReminder ?? null;
  const showing = !!(staff && !q.error && rem);
  useAnnounceSystemPopup("quran-exam-reminder", showing);
  if (!showing || !rem) return null;

  async function done(open: boolean) {
    const r = await acknowledge({ id: rem!.id });
    if (!r.error) reexec({ requestPolicy: "network-only" });
    if (open) openAppScreen("QuranExamTab", "MyQuranExam");
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => done(false)}>
      <View style={styles.wrap}>
        <View style={styles.card}>
          <Muted>{STR.qxSchoolNotice}</Muted>
          <Body style={{ fontWeight: "700", fontSize: 20 }}>{STR.qxRemTitle}</Body>
          <Body>{STR.qxRemBody.replace("{n}", bnNum(rem.pending))}</Body>
          <View style={{ flexDirection: "row", gap: space(2), marginTop: space(3) }}>
            <Button title={STR.qxRemLater} variant="secondary" loading={ack.fetching} onPress={() => done(false)} style={{ flex: 1 }} />
            <Button title={STR.qxRemOpen} loading={ack.fetching} onPress={() => done(true)} style={{ flex: 2 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.5)", padding: space(4) },
  card: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(4),
    gap: space(2),
  },
}));
