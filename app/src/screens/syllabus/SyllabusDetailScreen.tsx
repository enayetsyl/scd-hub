/**
 * SyllabusDetailScreen (SY-6) — one subject: the prose, the mark distribution and
 * the question types, through the shared `SyllabusView` renderer.
 *
 * The server refuses an unpublished row to anyone but Principal/Office, so a
 * hand-typed deep link cannot reach a draft — the screen does not re-implement
 * that rule, it just renders the refusal.
 */
import React from "react";
import { RefreshControl } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { EXAM_SYLLABUS_DETAIL } from "../../graphql/examSyllabus";
import type { SyllabusStackParamList } from "../../navigation/types";
import { Screen, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import SyllabusView from "../../components/SyllabusView";
import { STR } from "../../lib/labels";
import { usePullRefresh } from "../../lib/useRefresh";

type Props = NativeStackScreenProps<SyllabusStackParamList, "SyllabusDetail">;

export default function SyllabusDetailScreen({ route }: Props): React.ReactElement {
  const { examId, classId, subject } = route.params;

  const [detailQ, refetch] = useQuery({
    query: EXAM_SYLLABUS_DETAIL,
    variables: { examId, classId, subject },
  });
  const row = detailQ.data?.examSyllabusDetail ?? null;
  const refresh = usePullRefresh(detailQ.fetching, () => refetch({ requestPolicy: "network-only" }));

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />}>
      <QueryGate result={detailQ} onRetry={() => refetch({ requestPolicy: "network-only" })}>
        {row ? <SyllabusView row={row} /> : <EmptyState message={STR.syNotPublished} />}
      </QueryGate>
    </Screen>
  );
}
