/**
 * GuardianHomeScreen ("আজ", GP-2) — the selected child's today: routine
 * (day-type aware — a holiday shows its label), class notes, open homework with
 * state chips, and the personal day-load vs the LOCKED 240. Plus the inert
 * "শীঘ্রই আসছে" placeholder cards (GP-3+ riders) — tap shows a one-line notice,
 * no navigation, no dead queries (GP-J11).
 */
import React, { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
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
import type { GuardianHomeStackParamList } from "../../navigation/types";
import { STR, bnNum, loanStatusLabel, vocabProgramLabel, hwSubjectLabel, commentTypeLabel, commentSentimentLabel, revCategoryLabel } from "../../lib/labels";
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
  const [placeholderNote, setPlaceholderNote] = useState<string | null>(null);
  const sid = selected?.studentId ?? "";
  const date = today();

  const [routineQ] = useQuery({
    query: CHILD_ROUTINE_QUERY,
    variables: { studentId: sid, date },
    pause: !selected,
  });
  const [notesQ] = useQuery({
    query: CHILD_CLASS_NOTES_QUERY,
    variables: { studentId: sid, date },
    pause: !selected,
  });
  const [hwQ] = useQuery({
    query: CHILD_HOMEWORK_QUERY,
    variables: { studentId: sid, from: daysAgo(7), to: date },
    pause: !selected,
  });
  const [loadQ] = useQuery({
    query: CHILD_DAY_LOAD_QUERY,
    variables: { studentId: sid, date },
    pause: !selected,
  });
  const [libraryQ] = useQuery({
    query: CHILD_LIBRARY_LOANS_QUERY,
    variables: { studentId: sid },
    pause: !selected,
  });
  const [vocabQ] = useQuery({
    query: CHILD_VOCAB_QUERY,
    variables: { studentId: sid },
    pause: !selected,
  });
  const [testResultsQ] = useQuery({
    query: CHILD_TEST_RESULTS_QUERY,
    variables: { studentId: sid },
    pause: !selected,
  });
  const [commentsQ] = useQuery({
    query: CHILD_COMMENTS_QUERY,
    variables: { studentId: sid },
    pause: !selected,
  });
  const [revisionQ] = useQuery({
    query: CHILD_REVISION_QUERY,
    variables: { studentId: sid },
    pause: !selected,
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

  const placeholders = [STR.gpAttendance, STR.gpFees, STR.gpNotices, STR.gpLeave, STR.gpPush];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <ChildSwitcher />

        {/* Child info — section + Quran/Arabic group memberships (myChildren,
            already loaded by the provider; cross-grade groups per D-#48/#56). */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.gpChildInfo}</Body>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(2) }}>
            <Muted>{STR.gpSection}</Muted>
            <Body>{selected.sectionName}</Body>
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
                text={day.dayType === "HOLIDAY" && day.holidayNameBn ? day.holidayNameBn : day.dayTypeLabelBn}
                tone={day.dayType === "FULL" ? "brand" : "warn"}
              />
            ) : null}
          </View>
          {routineQ.fetching ? (
            <Loader label={STR.loading} />
          ) : !day || day.slots.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{day?.dayTypeLabelBn ?? ""}</Muted>
          ) : (
            day.slots.map((s) => (
              <View
                key={`${s.periodNumber}-${s.subject}`}
                style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(2) }}
              >
                <Body>
                  {bnNum(s.periodNumber)}. {s.subjectLabelBn}
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
                <Body style={{ fontWeight: "700" }}>{n.subjectLabelBn}</Body>
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

        {/* Open homework + day-load vs 240 */}
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
                  <Body>{r.subjectLabelBn}</Body>
                  <Muted>{r.hwId}</Muted>
                </View>
                <Badge text={r.stateLabelBn} tone={r.state === "CHASE" ? "danger" : "brand"} />
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
                        onPress={() => void openStoredFile(fid)}
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
            portions / تنبیه / فتح / structured mistakes / the teacher's comment. */}
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

        {/* GP-3+ placeholders — inert by contract (GP-J11) */}
        {placeholderNote ? <Notice message={placeholderNote} tone="info" /> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
          {placeholders.map((label) => (
            <Pressable
              key={label}
              onPress={() => setPlaceholderNote(`${label} — ${STR.gpComingSoonNote}`)}
              style={{ flexGrow: 1, minWidth: 140 }}
            >
              <Card>
                <Body style={{ fontWeight: "700" }}>{label}</Body>
                <Muted>{STR.gpComingSoon}</Muted>
              </Card>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
