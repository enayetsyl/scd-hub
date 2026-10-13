/**
 * ImprovementTasksOfficeCard (SP-4, D-#738) — on the Office / Principal Today: how many of
 * today's teacher tasks are not ticked yet, with a link to the list where they can mark on
 * the teacher's behalf. Self-contained; renders nothing when there are no tasks today.
 */
import React from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "urql";
import { IMPROVEMENT_DAY_TASKS } from "../graphql/improvement";
import { Badge, Body, Button, Card, Muted } from "./ui";
import { STR, bnNum } from "../lib/labels";
import { space } from "../theme/tokens";

export function ImprovementTasksOfficeCard(): React.ReactElement | null {
  const nav = useNavigation();
  const [q] = useQuery({ query: IMPROVEMENT_DAY_TASKS, requestPolicy: "cache-and-network" });
  const rows = q.data?.improvementDayTasks ?? [];
  if (q.error || rows.length === 0) return null;
  const pending = rows.filter((r) => !r.status);
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
        <Body style={{ fontWeight: "700" }}>{STR.impDayListTitle}</Body>
        <Badge text={pending.length ? `${bnNum(pending.length)} ${STR.impNotTicked}` : STR.impAllDone} tone={pending.length ? "warn" : "ok"} />
      </View>
      {pending.slice(0, 3).map((r) => (
        <Muted key={r.actionId}>
          {r.responsibleName ?? STR.impNobody} — {r.task}
        </Muted>
      ))}
      <Button
        title={STR.impOpenList}
        variant="secondary"
        onPress={() =>
          (nav as unknown as { navigate: (name: string, params?: object) => void }).navigate("ClassTestTab", {
            screen: "ImprovementDayTasks",
            initial: false,
          })
        }
      />
    </Card>
  );
}
