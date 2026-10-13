/**
 * LeaveImprovementTasks (SP-3, docs/prd-student-progress.md §5, D-#736) — on the leave cover
 * screen: every improvement task that falls on the leave's days, and WHO does it — by default
 * that day's period cover teacher for the class + subject; Office / Principal may set someone
 * else per day or send it back to the default. The applicant sees the same list read-only.
 * Renders nothing when the teacher has no improvement task during the leave.
 */
import React from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { TEACHERS_QUERY } from "../graphql/operations";
import { LEAVE_IMPROVEMENT_TASKS, SET_IMPROVEMENT_DAY_ASSIGNEE } from "../graphql/improvement";
import { Badge, Body, Button, Card, Muted, Notice, Select } from "./ui";
import { STR, bnNum } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { taskTargetLabel } from "./ImprovementTasksTeacherCard";
import { useColors } from "../theme";
import { space } from "../theme/tokens";

export function LeaveImprovementTasks({
  leaveApplicationId,
  manage,
  refreshKey,
}: {
  leaveApplicationId: string;
  manage: boolean;
  /** Changes whenever the period covers change — the default "done by" follows them. */
  refreshKey: string;
}): React.ReactElement | null {
  const c = useColors();
  const [q, refetch] = useQuery({ query: LEAVE_IMPROVEMENT_TASKS, variables: { leaveApplicationId }, requestPolicy: "cache-and-network" });
  React.useEffect(() => {
    refetch({ requestPolicy: "network-only" });
  }, [refreshKey, refetch]);
  const [teachersQ] = useQuery({ query: TEACHERS_QUERY, pause: !manage });
  const options = (teachersQ.data?.teachers ?? []).map((t) => ({ value: t.id, label: t.name }));
  const [m, setAssignee] = useMutation(SET_IMPROVEMENT_DAY_ASSIGNEE);
  const [err, setErr] = React.useState<string | null>(null);
  const rows = q.data?.leaveImprovementTasks ?? [];
  if (q.error || rows.length === 0) return null;

  async function assign(actionId: string, dayKey: string, userId: string | null): Promise<void> {
    setErr(null);
    const res = await setAssignee({ actionId, dayKey, userId });
    if (res.error) setErr(friendlyError(res.error));
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Card style={{ borderWidth: 2, borderColor: c.primary }}>
      <Body style={{ fontWeight: "700" }}>{STR.impLeaveTitle}</Body>
      <Muted>{STR.impLeaveHint}</Muted>
      {err ? <Notice message={err} tone="danger" /> : null}
      {rows.map((r) => (
        <View key={`${r.actionId}-${r.dayKey}`} style={{ borderTopWidth: 1, borderTopColor: c.border, marginTop: space(2), paddingTop: space(2), gap: 4 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space(2) }}>
            <Body style={{ fontWeight: "700" }}>{r.dayKey}</Body>
            <Badge
              text={
                r.source === "NONE"
                  ? STR.impNeedsPerson
                  : `${r.responsibleName ?? "—"} · ${r.source === "COVER" ? STR.impSourceCover : r.source === "OVERRIDE" ? STR.impSourceOverride : STR.impSourceAssigned}`
              }
              tone={r.source === "NONE" ? "danger" : r.source === "OVERRIDE" ? "info" : "brand"}
            />
          </View>
          <Text style={{ color: c.textPrimary, fontWeight: "600" }}>{taskTargetLabel(r)}</Text>
          <Text style={{ color: c.textPrimary }}>{r.task}</Text>
          <Muted>
            {STR.impDay} {bnNum(r.dayNumber)}/{bnNum(r.totalDays)}
          </Muted>
          {manage ? (
            <View style={{ gap: 4 }}>
              <Select
                label={STR.impDoneBy}
                value={r.source === "OVERRIDE" ? r.responsibleUserId : null}
                options={options}
                onChange={(v) => void assign(r.actionId, r.dayKey, v)}
                placeholder={STR.impPickTeacher}
                searchable
              />
              {r.source === "OVERRIDE" ? (
                <Button title={STR.impBackToDefault} variant="ghost" loading={m.fetching} onPress={() => void assign(r.actionId, r.dayKey, null)} />
              ) : null}
            </View>
          ) : null}
        </View>
      ))}
    </Card>
  );
}
