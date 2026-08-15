/**
 * AssignmentGiftScreen (AG-3, D-#479–#483) — who earned the gift.
 *
 * Weekly gift = submitted EVERY assignment given that Thursday by its Sunday.
 * Higher gift = four such weeks in a row; the counter rolls unbroken but the
 * award fires only on a completed 4-week block, so the screen shows both
 * ("৬ টানা সপ্তাহ" alongside the single block entitlement).
 *
 * Winners are derived server-side on every read — nothing about a win is stored,
 * so this screen never shows a number the tracker has since disagreed with. The
 * only write is the handover tick, and the server re-derives entitlement before
 * accepting it (a tick on a stale screen is refused, not silently honoured).
 *
 * The window is one 4-week block ending at `weekTo`; ◀/▶ move the block.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  ASSIGNMENT_GIFT_REPORT,
  RECORD_GIFT_HANDOVER,
  UNDO_GIFT_HANDOVER,
  type GiftStudentRowT,
} from "../../graphql/assignmentGift";
import { CLASSES_QUERY } from "../../graphql/operations";
import type { AssignmentStackParamList } from "../../navigation/types";
import {
  Screen,
  Body,
  Muted,
  Card,
  Chip,
  ChipRow,
  Badge,
  Button,
  Select,
  Loader,
  EmptyState,
  Notice,
  Divider,
} from "../../components/ui";
import { STR, bnNum, subjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AssignmentStackParamList, "AssignmentGift">;

const day = (iso?: string | null): string => (iso ? iso.slice(0, 10) : "—");

/** Has this student already been handed the gift for (kind, week)? */
function handoverFor(
  row: GiftStudentRowT,
  kind: "WEEKLY" | "STREAK",
  week: number,
): GiftStudentRowT["awards"][number] | null {
  return row.awards.find((a) => a.kind === kind && a.weekNumber === week) ?? null;
}

function WinnerRow({
  row,
  kind,
  week,
  subtitle,
  busy,
  onGive,
  onUndo,
}: {
  row: GiftStudentRowT;
  kind: "WEEKLY" | "STREAK";
  week: number;
  subtitle?: string;
  busy: boolean;
  onGive: () => void;
  onUndo: () => void;
}): React.ReactElement {
  const award = handoverFor(row, kind, week);
  return (
    <View style={{ marginTop: space(3) }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flexShrink: 1, paddingRight: space(2) }}>
          <Body style={{ fontWeight: "700" }}>
            {row.studentName}
            {row.rollNumber ? ` (${bnNum(row.rollNumber)})` : ""}
          </Body>
          {subtitle ? <Muted>{subtitle}</Muted> : null}
          {award ? (
            <Muted>
              {day(award.handedOverAt)}
              {award.handedOverByName ? ` · ${STR.agHandedOverBy} ${award.handedOverByName}` : ""}
            </Muted>
          ) : null}
        </View>
        {award ? (
          <View style={{ alignItems: "flex-end" }}>
            <Badge text={`✅ ${STR.agHandedOver}`} tone="ok" maxWidthPct={100} />
            <Button title={STR.agUndoHandover} variant="ghost" onPress={onUndo} disabled={busy} />
          </View>
        ) : (
          <Button title={STR.agMarkHandedOver} onPress={onGive} loading={busy} />
        )}
      </View>
    </View>
  );
}

export default function AssignmentGiftScreen({ route }: Props): React.ReactElement {
  const { academicYearId } = route.params;
  const toast = useToast();

  // null = let the server pick the latest week with issued work; ◀/▶ then pin it.
  const [weekTo, setWeekTo] = React.useState<number | null>(null);
  const [selectedWeek, setSelectedWeek] = React.useState<number | null>(null);
  const [classId, setClassId] = React.useState<string | null>(null);
  const [sectionId, setSectionId] = React.useState<string | null>(null);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);

  const [classesQ] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId },
    pause: !academicYearId,
  });
  const classes = classesQ.data?.classes ?? [];
  const sections = classId ? (classes.find((c) => c.id === classId)?.sections ?? []) : [];

  const [reportQ, refetchReport] = useQuery({
    query: ASSIGNMENT_GIFT_REPORT,
    variables: {
      academicYearId,
      weekTo,
      weekFrom: weekTo === null ? null : Math.max(1, weekTo - 3),
      classId,
      sectionId,
    },
    pause: !academicYearId,
  });

  const [, recordHandover] = useMutation(RECORD_GIFT_HANDOVER);
  const [, undoHandover] = useMutation(UNDO_GIFT_HANDOVER);

  const report = reportQ.data?.assignmentGiftReport ?? null;

  // Once the server has told us the latest week, default the selection to it.
  React.useEffect(() => {
    if (report && selectedWeek === null) setSelectedWeek(report.weekTo);
  }, [report, selectedWeek]);

  const week = selectedWeek ?? report?.weekTo ?? 0;
  const weekMeta = report?.weekDueDates.find((w) => w.weekNumber === week) ?? null;
  const students = report?.students ?? [];

  const weeklyWinners = students.filter((s) => s.wonWeeks.includes(week));
  const streakWinners = students.filter((s) => s.streakMilestoneWeeks.includes(week));
  const running = students.filter((s) => s.currentStreak > 0);

  const shiftBlock = (delta: number): void => {
    const base = report?.weekTo ?? 0;
    const next = Math.max(1, (weekTo ?? base) + delta);
    setWeekTo(next);
    setSelectedWeek(next);
  };

  const give = async (row: GiftStudentRowT, kind: "WEEKLY" | "STREAK"): Promise<void> => {
    const key = `${kind}:${row.studentId}:${week}`;
    setBusyKey(key);
    const res = await recordHandover({
      academicYearId,
      studentId: row.studentId,
      kind,
      weekNumber: week,
    });
    setBusyKey(null);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.agHandedOver, "ok");
    refetchReport({ requestPolicy: "network-only" });
  };

  const undo = async (row: GiftStudentRowT, kind: "WEEKLY" | "STREAK"): Promise<void> => {
    const key = `${kind}:${row.studentId}:${week}`;
    setBusyKey(key);
    const res = await undoHandover({
      academicYearId,
      studentId: row.studentId,
      kind,
      weekNumber: week,
    });
    setBusyKey(null);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    refetchReport({ requestPolicy: "network-only" });
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {reportQ.fetching && !report ? (
          <Loader label={STR.loading} />
        ) : reportQ.error ? (
          <Notice message={friendlyError(reportQ.error)} tone="danger" />
        ) : !report || report.weekTo < 1 ? (
          <EmptyState message={STR.empty} />
        ) : (
          <>
            {/* Filters — Principal/Office may leave both blank for the whole school;
                a teacher must name a section (the server enforces it). */}
            <Card>
              <Select
                label={STR.agAllStudents}
                value={classId}
                options={classes.map((c) => ({ label: c.nameBn, value: c.id }))}
                onChange={(v) => {
                  setClassId(v);
                  setSectionId(null);
                }}
                placeholder={STR.agAllStudents}
              />
              {sections.length > 0 ? (
                <Select
                  label={STR.agSelectSection}
                  value={sectionId}
                  options={sections.map((s) => ({ label: s.nameBn, value: s.id }))}
                  onChange={setSectionId}
                  placeholder={STR.agSelectSection}
                />
              ) : null}
            </Card>

            {/* The 4-week block + the week picker inside it. */}
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Chip label="◀" onPress={() => shiftBlock(-1)} />
                <Body style={{ fontWeight: "700" }}>
                  {STR.asWeek} {bnNum(report.weekFrom)}–{bnNum(report.weekTo)}
                </Body>
                <Chip label="▶" onPress={() => shiftBlock(1)} />
              </View>
              <ChipRow>
                {report.weekDueDates.map((w) => (
                  <Chip
                    key={w.weekNumber}
                    label={`${STR.asWeek} ${bnNum(w.weekNumber)}${w.settled ? "" : " ⏳"}`}
                    selected={w.weekNumber === week}
                    onPress={() => setSelectedWeek(w.weekNumber)}
                  />
                ))}
              </ChipRow>
              {weekMeta ? (
                <Muted>
                  {STR.agDue}: {day(weekMeta.dueDate)}
                </Muted>
              ) : null}
            </Card>

            {weekMeta && !weekMeta.settled ? (
              <Notice message={`${STR.agPendingWeek}. ${STR.agPendingHint}`} tone="info" />
            ) : null}

            {/* Weekly gift */}
            <Card>
              <Body style={{ fontWeight: "700" }}>
                🎁 {STR.agWeeklyGift} — {STR.agWeekWinners} ({bnNum(weeklyWinners.length)})
              </Body>
              {weeklyWinners.length === 0 ? (
                <Muted>{weekMeta?.settled ? STR.agNoWeekWinners : STR.agPendingHint}</Muted>
              ) : (
                weeklyWinners.map((row) => {
                  const wk = row.weeks.find((w) => w.weekNumber === week);
                  return (
                    <WinnerRow
                      key={row.studentId}
                      row={row}
                      kind="WEEKLY"
                      week={week}
                      subtitle={
                        wk ? `${bnNum(wk.onTime)}/${bnNum(wk.issued)} ${STR.agOnTimeOf}` : undefined
                      }
                      busy={busyKey === `WEEKLY:${row.studentId}:${week}`}
                      onGive={() => void give(row, "WEEKLY")}
                      onUndo={() => void undo(row, "WEEKLY")}
                    />
                  );
                })
              )}
            </Card>

            {/* Higher gift — only the students who CLOSED a 4-block on this week. */}
            <Card>
              <Body style={{ fontWeight: "700" }}>
                🏆 {STR.agHigherGift} — {STR.agStreakWinners} ({bnNum(streakWinners.length)})
              </Body>
              {streakWinners.length === 0 ? (
                <Muted>{STR.agNoStreakWinners}</Muted>
              ) : (
                streakWinners.map((row) => (
                  <WinnerRow
                    key={row.studentId}
                    row={row}
                    kind="STREAK"
                    week={week}
                    subtitle={`${bnNum(row.currentStreak)} ${STR.agStreakRunning}`}
                    busy={busyKey === `STREAK:${row.studentId}:${week}`}
                    onGive={() => void give(row, "STREAK")}
                    onUndo={() => void undo(row, "STREAK")}
                  />
                ))
              )}
            </Card>

            {/* Context: who is on a run right now — read-only, no tick. */}
            {running.length > 0 ? (
              <Card>
                <Body style={{ fontWeight: "700" }}>
                  🔥 {STR.agStreakRunning} ({bnNum(running.length)})
                </Body>
                {running.map((row) => (
                  <View key={row.studentId}>
                    <Divider />
                    <View
                      style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                    >
                      <Body style={{ flexShrink: 1 }}>{row.studentName}</Body>
                      <Badge
                        text={`${bnNum(row.currentStreak)} / ${bnNum(report.streakBlock)}`}
                        tone={row.currentStreak >= report.streakBlock ? "gold" : "muted"}
                      />
                    </View>
                  </View>
                ))}
              </Card>
            ) : null}

            {/* Why a student is NOT on the list — the missed detail for the week. */}
            {weekMeta?.settled ? (
              <Card>
                <Body style={{ fontWeight: "700" }}>
                  {STR.agMissedLabel} — {STR.asWeek} {bnNum(week)}
                </Body>
                {students
                  .filter((s) => {
                    const wk = s.weeks.find((w) => w.weekNumber === week);
                    return wk && wk.issued > 0 && !wk.won;
                  })
                  .map((s) => {
                    const wk = s.weeks.find((w) => w.weekNumber === week)!;
                    return (
                      <View key={s.studentId} style={{ marginTop: space(2) }}>
                        <Body>
                          {s.studentName} — {bnNum(wk.onTime)}/{bnNum(wk.issued)} {STR.agOnTimeOf}
                        </Body>
                        <Muted>
                          {wk.missed
                            .map(
                              (m) =>
                                `${subjectLabel(m.subject)} (${m.lateSubmission ? STR.agLate : STR.agNotSubmitted})`,
                            )
                            .join(", ")}
                        </Muted>
                      </View>
                    );
                  })}
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
