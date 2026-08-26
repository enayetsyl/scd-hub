/**
 * QuestionReviewQueueScreen (QR-4, Q4.1) — the reviewer's queue.
 *
 * One card per assigned question with the question rendered in place, and Accept / Reject
 * on the card itself: a reviewer works through dozens of questions here, so making them
 * open a detail screen per question would be the wrong shape entirely.
 *
 * The rejection reason is OPTIONAL (Q2.4 / D-#508) — the box appears on Reject, is labelled
 * as optional, and Reject stays enabled while it is empty. That is the deliberate divergence
 * from the plan loop, where feedback is mandatory on CHANGES_REQUESTED.
 *
 * An already-decided round stays editable until it closes, so the card keeps its verdict
 * badge and the reviewer can change their mind.
 */
import React, { useState, useCallback, useEffect, useMemo } from "react";
import { View, ScrollView, RefreshControl } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useMutation } from "urql";
import {
  MY_QUESTION_REVIEWS,
  MY_QUESTION_REVIEW_COUNT,
  SUBMIT_QUESTION_REVIEW,
  SUBMIT_QUESTION_REVIEW_BULK,
  SET_QUESTION_IMPORTANT,
  QUESTION_CHAPTERS_QUERY,
  type QuestionReviewRoundT,
} from "../../graphql/operations";
import type { ReviewStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Badge,
  Button,
  Field,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
  Divider,
  Chip,
  ChipRow,
} from "../../components/ui";
import { STR, subjectLabel, classLevelLabel, reviewVerdictLabel, bnNum } from "../../lib/labels";
import { SUBJECTS, CLASS_LEVELS, QUESTION_TYPES } from "@scd/shared";
import { parsePayload, prettyCode } from "../../lib/question";
import { AnswerCarrier } from "../../components/QuestionAnswer";
import { LoadOlder } from "../../components/LoadOlder";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { useColors } from "../../theme";

type Props = NativeStackScreenProps<ReviewStackParamList, "QuestionReviewQueue">;

export default function QuestionReviewQueueScreen({ navigation }: Props): React.ReactElement {
  /**
   * PAGE_SIZE mirrors the server default. The queue was an unbounded read: on prod
   * one reviewer held 2,742 assigned rounds, so the screen pulled 1.77 MB and tried
   * to render 2,742 cards — it froze rather than erroring, which is why it was
   * reported as 'the app hangs'.
   */
  /**
   * The QR-11 filter (D-#559). She was handed 2,951 rounds with no way to narrow them.
   * Same axes as the Principal’s publish inbox, plus `undecided` — the one that turns a
   * long history back into a work list.
   */
  const [subject, setSubject] = useState<string | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);
  const [chapter, setChapter] = useState<number | null>(null);
  const [questionType, setQuestionType] = useState<string | null>(null);
  const [important, setImportantOnly] = useState(false);
  const [undecided, setUndecided] = useState(false);

  const PAGE_SIZE = 50;
  const [offset, setOffset] = useState(0);
  /** Pages accumulated so far. Held here, not in the cache, so a verdict can drop
   *  ONE row without re-pulling every page behind it. */
  const [rows, setRows] = useState<QuestionReviewRoundT[]>([]);

  /** ONE filter object, sent to BOTH the list and the count — otherwise the caption reads
   *  ৫০ / ২৯৫১ over a filtered list holding twelve rows. */
  const filter = useMemo(
    () => ({
      subject,
      classLevel,
      chapter,
      questionType,
      important: important ? true : null,
      undecided: undecided ? true : null,
    }),
    [subject, classLevel, chapter, questionType, important, undecided],
  );

  const [{ data, fetching, error }, refetch] = useQuery({
    query: MY_QUESTION_REVIEWS,
    variables: { ...filter, limit: PAGE_SIZE, offset },
  });
  const [countQ, refetchCount] = useQuery({ query: MY_QUESTION_REVIEW_COUNT, variables: filter });

  // Chapter chips only mean something once a subject AND a class are chosen — the same
  // gate the publish inbox uses, and the same query behind it.
  const [{ data: chapterData }] = useQuery({
    query: QUESTION_CHAPTERS_QUERY,
    variables: { subject, classLevel },
    pause: !subject || classLevel == null,
  });
  const chapterOptions = chapterData?.questionChapters ?? [];
  /** Nice-to-have only. It drives the 'N / M' caption and NOTHING else — see hasMore. */
  const total = countQ.data?.myQuestionReviewCount ?? 0;

  /**
   * Whether another page exists, decided from the LAST PAGE'S SIZE rather than from
   * the count.
   *
   * The first cut computed this as `rows.length < total`, which quietly couples the
   * pager's existence to a second query: if the count is slow, refused, or errors,
   * `total` falls back to 0, `hasMore` goes false, and the control renders its
   * exhausted state — a screen with 50 of 2,742 rows and no way to reach the rest,
   * indistinguishable from genuinely having reached the end. A full page is
   * self-contained evidence that there may be more; a short page is the end.
   */
  const [lastPageSize, setLastPageSize] = useState<number | null>(null);
  const hasMore = lastPageSize === null ? false : lastPageSize === PAGE_SIZE;

  /**
   * True only for a PULL-TO-REFRESH, never for a 'load more'.
   *
   * RefreshControl was wired to `fetching`, so every page load animated the
   * spinner in — and a RefreshControl turning on drags the list back to the TOP.
   * Tapping আরও দেখুন therefore threw the reader to the first card, with no way
   * to tell whether anything had been appended.
   */
  const [refreshing, setRefreshing] = useState(false);

  // Append each arriving page. Keyed by id so a re-fetch of the same page
  // replaces rather than duplicates.
  useEffect(() => {
    const page = data?.myQuestionReviews;
    if (!page) return;
    setLastPageSize(page.length);
    setRefreshing(false);
    setRows((prev) => {
      const byId = new Map(prev.map((r) => [r.id, r]));
      for (const r of page) byId.set(r.id, r);
      return [...byId.values()];
    });
  }, [data?.myQuestionReviews]);

  /** Forget every page and pull the first again — used on pull-to-refresh and on focus. */
  const reload = useCallback(() => {
    setRefreshing(true);
    setRows([]);
    setOffset(0);
    setLastPageSize(null);
    refetch({ requestPolicy: "network-only" });
    refetchCount({ requestPolicy: "network-only" });
  }, [refetch, refetchCount]);

  /**
   * Drop rounds that have just been decided, instead of re-pulling the list.
   *
   * Every verdict used to end in refetch(network-only), which re-downloaded the
   * whole queue — that is why approving felt slow in proportion to how much work
   * the reviewer had left. The server has already accepted the verdict; the row
   * simply leaves the queue.
   */
  const dropRows = useCallback((ids: string[]) => {
    const gone = new Set(ids);
    setRows((prev) => prev.filter((r) => !gone.has(r.id)));
  }, []);
  const [, submit] = useMutation(SUBMIT_QUESTION_REVIEW);
  const [, submitBulk] = useMutation(SUBMIT_QUESTION_REVIEW_BULK);
  const [, setImportant] = useMutation(SET_QUESTION_IMPORTANT);
  const colors = useColors();

  /** Rounds ticked for a bulk verdict (D-#527). Ids, so a refetch cannot desync them. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkReason, setBulkReason] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  /**
   * A filter change starts a NEW list, so the accumulated pages must go — they belong to
   * the previous filter. The ticked selection goes with them: a bulk verdict must never
   * carry an id the reviewer can no longer see.
   */
  useEffect(() => {
    setRows([]);
    setOffset(0);
    setLastPageSize(null);
    setSelected(new Set());
  }, [filter]);

  /** Which round has a form open, and WHICH form — reject (reason optional) or
   *  condition (condition mandatory). One at a time, as before (D-#525). */
  const [openFormFor, setOpenFormFor] = useState<{ id: string; mode: "reject" | "condition" } | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const rounds = rows;

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * One verdict across every ticked round (D-#527). APPROVE_WITH_CONDITION is absent by
   * design: a condition is written about ONE question, so it stays a per-card action.
   */
  async function decideSelected(verdict: "APPROVE" | "CHANGES_REQUESTED"): Promise<void> {
    if (selected.size === 0) return;
    setBulkBusy(true);
    setFailure(null);
    const trimmed = bulkReason.trim();
    const res = await submitBulk({
      assignmentIds: [...selected],
      verdict,
      reason: verdict === "CHANGES_REQUESTED" && trimmed !== "" ? trimmed : undefined,
    });
    setBulkBusy(false);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    // Partial success is expected, not an anomaly: a round superseded by a re-import is
    // refused while its neighbours succeed. Show BOTH counts rather than a flat "saved"
    // that would hide the ones which did not land.
    const r = res.data?.submitQuestionReviewBulk;
    setNotice(
      r && r.failedCount > 0
        ? `${STR.qrBulkDone} (${bnNum(r.okCount)} ✓, ${bnNum(r.failedCount)} ✗)`
        : STR.qrBulkDone,
    );
    const decided = [...selected];
    setSelected(new Set());
    setBulkReason("");
    dropRows(decided);
    refetchCount({ requestPolicy: "network-only" });
  }

  /**
   * Raise or lower the IMPORTANT mark from the queue (QR-9, D-#550). The reviewer is the
   * one reading the question closely, so this is where the judgement is actually formed —
   * the server confines her to rounds she holds, so the button can be offered on every
   * card here without a permission check in the UI.
   */
  async function toggleImportant(round: QuestionReviewRoundT): Promise<void> {
    setBusyId(round.id);
    setFailure(null);
    const res = await setImportant({ artifactId: round.artifactId, important: !round.important });
    setBusyId(null);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    setNotice(round.important ? STR.qImportantCleared : STR.qImportantMarked);
    refetch({ requestPolicy: "network-only" });
  }

  async function decide(
    round: QuestionReviewRoundT,
    verdict: "APPROVE" | "APPROVE_WITH_CONDITION" | "CHANGES_REQUESTED",
  ): Promise<void> {
    const trimmed = reason.trim();
    // Guarded here as well as on the server (D-#525): the condition is what someone later
    // has to READ and clear, so an empty one is caught before the round is written, not
    // returned as an error after the reviewer thinks they are done.
    if (verdict === "APPROVE_WITH_CONDITION" && trimmed === "") {
      setFailure(STR.qrConditionRequired);
      return;
    }
    setBusyId(round.id);
    setFailure(null);
    const res = await submit({
      assignmentId: round.id,
      verdict,
      // Empty → undefined: an omitted reason is the normal case on a reject (Q2.4); on a
      // condition it is mandatory and already guaranteed non-empty above.
      reason: verdict !== "APPROVE" && trimmed !== "" ? trimmed : undefined,
    });
    setBusyId(null);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    setOpenFormFor(null);
    setReason("");
    setNotice(STR.qrDecisionSaved);
    dropRows([round.id]);
    refetchCount({ requestPolicy: "network-only" });
  }

  if (fetching && rounds.length === 0) return <Loader />;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={reload}
          />
        }
      >
        <H2>{STR.qrMyQueue}</H2>
        {/* A page is not the queue. Without this, 50 rows out of 2,742 reads as
            'you are nearly done' — the opposite of the truth. */}
        {rounds.length > 0 ? (
          <Muted>
            {total > 0 ? `${bnNum(rounds.length)} / ${bnNum(total)}` : bnNum(rounds.length)}
          </Muted>
        ) : null}
        {error ? <ErrorBanner message={friendlyError(error)} /> : null}
        {failure ? <ErrorBanner message={failure} /> : null}
        {notice ? <Notice tone="ok" message={notice} /> : null}

        {/* --- filters (QR-11, D-#559) ------------------------------------------
            Same axes and same chip shape as the Principal’s publish inbox, so the two
            review screens read alike. Selecting a subject or class clears the chapter,
            because a chapter number only means something inside one of them. */}
        <ChipRow>
          <Chip label={STR.all} selected={subject === null} onPress={() => { setSubject(null); setChapter(null); }} />
          {SUBJECTS.map((s) => (
            <Chip
              key={s}
              label={subjectLabel(s)}
              selected={subject === s}
              onPress={() => { setSubject(subject === s ? null : s); setChapter(null); }}
            />
          ))}
        </ChipRow>
        <ChipRow>
          <Chip label={STR.all} selected={classLevel === null} onPress={() => { setClassLevel(null); setChapter(null); }} />
          {CLASS_LEVELS.map((c) => (
            <Chip
              key={c}
              label={classLevelLabel(c)}
              selected={classLevel === c}
              onPress={() => { setClassLevel(classLevel === c ? null : c); setChapter(null); }}
            />
          ))}
        </ChipRow>
        <ChipRow>
          <Chip label={STR.all} selected={questionType === null} onPress={() => setQuestionType(null)} />
          {QUESTION_TYPES.map((q) => (
            <Chip
              key={q}
              label={prettyCode(q)}
              selected={questionType === q}
              onPress={() => setQuestionType(questionType === q ? null : q)}
            />
          ))}
        </ChipRow>
        {chapterOptions.length > 0 ? (
          <ChipRow>
            <Chip label={STR.all} selected={chapter === null} onPress={() => setChapter(null)} />
            {chapterOptions.map((c) => (
              <Chip key={c} label={bnNum(c)} selected={chapter === c} onPress={() => setChapter(chapter === c ? null : c)} />
            ))}
          </ChipRow>
        ) : null}
        <ChipRow>
          {/* The two axes the publish inbox has no use for: her own marks, and the work
              she has not yet ruled on — which is what makes 2,951 rows a work list. */}
          <Chip label={STR.qrUndecidedOnly} selected={undecided} onPress={() => setUndecided(!undecided)} />
          <Chip label={STR.qImportantOnly} selected={important} onPress={() => setImportantOnly(!important)} />
        </ChipRow>

        {/* Bulk bar (D-#527). A reviewer is handed a whole chapter at once (241 questions
            in the first real assignment), so one card at a time is the bottleneck. */}
        {rounds.length > 0 ? (
          <View style={{ marginBottom: space(3) }}>
            <ChipRow>
              <Chip
                label={STR.qrSelectAll}
                selected={selected.size === rounds.length && rounds.length > 0}
                onPress={() => setSelected(new Set(rounds.map((r) => r.id)))}
              />
              <Chip
                label={STR.qrClearSelection}
                selected={false}
                onPress={() => setSelected(new Set())}
              />
            </ChipRow>
            {selected.size > 0 ? (
              <View style={{ marginTop: space(2) }}>
                <Muted>{`${bnNum(selected.size)} ${STR.qrSelected}`}</Muted>
                <Field
                  label={STR.qrBulkReasonOptional}
                  value={bulkReason}
                  onChangeText={setBulkReason}
                  multiline
                />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                  <Button
                    title={STR.qrAcceptSelected}
                    loading={bulkBusy}
                    onPress={() => void decideSelected("APPROVE")}
                  />
                  <Button
                    title={STR.qrRejectSelected}
                    variant="danger"
                    loading={bulkBusy}
                    onPress={() => void decideSelected("CHANGES_REQUESTED")}
                  />
                </View>
              </View>
            ) : null}
            <Divider />
          </View>
        ) : null}

        {rounds.length === 0 ? (
          <EmptyState message={STR.qrNoQueue} />
        ) : (
          rounds.map((round) => {
            const decided = round.status === "submitted";
            const formOpen = openFormFor?.id === round.id ? openFormFor.mode : null;
            return (
              <Card key={round.id} style={{ marginBottom: space(3) }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
                  <Badge text={subjectLabel(round.subject)} />
                  <Badge text={classLevelLabel(round.classLevel)} />
                  {round.marks != null ? <Badge text={`${STR.qrMarks} ${bnNum(round.marks)}`} /> : null}
                  {decided && round.verdict ? (
                    <Badge
                      text={reviewVerdictLabel(round.verdict)}
                      tone={round.verdict === "APPROVE" ? "ok" : "warn"}
                    />
                  ) : null}
                  <Chip
                    label={STR.qrSelect}
                    selected={selected.has(round.id)}
                    onPress={() => toggle(round.id)}
                  />
                  {/* The mark itself (QR-9, D-#550) — gold, so it reads as “valued” rather
                      than the warn/danger tones this screen already uses for problems. */}
                  {round.important ? <Badge text={STR.qImportant} tone="gold" /> : null}
                  <Chip
                    label={round.important ? STR.qUnmarkImportant : STR.qMarkImportant}
                    selected={round.important}
                    onPress={() => void toggleImportant(round)}
                  />
                </View>

                <Body>{round.questionText ?? "—"}</Body>
                {/* The answer shows BY DEFAULT (owner ruling). 48 of the first chapter’s 241
                    questions are MCQ and 32 fill-in-the-blank, and the reviewer’s actual job is
                    checking that the marked-correct answer IS correct — without this they were
                    approving a stem they had no way to verify. Same renderer as the bank preview
                    and set detail, so all three read identically. */}
                <View style={{ marginTop: space(1) }}>
                  <AnswerCarrier payload={parsePayload(round.payloadJson)} correctColor={colors.primary} />
                </View>
                {round.qid ? <Muted>{round.qid}</Muted> : null}
                {round.artifactSuperseded ? <Notice tone="warn" message={STR.qrRoundClosed} /> : null}

                <Divider />

                {formOpen ? (
                  <View>
                    <Field
                      label={formOpen === "condition" ? STR.qrConditionRequired : STR.qrReasonOptional}
                      value={reason}
                      onChangeText={setReason}
                      multiline
                      helper={formOpen === "condition" ? STR.qrConditionHint : STR.qrReasonHint}
                    />
                    <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                      {formOpen === "condition" ? (
                        <Button
                          title={STR.qrApproveWithCondition}
                          loading={busyId === round.id}
                          disabled={reason.trim() === ""}
                          onPress={() => void decide(round, "APPROVE_WITH_CONDITION")}
                        />
                      ) : (
                        <Button
                          title={STR.qrReject}
                          variant="danger"
                          loading={busyId === round.id}
                          onPress={() => void decide(round, "CHANGES_REQUESTED")}
                        />
                      )}
                      <Button
                        title={STR.cancel}
                        variant="ghost"
                        onPress={() => {
                          setOpenFormFor(null);
                          setReason("");
                        }}
                      />
                    </View>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                    <Button
                      title={STR.qrAccept}
                      loading={busyId === round.id}
                      onPress={() => void decide(round, "APPROVE")}
                    />
                    <Button
                      title={STR.qrApproveWithCondition}
                      variant="secondary"
                      onPress={() => {
                        setOpenFormFor({ id: round.id, mode: "condition" });
                        setReason(round.verdict === "APPROVE_WITH_CONDITION" ? round.reason ?? "" : "");
                      }}
                    />
                    <Button
                      title={STR.qrReject}
                      variant="secondary"
                      onPress={() => {
                        setOpenFormFor({ id: round.id, mode: "reject" });
                        setReason(round.verdict === "CHANGES_REQUESTED" ? round.reason ?? "" : "");
                      }}
                    />
                    <Button
                      title={STR.reviewThread}
                      variant="ghost"
                      onPress={() =>
                        navigation.navigate("QuestionReviewThread", { artifactId: round.artifactId })
                      }
                    />
                  </View>
                )}
              </Card>
            );
          })
        )}

        {/* The N / M caption also sits at the TOP, but a reader who has just
            paged is at the BOTTOM and cannot see it — so the count rides on the
            button itself, which is the only way to tell that a tap added rows. */}
        {rounds.length > 0 ? (
          <LoadOlder
            onPress={() => setOffset(rounds.length)}
            loading={fetching}
            exhausted={!hasMore}
            label={
              total > 0
                ? `${STR.qrLoadMore} (${bnNum(rounds.length)} / ${bnNum(total)})`
                : `${STR.qrLoadMore} (${bnNum(rounds.length)})`
            }
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
