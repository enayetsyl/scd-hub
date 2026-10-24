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
 *
 * Each slot leads with the family's student names (joined server-side); while draft
 * the admin edits clock-time breaks (setMeetingBreaks) and the slot list shows a
 * break row where the timing jumps over one.
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
  SET_MEETING_BREAKS,
  MEETING_RESPONSE_SUMMARY_QUERY,
  REVIEW_MEETING_CHANGE,
  type GenerateSlotsResultT,
  type MeetingBreakT,
  type MeetingDispatchResultT,
  type ParentMeetingSlotT,
} from "../../graphql/comments";
import { Screen, Card, Body, Muted, Button, Badge, Field, Loader, Notice } from "../../components/ui";
import { STR, meetingStatusLabel, minutesToHHMM, bnNum, isoDateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { rsvpStatus } from "../../lib/meetingRsvp";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme/tokens";
import type { CommentsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<CommentsStackParamList, "MeetingAdmin">;
type Nav = NativeStackNavigationProp<CommentsStackParamList>;

/** "10:30" / "১০:৩০" / "1030" → minutes-from-midnight, or null when not a valid clock time. */
function parseClock(raw: string): number | null {
  const ascii = raw.trim().replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
  const m = /^(\d{1,2}):?(\d{2})$/.exec(ascii);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  return h < 24 && mm < 60 ? h * 60 + mm : null;
}

/** A slot's children as display names, falling back to the class label when a name is missing. */
function childNames(s: ParentMeetingSlotT): string[] {
  return s.studentIds.map((_, idx) => s.studentNames?.[idx] || s.classLabels[idx] || bnNum(idx + 1));
}

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

  // Guardians' answers to their slots (D-#843) — after dispatch only.
  const [answersQ, refetchAnswers] = useQuery({
    query: MEETING_RESPONSE_SUMMARY_QUERY,
    variables: { meetingId },
    pause: isDraft,
  });
  const answers = answersQ.data?.meetingResponseSummary ?? null;
  const { can } = useAuth();
  const canApprove = can("parents_meeting:approve_change");
  const [, reviewChange] = useMutation(REVIEW_MEETING_CHANGE);
  const changeRequests = slots.filter((s) => s.response?.choice === "CHANGE_REQUESTED" && !s.response.reviewOutcome);

  const [, generate] = useMutation(GENERATE_MEETING_SLOTS);
  const [, setOnCall] = useMutation(SET_MEETING_SLOT_ON_CALL);
  const [, reorder] = useMutation(REORDER_MEETING_SLOTS);
  const [, dispatch] = useMutation(DISPATCH_MEETING_SCHEDULE);
  const [, setAttendance] = useMutation(SET_MEETING_SLOT_ATTENDANCE);
  const [, setBreaks] = useMutation(SET_MEETING_BREAKS);

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [genResult, setGenResult] = useState<GenerateSlotsResultT | null>(null);
  const [dispatchResult, setDispatchResult] = useState<MeetingDispatchResultT | null>(null);
  const [breakStart, setBreakStart] = useState("");
  const [breakEnd, setBreakEnd] = useState("");

  const breaks: MeetingBreakT[] = [...(meeting?.breaks ?? [])].sort((a, b) => a.startMinutes - b.startMinutes);
  const namesBySlot = new Map(slots.map((s) => [s.id, childNames(s)]));
  // Render cursor over `breaks` for the slot list (reset every render).
  let shownBreaks = 0;

  function refreshAll(): void {
    refetchMeeting({ requestPolicy: "network-only" });
    refetchSlots({ requestPolicy: "network-only" });
    if (!isDraft) {
      refetchSummary({ requestPolicy: "network-only" });
      refetchAnswers({ requestPolicy: "network-only" });
    }
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

  function saveBreaks(next: MeetingBreakT[]): Promise<unknown> {
    const plain = next.map((b) => ({ startMinutes: b.startMinutes, endMinutes: b.endMinutes }));
    return run(() => setBreaks({ meetingId, breaks: plain }), STR.cmBreaksSaved);
  }

  async function onAddBreak(): Promise<void> {
    const start = parseClock(breakStart);
    const end = parseClock(breakEnd);
    if (start == null || end == null || end <= start) {
      setOk(null);
      setError(STR.cmBreakInvalid);
      return;
    }
    if (await saveBreaks([...breaks, { startMinutes: start, endMinutes: end }])) {
      setBreakStart("");
      setBreakEnd("");
    }
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
            {/* MC-4 (D-#752..#756): the comment chain — collection, progress, finals. */}
            {meeting ? (
              <Button
                title={STR.mcCommentsButton}
                variant="secondary"
                onPress={() => nav.navigate("MeetingComments", { meetingId, instanceLabel: meeting.instanceLabel })}
              />
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

        {/* Breaks — editable while draft; the slot timing jumps over them */}
        {isDraft || breaks.length > 0 ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.cmBreaks}</Body>
            {breaks.length === 0 ? <Muted style={{ marginTop: space(1) }}>{STR.cmNoBreaks}</Muted> : null}
            {breaks.map((b) => (
              <View
                key={`${b.startMinutes}-${b.endMinutes}`}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(1) }}
              >
                <Body>
                  {minutesToHHMM(b.startMinutes)} – {minutesToHHMM(b.endMinutes)}
                </Body>
                {isDraft ? (
                  <Button
                    title={STR.cmRemoveBreak}
                    variant="ghost"
                    onPress={() => void saveBreaks(breaks.filter((x) => x !== b))}
                    disabled={busy}
                  />
                ) : null}
              </View>
            ))}
            {isDraft ? (
              <>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                  <View style={{ flexGrow: 1, flexBasis: 140 }}>
                    <Field label={STR.cmBreakStart} value={breakStart} onChangeText={setBreakStart} placeholder="10:30" />
                  </View>
                  <View style={{ flexGrow: 1, flexBasis: 140 }}>
                    <Field label={STR.cmBreakEnd} value={breakEnd} onChangeText={setBreakEnd} placeholder="11:00" />
                  </View>
                </View>
                <Button title={STR.cmAddBreak} variant="secondary" onPress={() => void onAddBreak()} disabled={busy} />
                <Muted style={{ marginTop: space(1) }}>{STR.cmBreakHint}</Muted>
              </>
            ) : null}
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

        {/* Guardians' answers + change requests (D-#842/#843) */}
        {!isDraft && answers ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.rsResponses}</Body>
            <Muted style={{ marginTop: space(1) }}>
              {STR.cmTotal}: {bnNum(answers.total)} · {STR.rsConfirmedCount}: {bnNum(answers.confirmed)} ·{" "}
              {STR.rsStCantCome}: {bnNum(answers.cantCome)} · {STR.rsStNoAnswer}: {bnNum(answers.noAnswer)}
            </Muted>
            <Muted>
              {STR.rsPendingCount}: {bnNum(answers.changePending)} · {STR.rsApprovedCount}:{" "}
              {bnNum(answers.changeApproved)} · {STR.rsDeclinedCount}: {bnNum(answers.changeDeclined)}
            </Muted>

            <Body style={{ fontWeight: "700", marginTop: space(3) }}>{STR.rsChangeRequests}</Body>
            {changeRequests.length === 0 ? (
              <Muted style={{ marginTop: space(1) }}>{STR.rsNoRequests}</Muted>
            ) : (
              changeRequests.map((s) => {
                const wanted = s.response?.preferredSlotTime ?? null;
                const holder = slots.find((o) => !o.onCall && o.slotTime === wanted) ?? null;
                const mutual =
                  !!holder &&
                  holder.response?.choice === "CHANGE_REQUESTED" &&
                  !holder.response.reviewOutcome &&
                  holder.response.preferredSlotTime === s.slotTime;
                return (
                  <View key={s.id} style={{ marginTop: space(2) }}>
                    <Body>{childNames(s).join(", ")}</Body>
                    <Muted>
                      {s.onCall ? STR.cmOnCall : minutesToHHMM(s.slotTime)} → {minutesToHHMM(wanted)}
                    </Muted>
                    {holder ? (
                      <Muted>
                        {STR.rsHeldBy}: {childNames(holder).join(", ")} ({rsvpStatus(holder.response).text})
                      </Muted>
                    ) : null}
                    {mutual ? <Notice tone="info" message={STR.rsMutual} /> : null}
                    {canApprove ? (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1) }}>
                        <Button
                          title={STR.rsApprove}
                          onPress={() =>
                            void run(
                              () => reviewChange({ slotId: s.id, approve: true }),
                              mutual ? STR.rsApproved : `${STR.rsApproved}. ${STR.rsMovedNote}`,
                            )
                          }
                          disabled={busy}
                        />
                        <Button
                          title={STR.rsDecline}
                          variant="ghost"
                          onPress={() => void run(() => reviewChange({ slotId: s.id, approve: false }), STR.rsDeclined)}
                          disabled={busy}
                        />
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
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
                  {namesBySlot.has(o.slotId) ? <Body>{namesBySlot.get(o.slotId)?.join(", ")}</Body> : null}
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
            slots.map((s, i) => {
              // Breaks that end by this slot's start are drawn just above it (timed slots only).
              const breaksBefore: MeetingBreakT[] = [];
              if (!s.onCall && s.slotTime != null) {
                while (shownBreaks < breaks.length && breaks[shownBreaks].endMinutes <= s.slotTime) {
                  breaksBefore.push(breaks[shownBreaks]);
                  shownBreaks += 1;
                }
              }
              const names = childNames(s);
              return (
              <React.Fragment key={s.id}>
              {breaksBefore.map((b) => (
                <Notice
                  key={`break-${b.startMinutes}`}
                  tone="info"
                  message={`${STR.cmBreaks}: ${minutesToHHMM(b.startMinutes)} – ${minutesToHHMM(b.endMinutes)}`}
                />
              ))}
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body style={{ fontWeight: "700" }}>
                      {bnNum(i + 1)}. {names.join(", ")}
                    </Body>
                    <Muted>
                      {s.onCall ? STR.cmOnCall : minutesToHHMM(s.slotTime)} · {s.classLabels.join(", ")}
                    </Muted>
                    {!isDraft ? (
                      <Muted>
                        {rsvpStatus(s.response).text}
                        {s.response?.reason ? ` — ${STR.rsReasonPrefix}: ${s.response.reason}` : ""}
                      </Muted>
                    ) : null}
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

                {/* MC-4 (D-#754): the meeting-day brief for this family — every child of the
                    slot as a tab; it carries the whole comment chain and the numbers, so it
                    replaces the per-child comparison link here. */}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                  <Button
                    title={`${STR.mcBriefButton}: ${names.join(", ")}`}
                    variant="ghost"
                    onPress={() => nav.navigate("MeetingBrief", { meetingId, studentIds: s.studentIds })}
                  />
                </View>
              </Card>
              </React.Fragment>
              );
            })
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
