/**
 * CtHeldResultsCard (CT-RC Option B, docs/prd-ct-mark-recheck.md) — "আটকে রাখা ফল ·
 * খাতা দেখুন" on the approver's Today: every result an approver held at approval to see
 * the paper. Per row: the mark against the student's average, the teacher's stamp and
 * note, then "ঠিক আছে · প্রকাশ করুন" (release) or "নম্বর বদলান" (correct + publish; the
 * server leaves a quiet note in the teacher's mistake record).
 *
 * Self-contained (own query); renders nothing while loading, when empty and on error —
 * so it can sit on AdminTodayScreen and on TodayScreen (a TEACHER login carrying the
 * OFFICE template) without an empty shell. Plain Card, not a FoldCard: a held result
 * keeps one family waiting, so it should not start folded away.
 */
import React, { useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  CORRECT_HELD_CT_RESULT,
  CT_HELD_RESULTS_QUERY,
  RELEASE_HELD_CT_RESULT,
  type CtHeldResultT,
} from "../graphql/classTestRecheck";
import { Badge, Body, Button, Card, Field, Muted, Notice } from "./ui";
import { avgLine, ctrcFill, kindLabel } from "./CtRecheckPanel";
import { STR, bnNum, classLevelLabel, hwSubjectLabel, isoDateLabel } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { space, typeScale, useColors } from "../theme";

function HeldRow({ r, onDone }: { r: CtHeldResultT; onDone: (msg: string) => void }): React.ReactElement {
  const colors = useColors();
  const [{ fetching: releasing }, release] = useMutation(RELEASE_HELD_CT_RESULT);
  const [{ fetching: correcting }, correct] = useMutation(CORRECT_HELD_CT_RESULT);
  const [editing, setEditing] = useState(false);
  const [marks, setMarks] = useState(String(r.marks));
  const [error, setError] = useState<string | null>(null);
  const busy = releasing || correcting;

  async function onRelease(): Promise<void> {
    setError(null);
    const res = await release({ testId: r.testId, studentId: r.studentId });
    if (res.error) setError(friendlyError(res.error));
    else onDone(STR.ctrcReleased);
  }

  async function onCorrect(): Promise<void> {
    setError(null);
    // Accept Bangla digits as typed on a Bangla keyboard.
    const n = Number(marks.trim().replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))));
    if (!Number.isFinite(n)) {
      setError(ctrcFill(STR.ctrcCorrectLabel, { t: bnNum(r.totalMarks) }));
      return;
    }
    const res = await correct({ testId: r.testId, studentId: r.studentId, marks: n });
    if (res.error) setError(friendlyError(res.error));
    else onDone(STR.ctrcReleased);
  }

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.surfaceAlt, paddingTop: space(3), marginTop: space(3) }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2) }}>
        <View style={{ flexShrink: 1 }}>
          <Body style={{ fontWeight: "700" }}>{r.studentName}</Body>
          <Muted>
            {r.classLevel ? `${classLevelLabel(r.classLevel)} · ` : ""}
            {hwSubjectLabel(r.subject)} · {r.ctId}
          </Muted>
        </View>
        <Body style={{ fontWeight: "700" }}>
          {bnNum(r.marks)}/{bnNum(r.totalMarks)}
        </Body>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1), alignItems: "center" }}>
        {r.kinds.map((k) => (
          <Badge key={k} text={kindLabel(k)} tone="warn" />
        ))}
        {r.heldAt ? <Badge text={ctrcFill(STR.ctrcHeldSince, { d: isoDateLabel(r.heldAt) })} tone="info" /> : null}
      </View>
      {r.kinds.length > 0 ? <Muted>{avgLine(r)}</Muted> : null}
      {r.note ? <Muted>{ctrcFill(STR.ctrcTeacherNote, { n: `“${r.note}”` })}</Muted> : null}
      {editing ? (
        <View style={{ marginTop: space(2) }}>
          <Field
            label={ctrcFill(STR.ctrcCorrectLabel, { t: bnNum(r.totalMarks) })}
            value={marks}
            onChangeText={setMarks}
            keyboardType="decimal-pad"
          />
          <Muted>{STR.ctrcCorrectHint}</Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
            <Button title={STR.ctrcCorrectSave} onPress={() => void onCorrect()} loading={correcting} disabled={busy} />
            <Button title={STR.cancel} variant="ghost" onPress={() => setEditing(false)} disabled={busy} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
          <Button title={STR.ctrcRelease} onPress={() => void onRelease()} loading={releasing} disabled={busy} />
          <Button title={STR.ctrcCorrect} variant="secondary" onPress={() => setEditing(true)} disabled={busy} />
        </View>
      )}
      {error ? <Notice message={error} tone="danger" /> : null}
    </View>
  );
}

export function CtHeldResultsCard(): React.ReactElement | null {
  const colors = useColors();
  const [q, refetch] = useQuery({ query: CT_HELD_RESULTS_QUERY, variables: {}, requestPolicy: "cache-and-network" });
  const [ok, setOk] = useState<string | null>(null);
  const rows = q.data?.classTestHeldResults ?? [];
  if (q.error || (rows.length === 0 && !ok)) return null;
  return (
    <Card style={{ borderWidth: 2, borderColor: colors.info }}>
      <Text style={{ ...typeScale.sectionTitle, color: colors.textPrimary }} accessibilityRole="header">
        🔒 {STR.ctrcHeldCardTitle}
        {rows.length > 0 ? ` · ${bnNum(rows.length)}` : ""}
      </Text>
      {rows.length > 0 ? <Muted>{STR.ctrcHeldCardIntro}</Muted> : null}
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {rows.map((r) => (
        <HeldRow
          key={`${r.testId}:${r.studentId}`}
          r={r}
          onDone={(msg) => {
            setOk(msg);
            refetch({ requestPolicy: "network-only" });
          }}
        />
      ))}
    </Card>
  );
}
