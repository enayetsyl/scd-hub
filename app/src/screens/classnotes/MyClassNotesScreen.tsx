/**
 * MyClassNotesScreen (UX-8 → DE-4, D-#266/#477) — the teacher's ONE screen for the
 * day. The routine already knows which periods the caller taught, so this screen
 * never asks for class/subject/date: it lists the caller's OWN periods for the
 * chosen date (the UX-4 `myDay` read — cover-overlaid, day-type-filtered,
 * view-enriched), and each period card takes the whole entry for that period.
 *
 * DE-4 (D-#477): the card no longer merely LINKS an already-declared item — it
 * declares one. "যা পড়ালাম" plus বাড়ির কাজ আছে/নেই, with topics, description, time
 * and question count, all submitted in a single `publishClassNote` call that
 * reuses the existing tracker services server-side. A subject teacher who taught
 * five periods now fills five cards on one screen instead of touring three.
 *
 * What did NOT move: the class teacher's daily 120-minute reconciliation
 * (`confirmHomeworkDay`) stays its own screen — it is a different role's job,
 * across all subjects at once, and a single subject teacher cannot see whether the
 * day's total is over the ceiling. `DeclareHomeworkScreen` stays the admin /
 * back-date / edit-an-issued-item path; `DailyNoteScreen` stays the group-based
 * admin/cover/Principal path.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useMutation, useQuery } from "urql";
import {
  MY_DAY_QUERY,
  CLASS_NOTES_FOR_DATE_QUERY,
  PUBLISH_CLASS_NOTE,
  HOMEWORK_DAY_TALLY,
  HOMEWORK_TOPICS_QUERY,
  HW_NIL_DECLARATIONS,
  type ClassNoteHomeworkIn,
  type RoutineSlotT,
} from "../../graphql/operations";
import {
  Screen,
  Body,
  Muted,
  Card,
  Field,
  Button,
  Badge,
  Chip,
  ChipRow,
  Select,
  Loader,
  ErrorBanner,
  EmptyState,
  Notice,
} from "../../components/ui";
import { ClassNoteAttachments, type AttachmentRef } from "../../components/ClassNoteAttachments";
import { DateField } from "../../components/DateField";
import { AssignmentDeliverBlock } from "../../components/AssignmentDeliverBlock";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum, dayTypeLabel, routineSubjectLabel, hwNilReasonLabel, HW_NIL_REASONS } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { mentionsHomework } from "../../lib/homeworkText";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme/tokens";
import { dateKey } from "../../lib/dates";

const todayISO = (): string => dateKey();

/** Quran is out of the homework tracker entirely (D-#36), and a subject-group
 *  period has no section to declare against — the server refuses both. */
function canCarryHomework(slot: RoutineSlotT): boolean {
  return slot.groupType === "section" && !!slot.classId && slot.subject !== "QURAN";
}


/**
 * One period card: the published note, or the inline entry box for the whole
 * period — what was taught AND the day's homework.
 */
function PeriodNoteCard({ slot, date }: { slot: RoutineSlotT; date: string }): React.ReactElement {
  const toast = useToast();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [taught, setTaught] = useState("");
  const [taughtError, setTaughtError] = useState<string | undefined>(undefined);
  const [hwItemId, setHwItemId] = useState<string | null>(null);
  const [files, setFiles] = useState<AttachmentRef[]>([]);
  const [busy, setBusy] = useState(false);

  // DE-4 homework block. `hwMode` null = the teacher has not answered yet; the
  // publish button stays disabled until they do, because "no homework today" is a
  // real declaration (D-#299) and silence is not.
  const [hwMode, setHwMode] = useState<"DECLARE" | "NIL" | null>(null);
  const [topics, setTopics] = useState<string[]>([]);
  const [hwDesc, setHwDesc] = useState("");
  const [qCount, setQCount] = useState("");
  const [timeDecl, setTimeDecl] = useState("20");
  const [nilReason, setNilReason] = useState<string | null>(null);
  const [hwError, setHwError] = useState<string | undefined>(undefined);

  const [notesQ, refetchNotes] = useQuery({
    query: CLASS_NOTES_FOR_DATE_QUERY,
    variables: { groupType: slot.groupType, groupId: slot.groupId, date },
  });
  const note = (notesQ.data?.classNotesForDate ?? []).find((n) => n.slotId === slot.id);
  const [, publish] = useMutation(PUBLISH_CLASS_NOTE);

  const isSection = canCarryHomework(slot);
  // The homework block is offered only to a caller who could actually write it —
  // the server gates the half independently either way (D-#477).
  const mayDeclare = isSection && can("tracker:write");

  // The day's already-declared items for this slot's section+subject.
  const [tallyQ, refetchTally] = useQuery({
    query: HOMEWORK_DAY_TALLY,
    variables: { sectionId: slot.groupId, classId: slot.classId ?? "", date },
    pause: !isSection || (!open && !note?.homeworkItemId),
  });
  const dayItems = (tallyQ.data?.homeworkDayTally?.items ?? []).filter((it) => it.subject === slot.subject);

  // The nil declarations for the day, so a card that already said "no homework"
  // reopens on that answer instead of looking unanswered.
  const [nilQ, refetchNil] = useQuery({
    query: HW_NIL_DECLARATIONS,
    variables: { sectionId: slot.groupId, classId: slot.classId ?? "", date },
    pause: !isSection || !open,
  });
  const nilForSubject = (nilQ.data?.homeworkNilDeclarations ?? []).find((n) => n.subject === slot.subject) ?? null;

  // Topic catalog for (subject, classLevel) — the same read the declare screen uses.
  const [topicsQ] = useQuery({
    query: HOMEWORK_TOPICS_QUERY,
    variables: { subject: slot.subject, classLevel: slot.classLevel ?? 0 },
    pause: !open || !mayDeclare || slot.classLevel == null,
  });
  const topicOptions = topicsQ.data?.homeworkTopics ?? [];

  // Exactly one declared item → link silently; the Select appears only for >1.
  useEffect(() => {
    if (open && dayItems.length === 1) setHwItemId(dayItems[0].itemId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dayItems.length]);

  // Opening a card whose homework is already settled seeds the answer, so a
  // re-publish edits it rather than presenting an empty form.
  useEffect(() => {
    if (!open || !mayDeclare || hwMode !== null) return;
    const mine = dayItems[0];
    if (mine) {
      setHwMode("DECLARE");
      setTopics(mine.topTags ?? []);
      setHwDesc(mine.description ?? "");
      setQCount(mine.qCount != null ? String(mine.qCount) : "");
      setTimeDecl(mine.timeDecl != null ? String(mine.timeDecl) : "20");
    } else if (nilForSubject) {
      setHwMode("NIL");
      setNilReason(nilForSubject.reason);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mayDeclare, dayItems.length, nilForSubject]);

  function toggleTopic(code: string): void {
    setTopics((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));
  }

  /** Build the homework payload, or an error message naming the missing field. */
  function buildHomework(): { hw?: ClassNoteHomeworkIn; error?: string } {
    if (!mayDeclare || hwMode === null) return {};
    if (hwMode === "NIL") {
      if (!nilReason) return { error: STR.hwNilPickReason };
      return { hw: { mode: "NIL", reason: nilReason } };
    }
    if (topics.length === 0) return { error: `${STR.hwTopTags} — ${STR.fieldRequired}` };
    if (!hwDesc.trim()) return { error: STR.hwDescRequired };
    const q = parseInt(qCount, 10);
    if (!Number.isFinite(q)) return { error: `${STR.hwQCount} — ${STR.fieldRequired}` };
    const t = parseInt(timeDecl, 10);
    return {
      hw: {
        mode: "DECLARE",
        topTags: topics,
        description: hwDesc.trim(),
        qCount: q,
        timeDecl: Number.isFinite(t) ? t : undefined,
        attachmentIds: files.map((f) => f.fileId),
      },
    };
  }

  async function submit(): Promise<void> {
    setTaughtError(undefined);
    setHwError(undefined);
    if (!taught.trim()) {
      const msg = `${STR.rtTaughtSummary} — ${STR.fieldRequired}`;
      setTaughtError(msg);
      toast.show(msg, "danger");
      return;
    }
    const { hw, error } = buildHomework();
    if (error) {
      setHwError(error);
      toast.show(error, "danger");
      return;
    }
    setBusy(true);
    const res = await publish({
      slotId: slot.id,
      date,
      taughtSummaryBn: taught.trim(),
      // When the card declares homework the server links what it created; the
      // manual link is only for the pick-an-existing-item path.
      homeworkItemId: hw ? null : hwItemId,
      attachmentIds: files.map((f) => f.fileId),
      homework: hw ?? null,
    });
    setBusy(false);
    if (res.error || !res.data?.publishClassNote) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.rtPublished, "ok");
    setOpen(false);
    setTaught("");
    setHwItemId(null);
    setFiles([]);
    setHwMode(null);
    setTopics([]);
    setHwDesc("");
    setQCount("");
    setTimeDecl("20");
    setNilReason(null);
    refetchNotes({ requestPolicy: "network-only" });
    refetchTally({ requestPolicy: "network-only" });
    refetchNil({ requestPolicy: "network-only" });
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Body style={{ fontWeight: "700" }}>
            {STR.rtPeriodN} {bnNum(slot.periodNumber)}
            {slot.startTime && slot.endTime ? ` · ${bnNum(slot.startTime)}–${bnNum(slot.endTime)}` : ""}
          </Body>
          <Muted>
            {routineSubjectLabel(slot.subject)}
            {slot.groupName ? ` · ${slot.groupName}` : ""}
          </Muted>
        </View>
        {note ? <Badge text={`✓ ${STR.rtPublished}`} tone="ok" /> : null}
      </View>

      {note && !open ? (
        <>
          <Muted style={{ marginTop: space(1) }}>{note.taughtSummaryBn}</Muted>
          {note.homeworkItemId ? (
            <Muted style={{ marginTop: 2 }}>
              {STR.rtHomeworkId}: {dayItems.find((it) => it.itemId === note.homeworkItemId)?.hwId ?? "✓"}
            </Muted>
          ) : null}
          {note.attachmentIds.length > 0 ? (
            <Muted style={{ marginTop: 2 }}>
              {STR.cnAttachments}: {bnNum(note.attachmentIds.length)}
            </Muted>
          ) : null}
          {/* D-#336: the teacher edits their own note — the publish upsert
              (slotId+date) overwrites and RE-NOTIFIES guardians (owner policy). */}
          <Button
            title={STR.cnEditNote}
            variant="secondary"
            onPress={() => {
              setTaught(note.taughtSummaryBn);
              setHwItemId(note.homeworkItemId);
              setFiles(
                note.attachmentIds.map((fileId, i) => ({ fileId, name: `${STR.cnAttachments} ${i + 1}` })),
              );
              setOpen(true);
            }}
            style={{ marginTop: space(2) }}
          />
        </>
      ) : open ? (
        <View style={{ marginTop: space(2), gap: space(1) }}>
          <Field label={STR.rtTaughtSummary} value={taught} onChangeText={setTaught} multiline error={taughtError} />

          {/* DE-4: the day's homework, in the same card. */}
          {mayDeclare ? (
            <View style={{ gap: space(1) }}>
              <Body style={{ fontWeight: "700" }}>{STR.gpHomeworkOpen}</Body>
              <ChipRow>
                <Chip label={STR.cnHwYes} selected={hwMode === "DECLARE"} onPress={() => setHwMode("DECLARE")} />
                <Chip label={STR.cnHwNo} selected={hwMode === "NIL"} onPress={() => setHwMode("NIL")} />
              </ChipRow>

              {hwMode === "NIL" ? (
                <ChipRow>
                  {HW_NIL_REASONS.map((r) => (
                    <Chip
                      key={r}
                      label={hwNilReasonLabel(r)}
                      selected={nilReason === r}
                      onPress={() => setNilReason((cur) => (cur === r ? null : r))}
                    />
                  ))}
                </ChipRow>
              ) : null}

              {hwMode === "DECLARE" ? (
                <>
                  {slot.classLevel == null ? (
                    <Muted>{STR.hwNoClassLevel}</Muted>
                  ) : topicsQ.fetching ? (
                    <Muted>{STR.hwTopicsLoading}</Muted>
                  ) : (
                    <ChipRow>
                      {topicOptions.map((tp) => (
                        <Chip
                          key={tp.code}
                          label={tp.labelBn}
                          selected={topics.includes(tp.code)}
                          onPress={() => toggleTopic(tp.code)}
                        />
                      ))}
                    </ChipRow>
                  )}
                  <Field label={STR.hwDescLabel} value={hwDesc} onChangeText={setHwDesc} multiline />
                  <View style={{ flexDirection: "row", gap: space(2) }}>
                    <View style={{ flex: 1 }}>
                      <Field label={STR.hwTimeDecl} value={timeDecl} onChangeText={setTimeDecl} keyboardType="number-pad" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field label={STR.hwQCount} value={qCount} onChangeText={setQCount} keyboardType="number-pad" />
                    </View>
                  </View>
                </>
              ) : null}
              {hwError ? <Muted style={{ color: "#b00020" }}>⚠ {hwError}</Muted> : null}
              {/* D-#505: the text announces homework but this card is not declaring
                  any. A reminder, never a block — see `mentionsHomework`. */}
              {hwMode !== "DECLARE" && mentionsHomework(taught) ? (
                <Notice message={STR.cnHwTextButNoDeclare} tone="warn" />
              ) : null}
            </View>
          ) : isSection && dayItems.length > 1 ? (
            // No tracker:write — the old link-an-existing-item path stays available.
            <Select
              label={STR.rtHomeworkId}
              value={hwItemId}
              options={dayItems.map((it) => ({
                label: it.hwId,
                value: it.itemId,
                hint: it.topicLabelBn ?? routineSubjectLabel(slot.subject),
              }))}
              onChange={setHwItemId}
              placeholder={STR.rtHomeworkId}
            />
          ) : isSection && dayItems.length === 1 ? (
            <Muted>🔗 {dayItems[0].hwId}</Muted>
          ) : null}

          {/* One picker: the files land on the note, and on the homework item too
              when the card declares one — a worksheet is uploaded once. */}
          <ClassNoteAttachments value={files} onChange={setFiles} />
          <Button title={STR.rtPublish} onPress={() => void submit()} loading={busy} disabled={busy} />
        </View>
      ) : (
        <Button title={STR.rtClassNote} variant="secondary" onPress={() => setOpen(true)} style={{ marginTop: space(2) }} />
      )}

      {/* DE-5: on this subject's delivery day the week's assignment is handed out
          from the same card — the third trip a teacher used to make. */}
      <AssignmentDeliverBlock slot={slot} date={date} />
    </Card>
  );
}

export default function MyClassNotesScreen(): React.ReactElement {
  const [date, setDate] = useState(todayISO());
  const [dayQ, refetchDay] = useQuery({ query: MY_DAY_QUERY, variables: { date } });
  const day = dayQ.data?.myDay;
  const slots = day?.slots ?? [];

  // Focus-refetch (house pattern) so a note published elsewhere shows on return.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      refetchDay({ requestPolicy: "network-only" });
    }, [refetchDay]),
  );
  const { refreshing, onRefresh } = usePullRefresh(dayQ.fetching, () =>
    refetchDay({ requestPolicy: "network-only" }),
  );

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <DateField label={STR.rtDate} value={date} onChange={setDate} />
        <Muted>{STR.cnMyPeriods}</Muted>
      </View>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4), paddingTop: space(2) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {dayQ.error ? (
          <ErrorBanner message={friendlyError(dayQ.error)} onRetry={() => refetchDay({ requestPolicy: "network-only" })} />
        ) : dayQ.fetching && !day ? (
          <Loader label={STR.loading} />
        ) : slots.length === 0 ? (
          <EmptyState
            message={day && day.dayType !== "FULL" && day.dayType !== "QURAN_ONLY" ? dayTypeLabel(day.dayType) : STR.rtNoSlots}
          />
        ) : (
          slots.map((s) => <PeriodNoteCard key={s.id} slot={s} date={date} />)
        )}
      </ScrollView>
    </Screen>
  );
}
