/**
 * StudentProfileScreen (SP-3, prd-student-profile §8) — ONE student, everything the
 * app records about them: attendance · homework · assignment · class test · comments
 * and parent meetings, with per-subject rows and charts.
 *
 * READ-ONLY by design (§1): no marking, no lifecycle transition, no comment authoring
 * happens here — each of those stays on the screen that owns its write gate.
 *
 * LAZY BY PANEL: every panel has its own query, paused until the panel is opened, so
 * a teacher who only wants attendance pays for one read. One panel is open at a time
 * (the D-#337 accordion the checking queue already uses).
 *
 * NARROWING (§4/D-#357): a subject teacher sees only their own subjects on the
 * homework / assignment / class-test panels; the screen says so explicitly, because a
 * partial panel that looks complete is worse than no panel.
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View, Pressable, Linking } from "react-native";
import { useRoute } from "@react-navigation/native";
import { useQuery } from "urql";
import {
  STUDENT_PROFILE_ASSIGNMENT_QUERY,
  STUDENT_PROFILE_ATTENDANCE_QUERY,
  STUDENT_PROFILE_CLASS_TEST_QUERY,
  STUDENT_PROFILE_COMMENTS_QUERY,
  STUDENT_PROFILE_HEADER_QUERY,
  STUDENT_PROFILE_HOMEWORK_QUERY,
  type ProfileClassTestT,
  type TrackerCountersT,
  type TrackerPanelT,
} from "../../graphql/studentProfile";
import { STUDENT_WHOLE_PICTURE_QUERY } from "../../graphql/wholePicture";
import { WholePictureCard } from "../../components/WholePictureCard";
import { Screen, Card, Body, Muted, Badge, Loader, Notice, Chip, ChipRow, Button, EmptyState } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { MiniBarChart, type BarDatum } from "../../components/MiniBarChart";
import { ChartLegend, MiniLineChart, MiniStackedBars, type StackedRow } from "../../components/MiniCharts";
import {
  STR,
  bnNum,
  classLevelLabel,
  ctTrendGlyph,
  hwSubjectLabel,
  isoDateLabel,
  commentTypeLabel,
  commentSentimentLabel,
} from "../../lib/labels";
import { dateKey } from "../../lib/dates";
import { friendlyError } from "../../lib/errors";
import { openPdf, PDF_SUPPORTED } from "../../lib/pdf";
import { useFileOpen } from "../../lib/useFileOpen";
import { space } from "../../theme/tokens";
import { useColors } from "../../theme";
import type { StudentProfileParams, StudentProfilePanelKey as PanelKey } from "../../navigation/types";

const keyDaysAgo = (days: number): string => {
  const now = new Date();
  return dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)));
};

export default function StudentProfileScreen(): React.ReactElement {
  // Registered in several stacks (roster / attendance / homework / assignment /
  // class test), so params are read via useRoute rather than tied to one ParamList.
  //
  // Params are read DEFENSIVELY (`?? {}`), never destructured off `params` directly.
  // A profile with no studentId must degrade to an empty state, not throw: this
  // screen is reachable by five routes plus deep links and navigation-state
  // restoration, and a destructure of `undefined` takes the whole tab down with the
  // error boundary. That is exactly what happened when it was accidentally
  // registered as a stack's FIRST screen (= its initial route, so it mounted with
  // no params) — see the fix alongside this guard.
  const params = (useRoute().params ?? {}) as Partial<StudentProfileParams>;
  const studentId = params.studentId ?? "";
  const studentName = params.studentName;
  const initialPanel = params.initialPanel;
  const colors = useColors();
  const [open, setOpen] = useState<PanelKey | null>(initialPanel ?? "attendance");
  const { openingId, runOpen } = useFileOpen();
  const [pdfError, setPdfError] = useState<string | null>(null);

  const [headerQ] = useQuery({
    query: STUDENT_PROFILE_HEADER_QUERY,
    variables: { studentId },
    pause: !studentId,
  });
  const header = headerQ.data?.studentProfileHeader ?? null;

  // The window defaults to the academic year to date (D-#358); the header supplies it.
  // A local control rather than useReportRange: that hook's chips are Today/7/14/30,
  // which is a daily-operations range — a profile is a term document.
  const year = header?.academicYear ?? null;
  const [mode, setMode] = useState<"year" | "d30" | "d90" | "custom">("year");
  const [customFrom, setCustomFrom] = useState(keyDaysAgo(30));
  const [customTo, setCustomTo] = useState(dateKey());
  const fromKey =
    mode === "custom" ? customFrom
    : mode === "d30" ? keyDaysAgo(30)
    : mode === "d90" ? keyDaysAgo(90)
    : (year?.fromKey ?? keyDaysAgo(90));
  const toKey = mode === "custom" ? customTo : (mode === "year" ? (year?.toKey ?? dateKey()) : dateKey());

  const panelVars = { studentId, fromKey, toKey };
  // Each panel waits until it is opened — and until the window is known, so the
  // year-default never fires a throwaway request with fallback bounds.
  const ready = !!studentId && (mode !== "year" || !!year);
  const paused = (k: PanelKey) => open !== k || !ready;

  const [wpQ] = useQuery({
    query: STUDENT_WHOLE_PICTURE_QUERY,
    variables: { studentId },
    pause: !studentId,
  });
  const [attQ] = useQuery({
    query: STUDENT_PROFILE_ATTENDANCE_QUERY,
    variables: panelVars,
    pause: paused("attendance"),
  });
  const [hwQ] = useQuery({
    query: STUDENT_PROFILE_HOMEWORK_QUERY,
    variables: panelVars,
    pause: paused("homework"),
  });
  const [asQ] = useQuery({
    query: STUDENT_PROFILE_ASSIGNMENT_QUERY,
    variables: panelVars,
    pause: paused("assignment"),
  });
  const [ctQ] = useQuery({
    query: STUDENT_PROFILE_CLASS_TEST_QUERY,
    variables: { studentId },
    pause: paused("classTest"),
  });
  const [cmQ] = useQuery({
    query: STUDENT_PROFILE_COMMENTS_QUERY,
    variables: panelVars,
    pause: paused("comments"),
  });

  const wp = wpQ.data?.studentWholePicture ?? null;
  const narrowed = header ? !header.fullView : false;

  // AFTER every hook, so hook order never varies between renders (rules of hooks).
  if (!studentId) {
    return (
      <Screen>
        <EmptyState message={STR.spNoStudent} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        {/* ---------------- header ---------------- */}
        <Card>
          {headerQ.error ? (
            <Notice message={friendlyError(headerQ.error)} tone="danger" />
          ) : headerQ.fetching && !header ? (
            <Loader label={STR.loading} />
          ) : (
            <>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700" }}>{header?.nameBn || header?.name || studentName}</Body>
                {narrowed ? <Badge text={STR.spMySubjectsOnly} tone="muted" /> : null}
              </View>
              <Muted>
                {classLevelLabel(header?.classLevel ?? 0)}
                {header?.sectionNameBn ? ` · ${header.sectionNameBn}` : ""}
                {header?.rollNumber ? ` · ${STR.spRoll} ${bnNum(Number(header.rollNumber) || 0)}` : ""}
              </Muted>
              {header?.classTeacherName ? (
                <Muted>
                  {STR.spClassTeacher}: {header.classTeacherName}
                </Muted>
              ) : null}
              {header?.bloodGroup ? (
                <Muted>
                  {STR.spBloodGroup}: {header.bloodGroup}
                </Muted>
              ) : null}
              {(header?.guardians ?? []).map((g) => (
                <Pressable
                  key={g.guardianId}
                  disabled={!g.phone}
                  onPress={() => g.phone && Linking.openURL(`tel:${g.phone}`)}
                >
                  <Muted>
                    {g.primary ? STR.spPrimaryGuardian : STR.spGuardian}: {g.name}
                    {g.relation ? ` (${g.relation})` : ""}
                    {g.phone ? ` · 📞 ${g.phone}` : ""}
                  </Muted>
                </Pressable>
              ))}
              {narrowed ? <Muted style={{ marginTop: space(1) }}>{STR.spMySubjectsNote}</Muted> : null}
              {/* SP-4: the parent-meeting sheet. Web-only like every other PDF path
                  (PDF_SUPPORTED); the server re-asserts the gate and prints the
                  caller's narrowing + a printed-by stamp on the page. */}
              {PDF_SUPPORTED ? (
                <Button
                  title={STR.spPrintSheet}
                  variant="secondary"
                  style={{ marginTop: space(2) }}
                  loading={openingId === studentId}
                  disabled={!!openingId}
                  onPress={() =>
                    void runOpen(studentId, async () => {
                      setPdfError(null);
                      try {
                        await openPdf(
                          `/pdf/student-profile/${studentId}?from=${fromKey}&to=${toKey}`,
                        );
                      } catch (e) {
                        setPdfError(e instanceof Error ? e.message : STR.spPrintFailed);
                      }
                    })
                  }
                />
              ) : null}
              {pdfError ? <Notice message={pdfError} tone="danger" /> : null}
            </>
          )}
        </Card>

        {/* The 90-day signal band — labelled, because it does NOT follow the range below. */}
        {wp ? <WholePictureCard wp={wp} /> : null}

        {/* ---------------- range ---------------- */}
        <Card>
          <ChipRow>
            <Chip
              label={year ? `${STR.spYearToDate} (${year.label})` : STR.spYearToDate}
              selected={mode === "year"}
              onPress={() => setMode("year")}
            />
            <Chip label={STR.spLast30} selected={mode === "d30"} onPress={() => setMode("d30")} />
            <Chip label={STR.spLast90} selected={mode === "d90"} onPress={() => setMode("d90")} />
            <Chip label={STR.spCustom} selected={mode === "custom"} onPress={() => setMode("custom")} />
          </ChipRow>
          {mode === "custom" ? (
            <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
              <View style={{ flex: 1 }}>
                <DateField label={STR.rptFrom} value={customFrom} onChange={setCustomFrom} />
              </View>
              <View style={{ flex: 1 }}>
                <DateField label={STR.rptTo} value={customTo} onChange={setCustomTo} />
              </View>
            </View>
          ) : null}
        </Card>

        {/* ---------------- panels ---------------- */}
        <PanelCard
          title={STR.spPanelAttendance}
          open={open === "attendance"}
          onToggle={() => setOpen(open === "attendance" ? null : "attendance")}
        >
          {attQ.error ? (
            <Notice message={friendlyError(attQ.error)} tone="danger" />
          ) : attQ.fetching ? (
            <Loader label={STR.loading} />
          ) : !attQ.data ? null : (
            (() => {
              const a = attQ.data.studentProfileAttendance;
              return (
                <View style={{ gap: space(2) }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Body>
                      {STR.spPresentPct}: {bnNum(a.presentPct)}%
                    </Body>
                    <Badge
                      text={`${ctTrendGlyph(a.trajectory === "up" ? "up" : a.trajectory === "down" ? "down" : "flat")}`}
                      tone={a.trajectory === "up" ? "ok" : a.trajectory === "down" ? "danger" : "muted"}
                    />
                  </View>
                  <Muted>
                    {STR.spMarkedDays} {bnNum(a.markedDays)} · {STR.spAbsentDays} {bnNum(a.absentDays)} ·{" "}
                    {STR.spAbsentUncovered} {bnNum(a.absentUncoveredDays)} · {STR.spAbsentStreak}{" "}
                    {bnNum(a.absentStreakMax)}
                  </Muted>
                  {a.recentPresentPct != null && a.earlierPresentPct != null ? (
                    <Muted>
                      {STR.spRecentVsEarlier}: {bnNum(a.recentPresentPct)}% / {bnNum(a.earlierPresentPct)}%
                    </Muted>
                  ) : null}
                  {a.monthly.length > 0 ? (
                    <View>
                      <Muted>{STR.spMonthlyPresence}</Muted>
                      <MiniLineChart
                        accessibilityLabel={STR.spMonthlyPresence}
                        points={a.monthly.map((m) => ({ label: m.monthKey.slice(5), value: m.presentPct }))}
                      />
                    </View>
                  ) : (
                    <Muted>{STR.spNoDataInRange}</Muted>
                  )}
                  {a.leaves.length > 0 ? (
                    <View style={{ gap: 2 }}>
                      <Muted style={{ fontWeight: "700" }}>{STR.spLeaves}</Muted>
                      {a.leaves.map((l) => (
                        <Muted key={l.leaveId}>
                          {l.fromKey} → {l.toKey} · {bnNum(l.daysInWindow)} {STR.spLeaveDays} · {l.reason}
                        </Muted>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })()
          )}
        </PanelCard>

        <TrackerPanelCard
          title={STR.spPanelHomework}
          open={open === "homework"}
          onToggle={() => setOpen(open === "homework" ? null : "homework")}
          fetching={hwQ.fetching}
          error={hwQ.error ? friendlyError(hwQ.error) : null}
          panel={hwQ.data?.studentProfileHomework ?? null}
          narrowed={narrowed}
          showMarks={false}
        />

        <TrackerPanelCard
          title={STR.spPanelAssignment}
          open={open === "assignment"}
          onToggle={() => setOpen(open === "assignment" ? null : "assignment")}
          fetching={asQ.fetching}
          error={asQ.error ? friendlyError(asQ.error) : null}
          panel={asQ.data?.studentProfileAssignment ?? null}
          narrowed={narrowed}
          showMarks
        />

        <PanelCard
          title={STR.spPanelClassTest}
          open={open === "classTest"}
          onToggle={() => setOpen(open === "classTest" ? null : "classTest")}
        >
          {ctQ.error ? (
            <Notice message={friendlyError(ctQ.error)} tone="danger" />
          ) : ctQ.fetching ? (
            <Loader label={STR.loading} />
          ) : !ctQ.data || ctQ.data.studentProfileClassTest.results.length === 0 ? (
            <Muted>{narrowed ? STR.spNoDataMySubjects : STR.ctNoProfile}</Muted>
          ) : (
            <ClassTestPanel profile={ctQ.data.studentProfileClassTest} />
          )}
        </PanelCard>

        <PanelCard
          title={STR.spPanelComments}
          open={open === "comments"}
          onToggle={() => setOpen(open === "comments" ? null : "comments")}
        >
          {cmQ.error ? (
            <Notice message={friendlyError(cmQ.error)} tone="danger" />
          ) : cmQ.fetching ? (
            <Loader label={STR.loading} />
          ) : !cmQ.data ? null : (
            (() => {
              const c = cmQ.data.studentProfileComments;
              return (
                <View style={{ gap: space(2) }}>
                  <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                    <Badge text={`${STR.spCommentsConcern} ${bnNum(c.tally.concern)}`} tone={c.tally.concern > 0 ? "danger" : "muted"} />
                    <Badge text={`${STR.spCommentsPositive} ${bnNum(c.tally.positive)}`} tone={c.tally.positive > 0 ? "ok" : "muted"} />
                    {c.tally.undelivered > 0 ? (
                      <Badge text={`${STR.spCommentsUndelivered} ${bnNum(c.tally.undelivered)}`} tone="warn" />
                    ) : null}
                  </View>
                  {c.comments.length === 0 ? <Muted>{STR.spNoComments}</Muted> : null}
                  {c.comments.map((cm) => (
                    <View key={cm.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space(2) }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Muted>
                          {commentTypeLabel(cm.type)} · {commentSentimentLabel(cm.sentiment)}
                        </Muted>
                        <Muted>{isoDateLabel(cm.createdAt)}</Muted>
                      </View>
                      <Body>{cm.text}</Body>
                      <Muted>
                        {cm.authorName ?? ""}
                        {cm.deliveredAt ? "" : ` · ${STR.spCommentsUndelivered}`}
                      </Muted>
                    </View>
                  ))}
                  {c.meetingNotes.length > 0 ? (
                    <View style={{ gap: space(1), marginTop: space(2) }}>
                      <Muted style={{ fontWeight: "700" }}>{STR.spMeetingNotes}</Muted>
                      {c.meetingNotes.map((m) => (
                        <View key={m.id}>
                          <Muted>
                            {m.instanceLabel} · {isoDateLabel(m.meetingDate)}
                          </Muted>
                          {m.positiveText ? <Body>+ {m.positiveText}</Body> : null}
                          {m.concernText ? <Body>! {m.concernText}</Body> : null}
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })()
          )}
        </PanelCard>
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Panel chrome — one open at a time (the D-#337 accordion)
// ---------------------------------------------------------------------------

function PanelCard({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <Card>
      <Pressable onPress={onToggle} accessibilityRole="button">
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Body style={{ fontWeight: "700" }}>{title}</Body>
          <Muted>{open ? "▾" : "▸"}</Muted>
        </View>
      </Pressable>
      {open ? <View style={{ marginTop: space(3) }}>{children}</View> : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tracker panel (homework + assignment share every counter)
// ---------------------------------------------------------------------------

function CounterLine({ c, showMarks }: { c: TrackerCountersT; showMarks: boolean }): React.ReactElement {
  return (
    <View style={{ gap: 2 }}>
      <Muted>
        {STR.spSheets} {bnNum(c.sheets)} · {STR.spReceived} {bnNum(c.received)} · {STR.spSubmitted}{" "}
        {bnNum(c.submitted)}
        {c.submissionPct != null ? ` (${bnNum(c.submissionPct)}%)` : ""}
      </Muted>
      <Muted>
        {STR.spNotSubmitted} {bnNum(c.notSubmitted)} · {STR.spAwaiting} {bnNum(c.awaiting)} ·{" "}
        {STR.spAbsentAtIssue} {bnNum(c.absentAtIssue)}
        {c.notReceivedStill > 0 ? ` (${STR.spNotReceivedStill} ${bnNum(c.notReceivedStill)})` : ""}
      </Muted>
      <Muted>
        {STR.spPendingChecking} {bnNum(c.pendingChecking)} · {STR.spPendingReturn} {bnNum(c.pendingReturn)} ·{" "}
        {STR.spChased} {bnNum(c.chased)}
        {c.resubmissions > 0 ? ` · ${STR.spResubmissions} ${bnNum(c.resubmissions)}` : ""}
      </Muted>
      {showMarks && c.avgMarksPct != null ? (
        <Muted>
          {STR.spAvgMarks}: {bnNum(c.avgMarksPct)}%
        </Muted>
      ) : null}
    </View>
  );
}

function TrackerPanelCard({
  title,
  open,
  onToggle,
  fetching,
  error,
  panel,
  narrowed,
  showMarks,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  fetching: boolean;
  error: string | null;
  panel: TrackerPanelT | null;
  narrowed: boolean;
  showMarks: boolean;
}): React.ReactElement {
  const legend = useMemo(
    () => [
      { label: STR.spCorrect, value: 0, tone: "ok" as const },
      { label: STR.spPartial, value: 0, tone: "warn" as const },
      { label: STR.spWrong, value: 0, tone: "danger" as const },
    ],
    [],
  );

  const rows: StackedRow[] = useMemo(
    () =>
      (panel?.bySubject ?? []).map((r) => ({
        label: hwSubjectLabel(r.subject),
        segments: [
          { label: STR.spCorrect, value: r.counters.correct, tone: "ok" as const },
          { label: STR.spPartial, value: r.counters.partial, tone: "warn" as const },
          { label: STR.spWrong, value: r.counters.wrong, tone: "danger" as const },
        ],
      })),
    [panel],
  );

  return (
    <PanelCard title={title} open={open} onToggle={onToggle}>
      {error ? (
        <Notice message={error} tone="danger" />
      ) : fetching ? (
        <Loader label={STR.loading} />
      ) : !panel ? null : panel.totals.sheets === 0 ? (
        <Muted>{narrowed ? STR.spNoDataMySubjects : STR.spNoDataInRange}</Muted>
      ) : (
        <View style={{ gap: space(3) }}>
          <CounterLine c={panel.totals} showMarks={showMarks} />

          <View>
            <Muted style={{ fontWeight: "700" }}>{STR.spOutcomeMix}</Muted>
            <MiniStackedBars rows={rows} accessibilityLabel={STR.spOutcomeMix} />
            <ChartLegend items={legend} />
          </View>

          {panel.bySubject.map((r) => (
            <View key={r.subject} style={{ gap: 2 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body>{hwSubjectLabel(r.subject)}</Body>
                {r.counters.qualityPct != null ? (
                  <Badge
                    text={`${STR.spQualityPct} ${bnNum(r.counters.qualityPct)}%`}
                    tone={r.counters.qualityPct >= 75 ? "ok" : r.counters.qualityPct >= 50 ? "warn" : "danger"}
                  />
                ) : null}
              </View>
              <CounterLine c={r.counters} showMarks={showMarks} />
            </View>
          ))}
        </View>
      )}
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Class-test panel — the CT-4 shape, rendered per subject with the comment history
// ---------------------------------------------------------------------------

function ClassTestPanel({ profile }: { profile: ProfileClassTestT }): React.ReactElement {
  const seriesBySubject = useMemo(() => {
    const m = new Map<string, BarDatum[]>();
    const oldestFirst = [...profile.results].sort(
      (a, b) => new Date(a.examDate).getTime() - new Date(b.examDate).getTime(),
    );
    for (const r of oldestFirst) {
      const arr = m.get(r.subject) ?? [];
      arr.push({ label: bnNum(r.testNumber), value: r.percent, pass: r.pass });
      m.set(r.subject, arr);
    }
    return m;
  }, [profile]);

  const a = profile.analytics;

  return (
    <View style={{ gap: space(3) }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Muted>
          {STR.ctAvgPercent}: {a.avgPercent == null ? "—" : `${bnNum(a.avgPercent)}%`}
          {a.latestRank != null ? ` · ${STR.ctRank} ${bnNum(a.latestRank)}/${bnNum(a.latestRankOf ?? 0)}` : ""}
        </Muted>
        <View style={{ flexDirection: "row", gap: space(2) }}>
          <Badge
            text={`${ctTrendGlyph(a.trajectory)} ${STR.ctTrajectory}`}
            tone={a.trajectory === "up" ? "ok" : a.trajectory === "down" ? "danger" : "muted"}
          />
          {a.atRisk ? <Badge text={STR.ctAtRisk} tone="danger" /> : null}
        </View>
      </View>
      {a.recurringWeaknesses.length > 0 ? (
        <Muted>
          {STR.ctRecurringWeakness}: {a.recurringWeaknesses.map((w) => `${w.tag} ×${bnNum(w.count)}`).join(", ")}
        </Muted>
      ) : null}

      {profile.bySubject.map((b) => (
        <View key={b.subject}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexShrink: 1 }}>
              <Body>{hwSubjectLabel(b.subject)}</Body>
              <Muted>
                {STR.ctAvgPercent} {b.avgPercent == null ? "—" : `${bnNum(b.avgPercent)}%`} ·{" "}
                {STR.ctExamsTaken} {bnNum(b.examsTaken)}
              </Muted>
            </View>
            <Badge
              text={`${ctTrendGlyph(b.trend)} ${b.latestPercent == null ? "" : bnNum(b.latestPercent) + "%"}`}
              tone={b.trend === "up" ? "ok" : b.trend === "down" ? "danger" : "muted"}
            />
          </View>
          <View style={{ marginTop: space(2) }}>
            <MiniBarChart data={seriesBySubject.get(b.subject) ?? []} />
          </View>
        </View>
      ))}

      {/* The teacher's per-exam comment history — the guardian-meeting material. */}
      {profile.results
        .filter((r) => r.weakness || r.teacherAction || r.guardianAction)
        .map((r) => (
          <View key={r.testId} style={{ gap: 2 }}>
            <Muted style={{ fontWeight: "700" }}>
              {hwSubjectLabel(r.subject)} · {STR.ctTestNumber} {bnNum(r.testNumber)} ·{" "}
              {isoDateLabel(r.examDate)}
            </Muted>
            {r.weakness ? (
              <Muted>
                {STR.ctWeakness}: {r.weakness}
              </Muted>
            ) : null}
            {r.teacherAction ? (
              <Muted>
                {STR.ctTeacherAction}: {r.teacherAction}
              </Muted>
            ) : null}
            {r.guardianAction ? (
              <Muted>
                {STR.ctGuardianAction}: {r.guardianAction}
              </Muted>
            ) : null}
          </View>
        ))}
    </View>
  );
}
