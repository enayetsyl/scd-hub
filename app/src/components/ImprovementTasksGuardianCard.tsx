/**
 * ImprovementTasksGuardianCard (SP-2, docs/prd-student-progress.md §4.3) — "Today's tasks
 * from school" on the guardian Today, for the selected child: the task, how far along it is,
 * a row of squares for the days so far, and Done today / Couldn't today (with a reason) plus
 * a same-day Undo. Self-contained; renders nothing when there is no task today.
 */
import React from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { IMPROVEMENT_GUARDIAN_REASONS } from "@scd/shared";
import {
  CHILD_IMPROVEMENT_TASKS,
  CHILD_IMPROVEMENT_STREAK,
  TICK_CHILD_IMPROVEMENT_TASK,
  UNTICK_CHILD_IMPROVEMENT_TASK,
  type ImprovementTaskT,
} from "../graphql/improvement";
import { Body, Button, Card, Chip, ChipRow, Muted, Notice } from "./ui";
import { STR, bnNum, subjectShortLabel, improvementReasonLabel } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { dayLook } from "../lib/improvement";
import { useColors } from "../theme";
import { space } from "../theme/tokens";

function Streak({ actionId, studentId, today }: { actionId: string; studentId: string; today: string }): React.ReactElement | null {
  const c = useColors();
  const [q] = useQuery({ query: CHILD_IMPROVEMENT_STREAK, variables: { actionId, studentId }, requestPolicy: "cache-and-network" });
  const days = q.data?.childImprovementStreak ?? [];
  if (!days.length) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }} accessibilityLabel={STR.impDayByDay}>
      {days.map((d) => {
        const l = dayLook({ status: d.status, by: "GUARDIAN", future: d.dayKey > today || (d.dayKey === today && !d.status) }, c);
        return <View key={d.dayKey} style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: l.bg, borderWidth: 1, borderColor: l.border }} />;
      })}
    </View>
  );
}

export function ImprovementTasksGuardianCard({ studentId }: { studentId: string }): React.ReactElement | null {
  const c = useColors();
  const [q, refetch] = useQuery({ query: CHILD_IMPROVEMENT_TASKS, variables: { studentId }, requestPolicy: "cache-and-network" });
  const [m, tick] = useMutation(TICK_CHILD_IMPROVEMENT_TASK);
  const [, untick] = useMutation(UNTICK_CHILD_IMPROVEMENT_TASK);
  const [asking, setAsking] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [bump, setBump] = React.useState(0);
  const rows: ImprovementTaskT[] = q.data?.childImprovementTasks ?? [];
  if (q.error || rows.length === 0) return null;

  async function run(p: Promise<{ error?: unknown }>): Promise<void> {
    setErr(null);
    const res = await p;
    if (res.error) setErr(friendlyError(res.error as never));
    setAsking(null);
    setBump((b) => b + 1);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Card style={{ borderWidth: 2, borderColor: c.warning }}>
      <Body style={{ fontWeight: "700" }}>{STR.impGuardianCardTitle}</Body>
      <Muted>{STR.impGuardianCardHint}</Muted>
      {err ? <Notice message={err} tone="danger" /> : null}
      {rows.map((r) => (
        <View key={r.actionId} style={{ borderTopWidth: 1, borderTopColor: c.border, marginTop: space(2), paddingTop: space(2), gap: 6 }}>
          <Body style={{ fontWeight: "700" }}>
            {subjectShortLabel(r.subject)}
            {r.scope === "CLASS" ? ` · ${STR.impScopeClass}` : ""}
          </Body>
          <Text style={{ color: c.textPrimary, fontSize: 15 }}>{r.task}</Text>
          <Muted>
            {STR.impDay} {bnNum(r.dayNumber)}/{bnNum(r.totalDays)} · {bnNum(r.doneSoFar)}/{bnNum(r.daysSoFar)} {STR.impTicked}
          </Muted>
          <Streak key={`${r.actionId}-${bump}`} actionId={r.actionId} studentId={studentId} today={r.dayKey} />
          {r.status ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2), backgroundColor: r.status === "DONE" ? c.primaryContainer : c.warningContainer, borderRadius: 8, paddingHorizontal: space(2) }}>
              <Text style={{ color: r.status === "DONE" ? c.onPrimaryContainer : c.warning, fontWeight: "600", paddingVertical: 8, flex: 1 }}>
                {r.status === "DONE" ? `${STR.impDoneToday} ✓ — ${STR.impThanks}` : `${STR.impCouldntToday} — ${improvementReasonLabel(r.reason)}`}
              </Text>
              <Button title={STR.impUndo} variant="ghost" onPress={() => void run(untick({ actionId: r.actionId, studentId, dayKey: r.dayKey }))} />
            </View>
          ) : asking === r.actionId ? (
            <View style={{ gap: 4 }}>
              <Muted>{STR.impWhyNot}</Muted>
              <ChipRow>
                {IMPROVEMENT_GUARDIAN_REASONS.map((reason) => (
                  <Chip key={reason} label={improvementReasonLabel(reason)} onPress={() => void run(tick({ actionId: r.actionId, studentId, dayKey: r.dayKey, status: "COULDNT", reason }))} />
                ))}
              </ChipRow>
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: space(2) }}>
              <Button title={STR.impDoneToday} loading={m.fetching} onPress={() => void run(tick({ actionId: r.actionId, studentId, dayKey: r.dayKey, status: "DONE" }))} style={{ flexGrow: 1 }} />
              <Button title={STR.impCouldntToday} variant="secondary" onPress={() => setAsking(r.actionId)} style={{ flexGrow: 1 }} />
            </View>
          )}
        </View>
      ))}
    </Card>
  );
}
