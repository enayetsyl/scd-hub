/**
 * NarrowLockedCard (D-#1685) — Principal only (mastery:settings). On a LOCKED row that cites an
 * exercise whole, keep only some of that exercise's questions ("সীমিত করুন"). Narrowing only: the
 * server refuses widening or a new exercise, re-checks the tree, and logs it. What the row gives up
 * shows afterwards on the round page as an open gap — the next round must cite those questions
 * (e.g. a new objective) before it can be locked.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { isSplittableExerciseRef, parseExerciseRef } from "@scd/shared";
import { NARROW_LOCKED_MASTERY_CITATION, type ReviewQueue, type ReviewRow } from "../../graphql/masteryReview";
import { Body, Button, Card, Chip, ChipRow, Field, Muted, Notice } from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { space } from "../../theme";
import { fill } from "./masteryStateUi";
import { formatExerciseRef, useReviewAction } from "./masteryReviewUi";

const asciiInt = (t: string): number => Number(t.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))).replace(/\D/g, ""));

/** The row's whole single-exercise refs — the only ones that can be narrowed. */
export const narrowableRefs = (r: ReviewRow): string[] =>
  r.bookRef.exercises.filter((x) => parseExerciseRef(x)?.question === null && isSplittableExerciseRef(x));

export function NarrowLockedCard({ q, r, onDone }: { q: ReviewQueue; r: ReviewRow; onDone: () => void }): React.ReactElement | null {
  const act = useReviewAction(NARROW_LOCKED_MASTERY_CITATION);
  const refs = narrowableRefs(r);
  const [exercise, setExercise] = useState<string | null>(null);
  const known = exercise ? ((q.questionCounts ?? []).find((c) => c.ref === exercise)?.count ?? null) : null;
  const [countText, setCountText] = useState("");
  const [keep, setKeep] = useState<number[]>([]);
  if (refs.length === 0) return null;
  const count = known ?? asciiInt(countText);
  const countOk = count >= 2 && count <= 99;
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.msRvNarrowTitle}</Body>
      <Muted>{STR.msRvNarrowHint}</Muted>
      <ChipRow>
        {refs.map((x) => (
          <Chip
            key={x}
            label={formatExerciseRef(x)}
            selected={exercise === x}
            onPress={() => {
              setExercise(exercise === x ? null : x);
              setKeep([]);
            }}
          />
        ))}
      </ChipRow>
      {exercise ? (
        <View style={{ gap: space(1) }}>
          {known ? (
            <Body>{fill(STR.msRvQCountTpl, { n: bnNum(known) })}</Body>
          ) : (
            <Field label={STR.msRvQCountField} value={countText} onChangeText={setCountText} keyboardType="number-pad" />
          )}
          {countOk ? (
            <>
              <Muted>{STR.msRvNarrowKeep}</Muted>
              <ChipRow>
                {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
                  <Chip
                    key={n}
                    label={fill(STR.msRvQItemTpl, { n: bnNum(n) })}
                    selected={keep.includes(n)}
                    onPress={() => setKeep(keep.includes(n) ? keep.filter((x) => x !== n) : [...keep, n])}
                  />
                ))}
              </ChipRow>
            </>
          ) : null}
          <Button
            title={STR.msRvNarrowSave}
            loading={act.busy}
            disabled={!countOk || keep.length === 0 || keep.length >= count}
            onPress={() =>
              void act.run({ code: r.code, exercise, questions: keep, questionCount: count }, STR.msRvSaved).then((ok) => {
                if (!ok) return;
                setExercise(null);
                setKeep([]);
                onDone();
              })
            }
          />
        </View>
      ) : null}
      {act.error ? <Notice message={act.error} tone="danger" /> : null}
    </Card>
  );
}
