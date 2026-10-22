/**
 * LessonProgressScreen (LP-2, D-#824) — how far each শাখা × subject has come through its lesson
 * plan. `lesson_progress:view_all` (Office/Principal) sees the whole school, largest lag first, with
 * class and subject filters; everyone else sees their own শাখা × subjects (routine or class teacher).
 * Each row opens the session-by-session tracker. Shows only — corrective action is for later (D-#824).
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import {
  LESSON_PROGRESS_OVERVIEW_QUERY,
  MY_LESSON_PROGRESS_QUERY,
  type LessonProgressRowT,
} from "../../graphql/operations";
import { Screen, Card, Body, Muted, Badge, Chip, ChipRow, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum, routineSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePagedRows } from "../../lib/paging";
import { space } from "../../theme/tokens";
import type { ClassNotesStackParamList } from "../../navigation/types";
import { lastLine, paceLine, progressLine, reasonsLine } from "./lessonProgressUi";

type Nav = NativeStackNavigationProp<ClassNotesStackParamList, "LessonProgress">;

function Row({ r, onOpen }: { r: LessonProgressRowT; onOpen: () => void }): React.ReactElement {
  const reasons = reasonsLine(r);
  return (
    <Pressable accessibilityRole="link" onPress={onOpen}>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
          <Body style={{ fontWeight: "700", flex: 1 }}>
            {r.classNameBn} · {r.sectionNameBn} — {routineSubjectLabel(r.subject)}
          </Body>
          {r.lagSessions > 0 ? <Badge text={`${bnNum(r.lagSessions)} ${STR.lpBehind}`} tone="gold" /> : null}
        </View>
        <Body style={{ marginTop: 4 }}>{progressLine(r)}</Body>
        <Muted style={{ marginTop: 2 }}>{paceLine(r)}</Muted>
        <Muted style={{ marginTop: 2 }}>{lastLine(r)}</Muted>
        {r.skipped > 0 ? <Muted style={{ marginTop: 2 }}>{STR.lpSkipped}: {bnNum(r.skipped)}</Muted> : null}
        {reasons ? <Muted style={{ marginTop: 2 }}>{reasons}</Muted> : null}
        {r.unansweredNotes > 0 ? (
          <Muted style={{ marginTop: 2 }}>
            {STR.lpUnanswered}: {bnNum(r.unansweredNotes)}
          </Muted>
        ) : null}
      </Card>
    </Pressable>
  );
}

export default function LessonProgressScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const { can } = useAuth();
  const canAll = can("lesson_progress:view_all");
  const [scope, setScope] = useState<"ALL" | "MINE">(canAll ? "ALL" : "MINE");
  const [level, setLevel] = useState<number | null>(null);
  const [subject, setSubject] = useState<string | null>(null);

  const [allQ, refetchAll] = useQuery({ query: LESSON_PROGRESS_OVERVIEW_QUERY, variables: {}, pause: !canAll || scope !== "ALL" });
  const [mineQ, refetchMine] = useQuery({ query: MY_LESSON_PROGRESS_QUERY, variables: {}, pause: scope !== "MINE" });
  const q = scope === "ALL" ? allQ : mineQ;
  const refetch = useCallback(
    () => (scope === "ALL" ? refetchAll : refetchMine)({ requestPolicy: "network-only" }),
    [scope, refetchAll, refetchMine],
  );

  // Focus-refetch (house pattern): a class note marked elsewhere shows on return.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      refetch();
    }, [refetch]),
  );

  const raw: LessonProgressRowT[] = (scope === "ALL" ? allQ.data?.lessonProgressOverview : mineQ.data?.myLessonProgress) ?? [];
  const levels = useMemo(() => [...new Set(raw.map((r) => r.classLevel))].sort((a, b) => a - b), [raw]);
  const subjects = useMemo(() => [...new Set(raw.map((r) => r.subject))].sort(), [raw]);
  const rows = raw.filter((r) => (level == null || r.classLevel === level) && (!subject || r.subject === subject));
  const { shown, pager } = usePagedRows(rows, { resetKey: `${scope}|${level}|${subject}` });

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(2) }}>
        <Muted>{STR.lpOverviewHint}</Muted>
        {canAll ? (
          <ChipRow>
            <Chip label={STR.lpAllSchool} selected={scope === "ALL"} onPress={() => setScope("ALL")} />
            <Chip label={STR.lpMine} selected={scope === "MINE"} onPress={() => setScope("MINE")} />
          </ChipRow>
        ) : null}
        {levels.length > 1 ? (
          <ChipRow>
            <Chip label={STR.lpAllClasses} selected={level == null} onPress={() => setLevel(null)} />
            {levels.map((l) => (
              <Chip key={l} label={raw.find((r) => r.classLevel === l)?.classNameBn ?? bnNum(l)} selected={level === l} onPress={() => setLevel(l)} />
            ))}
          </ChipRow>
        ) : null}
        {subjects.length > 1 ? (
          <ChipRow>
            <Chip label={STR.lpAllSubjects} selected={subject == null} onPress={() => setSubject(null)} />
            {subjects.map((s) => (
              <Chip key={s} label={routineSubjectLabel(s)} selected={subject === s} onPress={() => setSubject(s)} />
            ))}
          </ChipRow>
        ) : null}

        {q.error ? (
          <ErrorBanner message={friendlyError(q.error)} onRetry={refetch} />
        ) : q.fetching && raw.length === 0 ? (
          <Loader label={STR.loading} />
        ) : rows.length === 0 ? (
          <EmptyState message={STR.lpEmpty} />
        ) : (
          <>
            {shown.map((r) => (
              <Row
                key={`${r.sectionId}|${r.subject}`}
                r={r}
                onOpen={() =>
                  nav.navigate("LessonTracker", {
                    sectionId: r.sectionId,
                    subject: r.subject,
                    title: `${r.classNameBn} · ${r.sectionNameBn} — ${routineSubjectLabel(r.subject)}`,
                  })
                }
              />
            ))}
            <Pager {...pager} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
