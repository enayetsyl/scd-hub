/**
 * LessonTrackerScreen (LP-2, D-#824) — one শাখা × subject's lesson plan in book order: each session
 * finished (date, teacher), continuing, skipped (a later one is finished) or not yet. The header is
 * the overview row: progress, pace, projection, lag. Pages by chapter (D-#761: bounded by the book).
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import type { TaskStatus } from "@scd/shared";
import {
  CREATE_LESSON_CATCHUP,
  LESSON_CATCHUP_SUGGESTION_QUERY,
  LESSON_SECTION_TRACKER_QUERY,
  type LessonCatchupT,
  type LessonTrackerSessionT,
} from "../../graphql/operations";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Field, Loader, Notice, ErrorBanner, EmptyState } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../state/ToastContext";
import { STR, bnNum, taskStatusLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePagedRows } from "../../lib/paging";
import { space } from "../../theme/tokens";
import type { ClassNotesStackParamList } from "../../navigation/types";
import { dayMonth, lastLine, paceLine, progressLine, reasonsLine } from "./lessonProgressUi";

type Props = NativeStackScreenProps<ClassNotesStackParamList, "LessonTracker">;

const STATUS: Record<string, { label: () => string; tone: "ok" | "info" | "danger" | "muted" }> = {
  FINISHED: { label: () => STR.lpDoneOn, tone: "ok" },
  STARTED: { label: () => STR.lpStarted, tone: "info" },
  SKIPPED: { label: () => STR.lpSkipped, tone: "danger" },
  NOT_YET: { label: () => STR.lpNotYet, tone: "muted" },
};

function SessionLine({ s }: { s: LessonTrackerSessionT }): React.ReactElement {
  const st = STATUS[s.status] ?? STATUS.NOT_YET;
  const dates = s.status === "FINISHED" ? s.finishedOn : s.startedOn;
  const teachers = [...new Set(s.teacherNames.filter(Boolean))];
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(2), marginTop: space(1) }}>
      <View style={{ flex: 1 }}>
        <Body>
          {STR.lpSession} {bnNum(s.sessionIndex)}/{bnNum(s.sessionOf)} · {s.titleBn}
        </Body>
        {dates.length > 0 ? (
          <Muted>
            {dates.map(dayMonth).join(", ")}
            {teachers.length ? ` · ${teachers.join(", ")}` : ""}
            {/* LP-4: how many on the roster missed it ("+" = some day had no attendance). */}
            {s.absentCount > 0 ? ` · ${bnNum(s.absentCount)}${s.attendanceComplete ? "" : "+"} ${STR.lpAbsentN}` : ""}
          </Muted>
        ) : null}
      </View>
      <Badge text={st.label()} tone={st.tone} />
    </View>
  );
}

const catchupStatus = (c: LessonCatchupT): { text: string; tone: "ok" | "info" | "muted" | "danger" } =>
  c.status === "CANCELLED"
    ? { text: STR.lpCatchupCancelled, tone: "muted" }
    : c.blockedReason && c.status !== "DONE"
      ? { text: STR.lpCatchupBlocked, tone: "danger" }
      : { text: taskStatusLabel(c.status as TaskStatus), tone: c.status === "DONE" ? "ok" : "info" };

/**
 * LP-4 (D-#827): the Office's corrective action — the catch-ups raised here (the task's live state)
 * and, for a caller who may (lesson_progress:view_all + work_board:assign), a pre-filled form that
 * puts a catch-up task on the teacher's work board.
 */
function CatchupCard({
  sectionId,
  subject,
  catchups,
  onCreated,
}: {
  sectionId: string;
  subject: string;
  catchups: LessonCatchupT[];
  onCreated: () => void;
}): React.ReactElement | null {
  const { can } = useAuth();
  const toast = useToast();
  const mayRaise = can("lesson_progress:view_all") && can("work_board:assign");
  const [open, setOpen] = useState(false);
  const [sugQ] = useQuery({ query: LESSON_CATCHUP_SUGGESTION_QUERY, variables: { sectionId, subject }, pause: !open });
  const sug = sugQ.data?.lessonCatchupSuggestion;
  const [assignee, setAssignee] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [, create] = useMutation(CREATE_LESSON_CATCHUP);

  // Seed the form once the suggestion arrives.
  const seeded = useRef(false);
  React.useEffect(() => {
    if (!sug || seeded.current) return;
    seeded.current = true;
    setAssignee(sug.assignees[0]?.userId ?? null);
    setTitle(sug.titleBn);
    setNotes(sug.notes);
    setDue(sug.dueKey);
  }, [sug]);

  if (!mayRaise && catchups.length === 0) return null;

  async function submit(): Promise<void> {
    if (!assignee) {
      toast.show(STR.lpCatchupAssignee, "danger");
      return;
    }
    setBusy(true);
    const res = await create({
      sectionId,
      subject,
      input: { assigneeUserId: assignee, titleBn: title.trim(), notes: notes.trim(), dueKey: due.trim(), sessionKeys: sug?.sessionKeys ?? [] },
    });
    setBusy(false);
    if (res.error || !res.data?.createLessonCatchup) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.lpCatchupCreated, "ok");
    setOpen(false);
    seeded.current = false;
    onCreated();
  }

  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.lpCatchupTitle}</Body>
      {catchups.length === 0 ? <Muted>{STR.lpCatchupNone}</Muted> : null}
      {catchups.map((c) => {
        const st = catchupStatus(c);
        return (
          <View key={c.id} style={{ flexDirection: "row", alignItems: "flex-start", gap: space(2), marginTop: space(1) }}>
            <View style={{ flex: 1 }}>
              <Body>{c.titleBn}</Body>
              <Muted>
                {c.assigneeName} · {dayMonth(c.dueKey)} · {STR.lpCatchupAtRaise}: {bnNum(c.snapshot.finished)}/{bnNum(c.snapshot.total)}
                {c.snapshot.lagSessions > 0 ? `, ${bnNum(c.snapshot.lagSessions)} ${STR.lpBehind}` : ""}
              </Muted>
              {c.blockedReason && c.status !== "DONE" ? <Muted>⚠ {c.blockedReason}</Muted> : null}
            </View>
            <Badge text={st.text} tone={st.tone} />
          </View>
        );
      })}
      {mayRaise && !open ? <Button title={STR.lpCatchupNew} variant="secondary" onPress={() => setOpen(true)} style={{ marginTop: space(2) }} /> : null}
      {open ? (
        <View style={{ marginTop: space(2), gap: space(1) }}>
          {sugQ.error ? <Notice message={friendlyError(sugQ.error)} tone="danger" /> : null}
          {!sug && !sugQ.error ? <Loader label={STR.loading} /> : null}
          {sug ? (
            <>
              <Muted>{STR.lpCatchupAssignee}</Muted>
              <ChipRow>
                {sug.assignees.map((a) => (
                  <Chip
                    key={a.userId}
                    label={`${a.name} · ${a.why === "ROUTINE" ? STR.lpWhyRoutine : STR.lpWhyClassTeacher}`}
                    selected={assignee === a.userId}
                    onPress={() => setAssignee(a.userId)}
                  />
                ))}
              </ChipRow>
              <Field label={STR.lpCatchupTitleField} value={title} onChangeText={setTitle} />
              <Field label={STR.lpCatchupNotes} value={notes} onChangeText={setNotes} multiline />
              <Field label={STR.lpCatchupDue} value={due} onChangeText={setDue} />
              <View style={{ flexDirection: "row", gap: space(2) }}>
                <Button title={STR.lpCatchupCreate} onPress={() => void submit()} loading={busy} disabled={busy} />
                <Button title={STR.cancel} variant="ghost" onPress={() => setOpen(false)} />
              </View>
            </>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

export default function LessonTrackerScreen({ route, navigation }: Props): React.ReactElement {
  const { sectionId, subject, title } = route.params;
  React.useLayoutEffect(() => {
    if (title) navigation.setOptions({ title });
  }, [navigation, title]);

  const [q, refetch] = useQuery({ query: LESSON_SECTION_TRACKER_QUERY, variables: { sectionId, subject } });
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );

  const t = q.data?.lessonSectionTracker;
  const chapters = useMemo(() => {
    const out: Array<{ chapter: string; heading: string; sessions: LessonTrackerSessionT[] }> = [];
    for (const s of t?.sessions ?? []) {
      let c = out[out.length - 1];
      if (!c || c.chapter !== s.chapter) {
        c = { chapter: s.chapter, heading: `${s.anchorWord} ${bnNum(s.chapter)}${s.chapterTitle ? ` · ${s.chapterTitle}` : ""}`, sessions: [] };
        out.push(c);
      }
      c.sessions.push(s);
    }
    return out;
  }, [t?.sessions]);
  const { shown, pager } = usePagedRows(chapters, { pageSize: 10, resetKey: `${sectionId}|${subject}` });

  if (q.error) {
    return (
      <Screen>
        <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      </Screen>
    );
  }
  if (!t) return <Screen>{q.fetching ? <Loader label={STR.loading} /> : <EmptyState message={STR.lpEmpty} />}</Screen>;
  const r = t.row;
  const reasons = reasonsLine(r);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(2) }}>
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
            <Body style={{ fontWeight: "700", flex: 1 }}>{progressLine(r)}</Body>
            {r.lagSessions > 0 ? <Badge text={`${bnNum(r.lagSessions)} ${STR.lpBehind}`} tone="gold" /> : null}
          </View>
          <Muted style={{ marginTop: 2 }}>{paceLine(r)}</Muted>
          <Muted style={{ marginTop: 2 }}>{lastLine(r)}</Muted>
          {reasons ? <Muted style={{ marginTop: 2 }}>{reasons}</Muted> : null}
          {r.unansweredNotes > 0 ? (
            <Muted style={{ marginTop: 2 }}>
              {STR.lpUnanswered}: {bnNum(r.unansweredNotes)}
            </Muted>
          ) : null}
        </Card>
        <CatchupCard sectionId={sectionId} subject={subject} catchups={t.catchups} onCreated={() => refetch({ requestPolicy: "network-only" })} />
        {shown.map((c) => (
          <Card key={c.chapter}>
            <Body style={{ fontWeight: "700" }}>{c.heading}</Body>
            {c.sessions.map((s) => (
              <SessionLine key={s.key} s={s} />
            ))}
          </Card>
        ))}
        <Pager {...pager} />
      </ScrollView>
    </Screen>
  );
}
