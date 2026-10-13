/**
 * ImprovementTasksTeacherCard (SP-2/SP-3, docs/prd-student-progress.md §4.3/§5) — the
 * teacher's "Improvement actions today" on Today: their own tasks, and any they cover for a
 * teacher on leave (tagged "covering, today only"). Each gets Done today / Couldn't today
 * (with a reason) and a same-day Undo.
 *
 * Self-contained (own query) and mounted OUTSIDE Today's QueryGate: the task is owed on a
 * day with no periods too (the TodayWorkCard lesson). Renders nothing while loading, when
 * empty, and on error — a broken card must never break Today.
 */
import React from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { IMPROVEMENT_TEACHER_REASONS } from "@scd/shared";
import { MY_IMPROVEMENT_TASKS, TICK_IMPROVEMENT_TASK, UNTICK_IMPROVEMENT_TASK, type ImprovementTaskT } from "../graphql/improvement";
import { Badge, Body, Button, Card, Chip, ChipRow, Muted, Notice } from "./ui";
import { STR, bnNum, classSectionLabel, subjectShortLabel, improvementReasonLabel } from "../lib/labels";
import { isWholeClassSectionName } from "../lib/sectionPicks";
import { friendlyError } from "../lib/errors";
import { useColors } from "../theme";
import { space } from "../theme/tokens";

export const taskTargetLabel = (t: Pick<ImprovementTaskT, "scope" | "studentName" | "classLevel" | "sectionNameBn" | "subject">): string => {
  const cls = t.classLevel != null ? classSectionLabel(t.classLevel, isWholeClassSectionName(t.sectionNameBn) ? null : t.sectionNameBn) : t.sectionNameBn;
  return `${t.scope === "STUDENT" && t.studentName ? `${t.studentName} · ` : ""}${cls} · ${subjectShortLabel(t.subject)}`;
};

export function ImprovementTasksTeacherCard(): React.ReactElement | null {
  const c = useColors();
  const [q, refetch] = useQuery({ query: MY_IMPROVEMENT_TASKS, requestPolicy: "cache-and-network" });
  const [m, tick] = useMutation(TICK_IMPROVEMENT_TASK);
  const [, untick] = useMutation(UNTICK_IMPROVEMENT_TASK);
  const [asking, setAsking] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const rows = q.data?.myImprovementTasks ?? [];
  if (q.error || rows.length === 0) return null;
  const left = rows.filter((r) => !r.status).length;

  async function run(p: Promise<{ error?: unknown }>): Promise<void> {
    setErr(null);
    const res = await p;
    if (res.error) setErr(friendlyError(res.error as never));
    setAsking(null);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
        <Body style={{ fontWeight: "700" }}>{STR.impDayListTitle}</Body>
        <Badge text={left ? `${bnNum(left)} ${STR.impLeft}` : STR.impAllDone} tone={left ? "warn" : "ok"} />
      </View>
      <Muted>{STR.impTodayCardHint}</Muted>
      {err ? <Notice message={err} tone="danger" /> : null}
      {rows.map((r) => {
        const covering = r.responsibleSource === "COVER" || (r.responsibleSource === "OVERRIDE" && r.assignedTeacherName && r.responsibleName !== r.assignedTeacherName);
        return (
          <View key={r.actionId} style={{ borderTopWidth: 1, borderTopColor: c.border, marginTop: space(2), paddingTop: space(2), gap: 4 }}>
            {covering ? <Badge text={`${STR.impCoveringFor} ${r.assignedTeacherName ?? ""}`} tone="warn" /> : null}
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2) }}>
              <Body style={{ fontWeight: "700", flex: 1 }}>{taskTargetLabel(r)}</Body>
              <Badge text={r.scope === "CLASS" ? STR.impScopeClass : STR.impScopeStudent} tone={r.scope === "CLASS" ? "brand" : "info"} />
            </View>
            <Text style={{ color: c.textPrimary }}>{r.task}</Text>
            <Muted>
              {STR.impDay} {bnNum(r.dayNumber)}/{bnNum(r.totalDays)} · {bnNum(r.doneSoFar)}/{bnNum(r.daysSoFar)} {STR.impLegendDone}
            </Muted>
            {r.status ? (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2), backgroundColor: r.status === "DONE" ? c.primaryContainer : c.warningContainer, borderRadius: 8, paddingHorizontal: space(2) }}>
                <Text style={{ color: r.status === "DONE" ? c.onPrimaryContainer : c.warning, fontWeight: "600", paddingVertical: 8, flex: 1 }}>
                  {r.status === "DONE" ? `${STR.impDoneToday} ✓` : `${STR.impCouldntToday} — ${improvementReasonLabel(r.reason)}`}
                  {r.onBehalf && r.markedByName ? ` (${STR.impMarkedBy} ${r.markedByName})` : ""}
                </Text>
                {r.markedByMe ? <Button title={STR.impUndo} variant="ghost" onPress={() => void run(untick({ actionId: r.actionId, dayKey: r.dayKey }))} /> : null}
              </View>
            ) : asking === r.actionId ? (
              <View style={{ gap: 4 }}>
                <Muted>{STR.impWhyNot}</Muted>
                <ChipRow>
                  {IMPROVEMENT_TEACHER_REASONS.map((reason) => (
                    <Chip key={reason} label={improvementReasonLabel(reason)} onPress={() => void run(tick({ actionId: r.actionId, dayKey: r.dayKey, status: "COULDNT", reason }))} />
                  ))}
                </ChipRow>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: space(2) }}>
                <Button title={STR.impDoneToday} loading={m.fetching} onPress={() => void run(tick({ actionId: r.actionId, dayKey: r.dayKey, status: "DONE" }))} style={{ flexGrow: 1 }} />
                <Button title={STR.impCouldntToday} variant="secondary" onPress={() => setAsking(r.actionId)} style={{ flexGrow: 1 }} />
              </View>
            )}
          </View>
        );
      })}
    </Card>
  );
}
