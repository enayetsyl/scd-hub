/**
 * ReviewHomeScreen (PR-3, R3.1/R3.3) — the Review tab landing.
 *
 * Role-aware, two sections (a Principal sees both):
 *   • Inbox (content:assign_review — Principal/Office): submitted rounds awaiting
 *     action → tap to the thread (copy feedback → Claude Desktop, reassign, approve).
 *   • My reviews (content:review — Teacher/Principal): plans assigned to me → tap to
 *     the review form.
 *
 * Each query is paused when the role lacks the permission, so a single-permission
 * role never fires a query the server would reject.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { roleHasPermission } from "@scd/shared";
import { MY_REVIEW_ASSIGNMENTS, PLAN_REVIEW_INBOX, type ReviewAssignmentT } from "../../graphql/operations";
import type { ReviewStackParamList } from "../../navigation/types";
import { useAuth } from "../../auth/AuthContext";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Badge,
  Loader,
  EmptyState,
  ErrorBanner,
  Divider,
} from "../../components/ui";
import {
  STR,
  subjectLabel,
  classLevelLabel,
  reviewVerdictLabel,
  reviewRoundStatusLabel,
  bnNum,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ReviewStackParamList, "ReviewHome">;

function planTitle(r: ReviewAssignmentT): string {
  return `${subjectLabel(r.subject)} · ${classLevelLabel(r.classLevel)} · ${r.anchorWord} ${bnNum(r.addressNumber)}`;
}

export default function ReviewHomeScreen({ navigation }: Props): React.ReactElement {
  const { role } = useAuth();
  const canAssign = !!role && roleHasPermission(role, "content:assign_review");
  const canReview = !!role && roleHasPermission(role, "content:review");

  const [{ data: inboxData, fetching: inboxFetching, error: inboxErr }, refetchInbox] = useQuery({
    query: PLAN_REVIEW_INBOX,
    pause: !canAssign,
  });
  const [{ data: mineData, fetching: mineFetching, error: mineErr }, refetchMine] = useQuery({
    query: MY_REVIEW_ASSIGNMENTS,
    pause: !canReview,
  });

  const inbox = inboxData?.planReviewInbox ?? [];
  const mine = mineData?.myReviewAssignments ?? [];

  return (
    <Screen scroll>
      {canAssign ? (
        <View style={{ marginBottom: space(4) }}>
          <H2>{STR.reviewInbox}</H2>
          {inboxErr ? (
            <ErrorBanner message={friendlyError(inboxErr)} onRetry={() => refetchInbox({ requestPolicy: "network-only" })} />
          ) : inboxFetching ? (
            <Loader label={STR.loading} />
          ) : inbox.length === 0 ? (
            <EmptyState message={STR.noInbox} />
          ) : (
            inbox.map((r) => (
              <Card key={r.id} onPress={() => navigation.navigate("ReviewThread", { artifactId: r.artifactId })}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Body style={{ flex: 1, fontWeight: "700" }}>{planTitle(r)}</Body>
                  <Badge text={reviewVerdictLabel(r.verdict)} tone={r.verdict === "APPROVE" ? "ok" : "warn"} />
                </View>
                <Muted style={{ marginTop: 4 }}>
                  {STR.reviewRound} {bnNum(r.roundNumber)}
                  {r.feedback ? ` · ${r.feedback}` : ""}
                </Muted>
              </Card>
            ))
          )}
        </View>
      ) : null}

      {canAssign && canReview ? <Divider /> : null}

      {canReview ? (
        <View>
          <H2>{STR.myReviews}</H2>
          {mineErr ? (
            <ErrorBanner message={friendlyError(mineErr)} onRetry={() => refetchMine({ requestPolicy: "network-only" })} />
          ) : mineFetching ? (
            <Loader label={STR.loading} />
          ) : mine.length === 0 ? (
            <EmptyState message={STR.noMyReviews} />
          ) : (
            mine.map((r) => (
              <Card
                key={r.id}
                onPress={() => navigation.navigate("ReviewSubmit", { assignmentId: r.id, artifactId: r.artifactId })}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Body style={{ flex: 1, fontWeight: "700" }}>{planTitle(r)}</Body>
                  <Badge text={reviewRoundStatusLabel(r.status)} tone="brand" />
                </View>
                <Muted style={{ marginTop: 4 }}>
                  {STR.reviewRound} {bnNum(r.roundNumber)}
                </Muted>
              </Card>
            ))
          )}
        </View>
      ) : null}
    </Screen>
  );
}
