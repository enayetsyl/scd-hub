/**
 * MarkEscalationTodayCard (AL-9, AC-M1 / B10) — the Principal's (and Office's) Today card for the 09:30 mark-submission
 * snapshot: how many rows still have no hand-in record (the 2026 stage) and how many papers still have no marks entered
 * (the 2027 stage). One tap opens the full list (MarkEscalationList).
 *
 * Self-contained (own query); shown only to a holder of `mark_submission:alerts`, only with the 2027 release switch on
 * (so with it off Today looks exactly as in 2026), and renders nothing while loading, on error, or when today has no
 * snapshot rows.
 */
import React from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { MARK_ESCALATION } from "../graphql/markSubmission";
import { MASTERY_LOOP_POLICY_QUERY } from "../graphql/mastery";
import { Badge, Body, Button, Muted } from "./ui";
import { FoldCard } from "./FoldCard";
import { STR, bnNum } from "../lib/labels";
import { openAppScreen } from "../navigation/navigationRef";
import { space } from "../theme";

/** Today's school-local day key (the snapshot's own key); the VM and the school run on Asia/Dhaka. */
function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function MarkEscalationTodayCard(): React.ReactElement | null {
  const [loopQ] = useQuery({ query: MASTERY_LOOP_POLICY_QUERY });
  const loopOn = loopQ.data?.masteryPolicy?.resolved?.academicLoop2027On === true;
  const [q] = useQuery({ query: MARK_ESCALATION, variables: { dateKey: todayKey() }, pause: !loopOn, requestPolicy: "cache-and-network" });
  const rows = loopOn ? (q.data?.markEscalation?.rows ?? []) : [];
  if (q.error || rows.length === 0) return null;
  const open = rows.filter((r) => !r.markedNow);
  const records = open.filter((r) => r.stage !== "MARKS").length;
  const marks = open.filter((r) => r.stage === "MARKS").length;

  return (
    <FoldCard id="today:markEscalation" title={`⏰ ${STR.tdMarksCardTitle}`} aside={<Badge text={bnNum(open.length)} tone={open.length > 0 ? "danger" : "ok"} />}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), marginTop: space(3) }}>
        <View style={{ flexBasis: 200, flexGrow: 1, flexShrink: 1 }}>
          <Body>{STR.tdMarksCardBody.replace("{records}", bnNum(records)).replace("{marks}", bnNum(marks))}</Body>
          <Muted>{STR.mesTitle}</Muted>
        </View>
        <Button title={STR.al8TodayOpen} variant="secondary" onPress={() => void openAppScreen("AssignmentTab", "MarkEscalationList")} />
      </View>
    </FoldCard>
  );
}
