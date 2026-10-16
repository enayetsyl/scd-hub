/**
 * MeetingFinalQueueScreen (MC-4, docs/prd-meeting-comments.md §1, D-#752; roster:manage) —
 * every child of the meeting with where their final comment stands: ready for you (the
 * class teacher's summary is in), done, or still waiting on the summary. Slot order, so
 * the list reads like the meeting day. Tapping a child opens the final-comment screen.
 */
import React from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { MEETING_FINAL_QUEUE, type SummaryStateT } from "../../graphql/meetingChain";
import { Badge, Chip, ChipRow, Loader, Muted, Notice, Screen } from "../../components/ui";
import { finalSourceLabel, placeLabel } from "../../components/MeetingChainParts";
import { STR, bnNum, minutesToHHMM } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";
import type { CommentsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<CommentsStackParamList, "MeetingFinalQueue">;

export default function MeetingFinalQueueScreen({ route, navigation }: Props): React.ReactElement {
  const { meetingId } = route.params;
  const c = useColors();
  const [q, refetch] = useQuery({ query: MEETING_FINAL_QUEUE, variables: { meetingId }, requestPolicy: "cache-and-network" });
  const [filter, setFilter] = React.useState<SummaryStateT>("READY");
  useFocusEffect(
    React.useCallback(() => {
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );
  const rows = q.data?.meetingFinalQueue ?? null;
  if (!rows) return <Screen>{q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : <Loader label={STR.loading} />}</Screen>;

  const count = (s: SummaryStateT) => rows.filter((r) => r.state === s).length;
  const shown = rows.filter((r) => r.state === filter);
  const filters: Array<[SummaryStateT, string]> = [
    ["READY", STR.mcFilterReady],
    ["DONE", STR.mcFilterDone],
    ["WAITING", STR.mcFilterWaiting],
  ];
  return (
    <Screen>
      <ChipRow>
        {filters.map(([s, label]) => (
          <Chip key={s} label={`${label} (${bnNum(count(s))})`} selected={filter === s} onPress={() => setFilter(s)} />
        ))}
      </ChipRow>
      <FlatList
        data={shown}
        keyExtractor={(r) => r.studentId}
        contentContainerStyle={{ gap: space(2), paddingVertical: space(3) }}
        ListEmptyComponent={<Muted>{STR.mcEmptyFilter}</Muted>}
        renderItem={({ item: r }) => (
          <Pressable
            disabled={r.state === "WAITING"}
            onPress={() => navigation.navigate("MeetingFinal", { meetingId, studentId: r.studentId, studentName: r.name })}
            style={({ pressed }) => ({
              minHeight: 56,
              flexDirection: "row",
              alignItems: "center",
              gap: space(3),
              paddingHorizontal: space(3),
              borderRadius: 12,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: c.surface,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Text style={{ color: c.textSecondary, minWidth: 48 }}>{r.slotTime != null ? minutesToHHMM(r.slotTime) : "—"}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.textPrimary, fontWeight: "600" }}>{r.name}</Text>
              <Muted>
                {placeLabel(r)}
                {r.finalSource ? ` · ${finalSourceLabel(r.finalSource)}` : ""}
              </Muted>
            </View>
            <Badge
              text={r.state === "READY" ? STR.mcStateReady : r.state === "DONE" ? STR.mcStateDone : STR.mcStateWaiting}
              tone={r.state === "READY" ? "info" : r.state === "DONE" ? "ok" : "warn"}
            />
          </Pressable>
        )}
      />
    </Screen>
  );
}
