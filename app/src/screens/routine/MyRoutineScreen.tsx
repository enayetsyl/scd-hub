/**
 * MyRoutineScreen (R3.2 + R5.3) — the logged-in teacher's own slots across all
 * groups, grouped by day with today highlighted, plus a "notes to publish today"
 * prompt (the class-note reminder surface; push delivery is deferred). `routine:read`.
 */
import React from "react";
import { View, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { DAYS_OF_WEEK } from "@scd/shared";
import { MY_ROUTINE_QUERY, MY_CLASS_NOTE_PROMPTS_QUERY } from "../../graphql/operations";
import type { RoutineStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Button, Loader, Notice } from "../../components/ui";
import { SlotList } from "./SlotList";
import { STR, routineSubjectLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { dateKey } from "../../lib/dates";

const todayISO = (): string => dateKey();

type Props = NativeStackScreenProps<RoutineStackParamList, "MyRoutine">;

export default function MyRoutineScreen({ navigation }: Props): React.ReactElement {
  const [q] = useQuery({ query: MY_ROUTINE_QUERY });
  const [promptsQ] = useQuery({ query: MY_CLASS_NOTE_PROMPTS_QUERY, variables: { date: todayISO() } });
  const today = DAYS_OF_WEEK[new Date().getDay()];
  const prompts = promptsQ.data?.myClassNotePrompts ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        {prompts.length > 0 ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.rtNotesToPublish}</Body>
            <View style={{ gap: space(2) }}>
              {prompts.map((s) => (
                <Button
                  key={s.id}
                  title={`${STR.rtPeriodN} ${bnNum(s.periodNumber)} · ${routineSubjectLabel(s.subject)}`}
                  variant="secondary"
                  onPress={() =>
                    navigation.navigate("DailyNote", {
                      groupType: s.groupType,
                      groupId: s.groupId,
                      title: routineSubjectLabel(s.subject),
                    })
                  }
                />
              ))}
            </View>
          </Card>
        ) : null}

        {q.fetching ? <Loader /> : null}
        {q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : null}
        {q.data ? <SlotList slots={q.data.myRoutineSlots} highlightDay={today} /> : null}
      </ScrollView>
    </Screen>
  );
}
