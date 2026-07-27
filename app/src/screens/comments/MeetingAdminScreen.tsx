/**
 * MeetingAdminScreen (CM-6 / CM-3+CM-4, roster:manage) — run one parents' meeting.
 *
 * Draft: "Generate slots" (familyCount/reachable/unreachable), the per-family slot
 * list (order · time/On-Call · class labels), an On-Call toggle per slot, and up/down
 * reorder (reorderMeetingSlots with the recomputed id order). "Dispatch" renders the
 * per-slot wa.me links (Linking.openURL) + counts and flips the meeting to scheduled.
 * After dispatch: per-slot present/absent (setMeetingSlotAttendance) + the derived
 * meetingAttendanceSummary aggregates. Each child in a slot has a "Comparison" link →
 * MeetingComparison. All actions ride roster:manage — the Bangla deny surfaces inline.
 */
import React, { useEffect, useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation, type CombinedError } from "urql";
import {
  PARENT_MEETING_QUERY,
  PARENT_MEETING_SLOTS_QUERY,
  GENERATE_MEETING_SLOTS,
  SET_MEETING_SLOT_ON_CALL,
  REORDER_MEETING_SLOTS,
  DISPATCH_MEETING_SCHEDULE,
  SET_MEETING_SLOT_ATTENDANCE,
  MEETING_ATTENDANCE_SUMMARY_QUERY,
  type GenerateSlotsResultT,
  type MeetingDispatchResultT,
} from "../../graphql/comments";
import { Screen, Card, Body, Muted, Button, Badge, Loader, Notice } from "../../components/ui";
import { STR, meetingStatusLabel, minutesToHHMM, bnNum, isoDateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { CommentsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<CommentsStackParamList, "MeetingAdmin">;
type Nav = NativeStackNavigationProp<CommentsStackParamList>;

export default function MeetingAdminScreen({ route }: Props): React.ReactElement {
  const { meetingId } = route.params;
  const nav = useNavigation<Nav>();

  const [meetingQ, refetchMeeting] = useQuery({ query: PARENT_MEETING_QUERY, variables: { meetingId } });
  const meeting = meetingQ.data?.parentMeeting ?? null;
  const isDraft = meeting?.status === "draft";

  const [slotsQ, refetchSlots] = useQuery({ query: PARENT_MEETING_SLOTS_QUERY, variables: { meetingId } });
  const slots = [...(slotsQ.data?.parentMeetingSlots ?? [])].sort((a, b) => a.order - b.order);

  const [summaryQ, refetchSummary] = useQuery({
    query: MEETING_ATTENDANCE_SUMMARY_QUERY,
    variables: { meetingId },
    pause: isDraft,
  });
  const summary = summaryQ.data?.meetingAttendanceSummary ?? null;

  const [, generate] = useMutation(GENERATE_MEETING_SLOTS);
  const [, setOnCall] = useMutation(SET_MEETING_SLOT_ON_CALL);
  const [, reorder] = useMutation(REORDER_MEETING_SLOTS);
  const [, dispatch] = useMutation(DISPATCH_MEETING_SCHEDULE);
  const [, setAttendance] = useMutation(SET_MEETING_SLOT_ATTENDANCE);

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [genResult, setGenResult] = useState<GenerateSlotsResultT | null>(null);
  const [dispatchResult, setDispatchResult] = useState<MeetingDispatchResultT | null>(null);

  function refreshAll(): void {
    refetchMeeting({ requestPolicy: "network-only" });
    refetchSlots({ requestPolicy: "network-only" });
    if (!isDraft) refetchSummary({ requestPolicy: "network-only" });
  }

  useEffect(() => {
    const unsub = nav.addListener("focus", () => refreshAll());
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav]);

  async function run(
    fn: () => Promise<{ error?: CombinedError; data?: unknown }>,
    okMsg: string,
  ): Promise<unknown> {
    setError(null);
    setOk(null);
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.error) {
      setError(friendlyError(res.error));
      return null;
    }
    setOk(okMsg);
    refreshAll();
    return res.data;
  }

  async function onGenerate(): Promise<void> {
    const data = (await run(() => generate({ meetingId }), STR.cmSlotsGenerated)) as
      | { generateMeetingSlots: GenerateSlotsResultT }
      | null;
    if (data) setGenResult(data.generateMeetingSlots);
  }

  async function onDispatch(): Promise<void> {
    const data = (await run(() => dispatch({ meetingId }), STR.cmDispatched)) as
      | { dispatchMeetingSchedule: MeetingDispatchResultT }
      | null;
    if (data) setDispatchResult(data.dispatchMeetingSchedule);
  }

  async function onMove(index: number, dir: -1 | 1): Promise<void> {
    const target = index + dir;
    if (target < 0 || target >= slots.length) return;
    const ids = slots.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await run(() => reorder({ meetingId, slotIds: ids }), STR.cmSlotsGenerated);
  }

  if (meetingQ.fetching && !meeting) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexShrink: 1 }}>
              <Body style={{ fontWeight: "700" }}>{meeting?.instanceLabel}</Body>
              {meeting ? <Muted>{isoDateLabel(meeting.meetingDate)}</Muted> : null}
            </View>
            {meeting ? (
              <Badge
                text={meetingStatusLabel(meeting.status)}
                tone={meeting.status === "scheduled" ? "ok" : meeting.status === "closed" ? "muted" : "brand"}
              />
            ) : null}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
            {isDraft ? <Button title={STR.cmGenerateSlots} onPress={onGenerate} loading={busy} disabled={busy} /> : null}
            {slots.length > 0 ? (
              <Button title={STR.cmDispatch} variant="secondary" onPress={onDispatch} disabled={busy} />
            ) : null}
          </View>
        </Card>

        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {genResult ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.cmSlotsGenerated}</Body>
            <Muted style={{ marginTop: space(1) }}>
              {STR.cmFamilies}: {bnNum(genResult.familyCount)} · {STR.cmReachable}: {bnNum(genResult.reachableCount)} ·{" "}
              {STR.cmUnreachable}: {bnNum(genResult.unreachableCount)}
            </Muted>
          </Card>
        ) : null}

        {/* Attendance summary (after dispatch — derived) */}
        {!isDraft && summary ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.cmSummary}</Body>
            <Muted style={{ marginTop: space(1) }}>
              {STR.cmTotal}: {bnNum(summary.total)} · {STR.cmPresent}: {bnNum(summary.present)} · {STR.cmAbsent}:{" "}
              {bnNum(summary.absent)} · {STR.cmPending}: {bnNum(summary.pending)}
            </Muted>
            <Muted>
              {STR.cmOnCall}: {bnNum(summary.onCall)} · {STR.cmDispatchedBadge}: {bnNum(summary.dispatched)} ·{" "}
              {STR.cmReachable}: {bnNum(summary.reachable)} · {STR.cmUnreachable}: {bnNum(summary.unreachable)}
            </Muted>
          </Card>
        ) : null}

        {/* Dispatch outcome — per-slot wa.me links */}
        {dispatchResult ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.cmDispatched}</Body>
            <Muted style={{ marginTop: space(1) }}>
              {STR.cmSlots}: {bnNum(dispatchResult.slotCount)} · {STR.cmReachable}: {bnNum(dispatchResult.reachableCount)} ·{" "}
              {STR.cmUnreachable}: {bnNum(dispatchResult.unreachableCount)} · {STR.cmNotified}:{" "}
              {bnNum(dispatchResult.notifiedCount)}
            </Muted>
            {dispatchResult.outcomes.map((o) => (
              <View
                key={o.slotId}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}
              >
                <View style={{ flexShrink: 1 }}>
                  <Muted>
                    {o.onCall ? STR.cmOnCall : minutesToHHMM(o.slotTime)}
                    {o.unreachableByWa ? ` · ${STR.cmUnreachable}` : ""}
                  </Muted>
                </View>
                {o.waLink ? (
                  <Button title={STR.cmOpenWa} variant="secondary" onPress={() => void Linking.openURL(o.waLink as string)} />
                ) : null}
              </View>
            ))}
          </Card>
        ) : null}

        {/* Slot list */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.cmSlots}</Body>
          {slotsQ.fetching ? (
            <Loader label={STR.loading} />
          ) : slots.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.cmNoSlots}</Muted>
          ) : (
            slots.map((s, i) => (
              <Card key={s.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body style={{ fontWeight: "700" }}>
                      {bnNum(s.order)}. {s.classLabels.join(", ")}
                    </Body>
                    <Muted>{s.onCall ? STR.cmOnCall : minutesToHHMM(s.slotTime)}</Muted>
                  </View>
                  {s.attended != null ? (
                    <Badge text={s.attended ? STR.cmPresent : STR.cmAbsent} tone={s.attended ? "ok" : "danger"} />
                  ) : s.dispatchedAt ? (
                    <Badge text={STR.cmDispatchedBadge} tone="brand" />
                  ) : null}
                </View>

                {/* Draft controls: On-Call toggle + reorder up/down */}
                {isDraft ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                    <Button
                      title={s.onCall ? STR.cmUnsetOnCall : STR.cmSetOnCall}
                      variant="ghost"
                      onPress={() => void run(() => setOnCall({ slotId: s.id, onCall: !s.onCall }), STR.cmSlotsGenerated)}
                      disabled={busy}
                    />
                    <Button title={STR.cmMoveUp} variant="ghost" onPress={() => void onMove(i, -1)} disabled={busy || i === 0} />
                    <Button
                      title={STR.cmMoveDown}
                      variant="ghost"
                      onPress={() => void onMove(i, 1)}
                      disabled={busy || i === slots.length - 1}
                    />
                  </View>
                ) : null}

                {/* After dispatch: present/absent capture */}
                {!isDraft && s.dispatchedAt ? (
                  <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                    <Button
                      title={STR.cmPresent}
                      variant={s.attended === true ? "primary" : "secondary"}
                      onPress={() => void run(() => setAttendance({ slotId: s.id, attended: true }), STR.cmAttendanceSaved)}
                      disabled={busy}
                    />
                    <Button
                      title={STR.cmAbsent}
                      variant={s.attended === false ? "danger" : "ghost"}
                      onPress={() => void run(() => setAttendance({ slotId: s.id, attended: false }), STR.cmAttendanceSaved)}
                      disabled={busy}
                    />
                  </View>
                ) : null}

                {/* Per-child comparison link */}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                  {s.studentIds.map((sid, idx) => (
                    <Button
                      key={sid}
                      title={`${STR.cmComparison}: ${s.classLabels[idx] ?? bnNum(idx + 1)}`}
                      variant="ghost"
                      onPress={() =>
                        nav.navigate("MeetingComparison", {
                          meetingId,
                          studentId: sid,
                          studentName: s.classLabels[idx] ?? sid,
                        })
                      }
                    />
                  ))}
                </View>
              </Card>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
