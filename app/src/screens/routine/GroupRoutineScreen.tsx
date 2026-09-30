/**
 * GroupRoutineScreen (R3.1) — the weekly routine grid for a Section or a Quran/
 * Arabic SubjectGroup, grouped by day. `routine:read`.
 */
import React, { useState } from "react";
import { ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { ROUTINE_SLOTS_QUERY } from "../../graphql/operations";
import type { RoutineStackParamList } from "../../navigation/types";
import { Screen, Loader, Notice, Muted } from "../../components/ui";
import { SlotList } from "./SlotList";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { dateKey } from "../../lib/dates";
import { DateField } from "../../components/DateField";

type Props = NativeStackScreenProps<RoutineStackParamList, "GroupRoutine">;

export default function GroupRoutineScreen({ route }: Props): React.ReactElement {
  const { groupType, groupId, title } = route.params;
  // Which date's routine to show — past or future routine changes (default today).
  const [date, setDate] = useState<string>(dateKey());
  const [q] = useQuery({ query: ROUTINE_SLOTS_QUERY, variables: { groupType, groupId, date } });

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        <Muted style={{ fontWeight: "700" }}>{title}</Muted>
        <DateField label={STR.rtRoutineForDate} value={date} onChange={(v) => setDate(v || dateKey())} />
        {q.fetching ? <Loader /> : null}
        {q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : null}
        {q.data ? <SlotList slots={q.data.routineSlots ?? []} /> : null}
        {!q.fetching && !q.error && q.data && (q.data.routineSlots ?? []).length === 0 ? (
          <Muted>{STR.rtNoSlots}</Muted>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
