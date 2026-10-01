/**
 * PlanReviewBoardScreen (D-#704) — who has which chapter plan and session plan.
 *
 * One row per CURRENT plan (a chapter plan, or one session of a chapter), grouped under
 * its chapter, showing the open round's reviewer, state and round number. From here the
 * Principal/Office:
 *   • assigns an unassigned plan,
 *   • changes the reviewer of a plan nobody has reviewed yet (the round moves in place),
 *   • sends a reviewed plan for a NEW round (to the same or another reviewer),
 *   • unassigns,
 *   • opens the plan's review history,
 * one row at a time or for a ticked selection ("give selected to…", "unassign selected").
 *
 * Gated content:assign_review, like Assign reviews.
 */
import React, { useMemo, useState } from "react";
import { View, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { SUBJECTS, CLASS_LEVELS, PLAN_DOC_TYPES } from "@scd/shared";
import {
  ASSIGNABLE_PLANS,
  REVIEWER_ASSIGNMENT_LOAD,
  TEACHERS_QUERY,
  ASSIGN_PLAN_REVIEW,
  ASSIGN_PLAN_REVIEW_BULK,
  CANCEL_PLAN_REVIEW,
  MOVE_PLAN_REVIEWS,
  CANCEL_PLAN_REVIEWS,
  type AssignablePlanT,
} from "../../graphql/operations";
import type { ReviewStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Chip,
  ChipRow,
  Badge,
  Button,
  Select,
  Notice,
  Loader,
  EmptyState,
  ErrorBanner,
  Divider,
} from "../../components/ui";
import { STR, subjectLabel, classLevelLabel, docTypeLabel, reviewVerdictLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ReviewStackParamList, "PlanReviewBoard">;

type RowState = "unassigned" | "awaiting" | "reviewed" | "signed";
const ROW_STATES: RowState[] = ["unassigned", "awaiting", "reviewed", "signed"];
/** Rows rendered before "show more" — the full list is ~800 plans. */
const PAGE = 120;

function stateOf(p: AssignablePlanT): RowState {
  if (p.reviewStatus === "gold") return "signed";
  if (!p.currentAssignmentId) return "unassigned";
  return p.roundStatus === "submitted" ? "reviewed" : "awaiting";
}

const STATE_LABEL: Record<RowState, () => string> = {
  unassigned: () => STR.prbStateUnassigned,
  awaiting: () => STR.prbStateAwaiting,
  reviewed: () => STR.prbStateReviewed,
  signed: () => STR.prbStateSigned,
};
const STATE_TONE: Record<RowState, "muted" | "info" | "brand" | "ok"> = {
  unassigned: "muted",
  awaiting: "info",
  reviewed: "brand",
  signed: "ok",
};

const chapterKey = (p: AssignablePlanT): string => `${p.subject}|${p.classLevel}|${p.anchorWord}|${p.addressNumber}`;

function chapterTitle(p: AssignablePlanT): string {
  const head = `${subjectLabel(p.subject)} · ${classLevelLabel(p.classLevel)} · ${p.anchorWord} ${bnNum(p.addressNumber)}`;
  return p.title ? `${head} · ${p.title}` : head;
}

/** "Chapter plan" / "Session 2". */
function rowLabel(p: AssignablePlanT): string {
  return p.docType === "session_plan" && p.sessionIndex != null
    ? `${STR.spSession} ${bnNum(p.sessionIndex)}`
    : docTypeLabel(p.docType);
}

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${bnNum(d.getDate())}/${bnNum(d.getMonth() + 1)}`;
}

/** What a single-row picker will do once a reviewer is chosen. */
type RowAction = { artifactId: string; kind: "assign" | "move" | "newRound" };

export default function PlanReviewBoardScreen({ navigation }: Props): React.ReactElement {
  const [{ data: plansData, fetching: plansFetching, error: plansErr }, refetchPlans] = useQuery({ query: ASSIGNABLE_PLANS });
  const [{ data: loadData }, refetchLoad] = useQuery({ query: REVIEWER_ASSIGNMENT_LOAD });
  const [{ data: teacherData }] = useQuery({ query: TEACHERS_QUERY });
  const [, assignOne] = useMutation(ASSIGN_PLAN_REVIEW);
  const [, assignBulk] = useMutation(ASSIGN_PLAN_REVIEW_BULK);
  const [, cancelOne] = useMutation(CANCEL_PLAN_REVIEW);
  const [, moveMany] = useMutation(MOVE_PLAN_REVIEWS);
  const [, cancelMany] = useMutation(CANCEL_PLAN_REVIEWS);

  const plans = plansData?.assignablePlans ?? [];
  const load = loadData?.reviewerAssignmentLoad ?? [];
  const teacherOptions = (teacherData?.teachers ?? []).map((t) => ({ label: t.name, value: t.id, hint: t.phone ?? undefined }));

  const [subject, setSubject] = useState<string | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);
  const [docType, setDocType] = useState<string | null>(null);
  const [state, setState] = useState<RowState | null>(null);
  const [reviewerFilter, setReviewerFilter] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkReviewer, setBulkReviewer] = useState<string | null>(null);
  const [confirmUnassign, setConfirmUnassign] = useState(false);
  const [rowAction, setRowAction] = useState<RowAction | null>(null);
  const [rowReviewer, setRowReviewer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "warn" | "danger" } | null>(null);

  const visible = useMemo(
    () =>
      plans.filter(
        (p) =>
          (!subject || p.subject === subject) &&
          (classLevel == null || p.classLevel === classLevel) &&
          (!docType || p.docType === docType) &&
          (!state || stateOf(p) === state) &&
          (!reviewerFilter || p.currentReviewerId === reviewerFilter),
      ),
    [plans, subject, classLevel, docType, state, reviewerFilter],
  );
  const shown = visible.slice(0, limit);
  const byId = useMemo(() => new Map(plans.map((p) => [p.artifactId, p])), [plans]);

  function refresh(): void {
    refetchPlans({ requestPolicy: "network-only" });
    refetchLoad({ requestPolicy: "network-only" });
  }

  function toggle(id: string): void {
    setConfirmUnassign(false);
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // --- single row ----------------------------------------------------------

  function openRowAction(p: AssignablePlanT, kind: RowAction["kind"]): void {
    setMsg(null);
    setRowReviewer(null);
    setRowAction(rowAction?.artifactId === p.artifactId && rowAction.kind === kind ? null : { artifactId: p.artifactId, kind });
  }

  async function runRowAction(): Promise<void> {
    if (!rowAction || !rowReviewer) return;
    const p = byId.get(rowAction.artifactId);
    if (!p) return;
    setBusy(true);
    setMsg(null);
    let error: unknown = null;
    if (rowAction.kind === "move" && p.currentAssignmentId) {
      const res = await moveMany({ assignmentIds: [p.currentAssignmentId], toReviewerId: rowReviewer });
      error = res.error;
      if (!res.error && res.data?.movePlanReviews.moved === 0) {
        error = new Error(res.data.movePlanReviews.skipped.join("; ") || STR.prbSkippedReviewed);
      }
    } else {
      // assign an unassigned plan, or a NEW round on a reviewed one (supersedes the open round)
      const res = await assignOne({ artifactId: p.artifactId, reviewerId: rowReviewer });
      error = res.error;
    }
    setBusy(false);
    if (error) {
      setMsg({ text: friendlyError(error as Parameters<typeof friendlyError>[0]), tone: "danger" });
      return;
    }
    setMsg({ text: rowAction.kind === "move" ? `${STR.prbMovedDone} ${bnNum(1)}` : `${STR.rvAssigned} ${bnNum(1)}`, tone: "ok" });
    setRowAction(null);
    refresh();
  }

  async function unassignRow(p: AssignablePlanT): Promise<void> {
    if (!p.currentAssignmentId) return;
    setBusy(true);
    setMsg(null);
    const res = await cancelOne({ assignmentId: p.currentAssignmentId });
    setBusy(false);
    if (res.error) return setMsg({ text: friendlyError(res.error), tone: "danger" });
    setMsg({ text: STR.rvUnassignedDone, tone: "ok" });
    refresh();
  }

  // --- bulk ----------------------------------------------------------------

  async function giveSelected(): Promise<void> {
    setMsg(null);
    setConfirmUnassign(false);
    if (!bulkReviewer) return setMsg({ text: STR.rvPickReviewerAndPlan, tone: "danger" });
    const rows = [...selected].map((id) => byId.get(id)).filter((p): p is AssignablePlanT => Boolean(p));
    if (rows.length === 0) return setMsg({ text: STR.prbNothingSelected, tone: "danger" });

    // Unassigned → a fresh round; awaiting (someone else's) → moved in place; a reviewed or
    // signed-off plan is left alone (a reviewed one needs a deliberate NEW round, per row).
    const toAssign = rows.filter((p) => stateOf(p) === "unassigned").map((p) => p.artifactId);
    const toMove = rows
      .filter((p) => stateOf(p) === "awaiting" && p.currentReviewerId !== bulkReviewer && p.currentAssignmentId)
      .map((p) => p.currentAssignmentId as string);
    const leftAlone = rows.length - toAssign.length - toMove.length;

    setBusy(true);
    const parts: string[] = [];
    let failed = false;
    if (toAssign.length > 0) {
      const res = await assignBulk({ artifactIds: toAssign, reviewerId: bulkReviewer });
      if (res.error || !res.data) failed = true;
      else {
        parts.push(`${STR.rvAssigned} ${bnNum(res.data.assignPlanReviewBulk.assignedCount)}`);
        if (res.data.assignPlanReviewBulk.failedCount > 0) {
          failed = true;
          parts.push(`${STR.rvFailed} ${bnNum(res.data.assignPlanReviewBulk.failedCount)}`);
        }
      }
    }
    if (toMove.length > 0) {
      const res = await moveMany({ assignmentIds: toMove, toReviewerId: bulkReviewer });
      if (res.error || !res.data) failed = true;
      else {
        parts.push(`${STR.prbMovedDone} ${bnNum(res.data.movePlanReviews.moved)}`);
        if (res.data.movePlanReviews.skippedCount > 0) parts.push(`${STR.prbSkipped} ${bnNum(res.data.movePlanReviews.skippedCount)}`);
      }
    }
    setBusy(false);
    if (leftAlone > 0) parts.push(`${STR.prbSkipped} ${bnNum(leftAlone)} — ${STR.prbSkippedReviewed}`);
    setMsg({ text: parts.join(" · ") || STR.prbSkippedReviewed, tone: failed ? "danger" : leftAlone > 0 ? "warn" : "ok" });
    setSelected(new Set());
    refresh();
  }

  async function unassignSelected(): Promise<void> {
    setMsg(null);
    const ids = [...selected]
      .map((id) => byId.get(id)?.currentAssignmentId)
      .filter((x): x is string => Boolean(x));
    if (ids.length === 0) return setMsg({ text: STR.prbNothingSelected, tone: "danger" });
    if (!confirmUnassign) {
      setConfirmUnassign(true);
      return;
    }
    setConfirmUnassign(false);
    setBusy(true);
    const res = await cancelMany({ assignmentIds: ids });
    setBusy(false);
    if (res.error || !res.data) return setMsg({ text: friendlyError(res.error), tone: "danger" });
    const r = res.data.cancelPlanReviews;
    setMsg({
      text: r.failedCount > 0 ? `${STR.prbUnassignedCount} ${bnNum(r.cancelled)} · ${STR.rvFailed} ${bnNum(r.failedCount)}` : `${STR.prbUnassignedCount} ${bnNum(r.cancelled)}`,
      tone: r.failedCount > 0 ? "danger" : "ok",
    });
    setSelected(new Set());
    refresh();
  }

  // --- render --------------------------------------------------------------

  const selectedWithRound = [...selected].filter((id) => byId.get(id)?.currentAssignmentId).length;

  function renderRow(p: AssignablePlanT): React.ReactElement {
    const st = stateOf(p);
    const isSel = selected.has(p.artifactId);
    const open = rowAction?.artifactId === p.artifactId ? rowAction : null;
    const meta: string[] = [];
    if (p.currentReviewerName) meta.push(p.currentReviewerName);
    if (p.roundNumber != null) meta.push(`${STR.reviewRound} ${bnNum(p.roundNumber)}`);
    if (p.assignedAt) meta.push(`${STR.prbAssignedOn} ${shortDate(p.assignedAt)}`);
    if (p.verdict) meta.push(`${reviewVerdictLabel(p.verdict)} ${shortDate(p.submittedAt)}`.trim());

    return (
      <Card key={p.artifactId} style={{ marginBottom: space(2) }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
          {st !== "signed" ? (
            <Pressable onPress={() => toggle(p.artifactId)} accessibilityRole="checkbox" accessibilityState={{ checked: isSel }} hitSlop={8}>
              <Badge text={isSel ? "✓" : "○"} tone={isSel ? "ok" : "muted"} />
            </Pressable>
          ) : null}
          <Body style={{ flex: 1, fontWeight: "700" }}>{rowLabel(p)}</Body>
          <Badge text={STATE_LABEL[st]()} tone={STATE_TONE[st]} />
        </View>
        <Muted style={{ marginTop: 4 }}>{meta.length > 0 ? meta.join(" · ") : STR.rvUnassigned}</Muted>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
          {st === "unassigned" ? (
            <Button title={STR.prbAssign} variant="secondary" onPress={() => openRowAction(p, "assign")} disabled={busy} />
          ) : null}
          {st === "awaiting" ? (
            <Button title={STR.prbChange} variant="secondary" onPress={() => openRowAction(p, "move")} disabled={busy} />
          ) : null}
          {st === "reviewed" ? (
            <Button title={STR.prbNewRound} variant="secondary" onPress={() => openRowAction(p, "newRound")} disabled={busy} />
          ) : null}
          {st === "awaiting" || st === "reviewed" ? (
            <Button title={STR.rvUnassign} variant="ghost" onPress={() => unassignRow(p)} disabled={busy} />
          ) : null}
          <Button title={STR.prbHistory} variant="ghost" onPress={() => navigation.navigate("ReviewThread", { artifactId: p.artifactId })} />
        </View>

        {open ? (
          <View style={{ marginTop: space(2) }}>
            <Select
              label={STR.prbGiveToOne}
              value={rowReviewer}
              options={teacherOptions.filter((o) => open.kind !== "move" || o.value !== p.currentReviewerId)}
              onChange={setRowReviewer}
              placeholder={STR.rvPickReviewer}
              searchable
            />
            <Button title={STR.prbConfirm} onPress={runRowAction} loading={busy} disabled={busy || !rowReviewer} style={{ marginTop: space(2) }} />
          </View>
        ) : null}
      </Card>
    );
  }

  // Group the page into chapters, keeping the server's order (chapter plan, then sessions).
  const groups: { key: string; head: AssignablePlanT; rows: AssignablePlanT[] }[] = [];
  for (const p of shown) {
    const k = chapterKey(p);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.rows.push(p);
    else groups.push({ key: k, head: p, rows: [p] });
  }

  return (
    <Screen scroll>
      {msg ? <Notice message={msg.text} tone={msg.tone} /> : null}

      {/* Who has how many — tap to show only that reviewer's plans */}
      <Muted>{STR.rvReviewer}</Muted>
      <ChipRow>
        <Chip label={STR.prbAllReviewers} selected={reviewerFilter === null} onPress={() => setReviewerFilter(null)} />
        {load.map((l) => (
          <Chip
            key={l.reviewerId}
            label={`${l.reviewerName} (${bnNum(l.openCount)})`}
            selected={reviewerFilter === l.reviewerId}
            onPress={() => setReviewerFilter(reviewerFilter === l.reviewerId ? null : l.reviewerId)}
          />
        ))}
      </ChipRow>

      <Muted style={{ marginTop: space(2) }}>{STR.prbState}</Muted>
      <ChipRow>
        <Chip label={STR.all} selected={state === null} onPress={() => setState(null)} />
        {ROW_STATES.map((s) => (
          <Chip key={s} label={STATE_LABEL[s]()} selected={state === s} onPress={() => setState(state === s ? null : s)} />
        ))}
      </ChipRow>

      <Muted style={{ marginTop: space(2) }}>{STR.prbType}</Muted>
      <ChipRow>
        <Chip label={STR.all} selected={docType === null} onPress={() => setDocType(null)} />
        {PLAN_DOC_TYPES.map((d) => (
          <Chip key={d} label={docTypeLabel(d)} selected={docType === d} onPress={() => setDocType(docType === d ? null : d)} />
        ))}
      </ChipRow>

      <Muted style={{ marginTop: space(2) }}>{STR.subject}</Muted>
      <ChipRow>
        <Chip label={STR.all} selected={subject === null} onPress={() => setSubject(null)} />
        {SUBJECTS.map((s) => (
          <Chip key={s} label={subjectLabel(s)} selected={subject === s} onPress={() => setSubject(subject === s ? null : s)} />
        ))}
      </ChipRow>

      <Muted style={{ marginTop: space(2) }}>{STR.classLevel}</Muted>
      <ChipRow>
        <Chip label={STR.all} selected={classLevel === null} onPress={() => setClassLevel(null)} />
        {CLASS_LEVELS.map((c) => (
          <Chip key={c} label={bnNum(c)} selected={classLevel === c} onPress={() => setClassLevel(classLevel === c ? null : c)} />
        ))}
      </ChipRow>

      <Divider />

      {/* Bulk: give the ticked plans to one reviewer, or unassign them */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(3), marginBottom: space(2) }}>
        <Pressable
          onPress={() => setSelected(new Set(visible.filter((p) => stateOf(p) !== "signed").map((p) => p.artifactId)))}
          accessibilityRole="button"
        >
          <Body style={{ fontWeight: "700" }}>{STR.rvSelectAll}</Body>
        </Pressable>
        <Pressable onPress={() => setSelected(new Set())} accessibilityRole="button">
          <Muted>{STR.rvClear}</Muted>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Muted>{`${bnNum(selected.size)} ${STR.qrSelected} · ${bnNum(visible.length)}`}</Muted>
      </View>
      {selected.size > 0 ? (
        <Card style={{ marginBottom: space(3) }}>
          <Select
            label={STR.prbGiveTo}
            value={bulkReviewer}
            options={teacherOptions}
            onChange={setBulkReviewer}
            placeholder={STR.rvPickReviewer}
            searchable
          />
          <Button
            title={`${STR.prbGiveSelected} (${bnNum(selected.size)})`}
            onPress={giveSelected}
            loading={busy}
            disabled={busy || !bulkReviewer}
            style={{ marginTop: space(2) }}
          />
          {selectedWithRound > 0 ? (
            <Button
              title={confirmUnassign ? `${STR.prbConfirm} — ${STR.prbUnassignSelected} (${bnNum(selectedWithRound)})` : `${STR.prbUnassignSelected} (${bnNum(selectedWithRound)})`}
              variant={confirmUnassign ? "danger" : "secondary"}
              onPress={unassignSelected}
              disabled={busy}
              style={{ marginTop: space(2) }}
            />
          ) : null}
        </Card>
      ) : null}

      {plansErr ? (
        <ErrorBanner message={friendlyError(plansErr)} onRetry={() => refetchPlans({ requestPolicy: "network-only" })} />
      ) : plansFetching && plans.length === 0 ? (
        <Loader label={STR.loading} />
      ) : visible.length === 0 ? (
        <EmptyState message={STR.empty} />
      ) : (
        <>
          {groups.map((g) => (
            <View key={g.key} style={{ marginBottom: space(3) }}>
              <H2>{chapterTitle(g.head)}</H2>
              {g.rows.map(renderRow)}
            </View>
          ))}
          {visible.length > shown.length ? (
            <Button
              title={`${STR.loadMore} (${bnNum(visible.length - shown.length)})`}
              variant="secondary"
              onPress={() => setLimit((n) => n + PAGE)}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}
