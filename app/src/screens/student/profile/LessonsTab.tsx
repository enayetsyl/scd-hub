/**
 * LessonsTab (LP-3, D-#823) — the student profile's পাঠ tab: every session plan the child's শাখা was
 * taught while they were on its roster, with presence from the day attendance. Missed lessons
 * (অনুপস্থিত / আংশিক) come first per subject; the full list follows. Own query, mounted only while
 * the tab is open (the profile's lazy-by-tab rule). A subject teacher sees only their subjects.
 */
import React from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { STUDENT_LESSONS_QUERY } from "../../../graphql/operations";
import { Card, Body, Muted, Loader, ErrorBanner, EmptyState, Notice } from "../../../components/ui";
import { LessonPresenceList } from "../../../components/LessonPresenceList";
import { STR, bnNum, routineSubjectLabel } from "../../../lib/labels";
import { friendlyError } from "../../../lib/errors";
import { space } from "../../../theme/tokens";

export function LessonsTab({ studentId }: { studentId: string }): React.ReactElement {
  const [q, refetch] = useQuery({ query: STUDENT_LESSONS_QUERY, variables: { studentId }, requestPolicy: "cache-and-network" });
  const data = q.data?.studentLessons;
  if (q.error) return <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />;
  if (!data) return <Loader label={STR.loading} />;
  return (
    <View style={{ gap: space(3) }}>
      {data.narrowed ? <Notice message={STR.lpNarrowed} tone="info" /> : null}
      {data.subjects.length === 0 ? <EmptyState message={STR.lpNoLessons} /> : null}
      {data.subjects.map((s) => {
        const missed = s.sessions.filter((x) => x.presence === "ABSENT" || x.presence === "PARTIAL");
        return (
          <Card key={s.subject}>
            <Body style={{ fontWeight: "700" }}>{routineSubjectLabel(s.subject)}</Body>
            <Muted style={{ marginTop: 2 }}>
              {STR.lpPresent} {bnNum(s.counts.present)} · {STR.lpPartial} {bnNum(s.counts.partial)} · {STR.lpAbsent} {bnNum(s.counts.absent)} ·{" "}
              {STR.lpUnknown} {bnNum(s.counts.unknown)}
            </Muted>
            {s.counts.unknown > 0 ? <Muted>{STR.lpUnknownHint}</Muted> : null}
            {missed.length > 0 ? (
              <View style={{ marginTop: space(2), gap: space(1) }}>
                <Body style={{ fontWeight: "700" }}>{STR.lpMissedTitle}</Body>
                <LessonPresenceList sessions={missed} />
              </View>
            ) : null}
            <View style={{ marginTop: space(2), gap: space(1) }}>
              <Body style={{ fontWeight: "700" }}>{STR.lpAllLessons}</Body>
              <LessonPresenceList sessions={s.sessions} />
            </View>
          </Card>
        );
      })}
    </View>
  );
}
