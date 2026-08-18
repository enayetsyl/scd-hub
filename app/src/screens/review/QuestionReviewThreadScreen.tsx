/**
 * QuestionReviewThreadScreen (QR-4) — the round history for one question, oldest→newest.
 *
 * The thread is anchored on the question's `qid`, so it spans every re-imported version of
 * that question and never bleeds into the other questions that share its unit address.
 *
 * Visible to Principal/Office for any question, and to a teacher only for threads they
 * reviewed — enforced server-side; an unrelated teacher gets a denial shown in Bangla.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { QUESTION_REVIEW_THREAD } from "../../graphql/operations";
import type { ReviewStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Badge, Loader, EmptyState, ErrorBanner, Divider } from "../../components/ui";
import { STR, subjectLabel, classLevelLabel, reviewVerdictLabel, reviewRoundStatusLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ReviewStackParamList, "QuestionReviewThread">;

export default function QuestionReviewThreadScreen({ route }: Props): React.ReactElement {
  const { artifactId } = route.params;
  const [{ data, fetching, error }] = useQuery({
    query: QUESTION_REVIEW_THREAD,
    variables: { artifactId },
  });

  if (fetching) return <Loader />;
  if (error) return <Screen scroll><ErrorBanner message={friendlyError(error)} /></Screen>;

  const rounds = data?.questionReviewThread ?? [];
  const first = rounds[0];

  return (
    <Screen scroll>
      <H2>{STR.reviewThread}</H2>
      {first ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
          <Badge text={subjectLabel(first.subject)} />
          <Badge text={classLevelLabel(first.classLevel)} />
          {first.qid ? <Badge text={first.qid} /> : null}
        </View>
      ) : null}
      {first?.questionText ? <Body>{first.questionText}</Body> : null}

      <Divider />

      {rounds.length === 0 ? (
        <EmptyState message={STR.qrNoQueue} />
      ) : (
        rounds.map((r) => (
          <Card key={r.id} style={{ marginBottom: space(2) }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
              <Badge text={`#${bnNum(r.roundNumber)}`} />
              <Badge text={reviewRoundStatusLabel(r.status)} />
              {r.verdict ? (
                <Badge
                  text={reviewVerdictLabel(r.verdict)}
                  tone={r.verdict === "APPROVE" ? "ok" : "warn"}
                />
              ) : null}
            </View>
            <Muted>{r.reviewerName ?? r.reviewerId}</Muted>
            {/* Optional by design (Q2.4) — absence is normal, not a gap in the data. */}
            <Muted>
              {STR.qrReason}: {r.reason && r.reason.trim() !== "" ? r.reason : "—"}
            </Muted>
          </Card>
        ))
      )}
    </Screen>
  );
}
