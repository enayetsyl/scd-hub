/**
 * MasteryActionScreen (M-5, mocks L2 / L3 / L4) — one action, issue → action → result:
 *  - PROPOSED + approver: who attends, the class date + period (or after school), the re-test
 *    date, a note; approve the extra class, re-teach only, or reject (reason);
 *  - APPROVED (extra class) + section teacher: who came → "class held";
 *  - IN_PROGRESS / APPROVED (re-teach): build the re-test (unseen questions per student), then
 *    enter its marks on the usual entry screen;
 *  - CHECKING: before / now per student, the app's suggested outcome → close;
 *  - always: the path of the action (events) and each student's state now.
 */
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  BUILD_MASTERY_RETEST,
  CLOSE_MASTERY_ACTION,
  DECIDE_MASTERY_ACTION,
  MASTERY_ACTION_QUERY,
  RECORD_MASTERY_EXTRA_CLASS,
  type MasteryActionData,
} from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Field, Loader, Notice, H2 } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, isoDateLabel, masteryActionLabel, masterySourceLabel, masteryStateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";
import { fill, stateTone } from "./masteryStateUi";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryAction">;

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${bnNum(n)}%`);
const ascii = (s: string) => s.replace(/[০-৯]/g, (c) => String("০১২৩৪৫৬৭৮৯".indexOf(c)));

export default function MasteryActionScreen({ navigation, route }: Props): React.ReactElement {
  const { actionId } = route.params;
  const [{ data, fetching, error }, refetch] = useQuery({ query: MASTERY_ACTION_QUERY, variables: { actionId }, requestPolicy: "cache-and-network" });
  const a = data?.masteryAction as MasteryActionData | undefined;
  const [msg, setMsg] = useState<string | null>(null);

  // Decision form
  const [attendees, setAttendees] = useState("WEAK");
  const [date, setDate] = useState("");
  const [slotKind, setSlotKind] = useState<"PERIOD" | "AFTER_SCHOOL">("PERIOD");
  const [period, setPeriod] = useState("");
  const [retestDate, setRetestDate] = useState("");
  const [note, setNote] = useState("");
  // Attendance
  const [present, setPresent] = useState<Record<string, boolean>>({});
  // Close
  const [outcome, setOutcome] = useState<string | null>(null);

  useEffect(() => {
    if (!a) return;
    setPresent(Object.fromEntries(a.students.filter((s) => s.inPlan).map((s) => [s.studentId, s.present ?? true])));
    setOutcome(a.outcome ?? a.suggestedOutcome);
  }, [a?.id, a?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const [decideState, decide] = useMutation(DECIDE_MASTERY_ACTION);
  const [heldState, held] = useMutation(RECORD_MASTERY_EXTRA_CLASS);
  const [retestState, retest] = useMutation(BUILD_MASTERY_RETEST);
  const [closeState, close] = useMutation(CLOSE_MASTERY_ACTION);
  const busy = decideState.fetching || heldState.fetching || retestState.fetching || closeState.fetching;
  const done = async (p: Promise<{ error?: Parameters<typeof friendlyError>[0] }>) => {
    setMsg(null);
    const res = await p;
    if (res.error) setMsg(friendlyError(res.error));
    else refetch({ requestPolicy: "network-only" });
  };

  if (fetching && !a) {
    return (
      <Screen>
        <Loader />
      </Screen>
    );
  }
  if (error || !a) {
    return (
      <Screen>
        <Notice message={error ? friendlyError(error) : STR.errGeneric} tone="danger" />
      </Screen>
    );
  }

  const onDecide = (decision: "EXTRA_CLASS" | "RETEACH" | "REJECT") => {
    if (decision === "REJECT" && !note.trim()) {
      setMsg(STR.msRejectNeedsNote);
      return;
    }
    void done(
      decide({
        actionId,
        decision,
        date: decision === "EXTRA_CLASS" ? ascii(date.trim()) : null,
        slotKind: decision === "EXTRA_CLASS" ? slotKind : null,
        periodNumber: decision === "EXTRA_CLASS" && slotKind === "PERIOD" ? Number(ascii(period)) || null : null,
        attendees,
        retestDate: retestDate.trim() ? ascii(retestDate.trim()) : null,
        note: note.trim() || null,
      }),
    );
  };

  const inPlan = a.students.filter((s) => s.inPlan);
  const showClose = a.canWork || a.canApprove;

  return (
    <Screen scroll>
      <H2>{a.labelBn}</H2>
      <Muted>
        {a.className} {a.sectionName} · {hwSubjectLabel(a.subject)} · {a.loCode}
      </Muted>
      <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
        <Badge text={masteryActionLabel(a.status)} tone={a.status === "PROPOSED" ? "gold" : a.status === "CLOSED" ? "ok" : "info"} />
        <Badge text={fill(STR.msWeakOf, { weak: bnNum(a.trigger.weak), of: bnNum(a.trigger.verdicts), pct: bnNum(a.trigger.weakPct), n: bnNum(a.trigger.assessments) })} tone="danger" />
        {a.status !== "PROPOSED" ? <Badge text={masteryActionLabel(a.kind)} tone="muted" /> : null}
      </View>
      {msg ? <Notice message={msg} tone="danger" /> : null}

      {a.status === "PROPOSED" && a.canApprove ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.msWhoComes}</Body>
          <ChipRow>
            {(["WEAK", "WEAK_IMPROVING", "SECTION"] as const).map((k) => (
              <Chip key={k} label={masteryActionLabel(k)} selected={attendees === k} onPress={() => setAttendees(k)} />
            ))}
          </ChipRow>
          <Field label={STR.msClassDate} value={date} onChangeText={setDate} />
          <ChipRow>
            {(["PERIOD", "AFTER_SCHOOL"] as const).map((k) => (
              <Chip key={k} label={masteryActionLabel(k)} selected={slotKind === k} onPress={() => setSlotKind(k)} />
            ))}
          </ChipRow>
          {slotKind === "PERIOD" ? <Field label={STR.msPeriodNo} value={period} onChangeText={setPeriod} keyboardType="numeric" /> : null}
          <Field label={STR.msRetestDate} value={retestDate} onChangeText={setRetestDate} />
          <Field label={STR.msNote} value={note} onChangeText={setNote} multiline />
          <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
            <Button title={STR.msApproveClass} onPress={() => onDecide("EXTRA_CLASS")} disabled={busy || !date.trim()} />
            <Button title={STR.msReteachOnly} variant="secondary" onPress={() => onDecide("RETEACH")} disabled={busy} />
            <Button title={STR.msReject} variant="ghost" onPress={() => onDecide("REJECT")} disabled={busy} />
          </View>
        </Card>
      ) : null}

      {a.plan ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.msPlan}</Body>
          <Body>
            {a.plan.date ? `${bnNum(a.plan.date)} · ` : ""}
            {a.plan.slotKind === "PERIOD" && a.plan.periodNumber ? `${bnNum(a.plan.periodNumber)} ${STR.msPeriodNo}` : a.plan.slotKind ? masteryActionLabel(a.plan.slotKind) : masteryActionLabel(a.kind)}
          </Body>
          <Muted>
            {masteryActionLabel(a.plan.attendees)} · {fill(STR.msStudentsInPlan, { n: bnNum(inPlan.length) })}
            {a.plan.teacherName ? ` · ${STR.msTeacher}: ${a.plan.teacherName}` : ""}
            {a.plan.retestDate ? ` · ${masterySourceLabel("RETEST")} ${bnNum(a.plan.retestDate)}` : ""}
          </Muted>
          {a.plan.note ? <Body>{a.plan.note}</Body> : null}
        </Card>
      ) : null}

      {a.status === "APPROVED" && a.kind === "EXTRA_CLASS" && a.canWork ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.msAttendance}</Body>
          <ChipRow>
            {inPlan.map((s) => (
              <Chip
                key={s.studentId}
                label={`${s.rollNumber ? `${bnNum(s.rollNumber)}. ` : ""}${s.name}`}
                selected={present[s.studentId] ?? true}
                onPress={() => setPresent((p) => ({ ...p, [s.studentId]: !(p[s.studentId] ?? true) }))}
              />
            ))}
          </ChipRow>
          <Button
            title={STR.msHeld}
            disabled={busy}
            onPress={() => done(held({ actionId, attendance: inPlan.map((s) => ({ studentId: s.studentId, present: present[s.studentId] ?? true })) }))}
          />
        </Card>
      ) : null}

      {a.canWork && ((a.status === "IN_PROGRESS" && a.kind === "EXTRA_CLASS") || (a.status === "APPROVED" && a.kind === "RETEACH")) ? (
        <Button title={STR.msBuildRetest} disabled={busy} onPress={() => done(retest({ actionId }))} />
      ) : null}

      {a.retestPaperId ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{fill(STR.msRetestSheet, { paper: a.retestPaperId })}</Body>
          {!a.retestConfirmed && a.canWork ? (
            <Button title={STR.msAsEnterMarks} onPress={() => navigation.navigate("MasteryEntry", { paperId: a.retestPaperId! })} />
          ) : null}
        </Card>
      ) : null}

      {a.before || a.status === "CLOSED" ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.msBeforeAfter}</Body>
          <View style={{ flexDirection: "row", gap: space(4), flexWrap: "wrap" }}>
            <View>
              <Muted>{STR.msBefore}</Muted>
              <Body>
                {STR.msSectionWeak} {pct(a.before?.weakPct)} · {STR.msTargetMean} {pct(a.before?.meanPct)}
              </Body>
            </View>
            <View>
              <Muted>{a.status === "CLOSED" ? STR.msAfter : STR.msNow}</Muted>
              <Body>
                {STR.msSectionWeak} {pct((a.after ?? a.now).weakPct)} · {STR.msTargetMean} {pct((a.after ?? a.now).meanPct)}
              </Body>
            </View>
          </View>
          {a.status === "CLOSED" && a.outcome ? <Badge text={masteryActionLabel(a.outcome)} tone={a.outcome === "SUCCESS" ? "ok" : a.outcome === "PARTIAL" ? "warn" : "danger"} /> : null}
        </Card>
      ) : null}

      {showClose && ["APPROVED", "IN_PROGRESS", "CHECKING"].includes(a.status) ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.msOutcome}</Body>
          {a.suggestedOutcome ? <Muted>{fill(STR.msSuggested, { o: masteryActionLabel(a.suggestedOutcome) })}</Muted> : null}
          <ChipRow>
            {(["SUCCESS", "PARTIAL", "NOT_RESOLVED"] as const).map((o) => (
              <Chip key={o} label={masteryActionLabel(o)} selected={outcome === o} onPress={() => setOutcome(o)} />
            ))}
          </ChipRow>
          {a.status !== "CHECKING" || !a.retestConfirmed ? (
            <>
              <Muted>{STR.msCloseNeedsNote}</Muted>
              <Field label={STR.msNote} value={note} onChangeText={setNote} multiline />
            </>
          ) : null}
          <Button
            title={STR.msCloseAction}
            disabled={busy || !outcome}
            onPress={() => done(close({ actionId, outcome, note: note.trim() || null }))}
          />
        </Card>
      ) : null}

      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.msPerStudent}</Body>
        {a.students
          .filter((s) => s.inPlan || s.weakAtTrigger || a.status === "PROPOSED")
          .map((s) => (
            <View key={s.studentId} style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap", paddingVertical: 4 }}>
              <Body style={{ flexShrink: 1 }}>
                {s.rollNumber ? `${bnNum(s.rollNumber)}. ` : ""}
                {s.name}
              </Body>
              <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap" }}>
                {s.weakAtTrigger ? <Badge text={STR.msWeakThen} tone="muted" /> : null}
                {s.present === false ? <Badge text={STR.msAbsent} tone="muted" /> : null}
                {s.retestPct !== null ? <Badge text={`${pct(s.recentPct)} → ${pct(s.retestPct)}`} tone={s.retestPct >= 70 ? "ok" : "warn"} /> : null}
                <Badge text={masteryStateLabel(s.stateNow)} tone={stateTone(s.stateNow)} />
              </View>
            </View>
          ))}
      </Card>

      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.msPath}</Body>
        {a.events.map((e, i) => (
          <Body key={`${e.kind}-${i}`}>
            {isoDateLabel(e.at)} · {masteryActionLabel(`EV_${e.kind}`)}
            {e.byName ? ` · ${e.byName}` : ""}
            {e.note ? ` · ${e.note}` : ""}
          </Body>
        ))}
      </Card>
    </Screen>
  );
}
