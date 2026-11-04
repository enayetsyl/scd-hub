/**
 * MasteryReviewsScreen (OT-2, prd-objective-tree §7) — every objective-list review round: who it
 * is assigned to (বরাদ্দ), progress, open comments, unmapped exercises. A reviewer sees her own
 * rounds first; the Principal opens any round to assign or lock it.
 *
 * Param-free, so it may be a drawer entry. It is NOT registered first in the stack — MasteryHome
 * stays the initial route (the RN initial-route trap).
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { MASTERY_REVIEW_ROUNDS_QUERY, type ReviewRoundItem } from "../../graphql/masteryReview";
import { Screen, Card, Body, Muted, Badge, Loader, EmptyState, Notice } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, masteryClassLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme";
import { fill } from "./masteryStateUi";
import { roundStateLabel, roundStateTone } from "./masteryReviewUi";
import type { MasteryStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryReviews">;

export default function MasteryReviewsScreen({ navigation }: Props): React.ReactElement {
  const [{ data, fetching, error }] = useQuery({ query: MASTERY_REVIEW_ROUNDS_QUERY, requestPolicy: "cache-and-network" });
  const rounds = ((data?.masteryReviewRounds ?? []) as ReviewRoundItem[])
    .slice()
    .sort((a, b) => Number(b.assignedToMe) - Number(a.assignedToMe));

  return (
    <Screen scroll>
      {error ? <Notice message={friendlyError(error)} tone="danger" /> : null}
      {fetching && rounds.length === 0 ? <Loader /> : null}
      {!fetching && !error && rounds.length === 0 ? <EmptyState message={STR.msRvNoRounds} /> : null}
      {rounds.map((r) => (
        <Card key={r.id} onPress={() => navigation.navigate("MasteryReview", { reviewId: r.id })}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
            <Body style={{ fontWeight: "700" }}>
              {masteryClassLabel(r.classToken)} · {hwSubjectLabel(r.subject)} · {fill(STR.msRvRound, { n: bnNum(r.round) })}
            </Body>
            <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap" }}>
              {r.assignedToMe ? <Badge text={STR.msRvAssignedToYou} tone="gold" /> : null}
              <Badge text={roundStateLabel(r.state)} tone={roundStateTone(r.state)} />
            </View>
          </View>
          <Muted>
            {STR.msRvReviewers}: {r.reviewers.length ? r.reviewers.map((p) => p.name).join(", ") : STR.msRvNotAssigned}
          </Muted>
          {r.state !== "LOCKED" ? (
            <Muted>
              {fill(STR.msRvProgress, { seen: bnNum(r.seen), total: bnNum(r.total) })}
              {r.openComments > 0 ? ` · ${fill(STR.msRvOpenComments, { n: bnNum(r.openComments) })}` : ""}
              {r.unresolvedUnmapped > 0 ? ` · ${fill(STR.msRvUnmappedLeft, { n: bnNum(r.unresolvedUnmapped) })}` : ""}
            </Muted>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
