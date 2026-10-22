/**
 * ChildMasteryAssignments (M-4b, mock G3) — the child's weekly tailored assignments on the
 * guardian's Assignments tab: the questions as printed on the child's page (Part A for the
 * class, then the child's own), the PDF, and — once the teacher has marked it — how it went
 * per topic in plain words, with "আবার করবে" where the teacher asked for it to be redone.
 *
 * Own query, mounted OUTSIDE the tab's QueryGate (an empty tracker list must not hide it).
 * Renders nothing when the school has not switched the add-on on for the child's subjects.
 */
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { CHILD_MASTERY_ASSIGNMENTS, type ChildMasteryAssignment } from "../../graphql/mastery";
import { Body, Muted, Card, Badge, Button, Notice } from "../../components/ui";
import { LoadOlder } from "../../components/LoadOlder";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { openPdf, PDF_SUPPORTED } from "../../lib/pdf";
import { space } from "../../theme/tokens";

const PAGE = 4;

export function ChildMasteryAssignments({ studentId, childName }: { studentId: string; childName: string }): React.ReactElement | null {
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [studentId]);
  const [{ data, fetching }] = useQuery({
    query: CHILD_MASTERY_ASSIGNMENTS,
    variables: { studentId, limit },
    pause: !studentId,
  });
  const list = (data?.childMasteryAssignments ?? []) as ChildMasteryAssignment[];
  const [pdfErr, setPdfErr] = useState<string | null>(null);
  if (list.length === 0) return null;
  const exhausted = !fetching && list.length < limit;

  return (
    <View style={{ gap: space(2), marginBottom: space(4) }}>
      <Body style={{ fontWeight: "700" }}>{STR.gpMsAssignments}</Body>
      {pdfErr ? <Notice message={pdfErr} tone="danger" /> : null}
      {list.map((a) => (
        <Card key={a.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
            <Body style={{ fontWeight: "700" }}>{hwSubjectLabel(a.subject)}</Body>
            {a.result && !a.result.notMarked ? (
              <Badge text={`${STR.gpMsChecked} · ${bnNum(a.result.earned)} / ${bnNum(a.result.available)}`} tone="ok" />
            ) : (
              <Badge text={`${STR.asDueBy} ${bnNum(a.dueDate)}`} tone="brand" />
            )}
          </View>
          <Muted>
            {STR.gpMsFullMarks} {bnNum(a.totalMarks)} · {bnNum(a.minutes)} {STR.gpMsMinutes}
          </Muted>
          {PDF_SUPPORTED ? (
            <Button
              title={STR.gpMsPdf}
              variant="secondary"
              onPress={async () => {
                setPdfErr(null);
                try {
                  await openPdf(`/pdf/mastery-assignment/${a.id}?studentId=${studentId}`);
                } catch {
                  setPdfErr(STR.errGeneric);
                }
              }}
            />
          ) : null}
          {a.partA.length > 0 ? (
            <View style={{ gap: 2 }}>
              <Body style={{ fontWeight: "600" }}>{STR.gpMsPartA}</Body>
              {a.partA.map((q) => (
                <Body key={q.n}>
                  {bnNum(q.n)}. {q.textBn}
                </Body>
              ))}
            </View>
          ) : null}
          {a.partB.length > 0 ? (
            <View style={{ gap: 2 }}>
              <Body style={{ fontWeight: "600" }}>{STR.gpMsPartB.replace("{name}", childName)}</Body>
              <Muted>{STR.gpMsPartBWhy}</Muted>
              {a.partB.map((q) => (
                <Body key={q.n}>
                  {bnNum(q.n)}. {q.textBn}
                </Body>
              ))}
            </View>
          ) : null}
          {a.result && !a.result.notMarked ? (
            <View style={{ gap: 2 }}>
              <Body style={{ fontWeight: "600" }}>{STR.gpMsHowItWent}</Body>
              {a.result.rows.map((r) => (
                <View key={r.labelBn} style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
                  <Body style={{ flexShrink: 1 }}>{r.labelBn}</Body>
                  <Badge
                    text={`${bnNum(r.earned)} / ${bnNum(r.available)}${r.again ? ` · ${STR.gpMsAgain}` : ""}`}
                    tone={r.again ? "danger" : r.earned >= r.available ? "ok" : "warn"}
                  />
                </View>
              ))}
              {a.result.note ? (
                <Body>
                  <Body style={{ fontWeight: "700" }}>{STR.gpMsTeacherNote}</Body> {a.result.note}
                </Body>
              ) : null}
            </View>
          ) : null}
        </Card>
      ))}
      <LoadOlder onPress={() => setLimit((n) => n + PAGE)} loading={fetching} exhausted={exhausted} />
    </View>
  );
}
