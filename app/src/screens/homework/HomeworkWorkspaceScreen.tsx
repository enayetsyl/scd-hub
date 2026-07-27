/**
 * HomeworkWorkspaceScreen (RP-2, D-#355) — the single homework screen that
 * replaces Records + Checking. One card per subject per date (one hwItem), laid
 * out in responsive columns (CardGrid). Each card runs the three lifecycle stages
 * that are genuinely roster-shaped or individual:
 *
 *   ① জমা   — RosterChipPass over GIVEN/DUE/CHASE → homeworkSubmitPass
 *              (uncrossed → SUBMITTED; crossed → CHASE first-cross-only, §3.1)
 *   ② যাচাই — individual ঠিক/আংশিক/ভুল per SUBMITTED record (recordHomeworkOutcome)
 *   ③ ফেরত  — RosterChipPass over CHECKED/RESUBMIT → homeworkReturnPass
 *
 * Absent-at-issue students (ABSENT_REDELIVER) are not in any stage — they sit
 * behind the header badge with a redeliver action (→ GIVEN); redelivering puts
 * them into ① the same day. Manual re-chase of an already-chased student is the
 * secondary "চলমান তাগাদা" control under ①. Undo (D-#338) rides every checked row.
 */
import React, { useState, useRef, useCallback } from "react";
import { ScrollView, View, RefreshControl, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useQuery, useMutation } from "urql";
import {
  HOMEWORK_OPEN_RECORDS,
  HOMEWORK_SUBMIT_PASS,
  HOMEWORK_RETURN_PASS,
  RECORD_HOMEWORK_OUTCOME,
  ATTACH_HW_ANSWER_FILE,
  TRANSITION_HOMEWORK_RECORD,
  REVERT_HW_RECORD,
  type HwOpenRecordT,
} from "../../graphql/operations";
import { useConfirm } from "../../state/ConfirmContext";
import { pickAndUploadHomeworkFile, uploadHomeworkWebFile, FileUploadError, type UploadedFile } from "../../lib/files";
import { useTaughtSubjects } from "../../lib/useTaughtSubjects";
import { SubjectFold } from "../../components/SubjectFold";
import { RosterChipPass } from "../../components/RosterChipPass";
import { CardGrid } from "../../components/CardGrid";
import { UploadDropZone } from "../../components/UploadDropZone";
import type { HomeworkStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Field, Chip, ChipRow, Notice, Loader, EmptyState } from "../../components/ui";
import { ClassSectionDashboard } from "../../components/ClassSectionDashboard";
import {
  STR,
  bnNum,
  hwSubjectLabel,
  hwResultLabel,
  lifecycleStateLabel,
  dateHeaderLabel,
  dhakaDateKey,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { useSectionContext } from "../../state/SectionContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeworkStackParamList, "HomeworkWorkspace">;

/** Every non-terminal state + same-day RETURNED (undo-only, kept as today). */
// RETURNED is queried so a just-returned batch stays visible as a same-day
// confirmation list (with Undo), then clears next Dhaka day — the D-#338 posture.
const OPEN_STATES = ["GIVEN", "ABSENT_REDELIVER", "DUE", "SUBMITTED", "CHASE", "CHECKED", "RESUBMIT", "RETURNED"];
const SUBMIT_STATES = new Set(["GIVEN", "DUE", "CHASE"]);
const RETURN_STATES = new Set(["CHECKED", "RESUBMIT"]);

/** Calendar day (YYYY-MM-DD) of an ISO instant in Asia/Dhaka — mirrors the server gate. */
function dhakaDayOf(iso: string): string {
  return dhakaDateKey(iso);
}

interface ItemGroup {
  hwItemId: string;
  hwId: string;
  subject: string;
  dateGiven: string;
  topicLabelBn: string;
  description: string | null;
  rows: HwOpenRecordT[];
}

/** Group a section's open records into one bucket per homework item (= subject×date),
 *  newest given-date first, preserving first-seen order within. */
function groupByItem(records: readonly HwOpenRecordT[]): ItemGroup[] {
  const order: string[] = [];
  const map = new Map<string, ItemGroup>();
  for (const r of records) {
    let g = map.get(r.hwItemId);
    if (!g) {
      g = {
        hwItemId: r.hwItemId,
        hwId: r.hwId,
        subject: r.subject,
        dateGiven: r.dateGiven,
        topicLabelBn: r.topicLabelBn,
        description: r.description,
        rows: [],
      };
      map.set(r.hwItemId, g);
      order.push(r.hwItemId);
    }
    g.rows.push(r);
  }
  return order
    .map((id) => map.get(id)!)
    .sort((a, b) =>
      a.dateGiven < b.dateGiven ? 1 : a.dateGiven > b.dateGiven ? -1 : a.subject.localeCompare(b.subject),
    );
}

export default function HomeworkWorkspaceScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const base = { sectionId: selection.sectionId ?? "", classId: selection.classId ?? "" };

  const [recsQ, refetchRecs] = useQuery({
    query: HOMEWORK_OPEN_RECORDS,
    variables: { ...base, states: OPEN_STATES },
    pause: !hasSection,
  });
  // Keep RETURNED rows only while their last stamp is still today (Dhaka) — the
  // same-day "ফেরত হয়েছে" confirmation list; older returns fall off.
  const today = dhakaDayOf(new Date().toISOString());
  const records = (recsQ.data?.homeworkOpenRecords ?? []).filter(
    (r) => r.state !== "RETURNED" || dhakaDayOf(r.lastStateAt) === today,
  );
  const taught = useTaughtSubjects(selection.sectionId ?? null);

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const refresh = useCallback(() => refetchRecs({ requestPolicy: "network-only" }), [refetchRecs]);

  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      if (hasSection) refresh();
    }, [hasSection, refresh]),
  );

  const { refreshing, onRefresh } = usePullRefresh(recsQ.fetching, refresh);

  const notify = useCallback((okMsg: string | null, errMsg: string | null) => {
    setOk(okMsg);
    setError(errMsg);
  }, []);

  const renderCards = (recs: HwOpenRecordT[]): React.ReactNode => (
    <CardGrid>
      {groupByItem(recs).map((g) => (
        <ItemCard key={g.hwItemId} group={g} base={base} onDone={refresh} onNotify={notify} navigation={navigation} />
      ))}
    </CardGrid>
  );

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <ClassSectionDashboard />
      </View>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {!hasSection ? (
          <EmptyState message={STR.pickSection} />
        ) : recsQ.fetching && records.length === 0 ? (
          <Loader label={STR.loading} />
        ) : records.length === 0 ? (
          <EmptyState message={STR.hwPassNoOpenItems} />
        ) : (
          <>
            {ok ? <Notice message={ok} tone="ok" /> : null}
            {error ? <Notice message={error} tone="danger" /> : null}
            <SubjectFold key={selection.sectionId ?? ""} records={records} taught={taught} render={renderCards} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One subject×date card
// ---------------------------------------------------------------------------

function ItemCard({
  group,
  base,
  onDone,
  onNotify,
  navigation,
}: {
  group: ItemGroup;
  base: { sectionId: string; classId: string };
  onDone: () => void;
  onNotify: (ok: string | null, err: string | null) => void;
  navigation: Props["navigation"];
}): React.ReactElement {
  const [, submitPass] = useMutation(HOMEWORK_SUBMIT_PASS);
  const [, returnPass] = useMutation(HOMEWORK_RETURN_PASS);
  const [, transition] = useMutation(TRANSITION_HOMEWORK_RECORD);
  const [, revertRecord] = useMutation(REVERT_HW_RECORD);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [returnBusy, setReturnBusy] = useState(false);
  const [showAbsent, setShowAbsent] = useState(false);
  const [showChase, setShowChase] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const submitRows = group.rows.filter((r) => SUBMIT_STATES.has(r.state));
  const checkRows = group.rows.filter((r) => r.state === "SUBMITTED");
  const returnRows = group.rows.filter((r) => RETURN_STATES.has(r.state));
  const returnedRows = group.rows.filter((r) => r.state === "RETURNED");
  const absentRows = group.rows.filter((r) => r.state === "ABSENT_REDELIVER");
  const chaseRows = submitRows.filter((r) => r.state === "CHASE");

  async function onSubmitCommit(entries: { id: string; on: boolean }[]): Promise<void> {
    setSubmitBusy(true);
    const res = await submitPass({
      sectionId: base.sectionId,
      itemId: group.hwItemId,
      entries: entries.map((e) => ({ recordId: e.id, submitted: e.on })),
    });
    setSubmitBusy(false);
    const r = res.data?.homeworkSubmitPass;
    if (res.error || !r) return onNotify(null, friendlyError(res.error));
    onNotify(`${STR.hwPassSubmitDone} · ${STR.hwPassSubmitted} ${bnNum(r.submittedCount)} · ${STR.hwPassNotSubmitted} ${bnNum(r.chasedCount)}`, null);
    onDone();
  }

  async function onReturnCommit(entries: { id: string; on: boolean }[]): Promise<void> {
    setReturnBusy(true);
    const res = await returnPass({
      sectionId: base.sectionId,
      itemId: group.hwItemId,
      entries: entries.map((e) => ({ recordId: e.id, returned: e.on })),
    });
    setReturnBusy(false);
    const r = res.data?.homeworkReturnPass;
    if (res.error || !r) return onNotify(null, friendlyError(res.error));
    onNotify(`${STR.hwPassReturnDone} · ${STR.hwPassReturned} ${bnNum(r.returnedCount)}`, null);
    onDone();
  }

  async function onRedeliver(recordId: string): Promise<void> {
    setBusyId(recordId);
    const res = await transition({ sectionId: base.sectionId, recordId, toState: "GIVEN" });
    setBusyId(null);
    if (res.error || !res.data?.transitionHomeworkRecord) return onNotify(null, friendlyError(res.error));
    onNotify(lifecycleStateLabel("GIVEN"), null);
    onDone();
  }

  /** Manual re-chase of an already-chased student (§3.1 — increments + notifies). */
  async function onChaseAgain(recordId: string): Promise<void> {
    setBusyId(recordId);
    const res = await transition({ sectionId: base.sectionId, recordId, toState: "CHASE" });
    setBusyId(null);
    if (res.error || !res.data?.transitionHomeworkRecord) return onNotify(null, friendlyError(res.error));
    onNotify(STR.hwChaseAction, null);
    onDone();
  }

  /** Undo a same-day return (D-#338) — puts the student back into ফেরত. */
  async function onUndoReturn(recordId: string): Promise<void> {
    setBusyId(recordId);
    const res = await revertRecord({ sectionId: base.sectionId, recordId });
    setBusyId(null);
    if (res.error || !res.data?.revertHomeworkRecord) return onNotify(null, friendlyError(res.error));
    onNotify(STR.revertDone, null);
    onDone();
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flexShrink: 1 }}>
          <Body style={{ fontWeight: "700" }}>
            {dateHeaderLabel(group.dateGiven.slice(0, 10))} · {hwSubjectLabel(group.subject)}
          </Body>
          <Muted style={{ marginTop: 2 }}>
            {group.hwId}
            {group.topicLabelBn ? ` · 📘 ${group.topicLabelBn}` : ""}
          </Muted>
        </View>
        {absentRows.length > 0 ? (
          <Button
            title={`${STR.hwAbsentAtIssue} · ${bnNum(absentRows.length)}`}
            variant="ghost"
            onPress={() => setShowAbsent((v) => !v)}
          />
        ) : null}
      </View>
      {group.description ? <Body style={{ marginTop: 2 }}>📝 {group.description}</Body> : null}

      {/* Absent-at-issue drill (off the main flow) — redeliver puts them into ①. */}
      {showAbsent && absentRows.length > 0 ? (
        <Card>
          {absentRows.map((r) => (
            <View key={r.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44 }}>
              <Body style={{ flexShrink: 1 }}>{r.studentName}</Body>
              <Button title={STR.hwRedeliver} variant="secondary" onPress={() => void onRedeliver(r.id)} loading={busyId === r.id} disabled={busyId !== null} />
            </View>
          ))}
        </Card>
      ) : null}

      {/* ① জমা */}
      {submitRows.length > 0 ? (
        <View style={{ marginTop: space(3) }}>
          <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>── {STR.hwPassSubmit} ──</Muted>
          <RosterChipPass
            students={submitRows.map((r) => ({
              id: r.id,
              name: r.studentName,
              // A resubmission (the student's redo) is badged so it isn't mistaken for
              // a duplicate of their original still awaiting return (owner 2026-07-26).
              badge:
                (r.resubOf ? `🔁 ${STR.hwResubTag}` : "") +
                  (r.chaseCount > 0 ? `${r.resubOf ? " · " : ""}${STR.hwChaseAction} ${bnNum(r.chaseCount)}` : "") ||
                undefined,
            }))}
            onLabel={STR.hwPassSubmitted}
            offLabel={STR.hwPassNotSubmitted}
            commitLabel={STR.hwPassSubmitCommit}
            busy={submitBusy}
            onCommit={onSubmitCommit}
          />
          {chaseRows.length > 0 ? (
            <View style={{ marginTop: space(2) }}>
              <Button title={`${STR.hwChaseAction} (${bnNum(chaseRows.length)})`} variant="ghost" onPress={() => setShowChase((v) => !v)} />
              {showChase
                ? chaseRows.map((r) => (
                    <View key={r.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44 }}>
                      <Body style={{ flexShrink: 1 }}>
                        {r.studentName} · {lifecycleStateLabel("CHASE")} {bnNum(r.chaseCount)}
                      </Body>
                      <Button title={STR.hwChaseAgain} variant="secondary" onPress={() => void onChaseAgain(r.id)} loading={busyId === r.id} disabled={busyId !== null} />
                    </View>
                  ))
                : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* ② যাচাই */}
      {checkRows.length > 0 ? (
        <View style={{ marginTop: space(3) }}>
          <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>── {STR.hwPassCheck} ──</Muted>
          {checkRows.map((r) => (
            <CheckRow key={r.id} record={r} base={base} onDone={onDone} onNotify={onNotify} />
          ))}
        </View>
      ) : null}

      {/* ③ ফেরত */}
      {returnRows.length > 0 ? (
        <View style={{ marginTop: space(3) }}>
          <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>── {STR.hwPassReturn} ──</Muted>
          <RosterChipPass
            students={returnRows.map((r) => ({ id: r.id, name: r.studentName }))}
            onLabel={STR.hwPassReturned}
            offLabel={STR.hwPassKeptBack}
            commitLabel={STR.hwPassReturnCommit}
            busy={returnBusy}
            onCommit={onReturnCommit}
          />
        </View>
      ) : null}

      {/* Same-day confirmation of what was handed back (with Undo); clears next day. */}
      {returnedRows.length > 0 ? (
        <View style={{ marginTop: space(3) }}>
          <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>
            ── {STR.hwReturnedHeading} ({bnNum(returnedRows.length)}) ──
          </Muted>
          {returnedRows.map((r) => (
            <View key={r.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 40 }}>
              <Body style={{ flexShrink: 1 }}>✓ {r.studentName}</Body>
              {r.stampCount > 1 ? (
                <Button title={STR.revertAction} variant="ghost" onPress={() => void onUndoReturn(r.id)} loading={busyId === r.id} disabled={busyId !== null} />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// One SUBMITTED student's checking row (ঠিক / আংশিক / ভুল + file attach)
// ---------------------------------------------------------------------------

function CheckRow({
  record,
  base,
  onDone,
  onNotify,
}: {
  record: HwOpenRecordT;
  base: { sectionId: string; classId: string };
  onDone: () => void;
  onNotify: (ok: string | null, err: string | null) => void;
}): React.ReactElement {
  const nav = useNavigation<Props["navigation"]>();
  const [, recordOutcome] = useMutation(RECORD_HOMEWORK_OUTCOME);
  const [, attachAnswer] = useMutation(ATTACH_HW_ANSWER_FILE);
  const [, revertRecord] = useMutation(REVERT_HW_RECORD);
  const { confirmAction } = useConfirm();

  const [expanded, setExpanded] = useState<"" | "PARTIAL" | "WRONG">("");
  const [resubmit, setResubmit] = useState(false);
  const [topupQids, setTopupQids] = useState("");
  const [topupTime, setTopupTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);

  async function fire(outcome: string): Promise<void> {
    setBusy(true);
    const qids = topupQids.split(",").map((t) => t.trim()).filter(Boolean);
    const res = await recordOutcome({
      sectionId: base.sectionId,
      recordId: record.id,
      outcome,
      resubmit: outcome === "PARTIAL" ? resubmit : undefined,
      topupQids: qids.length > 0 ? qids : undefined,
      topupTime: qids.length > 0 && topupTime.trim() !== "" ? parseInt(topupTime, 10) : undefined,
    });
    setBusy(false);
    if (res.error || !res.data?.recordHomeworkOutcome) return onNotify(null, friendlyError(res.error));
    onNotify(hwResultLabel(outcome), null);
    onDone();
  }

  function onChip(outcome: string): void {
    if (outcome === "CORRECT") return void fire("CORRECT");
    setExpanded(outcome as "PARTIAL" | "WRONG");
  }

  async function runAttach(upload: () => Promise<UploadedFile | null>): Promise<void> {
    if (fileBusy) return;
    setFileBusy(true);
    try {
      const uploaded = await upload();
      if (!uploaded) return;
      const res = await attachAnswer({ recordId: record.id, fileId: uploaded.fileId });
      if (res.error || !res.data?.attachHomeworkAnswerFile) return onNotify(null, friendlyError(res.error));
      onNotify(STR.hwFileAttached, null);
      onDone();
    } catch (e) {
      onNotify(null, e instanceof FileUploadError ? e.message : STR.hwFileUploadFail);
    } finally {
      setFileBusy(false);
    }
  }

  async function onRevert(): Promise<void> {
    if (!(await confirmAction({ title: STR.revertConfirmTitle, message: STR.revertConfirmBody, confirmLabel: STR.revertAction }))) return;
    setBusy(true);
    const res = await revertRecord({ sectionId: base.sectionId, recordId: record.id });
    setBusy(false);
    if (res.error || !res.data?.revertHomeworkRecord) return onNotify(null, friendlyError(res.error));
    onNotify(STR.revertDone, null);
    onDone();
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        {/* SP-3 entry point: while marking, "is this child always like this?" is one
            tap away — the profile opens on the homework panel. */}
        <Pressable
          style={{ flex: 1 }}
          onPress={() =>
            nav.navigate("StudentProfile", {
              studentId: record.studentId,
              studentName: record.studentName,
              initialPanel: "homework",
            })
          }
        >
          <Body style={{ fontWeight: "700" }}>{record.studentName}</Body>
        </Pressable>
        {record.hasAnswerFile ? <Badge text={STR.hwFileHas} tone="ok" /> : null}
      </View>
      <ChipRow>
        <Chip label={STR.hwOutcomeCorrect} selected={busy} onPress={() => onChip("CORRECT")} />
        <Chip label={STR.hwOutcomePartial} selected={expanded === "PARTIAL"} onPress={() => onChip("PARTIAL")} />
        <Chip label={STR.hwOutcomeWrong} selected={expanded === "WRONG"} onPress={() => onChip("WRONG")} />
      </ChipRow>
      {expanded ? (
        <View style={{ marginTop: 8 }}>
          {expanded === "PARTIAL" ? (
            <ChipRow>
              <Chip label={STR.hwResubmit} selected={resubmit} onPress={() => setResubmit((v) => !v)} />
            </ChipRow>
          ) : null}
          <Field label={STR.hwTopupQids} value={topupQids} onChangeText={setTopupQids} />
          <Field label={STR.hwTopupTime} value={topupTime} onChangeText={setTopupTime} keyboardType="number-pad" />
          <View style={{ marginTop: 8 }}>
            <Button title={STR.hwConfirm} onPress={() => void fire(expanded)} loading={busy} disabled={busy} />
          </View>
        </View>
      ) : null}
      <View style={{ marginTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <UploadDropZone onFiles={(dropped) => void runAttach(() => uploadHomeworkWebFile(dropped[0], "answer"))} disabled={fileBusy}>
          <Button
            title={STR.hwAttachAnswer}
            variant="secondary"
            onPress={() => void runAttach(() => pickAndUploadHomeworkFile("answer"))}
            loading={fileBusy}
            disabled={fileBusy}
          />
        </UploadDropZone>
        {record.stampCount > 1 ? <Button title={STR.revertAction} variant="ghost" onPress={() => void onRevert()} loading={busy} disabled={busy} /> : null}
      </View>
    </Card>
  );
}
