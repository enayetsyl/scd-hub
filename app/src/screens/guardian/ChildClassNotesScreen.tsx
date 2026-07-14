/**
 * ChildClassNotesScreen (GP-2 rider) — the selected child's class-notes HISTORY:
 * "what was taught" for each of the last 7 days, each resolved via childClassNotes
 * (the same guardian read GuardianHome uses for today). Surfaces lesson history
 * that the Home tab only showed for the current day. Read-only; link-scoped
 * server-side (guardian:read_child + assertGuardianOfStudent).
 */
import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useQuery } from "urql";
import { DAYS_OF_WEEK } from "@scd/shared";
import { CHILD_CLASS_NOTES_QUERY } from "../../graphql/operations";
import { openStoredFile, FILE_VIEW_SUPPORTED } from "../../lib/files";
import { Screen, Body, Muted, Card, Loader, EmptyState } from "../../components/ui";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { STR, bnNum, dayOfWeekLabel, subjectLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";
import { dateKey } from "../../lib/dates";

const isoDay = (d: Date): string => dateKey(d);

/** The last `count` calendar dates, most-recent first (today included). */
function recentDates(count: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push(isoDay(d));
  }
  return out;
}

function DayNotes({ studentId, date }: { studentId: string; date: string }): React.ReactElement {
  const [q] = useQuery({ query: CHILD_CLASS_NOTES_QUERY, variables: { studentId, date } });
  const notes = q.data?.childClassNotes ?? [];
  const dow = dayOfWeekLabel(DAYS_OF_WEEK[new Date(date).getDay()]);
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Body style={{ fontWeight: "700" }}>{dow}</Body>
        <Muted>{bnNum(date)}</Muted>
      </View>
      {q.fetching ? (
        <Loader label={STR.loading} />
      ) : notes.length === 0 ? (
        <Muted style={{ marginTop: space(1) }}>{STR.gpNoNotesDay}</Muted>
      ) : (
        notes.map((n, i) => (
          <View key={`${n.subject}-${n.periodNumber ?? i}`} style={{ marginTop: space(2) }}>
            <Body style={{ fontWeight: "700" }}>{subjectLabel(n.subject)}</Body>
            <Body>{n.taughtSummaryBn}</Body>
            {n.homework ? (
              <Muted>
                {STR.gpHomeworkOpen}: {n.homework.hwId} · {bnNum(n.homework.qCount)} ·{" "}
                {bnNum(n.homework.timeDecl)} {STR.gpMinutes}
              </Muted>
            ) : null}
            {/* Worksheets/handouts the teacher attached. FILE_VIEW_SUPPORTED is web-only;
                elsewhere we still list them so the guardian knows they exist. */}
            {n.attachments.map((a) => (
              <Pressable
                key={a.id}
                onPress={() => (FILE_VIEW_SUPPORTED ? openStoredFile(a.id) : undefined)}
                accessibilityRole={FILE_VIEW_SUPPORTED ? "button" : undefined}
                accessibilityLabel={a.name}
                style={({ pressed }) => [{ paddingVertical: space(1) }, pressed && { opacity: 0.7 }]}
              >
                <Muted>📎 {a.name}</Muted>
              </Pressable>
            ))}
          </View>
        ))
      )}
    </Card>
  );
}

export default function ChildClassNotesScreen(): React.ReactElement {
  const { selected, fetching } = useGuardianChild();

  if (fetching && !selected) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }
  if (!selected) {
    return (
      <Screen>
        <EmptyState message={STR.gpNoChildren} />
      </Screen>
    );
  }

  const dates = recentDates(7);
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <ChildSwitcher />
        <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.gpClassNotesHistory}</Body>
        {dates.map((d) => (
          <DayNotes key={d} studentId={selected.studentId} date={d} />
        ))}
      </ScrollView>
    </Screen>
  );
}
