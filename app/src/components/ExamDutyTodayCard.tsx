/**
 * ExamDutyTodayCard (D-#1660) — on a teacher's Today screen: their exam duties from today
 * on (the next few), a tap opens "আমার পরীক্ষার ডিউটি". Renders nothing when there is none.
 * Has its own query, so it is mounted OUTSIDE Today's QueryGate (an empty Today would
 * otherwise swallow it).
 */
import React from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { useNavigation } from "@react-navigation/native";
import { MY_EXAM_DUTIES } from "../graphql/examDuty";
import { Body, Button, Card, Muted } from "./ui";
import { STR, fullDateLabel, routineSubjectLabel } from "../lib/labels";
import { dutyWhen, dutyWhere } from "../screens/syllabus/MyExamDutyScreen";
import { space, typeScale } from "../theme/tokens";

const SHOWN = 3;

export function ExamDutyTodayCard(): React.ReactElement | null {
  const [q] = useQuery({ query: MY_EXAM_DUTIES });
  const nav = useNavigation() as unknown as { navigate: (name: string, params?: object) => void };
  const rows = q.data?.myExamDuties ?? [];
  if (!rows.length) return null;
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.edTodayTitle}</Body>
      <View style={{ gap: space(2), marginTop: space(2) }}>
        {rows.slice(0, SHOWN).map((r) => (
          <View key={r.id} style={{ gap: 2 }}>
            <Body style={{ ...typeScale.bodyStrong }}>
              {fullDateLabel(r.dateKey)} · {routineSubjectLabel(r.subject)}
            </Body>
            <Muted>{dutyWhen(r)}</Muted>
            <Muted>{dutyWhere(r)}</Muted>
          </View>
        ))}
      </View>
      <Button title={STR.edSeeAll} variant="ghost" onPress={() => nav.navigate("SyllabusTab", { screen: "MyExamDuty", initial: false })} />
    </Card>
  );
}
