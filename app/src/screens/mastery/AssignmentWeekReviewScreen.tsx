/**
 * AssignmentWeekReviewScreen (AL-8, PRD §4.5 / §4.6, journeys C2 + C3) — "সাপ্তাহিক অ্যাসাইনমেন্ট — প্রস্তাব":
 * one শাখা's week. Per rotation subject the draft's state (who built it, edited, sheets to look at, minutes, which day),
 * "প্রস্তাব দিন" / rebuild (confirm dialog), open the draft to review each item with its reason; the swap card
 * (class teacher / Office: accept or ignore); the planned Friday / Saturday minutes; the per-child load panel.
 * Refusals are shown as the server worded them.
 */
import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  ACCEPT_ASSIGNMENT_SWAP,
  ASSIGNMENT_SUGGESTION_WEEK_QUERY,
  SUGGEST_ASSIGNMENT,
  type AssignmentSuggestionWeek,
  type AssignmentWeekSubject,
} from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Field, Loader, Notice, H2 } from "../../components/ui";
import { AssignmentLoadPanel } from "../../components/AssignmentLoadPanel";
import { STR, bnNum } from "../../lib/labels";
import { reviewWeekThursday } from "../../lib/asWeek";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../state/ConfirmContext";
import { space } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";
import { fill } from "./masteryStateUi";

type Props = NativeStackScreenProps<MasteryStackParamList, "AssignmentWeekReview">;

const stateLabel = (s: AssignmentWeekSubject["state"]): string =>
  s === "DRAFT" ? STR.al8StateDraft : s === "SENT" ? STR.al8StateSent : s === "MANUAL" ? STR.al8StateManual : s === "NIL" ? STR.al8StateNil : s === "DELIVERED" ? STR.al8StateDelivered : STR.al8StateNone;
const stateTone = (s: AssignmentWeekSubject["state"]) => (s === "SENT" ? "ok" : s === "DRAFT" ? "info" : s === "MANUAL" ? "gold" : "muted");
const dayLabel = (d: AssignmentWeekSubject["doOnDay"]): string | null => (d === "FRI" ? STR.al8Fri : d === "SAT" ? STR.al8Sat : d === "BOTH" ? STR.al8Both : null);

export default function AssignmentWeekReviewScreen({ navigation, route }: Props): React.ReactElement {
  const { sectionId } = route.params;
  const { can } = useAuth();
  const { confirmAction } = useConfirm();
  const [dueDate, setDueDate] = useState(route.params.dueDate ?? reviewWeekThursday());
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(dueDate);
  const [{ data, fetching, error }, refetch] = useQuery({
    query: ASSIGNMENT_SUGGESTION_WEEK_QUERY,
    variables: { sectionId, dueDate },
    pause: !dateOk,
    requestPolicy: "cache-and-network",
  });
  const week = data?.assignmentSuggestionWeek as AssignmentSuggestionWeek | undefined;
  useEffect(() => {
    const unsub = navigation.addListener("focus", () => refetch({ requestPolicy: "network-only" }));
    return unsub;
  }, [navigation, refetch]);

  const [suggestState, suggest] = useMutation(SUGGEST_ASSIGNMENT);
  const [swapState, acceptSwap] = useMutation(ACCEPT_ASSIGNMENT_SWAP);
  const [msg, setMsg] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<string | null>(null);
  const busy = suggestState.fetching || swapState.fetching;
  const canSuggest = can("assignment:suggest");

  const swapKey = week?.swapCard ? `${week.week}:${week.swapCard.dropSubject}:${week.swapCard.addSubject}` : null;
  const dropSubject = useMemo(() => week?.subjects.find((s) => s.subject === week.swapCard?.dropSubject), [week]);

  const run = async (subject: string, rebuild: boolean) => {
    setMsg(null);
    if (rebuild && !(await confirmAction({ title: STR.al8RebuildTitle, message: STR.al8RebuildMsg, confirmLabel: STR.al8Rebuild }))) return;
    const res = await suggest({ sectionId, dueDate, subject, rebuild });
    if (res.error) setMsg(friendlyError(res.error));
    else refetch({ requestPolicy: "network-only" });
  };

  const onAccept = async () => {
    const card = week?.swapCard;
    if (!card) return;
    setMsg(null);
    const names = { drop: card.dropSubjectBn, add: card.addSubjectBn };
    const edited = dropSubject?.edited === true;
    const ok = await confirmAction({
      title: STR.al8SwapConfirmTitle,
      message: `${fill(STR.al8SwapConfirmMsg, names)}${edited ? `\n\n${fill(STR.al8SwapEditedMsg, names)}` : ""}`,
      confirmLabel: STR.al8SwapAccept,
      tone: edited ? "danger" : undefined,
    });
    if (!ok) return;
    const res = await acceptSwap({ sectionId, dueDate, dropSubject: card.dropSubject, addSubject: card.addSubject, confirmEdited: edited });
    if (res.error) setMsg(friendlyError(res.error));
    else refetch({ requestPolicy: "network-only" });
  };

  return (
    <Screen scroll>
      <H2>{STR.al8WeekTitle}</H2>
      <Field label={STR.msAsDueDate} value={dueDate} onChangeText={setDueDate} />
      {week ? <Muted>{bnNum(week.week)}</Muted> : null}
      {error ? <Notice message={friendlyError(error)} tone="danger" /> : null}
      {msg ? <Notice message={msg} tone="danger" /> : null}
      {fetching && !week ? <Loader /> : null}

      {week && !week.hasWeek ? <Notice message={week.suspended ? STR.al8Suspended : STR.al8NoWeek} tone="info" /> : null}

      {week?.hasWeek ? (
        <>
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.al8DayPlan}</Body>
            <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
              <Badge text={`${STR.al8Fri}: ${bnNum(week.dayPlan.FRI)} / ${bnNum(week.dayPlan.dayCap)} ${STR.asMinutes}`} tone={week.dayPlan.FRI > week.dayPlan.dayCap ? "danger" : "muted"} />
              <Badge text={`${STR.al8Sat}: ${bnNum(week.dayPlan.SAT)} / ${bnNum(week.dayPlan.dayCap)} ${STR.asMinutes}`} tone={week.dayPlan.SAT > week.dayPlan.dayCap ? "danger" : "muted"} />
            </View>
            {week.dayPlan.overBy > 0 ? <Notice message={fill(STR.al8OverBy, { n: bnNum(week.dayPlan.overBy) })} tone="warn" /> : null}
          </Card>

          {week.swapCard && swapKey !== ignored ? (
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.al8SwapTitle}</Body>
              <Body>{fill(STR.al8SwapQuestion, { drop: week.swapCard.dropSubjectBn, add: week.swapCard.addSubjectBn })}</Body>
              <Muted>
                {fill(STR.al8SwapWhy, {
                  pct: bnNum(week.swapCard.addWeakPct),
                  rows: bnNum(week.swapCard.addWeakRows),
                  dropRows: bnNum(week.swapCard.dropWeakRows),
                  add: week.swapCard.addSubjectBn,
                  drop: week.swapCard.dropSubjectBn,
                })}
              </Muted>
              {week.canAcceptSwap ? (
                <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                  <Button title={STR.al8SwapAccept} onPress={onAccept} disabled={busy} />
                  <Button title={STR.al8SwapIgnore} variant="secondary" onPress={() => setIgnored(swapKey)} disabled={busy} />
                </View>
              ) : (
                <Muted>{STR.al8SwapWho}</Muted>
              )}
            </Card>
          ) : null}

          {week.subjects.map((s) => (
            <Card key={s.subject}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap", alignItems: "center" }}>
                <Body style={{ fontWeight: "700", flexShrink: 1 }}>
                  {s.subjectBn}
                  {s.teacherName ? ` · ${s.teacherName}` : ""}
                </Body>
                <Badge text={stateLabel(s.state)} tone={stateTone(s.state)} />
              </View>
              {s.builtBy || s.edited || s.needsReviewCount > 0 || s.minutes !== null ? (
                <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap" }}>
                  {s.builtBy ? <Badge text={s.builtBy === "ENGINE" ? STR.al8BuiltEngine : STR.al8BuiltTeacher} tone="muted" /> : null}
                  {s.edited ? <Badge text={STR.al8Edited} tone="warn" /> : null}
                  {s.needsReviewCount > 0 ? <Badge text={fill(STR.al8NeedsReview, { n: bnNum(s.needsReviewCount) })} tone="gold" /> : null}
                  {s.minutes !== null ? <Badge text={`${bnNum(s.minutes)} ${STR.asMinutes}`} tone="muted" /> : null}
                  {dayLabel(s.doOnDay) ? <Badge text={dayLabel(s.doOnDay)!} tone="muted" /> : null}
                </View>
              ) : null}
              {s.noLessonMarks ? (
                <>
                  <Notice message={STR.al8NoLessonMarks} tone="warn" />
                  {s.chapterChoices.length > 0 ? <Muted>{fill(STR.al8Chapters, { list: s.chapterChoices.map((c) => bnNum(c.chapterNumber)).join("، ") })}</Muted> : null}
                </>
              ) : null}
              <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                {s.assignmentId ? (
                  <Button
                    title={s.state === "SENT" ? STR.al8OpenSent : STR.al8OpenDraft}
                    variant={s.state === "SENT" ? "secondary" : "primary"}
                    onPress={() => navigation.navigate("AssignmentDraftReview", { assignmentId: s.assignmentId!, sectionId, subject: s.subject })}
                  />
                ) : null}
                {s.state === "NONE" && canSuggest ? <Button title={STR.al8Suggest} disabled={busy} onPress={() => run(s.subject, false)} /> : null}
                {s.state === "DRAFT" && canSuggest ? <Button title={STR.al8Rebuild} variant="secondary" disabled={busy} onPress={() => run(s.subject, true)} /> : null}
                {s.state === "MANUAL" || s.noLessonMarks ? (
                  <Button title={STR.al8OpenManual} variant="secondary" onPress={() => navigation.navigate("MasteryAssignment", { sectionId, subject: s.subject })} />
                ) : null}
              </View>
            </Card>
          ))}

          <AssignmentLoadPanel sectionId={sectionId} dueDate={dueDate} />
        </>
      ) : null}
    </Screen>
  );
}
