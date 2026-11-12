/**
 * ExamPoolPanel — hold questions for the exam papers in bulk (PR-I, D-#1408).
 *
 * Two ways, both for question:manage holders (Principal, Office); the server re-gates both:
 *   - by the CURRENT bank filter: the matching count is shown first, and the count is sent back so
 *     the server refuses if the list moved in between;
 *   - by a pasted list of question ids (a few hundred in one call): the result says how many were
 *     changed, which ids matched nothing and how many were already in that state.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  MARK_EXAM_POOL,
  MARK_EXAM_POOL_BY_FILTER,
  QUESTIONS_COUNT_QUERY,
  type ExamPoolBulkResult,
  type QuestionFilterVars,
} from "../../graphql/operations";
import { Card, Body, Muted, Button, Field, Notice } from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { space } from "../../theme/tokens";

/** Matches the server's EXAM_POOL_MAX_IDS. */
const MAX = 5000;

const fill = (tpl: string, vars: Record<string, string | number>): string =>
  tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));

/** Split a pasted block into ids: any run of commas, spaces, semicolons or line breaks separates them. */
export function parseQidList(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean))];
}

export function ExamPoolPanel({ filter, onChanged }: { filter: QuestionFilterVars; onChanged: () => void }): React.ReactElement {
  const { confirmAction } = useConfirm();
  const [{ data, fetching }, refetch] = useQuery({ query: QUESTIONS_COUNT_QUERY, variables: { filter }, requestPolicy: "network-only" });
  const [, byFilter] = useMutation(MARK_EXAM_POOL_BY_FILTER);
  const [, byIds] = useMutation(MARK_EXAM_POOL);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExamPoolBulkResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const count = data?.questionsCount ?? 0;
  const needClass = !filter.subject || filter.classLevel == null;
  const tooMany = count > MAX;
  const filterBlocked = needClass || tooMany;

  function done(r: ExamPoolBulkResult): void {
    setResult(r);
    refetch({ requestPolicy: "network-only" });
    onChanged();
  }

  async function applyFilter(on: boolean): Promise<void> {
    if (count === 0) return;
    const ok = await confirmAction({
      title: STR.qExamBulkTitle,
      message: fill(on ? STR.qExamConfirmHold : STR.qExamConfirmRelease, { n: bnNum(count) }),
      confirmLabel: on ? STR.qExamHold : STR.qExamRelease,
      tone: "primary",
    });
    if (!ok) return;
    setErr(null);
    setBusy(true);
    const res = await byFilter({ filter, expectedCount: count, on });
    setBusy(false);
    if (res.error || !res.data) { setErr(friendlyError(res.error)); refetch({ requestPolicy: "network-only" }); return; }
    done(res.data.markExamPoolByFilter);
  }

  async function applyIds(on: boolean): Promise<void> {
    const qids = parseQidList(paste);
    if (qids.length === 0) return;
    setErr(null);
    setBusy(true);
    const res = await byIds({ qids, on });
    setBusy(false);
    if (res.error || !res.data) { setErr(friendlyError(res.error)); return; }
    done(res.data.markExamPool);
  }

  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.qExamBulkTitle}</Body>
      <Muted>{STR.qExamBulkHint}</Muted>
      <Muted>{fetching ? STR.loading : fill(STR.qExamFilterCount, { n: bnNum(count) })}</Muted>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        <Button title={fill(STR.qExamHoldAll, { n: bnNum(count) })} disabled={busy || count === 0 || filterBlocked} onPress={() => void applyFilter(true)} />
        <Button title={fill(STR.qExamReleaseAll, { n: bnNum(count) })} variant="secondary" disabled={busy || count === 0 || filterBlocked} onPress={() => void applyFilter(false)} />
      </View>

      {needClass ? <Muted>{STR.qExamNeedClass}</Muted> : tooMany ? <Muted>{fill(STR.qExamTooMany, { n: bnNum(count), max: bnNum(MAX) })}</Muted> : null}

      <Body style={{ fontWeight: "700", marginTop: space(2) }}>{STR.qExamPasteTitle}</Body>
      <Field label="" value={paste} onChangeText={setPaste} placeholder={STR.qExamPastePlaceholder} multiline autoCapitalize="characters" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        <Button title={STR.qExamPasteHold} disabled={busy || parseQidList(paste).length === 0} onPress={() => void applyIds(true)} />
        <Button title={STR.qExamPasteRelease} variant="secondary" disabled={busy || parseQidList(paste).length === 0} onPress={() => void applyIds(false)} />
      </View>

      {err ? <Notice tone="danger" message={err} /> : null}
      {result ? (
        <>
          <Notice
            tone={result.notFoundCount > 0 ? "warn" : "ok"}
            message={fill(STR.qExamResult, { marked: bnNum(result.marked), notFound: bnNum(result.notFoundCount), unchanged: bnNum(result.unchangedCount) })}
          />
          {result.notFoundCount > 0 ? (
            <Muted>{fill(STR.qExamNotFound, { ids: result.notFound.slice(0, 50).join(", ") + (result.notFoundCount > 50 ? " …" : "") })}</Muted>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
