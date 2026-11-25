/**
 * ExerciseQuestionPicker (D-#1685) — cite single questions of an exercise, not only the whole one.
 *
 * Used by the review row's সম্পাদনা and ভাগ করুন forms and the নতুন যোগ card. For each exercise in
 * `pool` it shows one chip (the whole exercise, or "…: প্রশ্ন ১, ৩, ৪") and, for a single exercise
 * (numbered or lettered, not a range or "—"), "প্রশ্ন বাছুন". Opened, it asks once for the
 * exercise's question count (saved on the round, so every reviewer and the lock gate share it), then
 * shows one chip per question. A question already cited by another tagged row is labelled with that
 * row's code (one code per question, D-#776).
 *
 * In ভাগ করুন (`parentRefs`), a part may take only what the row being split cites: an exercise the
 * row cites by question offers exactly those questions (tapping it takes them all), never the whole.
 *
 * The form keeps owning the refs: this only rewrites the refs of the exercise it touches, in place.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { exerciseOfRef, isSplittableExerciseRef, parseExerciseRef } from "@scd/shared";
import { MASTERY_REVIEW_SET_QUESTION_COUNT, type ReviewQueue } from "../../graphql/masteryReview";
import { Body, Button, Chip, ChipRow, Field, Muted, Notice } from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { space } from "../../theme";
import { fill } from "./masteryStateUi";
import { codeTail, formatExerciseRef, formatExerciseRefs, useReviewAction } from "./masteryReviewUi";
import { citeOf, exercisesInRefs, withCite, type Cite } from "./exerciseRefPicks";

export { exercisesInRefs } from "./exerciseRefPicks";

const asciiInt = (t: string): number => Number(t.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))).replace(/\D/g, ""));

function OneExercise({
  q,
  exercise,
  value,
  onChange,
  allowRemove,
  selfCode,
  parentRefs,
}: {
  q: ReviewQueue;
  exercise: string;
  value: readonly string[];
  onChange: (refs: string[]) => void;
  allowRemove: boolean;
  selfCode?: string;
  parentRefs?: readonly string[];
}): React.ReactElement {
  const act = useReviewAction(MASTERY_REVIEW_SET_QUESTION_COUNT);
  const [open, setOpen] = useState(false);
  const [editCount, setEditCount] = useState(false);
  const cite = citeOf(value, exercise);
  const count = (q.questionCounts ?? []).find((c) => c.ref === exercise)?.count ?? null;
  const [countText, setCountText] = useState(count ? String(count) : "");
  // The parent cites only some questions of this exercise → a part may take only those.
  const parentCite = parentRefs ? citeOf(parentRefs, exercise) : null;
  const scoped = !!parentCite && !parentCite.whole && parentCite.questions.length > 0 ? parentCite.questions : null;
  const splittable = isSplittableExerciseRef(exercise) && q.canWrite;
  const set = (c: Cite) => onChange(withCite(value, exercise, c));
  const full: Cite = scoped ? { whole: false, questions: [...scoped] } : { whole: true, questions: [] };

  // Questions of this exercise cited by another live tagged row → that row's code.
  const taken = new Map<number, string>();
  for (const r of q.rows) {
    if (r.code === selfCode || !r.tagged || r.reviewState === "REJECTED" || r.mergedInto) continue;
    for (const ref of r.bookRef.exercises) {
      const p = parseExerciseRef(ref);
      if (p && p.exercise === exercise && p.question !== null && !taken.has(p.question)) taken.set(p.question, r.code);
    }
  }

  const toggleQuestion = (n: number) => {
    const qs = cite && !cite.whole ? cite.questions : [];
    const next = qs.includes(n) ? qs.filter((x) => x !== n) : [...qs, n];
    if (next.length > 0) set({ whole: false, questions: next });
    else set(allowRemove ? null : full);
  };

  const label = cite ? (formatExerciseRefs(value.filter((r) => exerciseOfRef(r) === exercise))[0] ?? formatExerciseRef(exercise)) : formatExerciseRef(exercise);
  const choices = scoped ?? (count ? Array.from({ length: count }, (_, i) => i + 1) : null);
  const questionChip = (n: number) => {
    const other = taken.get(n);
    return (
      <Chip
        key={n}
        label={other ? fill(STR.msRvQTakenTpl, { n: bnNum(n), code: codeTail(other) }) : fill(STR.msRvQItemTpl, { n: bnNum(n) })}
        selected={!!cite && !cite.whole && cite.questions.includes(n)}
        onPress={() => toggleQuestion(n)}
      />
    );
  };
  return (
    <View style={{ gap: space(1) }}>
      <ChipRow>
        <Chip label={label} selected={!!cite} onPress={() => (allowRemove ? set(cite ? null : full) : splittable && setOpen(!open))} />
        {splittable ? <Chip label={open ? STR.msRvQPickClose : STR.msRvQPick} onPress={() => setOpen(!open)} /> : null}
      </ChipRow>
      {open && splittable ? (
        <View style={{ gap: space(1), paddingLeft: space(2) }}>
          <Muted>{STR.msRvQPickHint}</Muted>
          {!scoped && (!count || editCount) ? (
            <View style={{ gap: space(1) }}>
              <Field label={STR.msRvQCountField} value={countText} onChangeText={setCountText} keyboardType="number-pad" />
              <Button
                title={STR.msRvQCountSave}
                variant="ghost"
                loading={act.busy}
                disabled={!(asciiInt(countText) >= 1 && asciiInt(countText) <= 99)}
                onPress={() =>
                  void act.run({ reviewId: q.id, ref: exercise, count: asciiInt(countText) }, STR.msRvQCountSaved).then((ok) => ok && setEditCount(false))
                }
              />
            </View>
          ) : choices ? (
            <>
              {count && !scoped ? <Body>{fill(STR.msRvQCountTpl, { n: bnNum(count) })}</Body> : null}
              <ChipRow>
                {scoped ? null : <Chip label={STR.msRvQWhole} selected={!!cite?.whole && cite.questions.length === 0} onPress={() => set({ whole: true, questions: [] })} />}
                {choices.map(questionChip)}
              </ChipRow>
              {scoped ? null : <Button title={STR.msRvQCountChange} variant="ghost" onPress={() => setEditCount(true)} />}
            </>
          ) : null}
          {act.error ? <Notice message={act.error} tone="danger" /> : null}
        </View>
      ) : null}
    </View>
  );
}

export function ExerciseQuestionPicker({
  q,
  pool,
  value,
  onChange,
  allowRemove = false,
  selfCode,
  parentRefs,
}: {
  q: ReviewQueue;
  /** The exercises to offer (whole refs; question refs are folded into their exercise). */
  pool: readonly string[];
  value: readonly string[];
  onChange: (refs: string[]) => void;
  /** SPLIT: tapping an exercise adds / removes it. EDIT / ADD: the text box adds and removes. */
  allowRemove?: boolean;
  /** The row being edited or split — its own questions are not shown as taken. */
  selfCode?: string;
  /** SPLIT: the split row's refs — a part may take only these (its exact questions). */
  parentRefs?: readonly string[];
}): React.ReactElement | null {
  const list = exercisesInRefs(pool);
  if (list.length === 0) return null;
  return (
    <View style={{ gap: space(1) }}>
      {list.map((e) => (
        <OneExercise key={e} q={q} exercise={e} value={value} onChange={onChange} allowRemove={allowRemove} selfCode={selfCode} parentRefs={parentRefs} />
      ))}
    </View>
  );
}
