/**
 * ChildQuestionHints (GH-1, docs/prd-guardian-help.md §2, D-#1520/#1521) - the questions assigned to the
 * child that have a hint ladder, each with "একটি ইঙ্গিত দেখুন": step 1, then 2, then 3, one at a time
 * (the server refuses step N before step N-1). The answer is never shown here - the API has no answer field.
 *
 * Own query, mounted OUTSIDE any tracker QueryGate (an empty tracker list must not hide it). Renders
 * nothing when no assigned question has hints.
 */
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  CHILD_ASSIGNED_QUESTIONS,
  OPEN_QUESTION_HINT,
  type ChildAssignedQuestion,
  type OpenedQuestionHint,
} from "../graphql/questionHints";
import { Body, Muted, Card, Button, Notice } from "./ui";
import { STR, bnNum, hwSubjectLabel } from "../lib/labels";
import { space } from "../theme/tokens";

type Steps = { step: number; textBn: string }[];

export type HintSource = ChildAssignedQuestion["source"];

export function ChildQuestionHints({
  studentId,
  sources,
  refreshKey,
}: {
  studentId: string;
  /** Which assigned questions this tab shows (Assignments: ASSIGNMENT; Homework: HOMEWORK + EXTRA_HOMEWORK). */
  sources: HintSource[];
  /** Bump to refetch (the screen's pull-to-refresh). */
  refreshKey?: number;
}): React.ReactElement | null {
  const [{ data, fetching, error }, refetch] = useQuery({
    query: CHILD_ASSIGNED_QUESTIONS,
    variables: { studentId, sources },
    pause: !studentId,
    requestPolicy: "cache-and-network",
  });
  useEffect(() => {
    if (refreshKey) refetch({ requestPolicy: "network-only" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);
  const [, openHint] = useMutation<{ openQuestionHint: OpenedQuestionHint }>(OPEN_QUESTION_HINT);
  const [opened, setOpened] = useState<Record<string, Steps>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setOpened({});
    setErr(null);
  }, [studentId]);

  const list = ((data?.childAssignedQuestions ?? []) as ChildAssignedQuestion[]).filter((q) => q.hintCount > 0);
  if (!data && fetching) return <Muted style={{ marginBottom: space(4) }}>{STR.ghHintsLoading}</Muted>;
  if (error && list.length === 0) {
    return (
      <View style={{ gap: space(2), marginBottom: space(4) }}>
        <Notice message={STR.ghHintsError} tone="danger" />
        <Button title={STR.retry} variant="secondary" onPress={() => refetch({ requestPolicy: "network-only" })} />
      </View>
    );
  }
  if (list.length === 0) return null;

  const stepsOf = (q: ChildAssignedQuestion): Steps => {
    const local = opened[q.qid] ?? [];
    const merged = new Map<number, string>();
    for (const s of q.opened) merged.set(s.step, s.textBn);
    for (const s of local) merged.set(s.step, s.textBn);
    return [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([step, textBn]) => ({ step, textBn }));
  };

  const open = async (q: ChildAssignedQuestion, next: number) => {
    setErr(null);
    setBusy(q.qid);
    const r = await openHint({ studentId, qid: q.qid, step: next }, { additionalTypenames: ["ChildAssignedQuestion"] });
    setBusy(null);
    const h = r.data?.openQuestionHint;
    if (!h) {
      setErr(r.error?.graphQLErrors?.[0]?.message ?? STR.errGeneric);
      return;
    }
    setOpened((cur) => ({ ...cur, [q.qid]: [...(cur[q.qid] ?? []), { step: h.step, textBn: h.textBn }] }));
    refetch({ requestPolicy: "network-only" }); // the list shows the opened steps on return
  };

  return (
    <View style={{ gap: space(2), marginBottom: space(4) }}>
      <Body style={{ fontWeight: "700" }}>{STR.ghHintsTitle}</Body>
      <Muted>{STR.ghHintsWhy}</Muted>
      {err ? <Notice message={err} tone="danger" /> : null}
      {list.map((q) => {
        const steps = stepsOf(q);
        const next = steps.length + 1;
        return (
          <Card key={q.qid}>
            <Muted>
              {hwSubjectLabel(q.subject)} · {bnNum(q.date)}
            </Muted>
            <Body>{q.textBn}</Body>
            {steps.map((s) => (
              <View key={s.step} style={{ gap: 2 }}>
                <Body style={{ fontWeight: "600" }}>{STR.ghHintStep.replace("{n}", bnNum(s.step))}</Body>
                <Body>{s.textBn}</Body>
              </View>
            ))}
            {next <= q.hintCount ? (
              <Button
                title={steps.length === 0 ? STR.ghHintOpen : STR.ghHintNext}
                variant="secondary"
                disabled={busy === q.qid}
                onPress={() => open(q, next)}
              />
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}
