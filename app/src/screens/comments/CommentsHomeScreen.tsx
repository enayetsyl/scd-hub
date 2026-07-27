/**
 * CommentsHomeScreen (CM-6) — the Comments tab hub. Role-aware quick links:
 * "Daily comments" for tracker:read holders (Principal/Teacher), "Parents'
 * meetings" for roster:manage holders (Principal/Office). Both visible to
 * Principal. Below them, a teacher's OWN recent comments (D-#263) — "see the
 * comments they made" — across any student, tap to re-open/edit/deliver. Every
 * action is re-gated server-side (the server stays the gate).
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { roleHasPermission } from "@scd/shared";
import { MY_STUDENT_COMMENTS_QUERY } from "../../graphql/comments";
import { Screen, Card, Body, Muted, Button, Badge } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { STR, commentTypeLabel, commentSentimentLabel, isoDateLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { CommentsStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<CommentsStackParamList>;

export default function CommentsHomeScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const { role } = useAuth();
  const canComments = !!role && roleHasPermission(role, "tracker:read");
  const canMeetings = !!role && roleHasPermission(role, "roster:manage");
  // Principal/Office review + release comments to guardians (D-#264).
  const canReview = !!role && roleHasPermission(role, "roster:manage");

  const [mineQ, refetchMine] = useQuery({ query: MY_STUDENT_COMMENTS_QUERY, variables: {}, pause: !canComments });
  const mine = mineQ.data?.myStudentComments ?? [];

  // Refresh the "my comments" list whenever the hub regains focus (e.g. after
  // recording/editing one on the entry screen).
  useFocusEffect(
    React.useCallback(() => {
      if (canComments) refetchMine({ requestPolicy: "network-only" });
    }, [canComments, refetchMine]),
  );

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.cmHomeTitle}</Body>
        </Card>

        {canComments ? (
          <Card onPress={() => nav.navigate("SectionComments")}>
            <Body style={{ fontWeight: "700" }}>{STR.cmDailyComments}</Body>
            <Muted style={{ marginTop: space(1) }}>{STR.cmDailyCommentsSub}</Muted>
            <View style={{ marginTop: space(2) }}>
              <Button title={STR.cmDailyComments} variant="secondary" onPress={() => nav.navigate("SectionComments")} />
            </View>
          </Card>
        ) : null}

        {canReview ? (
          <Card onPress={() => nav.navigate("CommentReview")}>
            <Body style={{ fontWeight: "700" }}>{STR.cmReview}</Body>
            <Muted style={{ marginTop: space(1) }}>{STR.cmReviewSub}</Muted>
            <View style={{ marginTop: space(2) }}>
              <Button title={STR.cmReview} variant="secondary" onPress={() => nav.navigate("CommentReview")} />
            </View>
          </Card>
        ) : null}

        {canMeetings ? (
          <Card onPress={() => nav.navigate("MeetingsList")}>
            <Body style={{ fontWeight: "700" }}>{STR.cmMeetings}</Body>
            <Muted style={{ marginTop: space(1) }}>{STR.cmMeetingsSub}</Muted>
            <View style={{ marginTop: space(2) }}>
              <Button title={STR.cmMeetings} variant="secondary" onPress={() => nav.navigate("MeetingsList")} />
            </View>
          </Card>
        ) : null}

        {/* The caller's own comments (D-#263) — see + re-open what they made. */}
        {canComments ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.cmMyComments}</Body>
            <Muted style={{ marginTop: space(1) }}>{STR.cmMyCommentsSub}</Muted>
            <QueryGate
              result={mineQ}
              onRetry={() => refetchMine({ requestPolicy: "network-only" })}
              loaderLabel={STR.loading}
            >
            {mine.length === 0 ? (
              <Muted style={{ marginTop: space(2) }}>{STR.cmNoMyComments}</Muted>
            ) : (
              mine.map((c) => {
                const discarded = !!c.discardedAt;
                return (
                <Card
                  key={c.id}
                  onPress={
                    discarded
                      ? undefined
                      : () =>
                          nav.navigate("CommentEntry", {
                            sectionId: c.sectionId,
                            studentId: c.studentId,
                            studentName: c.studentName,
                            commentId: c.id,
                          })
                  }
                  style={discarded ? { opacity: 0.6 } : undefined}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Body style={{ fontWeight: "700", flexShrink: 1 }}>{c.studentName}</Body>
                    <Badge
                      text={discarded ? STR.cmDiscardedTag : c.deliveredAt ? STR.cmDeliveredBadge : STR.cmDraftBadge}
                      tone={discarded ? "danger" : c.deliveredAt ? "ok" : "muted"}
                    />
                  </View>
                  <Muted style={{ marginTop: 2 }}>
                    {commentTypeLabel(c.type)} · {commentSentimentLabel(c.sentiment)} ·{" "}
                    {isoDateLabel(c.createdAt)}
                  </Muted>
                  <Body
                    style={{ marginTop: space(1), ...(discarded ? { textDecorationLine: "line-through" } : {}) }}
                  >
                    {c.text}
                  </Body>
                  {discarded && c.discardReason ? (
                    <Muted style={{ marginTop: space(1), fontStyle: "italic" }}>
                      {STR.cmDiscardedTag}: {c.discardReason}
                    </Muted>
                  ) : null}
                </Card>
                );
              })
            )}
            </QueryGate>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
