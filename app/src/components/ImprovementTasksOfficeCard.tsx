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
import { Badge, Button, Muted } from "./ui";
import { FoldCard } from "./FoldCard";
import { STR, bnNum } from "../lib/labels";
import { space } from "../theme/tokens";

export function ImprovementTasksOfficeCard(): React.ReactElement | null {
  const nav = useNavigation();
  const [q] = useQuery({ query: IMPROVEMENT_DAY_TASKS, requestPolicy: "cache-and-network" });
  const rows = q.data?.improvementDayTasks ?? [];
  if (q.error || rows.length === 0) return null;
  const pending = rows.filter((r) => !r.status);
  // D-#758: the not-ticked count is the summary; the names and the list link open on tap.
  return (
    <FoldCard
      id="today:improvementOffice"
      title={STR.impDayListTitle}
      aside={<Badge text={pending.length ? `${bnNum(pending.length)} ${STR.impNotTicked}` : STR.impAllDone} tone={pending.length ? "warn" : "ok"} />}
    >
      {pending.slice(0, 3).map((r) => (
        <Muted key={r.actionId}>
          {r.responsibleName ?? STR.impNobody} — {r.task}
        </Muted>
      ))}
      <View style={{ marginTop: space(2) }}>
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
      </View>
    </FoldCard>
  );
}
