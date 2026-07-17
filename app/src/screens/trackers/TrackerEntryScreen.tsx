/**
 * TrackerEntryScreen (S11 / J4.1–J4.3, redesigned per ux-audit F1 —
 * "এক ট্যাপে ট্র্যাকিং"): one row per student, one tap per outcome.
 *
 * - Hydration: saved entries render in their ✓ state on load — entries are
 *   pseudonymised server-side (ADR-005), matched here by hashing the roster
 *   ids client-side (lib/pseudo — the firewall stays one-way).
 * - One-tap save: optimistic row update → recordEntry; errors roll the row
 *   back with a danger toast (R-Feedback); success shows an আনডু toast that
 *   truly reverses (restore previous value, or clear a fresh entry).
 * - BatchBar: fills every still-unrecorded row via ONE recordEntries
 *   mutation; individually-recorded rows are never overwritten.
 * - classtest/generic: marks entered through the ScoreSheet bottom sheet.
 * - Close: confirmAction sheet → closeTracker → TrackerSummary (a closed
 *   tracker cannot be reopened — server-enforced).
 */
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  TRACKER_QUERY,
  STUDENTS_QUERY,
  ASSESSMENT_SET_QUERY,
  RECORD_ENTRY,
  RECORD_ENTRIES,
  CLOSE_TRACKER,
  type StudentT,
} from "../../graphql/operations";
import type { TrackersStackParamList } from "../../navigation/types";
import { Screen, Button, EmptyState, Notice } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { OutcomeSegment, type OutcomeOption } from "../../components/OutcomeSegment";
import { BatchBar } from "../../components/BatchBar";
import { ScoreSheet } from "../../components/ScoreSheet";
import { TrackerProgressHeader } from "../../components/TrackerProgressHeader";
import {
  STR,
  bnNum,
  trackerKindLabel,
  setTypeLabel,
  trackerPendingMsg,
  scoreRecordedMsg,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { useToast } from "../../state/ToastContext";
import { buildPseudoMap } from "../../lib/pseudo";
import { makeStyles, radius, space, typeScale } from "../../theme";

type Props = NativeStackScreenProps<TrackersStackParamList, "TrackerEntry">;

const UNDO_TOAST_MS = 5000;

/** The kind-relevant slice of one entry; null = no record for this student. */
type EntryVal = { score?: number; submitted?: boolean; complete?: boolean };

type Mode = "homework" | "assignment" | "score";

function modeOf(trackerKind: string): Mode {
  if (trackerKind === "homework") return "homework";
  if (trackerKind === "assignment") return "assignment";
  return "score"; // classtest + generic
}

/** Does this value actually record the kind's outcome? */
function hasOutcome(mode: Mode, v: EntryVal | null | undefined): boolean {
  if (!v) return false;
  if (mode === "homework") return v.complete != null;
  if (mode === "assignment") return v.submitted != null;
  return v.score != null;
}

export default function TrackerEntryScreen({ route, navigation }: Props): React.ReactElement {
  const { trackerId } = route.params;
  const { confirmAction } = useConfirm();
  const toast = useToast();
  const styles = useStyles();

  const [tQ, refetchT] = useQuery({ query: TRACKER_QUERY, variables: { id: trackerId } });
  const tracker = tQ.data?.tracker;

  const [sQ, refetchS] = useQuery({
    query: STUDENTS_QUERY,
    variables: { sectionId: tracker?.sectionId ?? "" },
    pause: !tracker,
  });
  const [setQ, refetchSet] = useQuery({
    query: ASSESSMENT_SET_QUERY,
    variables: { id: tracker?.setId ?? "" },
    pause: !tracker,
  });

  const [, recordEntry] = useMutation(RECORD_ENTRY);
  const [, recordEntries] = useMutation(RECORD_ENTRIES);
  const [, closeTracker] = useMutation(CLOSE_TRACKER);
  const [closing, setClosing] = useState(false);

  // Optimistic overlay on top of the server-hydrated entries. A key that is
  // present wins over the server value; `null` means "cleared" (undo of a
  // fresh record).
  const [overlay, setOverlay] = useState<Record<string, EntryVal | null>>({});
  const [scoreFor, setScoreFor] = useState<StudentT | null>(null);

  const students = sQ.data?.studentsInSection ?? [];
  const set = setQ.data?.assessmentSet;
  const totalMarks = set?.totalMarks ?? 0;
  const mode: Mode = tracker ? modeOf(tracker.trackerKind) : "score";

  // --- hydration: pseudoStudentId(sha256) → roster student ------------------
  const serverValues = React.useMemo(() => {
    const map = new Map<string, EntryVal>();
    if (!tracker || students.length === 0) return map;
    const pseudoToId = buildPseudoMap(students.map((s) => s.id));
    for (const e of tracker.entries) {
      const sid = pseudoToId.get(e.pseudoStudentId);
      if (!sid) continue;
      map.set(sid, {
        score: e.score ?? undefined,
        submitted: e.submitted ?? undefined,
        complete: e.complete ?? undefined,
      });
    }
    return map;
  }, [tracker, students]);

  const effective = React.useCallback(
    (studentId: string): EntryVal | null => {
      if (studentId in overlay) return overlay[studentId];
      return serverValues.get(studentId) ?? null;
    },
    [overlay, serverValues],
  );

  const recordedCount = students.filter((s) => hasOutcome(mode, effective(s.id))).length;

  // --- single-row optimistic save + undo ------------------------------------
  const setRow = (studentId: string, v: EntryVal | null): void =>
    setOverlay((o) => ({ ...o, [studentId]: v }));

  async function saveRow(student: StudentT, payload: EntryVal, message: string): Promise<void> {
    const prev = effective(student.id);
    setRow(student.id, payload);
    const res = await recordEntry({ trackerId, studentId: student.id, ...payload });
    if (res.error) {
      setRow(student.id, prev); // roll back (R-Feedback)
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(message, "ok", {
      durationMs: UNDO_TOAST_MS,
      action: { label: STR.trkUndo, onPress: () => void undoRow(student, prev, payload) },
    });
  }

  async function undoRow(student: StudentT, prev: EntryVal | null, applied: EntryVal): Promise<void> {
    setRow(student.id, prev);
    const res = hasOutcome(mode, prev)
      ? await recordEntry({ trackerId, studentId: student.id, ...(prev as EntryVal) })
      : await recordEntries({ trackerId, entries: [{ studentId: student.id, clear: true }] });
    if (res.error) {
      setRow(student.id, applied); // undo failed — the save stands
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.trkUndone, "info");
  }

  // --- batch: fill unrecorded rows in one mutation ---------------------------
  const batchDefault: EntryVal =
    mode === "homework" ? { complete: true } : mode === "assignment" ? { submitted: true } : { score: totalMarks };
  const batchLabel =
    mode === "homework" ? STR.trkBatchComplete : mode === "assignment" ? STR.trkBatchSubmitted : STR.trkBatchFullMarks;
  const batchPossible = mode !== "score" || totalMarks > 0;
  const unrecorded = students.filter((s) => !hasOutcome(mode, effective(s.id)));

  async function applyBatch(): Promise<void> {
    if (unrecorded.length === 0) return;
    const targets = unrecorded; // snapshot — all previously unrecorded
    setOverlay((o) => {
      const next = { ...o };
      for (const s of targets) next[s.id] = batchDefault;
      return next;
    });
    const res = await recordEntries({
      trackerId,
      entries: targets.map((s) => ({ studentId: s.id, ...batchDefault })),
    });
    if (res.error) {
      setOverlay((o) => {
        const next = { ...o };
        for (const s of targets) next[s.id] = null;
        return next;
      });
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(`${batchLabel} — ${STR.trkBatchRecorded}`, "ok", {
      durationMs: UNDO_TOAST_MS,
      action: { label: STR.trkUndo, onPress: () => undoBatch(targets) },
    });
  }

  async function undoBatch(targets: StudentT[]): Promise<void> {
    setOverlay((o) => {
      const next = { ...o };
      for (const s of targets) next[s.id] = null;
      return next;
    });
    const res = await recordEntries({
      trackerId,
      entries: targets.map((s) => ({ studentId: s.id, clear: true })),
    });
    if (res.error) {
      setOverlay((o) => {
        const next = { ...o };
        for (const s of targets) next[s.id] = batchDefault;
        return next;
      });
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.trkUndone, "info");
  }

  // Recorded rows deviating from the batch default (prototype: ব্যতিক্রম).
  const exceptionsCount = students.filter((s) => {
    const v = effective(s.id);
    if (!hasOutcome(mode, v)) return false;
    if (mode === "homework") return v?.complete === false;
    if (mode === "assignment") return v?.submitted === false;
    return totalMarks > 0 && (v?.score ?? 0) < totalMarks;
  }).length;

  // --- outcome rows ----------------------------------------------------------
  const options: OutcomeOption[] =
    mode === "homework"
      ? [
          { value: "done", label: STR.complete, tone: "ok" },
          { value: "incomplete", label: STR.incomplete, tone: "danger" },
        ]
      : [
          { value: "submitted", label: STR.submitted, tone: "ok" },
          { value: "missing", label: STR.notSubmitted, tone: "danger" },
        ];

  function segmentValue(v: EntryVal | null): string | null {
    if (!hasOutcome(mode, v)) return null;
    if (mode === "homework") return v?.complete ? "done" : "incomplete";
    return v?.submitted ? "submitted" : "missing";
  }

  function onSegmentChange(student: StudentT, value: string): void {
    if (mode === "homework") {
      const complete = value === "done";
      void saveRow(student, { complete }, complete ? STR.trkRecordedComplete : STR.trkRecordedIncomplete);
    } else {
      const submitted = value === "submitted";
      void saveRow(student, { submitted }, submitted ? STR.trkRecordedSubmitted : STR.trkRecordedMissing);
    }
  }

  const setTitle = set ? setTypeLabel(set.setType) : tracker ? trackerKindLabel(tracker.trackerKind) : "";

  // --- close flow -------------------------------------------------------------
  async function onClose(): Promise<void> {
    if (closing) return;
    const pending = students.length - recordedCount;
    const ok = await confirmAction({
      title: STR.trkCloseTitle,
      message: `${STR.trkCloseWarn} ${pending > 0 ? trackerPendingMsg(pending) : STR.trkAllRecorded}`,
      confirmLabel: STR.trkCloseConfirm,
    });
    if (!ok) return;
    setClosing(true);
    const res = await closeTracker({ trackerId });
    setClosing(false);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    navigation.replace("TrackerSummary", { trackerId });
  }

  function retryAll(): void {
    refetchT({ requestPolicy: "network-only" });
    if (tracker) {
      refetchS({ requestPolicy: "network-only" });
      refetchSet({ requestPolicy: "network-only" });
    }
  }

  // --- closed tracker: entry is disabled, only the summary remains ------------
  if (tracker && tracker.status === "closed") {
    return (
      <Screen>
        <Notice message={STR.trkLocked} tone="warn" />
        <Button title={STR.trackerSummary} onPress={() => navigation.replace("TrackerSummary", { trackerId })} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <QueryGate
        results={tracker ? [tQ, sQ, setQ] : [tQ]}
        onRetry={retryAll}
        loaderLabel={STR.loading}
        isEmpty={!tQ.fetching && !tracker}
        empty={
          <View style={styles.padBox}>
            <Notice message={STR.empty} tone="warn" />
          </View>
        }
      >
        {tracker ? (
          <View style={styles.flex}>
            <TrackerProgressHeader
              title={trackerKindLabel(tracker.trackerKind)}
              subtitle={
                mode === "score" && totalMarks > 0
                  ? `${setTitle} · ${STR.trkFullMarks} ${bnNum(totalMarks)}`
                  : setTitle
              }
              recorded={recordedCount}
              total={students.length}
              onClose={closing ? undefined : onClose}
            />

            {students.length === 0 && sQ.data !== undefined ? (
              <View style={styles.padBox}>
                <EmptyState message={STR.trkNoStudentsYet} />
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.listContent}>
                {batchPossible ? (
                  <BatchBar
                    actionLabel={batchLabel}
                    onApply={() => void applyBatch()}
                    exceptionsCount={exceptionsCount}
                    disabled={unrecorded.length === 0}
                  />
                ) : null}

                {students.map((student) => {
                  const v = effective(student.id);
                  const recorded = hasOutcome(mode, v);
                  return (
                    <View key={student.id} style={[styles.row, recorded && styles.rowRecorded]}>
                      <View style={styles.rowMain}>
                        <View style={styles.rowText}>
                          <Text style={styles.rowName} numberOfLines={1}>
                            {student.name}
                          </Text>
                          <Text style={styles.rowMeta} numberOfLines={1}>
                            {student.schoolId}
                          </Text>
                        </View>

                        {mode === "score" ? (
                          <Pressable
                            onPress={() => setScoreFor(student)}
                            accessibilityRole="button"
                            accessibilityLabel={STR.trkEnterMarks}
                            style={({ pressed }) => [
                              styles.scoreBtn,
                              recorded && styles.scoreBtnSet,
                              pressed && styles.pressed,
                            ]}
                          >
                            <Text style={recorded ? styles.scoreBtnSetText : styles.scoreBtnText}>
                              {recorded
                                ? totalMarks > 0
                                  ? `${bnNum(v?.score ?? 0)}/${bnNum(totalMarks)}`
                                  : bnNum(v?.score ?? 0)
                                : STR.trkEnterMarks}
                            </Text>
                          </Pressable>
                        ) : (
                          <OutcomeSegment
                            options={options}
                            value={segmentValue(v)}
                            onChange={(value) => onSegmentChange(student, value)}
                          />
                        )}
                      </View>

                      {mode === "assignment" && segmentValue(v) === "missing" ? (
                        <View style={styles.reminderRow}>
                          <Button
                            title={STR.sendReminder}
                            variant="ghost"
                            onPress={() => navigation.navigate("WaLink", { studentName: student.name, setTitle })}
                          />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
                <View style={styles.listFooter} />
              </ScrollView>
            )}
          </View>
        ) : null}
      </QueryGate>

      <ScoreSheet
        visible={scoreFor !== null}
        studentName={scoreFor?.name ?? ""}
        rollLabel={scoreFor?.schoolId ?? ""}
        fullMarks={totalMarks}
        initialValue={scoreFor ? (effective(scoreFor.id)?.score ?? null) : null}
        onCancel={() => setScoreFor(null)}
        onSubmit={(score) => {
          const student = scoreFor;
          setScoreFor(null);
          if (student) void saveRow(student, { score }, scoreRecordedMsg(score, totalMarks));
        }}
      />
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  padBox: { padding: space(4) },
  listContent: { padding: space(4), gap: space(3) },
  listFooter: { height: space(6) },
  row: {
    minHeight: 64,
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
  },
  rowRecorded: {
    backgroundColor: colors.primaryContainer,
    borderColor: colors.primary,
  },
  rowMain: { flexDirection: "row", alignItems: "center", gap: space(2) },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { ...typeScale.bodyStrong, color: colors.textPrimary },
  rowMeta: { ...typeScale.secondary, color: colors.textSecondary },
  scoreBtn: {
    minHeight: 48,
    minWidth: 88,
    paddingHorizontal: space(3),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  scoreBtnSet: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryContainer,
  },
  scoreBtnText: { ...typeScale.chip, color: colors.primary },
  scoreBtnSetText: { ...typeScale.bodyStrong, color: colors.onPrimaryContainer },
  reminderRow: { marginTop: space(2) },
  pressed: { opacity: 0.7 },
}));
