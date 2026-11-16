/**
 * ReviewSupervisionReviewerScreen (RS-4) - one reviewer's page under "পর্যালোচনা তদারকি".
 *
 * Her tasks by book and chapter with plan/question progress and a due date, a daily chart of her
 * own work, and the doors to the rounds where changes were asked. For review_program:manage
 * holders each task has: give to someone else, cancel, change the due date; and the page can add a
 * chapter. Every action asks first, toasts the result and refetches. "Moved" only carries rounds
 * nobody has touched - finished ones stay credited to whoever did them (the server enforces it).
 */
import React, { useMemo, useState } from "react";
import { View, RefreshControl } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { SUBJECTS, CLASS_LEVELS } from "@scd/shared";
import {
  REVIEW_TASKS_QUERY,
  REVIEW_OVERVIEW_QUERY,
  REVIEW_SERIES_QUERY,
  MOVE_REVIEW_TASK,
  CANCEL_REVIEW_TASK,
  ADD_REVIEW_TASK,
  SET_REVIEW_TASK_DUE,
  type ReviewTaskT,
} from "../../graphql/reviewSupervision";
import { TEACHERS_QUERY } from "../../graphql/operations";
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
  Select,
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
import { STR, bnNum, subjectLabel, classLevelLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { fill, fraction, latinDigits, minutesLabel, statusLabel, statusTone } from "../../lib/reviewSupervision";
import { space } from "../../theme/tokens";
import { ProgressBar, Stat } from "./ReviewSupervisionScreen";

type Props = NativeStackScreenProps<ReviewStackParamList, "ReviewSupervisionReviewer">;

const isLive = (t: ReviewTaskT): boolean => t.status === "OPEN" || t.status === "SUBMITTED";

function taskStatus(t: ReviewTaskT): { text: string; tone: "ok" | "muted" | "brand" } {
  if (t.status === "DONE") return { text: STR.rspTaskDone, tone: "ok" };
  if (t.status === "CANCELLED") return { text: STR.rspTaskCancelled, tone: "muted" };
  return { text: `${pct(t)}`, tone: "brand" };
}

function pct(t: ReviewTaskT): string {
  return `${bnNum(Math.round(fraction(t.progress.minutesDone, t.progress.minutesTotal) * 100))}%`;
}

const STANDARD_ANCHORS = ["পাঠ", "অধ্যায়", "Unit", "অংশ"];

/** The history line's wording: what happened, with people by NAME. System notes (ids, counts) are not shown. */
function actionLabel(action: string): string {
  return action === "adopted" ? STR.rspActAdopted
    : action === "moved" ? STR.rspActMoved
    : action === "merged" ? STR.rspActMerged
    : action === "cancelled" ? STR.rspActCancelled
    : action === "added" || action === "created" ? STR.rspActAdded
    : action === "due" ? STR.rspActDue
    : action;
}

function TaskCard({
  task,
  canManage,
  teachers,
  nameOf,
  onChanged,
}: {
  task: ReviewTaskT;
  canManage: boolean;
  teachers: { label: string; value: string }[];
  nameOf: (id: string | null) => string;
  onChanged: () => void;
}): React.ReactElement {
  const toast = useToast();
  const { confirmAction } = useConfirm();
  const [panel, setPanel] = useState<"move" | "due" | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [due, setDue] = useState(task.dueKey ?? "");
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, move] = useMutation(MOVE_REVIEW_TASK);
  const [, cancel] = useMutation(CANCEL_REVIEW_TASK);
  const [, setDueM] = useMutation(SET_REVIEW_TASK_DUE);

  const p = task.progress;
  const st = taskStatus(task);
  const title = `${subjectLabel(task.subject)} · ${classLevelLabel(task.classLevel)} · ${task.anchorWord} ${bnNum(task.chapter)}`;
  const options = teachers.filter((o) => o.value !== task.reviewerId);

  async function doMove(): Promise<void> {
    if (!toId || busy) return;
    const ok = await confirmAction({ title: STR.rspMoveTitle, message: STR.rspMoveMsg, confirmLabel: STR.rspMoveYes, tone: "primary" });
    if (!ok) return;
    setBusy(true);
    const res = await move({ taskId: task.id, toReviewerId: toId, note: note.trim() || null });
    setBusy(false);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.rspMoved, "ok");
    setPanel(null);
    onChanged();
  }

  async function doCancel(): Promise<void> {
    if (busy) return;
    const ok = await confirmAction({ title: STR.rspCancelTitle, message: STR.rspCancelMsg, confirmLabel: STR.rspCancelYes, tone: "danger" });
    if (!ok) return;
    setBusy(true);
    const res = await cancel({ taskId: task.id, note: null });
    setBusy(false);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.rspCancelled, "ok");
    onChanged();
  }

  async function doDue(clear: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);
    const res = await setDueM({ taskId: task.id, dueKey: clear ? null : due || null });
    setBusy(false);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.rspDueSaved, "ok");
    if (clear) setDue("");
    setPanel(null);
    onChanged();
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
        <Body style={[wrapRowText, { fontWeight: "700" }]}>{title}</Body>
        <Badge text={st.text} tone={st.tone} />
      </View>
      <View style={{ marginTop: space(2) }}>
        <ProgressBar ratio={fraction(p.minutesDone, p.minutesTotal)} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space(3) }}>
        <Stat label={STR.rspPlans} value={`${bnNum(p.plansDone)}/${bnNum(p.plansTotal)}`} />
        <Stat label={STR.rspQuestions} value={`${bnNum(p.questionsDone)}/${bnNum(p.questionsTotal)}`} />
        <Stat label={STR.rspChanges} value={bnNum(p.changes)} />
        <Stat label={STR.rspRemaining} value={minutesLabel(p.minutesRemaining)} />
        <Stat label={STR.rspDue} value={task.dueKey ? bnNum(task.dueKey) : STR.rspNoDue} />
      </View>
      {p.doneByOthers > 0 ? (
        <Muted style={{ marginTop: space(1) }}>
          {fill(STR.rspDoneByOthers, { n: bnNum(p.doneByOthers) })}
        </Muted>
      ) : null}

      {task.history.length > 0 ? (
        <View style={{ marginTop: space(2) }}>
          <Button
            title={showHistory ? STR.rspHistoryHide : STR.rspHistoryShow}
            variant="ghost"
            onPress={() => setShowHistory((v) => !v)}
          />
          {showHistory
            ? task.history.map((h, i) => (
                <Muted key={`${h.at}-${i}`} style={{ marginTop: 2 }}>
                  {bnNum(h.at.slice(0, 10))} · {actionLabel(h.action)}
                  {h.fromReviewer || h.toReviewer ? ` · ${nameOf(h.fromReviewer)} → ${nameOf(h.toReviewer)}` : ""}
                  {h.note && (h.action === "moved" || h.action === "cancelled") ? ` · ${h.note}` : ""}
                </Muted>
              ))
            : null}
        </View>
      ) : null}

      {canManage && isLive(task) ? (
        <View style={{ marginTop: space(2) }}>
          <ChipRow>
            <Chip label={STR.rspMove} selected={panel === "move"} onPress={() => setPanel(panel === "move" ? null : "move")} />
            <Chip label={STR.rspSetDue} selected={panel === "due"} onPress={() => setPanel(panel === "due" ? null : "due")} />
          </ChipRow>

          {panel === "move" ? (
            <View style={{ marginTop: space(2) }}>
              <Select
                label={STR.rspMoveTo}
                value={toId}
                options={options}
                onChange={setToId}
                placeholder={STR.rspPickReviewer}
                searchable
              />
              <Field label={STR.rspMoveNote} value={note} onChangeText={setNote} autoCapitalize="sentences" />
              <Button title={STR.rspMoveYes} onPress={() => void doMove()} loading={busy} disabled={busy || !toId} />
            </View>
          ) : null}

          {panel === "due" ? (
            <View style={{ marginTop: space(2) }}>
              <DateField label={STR.rspDue} value={due} onChange={setDue} />
              <Button title={STR.save} onPress={() => void doDue(false)} loading={busy} disabled={busy || !due} />
              {task.dueKey ? (
                <View style={{ marginTop: space(2) }}>
                  <Button title={STR.rspClearDue} variant="secondary" onPress={() => void doDue(true)} disabled={busy} />
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={{ marginTop: space(2) }}>
            <Button title={STR.rspCancelTask} variant="danger" onPress={() => void doCancel()} disabled={busy} />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

export default function ReviewSupervisionReviewerScreen({ route, navigation }: Props): React.ReactElement {
  const { programId, batch, reviewerId, reviewerName } = route.params;
  const { can } = useAuth();
  const canManage = can("review_program:manage");
  const toast = useToast();
  const { confirmAction } = useConfirm();
  const [onlyOpen, setOnlyOpen] = useState(true);

  const [tasksQ, refetchTasks] = useQuery({
    query: REVIEW_TASKS_QUERY,
    variables: { programId, batch, reviewerId },
    requestPolicy: "cache-and-network",
  });
  const [overviewQ, refetchOverview] = useQuery({
    query: REVIEW_OVERVIEW_QUERY,
    variables: { programId, batch },
    requestPolicy: "cache-and-network",
  });
  const [seriesQ, refetchSeries] = useQuery({
    query: REVIEW_SERIES_QUERY,
    variables: { programId, batch, reviewerId },
    requestPolicy: "cache-and-network",
  });
  const [teachersQ] = useQuery({ query: TEACHERS_QUERY });
  // Every reviewer's tasks in the batch - the add-chapter chips list the batch's own anchor words (manage only).
  const [allTasksQ] = useQuery({
    query: REVIEW_TASKS_QUERY,
    variables: { programId, batch },
    pause: !canManage,
    requestPolicy: "cache-and-network",
  });
  const [reloadKey, setReloadKey] = useState(0);

  const reload = (): void => {
    setReloadKey((k) => k + 1);
    refetchTasks({ requestPolicy: "network-only" });
    refetchOverview({ requestPolicy: "network-only" });
    refetchSeries({ requestPolicy: "network-only" });
  };
  const { refreshing, onRefresh } = usePullRefresh(tasksQ.fetching || overviewQ.fetching || seriesQ.fetching, reload);

  const tasks = tasksQ.data?.reviewTasks ?? [];
  const shown = useMemo(
    () => (onlyOpen ? tasks.filter(isLive) : tasks).slice().sort((a, b) => (a.dueKey ?? "9999").localeCompare(b.dueKey ?? "9999")),
    [tasks, onlyOpen],
  );
  const row = overviewQ.data?.reviewProgramOverview.reviewers.find((r) => r.reviewerId === reviewerId) ?? null;
  const teachers = useMemo(
    () => (teachersQ.data?.teachers ?? []).map((t) => ({ label: t.name, value: t.id })),
    [teachersQ.data],
  );
  const totalCount = row ? row.plansTotal + row.questionsTotal : 0;
  const target = overviewQ.data?.reviewProgramOverview.targetDate ?? null;
  const needLabel =
    row?.requiredPacePerDay != null
      ? minutesLabel(row.requiredPacePerDay)
      : target && target < dateKey() && (row?.minutesRemaining ?? 0) > 0
        ? STR.rspTargetPassed
        : "-";
  // Names for the history: the batch's reviewers, then every teacher.
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of teachersQ.data?.teachers ?? []) m.set(t.id, t.name);
    for (const r of overviewQ.data?.reviewProgramOverview.reviewers ?? []) if (r.reviewerName) m.set(r.reviewerId, r.reviewerName);
    return m;
  }, [teachersQ.data, overviewQ.data]);
  const nameOf = (id: string | null): string => (id ? names.get(id) ?? "-" : "-");

  // ---- add a chapter ----
  const [subject, setSubject] = useState<string | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);
  const [anchorWord, setAnchorWord] = useState("");
  const [chapter, setChapter] = useState("");
  const [adding, setAdding] = useState(false);
  const [, addTask] = useMutation(ADD_REVIEW_TASK);

  // The book's own anchor word is already on the batch's tasks - offer it so it is not retyped.
  const knownAnchors = useMemo(() => {
    const set = new Set<string>(STANDARD_ANCHORS);
    for (const t of allTasksQ.data?.reviewTasks ?? tasks) set.add(t.anchorWord);
    return [...set];
  }, [allTasksQ.data, tasks]);

  async function doAdd(): Promise<void> {
    const chapterNo = latinDigits(chapter.trim());
    if (adding || !subject || classLevel == null || !anchorWord.trim() || !/^[0-9]+$/.test(chapterNo)) return;
    const ok = await confirmAction({ title: STR.rspAddTitle, message: STR.rspAddMsg, confirmLabel: STR.rspAddYes, tone: "primary" });
    if (!ok) return;
    setAdding(true);
    const res = await addTask({
      programId,
      batch,
      reviewerId,
      subject,
      classLevel,
      anchorWord: anchorWord.trim(),
      chapter: String(Number(chapterNo)),
    });
    setAdding(false);
    if (res.error || !res.data) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    const r = res.data.addReviewTask;
    toast.show(
      `${STR.rspAdded}: ${bnNum(r.assignedPlans)} ${STR.rspAddedPlans}, ${bnNum(r.assignedQuestions)} ${STR.rspAddedQuestions}` +
        (r.skippedPlans > 0 ? ` · ${bnNum(r.skippedPlans)} ${STR.rspAddedSkipped}` : ""),
      "ok",
    );
    setChapter("");
    reload();
  }

  const name = reviewerName ?? "-";

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <H2>{name}</H2>
      <Muted style={{ marginBottom: space(2) }}>{STR.rspReviewerTitle}</Muted>

      <QueryGate results={[tasksQ, overviewQ, seriesQ]} onRetry={reload}>
        {row ? (
          <Card>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
              <Body style={[wrapRowText, { fontWeight: "700" }]}>
                {bnNum(row.tasksDone)}/{bnNum(row.tasks)} {STR.rspTasks}
              </Body>
              <Badge text={statusLabel(row.status)} tone={statusTone(row.status)} />
            </View>
            <View style={{ marginTop: space(2) }}>
              <ProgressBar ratio={fraction(row.minutesDone, row.minutesTotal)} />
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space(3) }}>
              <Stat label={STR.rspToday} value={bnNum(row.doneToday)} />
              <Stat label={STR.rspThisWeek} value={bnNum(row.doneThisWeek)} />
              <Stat label={STR.rspRemaining} value={minutesLabel(row.minutesRemaining)} />
              <Stat label={STR.rspPace} value={row.pacePerDay != null ? minutesLabel(row.pacePerDay) : "-"} />
              <Stat label={STR.rspNeed} value={needLabel} />
              <Stat
                label={STR.rspProjected}
                value={row.projectedFinishKey ? bnNum(row.projectedFinishKey) : STR.rspNoProjection}
              />
              <Stat label={STR.rspPeriods} value={row.weeklyPeriods != null ? bnNum(row.weeklyPeriods) : "-"} />
            </View>
            <Muted style={{ marginTop: space(2) }}>{STR.rspLoadHint}</Muted>
          </Card>
        ) : null}

        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.rspChartTitle}</Body>
          <ReviewSupervisionChart points={seriesQ.data?.reviewProgressSeries ?? []} totalCount={totalCount} />
        </Card>

        <Card>
          <ReviewChangesList programId={programId} batch={batch} reviewerId={reviewerId} reloadKey={reloadKey} />
        </Card>

        <H2>{STR.rspTasks}</H2>
        <ChipRow>
          <Chip label={STR.rspFilterOpen} selected={onlyOpen} onPress={() => setOnlyOpen(true)} />
          <Chip label={STR.rspFilterAll} selected={!onlyOpen} onPress={() => setOnlyOpen(false)} />
        </ChipRow>
        {shown.length === 0 ? (
          <EmptyState message={STR.rspNoTasks} />
        ) : (
          shown.map((t) => <TaskCard key={t.id} task={t} canManage={canManage} teachers={teachers} nameOf={nameOf} onChanged={reload} />)
        )}

        {canManage ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.rspAddTask}</Body>
            <Muted style={{ marginBottom: space(2) }}>{`${STR.rspAddFor}: ${name}`}</Muted>
            <Muted>{STR.subject}</Muted>
            <ChipRow>
              {SUBJECTS.map((s) => (
                <Chip key={s} label={subjectLabel(s)} selected={subject === s} onPress={() => setSubject(subject === s ? null : s)} />
              ))}
            </ChipRow>
            <Muted>{STR.classLevel}</Muted>
            <ChipRow>
              {CLASS_LEVELS.map((c) => (
                <Chip key={c} label={bnNum(c)} selected={classLevel === c} onPress={() => setClassLevel(classLevel === c ? null : c)} />
              ))}
            </ChipRow>
            {knownAnchors.length > 0 ? (
              <ChipRow>
                {knownAnchors.map((a) => (
                  <Chip key={a} label={a} selected={anchorWord === a} onPress={() => setAnchorWord(a)} />
                ))}
              </ChipRow>
            ) : null}
            <Field label={STR.rspAnchor} value={anchorWord} onChangeText={setAnchorWord} autoCapitalize="sentences" />
            <Field label={STR.rspChapterNo} value={chapter} onChangeText={setChapter} keyboardType="numeric" />
            <Button
              title={STR.rspAddTask}
              onPress={() => void doAdd()}
              loading={adding}
              disabled={adding || !subject || classLevel == null || !anchorWord.trim() || !/^[0-9]+$/.test(latinDigits(chapter.trim()))}
            />
          </Card>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
