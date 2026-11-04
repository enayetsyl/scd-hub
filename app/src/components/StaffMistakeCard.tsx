/**
 * StaffMistakeCard (D-#936–#939) — one caught mistake: what happened (the source's detail),
 * its status, the person's reason and the reviewer's decision. Shared by আমার ভুল ও ব্যাখ্যা
 * and ব্যাখ্যা যাচাই; the screen passes its own buttons as children.
 */
import React from "react";
import { View } from "react-native";
import type { StaffMistakeT, StaffMistakeStatusT } from "../graphql/staffMistakes";
import { Badge, Body, Card, Muted } from "./ui";
import { reasonLabel } from "./MistakeReasonSheet";
import { STR, fullDateLabel, hwSubjectLabel } from "../lib/labels";
import { dhakaClock, dhakaWhen } from "../lib/staffMistakeLabels";
import { space } from "../theme/tokens";

const STATUS: Record<StaffMistakeStatusT, { label: () => string; tone: "warn" | "danger" | "info" | "muted" }> = {
  EXPLANATION_DUE: { label: () => STR.smrStExplain, tone: "warn" },
  PENDING_REVIEW: { label: () => STR.smrStPending, tone: "warn" },
  COUNTED: { label: () => STR.smrStCounted, tone: "danger" },
  EXCUSED: { label: () => STR.smrStExcused, tone: "info" },
  MOVED: { label: () => STR.smrStMoved, tone: "muted" },
};

export function StaffMistakeCard({
  m,
  showName = false,
  children,
}: {
  m: StaffMistakeT;
  showName?: boolean;
  children?: React.ReactNode;
}): React.ReactElement {
  const st = STATUS[m.status];
  const n = m.markNote;
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
        <Body style={{ fontWeight: "700", flexShrink: 1 }}>
          {fullDateLabel(m.dateKey)}
          {showName ? ` · ${m.staffName}` : ""}
        </Body>
        <Badge text={st.label()} tone={st.tone} />
      </View>
      <Body>{STR.smrKindMark}</Body>
      {n ? (
        <>
          <Muted>
            {n.sectionLabel} · {hwSubjectLabel(n.subject)} {n.tracker === "HOMEWORK" ? STR.msgHomework : STR.msgAssignment} ({n.itemCode})
          </Muted>
          {n.students.map((s) => (
            <Muted key={s.studentId}>
              • {s.studentName} — {s.via === "UNDO" ? STR.msgViaUndo : STR.msgViaFlip} ({dhakaClock(s.chasedAt)} → {dhakaClock(s.correctedAt)})
              {s.correctedByName && s.correctedByName !== m.staffName ? ` · ${STR.msgCorrectedBy}: ${s.correctedByName}` : ""}
            </Muted>
          ))}
        </>
      ) : null}
      {m.movedFromName ? <Muted>{STR.smrMovedFrom.replace("{name}", m.movedFromName)}</Muted> : null}
      <View style={{ marginTop: space(2), gap: space(1) }}>
        {m.reasonCode ? (
          <Body>
            {STR.smrReason}: {reasonLabel(m.kind, m.reasonCode)}
            {m.reasonText ? ` — "${m.reasonText}"` : ""}
          </Body>
        ) : m.status === "EXPLANATION_DUE" ? (
          <Muted>{STR.smrDueBy.replace("{when}", dhakaWhen(m.explainDueAt))}</Muted>
        ) : (
          <Muted>{STR.smrNoReasonYet}</Muted>
        )}
        {m.autoCounted ? <Muted>{STR.smrAutoCounted}</Muted> : null}
        {m.movedToName ? <Muted>{STR.smrMovedTo.replace("{name}", m.movedToName)}</Muted> : null}
        {m.decidedByName ? (
          <Muted>
            {STR.smrDecidedBy}: {m.decidedByName}
            {m.decisionNote ? ` — "${m.decisionNote}"` : ""}
          </Muted>
        ) : null}
      </View>
      {children}
    </Card>
  );
}
