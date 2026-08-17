/**
 * ChildHomeworkScreen (GP-2) — the selected child's homework over a date range,
 * ONE CARD PER DAY, FULL lifecycle per record (GP-J4/J5): stage timeline, chase
 * count, result, resubmission chain (same HW_ID adjacent, পুনঃজমা badge),
 * top-up, and the প্রশ্নপত্র / উত্তরপত্র viewers when files exist (streamed via
 * GET /files/:id — web-only viewing, mirroring the PDF path).
 *
 * GP-9 (D-#506) — a day's card now answers the whole day, subject by subject.
 * Before, it listed only the subjects that DECLARED homework, and the class's
 * "no homework" declarations sat in one separate card at the top of the screen
 * covering the entire range. A parent could therefore not tell, for a given day,
 * whether a subject had no homework or nobody had said anything: the two facts
 * lived on different parts of the screen, or nowhere at all.
 *
 * So each card is built from that day's ROUTINE (`childRoutineRange`, one query
 * for the window) and every subject that had a period appears in period order in
 * exactly one of three states:
 *   1. homework declared  → the full lifecycle block,
 *   2. "no homework" declared (D-#299) → the reason, in the teacher's words,
 *   3. nothing declared   → "ঘোষণা করা হয়নি" — deliberately NOT worded as
 *      "no homework", because an unanswered subject is a different fact.
 * QURAN periods are skipped: Quran homework is out of this channel entirely
 * (D-#36), so listing it here would ask a parent to chase a declaration that is
 * never coming. A record or declaration for a subject with no period that day
 * (a slot retired later) is still shown, appended after the routine subjects —
 * data is never dropped just because the routine has moved on.
 */
import React, { useState } from "react";
import { ScrollView, View, RefreshControl } from "react-native";
import { useQuery } from "urql";
import { HW_SUBJECTS } from "@scd/shared";
import {
  CHILD_HOMEWORK_QUERY,
  CHILD_HW_NIL_DAYS,
  CHILD_ROUTINE_RANGE_QUERY,
  type GuardianHwRecordT,
  type GuardianHwNilDayT,
} from "../../graphql/operations";
import { Screen, Body, Muted, Card, Badge, Button, Notice, Loader, EmptyState, Divider } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { DateField } from "../../components/DateField";
import { LoadOlder } from "../../components/LoadOlder";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { useRecordView } from "../../lib/useRecordView";
import { STR, bnNum, lifecycleStateLabel, hwGuardianStatusLabel, subjectLabel, hwResultLabel, hwNilReasonLabel } from "../../lib/labels";
import { openStoredFile, FILE_VIEW_SUPPORTED, FileUploadError } from "../../lib/files";
import { useFileOpen } from "../../lib/useFileOpen";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme/tokens";
import { dateKey, addDaysKey, daysBetweenKeys, GUARDIAN_MAX_LOOKBACK_DAYS } from "../../lib/dates";

const isoDay = (d: Date): string => dateKey(d);
const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
};

/** How far one "show older" tap reaches back — a fortnight, matching the
 *  window this screen opens on (D-#476). */
const STEP_DAYS = 14;

/** One stage-timeline row: label + Bangla-digit date (or dash). */
function StageRow({ label, at }: { label: string; at: string | null }): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Muted>{label}</Muted>
      <Muted>{at ? bnNum(at.slice(0, 10)) : "—"}</Muted>
    </View>
  );
}

/** Subjects that can carry homework at all. A QURAN period is NOT one (D-#36:
 *  Quran homework lives in the Quran tracker), so it is left out of the day rather
 *  than shown as "nothing declared" forever. */
const HW_SUBJECT_SET = new Set<string>(HW_SUBJECTS as readonly string[]);

interface DaySubject {
  subject: string;
  /** Every record for this subject that day — a resubmission chain stays adjacent. */
  records: GuardianHwRecordT[];
  nil: GuardianHwNilDayT | undefined;
}
interface DayGroup {
  day: string;
  /** Holiday name / day-type, only when the day was not a normal school day. */
  dayNoteBn: string | null;
  subjects: DaySubject[];
}

/**
 * One group per calendar day: the day's HW-capable periods in PERIOD ORDER, each
 * resolved to its declaration (or the absence of one).
 *
 * A day is included when it had at least one HW-capable period, OR when something
 * was declared on it. The second half matters: a slot retired or moved after the
 * fact would otherwise make a real homework record disappear from the parent's
 * screen, so anything declared for a subject with no period that day is appended
 * after the routine subjects instead of being dropped.
 */
function buildDays(
  records: GuardianHwRecordT[],
  nilRows: GuardianHwNilDayT[],
  routineDays: Array<{ dateKey: string; dayType: string; dayTypeLabelBn: string; holidayNameBn: string | null; slots: Array<{ subject: string; periodNumber: number }> }>,
): DayGroup[] {
  const recByDay = new Map<string, GuardianHwRecordT[]>();
  for (const r of records) {
    const k = r.dateGiven.slice(0, 10);
    const b = recByDay.get(k);
    if (b) b.push(r);
    else recByDay.set(k, [r]);
  }
  const nilByDay = new Map<string, GuardianHwNilDayT[]>();
  for (const n of nilRows) {
    const b = nilByDay.get(n.dateKey);
    if (b) b.push(n);
    else nilByDay.set(n.dateKey, [n]);
  }
  const routineByDay = new Map(routineDays.map((d) => [d.dateKey, d]));

  const keys = new Set<string>([
    ...routineDays.filter((d) => d.slots.some((s) => HW_SUBJECT_SET.has(s.subject))).map((d) => d.dateKey),
    ...recByDay.keys(),
    ...nilByDay.keys(),
  ]);

  return [...keys]
    .sort((a, b) => b.localeCompare(a)) // newest day first
    .map((day) => {
      const rd = routineByDay.get(day);
      const recs = recByDay.get(day) ?? [];
      const nils = nilByDay.get(day) ?? [];

      const ordered: string[] = [];
      for (const s of [...(rd?.slots ?? [])].sort((a, b) => a.periodNumber - b.periodNumber)) {
        if (HW_SUBJECT_SET.has(s.subject) && !ordered.includes(s.subject)) ordered.push(s.subject);
      }
      for (const subject of [...recs.map((r) => r.subject), ...nils.map((n) => n.subject)]) {
        if (!ordered.includes(subject)) ordered.push(subject);
      }

      const offDay = rd && (rd.dayType === "OFF" || rd.dayType === "HOLIDAY");
      return {
        day,
        dayNoteBn: offDay ? rd.holidayNameBn ?? rd.dayTypeLabelBn : null,
        subjects: ordered.map((subject) => ({
          subject,
          records: recs.filter((r) => r.subject === subject),
          nil: nils.find((n) => n.subject === subject),
        })),
      };
    });
}

/** One declared homework, in full. A BLOCK inside the day's card (GP-9) — it used
 *  to be its own Card, which is why a day with three subjects read as three
 *  unrelated things. */
function RecordBlock({
  record,
  onOpenFile,
}: {
  record: GuardianHwRecordT;
  onOpenFile: (fileId: string) => void;
}): React.ReactElement {
  const r = record;
  const { openingId, runOpen } = useFileOpen();
  return (
    <View style={{ marginTop: space(2) }}>
      {/* The guardian status is a SENTENCE, not a chip word ("বাড়ির কাজ জমা দেওয়ার সময়
          হয়েছে", worded for parents), so it gets its own full-width line.
          Sitting beside the title it crushed that column to a few pixels — flexShrink is
          0 by default in RN, so the badge never yielded and the only shrinkable child
          took the whole squeeze, wrapping the subject and hwId one character per line. */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
        <View style={{ flexShrink: 1 }}>
          <Body style={{ fontWeight: "700" }}>{subjectLabel(r.subject)}</Body>
          <Muted>{r.hwId}</Muted>
        </View>
        {/* Short enough to stay inline. */}
        {r.resubOf ? <Badge text={lifecycleStateLabel("RESUBMIT")} tone="warn" /> : null}
      </View>
      {/* D-#478: WHAT the work was. The teacher's description has been mandatory at
          declare since D-#317 and childHomework has always fetched it — it was simply
          never rendered, so a parent reading তাগাদা saw an id and a red badge and had
          to go find the class note for the date it was given. It sits ABOVE the status
          line because it is the thing they opened the app to learn. */}
      {r.description ? <Body style={{ marginTop: space(1) }}>{r.description}</Body> : null}
      <View style={{ marginTop: space(2) }}>
        <Badge
          text={hwGuardianStatusLabel(r.state)}
          /* Three steps, not two: amber "due today" → red "did not bring it" → green for
             everything already handed in. DUE used to render GREEN while saying the
             child had not done the work, which read as both wrong and alarming. */
          tone={r.state === "CHASE" ? "danger" : r.state === "DUE" ? "warn" : "brand"}
        />
      </View>

      {/* Stage timeline (GP-J4) */}
      <View style={{ marginTop: space(2) }}>
        <StageRow label={lifecycleStateLabel("GIVEN")} at={r.givenAt} />
        <StageRow label={lifecycleStateLabel("DUE")} at={r.dueDate} />
        <StageRow label={lifecycleStateLabel("SUBMITTED")} at={r.submittedAt} />
        <StageRow label={lifecycleStateLabel("CHECKED")} at={r.checkedAt} />
        <StageRow label={lifecycleStateLabel("RETURNED")} at={r.returnedAt} />
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
        {r.chaseCount > 0 ? (
          <Badge text={`${lifecycleStateLabel("CHASE")} ×${bnNum(r.chaseCount)}`} tone="danger" />
        ) : null}
        {r.result ? (
          <Badge text={hwResultLabel(r.result)} tone={r.result === "CORRECT" ? "ok" : r.result === "WRONG" ? "danger" : "warn"} />
        ) : null}
        {r.topupFlag ? (
          <Badge
            text={`${STR.gpTopup}: ${bnNum(r.topupQCount)}${r.topupTimeMin ? ` · ${bnNum(r.topupTimeMin)} ${STR.gpMinutes}` : ""}`}
            tone="info"
          />
        ) : null}
      </View>

      {/* প্রশ্নপত্র / উত্তরপত্র viewers (GP-J6) — only when a file exists */}
      {FILE_VIEW_SUPPORTED && (r.questionFileId || r.answerFileId || r.attachmentIds.length > 0) ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
          {r.questionFileId ? (
            <Button
              title={STR.gpQuestionFile}
              variant="secondary"
              loading={openingId === r.questionFileId}
              disabled={!!openingId}
              onPress={() => runOpen(r.questionFileId!, () => onOpenFile(r.questionFileId!))}
              style={{ flexGrow: 1 }}
            />
          ) : null}
          {r.attachmentIds.map((fid, i) => (
            <Button
              key={fid}
              title={`${STR.gpQuestionFile} ${bnNum(i + 1)}`}
              variant="secondary"
              loading={openingId === fid}
              disabled={!!openingId}
              onPress={() => runOpen(fid, () => onOpenFile(fid))}
              style={{ flexGrow: 1 }}
            />
          ))}
          {r.answerFileId ? (
            <Button
              title={STR.gpAnswerFile}
              variant="secondary"
              loading={openingId === r.answerFileId}
              disabled={!!openingId}
              onPress={() => runOpen(r.answerFileId!, () => onOpenFile(r.answerFileId!))}
              style={{ flexGrow: 1 }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** A subject that had a period but declared no homework — either explicitly
 *  (D-#299, with the teacher's reason) or not at all. Two different facts, worded
 *  differently on purpose. */
function NoHomeworkRow({
  subject,
  nil,
}: {
  subject: string;
  nil: GuardianHwNilDayT | undefined;
}): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), marginTop: space(2) }}>
      <Body style={{ fontWeight: "700", flexShrink: 1 }}>{subjectLabel(subject)}</Body>
      <Muted style={{ flexShrink: 1, textAlign: "right" }}>
        {nil ? `${STR.hwNilGuardian} (${hwNilReasonLabel(nil.reason)})` : STR.gpHwNotDeclared}
      </Muted>
    </View>
  );
}

export default function ChildHomeworkScreen({
  route,
}: {
  route?: { params?: { studentId?: string; from?: string; to?: string } };
}): React.ReactElement {
  const { selected, selectChild, fetching } = useGuardianChild();
  useRecordView("HOMEWORK", selected?.studentId);
  // D-#452: the weekly-digest deep-link presets the range (and child, below).
  const [from, setFrom] = useState(route?.params?.from ?? daysAgo(14));
  const [to, setTo] = useState(route?.params?.to ?? isoDay(new Date()));
  const [fileError, setFileError] = useState<string | null>(null);

  const deepLinkedChild = route?.params?.studentId;
  React.useEffect(() => {
    if (deepLinkedChild) selectChild(deepLinkedChild);
    // selectChild is stable (a setState) — re-run only when the param changes.
  }, [deepLinkedChild, selectChild]);

  const [hwQ, refetchHw] = useQuery({
    query: CHILD_HOMEWORK_QUERY,
    variables: { studentId: selected?.studentId ?? "", from, to },
    pause: !selected,
  });
  // D-#299: the class's explicit "no homework" days in the same range.
  const [nilQ, refetchNil] = useQuery({
    query: CHILD_HW_NIL_DAYS,
    variables: { studentId: selected?.studentId ?? "", from, to },
    pause: !selected,
  });
  // GP-9: the day's periods — the only way to know a subject was taught and said
  // nothing. ONE query for the window (never one per day, D-#476).
  const [routineQ, refetchRoutine] = useQuery({
    query: CHILD_ROUTINE_RANGE_QUERY,
    variables: { studentId: selected?.studentId ?? "", from, to },
    pause: !selected,
  });

  // UX-7: pull-to-refresh.
  const { refreshing, onRefresh } = usePullRefresh(hwQ.fetching, () =>
    refetchHw({ requestPolicy: "network-only" }),
  );

  async function onOpenFile(fileId: string): Promise<void> {
    setFileError(null);
    try {
      await openStoredFile(fileId);
    } catch (e) {
      setFileError(e instanceof FileUploadError ? e.message : STR.hwFileOpenFail);
    }
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

  const records = hwQ.data?.childHomework ?? [];
  const nilRows = nilQ.data?.childHomeworkNilDays ?? [];
  const routineDays = routineQ.data?.childRoutineRange ?? [];
  const days = buildDays(records, nilRows, routineDays);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <ChildSwitcher />
        <View style={{ flexDirection: "row", gap: space(2) }}>
          <View style={{ flex: 1 }}>
            <DateField label={STR.gpFromDate} value={from} onChange={setFrom} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label={STR.gpToDate} value={to} onChange={setTo} min={from || undefined} />
          </View>
        </View>
        {fileError ? <Notice message={fileError} tone="danger" /> : null}
        <QueryGate
          results={[hwQ, nilQ, routineQ]}
          onRetry={() => {
            refetchHw({ requestPolicy: "network-only" });
            refetchNil({ requestPolicy: "network-only" });
            refetchRoutine({ requestPolicy: "network-only" });
          }}
          loaderLabel={STR.loading}
        >
          {days.length === 0 ? (
            <EmptyState message={STR.gpNoHomework} />
          ) : (
            days.map((g) => (
              <Card key={g.day}>
                {/* The date is the card's title (GP-9) — a parent reads this screen
                    day by day, so the day has to be the strongest thing on it. */}
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                  <Body style={{ fontWeight: "700" }}>{bnNum(g.day)}</Body>
                  {g.dayNoteBn ? <Badge text={g.dayNoteBn} tone="warn" /> : null}
                </View>
                {g.subjects.map((s, i) => (
                  <View key={s.subject}>
                    {i > 0 ? <Divider /> : null}
                    {s.records.length > 0 ? (
                      s.records.map((r) => <RecordBlock key={r.recordId} record={r} onOpenFile={onOpenFile} />)
                    ) : (
                      <NoHomeworkRow subject={s.subject} nil={s.nil} />
                    )}
                  </View>
                ))}
              </Card>
            ))
          )}
          {/* D-#476: the pickers above jump to a period; this walks back from
              wherever the window already starts, for a parent who just wants
              "a bit further back" without picking a date. */}
          <LoadOlder
            onPress={() => setFrom((f) => addDaysKey(f, -STEP_DAYS))}
            loading={hwQ.fetching || nilQ.fetching || routineQ.fetching}
            exhausted={daysBetweenKeys(from, to) >= GUARDIAN_MAX_LOOKBACK_DAYS}
          />
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
