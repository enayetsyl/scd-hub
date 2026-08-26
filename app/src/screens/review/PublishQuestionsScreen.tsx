/**
 * PublishQuestionsScreen (QR-4 Q4.3/Q4.4; filters + publish-all QR-6, D-#538) — the
 * Principal's three lists.
 *
 *   Accepted (APPROVE)                  → multi-select → Publish, or publish the whole
 *                                          filtered set at once. The normal path.
 *   With condition (APPROVE_WITH_CONDITION) → the reviewer's condition, and a Clear that
 *                                          sends the question BACK to her (D-#525).
 *   Rejected (CHANGES_REQUESTED)        → each with the reviewer's reason (often absent,
 *                                          since it is optional) → "Publish anyway", which
 *                                          opens a MANDATORY reason box.
 *
 * Bulk publish carries no override reason, because an override is a per-question judgement
 * and must be written down each time (Q2.9/Q2.10). Publishing is Principal-locked
 * server-side (content:promote_gold); Office reaching this screen gets a denial, which the
 * ErrorBanner shows in Bangla.
 *
 * Every row now renders its ANSWER (QR-6). It always could — `payloadJson` has been in this
 * query since QR-4 and was thrown away. The reviewer's own queue was given the same
 * treatment in D-#530 after she reported being asked to approve MCQs without being shown
 * the options; the Principal was left judging her conditions the same way. Same component,
 * one screen over.
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { View, Pressable, ScrollView, RefreshControl } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useMutation } from "urql";
import { SUBJECTS, CLASS_LEVELS, QUESTION_TYPES } from "@scd/shared";
import {
  QUESTION_REVIEW_INBOX,
  QUESTION_REVIEW_INBOX_COUNT,
  QUESTION_CHAPTERS_QUERY,
  PUBLISH_QUESTION,
  PUBLISH_QUESTION_BULK,
  PUBLISH_QUESTIONS_MATCHING,
  CLEAR_QUESTION_CONDITION,
  type QuestionReviewRoundT,
} from "../../graphql/operations";
import type { ReviewStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Chip,
  ChipRow,
  Badge,
  Button,
  Field,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
  Divider,
} from "../../components/ui";
import { AnswerCarrier } from "../../components/QuestionAnswer";
import { QuestionEditSheet } from "../../components/QuestionEditSheet";
import { parsePayload, prettyCode } from "../../lib/question";
import {
  STR,
  subjectLabel,
  classLevelLabel,
  bnNum,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ReviewStackParamList, "PublishQuestions">;
type Tab = "APPROVE" | "APPROVE_WITH_CONDITION" | "CHANGES_REQUESTED";

const PAGE_SIZE = 50;

export default function PublishQuestionsScreen({ navigation }: Props): React.ReactElement {
  const colors = useColors();
  const { can } = useAuth();
  /** Principal + Office may correct or retire a question in place (QR-8, D-#548). */
  const mayManage = can("question:manage");
  const [editing, setEditing] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("APPROVE");

  // --- filters (QR-6) — the same axes the assign screen slices on -----------------
  const [subject, setSubject] = useState<string | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);
  const [chapter, setChapter] = useState<number | null>(null);
  const [questionType, setQuestionType] = useState<string | null>(null);
  /** What is typed, and what is actually queried. Kept apart because the search is a regex
   *  over the question bank behind a `$lookup`: firing it per keystroke would run the list
   *  AND the count on every letter, and reset the accumulated pages each time. */
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [clearFor, setClearFor] = useState<string | null>(null);
  const [clearNote, setClearNote] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // --- paging: pages accumulate here, not in the cache, so publishing one row can drop
  //     it without re-pulling every page behind it (the reviewer-queue shape) ---------
  const [offset, setOffset] = useState(0);
  const [rounds, setRounds] = useState<QuestionReviewRoundT[]>([]);
  const [lastPageSize, setLastPageSize] = useState<number | null>(null);

  /** The ONE filter object. Sent verbatim to the list, the count and publish-all, so all
   *  three can only ever mean the same set — which for a one-way operation is the point. */
  const filter = useMemo(
    () => ({
      verdict: tab,
      subject,
      classLevel,
      chapter,
      questionType,
      search: appliedSearch === "" ? null : appliedSearch,
    }),
    [tab, subject, classLevel, chapter, questionType, appliedSearch],
  );

  const [{ data, fetching, error }, refetch] = useQuery({
    query: QUESTION_REVIEW_INBOX,
    variables: { ...filter, limit: PAGE_SIZE, offset },
  });
  const [countQ, refetchCount] = useQuery({
    query: QUESTION_REVIEW_INBOX_COUNT,
    variables: filter,
  });
  const total = countQ.data?.questionReviewInboxCount ?? 0;
  const hasMore = lastPageSize === null ? false : lastPageSize === PAGE_SIZE;

  // Chapter chips only mean something once a subject AND class are chosen.
  const [{ data: chapterData }] = useQuery({
    query: QUESTION_CHAPTERS_QUERY,
    variables: { subject, classLevel },
    pause: !subject || classLevel == null,
  });
  const chapterOptions = chapterData?.questionChapters ?? [];

  const [, publishOne] = useMutation(PUBLISH_QUESTION);
  const [, publishBulk] = useMutation(PUBLISH_QUESTION_BULK);
  const [, publishMatching] = useMutation(PUBLISH_QUESTIONS_MATCHING);
  const [, clearCondition] = useMutation(CLEAR_QUESTION_CONDITION);

  // Settle the typed term before querying, then treat it as any other filter change.
  useEffect(() => {
    const term = search.trim();
    if (term === appliedSearch) return;
    const id = setTimeout(() => {
      setAppliedSearch(term);
      setRounds([]);
      setOffset(0);
      setLastPageSize(null);
      setSelected(new Set());
      setConfirmAll(false);
    }, 400);
    return () => clearTimeout(id);
  }, [search, appliedSearch]);

  useEffect(() => {
    const page = data?.questionReviewInbox;
    if (!page) return;
    setLastPageSize(page.length);
    setRounds((prev) => {
      const byId = new Map(prev.map((r) => [r.id, r]));
      for (const r of page) byId.set(r.id, r);
      return [...byId.values()];
    });
  }, [data]);

  /** Forget every page and pull the first again — after any write, and on focus. */
  const reload = useCallback(() => {
    setRounds([]);
    setOffset(0);
    setLastPageSize(null);
    setSelected(new Set());
    refetch({ requestPolicy: "network-only" });
    refetchCount({ requestPolicy: "network-only" });
  }, [refetch, refetchCount]);

  useFocusEffect(
    useCallback(() => {
      refetch({ requestPolicy: "network-only" });
      refetchCount({ requestPolicy: "network-only" });
    }, [refetch, refetchCount]),
  );

  /** Any filter change invalidates the accumulated pages. */
  function onFilterChange(apply: () => void): void {
    apply();
    setRounds([]);
    setOffset(0);
    setLastPageSize(null);
    setSelected(new Set());
    setConfirmAll(false);
    setNotice(null);
    setFailure(null);
  }

  function switchTab(next: Tab): void {
    if (next === tab) return;
    onFilterChange(() => setTab(next));
    setOverrideFor(null);
    setOverrideReason("");
    setClearFor(null);
    setClearNote("");
  }

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function publishSelected(): Promise<void> {
    if (selected.size === 0) return;
    setBusy(true);
    setFailure(null);
    const res = await publishBulk({ artifactIds: [...selected] });
    setBusy(false);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    const r = res.data?.publishQuestionBulk;
    setNotice(
      r && r.failedCount > 0
        ? `${STR.qrPublished} (${bnNum(r.okCount)} ✓, ${bnNum(r.failedCount)} ✗)`
        : STR.qrPublished,
    );
    reload();
  }

  /**
   * Publish everything matching the filter (QR-6). The server re-derives the set from the
   * same filter rather than trusting a list of ids from the screen — the screen holds only
   * the pages it has scrolled, so sending ids would silently publish "the first 50" while
   * the button said 231.
   */
  async function publishAll(): Promise<void> {
    setBusy(true);
    setFailure(null);
    const res = await publishMatching({ ...filter, verdict: "APPROVE" });
    setBusy(false);
    setConfirmAll(false);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    const r = res.data?.publishQuestionsMatching;
    if (!r) return;
    const parts = [`${STR.qrPublished} (${bnNum(r.okCount)} ✓`];
    if (r.failedCount > 0) parts.push(`, ${bnNum(r.failedCount)} ✗`);
    parts.push(")");
    if (r.remaining > 0) parts.push(` — ${bnNum(r.remaining)}${STR.qrPublishAllRemaining}`);
    setNotice(parts.join(""));
    reload();
  }

  async function publishWithOverride(round: QuestionReviewRoundT): Promise<void> {
    const trimmed = overrideReason.trim();
    if (trimmed === "") {
      setFailure(STR.qrOverrideRequired);
      return;
    }
    setBusy(true);
    setFailure(null);
    const res = await publishOne({ artifactId: round.artifactId, overrideReason: trimmed });
    setBusy(false);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    setOverrideFor(null);
    setOverrideReason("");
    setNotice(STR.qrPublished);
    reload();
  }

  /**
   * Release a conditional hold (D-#525). Deliberately NOT a publish: the server opens a
   * fresh round for the same reviewer, so the person who set the condition is the person
   * who confirms it was met. The row leaves this tab either way, which is why the notice
   * has to say where it went.
   */
  async function clearConditionOn(round: QuestionReviewRoundT): Promise<void> {
    setBusy(true);
    setFailure(null);
    const note = clearNote.trim();
    const res = await clearCondition({
      artifactId: round.artifactId,
      note: note === "" ? null : note,
    });
    setBusy(false);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    setClearFor(null);
    setClearNote("");
    setNotice(STR.qrConditionCleared);
    reload();
  }

  // Reads the APPLIED search, not the typed one — the warning has to describe the set the
  // server is about to publish, not the one the user is mid-way through typing.
  const noFilter =
    subject === null && classLevel === null && chapter === null &&
    questionType === null && appliedSearch === "";

  const scopeLine = [
    subject ? subjectLabel(subject) : null,
    classLevel != null ? classLevelLabel(classLevel) : null,
    chapter != null ? `${STR.qrChapter} ${bnNum(chapter)}` : null,
    questionType ? prettyCode(questionType) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const emptyMessage =
    tab === "APPROVE"
      ? STR.qrNoAccepted
      : tab === "APPROVE_WITH_CONDITION"
        ? STR.qrNoConditional
        : STR.qrNoRejected;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={reload} />}
      >
        <H2>{STR.qrPublishTitle}</H2>
        {error ? <ErrorBanner message={friendlyError(error)} onRetry={reload} /> : null}
        {failure ? <ErrorBanner message={failure} /> : null}
        {notice ? <Notice tone="ok" message={notice} /> : null}

        <ChipRow>
          <Chip label={STR.qrAccepted} selected={tab === "APPROVE"} onPress={() => switchTab("APPROVE")} />
          {/* The third verdict had no tab at all until QR-5, so a conditional approval was
              invisible here and the question simply stalled. */}
          <Chip
            label={STR.qrConditional}
            selected={tab === "APPROVE_WITH_CONDITION"}
            onPress={() => switchTab("APPROVE_WITH_CONDITION")}
          />
          <Chip
            label={STR.qrRejected}
            selected={tab === "CHANGES_REQUESTED"}
            onPress={() => switchTab("CHANGES_REQUESTED")}
          />
        </ChipRow>

        {/* --- filters (QR-6) ------------------------------------------------------ */}
        <ChipRow>
          <Chip label={STR.all} selected={subject === null} onPress={() => onFilterChange(() => { setSubject(null); setChapter(null); })} />
          {SUBJECTS.map((s) => (
            <Chip
              key={s}
              label={subjectLabel(s)}
              selected={subject === s}
              onPress={() => onFilterChange(() => { setSubject(subject === s ? null : s); setChapter(null); })}
            />
          ))}
        </ChipRow>
        <ChipRow>
          <Chip label={STR.all} selected={classLevel === null} onPress={() => onFilterChange(() => { setClassLevel(null); setChapter(null); })} />
          {CLASS_LEVELS.map((c) => (
            <Chip
              key={c}
              label={classLevelLabel(c)}
              selected={classLevel === c}
              onPress={() => onFilterChange(() => { setClassLevel(classLevel === c ? null : c); setChapter(null); })}
            />
          ))}
        </ChipRow>
        <ChipRow>
          <Chip label={STR.all} selected={questionType === null} onPress={() => onFilterChange(() => setQuestionType(null))} />
          {QUESTION_TYPES.map((q) => (
            <Chip
              key={q}
              label={prettyCode(q)}
              selected={questionType === q}
              onPress={() => onFilterChange(() => setQuestionType(questionType === q ? null : q))}
            />
          ))}
        </ChipRow>
        {chapterOptions.length > 0 ? (
          <ChipRow>
            <Chip label={STR.all} selected={chapter === null} onPress={() => onFilterChange(() => setChapter(null))} />
            {chapterOptions.map((c) => (
              <Chip
                key={c}
                label={bnNum(c)}
                selected={chapter === c}
                onPress={() => onFilterChange(() => setChapter(chapter === c ? null : c))}
              />
            ))}
          </ChipRow>
        ) : null}
        <Field label={STR.qrSearchQuestion} value={search} onChangeText={setSearch} />

        <Muted>
          {bnNum(total)}
          {STR.qrMatched}
          {rounds.length > 0 && rounds.length < total ? `  ·  ${bnNum(rounds.length)} / ${bnNum(total)}` : ""}
        </Muted>

        {/* --- actions ------------------------------------------------------------- */}
        {tab === "APPROVE" && total > 0 ? (
          confirmAll ? (
            <Card style={{ marginTop: space(2) }}>
              <Body style={{ fontWeight: "700" }}>
                {bnNum(total)}
                {STR.qrPublishAllConfirm}
              </Body>
              {scopeLine !== "" ? <Muted>{scopeLine}</Muted> : null}
              {noFilter ? <Notice tone="warn" message={STR.qrPublishAllNoFilter} /> : null}
              <Muted style={{ marginTop: space(1) }}>{STR.qrPublishAllWarn}</Muted>
              <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                <Button title={STR.qrPublishAllGo} loading={busy} onPress={() => void publishAll()} />
                <Button title={STR.cancel} variant="ghost" onPress={() => setConfirmAll(false)} />
              </View>
            </Card>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
              <Muted>{`${bnNum(selected.size)} ${STR.qrSelected}`}</Muted>
              <Button
                title={STR.qrPublishSelected}
                loading={busy}
                disabled={selected.size === 0}
                onPress={() => void publishSelected()}
              />
              <Button
                title={`${STR.qrPublishAll} (${bnNum(total)})`}
                variant="secondary"
                disabled={busy}
                onPress={() => setConfirmAll(true)}
              />
            </View>
          )
        ) : null}

        <Divider />

        {fetching && rounds.length === 0 ? (
          <Loader label={STR.loading} />
        ) : rounds.length === 0 ? (
          <EmptyState message={emptyMessage} />
        ) : (
          <>
            {rounds.map((round) => {
              const isSelected = selected.has(round.artifactId);
              const overrideOpen = overrideFor === round.id;
              const hasReason = round.reason != null && round.reason.trim() !== "";
              return (
                <Card key={round.id} style={{ marginBottom: space(3) }}>
                  <Pressable
                    onPress={() => (tab === "APPROVE" ? toggle(round.artifactId) : undefined)}
                    disabled={tab !== "APPROVE"}
                  >
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
                      {tab === "APPROVE" ? (
                        <Badge text={isSelected ? "✓" : "○"} tone={isSelected ? "ok" : "muted"} />
                      ) : null}
                      <Badge text={subjectLabel(round.subject)} />
                      <Badge text={classLevelLabel(round.classLevel)} />
                      {round.questionType ? <Badge text={prettyCode(round.questionType)} /> : null}
                      {round.reviewerName ? <Badge text={round.reviewerName} /> : null}
                      {/* The mark, carried onto the publish queue too (QR-9, D-#550): the
                          Principal deciding what reaches the shelf should see what the
                          reviewer flagged while reading it. */}
                      {round.important ? <Badge text={STR.qImportant} tone="gold" /> : null}
                    </View>
                    <Body>{round.questionText ?? round.qid ?? "—"}</Body>
                    {round.qid ? <Muted>{round.qid}</Muted> : null}
                    {/* The options and the answer key. Without these the Principal is asked
                        to judge a condition against a question they cannot fully see. */}
                    <AnswerCarrier payload={parsePayload(round.payloadJson)} correctColor={colors.primary} />
                  </Pressable>

                  {tab === "APPROVE_WITH_CONDITION" ? (
                    <>
                      {/* Attributed, because it is the reviewer's own wording — the whole
                          message she sent, not a system label. */}
                      <Muted style={{ marginTop: space(2) }}>
                        {STR.qrCondition}
                        {round.reviewerName ? ` — ${round.reviewerName}` : ""}:{" "}
                        {hasReason ? round.reason : "—"}
                      </Muted>
                      <Divider />
                      {clearFor === round.id ? (
                        <View>
                          <Muted>{STR.qrClearConditionHint}</Muted>
                          <Field
                            label={STR.qrClearNote}
                            value={clearNote}
                            onChangeText={setClearNote}
                            multiline
                          />
                          <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                            <Button
                              title={STR.qrClearCondition}
                              loading={busy}
                              onPress={() => void clearConditionOn(round)}
                            />
                            <Button
                              title={STR.cancel}
                              variant="ghost"
                              onPress={() => {
                                setClearFor(null);
                                setClearNote("");
                              }}
                            />
                          </View>
                        </View>
                      ) : (
                        <Button
                          title={STR.qrClearCondition}
                          variant="secondary"
                          onPress={() => {
                            setClearFor(round.id);
                            setClearNote("");
                          }}
                        />
                      )}
                    </>
                  ) : null}

                  {tab === "CHANGES_REQUESTED" ? (
                    <>
                      {/* The reason is optional, so its absence is normal and must read as
                          "none given" rather than looking like a loading state. */}
                      <Muted style={{ marginTop: space(2) }}>
                        {STR.qrReviewerSaid}
                        {round.reviewerName ? ` — ${round.reviewerName}` : ""}:{" "}
                        {hasReason ? round.reason : "—"}
                      </Muted>
                      <Divider />
                      {overrideOpen ? (
                        <View>
                          <Field
                            label={STR.qrOverrideReason}
                            value={overrideReason}
                            onChangeText={setOverrideReason}
                            multiline
                          />
                          <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                            <Button
                              title={STR.qrPublish}
                              loading={busy}
                              disabled={overrideReason.trim() === ""}
                              onPress={() => void publishWithOverride(round)}
                            />
                            <Button
                              title={STR.cancel}
                              variant="ghost"
                              onPress={() => {
                                setOverrideFor(null);
                                setOverrideReason("");
                              }}
                            />
                          </View>
                        </View>
                      ) : (
                        <Button
                          title={STR.qrPublishAnyway}
                          variant="secondary"
                          onPress={() => {
                            setOverrideFor(round.id);
                            setOverrideReason("");
                          }}
                        />
                      )}
                    </>
                  ) : null}

                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                    <Button
                      title={STR.reviewThread}
                      variant="ghost"
                      onPress={() => navigation.navigate("QuestionReviewThread", { artifactId: round.artifactId })}
                    />
                    {/* The missing half of the loop (QR-8): a reviewer's condition asks for
                        the answer to change, and until now nobody could change it. */}
                    {mayManage ? (
                      <Button
                        title={STR.qeEdit}
                        variant="ghost"
                        onPress={() => setEditing(editing === round.id ? null : round.id)}
                      />
                    ) : null}
                  </View>

                  {mayManage && editing === round.id ? (
                    <QuestionEditSheet
                      artifactId={round.artifactId}
                      payload={parsePayload(round.payloadJson)}
                      isPublished={round.artifactReviewStatus === "gold"}
                      onDone={(message) => {
                        setEditing(null);
                        setNotice(message);
                        reload();
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  ) : null}
                </Card>
              );
            })}
            {hasMore ? (
              <Button
                title={STR.qrLoadMore}
                variant="secondary"
                disabled={fetching}
                onPress={() => setOffset(rounds.length)}
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
