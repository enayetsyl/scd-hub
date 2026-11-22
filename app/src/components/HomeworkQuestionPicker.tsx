/**
 * HomeworkQuestionPicker (AL-5, B1/B2/B3, AC-B1, AC-B3, AC-B14, AC-B16) — the 2027 question picker on the
 * Declare-homework screen. Shown only while the school's release switch `academicLoop2027On` is ON (the screen
 * decides); while it is off the screen looks exactly as it did in 2026.
 *
 * The server drafts the questions from the sessions taught that day (`masteryHomeworkDraft`, unused first, a repeat
 * marked "আবার"). The teacher swaps one for the next bank candidate on the same objective, removes it, adds another
 * from the bank, writes her own (text + marks), and adds free lines (kind + text + minutes, no marks). The running
 * line is marks × the policy rate + the free lines' minutes (R26) — the rate is read by the screen, never typed here.
 * All state changes go through the pure `homeworkPicker` reducer (unit-tested); this file only draws and fetches.
 *
 * A locked sheet (sent to print, or issued) is read-only and says so. "প্রিন্টে পাঠান" files the print request for
 * the saved sheet — only on the tap, never by itself.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useClient, useMutation, useQuery } from "urql";
import { HOMEWORK_FREE_LINE_KINDS, HOMEWORK_FREE_LINE_KIND_LABELS_BN, HOMEWORK_FREE_LINE_KIND_LABELS_EN, PRINT_COLOURS, PRINT_COLOUR_LABELS_BN, PRINT_COLOUR_LABELS_EN, PRINT_SIDES, PRINT_SIDES_LABELS_BN, PRINT_SIDES_LABELS_EN } from "@scd/shared";
import { MASTERY_HOMEWORK_CANDIDATES_QUERY, MASTERY_HOMEWORK_DRAFT_QUERY, MASTERY_PAPER_QUERY, type MasteryHomeworkDraft, type MasteryPaperRow } from "../graphql/mastery";
import { CREATE_PRINT_REQUEST } from "../graphql/printing";
import { Badge, Body, Button, Card, Chip, ChipRow, Field, Muted, Notice } from "./ui";
import { useConfirm } from "../state/ConfirmContext";
import { useToast } from "../state/ToastContext";
import { STR, bnNum, getActiveLang, hwSubjectLabel } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { dateKey } from "../lib/dates";
import {
  addableCandidates,
  draftToPicker,
  estMinutes,
  nextCandidate,
  totalMarks,
  type PickerAction,
  type PickerCandidate,
  type PickerFreeLine,
  type PickerItem,
  type PickerState,
} from "../lib/homeworkPicker";
import { space } from "../theme/tokens";

const kindLabel = (k: string): string =>
  (getActiveLang() === "en" ? HOMEWORK_FREE_LINE_KIND_LABELS_EN : HOMEWORK_FREE_LINE_KIND_LABELS_BN)[k as keyof typeof HOMEWORK_FREE_LINE_KIND_LABELS_BN] ?? k;

export function HomeworkQuestionPicker({
  state,
  dispatch,
  minutesPerMark,
  sectionId,
  subject,
  classLevel,
  date,
  loadDraft,
  editPaperId,
  editFreeLines,
  readOnly,
  locked,
}: {
  state: PickerState;
  dispatch: (a: PickerAction) => void;
  /** The school policy's minutes per mark (R26). */
  minutesPerMark: number;
  sectionId: string;
  subject: string | null;
  classLevel: number | null;
  date: string;
  /** Create mode: fetch the server draft for (section, subject, date) and load it. */
  loadDraft: boolean;
  /** Edit mode: the saved HW paper to load the picked questions from, and the item's free lines. */
  editPaperId?: string | null;
  editFreeLines?: PickerFreeLine[];
  /** Issued or locked: shown, not changeable. */
  readOnly: boolean;
  /** The sheet was sent to print / issued — the line the owner asked for is shown. */
  locked: boolean;
}): React.ReactElement | null {
  const client = useClient();
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [swapNote, setSwapNote] = useState<string | null>(null);
  const loadedKey = useRef<string | null>(null);

  // --- create mode: the server draft, once per (section, subject, date) ---
  useEffect(() => {
    if (!loadDraft || !subject || !sectionId) return;
    const key = `${sectionId}|${subject}|${date}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    let live = true;
    setDrafting(true);
    setDraftNote(null);
    void client
      .query(MASTERY_HOMEWORK_DRAFT_QUERY, { sectionId, subject, dateKey: date }, { requestPolicy: "network-only" })
      .toPromise()
      .then((res) => {
        if (!live) return;
        setDrafting(false);
        const d = (res.data?.masteryHomeworkDraft ?? null) as MasteryHomeworkDraft | null;
        if (res.error || !d) {
          dispatch({ type: "load", items: [], freeLines: [] });
          setDraftNote(res.error ? friendlyError(res.error) : STR.al5NoDraft);
          return;
        }
        const loaded = draftToPicker(d.items, minutesPerMark);
        dispatch({ type: "load", items: loaded.items, freeLines: loaded.freeLines });
        if (d.reason) setDraftNote(d.reason === "NO_LESSON_MARKED" ? STR.msDraftNoLesson : STR.al5NoDraft);
        else if (d.items.length === 0) setDraftNote(STR.al5NoDraft);
      });
    return () => {
      live = false;
    };
    // The rate only seeds a book-exercise line's minutes; a later change of it must not reload the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadDraft, sectionId, subject, date]);

  // --- edit mode: the saved sheet's questions ---
  const [paperQ] = useQuery({ query: MASTERY_PAPER_QUERY, variables: { paperId: editPaperId ?? "" }, pause: !editPaperId });
  useEffect(() => {
    if (loadDraft) return;
    if (loadedKey.current === "edit") return;
    if (editPaperId) {
      const detail = paperQ.data?.masteryPaper;
      const paper = (detail?.paper ?? null) as MasteryPaperRow | null;
      if (!paper) return;
      loadedKey.current = "edit";
      let own = 0;
      dispatch({
        type: "load",
        items: paper.items.map((i) =>
          i.origin === "BANK" && i.qid
            ? { key: i.qid, origin: "BANK" as const, qid: i.qid, textBn: i.textBn ?? i.qid, loCode: i.loCodes[0] ?? "", marks: i.marks, repeat: false }
            : { key: `own:${(own += 1)}`, origin: "TEACHER" as const, qid: null, textBn: i.textBn ?? "", loCode: "", marks: i.marks, repeat: false },
        ),
        freeLines: ((detail?.freeLines ?? editFreeLines ?? []) as PickerFreeLine[]).map((l) => ({ kind: l.kind, textBn: l.textBn, estMinutes: l.estMinutes })),
      });
    } else {
      loadedKey.current = "edit";
      dispatch({ type: "load", items: [], freeLines: editFreeLines ?? [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadDraft, editPaperId, paperQ.data]);

  // --- the bank pool the swap / add draw from: gold questions on the objectives now on the sheet ---
  const loCodes = useMemo(() => [...new Set(state.items.map((i) => i.loCode).filter(Boolean))].sort(), [state.items]);
  // The server applies the draft's own exclusions (window, seen, homework share), so nothing offered here is refused at save.
  const [bankQ] = useQuery({
    query: MASTERY_HOMEWORK_CANDIDATES_QUERY,
    variables: { sectionId, subject: subject ?? "", dateKey: date, loCodes },
    pause: readOnly || !subject || !sectionId || loCodes.length === 0,
  });
  const pool: PickerCandidate[] = useMemo(
    () =>
      ((bankQ.data?.masteryHomeworkCandidates ?? []) as { qid: string; textBn: string | null; loCode: string; marks: number; repeat: boolean }[]).map((q) => ({
        qid: q.qid,
        textBn: q.textBn || q.qid,
        loCodes: [q.loCode],
        marks: q.marks,
        repeat: q.repeat,
      })),
    [bankQ.data],
  );

  const [showBank, setShowBank] = useState(false);
  const [bankFilter, setBankFilter] = useState("");
  const [ownText, setOwnText] = useState("");
  const [ownMarks, setOwnMarks] = useState("");
  const [ownErr, setOwnErr] = useState(false);
  const [lineKind, setLineKind] = useState<string>(HOMEWORK_FREE_LINE_KINDS[0]);
  const [lineText, setLineText] = useState("");
  const [lineMin, setLineMin] = useState("10");
  const [lineErr, setLineErr] = useState(false);

  function onSwap(item: PickerItem): void {
    const c = nextCandidate(pool, state.items, item);
    if (!c) {
      setSwapNote(STR.al5NoCandidate);
      return;
    }
    setSwapNote(null);
    dispatch({ type: "swap", key: item.key, candidate: c });
  }

  function onAddOwn(): void {
    const marks = Number(ownMarks);
    if (!ownText.trim() || !(marks > 0) || Math.round(marks * 2) !== marks * 2) {
      setOwnErr(true);
      return;
    }
    setOwnErr(false);
    dispatch({ type: "addOwn", textBn: ownText, marks });
    setOwnText("");
    setOwnMarks("");
  }

  function onAddLine(): void {
    const min = Number(lineMin);
    if (!lineText.trim() || !Number.isInteger(min) || min < 0 || min > 240) {
      setLineErr(true);
      return;
    }
    setLineErr(false);
    dispatch({ type: "addFreeLine", line: { kind: lineKind, textBn: lineText, estMinutes: min } });
    setLineText("");
  }

  const addable = addableCandidates(pool, state.items, bankFilter);
  const minutes = estMinutes(state, minutesPerMark);

  return (
    <Card>
      <Body style={{ fontWeight: "700", marginBottom: 4 }}>{STR.al5PickTitle}</Body>
      {readOnly ? (
        locked ? <Notice message={STR.al5SentToPrint} tone="info" /> : null
      ) : (
        <Muted style={{ marginBottom: space(2) }}>{STR.al5PickHint}</Muted>
      )}
      {drafting ? <Muted>{STR.loading}</Muted> : null}
      {draftNote ? <Notice message={draftNote} tone="info" /> : null}

      {state.items.map((it, idx) => (
        <View key={it.key} style={{ marginTop: space(2), gap: space(1) }}>
          <View style={{ flexDirection: "row", gap: space(2), alignItems: "flex-start" }}>
            <Body style={{ flex: 1, minWidth: 0 }}>
              {bnNum(idx + 1)}. {it.textBn}
            </Body>
            <Badge text={`${bnNum(it.marks)}`} tone="brand" />
          </View>
          <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap", alignItems: "center" }}>
            {it.repeat ? <Badge text={STR.al5Again} tone="gold" /> : null}
            {it.origin === "TEACHER" ? <Badge text={STR.al5AddOwn} tone="muted" /> : null}
            {!readOnly ? (
              <>
                {it.origin === "BANK" ? <Button title={STR.al5Swap} variant="ghost" onPress={() => onSwap(it)} /> : null}
                <Button title={STR.remove} variant="ghost" onPress={() => dispatch({ type: "remove", key: it.key })} />
              </>
            ) : null}
          </View>
          {it.repeat ? <Muted>{STR.al5AgainHint}</Muted> : null}
        </View>
      ))}
      {swapNote ? <Muted style={{ marginTop: space(1) }}>{swapNote}</Muted> : null}

      {state.freeLines.length > 0 ? (
        <View style={{ marginTop: space(3) }}>
          <Muted style={{ fontWeight: "700" }}>{STR.al5FreeLines}</Muted>
          {state.freeLines.map((l, i) => (
            <View key={`${i}:${l.textBn}`} style={{ flexDirection: "row", gap: space(2), alignItems: "center", marginTop: space(1) }}>
              <Body style={{ flex: 1, minWidth: 0 }}>
                {kindLabel(l.kind)} · {l.textBn} · {bnNum(l.estMinutes)} {STR.hwMinutes}
              </Body>
              {!readOnly ? <Button title={STR.remove} variant="ghost" onPress={() => dispatch({ type: "removeFreeLine", index: i })} /> : null}
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ marginTop: space(3), flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
        <Muted style={{ flexShrink: 1, fontWeight: "700" }}>{STR.al5Total}</Muted>
        <Badge text={`${bnNum(totalMarks(state.items))} · ${bnNum(minutes)} ${STR.hwMinutes}`} tone="ok" />
      </View>

      {!readOnly ? (
        <View style={{ marginTop: space(3), gap: space(2) }}>
          <Button title={`${showBank ? "▾" : "▸"} ${STR.al5AddBank}`} variant="secondary" onPress={() => setShowBank((v) => !v)} />
          {showBank ? (
            <>
              <Field label={STR.al5BankFilter} value={bankFilter} onChangeText={setBankFilter} />
              {addable.length === 0 ? (
                <Muted>{STR.al5AddBankNone}</Muted>
              ) : (
                addable.slice(0, 20).map((c) => (
                <View key={c.qid} style={{ flexDirection: "row", gap: space(2), alignItems: "center" }}>
                  <Body style={{ flex: 1, minWidth: 0 }}>
                    {c.textBn} · {bnNum(c.marks)}
                    {c.repeat ? ` · ${STR.al5Again}` : ""}
                  </Body>
                  <Button title={STR.al5AddOwnBtn} variant="ghost" onPress={() => dispatch({ type: "addBank", candidate: c, loCode: c.loCodes.find((x) => loCodes.includes(x)) ?? c.loCodes[0] ?? "" })} />
                </View>
                ))
              )}
            </>
          ) : null}

          <Muted style={{ fontWeight: "700" }}>{STR.al5AddOwn}</Muted>
          <Field label={STR.al5OwnText} value={ownText} onChangeText={setOwnText} multiline autoCapitalize="sentences" />
          <Field label={STR.al5OwnMarks} value={ownMarks} onChangeText={setOwnMarks} keyboardType="decimal-pad" />
          {ownErr ? <Muted>⚠ {STR.al5OwnBad}</Muted> : null}
          <Button title={STR.al5AddOwnBtn} variant="secondary" onPress={onAddOwn} />

          <Muted style={{ fontWeight: "700" }}>{STR.al5FreeLines}</Muted>
          <ChipRow>
            {HOMEWORK_FREE_LINE_KINDS.map((k) => (
              <Chip key={k} label={kindLabel(k)} selected={lineKind === k} onPress={() => setLineKind(k)} />
            ))}
          </ChipRow>
          <Field label={STR.al5FreeLineText} value={lineText} onChangeText={setLineText} autoCapitalize="sentences" />
          <Field label={STR.al5FreeLineMin} value={lineMin} onChangeText={setLineMin} keyboardType="number-pad" />
          {lineErr ? <Muted>⚠ {STR.al5FreeLineBad}</Muted> : null}
          <Button title={STR.al5FreeLineAdd} variant="secondary" onPress={onAddLine} />
        </View>
      ) : null}
      {/* `subject` label kept for screen readers of the card header */}
      {subject ? <Muted style={{ marginTop: space(2) }}>{hwSubjectLabel(subject, classLevel)}</Muted> : null}
    </Card>
  );
}

/**
 * "প্রিন্টে পাঠান" (B3, AC-B3): files ONE print request for the saved HW sheet — purpose HOMEWORK, source
 * MASTERY_PAPER, copies = the class present count (the server's default). Only on the tap; the teacher picks colour
 * and sides like every print request. Once sent the sheet is locked and the picker is read-only.
 */
export function SendHomeworkToPrint({
  paperId,
  hwId,
  subject,
  classId,
  sectionId,
  dateGiven,
  onSent,
}: {
  paperId: string;
  hwId: string;
  subject: string;
  classId: string;
  sectionId: string;
  dateGiven: string;
  onSent: () => void;
}): React.ReactElement {
  const [colour, setColour] = useState<string>("BW");
  const [sides, setSides] = useState<string>("DOUBLE");
  const [, createReq] = useMutation(CREATE_PRINT_REQUEST);
  const { confirmAction } = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const en = getActiveLang() === "en";

  async function onSend(): Promise<void> {
    if (busy) return;
    if (!(await confirmAction({ message: STR.al5SendPrintAsk, confirmLabel: STR.al5SendPrint, tone: "primary" }))) return;
    setBusy(true);
    const today = dateKey();
    const day = dateGiven.slice(0, 10);
    const res = await createReq({
      title: `${hwId} — ${hwSubjectLabel(subject)}`,
      purpose: "HOMEWORK",
      sourceType: "MASTERY_PAPER",
      masteryPaperId: paperId,
      colour,
      sides,
      copies: 1, // the server resolves the count from the class's present children (CLASS_PRESENT)
      copiesMode: "CLASS_PRESENT",
      copiesClassId: classId,
      neededByKey: day >= today ? day : today,
      classId,
      sectionId,
      subject,
    });
    setBusy(false);
    if (res.error || !res.data?.createPrintRequest) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.al5PrintSent, "ok");
    onSent();
  }

  return (
    <Card>
      <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.al5SendPrint}</Body>
      <ChipRow>
        {PRINT_COLOURS.map((c) => (
          <Chip key={c} label={(en ? PRINT_COLOUR_LABELS_EN : PRINT_COLOUR_LABELS_BN)[c]} selected={colour === c} onPress={() => setColour(c)} />
        ))}
      </ChipRow>
      <ChipRow>
        {PRINT_SIDES.map((s) => (
          <Chip key={s} label={(en ? PRINT_SIDES_LABELS_EN : PRINT_SIDES_LABELS_BN)[s]} selected={sides === s} onPress={() => setSides(s)} />
        ))}
      </ChipRow>
      <Button title={STR.al5SendPrint} onPress={() => void onSend()} loading={busy} disabled={busy} style={{ marginTop: space(2) }} />
    </Card>
  );
}
