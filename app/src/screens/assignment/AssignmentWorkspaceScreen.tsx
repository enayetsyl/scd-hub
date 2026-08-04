/**
 * AssignmentWorkspaceScreen (RP-4, D-#356) — the assignment parity of the
 * homework workspace. One card per assignment item (subject × week) for a
 * section, laid out in responsive columns (CardGrid). Same three stages:
 *
 *   ① জমা   — RosterChipPass over GIVEN/DUE/CHASE → assignmentSubmitPass
 *              (uncrossed → SUBMITTED; crossed → CHASE first-cross-only, any date)
 *   ② যাচাই — individual ঠিক/আংশিক/ভুল + marks + feedback (recordAssignmentOutcome)
 *   ③ ফেরত  — RosterChipPass over CHECKED/RESUBMIT → assignmentReturnPass;
 *              a secondary পুনঃজমা list issues the explicit resubmission (D-#87)
 *
 * The class is chosen HERE, from the always-visible class chips (D-#385) — the same
 * browse the homework workspace has. Arriving from an AssignmentHome week-grid cell
 * passes that cell's section as route params, which the screen adopts into the shared
 * selection on mount; from then on the chips drive it. Absent-at-delivery students sit
 * behind the redeliver toggle inside the fold (redeliver → GIVEN); manual re-chase of
 * an already-chased student is the "তাগাদা" secondary control under ①.
 *
 * Each card is a FOLD (owner ask 2026-07-28, D-#371 — the homework fold applied to this
 * twin): collapsed by default with the per-stage counts on the header, so a section with
 * several subjects opens as a scannable index rather than one long roster scroll.
 */
import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { ScrollView, View, RefreshControl, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useQuery, useMutation } from "urql";
import { HW_RESULTS } from "@scd/shared";
import {
  AS_OPEN_RECORDS,
  ASSIGNMENT_ITEM_TALLIES,
  ASSIGNMENT_SUBMIT_PASS,
  ASSIGNMENT_RETURN_PASS,
  RECORD_AS_OUTCOME,
  REDELIVER_AS_RECORD,
  TRANSITION_AS_RECORD,
  ISSUE_AS_RESUBMISSION,
  REVERT_AS_RECORD,
  type AsOpenRecordT,
  type AsItemTallyT,
} from "../../graphql/operations";
import { useConfirm } from "../../state/ConfirmContext";
import { RosterChipPass } from "../../components/RosterChipPass";
import { CardGrid } from "../../components/CardGrid";
import { SubjectFold, type SubjectFoldRenderOpts } from "../../components/SubjectFold";
import { ClassSectionDashboard } from "../../components/ClassSectionDashboard";
import { useSectionContext } from "../../state/SectionContext";
import { useTaughtSubjects } from "../../lib/useTaughtSubjects";
import type { AssignmentStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Field, Chip, ChipRow, Notice, Loader, EmptyState } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, hwResultLabel, classLevelLabel, lifecycleStateLabel, dhakaDateKey } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AssignmentStackParamList, "AssignmentWorkspace">;

// RETURNED is queried so a just-returned batch stays a same-day confirmation
// list (with Undo), then clears next Dhaka day (D-#338 posture).
const OPEN_STATES = ["GIVEN", "ABSENT_REDELIVER", "DUE", "SUBMITTED", "CHASE", "CHECKED", "RESUBMIT", "RETURNED"];
const SUBMIT_STATES = new Set(["GIVEN", "DUE", "CHASE"]);
const RETURN_STATES = new Set(["CHECKED", "RESUBMIT"]);

/** "No subject filter" — the default chip. */
const ANY_SUBJECT = "__any";

const day = (iso?: string | null): string => (iso ? iso.slice(0, 10) : "—");

/** Calendar day (YYYY-MM-DD) of an ISO instant in Asia/Dhaka. */
function dhakaDayOf(iso: string): string {
  return dhakaDateKey(iso);
}

interface ItemGroup {
  asItemId: string;
  asId: string;
  subject: string;
  classLevel: number;
  deliveryDate: string | null;
  dueDate: string | null;
  rows: AsOpenRecordT[];
}

function groupByItem(records: readonly AsOpenRecordT[]): ItemGroup[] {
  const order: string[] = [];
  const map = new Map<string, ItemGroup>();
  for (const r of records) {
    let g = map.get(r.asItemId);
    if (!g) {
      g = {
        asItemId: r.asItemId,
        asId: r.asId,
        subject: r.subject,
        classLevel: r.classLevel,
        deliveryDate: r.deliveryDate,
        dueDate: r.dueDate,
        rows: [],
      };
      map.set(r.asItemId, g);
      order.push(r.asItemId);
    }
    g.rows.push(r);
  }
  return order
    .map((id) => map.get(id)!)
    .sort((a, b) => {
      const ad = a.deliveryDate ?? "";
      const bd = b.deliveryDate ?? "";
      return ad < bd ? 1 : ad > bd ? -1 : a.subject.localeCompare(b.subject);
    });
}

export default function AssignmentWorkspaceScreen({ route }: Props): React.ReactElement {
  // D-#385 (+ owner correction 2026-07-29): the class chips are ALWAYS shown, so
  // the class is switchable from here no matter how you arrived. A week-grid cell
  // still lands you on the right class — it does so by ADOPTING its section into
  // the shared selection once on mount, rather than pinning it behind the chips.
  // (Pinning was the original call; it left a drill-in with no way to switch.)
  const { selection, hasSection, setSection } = useSectionContext();
  const pinnedRef = useRef(route.params ?? null);

  useEffect(() => {
    const p = pinnedRef.current;
    if (!p) return; // arrived from the nav — the existing selection stands
    setSection({
      classId: p.classId,
      sectionId: p.sectionId,
      // Labels are unknown here; ClassSectionDashboard resolves them from its own
      // query and highlights by id, so null is safe.
      classLevel: null,
      classNameBn: null,
      sectionCode: null,
      sectionNameBn: null,
    });
  }, [setSection]);

  const sectionId = selection.sectionId ?? "";
  const classId = selection.classId ?? "";

  const [recsQ, refetchRecs] = useQuery({
    query: AS_OPEN_RECORDS,
    variables: { sectionId, classId, states: OPEN_STATES },
    pause: !hasSection,
  });
  // D-#383: card-header pipeline counts. Server-side because the rows above are
  // open-work only (RETURNED falls off after today), so a finished item has no rows
  // left to count. Mirrors the homework workspace exactly (D-#372 parity).
  const [talliesQ, refetchTallies] = useQuery({
    query: ASSIGNMENT_ITEM_TALLIES,
    variables: { sectionId, classId },
    pause: !hasSection,
  });
  const tallyByItem = useMemo(
    () => new Map((talliesQ.data?.assignmentItemTallies ?? []).map((t) => [t.asItemId, t])),
    [talliesQ.data],
  );
  const today = dhakaDayOf(new Date().toISOString());
  const all = recsQ.data?.assignmentOpenRecords ?? [];
  // Open work: RETURNED rows survive only while their last stamp is today in Dhaka
  // (the D-#338 same-day confirmation list).
  const records = all.filter((r) => r.state !== "RETURNED" || dhakaDayOf(r.lastStateAt) === today);
  // Everything left over belongs to an item with NO open rows at all — work that is
  // finished. It used to vanish from the screen entirely (owner: "I need to see the
  // returned card", 2026-08-02); it now lives in a collapsed fold at the foot.
  const openItemIds = new Set(records.map((r) => r.asItemId));
  const doneRecords = all.filter((r) => !openItemIds.has(r.asItemId));

  // Subject filter (owner ask 2026-08-02) — the homework workspace's twin. Anyone who
  // sees several subjects on one class (Principal/Office, a class teacher, a teacher
  // carrying two subjects) opens this as a mixed deck of subject×week cards; one chip
  // row narrows it. Hidden when the section has a single subject in play. Runs BEFORE
  // SubjectFold, so the taught/not-taught fold (D-#388) still applies to what is left.
  const [subjectFilter, setSubjectFilter] = useState<string>(ANY_SUBJECT);
  const [subjectOpen, setSubjectOpen] = useState(false);
  // Count CARDS (asItems), not records — "English (৪)" means four assignment cards.
  // Counted over `all`, so a subject whose only cards are finished still gets a chip.
  const itemIdsBySubject = new Map<string, Set<string>>();
  for (const r of all) {
    let ids = itemIdsBySubject.get(r.subject);
    if (!ids) {
      ids = new Set<string>();
      itemIdsBySubject.set(r.subject, ids);
    }
    ids.add(r.asItemId);
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
  const doneCount = new Set(shownDone.map((r) => r.asItemId)).size;

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  // Both queries refetch together: a pass changes the rows AND the header counts.
  const refresh = useCallback(() => {
    refetchRecs({ requestPolicy: "network-only" });
    refetchTallies({ requestPolicy: "network-only" });
  }, [refetchRecs, refetchTallies]);
  const notify = useCallback((okMsg: string | null, errMsg: string | null) => {
    setOk(okMsg);
    setError(errMsg);
  }, []);

  // Owner ask 2026-07-28 (refinement of D-#371): a TRUE accordion — at most ONE card open,
  // so opening one collapses the previous. The open id lives HERE, above the cards, because
  // only a single owner can enforce "one open"; keyed by asItemId (not index) so the
  // selection survives list re-ordering on refresh. null = all collapsed (the initial state).
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  // The finished-work fold — collapsed by default, so the daily deck stays the deck.
  const [showDone, setShowDone] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const { refreshing, onRefresh } = usePullRefresh(recsQ.fetching, refresh);

  // Subjects this caller actually teaches on the section — others fold away
  // rather than crowding the list (same posture as the homework workspace).
  const taught = useTaughtSubjects(hasSection ? sectionId : null);

  const renderCards = (recs: AsOpenRecordT[], opts?: SubjectFoldRenderOpts): React.ReactNode => (
    <CardGrid>
      {groupByItem(recs).map((g) => (
        <ItemCard
          key={g.asItemId}
          group={g}
          tally={tallyByItem.get(g.asItemId) ?? null}
          readOnly={!!opts?.readOnly}
          viewOnlyNote={opts?.viewOnlyNote}
          sectionId={sectionId}
          open={openItemId === g.asItemId}
          onToggle={() => setOpenItemId((id) => (id === g.asItemId ? null : g.asItemId))}
          onDone={refresh}
          onNotify={notify}
        />
      ))}
    </CardGrid>
  );

  return (
    <Screen padded={false}>
      {/* Always present: the class is switchable from the workspace itself,
          however you got here (owner ask 2026-07-29). */}
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <ClassSectionDashboard />
        {/* Sits with the class/section chips (outside the scroller) so it stays reachable
            while scrolling a long deck. Hidden when the section has one subject in play. */}
        {subjectOptions.length > 1 ? (
          <View style={{ marginTop: space(1) }}>
            {/* COLLAPSED BY DEFAULT (owner ask 2026-08-03): with six or seven subjects the
                chips wrapped to three rows and ate the screen before a single card showed.
                The header keeps the ACTIVE subject visible while shut — a filter you cannot
                see is a filter that silently hides work. Picking one closes it again, which
                is the point: get the space back. */}
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
              <EmptyState message={STR.asPassNoOpenItems} />
            ) : (
              /* Keyed by section so the fold state resets when the class chip changes. */
              <SubjectFold key={sectionId} records={shown} taught={taught} render={renderCards} />
            )}
            {/* Finished items — every student returned, so no stage is left to run.
                Collapsed by default and rendered read-only: a teacher's undo is
                same-Dhaka-day only (AssignmentRevertService), so on week-old work
                every control would refuse. Office/Principal correct it from the
                week grid. */}
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

function ItemCard({
  group,
  tally,
  readOnly,
  viewOnlyNote,
  sectionId,
  open,
  onToggle,
  onDone,
  onNotify,
}: {
  /** Accordion: owned by the screen so only ONE card can be open (D-#371 refinement). */
  open: boolean;
  onToggle: () => void;
  group: ItemGroup;
  /** D-#383 pipeline counts; null while the query is in flight or if the item has none. */
  tally: AsItemTallyT | null;
  /** D-#388: a FOLDED (not-my-subject) card — oversight only, no lifecycle controls.
   *  The completed-work fold reuses it for finished items. */
  readOnly: boolean;
  /** Why this card is view-only; defaults to the not-my-subject line. */
  viewOnlyNote?: string;
  sectionId: string;
  onDone: () => void;
  onNotify: (ok: string | null, err: string | null) => void;
}): React.ReactElement {
  const [, submitPass] = useMutation(ASSIGNMENT_SUBMIT_PASS);
  const [, returnPass] = useMutation(ASSIGNMENT_RETURN_PASS);
  const [, redeliver] = useMutation(REDELIVER_AS_RECORD);
  const [, transition] = useMutation(TRANSITION_AS_RECORD);
  const [, resub] = useMutation(ISSUE_AS_RESUBMISSION);
  const [, revertRecord] = useMutation(REVERT_AS_RECORD);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [returnBusy, setReturnBusy] = useState(false);
  const [showAbsent, setShowAbsent] = useState(false);
  const [showChase, setShowChase] = useState(false);
  const [showResub, setShowResub] = useState(false);
  const [showUndoCheck, setShowUndoCheck] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const submitRows = group.rows.filter((r) => SUBMIT_STATES.has(r.state));
  const checkRows = group.rows.filter((r) => r.state === "SUBMITTED");
  const returnRows = group.rows.filter((r) => RETURN_STATES.has(r.state));
  const returnedRows = group.rows.filter((r) => r.state === "RETURNED");
  const absentRows = group.rows.filter((r) => r.state === "ABSENT_REDELIVER");
  const chaseRows = submitRows.filter((r) => r.state === "CHASE");
  const checkedRows = group.rows.filter((r) => r.state === "CHECKED");
  // Awaiting return AND carrying an undoable step — the "checked by mistake" list.
  const undoCheckRows = returnRows.filter((r) => r.stampCount > 1);

  async function onSubmitCommit(entries: { id: string; on: boolean }[]): Promise<void> {
    setSubmitBusy(true);
    const res = await submitPass({
      sectionId,
      itemId: group.asItemId,
      entries: entries.map((e) => ({ recordId: e.id, submitted: e.on })),
    });
    setSubmitBusy(false);
    const r = res.data?.assignmentSubmitPass;
    if (res.error || !r) return onNotify(null, friendlyError(res.error));
    onNotify(`${STR.asCollectDone} · ${STR.asSubmitted} ${bnNum(r.submittedCount)} · ${STR.asNotSubmitted} ${bnNum(r.chasedCount)}`, null);
    onDone();
  }

  async function onReturnCommit(entries: { id: string; on: boolean }[]): Promise<void> {
    setReturnBusy(true);
    const res = await returnPass({
      sectionId,
      itemId: group.asItemId,
      entries: entries.map((e) => ({ recordId: e.id, returned: e.on })),
    });
    setReturnBusy(false);
    const r = res.data?.assignmentReturnPass;
    if (res.error || !r) return onNotify(null, friendlyError(res.error));
    onNotify(`${STR.asReturn} · ${bnNum(r.returnedCount)}`, null);
    onDone();
  }

  async function onRedeliver(recordId: string): Promise<void> {
    setBusyId(recordId);
    const res = await redeliver({ sectionId, recordId });
    setBusyId(null);
    if (res.error || !res.data?.redeliverAssignmentRecord) return onNotify(null, friendlyError(res.error));
    onNotify(lifecycleStateLabel("GIVEN"), null);
    onDone();
  }

  async function onChaseAgain(recordId: string): Promise<void> {
    setBusyId(recordId);
    const res = await transition({ sectionId, recordId, toState: "CHASE" });
    setBusyId(null);
    if (res.error || !res.data?.transitionAssignmentRecord) return onNotify(null, friendlyError(res.error));
    onNotify(lifecycleStateLabel("CHASE"), null);
    onDone();
  }

  async function onResubmit(recordId: string): Promise<void> {
    setBusyId(recordId);
    const res = await resub({ sectionId, recordId });
    setBusyId(null);
    if (res.error || !res.data?.issueAssignmentResubmission) return onNotify(null, friendlyError(res.error));
    onNotify(STR.asResubIssued, null);
    onDone();
  }

  /** Undo a same-day return (D-#338) — puts the student back into ফেরত. */
  async function onUndoReturn(recordId: string): Promise<void> {
    setBusyId(recordId);
    const res = await revertRecord({ sectionId, recordId });
    setBusyId(null);
    if (res.error || !res.data?.revertAssignmentRecord) return onNotify(null, friendlyError(res.error));
    onNotify(STR.revertDone, null);
    onDone();
  }

  // Folded summary — only the stages that actually have work, so a card with nothing
  // pending reads as done without being opened.
  // D-#383 (owner ask), twin of the homework card. Was pending-work only, so a
  // finished item showed nothing but its absentees — and the completed students
  // were not even in `group.rows` to count. The three pipeline stages now always
  // hold their position; only the two "still needs doing" figures are conditional.
  const summary = tally
    ? [
        `${STR.hwPassSubmit} ${bnNum(tally.submitted)}`,
        `${STR.asCheck} ${bnNum(tally.checked)}`,
        `${STR.asReturn} ${bnNum(tally.returned)}`,
        tally.pendingSubmission > 0 ? `${STR.hwStillPending} ${bnNum(tally.pendingSubmission)}` : null,
        tally.absent > 0 ? `${STR.asRedeliver} ${bnNum(tally.absent)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : // Tally not in yet — fall back to what the open rows prove, so the header
      // never goes blank on a slow network.
      [
        submitRows.length > 0 ? `${STR.hwStillPending} ${bnNum(submitRows.length)}` : null,
        absentRows.length > 0 ? `${STR.asRedeliver} ${bnNum(absentRows.length)}` : null,
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
            {open ? "▾" : "▸"} {classLevelLabel(group.classLevel)} · {hwSubjectLabel(group.subject)}
          </Body>
          <Muted style={{ marginTop: 2 }}>
            {group.asId} · {STR.asDeliverBy} {day(group.deliveryDate)} · {STR.asDueBy} {day(group.dueDate)}
          </Muted>
          {!open && summary ? <Muted style={{ marginTop: 2 }}>{summary}</Muted> : null}
        </View>
      </Pressable>

      {!open ? null : readOnly ? (
        /* D-#388 — a folded, not-my-subject card: oversight only. The server refuses
           these writes independently (canWrite honours only teaching/proxy grants
           matching section AND subject), so a roster read-out is the honest rendering
           rather than controls that would 403. Twin of the homework workspace. */
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
                {/* On a finished card the state alone says "ফেরত" for everyone — the
                    result (and marks, when the item carries them) is the substance. */}
                <Muted>
                  {lifecycleStateLabel(r.state)}
                  {r.result ? ` · ${hwResultLabel(r.result)}` : ""}
                  {r.marks != null ? ` · ${bnNum(r.marks)}${r.totalMarks != null ? `/${bnNum(r.totalMarks)}` : ""}` : ""}
                </Muted>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <>
      {/* Redeliver toggle — OUTSIDE the header Pressable on purpose: nested pressables
          would let one tap both open the drill and fold the card. */}
      {absentRows.length > 0 ? (
        <Button title={`${STR.asRedeliver} · ${bnNum(absentRows.length)}`} variant="ghost" onPress={() => setShowAbsent((v) => !v)} />
      ) : null}

      {showAbsent && absentRows.length > 0 ? (
        <Card>
          {absentRows.map((r) => (
            <View key={r.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44 }}>
              <Body style={{ flexShrink: 1 }}>{r.studentName}</Body>
              <Button title={STR.asRedeliver} variant="secondary" onPress={() => void onRedeliver(r.id)} loading={busyId === r.id} disabled={busyId !== null} />
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
              // Badge the redo so it isn't mistaken for a duplicate (owner 2026-07-26).
              badge:
                (r.resubOf ? `🔁 ${STR.hwResubTag}` : "") +
                  (r.chaseCount > 0 ? `${r.resubOf ? " · " : ""}${lifecycleStateLabel("CHASE")} ${bnNum(r.chaseCount)}` : "") ||
                undefined,
            }))}
            onLabel={STR.asSubmitted}
            offLabel={STR.asNotSubmitted}
            commitLabel={STR.hwPassSubmitCommit}
            busy={submitBusy}
            onCommit={onSubmitCommit}
          />
          {chaseRows.length > 0 ? (
            <View style={{ marginTop: space(2) }}>
              <Button title={`${lifecycleStateLabel("CHASE")} (${bnNum(chaseRows.length)})`} variant="ghost" onPress={() => setShowChase((v) => !v)} />
              {showChase
                ? chaseRows.map((r) => (
                    <View key={r.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44 }}>
                      <Body style={{ flexShrink: 1 }}>
                        {r.studentName} · {lifecycleStateLabel("CHASE")} {bnNum(r.chaseCount)}
                      </Body>
                      <Button title={lifecycleStateLabel("CHASE")} variant="secondary" onPress={() => void onChaseAgain(r.id)} loading={busyId === r.id} disabled={busyId !== null} />
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
          <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>── {STR.asCheck} ──</Muted>
          {checkRows.map((r) => (
            <AsCheckRow key={r.id} record={r} sectionId={sectionId} onDone={onDone} onNotify={onNotify} />
          ))}
        </View>
      ) : null}

      {/* ③ ফেরত */}
      {returnRows.length > 0 ? (
        <View style={{ marginTop: space(3) }}>
          <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>── {STR.asReturn} ──</Muted>
          <RosterChipPass
            students={returnRows.map((r) => ({ id: r.id, name: r.studentName }))}
            onLabel={STR.asReturn}
            offLabel={STR.hwPassKeptBack}
            commitLabel={STR.hwPassReturnCommit}
            busy={returnBusy}
            onCommit={onReturnCommit}
          />
          {checkedRows.length > 0 ? (
            <View style={{ marginTop: space(2) }}>
              <Button title={`${STR.asResubmit} (${bnNum(checkedRows.length)})`} variant="ghost" onPress={() => setShowResub((v) => !v)} />
              {showResub
                ? checkedRows.map((r) => (
                    <View key={r.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44 }}>
                      <Body style={{ flexShrink: 1 }}>
                        {r.studentName}
                        {r.result ? ` · ${hwResultLabel(r.result)}` : ""}
                      </Body>
                      <Button title={STR.asResubmit} variant="secondary" onPress={() => void onResubmit(r.id)} loading={busyId === r.id} disabled={busyId !== null} />
                    </View>
                  ))
                : null}
            </View>
          ) : null}
          {/* Same gap as the homework tracker (owner report 2026-08-03): a record
              checked by mistake sat in this step with no D-#338 undo anywhere — the
              checking cards list SUBMITTED only, and the returned list appears just
              after a return is committed. Collapsed by default. */}
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
              <Body style={{ flexShrink: 1 }}>
                ✓ {r.studentName}
                {r.result ? ` · ${hwResultLabel(r.result)}` : ""}
              </Body>
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

function AsCheckRow({
  record,
  sectionId,
  onDone,
  onNotify,
}: {
  record: AsOpenRecordT;
  sectionId: string;
  onDone: () => void;
  onNotify: (ok: string | null, err: string | null) => void;
}): React.ReactElement {
  const nav = useNavigation<Props["navigation"]>();
  const [, recordOutcome] = useMutation(RECORD_AS_OUTCOME);
  const [, revertRecord] = useMutation(REVERT_AS_RECORD);
  const { confirmAction } = useConfirm();

  const [result, setResult] = useState("");
  const [marks, setMarks] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  async function onCheck(): Promise<void> {
    if (!result) return onNotify(null, STR.hwResult);
    setBusy(true);
    const res = await recordOutcome({
      sectionId,
      recordId: record.id,
      result,
      marks: marks.trim() === "" ? undefined : parseInt(marks, 10),
      feedback: feedback.trim() === "" ? undefined : feedback.trim(),
    });
    setBusy(false);
    if (res.error || !res.data?.recordAssignmentOutcome) return onNotify(null, friendlyError(res.error));
    onNotify(hwResultLabel(result), null);
    onDone();
  }

  async function onRevert(): Promise<void> {
    if (!(await confirmAction({ title: STR.revertConfirmTitle, message: STR.revertConfirmBody, confirmLabel: STR.revertAction }))) return;
    setBusy(true);
    const res = await revertRecord({ sectionId, recordId: record.id });
    setBusy(false);
    if (res.error || !res.data?.revertAssignmentRecord) return onNotify(null, friendlyError(res.error));
    onNotify(STR.revertDone, null);
    onDone();
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        {/* SP-3 entry point: the full profile, opened on the assignment panel. */}
        <Pressable
          style={{ flex: 1 }}
          onPress={() =>
            nav.navigate("StudentProfile", {
              studentId: record.studentId,
              studentName: record.studentName,
              initialPanel: "assignment",
            })
          }
        >
          <Body style={{ fontWeight: "700" }}>{record.studentName}</Body>
        </Pressable>
        {record.resubOf ? <Badge text={STR.hwResubmissions} tone="muted" /> : null}
      </View>
      <ChipRow>
        {HW_RESULTS.map((rv) => (
          <Chip key={rv} label={hwResultLabel(rv)} selected={result === rv} onPress={() => setResult(rv)} />
        ))}
      </ChipRow>
      <Field label={STR.asMarks} value={marks} onChangeText={setMarks} keyboardType="number-pad" />
      <Field label={STR.asFeedback} value={feedback} onChangeText={setFeedback} />
      <View style={{ marginTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flex: 1, marginRight: space(2) }}>
          <Button title={STR.asCheck} onPress={() => void onCheck()} loading={busy} disabled={busy || !result} />
        </View>
        {record.stampCount > 1 ? <Button title={STR.revertAction} variant="ghost" onPress={() => void onRevert()} loading={busy} disabled={busy} /> : null}
      </View>
    </Card>
  );
}
