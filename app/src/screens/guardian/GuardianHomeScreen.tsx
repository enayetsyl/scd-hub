/**
 * GuardianHomeScreen ("আজ", GP-2) — the selected child's today: routine
 * (day-type aware — a holiday shows its label), class notes, open homework with
 * state chips, and the personal day-load vs the LOCKED 120. The bottom cards
 * now open the live guardian surfaces for attendance, fees, notices, leave,
 * and notifications.
 */
import React from "react";
import { Pressable, ScrollView, View, RefreshControl } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import {
  CHILD_ROUTINE_QUERY,
  CHILD_CLASS_NOTES_QUERY,
  CHILD_HOMEWORK_QUERY,
  CHILD_DAY_LOAD_QUERY,
  CHILD_UPCOMING_CLASS_TESTS_QUERY,
  CHILD_LIBRARY_LOANS_QUERY,
  CHILD_VOCAB_QUERY,
  CHILD_ASSIGNMENTS,
  CHILD_FEE_DUE_QUERY,
} from "../../graphql/operations";
import { CHILD_TEST_RESULTS_QUERY } from "../../graphql/classTest";
import { CHILD_COMMENTS_QUERY } from "../../graphql/comments";
import { CHILD_REVISION_QUERY } from "../../graphql/revision";
import { Screen, Body, Muted, Card, Badge, Button, Notice, Loader, EmptyState, Divider } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { useRecordView } from "../../lib/useRecordView";
import { useNotifications } from "../../state/NotificationContext";
import { CHILD_TRAJECTORY_QUERY } from "../../graphql/wholePicture";
import { openStoredFile, FILE_VIEW_SUPPORTED } from "../../lib/files";
import { useFileOpen } from "../../lib/useFileOpen";
import { usePullRefresh } from "../../lib/useRefresh";
import { openNotificationCenter } from "../../navigation/navigationRef";
import type { GuardianHomeStackParamList } from "../../navigation/types";
import {
  STR,
  bnNum,
  loanStatusLabel,
  vocabProgramLabel,
  hwSubjectLabel,
  commentTypeLabel,
  commentSentimentLabel,
  revCategoryLabel,
  subjectLabel,
  lifecycleStateLabel,
  hwGuardianStatusLabel,
  dayTypeLabel,
  getActiveLang,
  isoDateLabel,
} from "../../lib/labels";
import { space } from "../../theme/tokens";
import { dateKey } from "../../lib/dates";

type Nav = NativeStackNavigationProp<GuardianHomeStackParamList>;

const isoDay = (d: Date): string => dateKey(d);
const today = (): string => isoDay(new Date());
const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
};

/** Lifecycle states that still need the family's attention (not RETURNED). */
const OPEN_STATES = new Set(["GIVEN", "ABSENT_REDELIVER", "DUE", "SUBMITTED", "CHASE", "CHECKED", "RESUBMIT"]);

export default function GuardianHomeScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const { selected, fetching } = useGuardianChild();
  useRecordView("HOME", selected?.studentId);
  const lang = getActiveLang();
  const [showTrajHow, setShowTrajHow] = React.useState(false);
  const sid = selected?.studentId ?? "";
  const date = today();
  const { openingId, runOpen } = useFileOpen();

  // The guardian trajectory summary (D-#277 follow-up): direction of travel and the
  // child's OWN numbers. No rank, no class comparison — the server never sends them.
  const [trajQ, refetchTraj] = useQuery({ query: CHILD_TRAJECTORY_QUERY, variables: { studentId: sid }, pause: !selected });
  const traj = trajQ.data?.childTrajectory ?? null;

  const [routineQ, refetchRoutine] = useQuery({
    query: CHILD_ROUTINE_QUERY,
    variables: { studentId: sid, date },
    pause: !selected,
  });
  const [notesQ, refetchNotes] = useQuery({
    query: CHILD_CLASS_NOTES_QUERY,
    variables: { studentId: sid, date },
    pause: !selected,
  });
  const [hwQ, refetchHw] = useQuery({
    query: CHILD_HOMEWORK_QUERY,
    variables: { studentId: sid, from: daysAgo(7), to: date },
    pause: !selected,
  });
  const [loadQ, refetchLoad] = useQuery({
    query: CHILD_DAY_LOAD_QUERY,
    variables: { studentId: sid, date },
    pause: !selected,
  });
  const [libraryQ, refetchLibrary] = useQuery({
    query: CHILD_LIBRARY_LOANS_QUERY,
    variables: { studentId: sid },
    pause: !selected,
  });
  // D-#472: confirmed class tests the child will sit — shown until the exam day
  // passes, then the row simply stops being returned (no cleanup job).
  const [testsQ, refetchUpcoming] = useQuery({
    query: CHILD_UPCOMING_CLASS_TESTS_QUERY,
    variables: { studentId: sid },
    pause: !selected,
  });
  const upcomingTests = testsQ.data?.childUpcomingClassTests ?? [];

  const [vocabQ, refetchVocab] = useQuery({
    query: CHILD_VOCAB_QUERY,
    variables: { studentId: sid },
    pause: !selected,
  });
  const [testResultsQ, refetchTests] = useQuery({
    query: CHILD_TEST_RESULTS_QUERY,
    variables: { studentId: sid },
    pause: !selected,
  });
  const [commentsQ, refetchComments] = useQuery({
    query: CHILD_COMMENTS_QUERY,
    variables: { studentId: sid },
    pause: !selected,
  });
  const [revisionQ, refetchRevision] = useQuery({
    query: CHILD_REVISION_QUERY,
    variables: { studentId: sid },
    pause: !selected,
  });
  const [asgnQ, refetchAsgn] = useQuery({
    query: CHILD_ASSIGNMENTS,
    variables: { studentId: sid },
    pause: !selected,
  });
  const [feeQ, refetchFee] = useQuery({
    query: CHILD_FEE_DUE_QUERY,
    variables: { studentId: sid },
    pause: !selected,
  });
  const { unreadCount } = useNotifications();

  // UX-7: pull-to-refresh — one gesture refreshes every card on the guardian home.
  const anyFetching =
    routineQ.fetching || notesQ.fetching || hwQ.fetching || loadQ.fetching || libraryQ.fetching ||
    vocabQ.fetching || testResultsQ.fetching || commentsQ.fetching || revisionQ.fetching || asgnQ.fetching ||
    feeQ.fetching;
  const { refreshing, onRefresh } = usePullRefresh(anyFetching, () => {
    const opts = { requestPolicy: "network-only" as const };
    refetchRoutine(opts);
    refetchNotes(opts);
    refetchHw(opts);
    refetchLoad(opts);
    refetchLibrary(opts);
    refetchVocab(opts);
    refetchTests(opts);
    refetchUpcoming(opts);
    refetchComments(opts);
    refetchRevision(opts);
    refetchAsgn(opts);
    refetchFee(opts);
  });
  // CM-6 follow-up: no guardian meeting-slot card is rendered. The server's
  // childMeetingSlot(meetingId, studentId) read needs a meetingId, but there is NO
  // guardian-facing "list my meetings" query to obtain one — so a guardian cannot
  // reach it. Surface a slot card only once a server read yields the family's
  // meetings (or childMeetingSlot drops the meetingId arg).

  if (fetching && !selected) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }
  if (!selected) {
    return (
      <Screen>
        <EmptyState message={STR.gpNoChildren} />
      </Screen>
    );
  }

  const day = routineQ.data?.childRoutine;
  const notes = notesQ.data?.childClassNotes ?? [];
  const openHomework = (hwQ.data?.childHomework ?? []).filter(
    (r) => OPEN_STATES.has(r.state) || r.dateGiven.slice(0, 10) === date,
  );
  const load = loadQ.data?.childDayLoad;

  // Owner ask 2026-07-21: the open-homework list groups by GIVEN date (the
  // server already sorts newest-first, and Map keeps that order), each date
  // showing its own load sum (declared minutes + top-up) so the family sees
  // the day-wise চাপ; tapping the card opens the homework screen.
  // DE-6 (D-#477): the action list. DUE = "hand it in today", CHASE = "did not
  // bring it" — the only two homework states a family can still act on. Everything
  // else open (submitted, checked, awaiting return) is progress, not a to-do.
  const TODO_STATES = new Set(["DUE", "CHASE"]);
  const todoHomework = openHomework.filter((r) => TODO_STATES.has(r.state));
  const todoIds = new Set(todoHomework.map((r) => r.recordId));

  // ...and the homework card below lists what is NOT already in it, so a row never
  // appears twice on one screen (the duplication DE-6 exists to remove). The card
  // still renders for its day-load line even when every open row moved up.
  const hwByDate = new Map<string, typeof openHomework>();
  for (const r of openHomework.filter((x) => !todoIds.has(x.recordId))) {
    const k = r.dateGiven.slice(0, 10);
    const list = hwByDate.get(k);
    if (list) list.push(r);
    else hwByDate.set(k, [r]);
  }
  const dateMinutes = (rows: typeof openHomework): number =>
    rows.reduce((m, r) => m + (r.timeDecl ?? 0) + (r.topupFlag ? (r.topupTimeMin ?? 0) : 0), 0);
  const goHomework = (): void =>
    (nav as unknown as { navigate: (name: string, params?: object) => void }).navigate(
      "GuardianHomeworkTab",
      { screen: "ChildHomework" },
    );

  // Same treatment for assignments: group by the given (delivery) date — due
  // date as fallback — with a per-date item count; the card opens the
  // assignment screen. Assignments carry no declared minutes, so the count is
  // the load figure here.
  const assignments = asgnQ.data?.childAssignments ?? [];
  // DE-6: the assignment half of the action list — late, or being chased.
  const todoAssignments = assignments.filter((a) => a.state === "CHASE" || (a.pending && a.daysLate > 0));
  const asgnByDate = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const k = (a.deliveryDate ?? a.dueDate ?? "").slice(0, 10);
    const list = asgnByDate.get(k);
    if (list) list.push(a);
    else asgnByDate.set(k, [a]);
  }
  const asgnDates = [...asgnByDate.keys()].sort((x, y) => y.localeCompare(x));
  const goAssignments = (): void =>
    (nav as unknown as { navigate: (name: string, params?: object) => void }).navigate(
      "GuardianAssignmentsTab",
      { screen: "ChildAssignments" },
    );

  // Owner ask 2026-07-19: teacher-Today-style attention cards for the family.
  // Each fires only when there is something to act on; the strip hides entirely
  // on a quiet day. Composed from the queries this screen already runs (+fees).
  const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
  const isRecent = (iso: string | null | undefined): boolean =>
    !!iso && Date.now() - new Date(iso).getTime() <= RECENT_MS;
  const hwChaseCount = openHomework.filter((r) => r.state === "CHASE").length;
  const asgnChaseCount = (asgnQ.data?.childAssignments ?? []).filter(
    (a) => a.state === "CHASE" || (a.pending && a.daysLate > 0),
  ).length;
  const feeDue = feeQ.data?.childFeeDue?.guardianDue ?? 0;
  const recentComments = (commentsQ.data?.childComments ?? []).filter((c) =>
    isRecent(c.deliveredAt ?? c.createdAt),
  ).length;
  const recentTests = (testResultsQ.data?.childTestResults ?? []).filter((t) =>
    isRecent(t.publishedAt),
  ).length;
  const alerts: Array<{ key: string; text: string; tone: "danger" | "warn" | "info"; onPress?: () => void }> = [];
  if (hwChaseCount > 0) {
    alerts.push({ key: "hw", text: `${STR.gpAlertHwChase}: ${bnNum(hwChaseCount)}`, tone: "danger" });
  }
  if (asgnChaseCount > 0) {
    alerts.push({ key: "asgn", text: `${STR.gpAlertAsgnLate}: ${bnNum(asgnChaseCount)}`, tone: "danger" });
  }
  if (feeDue > 0) {
    alerts.push({
      key: "fees",
      text: `${STR.gpAlertFeesDue}: ${bnNum(feeDue)}`,
      tone: "warn",
      onPress: () => nav.navigate("ChildFees"),
    });
  }
  if (recentComments > 0) {
    alerts.push({ key: "comments", text: `${STR.gpAlertNewComment}: ${bnNum(recentComments)}`, tone: "info" });
  }
  if (recentTests > 0) {
    alerts.push({ key: "tests", text: `${STR.gpAlertNewTest}: ${bnNum(recentTests)}`, tone: "info" });
  }
  if (unreadCount > 0) {
    alerts.push({
      key: "notifications",
      text: `${STR.gpAlertNotifications}: ${bnNum(unreadCount)}`,
      tone: "info",
      onPress: () => openNotificationCenter(),
    });
  }
  const shortcuts = [
    { key: "attendance", title: STR.gpAttendance, onPress: () => nav.navigate("ChildAttendance") },
    { key: "fees", title: STR.gpFees, onPress: () => nav.navigate("ChildFees") },
    { key: "notices", title: STR.gpNotices, onPress: () => nav.navigate("ChildClassNotes") },
    { key: "leave", title: STR.gpLeave, onPress: () => nav.navigate("ChildLeave") },
    { key: "notifications", title: STR.gpPush, onPress: () => openNotificationCenter() },
  ];

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <ChildSwitcher />

        <QueryGate
          results={[trajQ, routineQ, notesQ, hwQ, loadQ, libraryQ, vocabQ, testResultsQ, commentsQ, revisionQ, asgnQ, feeQ]}
          onRetry={() => {
            const opts = { requestPolicy: "network-only" as const };
            refetchTraj(opts);
            refetchRoutine(opts);
            refetchNotes(opts);
            refetchHw(opts);
            refetchLoad(opts);
            refetchLibrary(opts);
            refetchVocab(opts);
            refetchTests(opts);
            refetchComments(opts);
            refetchRevision(opts);
            refetchAsgn(opts);
            refetchFee(opts);
          }}
          loaderLabel={STR.loading}
        >
        {/* D-#472: upcoming class tests — sits ABOVE the attention strip because it is
            the one thing on this screen the family can still act on (revise). Each row
            drops off by itself once its exam day has passed. */}
        {upcomingTests.length > 0 ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.gpUpcomingTests}</Body>
            {upcomingTests.map((t, i) => (
              <View key={t.id} style={{ marginTop: i === 0 ? 0 : space(2) }}>
                {i === 0 ? null : <Divider />}
                <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                  <Body style={{ fontWeight: "700", flex: 1 }}>
                    {t.subjectLabelBn}
                    {t.testNumber ? ` · টেস্ট ${bnNum(t.testNumber)}` : ""}
                  </Body>
                  <Badge
                    text={
                      t.daysAway === 0
                        ? STR.gpTestToday
                        : t.daysAway === 1
                          ? STR.gpTestTomorrow
                          : `${bnNum(t.daysAway)} ${STR.gpTestInDays}`
                    }
                    tone={t.daysAway <= 1 ? "warn" : "info"}
                  />
                </View>
                <Muted>{bnNum(t.examDate.slice(0, 10))}</Muted>
                {t.chapter ? (
                  <Muted>
                    {STR.gpChapter}: {t.chapter}
                  </Muted>
                ) : null}
                <Muted>
                  {t.totalMarks != null ? `${STR.gpMarks} ${bnNum(t.totalMarks)}` : ""}
                  {t.totalMarks != null && t.durationMinutes != null ? " · " : ""}
                  {t.durationMinutes != null ? `${bnNum(t.durationMinutes)} ${STR.gpMinutes}` : ""}
                </Muted>
              </View>
            ))}
          </Card>
        ) : null}

        {/* Attention strip (owner ask 2026-07-19) — chase, fees due, new comment/
            result, unread notifications. Hidden entirely on a quiet day. */}
        {alerts.length > 0 ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.gpAlertsTitle}</Body>
            {alerts.map((a) =>
              a.onPress ? (
                <Pressable
                  key={a.key}
                  onPress={a.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={a.text}
                  style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                >
                  <Notice message={`${a.text} ›`} tone={a.tone} />
                </Pressable>
              ) : (
                <Notice key={a.key} message={a.text} tone={a.tone} />
              ),
            )}
          </Card>
        ) : null}

        {/* Trajectory summary — how the child is doing, in plain Bangla. The server
            sends direction + their own numbers only; there is no rank to leak here. */}
        {traj ? (
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>{STR.wpTrajectoryChild}</Body>
              <Badge
                text={
                  traj.overall === "improving"
                    ? STR.wpImproving
                    : traj.overall === "declining"
                      ? STR.wpDeclining
                      : traj.overall === "steady"
                        ? STR.wpSteady
                        : STR.wpNa
                }
                tone={traj.overall === "improving" ? "ok" : traj.overall === "declining" ? "danger" : "warn"}
              />
            </View>
            {(lang === "en" && traj.linesEn.length > 0 ? traj.linesEn : traj.linesBn).map((line, i) => (
              <Muted key={i} style={{ marginTop: space(1) }}>
                {line}
              </Muted>
            ))}
            {/* Owner ask 2026-07-19: guardians should see HOW the badge is decided. */}
            <Pressable
              onPress={() => setShowTrajHow((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={STR.gpTrajHowTitle}
              style={({ pressed }) => [{ marginTop: space(2) }, pressed && { opacity: 0.7 }]}
            >
              <Body style={{ textDecorationLine: "underline" }}>
                {showTrajHow ? STR.gpTrajHowHide : STR.gpTrajHowTitle}
              </Body>
            </Pressable>
            {showTrajHow ? <Muted style={{ marginTop: space(1) }}>{STR.gpTrajHowBody}</Muted> : null}
          </Card>
        ) : null}

        {/* Child info — section + Quran/Arabic group memberships (myChildren,
            already loaded by the provider; cross-grade groups per D-#48/#56). */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.gpChildInfo}</Body>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(2) }}>
            <Muted>{STR.gpSection}</Muted>
            <Body>{lang === "en" ? selected.sectionCode || selected.sectionName : selected.sectionName}</Body>
          </View>
          {selected.quranGroup ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(1) }}>
              <Muted>{STR.gpQuranGroup}</Muted>
              <Body>{selected.quranGroup.name}</Body>
            </View>
          ) : null}
          {selected.arabicGroup ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(1) }}>
              <Muted>{STR.gpArabicGroup}</Muted>
              <Body>{selected.arabicGroup.name}</Body>
            </View>
          ) : null}
        </Card>

        {/* Today's routine (subject + period + time ONLY, D-#69) */}
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700" }}>{STR.gpToday}</Body>
            {day ? (
              <Badge
                text={day.dayType === "HOLIDAY" && day.holidayNameBn ? day.holidayNameBn : dayTypeLabel(day.dayType)}
                tone={day.dayType === "FULL" ? "brand" : "warn"}
              />
            ) : null}
          </View>
          {!day || day.slots.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{day ? dayTypeLabel(day.dayType) : ""}</Muted>
          ) : (
            day.slots.map((s) => (
              <View
                key={`${s.periodNumber}-${s.subject}`}
                style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(2) }}
              >
                <Body>
                  {bnNum(s.periodNumber)}. {subjectLabel(s.subject)}
                </Body>
                <Muted>{s.startHHMM && s.endHHMM ? `${s.startHHMM}–${s.endHHMM}` : ""}</Muted>
              </View>
            ))
          )}
        </Card>

        {/* DE-6 (D-#477): "করতে হবে" — the one card that answers the question a
            parent opens the app with. Only what is still ACTIONABLE: homework due
            or being chased, and assignments pending or late. Each row is
            self-sufficient (D-#478 description + dates), so nothing here needs a
            trip to another screen. Hidden entirely on a clear day. */}
        {todoHomework.length > 0 || todoAssignments.length > 0 ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.gpTodo}</Body>
            {todoHomework.map((r) => (
              <Pressable key={r.recordId} accessibilityRole="button" onPress={goHomework} style={{ marginTop: space(2) }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                  <Body style={{ fontWeight: "700", flexShrink: 1 }}>{subjectLabel(r.subject)}</Body>
                  <Badge text={hwGuardianStatusLabel(r.state)} tone={r.state === "CHASE" ? "danger" : "warn"} />
                </View>
                {r.description ? <Body>{r.description}</Body> : null}
                <Muted>
                  {isoDateLabel(r.dateGiven.slice(0, 10))}
                  {r.timeDecl != null ? ` · ${bnNum(r.timeDecl)} ${STR.gpMinutes}` : ""}
                  {r.questionFileId || r.attachmentIds.length > 0 ? ` · 📎 ${STR.gpQuestionFile}` : ""}
                </Muted>
              </Pressable>
            ))}
            {todoAssignments.map((a) => (
              <Pressable key={a.recordId} accessibilityRole="button" onPress={goAssignments} style={{ marginTop: space(2) }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                  <Body style={{ fontWeight: "700", flexShrink: 1 }}>
                    {hwSubjectLabel(a.subject)} · {STR.gpAssignments}
                  </Body>
                  <Badge
                    text={a.daysLate > 0 ? `${bnNum(a.daysLate)} ${STR.asDaysOverdue}` : lifecycleStateLabel(a.state)}
                    tone={a.daysLate > 0 || a.state === "CHASE" ? "danger" : "warn"}
                  />
                </View>
                {a.description ? <Body>{a.description}</Body> : null}
                <Muted>
                  {a.dueDate ? `${STR.asDueBy} ${isoDateLabel(a.dueDate.slice(0, 10))}` : a.asId}
                </Muted>
              </Pressable>
            ))}
          </Card>
        ) : null}

        {/* Class notes — what was taught today */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.gpClassNotes}</Body>
          {notes.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.gpNoNotes}</Muted>
          ) : (
            notes.map((n, i) => (
              <View key={`${n.subject}-${n.periodNumber ?? i}`} style={{ marginTop: space(2) }}>
                <Body style={{ fontWeight: "700" }}>{subjectLabel(n.subject)}</Body>
                <Body>{n.taughtSummaryBn}</Body>
                {n.homework ? (
                  <>
                    {/* DE-6: the lesson and its homework read as one thing, which is
                        how the family thinks of them. */}
                    {n.homework.description ? (
                      <Body>
                        {STR.gpHomeworkOpen}: {n.homework.description}
                      </Body>
                    ) : null}
                    <Muted>
                      {n.homework.hwId} · {bnNum(n.homework.qCount)} · {bnNum(n.homework.timeDecl)}{" "}
                      {STR.gpMinutes}
                    </Muted>
                  </>
                ) : null}
              </View>
            ))
          )}
          <View style={{ marginTop: space(2) }}>
            <Button
              title={STR.gpPastLessons}
              variant="ghost"
              onPress={() => nav.navigate("ChildClassNotes")}
            />
          </View>
        </Card>

        {/* Open homework + day-load vs 120, grouped per given-date; the whole
            card taps through to the homework screen. */}
        <Card>
          <Pressable accessibilityRole="button" onPress={goHomework}>
            <Body style={{ fontWeight: "700" }}>{STR.gpHomeworkOpen}</Body>
            {load ? (
              <Muted style={{ marginTop: space(1) }}>
                {STR.gpDayLoad}: {bnNum(load.totalMinutes)}/{bnNum(load.ceiling)} {STR.gpMinutes}
                {load.topupMinutes > 0
                  ? ` (${STR.gpDayLoadBase} ${bnNum(load.baseMinutes)} + ${STR.gpDayLoadTopup} ${bnNum(
                      load.topupMinutes,
                    )})`
                  : ""}
              </Muted>
            ) : null}
            {load?.overCeiling ? (
              <Notice
                message={`${STR.gpDayLoad}: ${bnNum(load.totalMinutes)}/${bnNum(load.ceiling)} ${STR.gpMinutes}`}
                tone="warn"
              />
            ) : null}
            {openHomework.length === 0 ? (
              <Muted style={{ marginTop: space(2) }}>{STR.gpNoHomework}</Muted>
            ) : (
              [...hwByDate.entries()].map(([k, rows]) => (
                <View key={k} style={{ marginTop: space(2) }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Body style={{ fontWeight: "700" }}>{isoDateLabel(k)}</Body>
                    <Muted>
                      {STR.gpDateLoad}: {bnNum(dateMinutes(rows))}/{bnNum(load?.ceiling ?? 120)} {STR.gpMinutes}
                    </Muted>
                  </View>
                  {/* Same shape as ChildHomeworkScreen: the parent-facing status is a
                      sentence, so it goes UNDER the subject rather than beside it. Inline,
                      it left the title column a few pixels wide (RN defaults flexShrink to
                      0, so the badge never yielded) and `ইংরেজি` / `HW-C1-ENG-0013` wrapped
                      one character per line. */}
                  {rows.map((r) => (
                    <View key={r.recordId} style={{ marginTop: space(2) }}>
                      <View style={{ flexShrink: 1 }}>
                        <Body>{subjectLabel(r.subject)}</Body>
                        {/* D-#478: what the work actually was — mandatory since D-#317,
                            fetched by this very query, rendered nowhere until now. The 📎
                            is a MARKER, not a button: this whole card is a Pressable that
                            opens the homework screen, and a nested pressable double-fires
                            (the D-#371 header lesson). The real viewer lives there. */}
                        {r.description ? <Body>{r.description}</Body> : null}
                        <Muted>
                          {r.hwId}
                          {r.questionFileId || r.attachmentIds.length > 0 ? ` · 📎 ${STR.gpQuestionFile}` : ""}
                        </Muted>
                      </View>
                      <View style={{ marginTop: space(1) }}>
                        <Badge
          text={hwGuardianStatusLabel(r.state)}
          /* Three steps, not two: amber "due today" → red "did not bring it" → green for
             everything already handed in. DUE used to render GREEN while saying the
             child had not done the work, which read as both wrong and alarming. */
          tone={r.state === "CHASE" ? "danger" : r.state === "DUE" ? "warn" : "brand"}
        />
                      </View>
                    </View>
                  ))}
                </View>
              ))
            )}
          </Pressable>
        </Card>

        {/* Assignments — the child's weekly AS-… items (AS-T5 childAssignments,
            read-only; issued items only — a DRAFT week has no student record yet),
            grouped per date with a count; the card taps through to the
            assignment screen. */}
        <Card>
          <Pressable accessibilityRole="button" onPress={goAssignments}>
            <Body style={{ fontWeight: "700" }}>{STR.gpAssignments}</Body>
            {assignments.length === 0 ? (
              <Muted style={{ marginTop: space(2) }}>{STR.gpNoAssignments}</Muted>
            ) : (
              asgnDates.map((k) => (
                <View key={k || "-"} style={{ marginTop: space(2) }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Body style={{ fontWeight: "700" }}>{k ? isoDateLabel(k) : "—"}</Body>
                    <Muted>
                      {STR.gpDateCount}: {bnNum((asgnByDate.get(k) ?? []).length)}
                    </Muted>
                  </View>
                  {(asgnByDate.get(k) ?? []).map((a) => (
                    <View
                      key={a.recordId}
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginTop: space(2),
                      }}
                    >
                      <View style={{ flexShrink: 1 }}>
                        <Body>{hwSubjectLabel(a.subject)}</Body>
                        {/* D-#478, the assignment twin of the homework row above. */}
                        {a.description ? <Body>{a.description}</Body> : null}
                        <Muted>
                          {a.asId}
                          {a.daysLate > 0 ? ` · ${bnNum(a.daysLate)} ${STR.asDaysOverdue}` : ""}
                          {a.marks !== null
                            ? ` · ${bnNum(a.marks)}${a.totalMarks !== null ? `/${bnNum(a.totalMarks)}` : ""}`
                            : ""}
                        </Muted>
                      </View>
                      <Badge text={lifecycleStateLabel(a.state)} tone={a.state === "CHASE" ? "danger" : "brand"} />
                    </View>
                  ))}
                </View>
              ))
            )}
          </Pressable>
        </Card>

        {/* Library loans — read-only child-loans card (LB-5 rider, J-L9; D-#68:
            no reserve/renew control exists for guardians) */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.gpLibraryLoans}</Body>
          {(libraryQ.data?.childLibraryLoans ?? []).length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.gpNoLibraryLoans}</Muted>
          ) : (
            (libraryQ.data?.childLibraryLoans ?? []).map((loan) => (
              <View
                key={loan.id}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: space(2),
                }}
              >
                <View style={{ flexShrink: 1 }}>
                  <Body>{loan.titleBn ?? loan.accessionNo ?? "—"}</Body>
                  <Muted>
                    {loan.status === "ACTIVE"
                      ? `${STR.libDue}: ${isoDateLabel(loan.dueDate)}`
                      : loan.returnedAt
                        ? `${loanStatusLabel(loan.status)}: ${isoDateLabel(loan.returnedAt)}`
                        : loanStatusLabel(loan.status)}
                  </Muted>
                </View>
                {loan.overdue ? (
                  <Badge text={STR.libOverdue} tone="danger" />
                ) : loan.status === "ACTIVE" ? (
                  <Badge text={loanStatusLabel(loan.status)} tone="brand" />
                ) : (
                  <Badge text={loanStatusLabel(loan.status)} tone="muted" />
                )}
              </View>
            ))
          )}
        </Card>

        {/* Vocabulary results — read-only, marked tests only (VC-5 / J7, D-#155) */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.gpVocab}</Body>
          {(vocabQ.data?.childVocab ?? []).length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.gpNoVocab}</Muted>
          ) : (
            (vocabQ.data?.childVocab ?? []).map((v) => (
              <View
                key={v.testId}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}
              >
                <View style={{ flexShrink: 1 }}>
                  <Body>
                    {vocabProgramLabel(v.program)} · {v.label}
                  </Body>
                  <Muted>{isoDateLabel(v.testDate)}</Muted>
                </View>
                <Badge
                  text={
                    v.result.status === "ABSENT"
                      ? STR.vbAbsent
                      : `${bnNum(v.result.score ?? 0)}/${bnNum(v.result.totalMarks)}`
                  }
                  tone={v.result.status === "ABSENT" ? "muted" : "brand"}
                />
              </View>
            ))
          )}
        </Card>

        {/* Class-test results — read-only, PUBLISHED only (CT-5 / J7, D-#68). Never
            shows teacherAction (the childTestResults query doesn't fetch it). */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.gpTestResults}</Body>
          {(testResultsQ.data?.childTestResults ?? []).length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.gpNoTestResults}</Muted>
          ) : (
            (testResultsQ.data?.childTestResults ?? []).map((r) => (
              <View key={r.testId} style={{ marginTop: space(2) }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body>
                      {hwSubjectLabel(r.subject)} · {STR.ctTestNumber} {bnNum(r.testNumber)}
                    </Body>
                    <Muted>{isoDateLabel(r.examDate)}</Muted>
                  </View>
                  <Badge
                    text={
                      r.status === "ABSENT"
                        ? STR.ctAbsent
                        : `${bnNum(r.marks ?? 0)}/${bnNum(r.totalMarks)}${r.percent == null ? "" : ` · ${bnNum(r.percent)}%`}`
                    }
                    tone={r.status === "ABSENT" ? "muted" : r.pass ? "brand" : "danger"}
                  />
                </View>
                {r.weakness ? <Muted>{STR.ctWeakness}: {r.weakness}</Muted> : null}
                {r.guardianAction ? <Muted>{STR.ctGuardianAction}: {r.guardianAction}</Muted> : null}
              </View>
            ))
          )}
        </Card>

        {/* Teacher comments — read-only, DELIVERED daily comments only (CM-6 / CM-5,
            J-CM8, D-#68). The childComments query structurally omits authorUserId /
            sectionId / deliveryChannels. Attachments open on web via openStoredFile. */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.gpComments}</Body>
          {(commentsQ.data?.childComments ?? []).length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.gpNoComments}</Muted>
          ) : (
            (commentsQ.data?.childComments ?? []).map((c) => (
              <View key={c.id} style={{ marginTop: space(2) }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Muted>
                    {commentTypeLabel(c.type)} · {commentSentimentLabel(c.sentiment)}
                  </Muted>
                  <Muted>{isoDateLabel(c.createdAt)}</Muted>
                </View>
                <Body style={{ marginTop: space(1) }}>{c.text}</Body>
                {c.attachmentIds.length > 0 && FILE_VIEW_SUPPORTED ? (
                  <View style={{ marginTop: space(1) }}>
                    {c.attachmentIds.map((fid) => (
                      <Button
                        key={fid}
                        title={STR.cmOpenAttachment}
                        variant="ghost"
                        loading={openingId === fid}
                        disabled={!!openingId}
                        onPress={() => runOpen(fid, () => openStoredFile(fid).catch(() => {}))}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            ))
          )}
        </Card>

        {/* Saturday Hifz revision — read-only, DELIVERED Saturdays only (SR-4). The
            childRevision query structurally omits teacherUserId / deliveryChannels;
            portions / ØªÙ†Ø¨ÛŒÙ‡ / ÙØªØ­ / structured mistakes / the teacher's comment. */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.gpRevision}</Body>
          {(revisionQ.data?.childRevision ?? []).length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.gpNoRevision}</Muted>
          ) : (
            (revisionQ.data?.childRevision ?? []).map((e) => (
              <View key={e.id} style={{ marginTop: space(2) }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Body style={{ fontWeight: "700" }}>{bnNum(e.date)}</Body>
                  <Badge text={e.present ? STR.revPresent : STR.revAbsent} tone={e.present ? "brand" : "muted"} />
                </View>
                {e.present
                  ? e.juzRecords.map((r, i) => (
                      <Muted key={i} style={{ marginTop: space(1) }}>
                        {revCategoryLabel(r.category)} · {STR.revJuz} {bnNum(r.juz)} · {bnNum(r.amountJuz)} · {STR.revTanbih}{" "}
                        {bnNum(r.tanbih)} · {STR.revFath} {bnNum(r.fath)} · {STR.revMistakes}{" "}
                        {bnNum(r.mistakes.harf + r.mistakes.ghunnah + r.mistakes.madd + r.mistakes.other)}
                      </Muted>
                    ))
                  : null}
                {e.teacherComment ? (
                  <Body style={{ marginTop: space(1) }}>
                    {STR.revComment}: {e.teacherComment}
                  </Body>
                ) : null}
              </View>
            ))
          )}
        </Card>
        </QueryGate>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
          {shortcuts.map((item) => (
            <Pressable key={item.key} onPress={item.onPress} style={{ flexGrow: 1, minWidth: 140 }}>
              <Card>
                <Body style={{ fontWeight: "700" }}>{item.title}</Body>
                <Muted>{STR.open}</Muted>
              </Card>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

