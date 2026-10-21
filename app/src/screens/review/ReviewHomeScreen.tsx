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
 *
 * D-#761: both are open-round queues (a round leaves on sign-off / supersede), so the
 * server already bounds them; each list pages on the client, 50 cards a page.
 */
import React, { useState, useMemo, useRef, useCallback } from "react";
import { View, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useMutation } from "urql";
import { SUBJECTS, CLASS_LEVELS, PLAN_DOC_TYPES } from "@scd/shared";
import {
  APPROVE_PLAN_BULK,
  MY_REVIEW_ASSIGNMENTS,
  PLAN_REVIEW_INBOX,
  type ReviewAssignmentT,
} from "../../graphql/operations";
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
  Button,
} from "../../components/ui";
import { SelectableCard } from "../../components/SelectableCard";
import { useToast } from "../../state/ToastContext";
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
import { usePagedRows } from "../../lib/paging";
import { Pager } from "../../components/Pager";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ReviewStackParamList, "ReviewHome">;

/** subject · class · পাঠ N [· সেশন K] [· title]. The session number is what tells three
 *  session plans of one chapter apart — without it they read as one card three times
 *  (owner report 2026-10-12). */
function planTitle(r: ReviewAssignmentT): string {
  const session =
    r.docType === "session_plan" && r.sessionIndex != null ? ` · ${STR.spSession} ${bnNum(r.sessionIndex)}` : "";
  const title = r.title ? ` · ${r.title}` : "";
  return `${subjectLabel(r.subject)} · ${classLevelLabel(r.classLevel)} · ${r.anchorWord} ${bnNum(r.addressNumber)}${session}${title}`;
}

/** A card the Principal can sign off in a batch: the reviewer approved it AND the plan is
 *  `reviewed`. Anything else needs a one-at-a-time decision in its thread (an override
 *  needs a reason), so it stays out of the selectable group. */
function readyToSignOff(r: ReviewAssignmentT): boolean {
  return r.verdict === "APPROVE" && r.artifactReviewStatus === "reviewed";
}

export default function ReviewHomeScreen({ navigation }: Props): React.ReactElement {
  const { role, can } = useAuth();
  // Plan loop (PR-1..3) and question loop (QR-4) gate on their own features (PM, D-#790).
  const canAssign = can("plan_review:assign");
  const canReview = can("plan_review:review");
  const canReviewQuestions = can("question_review:review");
  const canAssignQuestions = can("question_review:assign");
  // The publish + progress screens read the inbox / reviewer tallies (question_review:view_all).
  const canSeeQuestionReviews = can("question_review:view_all");

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

  // Inbox, split by what the Principal has to DO (owner ask 2026-10-12): the reviewer-
  // approved plans are a sign-off pile, cleared in one go; the rest need a decision each.
  const canSignOff = can("plan_review:approve");
  const readyRows = useMemo(() => inbox.filter(readyToSignOff), [inbox]);
  const otherRows = useMemo(() => inbox.filter((r) => !readyToSignOff(r)), [inbox]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Only ids still on the ready pile count — a refetch can drop a row the user had ticked.
  const pickedIds = useMemo(
    () => readyRows.map((r) => r.artifactId).filter((id) => picked.has(id)),
    [readyRows, picked],
  );
  const { shown: readyShown, pager: readyPager } = usePagedRows(readyRows);
  const { shown: otherShown, pager: otherPager } = usePagedRows(otherRows);
  // Select all = this page's ready cards (D-#761); ticks on other pages are kept.
  const allPicked = readyShown.length > 0 && readyShown.every((r) => picked.has(r.artifactId));
  const [signingOff, setSigningOff] = useState(false);
  const [, approveBulk] = useMutation(APPROVE_PLAN_BULK);
  const toast = useToast();

  function togglePick(artifactId: string): void {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(artifactId)) next.delete(artifactId);
      else next.add(artifactId);
      return next;
    });
  }

  async function signOffPicked(): Promise<void> {
    if (pickedIds.length === 0 || signingOff) return;
    setSigningOff(true);
    const res = await approveBulk({ artifactIds: pickedIds });
    setSigningOff(false);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    const r = res.data?.approvePlanBulk;
    toast.show(
      r && r.failedCount > 0
        ? `${STR.rvSignedOff} (${bnNum(r.okCount)} ✓, ${bnNum(r.failedCount)} ✗)`
        : `${STR.rvSignedOff} (${bnNum(r?.okCount ?? pickedIds.length)})`,
      r && r.failedCount > 0 ? "danger" : "ok",
    );
    setPicked(new Set());
    // Signed-off rounds are closed server-side, so they drop off this list on refetch.
    refetchInbox({ requestPolicy: "network-only" });
  }

  function inboxCard(r: ReviewAssignmentT, selectable: boolean): React.ReactElement {
    const open = () => navigation.navigate("ReviewThread", { artifactId: r.artifactId });
    const body = (
      <>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
          <Body style={{ flex: 1, fontWeight: "700" }}>{planTitle(r)}</Body>
          {/* The REVIEWER's verdict — worded as a status so it does not read as a button. */}
          <Badge
            text={`${STR.rvReviewer}: ${reviewVerdictLabel(r.verdict)}`}
            tone={r.verdict === "APPROVE" ? "ok" : "warn"}
          />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), marginTop: 4 }}>
          <Badge text={docTypeLabel(r.docType)} tone="info" />
          <Muted style={{ flex: 1 }}>
            {STR.reviewRound} {bnNum(r.roundNumber)}
            {r.reviewerName ? ` · ${r.reviewerName}` : ""}
          </Muted>
        </View>
        {r.feedback ? <Muted style={{ marginTop: 4 }}>{r.feedback}</Muted> : null}
      </>
    );
    return selectable ? (
      <SelectableCard key={r.id} selected={picked.has(r.artifactId)} onToggle={() => togglePick(r.artifactId)} onPress={open}>
        {body}
      </SelectableCard>
    ) : (
      <Card key={r.id} onPress={open}>
        {body}
      </Card>
    );
  }

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
  const { shown: mineShown, pager: minePager } = usePagedRows(filteredMine, {
    resetKey: `${subject}|${classLevel}|${docType}`,
  });

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
      {/* Question review & publish (QR-4, D-#508) — a separate workspace from the plan
          loop above: different unit of work (one question, bulk-assigned), different
          rules (optional rejection reason), and a publish step plans do not have. */}
      {canReviewQuestions ? (
        <Card onPress={() => navigation.navigate("QuestionReviewQueue")}>
          <Body style={{ fontWeight: "700" }}>{STR.qrMyQueue}</Body>
          <Muted style={{ marginTop: 2 }}>{STR.qrQueueTitle}</Muted>
        </Card>
      ) : null}
      {canAssignQuestions || canSeeQuestionReviews ? (
        <View style={{ marginBottom: space(4) }}>
          {canAssignQuestions ? (
            <>
              <View style={{ height: space(3) }} />
              <Card onPress={() => navigation.navigate("AssignQuestions")}>
                <Body style={{ fontWeight: "700" }}>{STR.qrAssignTitle}</Body>
                <Muted style={{ marginTop: 2 }}>{STR.rvAssign}</Muted>
              </Card>
            </>
          ) : null}
          {canSeeQuestionReviews ? (
            <>
              <View style={{ height: space(3) }} />
              <Card onPress={() => navigation.navigate("PublishQuestions")}>
                <Body style={{ fontWeight: "700" }}>{STR.qrPublishTitle}</Body>
                <Muted style={{ marginTop: 2 }}>{`${STR.qrAccepted} · ${STR.qrRejected}`}</Muted>
              </Card>
              <View style={{ height: space(3) }} />
              {/* QR-5 (D-#537): the assign and publish cards are both about QUESTIONS; this
                  one is about the PEOPLE reviewing them. */}
              <Card onPress={() => navigation.navigate("QuestionReviewProgress")}>
                <Body style={{ fontWeight: "700" }}>{STR.qpTitle}</Body>
                <Muted style={{ marginTop: 2 }}>{STR.qpSubtitle}</Muted>
              </Card>
            </>
          ) : null}
        </View>
      ) : null}

      {canAssign || canReview || canReviewQuestions || canAssignQuestions || canSeeQuestionReviews ? <Divider /> : null}

      {canAssign ? (
        <View style={{ marginBottom: space(4) }}>
          <Card onPress={() => navigation.navigate("AssignReviews")}>
            <Body style={{ fontWeight: "700" }}>{STR.rvAssignTitle}</Body>
            <Muted style={{ marginTop: 2 }}>{STR.rvAssign}</Muted>
          </Card>
          <Card onPress={() => navigation.navigate("PlanReviewBoard")}>
            <Body style={{ fontWeight: "700" }}>{STR.prbTitle}</Body>
            <Muted style={{ marginTop: 2 }}>{STR.prbSubtitle}</Muted>
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
            <>
              {/* 1 — the sign-off pile. Tick (or Select all), then one button; signed-off
                  plans close their round and leave the inbox. Office sees the pile but
                  cannot sign off (plan_review:approve is Principal-only by default). */}
              {readyRows.length > 0 ? (
                <View style={{ marginBottom: space(3) }}>
                  <Body style={{ fontWeight: "700", marginTop: space(2) }}>
                    {STR.rvInboxReady} ({bnNum(readyRows.length)})
                  </Body>
                  {canSignOff ? (
                    <>
                      <Muted style={{ marginBottom: space(2) }}>{STR.rvInboxReadyHint}</Muted>
                      <View
                        style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), marginBottom: space(2) }}
                      >
                        <Chip
                          label={readyRows.length > readyShown.length ? STR.rvSelectPage : STR.qrSelectAll}
                          selected={allPicked}
                          onPress={() =>
                            setPicked((prev) => {
                              const next = new Set(prev);
                              for (const r of readyShown) {
                                if (allPicked) next.delete(r.artifactId);
                                else next.add(r.artifactId);
                              }
                              return next;
                            })
                          }
                        />
                        <Button
                          title={`${STR.rvSignOffSelected} (${bnNum(pickedIds.length)})`}
                          onPress={() => void signOffPicked()}
                          loading={signingOff}
                          disabled={signingOff || pickedIds.length === 0}
                        />
                      </View>
                    </>
                  ) : null}
                  {readyShown.map((r) => inboxCard(r, canSignOff))}
                  <Pager {...readyPager} />
                </View>
              ) : null}

              {/* 2 — everything else: changes requested (a new version to import, or an
                  override with a reason) — one decision each, in the thread. */}
              {otherRows.length > 0 ? (
                <View>
                  <Body style={{ fontWeight: "700", marginTop: space(2), marginBottom: space(2) }}>
                    {STR.rvInboxNeedsAction} ({bnNum(otherRows.length)})
                  </Body>
                  {otherShown.map((r) => inboxCard(r, false))}
                  <Pager {...otherPager} />
                </View>
              ) : null}
            </>
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
            mineShown.map((r) => {
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
          <Pager {...minePager} />
        </View>
      ) : null}
    </Screen>
  );
}
