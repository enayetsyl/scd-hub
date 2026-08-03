/**
 * BookReviewScreen (SB-3, D-#410/#424) — the reviewer's lesson list and verdict form.
 *
 * ONE LESSON AT A TIME, expanded in place. A reviewer reads a পাঠ, works the README §7
 * checklist against it, and records APPROVE or CHANGES_REQUESTED. The checklist is not
 * decoration: `checklistPassed` goes true only on APPROVE with every item ticked, and
 * assembly reads that flag. The server derives it — this screen never computes its own
 * version of "passed", it only refuses to submit an APPROVE that would obviously fail,
 * so the reviewer finds out now instead of after a round-trip.
 *
 * ESCALATION IS PART OF REVIEWING, not a separate errand. A reviewer who hits something
 * they cannot rule on needs to hand it up without abandoning the lesson, so the escalate
 * form lives inside the same expanded card, anchored to the lesson it came from (D-#410).
 *
 * Rounds are shown newest-first and never edited: a verdict that was superseded is still
 * what someone decided at the time.
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View, Pressable } from "react-native";
import { useQuery, useMutation } from "urql";
import { BOOK_REVIEW_CHECKLIST, REVIEW_VERDICTS, ESCALATION_TARGETS } from "@scd/shared";
import {
  SUPPORT_BOOKS, SUPPORT_BOOK_LESSONS, SUPPORT_BOOK_REVIEW_ROUNDS,
  SUBMIT_SUPPORT_BOOK_REVIEW, RAISE_SUPPORT_BOOK_ESCALATION,
  type SupportBookT, type SupportBookLessonT, type SupportBookReviewRoundT,
} from "../../graphql/supportBook";
import { Screen, Body, Muted, Card, Select, Badge, Button, Chip, ChipRow, Field, EmptyState, Divider } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, bookChecklistLabel, lessonStateLabel, reviewVerdictLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space, useColors } from "../../theme";

function RoundRow({ round }: { round: SupportBookReviewRoundT }): React.ReactElement {
  return (
    <View style={{ paddingVertical: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
        <Body style={{ fontWeight: "700" }}>{`${STR.sbRound} ${bnNum(round.roundNumber)}`}</Body>
        <View style={{ marginLeft: space(2) }}>
          <Badge
            text={reviewVerdictLabel(round.verdict)}
            tone={round.verdict === "APPROVE" ? "ok" : round.verdict ? "warn" : "muted"}
          />
        </View>
        {/* D-#424: self-review is permitted only for the Principal, and it is STAMPED.
            Showing it here is the whole point of stamping it. */}
        {round.selfReviewed ? (
          <View style={{ marginLeft: space(2) }}>
            <Badge text={STR.sbSelfReviewed} tone="warn" />
          </View>
        ) : null}
      </View>
      {round.checklist.length > 0 ? (
        <Muted style={{ marginTop: 2 }}>
          {round.checklist.map((c) => bookChecklistLabel(c)).join(" · ")}
        </Muted>
      ) : null}
      {round.feedback ? <Body style={{ marginTop: 2, fontSize: 13 }}>{round.feedback}</Body> : null}
    </View>
  );
}

function LessonCard({
  lesson,
  rounds,
  onChanged,
}: {
  lesson: SupportBookLessonT;
  rounds: SupportBookReviewRoundT[];
  onChanged: () => void;
}): React.ReactElement {
  const colors = useColors();
  const [open, setOpen] = useState(false);

  const [ticked, setTicked] = useState<string[]>([]);
  const [verdict, setVerdict] = useState<string>("APPROVE");
  const [feedback, setFeedback] = useState("");
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  const [escOpen, setEscOpen] = useState(false);
  const [escTarget, setEscTarget] = useState<string>("LESSON");
  const [escSubject, setEscSubject] = useState("");
  const [escBody, setEscBody] = useState("");

  const [reviewRes, submitReview] = useMutation(SUBMIT_SUPPORT_BOOK_REVIEW);
  const [escRes, raiseEscalation] = useMutation(RAISE_SUPPORT_BOOK_ESCALATION);

  const allTicked = ticked.length === BOOK_REVIEW_CHECKLIST.length;
  // Refused CLIENT-SIDE only to save a round-trip. The server derives checklistPassed
  // itself and is the authority; this is a courtesy, not a rule.
  const blockedApprove = verdict === "APPROVE" && !allTicked;

  function toggle(item: string): void {
    setTicked((prev) => (prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]));
  }

  async function onSubmit(): Promise<void> {
    setNote(null);
    const res = await submitReview({
      bookId: lesson.bookId,
      lessonNo: lesson.lessonNo,
      verdict,
      checklist: ticked,
      feedback: feedback.trim() || undefined,
    });
    if (res.error) {
      setNote({ text: friendlyError(res.error), bad: true });
      return;
    }
    setNote({ text: STR.sbReviewDone, bad: false });
    setFeedback("");
    setTicked([]);
    onChanged();
  }

  async function onEscalate(): Promise<void> {
    setNote(null);
    if (!escSubject.trim() || !escBody.trim()) return;
    const res = await raiseEscalation({
      bookId: lesson.bookId,
      lessonNo: lesson.lessonNo,
      target: escTarget,
      subject: escSubject.trim(),
      body: escBody.trim(),
    });
    if (res.error) {
      setNote({ text: friendlyError(res.error), bad: true });
      return;
    }
    setNote({ text: STR.sbEscalationSent, bad: false });
    setEscSubject("");
    setEscBody("");
    setEscOpen(false);
    onChanged();
  }

  return (
    <Card style={{ marginBottom: space(3) }}>
      {/* The HEADER toggles, not the card: the expanded body is full of form controls,
          and a tap that lands on the card would collapse the thing being filled in. */}
      <Pressable onPress={() => setOpen((v) => !v)}>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
          <Body style={{ fontWeight: "700" }}>{`${STR.sbLesson} ${bnNum(lesson.lessonNo)}`}</Body>
          {lesson.nctbTitleBn ? (
            <Body style={{ marginLeft: space(2), flexShrink: 1 }}>{lesson.nctbTitleBn}</Body>
          ) : null}
          <View style={{ marginLeft: space(2) }}>
            <Badge text={lessonStateLabel(lesson.state)} tone={lesson.checklistPassed ? "ok" : "muted"} />
          </View>
        </View>
        <Muted style={{ marginTop: 2 }}>
          {`${STR.sbLessonState}: ${lessonStateLabel(lesson.state)} · ${STR.sbBlocks} ${bnNum(lesson.blockCount)} · ${STR.sbSlots} ${bnNum(lesson.slotCount)}`}
        </Muted>
      </Pressable>

      {open ? (
        <>
          <Divider />

          {rounds.length > 0 ? (
            <>
              <Body style={{ fontWeight: "700" }}>{STR.sbRounds}</Body>
              {rounds.map((r) => <RoundRow key={r.roundId} round={r} />)}
            </>
          ) : (
            <Muted>{STR.sbNoRounds}</Muted>
          )}

          <Divider />

          <Body style={{ fontWeight: "700" }}>{STR.sbChecklist}</Body>
          <ChipRow>
            {BOOK_REVIEW_CHECKLIST.map((item) => (
              <Chip
                key={item}
                label={bookChecklistLabel(item)}
                selected={ticked.includes(item)}
                onPress={() => toggle(item)}
              />
            ))}
          </ChipRow>

          <Select
            label={STR.sbVerdict}
            value={verdict}
            options={REVIEW_VERDICTS.map((v) => ({ label: reviewVerdictLabel(v), value: v }))}
            onChange={(v) => setVerdict(v)}
          />

          <Field
            label={STR.sbFeedback}
            value={feedback}
            onChangeText={setFeedback}
            multiline
            autoCapitalize="sentences"
          />

          {blockedApprove ? (
            <Muted style={{ color: colors.warning }}>{STR.sbChecklistAllRequired}</Muted>
          ) : null}

          <Button
            title={STR.sbSubmitReview}
            onPress={() => { void onSubmit(); }}
            loading={reviewRes.fetching}
            disabled={blockedApprove || reviewRes.fetching}
            style={{ marginTop: space(2) }}
          />

          <Divider />

          {/* Escalation lives INSIDE the lesson card on purpose: handing an item up must
              not mean leaving the lesson you were reading (D-#410). */}
          {escOpen ? (
            <>
              <Select
                label={STR.sbEscalationTarget}
                value={escTarget}
                options={ESCALATION_TARGETS.map((tg) => ({ label: tg, value: tg }))}
                onChange={(v) => setEscTarget(v)}
              />
              <Field label={STR.sbEscalationSubject} value={escSubject} onChangeText={setEscSubject} autoCapitalize="sentences" />
              <Field label={STR.sbEscalationBody} value={escBody} onChangeText={setEscBody} multiline autoCapitalize="sentences" />
              <View style={{ flexDirection: "row", marginTop: space(2) }}>
                <Button
                  title={STR.sbEscalate}
                  onPress={() => { void onEscalate(); }}
                  loading={escRes.fetching}
                  disabled={!escSubject.trim() || !escBody.trim() || escRes.fetching}
                  style={{ marginRight: space(2) }}
                />
                <Button title={STR.cancel} variant="ghost" onPress={() => setEscOpen(false)} />
              </View>
            </>
          ) : (
            <Button title={STR.sbEscalate} variant="ghost" onPress={() => setEscOpen(true)} />
          )}

          {note ? (
            <Muted style={{ marginTop: space(2), color: note.bad ? colors.error : colors.primary }}>
              {note.text}
            </Muted>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

export default function BookReviewScreen(): React.ReactElement {
  const [booksQ, refetchBooks] = useQuery<{ supportBooks: SupportBookT[] }>({ query: SUPPORT_BOOKS });
  const books = booksQ.data?.supportBooks ?? [];
  const [pickedBook, setPickedBook] = useState<string | null>(null);
  const bookId = pickedBook ?? books[0]?.bookId ?? "";

  const [lessonsQ, refetchLessons] = useQuery<{ supportBookLessons: SupportBookLessonT[] }>({
    query: SUPPORT_BOOK_LESSONS,
    variables: { bookId },
    pause: !bookId,
  });
  const [roundsQ, refetchRounds] = useQuery<{ supportBookReviewRounds: SupportBookReviewRoundT[] }>({
    query: SUPPORT_BOOK_REVIEW_ROUNDS,
    variables: { bookId },
    pause: !bookId,
  });

  const lessons = lessonsQ.data?.supportBookLessons ?? [];
  const rounds = roundsQ.data?.supportBookReviewRounds ?? [];

  // One pass, not a filter per lesson — a 54-lesson book with several rounds each is
  // enough for the quadratic version to be felt on a phone.
  const roundsByLesson = useMemo(() => {
    const m = new Map<number, SupportBookReviewRoundT[]>();
    for (const r of rounds) {
      const list = m.get(r.lessonNo);
      if (list) list.push(r);
      else m.set(r.lessonNo, [r]);
    }
    return m;
  }, [rounds]);

  const refetchAll = (): void => {
    refetchLessons({ requestPolicy: "network-only" });
    refetchRounds({ requestPolicy: "network-only" });
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.sbReviewTitle}</Body>
          <Muted>{STR.sbReviewSub}</Muted>
          <Select
            label={STR.sbBook}
            value={bookId || null}
            options={books.map((b) => ({ label: `${b.titleBn} (${b.bookId})`, value: b.bookId }))}
            onChange={(v) => setPickedBook(v)}
            placeholder={STR.sbBook}
          />
        </Card>

        <View style={{ height: space(3) }} />

        <QueryGate
          results={[booksQ, lessonsQ, roundsQ]}
          onRetry={() => {
            refetchBooks({ requestPolicy: "network-only" });
            refetchAll();
          }}
          loaderLabel={STR.loading}
        >
          {lessons.length === 0 ? (
            <EmptyState message={STR.empty} />
          ) : (
            lessons.map((l) => (
              <LessonCard
                key={`${l.bookId}-${l.lessonNo}`}
                lesson={l}
                rounds={roundsByLesson.get(l.lessonNo) ?? []}
                onChanged={refetchAll}
              />
            ))
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
