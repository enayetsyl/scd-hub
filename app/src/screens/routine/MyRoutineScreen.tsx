/**
 * MyRoutineScreen (R3.2) — the logged-in teacher's own slots across all groups,
 * grouped by day with today highlighted. `routine:read` (server scopes to the
 * caller via myRoutineSlots).
 */
import React from "react";
import { ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { DAYS_OF_WEEK } from "@scd/shared";
import { MY_ROUTINE_QUERY } from "../../graphql/operations";
import type { RoutineStackParamList } from "../../navigation/types";
import { Screen, Loader, Notice } from "../../components/ui";
import { SlotList } from "./SlotList";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<RoutineStackParamList, "MyRoutine">;

export default function MyRoutineScreen(_props: Props): React.ReactElement {
  const [q] = useQuery({ query: MY_ROUTINE_QUERY });
  const today = DAYS_OF_WEEK[new Date().getDay()];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        {q.fetching ? <Loader /> : null}
        {q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : null}
        {q.data ? <SlotList slots={q.data.myRoutineSlots} highlightDay={today} /> : null}
      </ScrollView>
    </Screen>
  );
}
