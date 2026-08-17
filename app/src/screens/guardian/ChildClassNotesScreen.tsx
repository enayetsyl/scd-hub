/**
 * ChildClassNotesScreen (GP-2 rider) — the selected child's class-notes HISTORY:
 * "what was taught", day by day. Read-only; link-scoped server-side
 * (guardian:read_child + assertGuardianOfStudent).
 *
 * D-#476 — this screen used to be pinned to the last 7 days with no way back.
 * The cause was structural, not a policy: it called the single-day
 * childClassNotes once PER DAY (plus a homework and a nil-day call each), so a
 * week already cost 21 requests and a month would have cost 90. It now issues
 * exactly THREE range queries for the whole window, so the window can grow:
 *   - the date pickers jump to any period (a specific week last term),
 *   - "show older" widens the window a week at a time for casual paging back.
 * The server caps a window at GUARDIAN_RANGE_MAX_DAYS, which is also where the
 * paging stops.
 *
 * Which days get a card: every day that has notes, homework, or a "no homework"
 * declaration — plus the last 7 calendar days unconditionally, so today still
 * shows "no class notes for this day" rather than silently vanishing. Older
 * empty days are omitted, which is what keeps a term's history short enough to
 * scroll.
 */
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useQuery } from "urql";
import { DAYS_OF_WEEK } from "@scd/shared";
import {
  CHILD_CLASS_NOTES_RANGE_QUERY,
  CHILD_HOMEWORK_QUERY,
  CHILD_HW_NIL_DAYS,
  type GuardianClassNoteT,
  type GuardianHwRecordT,
} from "../../graphql/operations";
import { openStoredFile, FILE_VIEW_SUPPORTED } from "../../lib/files";
import { Screen, Body, Muted, Card, Loader, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { DateField } from "../../components/DateField";
import { LoadOlder } from "../../components/LoadOlder";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { useRecordView } from "../../lib/useRecordView";
import { STR, bnNum, dayOfWeekLabel, subjectLabel, hwSubjectLabel, hwNilReasonLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";
import { dateKey, addDaysKey, daysBetweenKeys, GUARDIAN_RANGE_MAX_DAYS } from "../../lib/dates";

/** How much further back one "show older" tap reaches. A week keeps each tap
 *  cheap and matches how a parent thinks about school time. */
const STEP_DAYS = 7;
/** Days that always get a card even when empty — the recent stretch a parent is
 *  actually checking. Older empty days are dropped (see the file header). */
const ALWAYS_SHOWN_DAYS = 7;

interface NilDayT {
  dateKey: string;
  subject: string;
  reason: string;
}

/** One day's card. Pure — every value comes from the three window queries, so
 *  adding a day to the window costs no extra request. */
function DayCard({
  date,
  notes,
  hwItems,
  nilDays,
}: {
  date: string;
  notes: GuardianClassNoteT[];
  hwItems: GuardianHwRecordT[];
  nilDays: NilDayT[];
}): React.ReactElement {
  const totalMinutes = hwItems.reduce((a, r) => a + r.timeDecl + (r.topupTimeMin ?? 0), 0);
  const dow = dayOfWeekLabel(DAYS_OF_WEEK[new Date(date).getDay()]);
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Body style={{ fontWeight: "700" }}>{dow}</Body>
        <Muted>{bnNum(date)}</Muted>
      </View>
      {notes.length === 0 ? (
        <Muted style={{ marginTop: space(1) }}>{STR.gpNoNotesDay}</Muted>
      ) : (
        notes.map((n, i) => (
          <View key={`${n.subject}-${n.periodNumber ?? i}`} style={{ marginTop: space(2) }}>
            <Body style={{ fontWeight: "700" }}>{subjectLabel(n.subject)}</Body>
            <Body>{n.taughtSummaryBn}</Body>
            {n.homework ? (
              <Muted>
                {STR.gpHomeworkOpen}: {n.homework.hwId} · {bnNum(n.homework.qCount)} ·{" "}
                {bnNum(n.homework.timeDecl)} {STR.gpMinutes}
              </Muted>
            ) : null}
            {/* Worksheets/handouts the teacher attached. FILE_VIEW_SUPPORTED is web-only;
                elsewhere we still list them so the guardian knows they exist. */}
            {n.attachments.map((a) => (
              <Pressable
                key={a.id}
                onPress={() => (FILE_VIEW_SUPPORTED ? openStoredFile(a.id) : undefined)}
                accessibilityRole={FILE_VIEW_SUPPORTED ? "button" : undefined}
                accessibilityLabel={a.name}
                style={({ pressed }) => [{ paddingVertical: space(1) }, pressed && { opacity: 0.7 }]}
              >
                <Muted>📎 {a.name}</Muted>
              </Pressable>
            ))}
          </View>
        ))
      )}
      {/* The day's homework load — every declared item + the estimated total.
          D-#504: the "no homework" declarations render ALONGSIDE the declared
          items, not instead of them. As an if/else-if, a single declared item hid
          every nil declaration for the rest of the day — so a day where Bangla
          gave work and English deliberately gave none read as "one homework", and
          the owner reasonably asked why two subjects were missing. */}
      {hwItems.length > 0 || nilDays.length > 0 ? (
        <View style={{ marginTop: space(2) }}>
          <Body style={{ fontWeight: "700" }}>📝 {STR.gpHwGivenTitle}</Body>
          {hwItems.map((r) => (
            <Muted key={r.recordId} style={{ marginTop: space(1) }}>
              {hwSubjectLabel(r.subject)}
              {r.description ? ` — ${r.description}` : ""} · {bnNum(r.qCount)} {STR.gpHwQuestions} ·{" "}
              {bnNum(r.timeDecl + (r.topupTimeMin ?? 0))} {STR.gpMinutes}
            </Muted>
          ))}
          {nilDays.map((n) => (
            <Muted key={`${n.dateKey}-${n.subject}`} style={{ marginTop: space(1) }}>
              {hwSubjectLabel(n.subject)}: {STR.gpNoHomework} — {hwNilReasonLabel(n.reason)}
            </Muted>
          ))}
          {hwItems.length > 0 ? (
            <Body style={{ fontWeight: "600", marginTop: space(1) }}>
              {STR.gpHwTotalTime}: {bnNum(totalMinutes)} {STR.gpMinutes}
            </Body>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

export default function ChildClassNotesScreen(): React.ReactElement {
  const { selected, fetching } = useGuardianChild();
  useRecordView("CLASS_NOTES", selected?.studentId);

  const [to, setTo] = useState(() => dateKey());
  const [from, setFrom] = useState(() => addDaysKey(dateKey(), -(STEP_DAYS - 1)));
  const studentId = selected?.studentId ?? "";

  const [notesQ, refetchNotes] = useQuery({
    query: CHILD_CLASS_NOTES_RANGE_QUERY,
    variables: { studentId, from, to },
    pause: !selected,
  });
  const [hwQ, refetchHw] = useQuery({
    query: CHILD_HOMEWORK_QUERY,
    variables: { studentId, from, to },
    pause: !selected,
  });
  const [nilQ, refetchNil] = useQuery({
    query: CHILD_HW_NIL_DAYS,
    variables: { studentId, from, to },
    pause: !selected,
  });

  const noteDays = useMemo(() => notesQ.data?.childClassNotesRange ?? [], [notesQ.data]);
  const hwRecords = useMemo(
    // Resubmissions re-issue the same item; skipping them keeps the per-day list
    // (and the minute total) from double-counting.
    () => (hwQ.data?.childHomework ?? []).filter((r) => r.resubOf === null),
    [hwQ.data],
  );
  const nilRows = useMemo(() => nilQ.data?.childHomeworkNilDays ?? [], [nilQ.data]);

  /** Every day to draw, newest first: the always-shown recent stretch plus any
   *  older day that actually has something on it. */
  const days = useMemo(() => {
    const byNote = new Map(noteDays.map((d) => [d.dateKey, d.notes]));
    const byHw = new Map<string, GuardianHwRecordT[]>();
    for (const r of hwRecords) {
      const k = r.dateGiven.slice(0, 10);
      const bucket = byHw.get(k);
      if (bucket) bucket.push(r);
      else byHw.set(k, [r]);
    }
    const byNil = new Map<string, NilDayT[]>();
    for (const n of nilRows) {
      const bucket = byNil.get(n.dateKey);
      if (bucket) bucket.push(n);
      else byNil.set(n.dateKey, [n]);
    }

    const keys = new Set<string>([...byNote.keys(), ...byHw.keys(), ...byNil.keys()]);
    // The recent stretch always gets a card, even if empty — but never outside
    // the window the pickers describe.
    for (let i = 0; i < ALWAYS_SHOWN_DAYS; i++) {
      const k = addDaysKey(to, -i);
      if (k >= from) keys.add(k);
    }

    return [...keys]
      .filter((k) => k >= from && k <= to)
      .sort((a, b) => b.localeCompare(a))
      .map((k) => ({
        date: k,
        notes: byNote.get(k) ?? [],
        hwItems: byHw.get(k) ?? [],
        nilDays: byNil.get(k) ?? [],
      }));
  }, [noteDays, hwRecords, nilRows, from, to]);

  // Paging stops at the server's window cap — widening past it would only earn
  // a "range too wide" error. The pickers remain, so a parent can still move the
  // whole window further back rather than widen it.
  const windowDays = daysBetweenKeys(from, to);
  const exhausted = windowDays >= GUARDIAN_RANGE_MAX_DAYS;
  const loadingOlder = notesQ.fetching || hwQ.fetching || nilQ.fetching;

  function showOlder(): void {
    const widened = addDaysKey(from, -STEP_DAYS);
    const capped = addDaysKey(to, -(GUARDIAN_RANGE_MAX_DAYS - 1));
    setFrom(widened < capped ? capped : widened);
  }

  if (fetching && !selected) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }
  if (!selected) {
    return (
      <Screen>
        <EmptyState message={STR.gpNoChildren} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <ChildSwitcher />
        <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.gpClassNotesHistory}</Body>
        <View style={{ flexDirection: "row", gap: space(2) }}>
          <View style={{ flex: 1 }}>
            <DateField label={STR.gpFromDate} value={from} onChange={setFrom} max={to || undefined} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label={STR.gpToDate} value={to} onChange={setTo} min={from || undefined} />
          </View>
        </View>
        {windowDays > GUARDIAN_RANGE_MAX_DAYS ? (
          <Muted style={{ marginBottom: space(2) }}>{STR.gpRangeTooWide}</Muted>
        ) : null}
        <QueryGate
          results={[notesQ, hwQ, nilQ]}
          onRetry={() => {
            refetchNotes({ requestPolicy: "network-only" });
            refetchHw({ requestPolicy: "network-only" });
            refetchNil({ requestPolicy: "network-only" });
          }}
          loaderLabel={STR.loading}
        >
          {days.map((d) => (
            <DayCard
              key={d.date}
              date={d.date}
              notes={d.notes}
              hwItems={d.hwItems}
              nilDays={d.nilDays}
            />
          ))}
          <LoadOlder onPress={showOlder} loading={loadingOlder} exhausted={exhausted} />
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
