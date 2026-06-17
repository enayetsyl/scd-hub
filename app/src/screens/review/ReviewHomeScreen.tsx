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
import React, { useState, useMemo, useRef, useCallback } from "react";
import { View, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery } from "urql";
import { roleHasPermission, SUBJECTS, CLASS_LEVELS, PLAN_DOC_TYPES } from "@scd/shared";
import { MY_REVIEW_ASSIGNMENTS, PLAN_REVIEW_INBOX, type ReviewAssignmentT } from "../../graphql/operations";
import type { ReviewStackParamList } from "../../navigation/types";
import { useAuth } from "../../auth/AuthContext";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Chip,
  ChipRow,
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
  docTypeLabel,
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

  // Refetch both queues when the tab regains focus (e.g. after submitting/resubmitting a
  // review) so verdicts update without a reload. Skip the initial mount (already fetched).
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      if (canAssign) refetchInbox({ requestPolicy: "network-only" });
      if (canReview) refetchMine({ requestPolicy: "network-only" });
    }, [canAssign, canReview, refetchInbox, refetchMine]),
  );

  const inbox = inboxData?.planReviewInbox ?? [];
  const mine = mineData?.myReviewAssignments ?? [];

  // My-reviews filters (client-side over the caller's own rounds, like the Content tab).
  const [subject, setSubject] = useState<string | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);
  const [docType, setDocType] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filteredMine = useMemo(
    () =>
      mine.filter(
        (r) =>
          (!subject || r.subject === subject) &&
          (classLevel == null || r.classLevel === classLevel) &&
          (!docType || r.docType === docType),
      ),
    [mine, subject, classLevel, docType],
  );

  const activeFilters = useMemo(
    () =>
      [
        subject ? subjectLabel(subject) : null,
        classLevel != null ? classLevelLabel(classLevel) : null,
        docType ? docTypeLabel(docType) : null,
      ]
        .filter(Boolean)
        .join(" · "),
    [subject, classLevel, docType],
  );

  return (
    <Screen scroll>
      {canAssign ? (
        <View style={{ marginBottom: space(4) }}>
          <Card onPress={() => navigation.navigate("AssignReviews")}>
            <Body style={{ fontWeight: "700" }}>{STR.rvAssignTitle}</Body>
            <Muted style={{ marginTop: 2 }}>{STR.rvAssign}</Muted>
          </Card>
          <View style={{ height: space(3) }} />
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

          {mine.length > 0 ? (
            <View style={{ marginBottom: space(2) }}>
              <Pressable
                onPress={() => setFiltersOpen((o) => !o)}
                accessibilityRole="button"
                style={{ flexDirection: "row", alignItems: "center", gap: space(2), paddingVertical: space(1) }}
              >
                <Body style={{ fontWeight: "700" }}>{STR.filters}</Body>
                {!filtersOpen && activeFilters ? (
                  <Muted style={{ flex: 1 }}>{activeFilters}</Muted>
                ) : (
                  <View style={{ flex: 1 }} />
                )}
                <Body style={{ fontWeight: "700" }}>{filtersOpen ? "▾" : "▸"}</Body>
              </Pressable>

              {filtersOpen ? (
                <>
                  <Muted>{STR.subject}</Muted>
                  <ChipRow>
                    <Chip label={STR.all} selected={subject === null} onPress={() => setSubject(null)} />
                    {SUBJECTS.map((s) => (
                      <Chip key={s} label={subjectLabel(s)} selected={subject === s} onPress={() => setSubject(subject === s ? null : s)} />
                    ))}
                  </ChipRow>
                  <Muted>{STR.classLevel}</Muted>
                  <ChipRow>
                    <Chip label={STR.all} selected={classLevel === null} onPress={() => setClassLevel(null)} />
                    {CLASS_LEVELS.map((c) => (
                      <Chip key={c} label={bnNum(c)} selected={classLevel === c} onPress={() => setClassLevel(classLevel === c ? null : c)} />
                    ))}
                  </ChipRow>
                  <Muted>{STR.planType}</Muted>
                  <ChipRow>
                    <Chip label={STR.all} selected={docType === null} onPress={() => setDocType(null)} />
                    {PLAN_DOC_TYPES.map((t) => (
                      <Chip key={t} label={docTypeLabel(t)} selected={docType === t} onPress={() => setDocType(docType === t ? null : t)} />
                    ))}
                  </ChipRow>
                </>
              ) : null}
            </View>
          ) : null}

          {mineErr ? (
            <ErrorBanner message={friendlyError(mineErr)} onRetry={() => refetchMine({ requestPolicy: "network-only" })} />
          ) : mineFetching ? (
            <Loader label={STR.loading} />
          ) : mine.length === 0 ? (
            <EmptyState message={STR.noMyReviews} />
          ) : filteredMine.length === 0 ? (
            <EmptyState message={STR.empty} />
          ) : (
            filteredMine.map((r) => {
              const decided = r.status === "submitted";
              return (
                <Card
                  key={r.id}
                  onPress={() =>
                    navigation.navigate("ReviewSubmit", {
                      assignmentId: r.id,
                      artifactId: r.artifactId,
                      initialVerdict: r.verdict,
                      initialFeedback: r.feedback,
                      roundStatus: r.status,
                    })
                  }
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                    <Body style={{ flex: 1, fontWeight: "700" }}>{planTitle(r)}</Body>
                    {decided && r.verdict ? (
                      <Badge text={reviewVerdictLabel(r.verdict)} tone={r.verdict === "APPROVE" ? "ok" : "warn"} />
                    ) : (
                      <Badge text={reviewRoundStatusLabel(r.status)} tone="brand" />
                    )}
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginTop: 4 }}>
                    <Badge text={docTypeLabel(r.docType)} tone="info" />
                    <Muted>
                      {STR.reviewRound} {bnNum(r.roundNumber)}
                    </Muted>
                  </View>
                </Card>
              );
            })
          )}
        </View>
      ) : null}
    </Screen>
  );
}
