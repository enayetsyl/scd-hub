/**
 * QuranExamGuardianPopup (D-#877, mockup screens 2 and 14) — tells a family about their
 * child's Quran exam, and stays until they tap "ঠিক আছে, দেখেছি".
 *
 *  - SCHEDULE: the schedule was published and the family has not seen it — every sitting
 *    of the child (date, time, portion; never the examiner).
 *  - CHANGED: a published sitting's date or time changed (Office moved the child, removed
 *    an examiner, or set a make-up) — the old time struck through, the new time.
 * One child at a time; the acknowledgement is server state, so it clears on every device.
 * Pop-up, never a notification (owner, D-#844). Fail-silent: a query error renders nothing.
 */
import React from "react";
import { Modal, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery } from "urql";
import { QX_ACKNOWLEDGE, QX_MY_SCHEDULE } from "../graphql/quranExam";
import { useAnnounceSystemPopup } from "../lib/popupSlot";
import { useAuth } from "../auth/AuthContext";
import { Body, Button, Muted } from "./ui";
import { STR, fullDateLabel } from "../lib/labels";
import { qxLevelLabel, qxRange } from "../lib/quranExam";
import { makeStyles, radius, space } from "../theme";

export function QuranExamGuardianPopup(): React.ReactElement | null {
  const { status, role } = useAuth();
  const isGuardian = status === "authed" && role === "GUARDIAN";
  const [q, reexec] = useQuery({ query: QX_MY_SCHEDULE, pause: !isGuardian });
  const [ack, acknowledge] = useMutation(QX_ACKNOWLEDGE);
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const child = (q.data?.myQuranExamSchedule ?? []).find((c) => c.notice !== "NONE");
  const showing = !!(isGuardian && !q.error && child);
  useAnnounceSystemPopup("quran-exam", showing);
  if (!showing || !child) return null;

  const changed = child.notice === "CHANGED";
  const rows = changed ? child.sittings.filter((s) => s.changed) : child.sittings;
  async function seen() {
    const r = await acknowledge({ examId: child!.examId, studentId: child!.studentId, version: child!.version });
    if (!r.error) reexec({ requestPolicy: "network-only" });
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => undefined}>
      <View style={styles.wrap}>
        <View style={styles.backdrop} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]}>
          <ScrollView style={{ maxHeight: 520 }}>
            <Muted>{STR.qxSchoolNotice}</Muted>
            <Body style={{ fontWeight: "700", fontSize: 20 }}>{changed ? STR.qxGpChangedTitle : STR.qxGpTitle}</Body>
            <View style={{ height: space(2) }} />
            <Body>
              {changed
                ? STR.qxGpChangedIntro.replace("{name}", child.studentName)
                : STR.qxGpIntro.replace("{name}", child.studentName).replace("{level}", qxLevelLabel(child.level))}
            </Body>
            <View style={{ gap: space(2), marginTop: space(3) }}>
              {rows.map((s, i) => (
                <View key={i} style={styles.row}>
                  <Body style={{ fontWeight: "700" }}>
                    {fullDateLabel(s.dateKey)} · {s.portionLabel}
                  </Body>
                  {changed && s.fromStart ? (
                    <Muted style={{ textDecorationLine: "line-through" }}>
                      {STR.qxGpOld}: {s.fromDateKey && s.fromDateKey !== s.dateKey ? `${fullDateLabel(s.fromDateKey)} · ` : ""}
                      {qxRange(s.fromStart, s.fromEnd ?? s.fromStart)}
                    </Muted>
                  ) : null}
                  <Body>
                    {changed ? `${STR.qxGpNew}: ` : ""}
                    {qxRange(s.start, s.end)}
                  </Body>
                </View>
              ))}
            </View>
            {/* The Office's note — shown only when one was written (owner, 2026-10-28). */}
            {child.guardianNote ? <Body style={{ marginTop: space(3) }}>{child.guardianNote}</Body> : null}
          </ScrollView>
          <Button title={STR.qxGpAck} loading={ack.fetching} onPress={seen} style={{ marginTop: space(3) }} />
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
  row: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space(3), gap: space(1) },
}));
