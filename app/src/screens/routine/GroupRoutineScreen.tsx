/**
 * GroupRoutineScreen (R3.1) — the weekly routine grid for a Section or a Quran/
 * Arabic SubjectGroup, grouped by day. `routine:read`.
 */
import React from "react";
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

type Props = NativeStackScreenProps<RoutineStackParamList, "GroupRoutine">;

export default function GroupRoutineScreen({ route }: Props): React.ReactElement {
  const { groupType, groupId, title } = route.params;
  const [q] = useQuery({ query: ROUTINE_SLOTS_QUERY, variables: { groupType, groupId } });

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        <Muted style={{ fontWeight: "700" }}>{title}</Muted>
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
