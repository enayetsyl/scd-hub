/**
 * BookImageQueueScreen (SB-2, D-#409/#417/#419) — the illustrator's queue.
 *
 * THE HIGHEST-TRAFFIC SCREEN IN THE MODULE. C1-BAN has 201 image slots and the SOP
 * budgets 2–4 generations each, so this is where the pipeline's hours actually go. It
 * is built around one loop, repeated: see what is outstanding → copy the prompt →
 * generate outside the app → upload the finished file.
 *
 * DEFAULTS TO OUTSTANDING-ONLY. A list of 201 rows where 190 are done is a list nobody
 * scans; the work is the eleven that are not.
 *
 * `complianceNote` is never fetched here — stripe/compliance language must not reach a
 * prompt the illustrator can paste (README §5). The server does not expose it on this
 * type either; this is the second half of one rule, not a duplicate of it.
 *
 * STALENESS IS SHOWN ON THE SLOT, not only in the build report, so a re-approval's
 * consequences are visible when someone looks at the slot rather than days later when
 * assembly refuses (D-#417).
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useQuery } from "urql";
import {
  SUPPORT_BOOKS, SUPPORT_BOOK_SLOTS,
  type SupportBookT, type SupportBookSlotT,
} from "../../graphql/supportBook";
import { Screen, Body, Muted, Card, Select, Badge, Button, Chip, ChipRow, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum } from "../../lib/labels";
import { pickAndUploadBookImage, FileUploadError } from "../../lib/files";
import { space, useColors } from "../../theme";

/** A slot is outstanding until its COMPLIANT artifact exists and is fresh — that is the
 *  file `book.json` names, so it is the only stage that decides "done". */
function isOutstanding(s: SupportBookSlotT): boolean {
  return s.compliant !== "FRESH";
}

function stageLabel(state: string): string {
  if (state === "FRESH") return STR.sbFresh;
  if (state === "STALE") return STR.sbStale;
  return STR.sbMissing;
}

function StageChip({ label, state }: { label: string; state: string }): React.ReactElement {
  const colors = useColors();
  // Stale must not read as merely "not done" — it is work that LOOKS finished and is
  // not, which is the whole failure mode.
  const tone =
    state === "FRESH" ? colors.primary : state === "STALE" ? colors.error : colors.textDisabled;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginRight: space(3), marginTop: 4 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone, marginRight: 4 }} />
      <Muted style={{ fontSize: 12 }}>{`${label} · ${stageLabel(state)}`}</Muted>
    </View>
  );
}

/** The chain, in the order a person walks it. Rendered as four upload buttons rather
 *  than a stage dropdown: the four stages ARE the workflow, and one tap is the whole
 *  interaction on a screen someone visits two hundred times. */
const STAGES: Array<{ stage: string; label: string }> = [
  { stage: "APPROVED", label: STR.sbStageApproved },
  { stage: "CROPPED", label: STR.sbStageCropped },
  { stage: "UPSCALED", label: STR.sbStageUpscaled },
  { stage: "COMPLIANT", label: STR.sbStageCompliant },
];

function SlotCard({
  slot,
  onUploaded,
}: {
  slot: SupportBookSlotT;
  onUploaded: () => void;
}): React.ReactElement {
  const colors = useColors();
  const [copied, setCopied] = useState(false);
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  async function onCopy(): Promise<void> {
    if (!slot.prompt) return;
    await Clipboard.setStringAsync(slot.prompt);
    setCopied(true);
  }

  async function onUpload(stage: string): Promise<void> {
    setNote(null);
    setBusyStage(stage);
    try {
      const up = await pickAndUploadBookImage({
        bookId: slot.bookId,
        lessonNo: slot.lessonNo,
        slotId: slot.slotId,
        stage,
        // The tool that drew it is recorded on APPROVED rows (D-#419). For now every
        // image comes from the desktop app; when the API path lands this stops being
        // a constant.
        generatorTool: stage === "APPROVED" ? "chatgpt-desktop" : undefined,
      });
      if (!up) return; // picker cancelled — not an outcome worth reporting
      setNote({ text: STR.sbUploaded, bad: false });
      // Refetch rather than patch locally: the upload may have made DOWNSTREAM stages
      // stale (D-#417), and only the server knows the whole chain.
      onUploaded();
    } catch (e) {
      setNote({ text: e instanceof FileUploadError ? e.message : String(e), bad: true });
    } finally {
      setBusyStage(null);
    }
  }

  return (
    <Card style={{ marginBottom: space(3) }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
        <Body style={{ fontWeight: "700", flexShrink: 1 }}>{slot.slotId}</Body>
        <Muted style={{ marginLeft: space(2) }}>{`${STR.sbLesson} ${bnNum(slot.lessonNo)}`}</Muted>
        {slot.hasStale ? (
          <View style={{ marginLeft: space(2) }}>
            <Badge text={STR.sbStale} tone="danger" />
          </View>
        ) : null}
      </View>

      {slot.sceneDescription ? (
        <Body style={{ marginTop: space(2) }}>{slot.sceneDescription}</Body>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: space(2) }}>
        {slot.aspect ? <Muted style={{ marginRight: space(3) }}>{`${STR.sbAspect}: ${slot.aspect}`}</Muted> : null}
        {slot.containsLivingBeing != null ? (
          <Muted style={{ marginRight: space(3) }}>
            {`${STR.sbLivingBeing}: ${slot.containsLivingBeing ? STR.sbYes : STR.sbNo}`}
          </Muted>
        ) : null}
        {slot.imageClass ? <Muted>{slot.imageClass}</Muted> : null}
      </View>

      {slot.refs.length > 0 ? (
        // Canon characters are NEVER generated from text alone — the reference sheet is
        // attached to every generation (SOP 5.2). Naming them here is the reminder.
        <Muted style={{ marginTop: space(2) }}>{`${STR.sbRefs}: ${slot.refs.join(", ")}`}</Muted>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: space(2) }}>
        <StageChip label={STR.sbStageApproved} state={slot.approved} />
        <StageChip label={STR.sbStageCropped} state={slot.cropped} />
        <StageChip label={STR.sbStageUpscaled} state={slot.upscaled} />
        <StageChip label={STR.sbStageCompliant} state={slot.compliant} />
      </View>

      {slot.hasStale ? (
        <Muted style={{ marginTop: space(2), color: colors.error }}>{STR.sbStaleWarn}</Muted>
      ) : null}

      <View
        style={{
          marginTop: space(3), borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space(3),
        }}
      >
        {slot.prompt ? (
          <>
            <Body style={{ fontSize: 13 }} numberOfLines={6}>{slot.prompt}</Body>
            <Button
              title={copied ? STR.sbCopied : STR.sbCopyPrompt}
              variant="secondary"
              onPress={() => { void onCopy(); }}
              style={{ marginTop: space(2), alignSelf: "flex-start" }}
            />
          </>
        ) : (
          <Muted>{STR.sbNoPrompt}</Muted>
        )}
      </View>

      <View
        style={{
          marginTop: space(3), borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space(3),
        }}
      >
        <Muted style={{ marginBottom: 4 }}>{STR.sbUploadHint}</Muted>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {STAGES.map((s) => (
            <Button
              key={s.stage}
              title={busyStage === s.stage ? STR.sbUploading : `${STR.sbUpload} · ${s.label}`}
              variant="ghost"
              loading={busyStage === s.stage}
              disabled={busyStage !== null}
              onPress={() => { void onUpload(s.stage); }}
              style={{ marginRight: space(2), marginTop: 4 }}
            />
          ))}
        </View>
        {note ? (
          <Muted style={{ marginTop: space(2), color: note.bad ? colors.error : colors.primary }}>
            {note.text}
          </Muted>
        ) : null}
      </View>
    </Card>
  );
}

export default function BookImageQueueScreen(): React.ReactElement {
  const colors = useColors();
  const [booksQ, refetchBooks] = useQuery<{ supportBooks: SupportBookT[] }>({ query: SUPPORT_BOOKS });
  const books = booksQ.data?.supportBooks ?? [];
  const [pickedBook, setPickedBook] = useState<string | null>(null);
  const bookId = pickedBook ?? books[0]?.bookId ?? "";

  const [outstandingOnly, setOutstandingOnly] = useState(true);

  const [slotsQ, refetchSlots] = useQuery<{ supportBookSlots: SupportBookSlotT[] }>({
    query: SUPPORT_BOOK_SLOTS,
    variables: { bookId },
    pause: !bookId,
  });

  const all = useMemo(() => slotsQ.data?.supportBookSlots ?? [], [slotsQ.data]);
  const outstanding = useMemo(() => all.filter(isOutstanding), [all]);
  const staleCount = useMemo(() => all.filter((s) => s.hasStale).length, [all]);
  const shown = outstandingOnly ? outstanding : all;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.sbQueueTitle}</Body>
          <Muted>{STR.sbQueueSub}</Muted>

          <Select
            label={STR.sbBook}
            value={bookId || null}
            options={books.map((b) => ({ label: `${b.titleBn} (${b.bookId})`, value: b.bookId }))}
            onChange={(v) => setPickedBook(v)}
            placeholder={STR.sbBook}
          />

          {bookId ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: space(2) }}>
              <Muted style={{ marginRight: space(3) }}>
                {`${STR.sbOutstanding}: ${bnNum(outstanding.length)} / ${bnNum(all.length)}`}
              </Muted>
              {staleCount > 0 ? (
                // Surfaced at the top because a stale artifact blocks the whole book's
                // build, not just its own slot.
                <Muted style={{ color: colors.error }}>
                  {`${STR.sbBlocksBuild} — ${bnNum(staleCount)} ${STR.sbStale}`}
                </Muted>
              ) : null}
            </View>
          ) : null}

          <ChipRow>
            <Chip
              label={STR.sbFilterOutstanding}
              selected={outstandingOnly}
              onPress={() => setOutstandingOnly(true)}
            />
            <Chip
              label={STR.sbFilterAll}
              selected={!outstandingOnly}
              onPress={() => setOutstandingOnly(false)}
            />
          </ChipRow>
        </Card>

        <View style={{ height: space(3) }} />

        <QueryGate
          results={[booksQ, slotsQ]}
          onRetry={() => {
            refetchBooks({ requestPolicy: "network-only" });
            refetchSlots({ requestPolicy: "network-only" });
          }}
          loaderLabel={STR.loading}
        >
          {shown.length === 0 ? (
            <EmptyState message={outstandingOnly && all.length > 0 ? STR.sbAllDone : STR.empty} />
          ) : (
            shown.map((s) => (
              <SlotCard
                key={`${s.lessonNo}-${s.slotId}`}
                slot={s}
                onUploaded={() => refetchSlots({ requestPolicy: "network-only" })}
              />
            ))
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
