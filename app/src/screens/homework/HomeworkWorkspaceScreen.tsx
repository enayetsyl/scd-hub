/**
 * HomeworkWorkspaceScreen (RP-2, D-#355) — the single homework screen that
 * replaces Records + Checking. One card per subject per date (one hwItem), laid
 * out in responsive columns (CardGrid). Each card is a FOLD (owner ask 2026-07-28,
 * D-#371): collapsed by default with the per-stage counts on the header, so a
 * multi-subject day opens as a scannable index instead of one long roster scroll.
 * Each card runs the three lifecycle stages that are genuinely roster-shaped or
 * individual:
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
import React, { useState, useRef, useCallback, useMemo } from "react";
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
  HOMEWORK_ITEM_TALLIES,
  type HwOpenRecordT,
  type HwItemTallyT,
} from "../../graphql/operations";
import { useConfirm } from "../../state/ConfirmContext";
import {
  pickAndUploadHomeworkFile,
  uploadHomeworkWebFile,
  openStoredFile,
  FILE_VIEW_SUPPORTED,
  FileUploadError,
  type UploadedFile,
} from "../../lib/files";
import { useFileOpen } from "../../lib/useFileOpen";
import { useTaughtSubjects } from "../../lib/useTaughtSubjects";
import { SubjectFold, type SubjectFoldRenderOpts } from "../../components/SubjectFold";
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

/** "No subject filter" — the default chip. */
const ANY_SUBJECT = "__any";

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
  // D-#383: the card header's pipeline counts. Must come from the server — the
  // rows above are open-work only (RETURNED falls off after today), so a finished
  // item has no rows left to count.
  const [talliesQ, refetchTallies] = useQuery({
    query: HOMEWORK_ITEM_TALLIES,
    variables: base,
    pause: !hasSection,
  });
  const tallyByItem = useMemo(
    () => new Map((talliesQ.data?.homeworkItemTallies ?? []).map((t) => [t.hwItemId, t])),
    [talliesQ.data],
  );
  // Keep RETURNED rows only while their last stamp is still today (Dhaka) — the
  // same-day "ফেরত হয়েছে" confirmation list; older returns fall off.
  const today = dhakaDayOf(new Date().toISOString());
  const all = recsQ.data?.homeworkOpenRecords ?? [];
  const records = all.filter((r) => r.state !== "RETURNED" || dhakaDayOf(r.lastStateAt) === today);
  // Everything left over belongs to an item with NO open rows — finished work. It used
  // to vanish from the screen entirely (owner: "I need to see the returned card",
  // 2026-08-02); it now lives in a collapsed fold at the foot.
  const openItemIds = new Set(records.map((r) => r.hwItemId));
  const doneRecords = all.filter((r) => !openItemIds.has(r.hwItemId));
  const taught = useTaughtSubjects(selection.sectionId ?? null);

  // Subject filter (owner ask 2026-08-02). Anyone who sees several subjects on one
  // class — Principal/Office, a class teacher, a teacher carrying two subjects —
  // opens this screen as a mixed deck of subject×date cards. One chip row narrows it
  // to a single subject; a caller with only one subject in play never sees the row.
  // The filter runs BEFORE SubjectFold, so the taught/not-taught fold (D-#388) and
  // its read-only oversight rendering still apply to whatever is left.
  const [subjectFilter, setSubjectFilter] = useState<string>(ANY_SUBJECT);
  const [subjectOpen, setSubjectOpen] = useState(false);
  // Count CARDS (hwItems), not records — "English (৯)" means nine homework cards,
  // which is what the chip is narrowing to. Counted over `all`, so a subject whose
  // only cards are finished still gets a chip.
  const itemIdsBySubject = new Map<string, Set<string>>();
  for (const r of all) {
    let ids = itemIdsBySubject.get(r.subject);
    if (!ids) {
      ids = new Set<string>();
      itemIdsBySubject.set(r.subject, ids);
    }
    ids.add(r.hwItemId);
  }
  const subjectOptions = [...itemIdsBySubject]
    .map(([subject, ids]) => ({ subject, count: ids.size }))
    .sort((a, b) => hwSubjectLabel(a.subject).localeCompare(hwSubjectLabel(b.subject)));
  // A pick left over from another section reads as "সব" instead of an empty screen.
  const activeSubject = subjectOptions.some((o) => o.subject === subjectFilter) ? subjectFilter : ANY_SUBJECT;
  const bySubject = <T extends { subject: string }>(rows: T[]): T[] =>
    activeSubject === ANY_SUBJECT ? rows : rows.filter((r) => r.subject === activeSubject);
  const shown = bySubject(records);
  const shownDone = bySubject(doneRecords);
  const doneCount = new Set(shownDone.map((r) => r.hwItemId)).size;

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Both queries refetch together: a submit/return pass changes the rows AND the
  // header counts, so refreshing one without the other leaves a stale card.
  const refresh = useCallback(() => {
    refetchRecs({ requestPolicy: "network-only" });
    refetchTallies({ requestPolicy: "network-only" });
  }, [refetchRecs, refetchTallies]);

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

  // Owner ask 2026-07-28 (refinement of D-#371): a TRUE accordion — at most ONE card open
  // at a time, so opening one collapses the previous. The open id therefore lives HERE,
  // above the cards, not as per-card state: only a single owner can enforce "one open".
  // It is keyed by hwItemId (not index) so the selection survives the list re-ordering on
  // refresh, and `null` = everything collapsed, which is the initial state.
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  // The finished-work fold — collapsed by default, so the daily deck stays the deck.
  const [showDone, setShowDone] = useState(false);

  const renderCards = (recs: HwOpenRecordT[], opts?: SubjectFoldRenderOpts): React.ReactNode => (
    <CardGrid>
      {groupByItem(recs).map((g) => (
        <ItemCard
          key={g.hwItemId}
          group={g}
          tally={tallyByItem.get(g.hwItemId) ?? null}
          readOnly={!!opts?.readOnly}
          viewOnlyNote={opts?.viewOnlyNote}
          base={base}
          open={openItemId === g.hwItemId}
          onToggle={() => setOpenItemId((id) => (id === g.hwItemId ? null : g.hwItemId))}
          onDone={refresh}
          onNotify={notify}
          navigation={navigation}
        />
      ))}
    </CardGrid>
  );

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <ClassSectionDashboard />
        {/* Sits with the class/section chips (outside the scroller) so it stays reachable
            while scrolling a long deck. Hidden when the section has one subject in play. */}
        {subjectOptions.length > 1 ? (
          <View style={{ marginTop: space(1) }}>
            {/* Collapsed by default — the assignment workspace's twin (owner ask
                2026-08-03). The header keeps the ACTIVE subject visible while shut, so a
                filter can never silently hide work; picking one closes it again. */}
            <Pressable
              onPress={() => setSubjectOpen((v) => !v)}
              accessibilityRole="button"
              style={{ flexDirection: "row", alignItems: "center", minHeight: 36 }}
              hitSlop={8}
            >
              <Muted>
                {subjectOpen ? "▾" : "▸"} {STR.subject}
                {activeSubject === ANY_SUBJECT ? "" : `: ${hwSubjectLabel(activeSubject)}`}
              </Muted>
            </Pressable>
            {subjectOpen ? (
              <ChipRow>
                <Chip
                  label={STR.all}
                  selected={activeSubject === ANY_SUBJECT}
                  onPress={() => {
                    setSubjectFilter(ANY_SUBJECT);
                    setSubjectOpen(false);
                  }}
                />
                {subjectOptions.map((o) => (
                  <Chip
                    key={o.subject}
                    label={`${hwSubjectLabel(o.subject)} (${bnNum(o.count)})`}
                    selected={activeSubject === o.subject}
                    onPress={() => {
                      setSubjectFilter(o.subject);
                      setSubjectOpen(false);
                    }}
                  />
                ))}
              </ChipRow>
            ) : null}
          </View>
        ) : null}
      </View>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {!hasSection ? (
          <EmptyState message={STR.pickSection} />
        ) : recsQ.fetching && all.length === 0 ? (
          <Loader label={STR.loading} />
        ) : (
          <>
            {ok ? <Notice message={ok} tone="ok" /> : null}
            {error ? <Notice message={error} tone="danger" /> : null}
            {shown.length === 0 ? (
              <EmptyState message={STR.hwPassNoOpenItems} />
            ) : (
              <SubjectFold key={selection.sectionId ?? ""} records={shown} taught={taught} render={renderCards} />
            )}
            {/* Finished items — every student returned, so no stage is left to run.
                Collapsed by default and read-only: a teacher's undo is same-Dhaka-day
                only (HomeworkRevertService), so on older work every control would
                refuse; Office/Principal correct it from the records/roll-ups. */}
            {shownDone.length > 0 ? (
              <View style={{ marginTop: space(3) }}>
                <Button
                  title={`${showDone ? "▾" : "▸"} ${STR.wsCompletedFold} (${bnNum(doneCount)})`}
                  variant="secondary"
                  onPress={() => setShowDone((v) => !v)}
                />
                {showDone ? (
                  <View style={{ marginTop: space(2) }}>
                    {renderCards(shownDone, { readOnly: true, viewOnlyNote: STR.wsCompletedNote })}
                  </View>
                ) : null}
              </View>
            ) : null}
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
  tally,
  readOnly,
  viewOnlyNote,
  base,
  open,
  onToggle,
  onDone,
  onNotify,
  navigation,
}: {
  group: ItemGroup;
  /** D-#383 pipeline counts; null while the query is in flight or if the item has none. */
  tally: HwItemTallyT | null;
  /** D-#388: a FOLDED (not-my-subject) card — oversight only, no lifecycle controls.
   *  The completed-work fold reuses it for finished items. */
  readOnly: boolean;
  /** Why this card is view-only; defaults to the not-my-subject line. */
  viewOnlyNote?: string;
  base: { sectionId: string; classId: string };
  /** Accordion: owned by the screen so only ONE card can be open (D-#371 refinement). */
  open: boolean;
  onToggle: () => void;
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
  const [showUndoCheck, setShowUndoCheck] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const submitRows = group.rows.filter((r) => SUBMIT_STATES.has(r.state));
  const checkRows = group.rows.filter((r) => r.state === "SUBMITTED");
  const returnRows = group.rows.filter((r) => RETURN_STATES.has(r.state));
  const returnedRows = group.rows.filter((r) => r.state === "RETURNED");
  // Awaiting return AND carrying an undoable step — the "checked by mistake" list.
  const undoCheckRows = returnRows.filter((r) => r.stampCount > 1);
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

  /** Undo the last recorded step for one student (D-#338). Used by BOTH the
   *  same-day returned list and the ③ ফেরত step's "checked by mistake" list. */
  async function onUndoReturn(recordId: string): Promise<void> {
    setBusyId(recordId);
    const res = await revertRecord({ sectionId: base.sectionId, recordId });
    setBusyId(null);
    if (res.error || !res.data?.revertHomeworkRecord) return onNotify(null, friendlyError(res.error));
    onNotify(STR.revertDone, null);
    onDone();
  }

  // The collapsed summary (D-#383, owner ask). It used to list PENDING work only, so a
  // 17-of-21-returned item showed nothing but "অনুপস্থিত ৪" and read like a problem —
  // the finished students were not even in `group.rows` to count (open-work query).
  // Now the three pipeline stages ALWAYS hold their position, so the eye learns one
  // slot per stage, and only the two "still needs doing" figures are conditional.
  const summary = tally
    ? [
        `${STR.hwPassSubmit} ${bnNum(tally.submitted)}`,
        `${STR.hwPassCheck} ${bnNum(tally.checked)}`,
        `${STR.hwPassReturn} ${bnNum(tally.returned)}`,
        tally.pendingSubmission > 0 ? `${STR.hwStillPending} ${bnNum(tally.pendingSubmission)}` : null,
        // Absent-at-issue: its control lives inside the fold, so a folded card must
        // still say those students are waiting on a redeliver.
        tally.absent > 0 ? `${STR.hwAbsentAtIssue} ${bnNum(tally.absent)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : // Tally not in yet — fall back to what the open rows can prove, so the header
      // never goes blank on a slow network.
      [
        submitRows.length > 0 ? `${STR.hwStillPending} ${bnNum(submitRows.length)}` : null,
        absentRows.length > 0 ? `${STR.hwAbsentAtIssue} ${bnNum(absentRows.length)}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <Card>
      {/* The whole header is the fold toggle — a 44pt row, so it stays thumb-friendly. */}
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44 }}
      >
        <View style={{ flexShrink: 1 }}>
          <Body style={{ fontWeight: "700" }}>
            {open ? "▾" : "▸"} {dateHeaderLabel(group.dateGiven.slice(0, 10))} · {hwSubjectLabel(group.subject)}
          </Body>
          <Muted style={{ marginTop: 2 }}>
            {group.hwId}
            {group.topicLabelBn ? ` · 📘 ${group.topicLabelBn}` : ""}
          </Muted>
          {/* Shown only while folded — open, the stage headings say the same thing. */}
          {!open && summary ? <Muted style={{ marginTop: 2 }}>{summary}</Muted> : null}
        </View>
      </Pressable>

      {!open ? null : readOnly ? (
        /* D-#388 — a folded, not-my-subject card. The class teacher may SEE where the
           section stands; collecting and marking stay with the subject teacher. The
           server enforces that independently (canWrite honours only teaching/proxy
           grants matching section AND subject), so every control below would 403 —
           showing a roster read-out instead of dead buttons is the honest rendering. */
        <View style={{ marginTop: space(2) }}>
          <Muted style={{ fontStyle: "italic" }}>{viewOnlyNote ?? STR.foldViewOnly}</Muted>
          <View style={{ marginTop: space(2) }}>
            {group.rows.map((r) => (
              <View
                key={r.id}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingVertical: space(1),
                  gap: space(2),
                }}
              >
                <Body style={{ flexShrink: 1 }}>{r.studentName}</Body>
                {/* On a finished card the state alone says "ফেরত" for everyone —
                    the marking result is the substance. */}
                <Muted>
                  {lifecycleStateLabel(r.state)}
                  {r.result ? ` · ${hwResultLabel(r.result)}` : ""}
                </Muted>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <>
      {/* Absent-at-issue toggle — OUTSIDE the header Pressable on purpose: nested
          pressables would let one tap both open the drill and fold the card. */}
      {absentRows.length > 0 ? (
        <Button
          title={`${STR.hwAbsentAtIssue} · ${bnNum(absentRows.length)}`}
          variant="ghost"
          onPress={() => setShowAbsent((v) => !v)}
        />
      ) : null}
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
                // BUG-WC-4: a parent has reported this done at home. Shown HERE,
                // where the teacher actually commits the pass — not only on Today.
                (r.hasGuardianClaim ? `👪 ${STR.wcRosterChip} · ` : "") +
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
          {/*
            The ONLY way back out of CHECKED (owner report 2026-08-03). The ② যাচাই
            cards list SUBMITTED rows and the "returned" list only appears once a
            return is committed — so a record checked by mistake had no revert control
            anywhere, and pressing ফেরত just added a third wrong stamp. This exposes
            the same D-#338 undo the other two steps already offer. Collapsed by
            default: on a full class this would otherwise repeat the whole roster.
          */}
          {undoCheckRows.length > 0 ? (
            <View style={{ marginTop: space(2) }}>
              <Button
                title={`${STR.revertFromReturn} (${bnNum(undoCheckRows.length)})`}
                variant="ghost"
                onPress={() => setShowUndoCheck((v) => !v)}
              />
              {showUndoCheck
                ? undoCheckRows.map((r) => (
                    <View
                      key={r.id}
                      style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44 }}
                    >
                      <Body style={{ flexShrink: 1 }}>{r.studentName}</Body>
                      <Button
                        title={STR.revertAction}
                        variant="ghost"
                        onPress={() => void onUndoReturn(r.id)}
                        loading={busyId === r.id}
                        disabled={busyId !== null}
                      />
                    </View>
                  ))
                : null}
            </View>
          ) : null}
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
        </>
      )}
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

  const { openingId, runOpen } = useFileOpen();

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

  /** Stream the submitted answer file through the server and open it (web). */
  async function onOpenAnswerFile(fileId: string): Promise<void> {
    try {
      await openStoredFile(fileId);
    } catch (e) {
      onNotify(null, e instanceof FileUploadError ? e.message : STR.errGeneric);
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
        {/* The badge announced "📎 Attachment" but could not be opened, so the checker
            had no way to SEE what the student handed in (owner report 2026-08-06).
            Where viewing is supported (web, like every other file viewer here) it is a
            button; on native it stays the plain badge it always was. */}
        {record.answerFileId && FILE_VIEW_SUPPORTED ? (
          <Button
            title={STR.hwFileHas}
            variant="secondary"
            loading={openingId === record.answerFileId}
            disabled={!!openingId}
            onPress={() => void runOpen(record.answerFileId!, () => onOpenAnswerFile(record.answerFileId!))}
          />
        ) : record.hasAnswerFile ? (
          <Badge text={STR.hwFileHas} tone="ok" />
        ) : null}
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
