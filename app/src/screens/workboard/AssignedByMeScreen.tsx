/**
 * AssignedByMeScreen (WB-1, D-#701) — আমার দেওয়া কাজ: everything the caller put on
 * OTHER people's boards, grouped by person, open or finished. Tapping a row opens
 * the task, where reminder-by-status, extend-the-date (move) and hand-over live.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { TASKS_ASSIGNED_BY_ME_QUERY, type TaskT } from "../../graphql/workBoard";
import type { WorkBoardStackParamList } from "../../navigation/types";
import { Screen, Button, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { WorkCardView } from "../../components/WorkCardView";
import { STR, bnNum } from "../../lib/labels";
import { dateKey } from "../../lib/dates";
import { makeStyles, radius, space, typeScale } from "../../theme";

type Props = NativeStackScreenProps<WorkBoardStackParamList, "AssignedByMe">;

function toCard(t: TaskT, today: string) {
  return {
    key: `TASK:${t.id}`,
    kind: "TASK" as const,
    userId: t.assigneeUserId,
    titleBn: t.titleBn,
    detailBn: t.notes,
    dateKey: t.dueKey,
    slot: t.slot,
    startMin: null,
    effortMin: t.effortMin,
    status: t.status,
    overdue: t.status !== "DONE" && t.dueKey < today,
    priority: t.priority,
    blockedReason: t.blockedReason,
    assignedById: t.assignedBy,
    assignedByName: null,
    forLabel: t.forLabel,
    taskId: t.id,
    sourceId: null,
    link: null,
  };
}

export default function AssignedByMeScreen({ navigation }: Props): React.ReactElement {
  const styles = useStyles();
  const [open, setOpen] = React.useState(true);
  const [q, refetchQ] = useQuery({ query: TASKS_ASSIGNED_BY_ME_QUERY, variables: { open }, requestPolicy: "cache-and-network" });
  const refetch = (): void => refetchQ({ requestPolicy: "network-only" });
  const tasks = q.data?.tasksAssignedByMe ?? [];
  const today = dateKey();

  const byPerson = new Map<string, { name: string; tasks: TaskT[] }>();
  for (const t of tasks) {
    const g = byPerson.get(t.assigneeUserId) ?? { name: t.assigneeName ?? "—", tasks: [] };
    g.tasks.push(t);
    byPerson.set(t.assigneeUserId, g);
  }
  // Blocked first inside a person (the assigner owes an answer), then by day.
  const groups = [...byPerson.entries()].map(([id, g]) => ({
    id,
    name: g.name,
    tasks: [...g.tasks].sort((a, b) => Number(!!b.blockedReason) - Number(!!a.blockedReason) || a.dueKey.localeCompare(b.dueKey)),
  }));

  return (
    <Screen scroll>
      <View style={styles.seg}>
        {[
          [true, `${STR.wbOpen}${open && tasks.length ? ` ${bnNum(tasks.length)}` : ""}`],
          [false, STR.wbShowDone],
        ].map(([v, label]) => (
          <Pressable key={String(v)} onPress={() => setOpen(v as boolean)} style={[styles.segBtn, open === v && styles.segOn]}>
            <Text style={[styles.segText, open === v && styles.segTextOn]}>{label as string}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ marginBottom: space(3) }}>
        <Button title={`+ ${STR.wbNewTask}`} variant="secondary" onPress={() => navigation.navigate("TaskForm", undefined)} />
      </View>
      <QueryGate result={q} onRetry={refetch} isEmpty={groups.length === 0} empty={<EmptyState message={STR.wbNoAssigned} />}>
        {groups.map((g) => (
          <View key={g.id} style={{ marginBottom: space(2) }}>
            <Pressable onPress={() => navigation.navigate("WorkBoard", { userId: g.id, name: g.name })} style={styles.person}>
              <Text style={styles.personName}>{g.name}</Text>
              <Text style={styles.personMeta}>{`${bnNum(g.tasks.length)} · ${STR.wbTapToOpen}`}</Text>
            </Pressable>
            {g.tasks.map((t) => (
              <WorkCardView key={t.id} card={toCard(t, today)} onOpen={() => navigation.navigate("TaskDetail", { taskId: t.id })} />
            ))}
          </View>
        ))}
      </QueryGate>
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  seg: { flexDirection: "row", gap: space(1), marginBottom: space(3) },
  segBtn: { flex: 1, paddingVertical: space(2), borderRadius: radius.sm, backgroundColor: c.surfaceAlt, alignItems: "center" },
  segOn: { backgroundColor: c.primaryContainer },
  segText: { ...typeScale.chip, color: c.textSecondary },
  segTextOn: { color: c.onPrimaryContainer },
  person: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingVertical: space(2) },
  personName: { ...typeScale.bodyStrong, color: c.textPrimary },
  personMeta: { ...typeScale.caption, color: c.textSecondary },
}));
