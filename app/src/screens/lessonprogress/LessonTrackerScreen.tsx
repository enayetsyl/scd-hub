/**
 * LessonTrackerScreen (LP-2, D-#824) — one শাখা × subject's lesson plan in book order: each session
 * finished (date, teacher), continuing, skipped (a later one is finished) or not yet. The header is
 * the overview row: progress, pace, projection, lag. Pages by chapter (D-#761: bounded by the book).
 */
import React, { useCallback, useMemo, useRef } from "react";
import { ScrollView, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { LESSON_SECTION_TRACKER_QUERY, type LessonTrackerSessionT } from "../../graphql/operations";
import { Screen, Card, Body, Muted, Badge, Loader, ErrorBanner, EmptyState } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { STR, bnNum } from "../../lib/labels";
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
          </Muted>
        ) : null}
      </View>
      <Badge text={st.label()} tone={st.tone} />
    </View>
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
