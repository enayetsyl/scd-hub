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
  CHILD_LIBRARY_LOANS_QUERY,
  CHILD_VOCAB_QUERY,
} from "../../graphql/operations";
import { CHILD_TEST_RESULTS_QUERY } from "../../graphql/classTest";
import { CHILD_COMMENTS_QUERY } from "../../graphql/comments";
import { CHILD_REVISION_QUERY } from "../../graphql/revision";
import { Screen, Body, Muted, Card, Badge, Button, Notice, Loader, EmptyState } from "../../components/ui";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { useGuardianChild } from "../../state/GuardianChildContext";
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
  dayTypeLabel,
  getActiveLang,
} from "../../lib/labels";
import { space } from "../../theme/tokens";

type Nav = NativeStackNavigationProp<GuardianHomeStackParamList>;

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
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
  const lang = getActiveLang();
  const sid = selected?.studentId ?? "";
  const date = today();
  const { openingId, runOpen } = useFileOpen();

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

  // UX-7: pull-to-refresh — one gesture refreshes every card on the guardian home.
  const anyFetching =
    routineQ.fetching || notesQ.fetching || hwQ.fetching || loadQ.fetching || libraryQ.fetching ||
    vocabQ.fetching || testResultsQ.fetching || commentsQ.fetching || revisionQ.fetching;
  const { refreshing, onRefresh } = usePullRefresh(anyFetching, () => {
    const opts = { requestPolicy: "network-only" as const };
    refetchRoutine(opts);
    refetchNotes(opts);
    refetchHw(opts);
    refetchLoad(opts);
    refetchLibrary(opts);
    refetchVocab(opts);
    refetchTests(opts);
    refetchComments(opts);
    refetchRevision(opts);
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
          {routineQ.fetching ? (
            <Loader label={STR.loading} />
          ) : !day || day.slots.length === 0 ? (
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

        {/* Class notes — what was taught today */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.gpClassNotes}</Body>
          {notesQ.fetching ? (
            <Loader label={STR.loading} />
          ) : notes.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.gpNoNotes}</Muted>
          ) : (
            notes.map((n, i) => (
              <View key={`${n.subject}-${n.periodNumber ?? i}`} style={{ marginTop: space(2) }}>
                <Body style={{ fontWeight: "700" }}>{subjectLabel(n.subject)}</Body>
                <Body>{n.taughtSummaryBn}</Body>
                {n.homework ? (
                  <Muted>
                    {STR.gpHomeworkOpen}: {n.homework.hwId} · {bnNum(n.homework.qCount)} ·{" "}
                    {bnNum(n.homework.timeDecl)} {STR.gpMinutes}
                  </Muted>
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

        {/* Open homework + day-load vs 120 */}
        <Card>
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
          {hwQ.fetching ? (
            <Loader label={STR.loading} />
          ) : openHomework.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.gpNoHomework}</Muted>
          ) : (
            openHomework.map((r) => (
              <View
                key={r.recordId}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: space(2),
                }}
              >
                <View style={{ flexShrink: 1 }}>
                  <Body>{subjectLabel(r.subject)}</Body>
                  <Muted>{r.hwId}</Muted>
                </View>
                <Badge text={lifecycleStateLabel(r.state)} tone={r.state === "CHASE" ? "danger" : "brand"} />
              </View>
            ))
          )}
        </Card>

        {/* Library loans — read-only child-loans card (LB-5 rider, J-L9; D-#68:
            no reserve/renew control exists for guardians) */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.gpLibraryLoans}</Body>
          {libraryQ.fetching ? (
            <Loader label={STR.loading} />
          ) : (libraryQ.data?.childLibraryLoans ?? []).length === 0 ? (
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
                      ? `${STR.libDue}: ${new Date(loan.dueDate).toLocaleDateString()}`
                      : loan.returnedAt
                        ? `${loanStatusLabel(loan.status)}: ${new Date(loan.returnedAt).toLocaleDateString()}`
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
          {vocabQ.fetching ? (
            <Loader label={STR.loading} />
          ) : (vocabQ.data?.childVocab ?? []).length === 0 ? (
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
                  <Muted>{new Date(v.testDate).toLocaleDateString()}</Muted>
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
          {testResultsQ.fetching ? (
            <Loader label={STR.loading} />
          ) : (testResultsQ.data?.childTestResults ?? []).length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.gpNoTestResults}</Muted>
          ) : (
            (testResultsQ.data?.childTestResults ?? []).map((r) => (
              <View key={r.testId} style={{ marginTop: space(2) }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body>
                      {hwSubjectLabel(r.subject)} · {STR.ctTestNumber} {bnNum(r.testNumber)}
                    </Body>
                    <Muted>{new Date(r.examDate).toLocaleDateString()}</Muted>
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
          {commentsQ.fetching ? (
            <Loader label={STR.loading} />
          ) : (commentsQ.data?.childComments ?? []).length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.gpNoComments}</Muted>
          ) : (
            (commentsQ.data?.childComments ?? []).map((c) => (
              <View key={c.id} style={{ marginTop: space(2) }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Muted>
                    {commentTypeLabel(c.type)} · {commentSentimentLabel(c.sentiment)}
                  </Muted>
                  {c.deliveredAt ? <Muted>{new Date(c.deliveredAt).toLocaleDateString()}</Muted> : null}
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
          {revisionQ.fetching ? (
            <Loader label={STR.loading} />
          ) : (revisionQ.data?.childRevision ?? []).length === 0 ? (
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

