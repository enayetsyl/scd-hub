/**
 * MeetingRsvpPopup (D-#841) — asks a guardian to answer the family's parents'-meeting
 * slot, and stays until they do.
 *
 * WHY IT CANNOT BE CLOSED. The office needs an answer from every family to arrange the
 * day; a dismissible popup is the D-#700 announcement, which parents learn to swipe
 * away. There is no backdrop tap and Android back does nothing — the only way out is
 * one of the three answers.
 *
 * WHY SERVER STATE, NOT DEVICE STORAGE. "Answered" lives on the slot (one final answer
 * per family, D-#840), so answering on the father's phone removes it from the mother's
 * too, and a reinstall does not ask again.
 *
 * The three answers: the time is fine (one tap); a different time (pick one of the
 * meeting's other times — every slot is taken, so it is shown as "not confirmed, we
 * will try"); can't come (optional reason).
 *
 * Fail-silent: any query error renders nothing — a guardian who came to check homework
 * must never be locked out by a broken meeting read. Mounted beside AnnouncementPopup.
 */
import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery } from "urql";
import { MY_MEETING_SLOTS_QUERY, RESPOND_TO_MEETING_SLOT, type GuardianMeetingAskT } from "../graphql/comments";
import { Button, Field, Notice } from "./ui";
import { STR, bnNum, fullDateLabel, minutesToHHMM } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { useAuth } from "../auth/AuthContext";
import { makeStyles, radius, space, typeScale } from "../theme";

type Mode = "choose" | "change" | "cantCome";

export function MeetingRsvpPopup(): React.ReactElement | null {
  const { status, role } = useAuth();
  const isGuardian = status === "authed" && role === "GUARDIAN";

  const [result, refetch] = useQuery({ query: MY_MEETING_SLOTS_QUERY, pause: !isGuardian });
  const [respondState, respond] = useMutation(RESPOND_TO_MEETING_SLOT);

  const asks = result.data?.myMeetingSlots ?? [];
  const pending: GuardianMeetingAskT | null = asks.find((a) => a.response == null) ?? null;

  const [mode, setMode] = useState<Mode>("choose");
  const [picked, setPicked] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The change-request answer is shown its "not confirmed" note AFTER it is sent, so the
  // popup outlives the slot leaving `pending` — keep the sent ask until the guardian closes it.
  const [sent, setSent] = useState<GuardianMeetingAskT | null>(null);

  const pendingId = pending?.slotId ?? null;
  useEffect(() => {
    setMode("choose");
    setPicked(null);
    setReason("");
    setError(null);
  }, [pendingId]);

  const styles = useStyles();
  const insets = useSafeAreaInsets();

  const shown = sent ?? pending;
  if (!isGuardian || result.error || !shown) return null;

  async function send(choice: "CONFIRMED" | "CHANGE_REQUESTED" | "CANT_COME"): Promise<void> {
    if (!pending) return;
    setError(null);
    const res = await respond({
      slotId: pending.slotId,
      choice,
      preferredSlotId: choice === "CHANGE_REQUESTED" ? picked : null,
      reason: choice === "CANT_COME" ? reason.trim() || null : null,
    });
    if (res.error) {
      setError(friendlyError(res.error));
      // Already answered elsewhere (the other parent's phone) — re-read so it goes away.
      refetch({ requestPolicy: "network-only" });
      return;
    }
    if (choice === "CHANGE_REQUESTED" && res.data) setSent(res.data.respondToMeetingSlot);
    refetch({ requestPolicy: "network-only" });
  }

  const busy = respondState.fetching;
  const timeText = shown.onCall ? STR.cmOnCall : minutesToHHMM(shown.slotTime);
  const pickedTime = shown.choices.find((c) => c.slotId === picked)?.slotTime ?? null;

  return (
    // onRequestClose is required on Android; doing nothing there is the point (D-#841).
    <Modal visible transparent animationType="fade" onRequestClose={() => undefined}>
      <View style={styles.backdropWrap}>
        <View style={styles.backdrop} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]}>
          <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: space(1) }}>
            <Text style={styles.title}>
              {STR.rsTitle} — {shown.instanceLabel}
            </Text>
            <Text style={styles.line}>
              {STR.rsDate}: {fullDateLabel(shown.meetingDate.slice(0, 10))}
            </Text>
            <Text style={styles.time}>
              {STR.rsYourTime}: {timeText}
            </Text>
            {shown.childNames.length > 0 ? (
              <Text style={styles.line}>{shown.childNames.join(", ")}</Text>
            ) : null}
            {shown.rescheduledAt && !sent ? <Notice tone="warn" message={STR.rsRescheduled} /> : null}

            {sent ? (
              <View style={styles.block}>
                <Notice tone="info" message={STR.rsNotConfirmed} />
                <Text style={styles.line}>
                  {STR.rsWanted}: {minutesToHHMM(sent.response?.preferredSlotTime ?? null)}
                </Text>
              </View>
            ) : mode === "choose" ? (
              <View style={styles.block}>
                <Text style={styles.muted}>{STR.rsAsk}</Text>
                <Button title={STR.rsOk} onPress={() => void send("CONFIRMED")} loading={busy} />
                <Button
                  title={STR.rsChange}
                  variant="secondary"
                  onPress={() => setMode("change")}
                  disabled={busy}
                />
                <Button title={STR.rsCantCome} variant="ghost" onPress={() => setMode("cantCome")} disabled={busy} />
                <Text style={styles.muted}>{STR.rsFinal}</Text>
              </View>
            ) : mode === "change" ? (
              <View style={styles.block}>
                <Text style={styles.subtitle}>{STR.rsPickTime}</Text>
                {shown.choices.length === 0 ? (
                  <Text style={styles.muted}>{STR.rsNoOtherTime}</Text>
                ) : (
                  <View style={styles.chips}>
                    {shown.choices.map((c) => (
                      <Pressable
                        key={c.slotId}
                        onPress={() => setPicked(c.slotId)}
                        style={[styles.chip, picked === c.slotId && styles.chipOn]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: picked === c.slotId }}
                      >
                        <Text style={[styles.chipText, picked === c.slotId && styles.chipTextOn]}>
                          {minutesToHHMM(c.slotTime)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                {pickedTime != null ? <Notice tone="info" message={STR.rsNotConfirmed} /> : null}
                <View style={styles.row}>
                  <Button title={STR.rsBack} variant="ghost" onPress={() => setMode("choose")} disabled={busy} style={styles.flex} />
                  <Button
                    title={STR.rsSend}
                    onPress={() => void send("CHANGE_REQUESTED")}
                    disabled={!picked}
                    loading={busy}
                    style={styles.flex}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.block}>
                <Field
                  label={STR.rsReason}
                  value={reason}
                  onChangeText={(t) => setReason(t.slice(0, 500))}
                  multiline
                  autoCapitalize="sentences"
                  helper={reason.length > 400 ? `${bnNum(reason.length)}/${bnNum(500)}` : undefined}
                />
                <View style={styles.row}>
                  <Button title={STR.rsBack} variant="ghost" onPress={() => setMode("choose")} disabled={busy} style={styles.flex} />
                  <Button title={STR.rsSend} onPress={() => void send("CANT_COME")} loading={busy} style={styles.flex} />
                </View>
              </View>
            )}

            {error ? <Notice tone="danger" message={error} /> : null}
          </ScrollView>

          {sent ? (
            <Button
              title={STR.close}
              onPress={() => setSent(null)}
              style={{ marginTop: space(3) }}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdropWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
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
  scroll: { maxHeight: 520 },
  title: { ...typeScale.sectionTitle, color: colors.textPrimary, marginBottom: space(2) },
  subtitle: { ...typeScale.body, color: colors.textPrimary, fontWeight: "700" },
  line: { ...typeScale.body, color: colors.textSecondary, marginBottom: space(1) },
  time: { ...typeScale.sectionTitle, color: colors.primary, marginBottom: space(2) },
  muted: { ...typeScale.body, color: colors.textSecondary },
  block: { gap: space(3), marginTop: space(3) },
  row: { flexDirection: "row", gap: space(3) },
  flex: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  chip: {
    paddingVertical: space(2),
    paddingHorizontal: space(3),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typeScale.body, color: colors.textPrimary },
  chipTextOn: { color: colors.onPrimary, fontWeight: "700" },
}));
