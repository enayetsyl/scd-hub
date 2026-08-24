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
import React, { useState, useCallback, useEffect } from "react";
import { View, ScrollView, RefreshControl } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useMutation } from "urql";
import {
  MY_QUESTION_REVIEWS,
  MY_QUESTION_REVIEW_COUNT,
  SUBMIT_QUESTION_REVIEW,
  SUBMIT_QUESTION_REVIEW_BULK,
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
import { parsePayload } from "../../lib/question";
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
  const PAGE_SIZE = 50;
  const [offset, setOffset] = useState(0);
  /** Pages accumulated so far. Held here, not in the cache, so a verdict can drop
   *  ONE row without re-pulling every page behind it. */
  const [rows, setRows] = useState<QuestionReviewRoundT[]>([]);

  const [{ data, fetching, error }, refetch] = useQuery({
    query: MY_QUESTION_REVIEWS,
    variables: { limit: PAGE_SIZE, offset },
  });
  const [countQ, refetchCount] = useQuery({ query: MY_QUESTION_REVIEW_COUNT });
  const total = countQ.data?.myQuestionReviewCount ?? 0;

  // Append each arriving page. Keyed by id so a re-fetch of the same page
  // replaces rather than duplicates.
  useEffect(() => {
    const page = data?.myQuestionReviews;
    if (!page) return;
    setRows((prev) => {
      const byId = new Map(prev.map((r) => [r.id, r]));
      for (const r of page) byId.set(r.id, r);
      return [...byId.values()];
    });
  }, [data?.myQuestionReviews]);

  /** Forget every page and pull the first again — used on pull-to-refresh and on focus. */
  const reload = useCallback(() => {
    setRows([]);
    setOffset(0);
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
  const colors = useColors();

  /** Rounds ticked for a bulk verdict (D-#527). Ids, so a refetch cannot desync them. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkReason, setBulkReason] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

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
  const hasMore = rows.length < total;

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
            refreshing={fetching}
            onRefresh={reload}
          />
        }
      >
        <H2>{STR.qrMyQueue}</H2>
        {/* A page is not the queue. Without this, 50 rows out of 2,742 reads as
            'you are nearly done' — the opposite of the truth. */}
        {total > 0 ? (
          <Muted>
            {bnNum(rounds.length)} / {bnNum(total)}
          </Muted>
        ) : null}
        {error ? <ErrorBanner message={friendlyError(error)} /> : null}
        {failure ? <ErrorBanner message={failure} /> : null}
        {notice ? <Notice tone="ok" message={notice} /> : null}

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

        {rounds.length > 0 ? (
          <LoadOlder
            onPress={() => setOffset(rounds.length)}
            loading={fetching}
            exhausted={!hasMore}
            label={STR.qrLoadMore}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
