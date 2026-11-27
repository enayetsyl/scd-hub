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
 *
 * RF-1 (25 Nov 2026): "My reviews" is the "বাকি" list on top and three CLOSED folds below it
 * (অনুমোদন দিয়েছি · পরিবর্তন চেয়েছি · চূড়ান্ত). RF-2: the Principal also sees the
 * "চূড়ান্তের পরিবর্তন অনুরোধ" section here.
 */
import React, { useState, useMemo, useRef, useCallback } from "react";
import { View, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useMutation } from "urql";
import { SUBJECTS, CLASS_LEVELS, PLAN_DOC_TYPES } from "@scd/shared";
import {
  APPROVE_PLAN_BULK,
  PLAN_REVIEW_INBOX,
  type ReviewAssignmentT,
} from "../../graphql/operations";
import {
  MY_PLAN_REVIEW_BUCKETS,
  MY_REVIEW_ASSIGNMENTS_BUCKET,
  MY_GOLD_CHANGE_REQUESTS,
  type GoldChangeRequestT,
  type ReviewBucketKey,
} from "../../graphql/reviewFolds";
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
  Field,
} from "../../components/ui";
import { BucketFold, BucketList } from "../../components/BucketFold";
import { GoldChangeAsk, GoldChangeSection, PlanMarkdownFold } from "../../components/GoldChange";
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
      if (canReview) mineChangedRef.current();
    }, [canAssign, canReview, refetchInbox]),
  );

  const inbox = inboxData?.planReviewInbox ?? [];

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

  // My-reviews filters (RF-1): every axis applies to the "বাকি" list AND to every fold.
  const [subject, setSubject] = useState<string | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);
  const [docType, setDocType] = useState<string | null>(null);
  const [chapter, setChapter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** Title / chapter number / session number. Reaches the query after a short pause. */
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState<string | null>(null);
  React.useEffect(() => {
    const h = setTimeout(() => setSearch(searchInput.trim() === "" ? null : searchInput.trim()), 400);
    return () => clearTimeout(h);
  }, [searchInput]);
  const chapterKey = chapter.trim() === "" ? null : chapter.trim();
  const baseFilter = useMemo(
    () => ({ subject, classLevel, docType, search, chapter: chapterKey }),
    [subject, classLevel, docType, search, chapterKey],
  );
  const [bucketsQ, refetchBuckets] = useQuery({ query: MY_PLAN_REVIEW_BUCKETS, variables: baseFilter, pause: !canReview });
  const counts = bucketsQ.data?.myPlanReviewBuckets;
  const [requestsQ, refetchRequests] = useQuery({ query: MY_GOLD_CHANGE_REQUESTS, pause: !canReview });
  const requestByArtifact = useMemo(() => {
    const m = new Map<string, GoldChangeRequestT>();
    for (const r of requestsQ.data?.myGoldChangeRequests ?? []) if (!m.has(r.artifactId)) m.set(r.artifactId, r);
    return m;
  }, [requestsQ.data]);
  /** Bumped on focus / after a request, so every OPEN fold reloads. */
  const [foldTick, setFoldTick] = useState(0);
  const mineChanged = useCallback(() => {
    refetchBuckets({ requestPolicy: "network-only" });
    refetchRequests({ requestPolicy: "network-only" });
    setFoldTick((t) => t + 1);
  }, [refetchBuckets, refetchRequests]);
  const mineChangedRef = useRef(mineChanged);
  mineChangedRef.current = mineChanged;


  /** One plan round as a card. "বাকি" and the approved/changes folds open the review form (a decided round
   *  arrives with its verdict + feedback prefilled); a FINAL round can only propose a change (RF-2). */
  function planRow(r: ReviewAssignmentT, bucket: ReviewBucketKey): React.ReactElement {
    const decided = r.status === "submitted";
    if (bucket === "final") {
      return (
        <Card key={r.id} style={{ marginBottom: space(3) }}>
          {/* Title gets the full width; the long "final" badge sits with the others (390 dp walk). */}
          <Body style={{ fontWeight: "700" }}>{planTitle(r)}</Body>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), marginTop: 4 }}>
            <Badge text={STR.rfFinal} tone="ok" />
            <Badge text={docTypeLabel(r.docType)} tone="info" />
            {r.verdict ? <Badge text={reviewVerdictLabel(r.verdict)} tone="ok" /> : null}
          </View>
          {r.feedback ? <Muted style={{ marginTop: 4 }}>{r.feedback}</Muted> : null}
          <PlanMarkdownFold artifactId={r.artifactId} />
          <GoldChangeAsk
            artifactId={r.artifactId}
            isQuestion={false}
            existing={requestByArtifact.get(r.artifactId)}
            onSent={mineChanged}
          />
        </Card>
      );
    }
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
        {decided && r.feedback ? <Muted style={{ marginTop: 4 }}>{r.feedback}</Muted> : null}
      </Card>
    );
  }

  const activeFilters = useMemo(
    () =>
      [
        subject ? subjectLabel(subject) : null,
        classLevel != null ? classLevelLabel(classLevel) : null,
        docType ? docTypeLabel(docType) : null,
        search,
        chapterKey,
      ]
        .filter(Boolean)
        .join(" · "),
    [subject, classLevel, docType, search, chapterKey],
  );

  return (
    <Screen scroll>
      {can("review_program:supervise") ? (
        <Card onPress={() => navigation.navigate("ReviewSupervision")}>
          <Body style={{ fontWeight: "700" }}>{STR.rspNav}</Body>
          <Muted style={{ marginTop: 2 }}>{STR.rspSubtitle}</Muted>
        </Card>
      ) : null}
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

      {/* RF-2: the reviewers' requests to change a finalised plan - comment on top, plan below, then decide. */}
      {canSignOff ? <GoldChangeSection kind="plan" enabled={canSignOff} onChanged={() => refetchInbox({ requestPolicy: "network-only" })} /> : null}

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
          <H2>{`${STR.rfPending}${counts ? ` (${bnNum(counts.undecided)})` : ""}`}</H2>

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
                  <Field label={STR.rfSearch} value={searchInput} onChangeText={setSearchInput} />
                  <Field label={STR.rfChapter} value={chapter} onChangeText={setChapter} />
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

          {/* "বাকি": the undecided fold, open, with real server paging (আরও দেখুন). */}
          <BucketList
            key={`pending|${JSON.stringify(baseFilter)}|${foldTick}`}
            query={MY_REVIEW_ASSIGNMENTS_BUCKET}
            variables={{ ...baseFilter, bucket: "undecided" }}
            pick={(d) => d.myReviewAssignmentsBucket}
            renderRow={(row) => planRow(row, "undecided")}
            emptyText={STR.rfAllDone}
          />

          {/* RF-1: her decided plans, in three folds that stay CLOSED until tapped. */}
          <View style={{ marginTop: space(4), gap: space(3) }}>
            {(
              [
                ["approved", STR.rfApproved],
                ["changes", STR.rfChanges],
                ["final", STR.rfFinal],
              ] as [ReviewBucketKey, string][]
            ).map(([bucket, title]) => (
              <BucketFold
                key={bucket}
                id={`rvh:${bucket}`}
                title={title}
                count={counts?.[bucket] ?? 0}
                query={MY_REVIEW_ASSIGNMENTS_BUCKET}
                variables={{ ...baseFilter, bucket }}
                reloadKey={foldTick}
                pick={(d) => d.myReviewAssignmentsBucket}
                renderRow={(row) => planRow(row, bucket)}
              />
            ))}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}
