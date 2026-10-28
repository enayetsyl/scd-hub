/**
 * QuranExamTodayCard (D-#876, mockup screens 4 and 13) — on an examiner's Today screen:
 * today's sittings in time order with their status; a tap opens the mark screen. Renders
 * nothing on a day with no sittings. Has its own query, so it is mounted OUTSIDE Today's
 * QueryGate (an empty Today would otherwise swallow it).
 */
import React from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { useNavigation } from "@react-navigation/native";
import { QX_MY_SITTINGS } from "../graphql/quranExam";
import { Body, Button, Card, Muted } from "./ui";
import { STR, dhakaDateKey } from "../lib/labels";
import { qxLevelLabel } from "../lib/quranExam";
import { SittingRow } from "../screens/quranExam/MyQuranExamScreen";
import { space } from "../theme";

export function QuranExamTodayCard(): React.ReactElement | null {
  const today = dhakaDateKey();
  const [q] = useQuery({ query: QX_MY_SITTINGS, variables: { fromDateKey: today } });
  const nav = useNavigation() as unknown as { navigate: (name: string, params?: object) => void };
  const rows = (q.data?.myQuranExamSittings ?? []).filter((r) => r.dateKey === today);
  if (!rows.length) return null;
  const levels = [...new Set(rows.map((r) => qxLevelLabel(r.level)))].join(", ");
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.qxTodayCard}</Body>
      <Muted>{levels}</Muted>
      <View style={{ gap: space(2), marginTop: space(2) }}>
        {rows.map((r) => (
          <SittingRow
            key={r.id}
            s={r}
            onPress={() => nav.navigate("QuranExamTab", { screen: "QuranExamSitting", params: { id: r.id }, initial: false })}
          />
        ))}
      </View>
      <Button title={STR.qxSeeAll} variant="ghost" onPress={() => nav.navigate("QuranExamTab", { screen: "MyQuranExam", initial: false })} />
    </Card>
  );
}
