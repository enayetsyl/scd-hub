/**
 * ReviewSupervisionScreen (RS-4, .claude/plans/review-supervision.md) - "পর্যালোচনা তদারকি".
 *
 * What the Principal (and, by a per-person grant, the deputy) opens every day: the batch's
 * progress against its target, the projected finish, a daily chart, and one card per reviewer
 * (worst status first). Tapping a reviewer opens ReviewSupervisionReviewer, where tasks are moved,
 * cancelled, added or re-dated.
 *
 * Reads need review_program:supervise; the admin card (create program, target date, adopt open
 * rounds, rebuild history) only shows for review_program:manage. Every write is re-gated on the
 * server, so hiding the card is a courtesy.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, RefreshControl, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  REVIEW_PROGRAMS_QUERY,
  REVIEW_OVERVIEW_QUERY,
  REVIEW_SERIES_QUERY,
  CREATE_REVIEW_PROGRAM,
  UPDATE_REVIEW_BATCH,
  ADOPT_REVIEW_ROUNDS,
  BACKFILL_REVIEW_SNAPSHOTS,
  type ReviewerRowT,
} from "../../graphql/reviewSupervision";
import type { ReviewStackParamList } from "../../navigation/types";
import { useAuth } from "../../auth/AuthContext";
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
  Field,
  EmptyState,
  wrapRowText,
} from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { DateField } from "../../components/DateField";
import { ReviewSupervisionChart } from "../../components/ReviewSupervisionChart";
import { ReviewChangesList } from "../../components/ReviewChangesList";
import { dateKey } from "../../lib/dates";
import { useToast } from "../../state/ToastContext";
import { useConfirm } from "../../state/ConfirmContext";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { fill, fraction, minutesLabel, sortReviewers, statusLabel, statusTone } from "../../lib/reviewSupervision";
import { useColors } from "../../theme";
import { space, radius } from "../../theme/tokens";

type Props = NativeStackScreenProps<ReviewStackParamList, "ReviewSupervision">;

/** A label over a value; wraps in a row so three fit a 360 dp card and the rest drop below. */
export function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" }): React.ReactElement {
  const colors = useColors();
  return (
    <View style={{ minWidth: 92, flexGrow: 1, flexBasis: 92, marginTop: space(2) }}>
      <Muted>{label}</Muted>
      <Body style={{ fontWeight: "700", color: tone === "danger" ? colors.error : undefined }}>{value}</Body>
    </View>
  );
}

export function ProgressBar({ ratio }: { ratio: number }): React.ReactElement {
  const colors = useColors();
  return (
    <View style={{ height: 12, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, overflow: "hidden" }}>
      <View
        style={{
          height: "100%",
          width: `${ratio <= 0 ? 0 : Math.max(2, ratio * 100)}%`,
          backgroundColor: colors.primary,
        }}
      />
    </View>
  );
}

/** The Dhaka calendar day (YYYY-MM-DD) of an ISO instant; Dhaka is UTC+6 all year. */
const dhakaKey = (iso: string): string => new Date(Date.parse(iso) + 6 * 3_600_000).toISOString().slice(0, 10);

const pctLabel = (r: number): string => `${bnNum(Math.round(r * 100))}%`;

export default function ReviewSupervisionScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const canManage = can("review_program:manage");
  const toast = useToast();
  const { confirmAction } = useConfirm();

  const [programsQ, refetchPrograms] = useQuery({ query: REVIEW_PROGRAMS_QUERY, requestPolicy: "cache-and-network" });
  const programs = programsQ.data?.reviewPrograms ?? [];
  const [programId, setProgramId] = useState<string | null>(null);
  const [batch, setBatch] = useState<number | null>(null);

  // Default to the newest program's first batch; keep the pick across refetches while it still exists.
  // The program just created: until the refetch brings it in, do not fall back to the first program.
  const justCreated = useRef<string | null>(null);
  useEffect(() => {
    if (programs.length === 0) return;
    if (programId && programId === justCreated.current) {
      if (!programs.some((p) => p.id === programId)) return;
      justCreated.current = null;
    }
    const prog = programs.find((p) => p.id === programId) ?? programs[0]!;
    if (prog.id !== programId) setProgramId(prog.id);
    if (batch == null || !prog.batches.some((b) => b.batch === batch)) {
      const first = [...prog.batches].sort((a, b) => a.batch - b.batch)[0];
      setBatch(first ? first.batch : null);
    }
  }, [programs, programId, batch]);

  const program = programs.find((p) => p.id === programId) ?? null;
  const batchInfo = program?.batches.find((b) => b.batch === batch) ?? null;
  const ready = !!program && batch != null;

  const [overviewQ, refetchOverview] = useQuery({
    query: REVIEW_OVERVIEW_QUERY,
    variables: { programId: programId ?? "", batch: batch ?? 0 },
    pause: !ready,
    requestPolicy: "cache-and-network",
  });
  const [seriesQ, refetchSeries] = useQuery({
    query: REVIEW_SERIES_QUERY,
    variables: { programId: programId ?? "", batch: batch ?? 0, perReviewer: true },
    pause: !ready,
    requestPolicy: "cache-and-network",
  });

  const reload = (): void => {
    setReloadKey((k) => k + 1);
    refetchPrograms({ requestPolicy: "network-only" });
    if (ready) {
      refetchOverview({ requestPolicy: "network-only" });
      refetchSeries({ requestPolicy: "network-only" });
    }
  };
  const { refreshing, onRefresh } = usePullRefresh(
    programsQ.fetching || overviewQ.fetching || seriesQ.fetching,
    reload,
  );

  const ov = overviewQ.data?.reviewProgramOverview ?? null;
  const reviewers = useMemo(() => sortReviewers(ov?.reviewers ?? []), [ov]);
  const t = ov?.totals;
  const proj = ov?.batchProjection;
  const totalCount = t ? t.plansTotal + t.questionsTotal : 0;
  const today = dateKey();
  // The server computes the pace needed (holiday-aware); null with work left and a past target = the date has gone.
  const need = (remaining: number, perDay: number | null): string =>
    perDay != null ? minutesLabel(perDay) : ov?.targetDate && ov.targetDate < today && remaining > 0 ? STR.rspTargetPassed : "-";
  const [reloadKey, setReloadKey] = useState(0);

  // ---- admin ----
  const [newName, setNewName] = useState("");
  const [newBatchName, setNewBatchName] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [targetDraft, setTargetDraft] = useState("");
  const [startDraft, setStartDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [, createProgram] = useMutation(CREATE_REVIEW_PROGRAM);
  const [, updateBatch] = useMutation(UPDATE_REVIEW_BATCH);
  const [, adopt] = useMutation(ADOPT_REVIEW_ROUNDS);
  const [, backfill] = useMutation(BACKFILL_REVIEW_SNAPSHOTS);

  useEffect(() => {
    setTargetDraft(batchInfo?.targetDate ?? "");
    setStartDraft(batchInfo?.startAt ? dhakaKey(batchInfo.startAt) : "");
  }, [batchInfo?.targetDate, batchInfo?.startAt, programId, batch]);

  async function doCreate(): Promise<void> {
    if (!newName.trim() || !newStart || busy) return;
    setBusy("create");
    const res = await createProgram({
      name: newName.trim(),
      batches: [
        {
          batch: 1,
          name: newBatchName.trim() || `${STR.rspBatch} ${bnNum(1)}`,
          startAt: `${newStart}T00:00:00+06:00`,
          targetDate: newTarget || null,
        },
      ],
    });
    setBusy(null);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.rspCreated, "ok");
    setNewName("");
    setNewBatchName("");
    setNewStart("");
    setNewTarget("");
    const createdId = res.data?.createReviewProgram.id ?? null;
    justCreated.current = createdId;
    setProgramId(createdId);
    setBatch(null);
    refetchPrograms({ requestPolicy: "network-only" });
  }

  async function doSaveTarget(): Promise<void> {
    if (!program || batch == null || busy || !startDraft) return;
    setBusy("target");
    const res = await updateBatch({
      programId: program.id,
      batch,
      targetDate: targetDraft || null,
      startAt: `${startDraft}T00:00:00+06:00`,
    });
    setBusy(null);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.rspDatesSaved, "ok");
    reload();
  }

  async function doAdopt(): Promise<void> {
    if (!program || batch == null || busy) return;
    if (!(await confirmAction({ title: STR.rspAdoptTitle, message: STR.rspAdoptHint, confirmLabel: STR.rspAdoptYes, tone: "primary" }))) return;
    setBusy("adopt");
    const res = await adopt({ programId: program.id, batch });
    setBusy(null);
    if (res.error || !res.data) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    const r = res.data.adoptOpenReviewRounds;
    toast.show(
      fill(STR.rspAdoptResult, { a: bnNum(r.created), b: bnNum(r.alreadyTasks), c: bnNum(r.creditedLeftovers) }),
      "ok",
    );
    reload();
  }

  async function doBackfill(): Promise<void> {
    if (!program || batch == null || busy) return;
    if (!(await confirmAction({ title: STR.rspBackfillTitle, message: STR.rspBackfillHint, confirmLabel: STR.rspBackfillYes, tone: "primary" }))) return;
    setBusy("backfill");
    const res = await backfill({ programId: program.id, batch });
    setBusy(null);
    if (res.error || !res.data) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(fill(STR.rspBackfilled, { n: bnNum(res.data.backfillReviewSnapshots) }), "ok");
    reload();
  }

  function openReviewer(r: ReviewerRowT): void {
    if (!program || batch == null) return;
    navigation.navigate("ReviewSupervisionReviewer", {
      programId: program.id,
      batch,
      reviewerId: r.reviewerId,
      reviewerName: r.reviewerName,
    });
  }

  const adminCard = canManage ? (
    <Card>
      <H2>{STR.rspAdmin}</H2>
      <Muted>{STR.rspAdminHint}</Muted>
      {program && batch != null ? (
        <View style={{ marginTop: space(3) }}>
          <DateField label={STR.rspStartAt} value={startDraft} onChange={setStartDraft} />
          <DateField label={STR.rspTarget} value={targetDraft} onChange={setTargetDraft} />
          <Button
            title={STR.rspSaveDates}
            variant="secondary"
            onPress={() => void doSaveTarget()}
            loading={busy === "target"}
            disabled={
              !!busy ||
              !startDraft ||
              (targetDraft === (batchInfo?.targetDate ?? "") && startDraft === (batchInfo?.startAt ? dhakaKey(batchInfo.startAt) : ""))
            }
          />
          <View style={{ height: space(4) }} />
          <Button title={STR.rspAdopt} onPress={() => void doAdopt()} loading={busy === "adopt"} disabled={!!busy || !batchInfo?.startAt} />
          <Muted style={{ marginTop: space(1), marginBottom: space(3) }}>{batchInfo?.startAt ? STR.rspAdoptHint : STR.rspNeedStartHint}</Muted>
          <Button title={STR.rspBackfill} variant="secondary" onPress={() => void doBackfill()} loading={busy === "backfill"} disabled={!!busy} />
          <Muted style={{ marginTop: space(1) }}>{STR.rspBackfillHint}</Muted>
        </View>
      ) : null}
      <View style={{ marginTop: space(4) }}>
        <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.rspCreateProgram}</Body>
        <Field label={STR.rspProgramName} value={newName} onChangeText={setNewName} autoCapitalize="sentences" />
        <Field label={STR.rspBatchName} value={newBatchName} onChangeText={setNewBatchName} autoCapitalize="sentences" />
        <DateField label={STR.rspStartAt} value={newStart} onChange={setNewStart} error={newStart ? undefined : STR.rspStartRequired} />
        <DateField label={STR.rspTarget} value={newTarget} onChange={setNewTarget} />
        <Button
          title={STR.create}
          onPress={() => void doCreate()}
          loading={busy === "create"}
          disabled={!!busy || !newName.trim() || !newStart}
        />
      </View>
    </Card>
  ) : null;

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <QueryGate
        result={programsQ}
        onRetry={reload}
        isEmpty={programs.length === 0}
        empty={
          <View>
            <EmptyState message={STR.rspNoProgram} />
            {canManage ? <Muted style={{ marginBottom: space(3) }}>{STR.rspNoProgramManage}</Muted> : null}
            {adminCard}
          </View>
        }
      >
        {/* Program + batch pickers (one program is the normal case, so its chips only show for several). */}
        {programs.length > 1 ? (
          <ChipRow>
            {programs.map((p) => (
              <Chip
                key={p.id}
                label={p.name}
                selected={p.id === programId}
                onPress={() => {
                  setProgramId(p.id);
                  setBatch(null);
                }}
              />
            ))}
          </ChipRow>
        ) : program ? (
          <H2>{program.name}</H2>
        ) : null}
        {program && program.batches.length > 1 ? (
          <ChipRow>
            {[...program.batches]
              .sort((a, b) => a.batch - b.batch)
              .map((b) => (
                <Chip
                  key={b.batch}
                  label={b.name || `${STR.rspBatch} ${bnNum(b.batch)}`}
                  selected={b.batch === batch}
                  onPress={() => setBatch(b.batch)}
                />
              ))}
          </ChipRow>
        ) : null}

        <QueryGate results={[overviewQ, seriesQ]} onRetry={reload}>
          {ov && t && proj ? (
            <>
              {/* Batch header */}
              <Card>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
                  <Body style={[wrapRowText, { fontWeight: "700" }]}>
                    {batchInfo?.name || `${STR.rspBatch} ${bnNum(ov.batch)}`}
                  </Body>
                  {t.tasks > 0 ? <Badge text={statusLabel(proj.status)} tone={statusTone(proj.status)} /> : null}
                </View>
                {t.tasks === 0 ? <Muted style={{ marginTop: space(2) }}>{STR.rspNoTasksYet}</Muted> : null}
                {t.tasks > 0 ? (
                <>
                <View style={{ marginTop: space(3) }}>
                  <ProgressBar ratio={fraction(t.minutesDone, t.minutesTotal)} />
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(1), gap: space(2) }}>
                  <Muted>
                    {pctLabel(fraction(t.minutesDone, t.minutesTotal))} · {STR.rspWeighted}
                  </Muted>
                  <Muted>
                    {bnNum(t.tasksDone)}/{bnNum(t.tasks)} {STR.rspTasks}
                  </Muted>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space(3) }}>
                  <Stat label={STR.rspTarget} value={ov.targetDate ? bnNum(ov.targetDate) : STR.rspNoTarget} />
                  <Stat
                    label={STR.rspProjected}
                    value={proj.projectedFinishKey ? bnNum(proj.projectedFinishKey) : STR.rspNoProjection}
                    tone={proj.status === "FAR_BEHIND" ? "danger" : undefined}
                  />
                  <Stat label={STR.rspToday} value={bnNum(proj.doneToday)} />
                  <Stat label={STR.rspThisWeek} value={bnNum(proj.doneThisWeek)} />
                  <Stat label={STR.rspPace} value={proj.pacePerDay != null ? minutesLabel(proj.pacePerDay) : "-"} />
                  <Stat
                    label={STR.rspNeed}
                    value={need(t.minutesRemaining, proj.requiredPacePerDay)}
                    tone={proj.pacePerDay != null && proj.requiredPacePerDay != null && proj.requiredPacePerDay > proj.pacePerDay ? "danger" : undefined}
                  />
                  <Stat label={STR.rspRemaining} value={minutesLabel(t.minutesRemaining)} />
                  {proj.daysLeft != null ? (
                    <Stat label={STR.rspDaysLeft} value={bnNum(Math.ceil(proj.daysLeft))} />
                  ) : null}
                  <Stat label={STR.rspChanges} value={bnNum(t.changes)} />
                </View>
                </>
                ) : null}
              </Card>

              {/* Chart */}
              <Card>
                <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.rspChartTitle}</Body>
                <ReviewSupervisionChart points={seriesQ.data?.reviewProgressSeries ?? []} totalCount={totalCount} />
              </Card>

              {/* Reviewers, worst first */}
              <H2>{STR.rspReviewers}</H2>
              <Muted style={{ marginBottom: space(2) }}>{STR.rspReviewersHint}</Muted>
              {reviewers.length === 0 ? (
                <EmptyState message={STR.rspNoReviewers} />
              ) : (
                reviewers.map((r) => (
                  <Card key={r.reviewerId} onPress={() => openReviewer(r)}>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
                      <Body style={[wrapRowText, { fontWeight: "700" }]}>{r.reviewerName ?? "-"}</Body>
                      <Badge text={statusLabel(r.status)} tone={statusTone(r.status)} />
                    </View>
                    <View style={{ marginTop: space(2) }}>
                      <ProgressBar ratio={fraction(r.minutesDone, r.minutesTotal)} />
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space(3) }}>
                      <Stat label={STR.rspAssigned} value={`${bnNum(r.tasksDone)}/${bnNum(r.tasks)} ${STR.rspTasks}`} />
                      <Stat label={STR.rspToday} value={bnNum(r.doneToday)} />
                      <Stat label={STR.rspThisWeek} value={bnNum(r.doneThisWeek)} />
                      <Stat label={STR.rspRemaining} value={minutesLabel(r.minutesRemaining)} />
                      <Stat label={STR.rspPace} value={r.pacePerDay != null ? minutesLabel(r.pacePerDay) : "-"} />
                      <Stat label={STR.rspNeed} value={need(r.minutesRemaining, r.requiredPacePerDay)} />
                      <Stat
                        label={STR.rspProjected}
                        value={r.projectedFinishKey ? bnNum(r.projectedFinishKey) : STR.rspNoProjection}
                      />
                      <Stat label={STR.rspPlans} value={`${bnNum(r.plansDone)}/${bnNum(r.plansTotal)}`} />
                      <Stat label={STR.rspQuestions} value={`${bnNum(r.questionsDone)}/${bnNum(r.questionsTotal)}`} />
                      <Stat label={STR.rspChanges} value={bnNum(r.changes)} />
                      <Stat label={STR.rspPeriods} value={r.weeklyPeriods != null ? bnNum(r.weeklyPeriods) : "-"} />
                    </View>
                    <Pressable onPress={() => openReviewer(r)} accessibilityRole="button" style={{ marginTop: space(2) }}>
                      <Body style={{ fontWeight: "700" }}>{STR.rspOpen} ›</Body>
                    </Pressable>
                  </Card>
                ))
              )}

              {/* Changes the reviewers asked for, by day - below the reviewer cards */}
              <Card>
                {program && batch != null ? <ReviewChangesList programId={program.id} batch={batch} reloadKey={reloadKey} /> : null}
              </Card>
            </>
          ) : null}
        </QueryGate>

        {/* "আরও কাজ দিন": the chunk size, the release rule and each reviewer's ladder. */}
        {program ? (
          <Card onPress={() => navigation.navigate("ReviewSelfServe", { programId: program.id })}>
            <Body style={{ fontWeight: "700" }}>{STR.rssNav}</Body>
            <Muted style={{ marginTop: 2 }}>{STR.rssSubtitle}</Muted>
          </Card>
        ) : null}

        {adminCard}
      </QueryGate>
    </Screen>
  );
}
