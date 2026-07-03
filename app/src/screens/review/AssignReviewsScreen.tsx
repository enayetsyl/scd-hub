/**
 * AssignReviewsScreen — bulk reviewer assignment + Principal load overview.
 *
 * The one-file-at-a-time review-thread assign was tedious for handing many plans to a
 * single teacher. Here the Principal/Office: sees per-reviewer open counts, picks ONE
 * teacher, multi-selects plans (filterable; "select all"), and assigns them in a single
 * call. Gated content:assign_review (same as assignPlanReview).
 */
import React, { useMemo, useState } from "react";
import { View, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { SUBJECTS, CLASS_LEVELS, REVIEW_STATUSES } from "@scd/shared";
import {
  ASSIGNABLE_PLANS,
  CANCEL_PLAN_REVIEW,
  REVIEWER_ASSIGNMENT_LOAD,
  ASSIGN_PLAN_REVIEW_BULK,
  TEACHERS_QUERY,
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
import { STR, subjectLabel, classLevelLabel, reviewStatusLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ReviewStackParamList, "AssignReviews">;

function planTitle(p: AssignablePlanT): string {
  const head = `${subjectLabel(p.subject)} · ${classLevelLabel(p.classLevel)} · ${p.anchorWord} ${bnNum(p.addressNumber)}`;
  return p.title ? `${head} · ${p.title}` : head;
}

export default function AssignReviewsScreen(_props: Props): React.ReactElement {
  const [{ data: plansData, fetching: plansFetching, error: plansErr }, refetchPlans] = useQuery({ query: ASSIGNABLE_PLANS });
  const [{ data: loadData, fetching: loadFetching }, refetchLoad] = useQuery({ query: REVIEWER_ASSIGNMENT_LOAD });
  const [{ data: teacherData }] = useQuery({ query: TEACHERS_QUERY });
  const [, assignBulk] = useMutation(ASSIGN_PLAN_REVIEW_BULK);
  const [, cancelReview] = useMutation(CANCEL_PLAN_REVIEW);

  const plans = plansData?.assignablePlans ?? [];
  const load = loadData?.reviewerAssignmentLoad ?? [];
  const teacherOptions = (teacherData?.teachers ?? []).map((t) => ({ label: t.name, value: t.id, hint: t.phone ?? undefined }));

  const [reviewerId, setReviewerId] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [unassignBusy, setUnassignBusy] = useState(false);
  const [unassignId, setUnassignId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "danger" } | null>(null);

  const visible = useMemo(
    () =>
      plans.filter(
        (p) =>
          (!subject || p.subject === subject) &&
          (classLevel == null || p.classLevel === classLevel) &&
          (!status || p.reviewStatus === status) &&
          (!unassignedOnly || !p.currentReviewerId),
      ),
    [plans, subject, classLevel, status, unassignedOnly],
  );
  const reviewerPlans = useMemo(
    () => plans.filter((p) => Boolean(reviewerId && p.currentReviewerId === reviewerId && p.currentAssignmentId)),
    [plans, reviewerId],
  );

  const statusTone = (s: string): "ok" | "brand" | "muted" =>
    s === "gold" ? "ok" : s === "reviewed" ? "brand" : "muted";

  function toggle(id: string): void {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAllVisible(): void {
    setSelected(new Set(visible.map((p) => p.artifactId)));
  }

  async function onAssign(): Promise<void> {
    setMsg(null);
    if (!reviewerId) return setMsg({ text: STR.rvPickReviewerAndPlan, tone: "danger" });
    const ids = [...selected];
    if (ids.length === 0) return setMsg({ text: STR.rvPickReviewerAndPlan, tone: "danger" });
    setBusy(true);
    const res = await assignBulk({ artifactIds: ids, reviewerId });
    setBusy(false);
    if (res.error || !res.data?.assignPlanReviewBulk) {
      setMsg({ text: friendlyError(res.error), tone: "danger" });
      return;
    }
    const r = res.data.assignPlanReviewBulk;
    setMsg({
      text: r.failedCount > 0 ? `${STR.rvAssigned} ${bnNum(r.assignedCount)} · ${STR.rvFailed} ${bnNum(r.failedCount)}` : `${STR.rvAssigned} ${bnNum(r.assignedCount)}`,
      tone: r.failedCount > 0 ? "danger" : "ok",
    });
    setSelected(new Set());
    refetchPlans({ requestPolicy: "network-only" });
    refetchLoad({ requestPolicy: "network-only" });
  }

  async function onUnassign(assignmentId: string): Promise<void> {
    if (unassignBusy) return;
    setUnassignBusy(true);
    setUnassignId(assignmentId);
    setMsg(null);
    const res = await cancelReview({ assignmentId });
    setUnassignBusy(false);
    if (res.error || !res.data?.cancelPlanReview) {
      setMsg({ text: friendlyError(res.error), tone: "danger" });
      return;
    }
    setMsg({ text: STR.rvUnassignedDone, tone: "ok" });
    setUnassignId(null);
    refetchPlans({ requestPolicy: "network-only" });
    refetchLoad({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      {/* Per-reviewer load overview */}
      <H2>{STR.rvAssignLoad}</H2>
      {loadFetching && load.length === 0 ? (
        <Loader label={STR.loading} />
      ) : load.length === 0 ? (
        <EmptyState message={STR.rvNoLoad} />
      ) : (
        load.map((l) => (
          <Card key={l.reviewerId} onPress={() => setReviewerId(l.reviewerId)} style={{ marginBottom: space(2) }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ flex: 1, fontWeight: "600" }}>{l.reviewerName}</Body>
              <Badge text={`${bnNum(l.openCount)} ${STR.rvAssignedShort}`} tone="brand" />
            </View>
            <Muted>{`${bnNum(l.assignedCount)} ${STR.rvAwaiting} · ${bnNum(l.submittedCount)} ${STR.rvDecidedShort}`}</Muted>
          </Card>
        ))
      )}

      <Divider />

      <H2>{STR.rvReviewerAssignments}</H2>
      {!reviewerId ? (
        <Muted>{STR.rvPickReviewer}</Muted>
      ) : reviewerPlans.length === 0 ? (
        <EmptyState message={STR.rvNoLoad} />
      ) : (
        reviewerPlans.map((p) => (
          <Card key={p.currentAssignmentId ?? p.artifactId}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
              <Body style={{ flex: 1, fontWeight: "700" }}>{planTitle(p)}</Body>
              <Badge text={reviewStatusLabel(p.reviewStatus)} tone={statusTone(p.reviewStatus)} />
            </View>
            <Muted style={{ marginTop: 4 }}>
              {p.roundStatus ? `${p.roundStatus} · ${STR.rvAssignedTo}: ${p.currentReviewerName ?? STR.rvReviewer}` : STR.rvAssignedTo}
            </Muted>
            <Button
              title={unassignBusy && unassignId === p.currentAssignmentId ? STR.saving : STR.rvUnassign}
              onPress={() => p.currentAssignmentId && onUnassign(p.currentAssignmentId)}
              loading={unassignBusy && unassignId === p.currentAssignmentId}
              variant="secondary"
              style={{ marginTop: space(2) }}
              disabled={unassignBusy || !p.currentAssignmentId}
            />
          </Card>
        ))
      )}

      <Divider />

      {/* Bulk assign */}
      <H2>{STR.rvAssignTitle}</H2>
      {msg ? <Notice message={msg.text} tone={msg.tone} /> : null}

      <Select
        label={STR.rvReviewer}
        value={reviewerId}
        options={teacherOptions}
        onChange={setReviewerId}
        placeholder={STR.rvPickReviewer}
        searchable
      />

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
      <Muted style={{ marginTop: space(2) }}>{STR.statusFilter}</Muted>
      <ChipRow>
        <Chip label={STR.all} selected={status === null} onPress={() => setStatus(null)} />
        {REVIEW_STATUSES.map((s) => (
          <Chip key={s} label={reviewStatusLabel(s)} selected={status === s} onPress={() => setStatus(status === s ? null : s)} />
        ))}
      </ChipRow>
      <ChipRow>
        <Chip label={STR.rvUnassignedOnly} selected={unassignedOnly} onPress={() => setUnassignedOnly((v) => !v)} />
      </ChipRow>

      <View style={{ flexDirection: "row", alignItems: "center", gap: space(3), marginVertical: space(2) }}>
        <Pressable onPress={selectAllVisible} accessibilityRole="button">
          <Body style={{ fontWeight: "700", color: undefined }}>{STR.rvSelectAll}</Body>
        </Pressable>
        <Pressable onPress={() => setSelected(new Set())} accessibilityRole="button">
          <Muted>{STR.rvClear}</Muted>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Muted>{`${bnNum(selected.size)} / ${bnNum(visible.length)}`}</Muted>
      </View>

      <Button
        title={`${STR.rvAssignSelected} (${bnNum(selected.size)})`}
        onPress={onAssign}
        loading={busy}
        disabled={busy || !reviewerId || selected.size === 0}
      />

      <View style={{ height: space(2) }} />

      {plansErr ? (
        <ErrorBanner message={friendlyError(plansErr)} onRetry={() => refetchPlans({ requestPolicy: "network-only" })} />
      ) : plansFetching && plans.length === 0 ? (
        <Loader label={STR.loading} />
      ) : visible.length === 0 ? (
        <EmptyState message={STR.empty} />
      ) : (
        visible.map((p) => {
          const isSel = selected.has(p.artifactId);
          return (
            <Card key={p.artifactId} onPress={() => toggle(p.artifactId)}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                <Badge text={isSel ? "✓" : "○"} tone={isSel ? "ok" : "muted"} />
                <Body style={{ flex: 1, fontWeight: "700" }}>{planTitle(p)}</Body>
                <Badge text={reviewStatusLabel(p.reviewStatus)} tone={statusTone(p.reviewStatus)} />
              </View>
              <Muted style={{ marginTop: 4 }}>
                {p.currentReviewerName
                  ? `${STR.rvAssignedTo}: ${p.currentReviewerName}`
                  : STR.rvUnassigned}
              </Muted>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
