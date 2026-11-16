/**
 * GuardianMeetingResultCard (D-#1634) — on the guardian Home: a card that opens
 * "অভিভাবক সভার ফলাফল" when a published result exists for the selected child. Its own
 * query, mounted outside the Home QueryGate, renders nothing when there is none.
 */
import React from "react";
import { Pressable } from "react-native";
import { useQuery } from "urql";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { GUARDIAN_MEETING_RESULTS_QUERY } from "../graphql/meetingRelease";
import { Card, Body, Muted } from "./ui";
import { useGuardianChild } from "../state/GuardianChildContext";
import { STR } from "../lib/labels";
import { space } from "../theme/tokens";
import type { GuardianHomeStackParamList } from "../navigation/types";

export function GuardianMeetingResultCard(): React.ReactElement | null {
  const { selected } = useGuardianChild();
  const nav = useNavigation<NativeStackNavigationProp<GuardianHomeStackParamList>>();
  const [q] = useQuery({
    query: GUARDIAN_MEETING_RESULTS_QUERY,
    variables: { studentId: selected?.studentId ?? "" },
    pause: !selected,
  });
  const latest = q.data?.guardianMeetingResults?.[0];
  if (q.error || !latest) return null;
  return (
    <Pressable accessibilityRole="button" onPress={() => nav.navigate("ChildMeetingResults")}>
      <Card>
        <Body style={{ fontWeight: "700" }}>
          {STR.mgrHomeCardTitle} — {latest.instanceLabel}
        </Body>
        <Muted style={{ marginTop: space(1) }}>{STR.mgrHomeCardBody}</Muted>
      </Card>
    </Pressable>
  );
}
