/**
 * WholePictureCard — one student across the four core trackers (D-#277 follow-up).
 *
 * Staff-facing: numbers plus the concerns they raise. `overall` is the server's
 * conservative roll-up, so the badge never disagrees with the panels below it.
 */
import React from "react";
import { View } from "react-native";
import { Body, Muted, Card, Badge } from "./ui";
import { STR, bnNum } from "../lib/labels";
import { space } from "../theme/tokens";
import type { WholePictureT } from "../graphql/wholePicture";

export const overallLabel = (o: string): string =>
  o === "improving" ? STR.wpImproving : o === "declining" ? STR.wpDeclining : o === "steady" ? STR.wpSteady : STR.wpNa;

const overallTone = (o: string): "ok" | "danger" | "warn" | "muted" =>
  o === "improving" ? "ok" : o === "declining" ? "danger" : o === "steady" ? "warn" : "muted";

/** One tracker's row: a label and its numbers. */
function Row({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <View style={{ paddingVertical: space(2) }}>
      <Body style={{ fontWeight: "600" }}>{label}</Body>
      <Muted>{children}</Muted>
    </View>
  );
}

export function WholePictureCard({ wp }: { wp: WholePictureT }): React.ReactElement {
  const { classTest: ct, homework: hw, assignment: as, attendance: at } = wp;
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Body style={{ fontWeight: "700" }}>{STR.wpTitle}</Body>
        <View style={{ flexDirection: "row", gap: space(2) }}>
          {ct.atRisk ? <Badge text={STR.wpAtRisk} tone="danger" /> : null}
          <Badge text={overallLabel(wp.overall)} tone={overallTone(wp.overall)} />
        </View>
      </View>
      <Muted>
        {bnNum(wp.fromKey)} — {bnNum(wp.toKey)}
      </Muted>

      <Row label={STR.wpClassTest}>
        {ct.avgPercent !== null ? `${bnNum(ct.avgPercent)}%` : STR.wpNa}
        {" · "}
        {overallLabel(ct.trajectory)}
        {ct.weakestSubject ? ` · ${ct.weakestSubject}` : ""}
      </Row>

      <Row label={STR.wpHomework}>
        {hw.completionPct !== null ? `${bnNum(hw.completionPct)}% ${STR.wpDone}` : STR.wpNa}
        {` · ${bnNum(hw.open)} ${STR.wpOpen} · ${bnNum(hw.chased)} ${STR.wpChased}`}
      </Row>

      <Row label={STR.wpAssignment}>
        {as.avgMarksPct !== null ? `${bnNum(as.avgMarksPct)}% · ` : ""}
        {`${bnNum(as.late)} ${STR.wpLate} · ${bnNum(as.pending)} ${STR.wpPending}`}
      </Row>

      <Row label={STR.wpAttendance}>
        {`${bnNum(at.presentPct)}%`}
        {/* The recent-vs-earlier split is the point: it moves before the average does. */}
        {at.recentPresentPct !== null && at.earlierPresentPct !== null
          ? ` · ${bnNum(at.earlierPresentPct)}% → ${bnNum(at.recentPresentPct)}%`
          : ""}
      </Row>
    </Card>
  );
}
