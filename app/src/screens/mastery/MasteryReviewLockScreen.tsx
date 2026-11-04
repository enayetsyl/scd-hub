/**
 * MasteryReviewLockScreen (OT-2, prd-objective-tree §7, mock 4) — চূড়ান্ত করুন.
 *
 * The Principal sees the decision counts, the gate (open comments, unresolved exercises, broken
 * tree rules) and locks the round: every non-rejected row and the subject's domains become LOCKED
 * and the codes permanent. The decisions file (every review event with before/after) is shown
 * here to copy into docs/mastery/objective-tree/feedback/ for Claude's next draft (§6 step 5).
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useClient } from "urql";
import { LOCK_MASTERY_REVIEW, MASTERY_REVIEW_EXPORT_QUERY } from "../../graphql/masteryReview";
import { Screen, Card, Body, Muted, Badge, Button, Field, Loader, Notice } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, masteryClassLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme";
import { fill } from "./masteryStateUi";
import { roundStateLabel, roundStateTone, useReviewAction, useReviewQueue } from "./masteryReviewUi";
import type { MasteryStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryReviewLock">;

function Line({ label, value, tone }: { label: string; value: string; tone?: "ok" | "danger" | "muted" }): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), alignItems: "center" }}>
      <Body style={{ flexShrink: 1 }}>{label}</Body>
      {tone ? <Badge text={value} tone={tone} /> : <Body style={{ fontWeight: "700" }}>{value}</Body>}
    </View>
  );
}

export default function MasteryReviewLockScreen({ navigation, route }: Props): React.ReactElement {
  const { reviewId } = route.params;
  React.useLayoutEffect(() => {
    navigation.setOptions({ title: STR.msRvLock });
  }, [navigation]);
  const { queue: q, fetching, error } = useReviewQueue(reviewId);
  const lock = useReviewAction(LOCK_MASTERY_REVIEW);
  const client = useClient();
  const [exportText, setExportText] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  if (!q) {
    return <Screen scroll>{error ? <Notice message={error} tone="danger" /> : fetching ? <Loader /> : null}</Screen>;
  }
  const d = q.decisions;
  const file = `${q.classToken}_${q.subject}.round${q.round}.json`;
  const loadExport = async (): Promise<void> => {
    setExportError(null);
    const res = await client.query(MASTERY_REVIEW_EXPORT_QUERY, { classToken: q.classToken, subject: q.subject, round: q.round }, { requestPolicy: "network-only" }).toPromise();
    if (res.error) setExportError(friendlyError(res.error));
    else setExportText((res.data?.masteryReviewExport as string) ?? "");
  };

  return (
    <Screen scroll>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
          <Body style={{ fontWeight: "700" }}>
            {masteryClassLabel(q.classToken)} · {hwSubjectLabel(q.subject)} · {fill(STR.msRvRound, { n: bnNum(q.round) })}
          </Body>
          <Badge text={roundStateLabel(q.state)} tone={roundStateTone(q.state)} />
        </View>
        <Body style={{ fontWeight: "700" }}>{STR.msRvDecisions}</Body>
        <Line label={STR.msRvDecAccepted} value={bnNum(d.accepted)} />
        <Line label={STR.msRvDecEdited} value={bnNum(d.edited)} />
        <Line label={STR.msRvDecSplitMerge} value={`${bnNum(d.splits)} / ${bnNum(d.merges)}`} />
        <Line label={STR.msRvDecMoved} value={bnNum(d.moved)} />
        <Line label={STR.msRvDecRejected} value={bnNum(d.rejected)} />
        <Line label={STR.msRvDecAdded} value={bnNum(d.added)} />
        {d.proposed > 0 ? <Line label={STR.msRvDecProposed} value={bnNum(d.proposed)} tone="danger" /> : null}
      </Card>

      <Card>
        <Line label={STR.msRvGateComments} value={bnNum(q.openComments)} tone={q.openComments === 0 ? "ok" : "danger"} />
        <Line label={STR.msRvGateUnmapped} value={bnNum(q.unresolvedUnmapped)} tone={q.unresolvedUnmapped === 0 ? "ok" : "danger"} />
        <Line label={STR.msRvGateRules} value={bnNum(q.violations.length)} tone={q.violations.length === 0 ? "ok" : "danger"} />
        {q.violations.length > 0 ? <Muted>{q.violations.slice(0, 12).join("\n")}</Muted> : null}
      </Card>

      {q.state === "LOCKED" ? (
        <Notice message={STR.msRvLockedDone} tone="ok" />
      ) : (
        <>
          <Notice message={STR.msRvLockNotice} tone="info" />
          {q.state === "OPEN" ? <Notice message={STR.msRvNeedsSubmit} tone="warn" /> : null}
          <Button title={STR.msRvLock} loading={lock.busy} disabled={!q.canLock} onPress={() => void lock.run({ reviewId: q.id }, STR.msRvLockedDone)} />
          {lock.error ? <Notice message={lock.error} tone="danger" /> : null}
        </>
      )}

      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.msRvExport}</Body>
        <Muted>{fill(STR.msRvExportHint, { file })}</Muted>
        <Button title={STR.msRvExport} variant="secondary" onPress={() => void loadExport()} />
        {exportError ? <Notice message={exportError} tone="danger" /> : null}
        {exportText !== null ? (
          <Field value={exportText} onChangeText={() => undefined} multiline inputStyle={{ minHeight: 200, fontFamily: "monospace", fontSize: 11 }} />
        ) : null}
      </Card>
    </Screen>
  );
}
