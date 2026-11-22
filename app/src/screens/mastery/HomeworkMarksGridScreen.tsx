/**
 * HomeworkMarksGridScreen (AL-5, B7, AC-B4, AC-B12, R22, R35) — the tick-wrong grid for the WHOLE শাখা.
 *
 * Rows are the children in student-ID order (label = ID + name, never a roll number); columns are the sheet's
 * questions, then the homework's free lines ("হয়নি" ticks), then the child's total. Every cell starts at FULL marks.
 * A tap cycles full → ½ → 0 → full (the ½ only where half the question's marks is a multiple of 0.5). A child who is
 * absent, did not hand in, or has no tracker record is greyed and not editable (AC-B9: never full marks by default).
 * The grid scrolls sideways inside its card; the page never does (360 dp).
 *
 * Marks read "৭/১০ · ৭০%" — no CORRECT / PARTIAL / WRONG word anywhere (R35). "নিশ্চিত করুন" runs the existing
 * confirm path and shows the server's Bangla refusal as it is (e.g. children still GIVEN / DUE). After confirming,
 * a change is a correction: it rewrites only that child's marks and the server writes one note.
 *
 * Reuses the existing entry screen's queries and mutations (`masteryPaper`, `saveMasteryResults`,
 * `confirmMasteryPaper`) and the free-line ticks (`homeworkFreeLineGrid` / `saveHomeworkFreeLineTicks`).
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { HOMEWORK_FREE_LINE_KIND_LABELS_BN, HOMEWORK_FREE_LINE_KIND_LABELS_EN } from "@scd/shared";
import {
  CONFIRM_MASTERY_PAPER,
  HOMEWORK_FREE_LINE_GRID_QUERY,
  MASTERY_PAPER_QUERY,
  SAVE_HOMEWORK_FREE_LINE_TICKS,
  SAVE_MASTERY_RESULTS,
  type HomeworkFreeLineGridRow,
  type MasteryPaperRow,
  type MasteryRosterEntry,
} from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Loader, Notice, H2 } from "../../components/ui";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { STR, bnNum, getActiveLang, hwSubjectLabel, masteryClassLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../state/ToastContext";
import { space, useColors } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";
import {
  byStudentId,
  cellLabel,
  cellState,
  childTotal,
  earnedOf,
  printedLabels,
  rowEditable,
  tapCell,
  toggleNotDone,
  type GridItemX,
} from "../../lib/homeworkGrid";
import { marksLine } from "../../lib/marksDisplay";

type Props = NativeStackScreenProps<MasteryStackParamList, "HomeworkMarksGrid">;

const NAME_W = 172;
const ITEM_W = 64;
const FREE_W = 92;
const TOTAL_W = 118;
const ROW_H = 44;

const kindLabel = (k: string): string =>
  (getActiveLang() === "en" ? HOMEWORK_FREE_LINE_KIND_LABELS_EN : HOMEWORK_FREE_LINE_KIND_LABELS_BN)[k as keyof typeof HOMEWORK_FREE_LINE_KIND_LABELS_BN] ?? k;

export default function HomeworkMarksGridScreen({ route }: Props): React.ReactElement {
  // `paperId` is the paper CODE ("MP-…"). Free-lines-only homework has no paper: it opens by `hwItemId` and shows only
  // the "হয়নি" columns (no marks, nothing to confirm).
  const { paperId, hwItemId: routeItemId } = route.params;
  const freeMode = !paperId;
  const toast = useToast();
  const colors = useColors();
  const { can } = useAuth();
  const canMarks = can("mastery:enter_results");
  const canTicks = can("homework:check");
  const [{ data, fetching: paperFetching, error: paperErr }, refetch] = useQuery({ query: MASTERY_PAPER_QUERY, variables: { paperId: paperId ?? "" }, pause: freeMode });
  const paper = (data?.masteryPaper?.paper ?? null) as MasteryPaperRow | null;
  const hwItemId = freeMode ? (routeItemId ?? null) : (paper?.hwItemId ?? null);
  // Which children have a tracker record for this homework (the grid greys the rest). Needs homework:view; without it
  // the answer is unknown and nobody is greyed on that account (the server still refuses a save for them).
  const [gridQ, refetchGrid] = useQuery({ query: HOMEWORK_FREE_LINE_GRID_QUERY, variables: { hwItemId: hwItemId ?? "" }, pause: !hwItemId });
  const gridRows = (gridQ.data?.homeworkFreeLineGrid?.rows ?? null) as HomeworkFreeLineGridRow[] | null;
  const roster = useMemo(
    () =>
      freeMode
        ? (gridRows ?? []).map(
            (r) =>
              ({
                studentId: r.studentId,
                name: r.name,
                rollNumber: null,
                schoolId: r.schoolId,
                defaultStatus: r.state === "ABSENT_REDELIVER" ? "ABSENT" : "PRESENT",
                itemNos: null,
                result: null,
                freeLinesNotDone: r.notDone,
              }) as MasteryRosterEntry,
          )
        : ((data?.masteryPaper?.roster ?? []) as MasteryRosterEntry[]),
    [freeMode, gridRows, data], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const freeLines = (freeMode ? (gridQ.data?.homeworkFreeLineGrid?.freeLines ?? []) : (data?.masteryPaper?.freeLines ?? [])) as { kind: string; textBn: string; estMinutes: number }[];
  const fetching = freeMode ? gridQ.fetching : paperFetching;
  const qErr = freeMode ? gridQ.error : paperErr;
  const withRecord = useMemo(() => (gridRows ? new Set(gridRows.map((r) => r.studentId)) : null), [gridRows]);

  const [save, saveResults] = useMutation(SAVE_MASTERY_RESULTS);
  const [confirm, confirmPaper] = useMutation(CONFIRM_MASTERY_PAPER);
  const [ticksM, saveTicks] = useMutation(SAVE_HOMEWORK_FREE_LINE_TICKS);
  const [drafts, setDrafts] = useState<Record<string, GridItemX[]>>({});
  const [notDone, setNotDone] = useState<Record<string, number[]>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [dirtyTicks, setDirtyTicks] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d: Record<string, GridItemX[]> = {};
    const n: Record<string, number[]> = {};
    for (const r of roster) {
      d[r.studentId] = (r.result?.items ?? []).map((i) => ({ itemNo: i.itemNo, marks: i.marks, rework: i.rework, tags: [...i.tags] }));
      n[r.studentId] = [...(r.freeLinesNotDone ?? [])];
    }
    setDrafts(d);
    setNotDone(n);
    setDirty(new Set());
    setDirtyTicks(new Set());
  }, [roster]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => byStudentId(roster), [roster]);
  const items = paper?.items ?? [];
  const printed = useMemo(() => printedLabels(items, bnNum), [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const confirmed = paper?.entryState === "CONFIRMED";

  function onTap(studentId: string, itemNo: number, itemMarks: number): void {
    setDrafts((ds) => ({ ...ds, [studentId]: tapCell(ds[studentId] ?? [], itemNo, itemMarks) }));
    setDirty((s) => new Set(s).add(studentId));
  }
  function onTick(studentId: string, index: number): void {
    setNotDone((ns) => ({ ...ns, [studentId]: toggleNotDone(ns[studentId] ?? [], index) }));
    setDirtyTicks((s) => new Set(s).add(studentId));
  }

  async function onSave(): Promise<boolean> {
    setError(null);
    if (dirty.size > 0) {
      const rows = [...dirty].map((studentId) => {
        const r = roster.find((x) => x.studentId === studentId);
        return {
          studentId,
          status: r?.result?.status ?? null,
          items: (drafts[studentId] ?? []).map((i) => ({ itemNo: i.itemNo, marks: i.marks, rework: i.rework, tags: i.tags })),
          workRework: r?.result?.workRework ?? false,
          workTags: r?.result?.workTags ?? [],
          rubric: (r?.result?.rubric ?? []).map((x) => ({ loCode: x.loCode, step: x.step })),
        };
      });
      const res = await saveResults({ paperId, rows });
      if (res.error) {
        setError(friendlyError(res.error));
        return false;
      }
    }
    if (dirtyTicks.size > 0 && hwItemId) {
      const res = await saveTicks({ hwItemId, rows: [...dirtyTicks].map((studentId) => ({ studentId, notDone: notDone[studentId] ?? [] })) });
      if (res.error) {
        setError(friendlyError(res.error));
        return false;
      }
    }
    if (dirty.size > 0 || dirtyTicks.size > 0) {
      toast.show(STR.msSaved);
      refetch({ requestPolicy: "network-only" });
      if (hwItemId) refetchGrid({ requestPolicy: "network-only" });
    }
    return true;
  }

  async function onConfirm(): Promise<void> {
    setAsking(false);
    if (!(await onSave())) return;
    const res = await confirmPaper({ paperId });
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    toast.show(STR.msConfirmedToast);
    refetch({ requestPolicy: "network-only" });
  }

  if (fetching && !paper && !gridRows) {
    return (
      <Screen>
        <Loader />
      </Screen>
    );
  }
  if (!paper && !freeMode) {
    return <Screen>{qErr ? <Notice message={friendlyError(qErr)} tone="danger" /> : null}</Screen>;
  }

  const cellBg = (s: ReturnType<typeof cellState>) =>
    s === "ZERO" ? colors.errorContainer : s === "HALF" || s === "CUSTOM" ? colors.warningContainer : "transparent";
  const hdr = { fontWeight: "700" as const };

  return (
    <Screen scroll>
      {paper ? (
        <>
          <H2>
            {masteryClassLabel(paper.classToken)} · {hwSubjectLabel(paper.subject)} · {paper.date}
          </H2>
          <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap" }}>
            <Badge text={paper.paperId} tone="muted" />
            <Badge text={confirmed ? STR.al5GridConfirmedBadge : STR.msOpen} tone={confirmed ? "ok" : "gold"} />
            <Badge text={`${bnNum(items.length)} · ${bnNum(paper.totalMarks)}`} tone="brand" />
          </View>
          <Notice message={confirmed ? STR.al5GridCorrectionNote : STR.al5GridHint} tone="info" />
          {paper.marksOnly ? <Notice message={STR.al5GridMarksOnly} tone="info" /> : null}
        </>
      ) : (
        <>
          <H2>{STR.al5GridFreeTitle}</H2>
          <Notice message={STR.al5GridFreeOnly} tone="info" />
          {qErr ? <Notice message={friendlyError(qErr)} tone="danger" /> : null}
        </>
      )}
      {error ? <Notice message={error} tone="danger" /> : null}

      {/* The legend: which printed number is which question. */}
      <Card>
        {items.map((it, i) => (
          <Muted key={it.itemNo} style={{ marginBottom: 2 }}>
            {printed[i]}. {it.textBn ?? it.qid ?? it.loCodes.join(", ")} ({bnNum(it.marks)})
          </Muted>
        ))}
        {freeLines.map((l, i) => (
          <Muted key={`f${i}`} style={{ marginBottom: 2 }}>
            {kindLabel(l.kind)}: {l.textBn}
          </Muted>
        ))}
      </Card>

      {sorted.length === 0 ? (
        <Muted>{STR.al5GridNoStudents}</Muted>
      ) : (
        <Card>
          {/* Sideways inside the card; the page itself never scrolls sideways. */}
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ flexGrow: 1 }}>
            <View>
              <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border, minHeight: ROW_H, alignItems: "center" }}>
                <Body style={[{ width: NAME_W, color: colors.textPrimary }, hdr]}>{STR.al5GridChild}</Body>
                {items.map((it, i) => (
                  <Body key={it.itemNo} style={[{ width: ITEM_W, textAlign: "center", color: colors.textPrimary }, hdr]}>
                    {printed[i]}
                  </Body>
                ))}
                {freeLines.map((l, i) => (
                  <Body key={`fh${i}`} numberOfLines={2} style={[{ width: FREE_W, textAlign: "center", color: colors.textPrimary }, hdr]}>
                    {kindLabel(l.kind)}
                  </Body>
                ))}
                {paper ? <Body style={[{ width: TOTAL_W, textAlign: "center", color: colors.textPrimary }, hdr]}>{STR.al5GridTotal}</Body> : null}
              </View>

              {sorted.map((s) => {
                const hasRecord = withRecord ? withRecord.has(s.studentId) : true;
                const editable = canMarks && rowEditable(s.defaultStatus, s.result?.status ?? null, hasRecord);
                const status = s.result?.status ?? s.defaultStatus;
                const greyed = !rowEditable(s.defaultStatus, s.result?.status ?? null, hasRecord);
                const mine = drafts[s.studentId] ?? [];
                const given = s.itemNos ? new Set(s.itemNos) : null;
                const shownItems = given ? items.filter((it) => given.has(it.itemNo)) : items;
                const total = childTotal(mine, shownItems);
                return (
                  <View
                    key={s.studentId}
                    style={{ flexDirection: "row", alignItems: "center", minHeight: ROW_H, borderBottomWidth: 1, borderBottomColor: colors.border, opacity: greyed ? 0.5 : 1 }}
                  >
                    <View style={{ width: NAME_W, paddingRight: space(1) }}>
                      <Body numberOfLines={2} style={{ color: colors.textPrimary }}>
                        {s.schoolId ? `${bnNum(s.schoolId)} · ` : ""}
                        {s.name}
                      </Body>
                      {greyed ? (
                        <Body style={{ fontSize: 12, color: colors.textSecondary }}>
                          {!hasRecord ? STR.al5GridNoRecord : status === "ABSENT" ? STR.msStatusAbsent : status === "NOT_SUBMITTED" ? STR.msStatusNotSubmitted : STR.msStatusVoid}
                        </Body>
                      ) : null}
                    </View>
                    {items.map((it) => {
                      if (given && !given.has(it.itemNo)) {
                        return (
                          <View key={it.itemNo} style={{ width: ITEM_W, alignItems: "center" }}>
                            <Body style={{ color: colors.textDisabled }}>—</Body>
                          </View>
                        );
                      }
                      const earned = earnedOf(mine, it.itemNo, it.marks);
                      const st = cellState(earned, it.marks);
                      return (
                        <Pressable
                          key={it.itemNo}
                          onPress={() => onTap(s.studentId, it.itemNo, it.marks)}
                          disabled={!editable}
                          accessibilityRole="button"
                          accessibilityLabel={`${printed[items.indexOf(it)]} ${cellLabel(earned, it.marks, bnNum)}`}
                          style={{ width: ITEM_W - 6, minHeight: 36, marginHorizontal: 3, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: cellBg(st), borderWidth: 1, borderColor: st === "FULL" ? colors.border : "transparent" }}
                        >
                          <Body style={{ color: colors.textPrimary, fontWeight: st === "FULL" ? "400" : "700" }}>{cellLabel(earned, it.marks, bnNum)}</Body>
                        </Pressable>
                      );
                    })}
                    {freeLines.map((_, i) => {
                      const on = (notDone[s.studentId] ?? []).includes(i);
                      return (
                        <Pressable
                          key={`f${i}`}
                          onPress={() => onTick(s.studentId, i)}
                          disabled={!canTicks || greyed}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          style={{ width: FREE_W - 6, minHeight: 36, marginHorizontal: 3, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: on ? colors.errorContainer : "transparent", borderWidth: 1, borderColor: on ? "transparent" : colors.border }}
                        >
                          <Body style={{ color: colors.textPrimary, fontWeight: on ? "700" : "400" }}>{on ? STR.al5GridNotDone : "✓"}</Body>
                        </Pressable>
                      );
                    })}
                    {paper ? <Body style={{ width: TOTAL_W, textAlign: "center", color: colors.textPrimary }}>{greyed ? "—" : (marksLine(total.earned, total.available, bnNum) ?? "—")}</Body> : null}
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </Card>
      )}

      <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
        <Button
          title={`${confirmed ? STR.al5GridSaveCorrection : STR.al5GridSave}${dirty.size + dirtyTicks.size ? ` (${bnNum(new Set([...dirty, ...dirtyTicks]).size)})` : ""}`}
          variant="secondary"
          onPress={() => void onSave()}
          loading={save.fetching || ticksM.fetching}
          disabled={(dirty.size === 0 && dirtyTicks.size === 0) || (!canMarks && !canTicks)}
        />
        {paper && !confirmed && canMarks ? <Button title={STR.al5GridConfirm} onPress={() => setAsking(true)} loading={confirm.fetching} /> : null}
      </View>
      {sorted.some((s) => !rowEditable(s.defaultStatus, s.result?.status ?? null, withRecord ? withRecord.has(s.studentId) : true)) ? <Muted>{STR.al5GridGrey}</Muted> : null}

      <ConfirmSheet
        visible={asking}
        message={STR.al5GridConfirmMsg}
        confirmLabel={STR.al5GridConfirm}
        tone="primary"
        onCancel={() => setAsking(false)}
        onConfirm={() => void onConfirm()}
      />
    </Screen>
  );
}
