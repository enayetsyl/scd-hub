/**
 * MyClassNotesScreen (UX-8, prd-ux-improvements.md §4.8, D-#266) — the teacher-first
 * Class Notes front door. The routine already knows which periods the caller taught,
 * so this screen NEVER asks for class/subject: it lists the caller's OWN periods for
 * the chosen date (the UX-4 `myDay` read — cover-overlaid, day-type-filtered,
 * view-enriched) with a published ✓ badge per period, and an inline publish box
 * (`publishClassNote`, unchanged) where a note is still missing.
 *
 * The old typed "Homework ID" field is replaced by that day's declared items for
 * the slot's section+subject (the same `homeworkDayTally` read the reconcile screen
 * uses): exactly one item links silently; several offer a name-based Select; a
 * subjectgroup period (Quran/Arabic) has no homework link. The group-based
 * DailyNoteScreen remains the admin/cover/Principal path, unchanged.
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
  type RoutineSlotT,
} from "../../graphql/operations";
import { Screen, Body, Muted, Card, Field, Button, Badge, Select, Loader, ErrorBanner, EmptyState } from "../../components/ui";
import { ClassNoteAttachments, type AttachmentRef } from "../../components/ClassNoteAttachments";
import { DateField } from "../../components/DateField";
import { STR, bnNum, dayTypeLabel, routineSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme/tokens";
import { dateKey } from "../../lib/dates";

const todayISO = (): string => dateKey();

/** One period card: published state (slot-keyed, exactly as DailyNote maps it) or
 *  the inline publish box. Its classNotesForDate query is keyed by the slot's own
 *  group — cards of the same group share one cached read. */
function PeriodNoteCard({ slot, date }: { slot: RoutineSlotT; date: string }): React.ReactElement {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [taught, setTaught] = useState("");
  const [taughtError, setTaughtError] = useState<string | undefined>(undefined);
  const [hwItemId, setHwItemId] = useState<string | null>(null);
  const [files, setFiles] = useState<AttachmentRef[]>([]);
  const [busy, setBusy] = useState(false);

  const [notesQ, refetchNotes] = useQuery({
    query: CLASS_NOTES_FOR_DATE_QUERY,
    variables: { groupType: slot.groupType, groupId: slot.groupId, date },
  });
  const note = (notesQ.data?.classNotesForDate ?? []).find((n) => n.slotId === slot.id);
  const [, publish] = useMutation(PUBLISH_CLASS_NOTE);

  // Homework link (UX-8 item 2): the day's declared items for this slot's
  // section+subject, fetched only when the publish box is open. Subjectgroup
  // periods (Quran/Arabic) have no section homework — no picker.
  const isSection = slot.groupType === "section" && !!slot.classId;
  const [tallyQ] = useQuery({
    query: HOMEWORK_DAY_TALLY,
    variables: { sectionId: slot.groupId, classId: slot.classId ?? "", date },
    pause: !open || !isSection,
  });
  const dayItems = (tallyQ.data?.homeworkDayTally?.items ?? []).filter((it) => it.subject === slot.subject);

  // Exactly one declared item → link silently; the Select appears only for >1.
  useEffect(() => {
    if (open && dayItems.length === 1) setHwItemId(dayItems[0].itemId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dayItems.length]);

  async function submit(): Promise<void> {
    setTaughtError(undefined);
    if (!taught.trim()) {
      const msg = `${STR.rtTaughtSummary} — ${STR.fieldRequired}`;
      setTaughtError(msg);
      toast.show(msg, "danger");
      return;
    }
    setBusy(true);
    const res = await publish({
      slotId: slot.id,
      date,
      taughtSummaryBn: taught.trim(),
      homeworkItemId: hwItemId,
      attachmentIds: files.map((f) => f.fileId),
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
    refetchNotes({ requestPolicy: "network-only" });
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

      {note ? (
        <Muted style={{ marginTop: space(1) }}>{note.taughtSummaryBn}</Muted>
      ) : open ? (
        <View style={{ marginTop: space(2), gap: space(1) }}>
          <Field label={STR.rtTaughtSummary} value={taught} onChangeText={setTaught} multiline error={taughtError} />
          {isSection && dayItems.length > 1 ? (
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
          ) : null}
          {isSection && dayItems.length === 1 ? (
            <Muted>🔗 {dayItems[0].hwId}</Muted>
          ) : null}
          <ClassNoteAttachments value={files} onChange={setFiles} />
          <Button title={STR.rtPublish} onPress={() => void submit()} loading={busy} disabled={busy} />
        </View>
      ) : (
        <Button title={STR.rtClassNote} variant="secondary" onPress={() => setOpen(true)} style={{ marginTop: space(2) }} />
      )}
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
