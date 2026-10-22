/**
 * ChildMissedLessonsScreen (LP-4, D-#828) — the classes this academic year where the guardian's
 * child was listed absent while a lesson-plan session was taught: the date, subject, the session(s)
 * and what the teacher wrote in the class note that day, newest first, so the family can go over it
 * at home. Server-paged (D-#761). The 18:00 LESSON_MISSED notice lands here.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "urql";
import { CHILD_MISSED_LESSONS_PAGE_QUERY } from "../../graphql/operations";
import { Screen, Body, Muted, Card, Badge, Loader, EmptyState, Notice } from "../../components/ui";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { Pager } from "../../components/Pager";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { STR, bnNum, routineSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePageState, PAGE_SIZE } from "../../lib/paging";
import { space } from "../../theme/tokens";
import { dayMonth } from "../lessonprogress/lessonProgressUi";

export default function ChildMissedLessonsScreen(): React.ReactElement {
  const { selected } = useGuardianChild();
  const sid = selected?.studentId ?? "";
  const [page, setPage] = usePageState(sid);
  const [{ data, fetching, error }] = useQuery({
    query: CHILD_MISSED_LESSONS_PAGE_QUERY,
    variables: { studentId: sid, page, pageSize: PAGE_SIZE },
    pause: !selected,
    requestPolicy: "cache-and-network",
  });
  const pg = data?.childMissedLessonsPage;
  const rows = pg?.rows ?? [];

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <ChildSwitcher />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4), gap: space(3) }}>
        <Muted>{STR.gpMissedHint}</Muted>
        {!selected || (fetching && !pg) ? <Loader label={STR.loading} /> : null}
        {error ? <Notice message={friendlyError(error)} tone="danger" /> : null}
        {pg && rows.length === 0 && !error ? <EmptyState message={STR.gpMissedNone} /> : null}
        {rows.map((r) => (
          <Card key={`${r.dateKey}|${r.subject}|${r.sessions.map((s) => `${s.chapter}.${s.sessionIndex}`).join(",")}`}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
              <Body style={{ fontWeight: "700", flex: 1 }}>
                {dayMonth(r.dateKey)} · {routineSubjectLabel(r.subject)}
              </Body>
              {r.onLeave ? <Badge text={STR.lpOnLeave} tone="muted" /> : null}
            </View>
            {r.sessions.map((s) => (
              <Body key={`${s.chapter}.${s.sessionIndex}`} style={{ marginTop: 2 }}>
                {s.anchorWord} {bnNum(s.chapter)} · {STR.lpSession} {bnNum(s.sessionIndex)}/{bnNum(s.sessionOf)} · {s.titleBn}
              </Body>
            ))}
            {r.noteBn ? (
              <View style={{ marginTop: space(1) }}>
                <Muted>{STR.gpMissedTaught}:</Muted>
                <Body>{r.noteBn}</Body>
              </View>
            ) : null}
          </Card>
        ))}
        {pg && pg.total > pg.pageSize ? <Pager page={pg.page} pageSize={pg.pageSize} total={pg.total} onPage={setPage} /> : null}
      </ScrollView>
    </Screen>
  );
}
