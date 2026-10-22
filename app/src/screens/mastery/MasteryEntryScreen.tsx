/**
 * MasteryEntryScreen (M-2, mocks T3/T4/T5) — exceptions-only entry (D-#778).
 *
 * Everyone starts at full marks. The teacher taps only the questions where a student lost
 * marks or needs re-work, adds tags (incl. the book's deduction reasons that feed a skill
 * strand, D-#787), sets a student absent / not submitted / void, and for a rubric sheet moves
 * a step below the default 4. "সব ঠিক আছে" confirms the sheet and writes the evidence; after
 * that, a change is a correction and that student's evidence is rewritten.
 */
import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  CONFIRM_MASTERY_PAPER,
  MASTERY_PAPER_QUERY,
  MASTERY_TAGS_QUERY,
  SAVE_MASTERY_RESULTS,
  type MasteryPaperRow,
  type MasteryRosterEntry,
  type MasteryTagRow,
} from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Loader, Notice, H2 } from "../../components/ui";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { STR, bnNum, hwSubjectLabel, masteryClassLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryEntry">;

type ItemX = { itemNo: number; marks: number | null; rework: boolean; tags: string[] };
type Draft = {
  status: string | null;
  items: ItemX[];
  workRework: boolean;
  workTags: string[];
  rubric: { loCode: string; step: number }[];
};

const STATUSES = [
  ["PRESENT", () => STR.msStatusPresent],
  ["ABSENT", () => STR.msStatusAbsent],
  ["NOT_SUBMITTED", () => STR.msStatusNotSubmitted],
  ["VOID", () => STR.msStatusVoid],
] as const;
const RUBRIC_STEPS = [1, 2, 3, 4];

const emptyDraft = (): Draft => ({ status: null, items: [], workRework: false, workTags: [], rubric: [] });
const fromResult = (r: MasteryRosterEntry["result"]): Draft =>
  r
    ? {
        status: r.status,
        items: r.items.map((i) => ({ itemNo: i.itemNo, marks: i.marks, rework: i.rework, tags: [...i.tags] })),
        workRework: r.workRework,
        workTags: [...r.workTags],
        rubric: r.rubric.map((x) => ({ ...x })),
      }
    : emptyDraft();

const halfSteps = (max: number) => Array.from({ length: Math.round(max * 2) + 1 }, (_, i) => i / 2);

export default function MasteryEntryScreen({ route }: Props): React.ReactElement {
  const { paperId } = route.params;
  const toast = useToast();
  const [{ data, fetching, error: qErr }, refetch] = useQuery({ query: MASTERY_PAPER_QUERY, variables: { paperId } });
  const [{ data: tagData }] = useQuery({ query: MASTERY_TAGS_QUERY });
  const [save, saveResults] = useMutation(SAVE_MASTERY_RESULTS);
  const [confirm, confirmPaper] = useMutation(CONFIRM_MASTERY_PAPER);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<{ studentId: string; itemNo: number } | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paper = data?.masteryPaper?.paper as MasteryPaperRow | undefined;
  const roster = (data?.masteryPaper?.roster ?? []) as MasteryRosterEntry[];

  useEffect(() => {
    const next: Record<string, Draft> = {};
    for (const r of roster) next[r.studentId] = fromResult(r.result);
    setDrafts(next);
    setDirty(new Set());
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const tags = useMemo(() => {
    if (!paper) return [] as MasteryTagRow[];
    return ((tagData?.masteryTags ?? []) as MasteryTagRow[]).filter(
      (t) => t.active && (t.allScopes || t.scopes.some((s) => s.classToken === paper.classToken && s.subject === paper.subject)),
    );
  }, [tagData, paper]);
  const itemTags = (qt: string) =>
    tags.filter((t) => (t.appliesTo === "ITEM" || t.appliesTo === "BOTH") && (t.effect !== "ROUTE_STRAND" || t.level !== "ITEM" || t.questionTypeCodes.includes(qt)));
  // Absent / not submitted / copied for the WHOLE work are the status chips above — the
  // matching NO_EVIDENCE / VOID_BEHAVIOUR tags would be a second way to say the same thing.
  const workTagList = tags.filter(
    (t) => (t.appliesTo === "WORK" || t.appliesTo === "BOTH") && t.effect !== "NO_EVIDENCE" && t.effect !== "VOID_BEHAVIOUR",
  );

  const edit = (studentId: string, f: (d: Draft) => Draft) => {
    setDrafts((ds) => ({ ...ds, [studentId]: f(ds[studentId] ?? emptyDraft()) }));
    setDirty((s) => new Set(s).add(studentId));
  };
  const editItem = (studentId: string, itemNo: number, f: (i: ItemX) => ItemX) =>
    edit(studentId, (d) => {
      const cur = d.items.find((i) => i.itemNo === itemNo) ?? { itemNo, marks: null, rework: false, tags: [] };
      return { ...d, items: [...d.items.filter((i) => i.itemNo !== itemNo), f(cur)] };
    });

  async function onSave(): Promise<boolean> {
    setError(null);
    const rows = [...dirty].map((studentId) => {
      const d = drafts[studentId] ?? emptyDraft();
      return {
        studentId,
        status: d.status,
        items: d.items.map((i) => ({ itemNo: i.itemNo, marks: i.marks, rework: i.rework, tags: i.tags })),
        workRework: d.workRework,
        workTags: d.workTags,
        rubric: d.rubric,
      };
    });
    if (rows.length === 0) return true;
    const res = await saveResults({ paperId, rows });
    if (res.error) {
      setError(friendlyError(res.error));
      return false;
    }
    toast.show(STR.msSaved);
    refetch({ requestPolicy: "network-only" });
    return true;
  }

  async function onConfirm(): Promise<void> {
    setAsking(false);
    if (!(await onSave())) return;
    const res = await confirmPaper({ paperId });
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    toast.show(STR.msConfirmedToast);
    refetch({ requestPolicy: "network-only" });
  }

  if (fetching && !paper) {
    return (
      <Screen>
        <Loader />
      </Screen>
    );
  }
  if (!paper) {
    return (
      <Screen>
        {qErr ? <Notice message={friendlyError(qErr)} tone="danger" /> : null}
      </Screen>
    );
  }
  const confirmed = paper.entryState === "CONFIRMED";
  const isRubric = paper.source === "RUBRIC";

  return (
    <Screen scroll>
      <H2>
        {masteryClassLabel(paper.classToken)} · {hwSubjectLabel(paper.subject)} · {paper.date}
      </H2>
      <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap" }}>
        <Badge text={paper.paperId} tone="muted" />
        <Badge text={confirmed ? STR.msConfirmed : STR.msOpen} tone={confirmed ? "ok" : "gold"} />
        {!isRubric ? <Badge text={`${bnNum(paper.items.length)} · ${bnNum(paper.totalMarks)}`} tone="brand" /> : null}
      </View>
      <Notice message={confirmed ? STR.msCorrectionNote : STR.msEntryHint} tone="info" />
      {error ? <Notice message={error} tone="danger" /> : null}

      {roster.map((s) => {
        const d = drafts[s.studentId] ?? emptyDraft();
        const status = d.status ?? s.defaultStatus;
        const off = status !== "PRESENT";
        // AS sheets (M-4): only the items this student was given.
        const items = s.itemNos ? paper.items.filter((it) => s.itemNos!.includes(it.itemNo)) : paper.items;
        const outOf = items.reduce((sum, it) => sum + it.marks, 0);
        const earned = items.reduce((sum, it) => {
          const x = d.items.find((i) => i.itemNo === it.itemNo);
          return sum + (x?.marks ?? it.marks);
        }, 0);
        return (
          <Card key={s.studentId}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
              <Body style={{ fontWeight: "700", flexShrink: 1 }}>
                {s.rollNumber ? `${bnNum(s.rollNumber)}. ` : ""}
                {s.name}
              </Body>
              {!isRubric ? <Badge text={off ? "—" : `${bnNum(earned)}/${bnNum(outOf)}`} tone={off ? "muted" : "brand"} /> : null}
            </View>
            <ChipRow>
              {STATUSES.map(([code, label]) => (
                <Chip key={code} label={label()} selected={status === code} onPress={() => edit(s.studentId, (x) => ({ ...x, status: code === s.defaultStatus ? null : code }))} />
              ))}
            </ChipRow>
            {d.status === null && s.defaultStatus !== "PRESENT" ? <Muted>{STR.msDefaultFromHw}</Muted> : null}

            {!off && isRubric
              ? paper.rubricLoCodes.map((lo) => {
                  const step = d.rubric.find((x) => x.loCode === lo)?.step ?? 4;
                  return (
                    <View key={lo} style={{ gap: space(1) }}>
                      <Muted>{lo}</Muted>
                      <ChipRow>
                        {RUBRIC_STEPS.map((n) => (
                          <Chip
                            key={n}
                            label={bnNum(n)}
                            selected={step === n}
                            onPress={() => edit(s.studentId, (x) => ({ ...x, rubric: [...x.rubric.filter((r) => r.loCode !== lo), { loCode: lo, step: n }] }))}
                          />
                        ))}
                      </ChipRow>
                    </View>
                  );
                })
              : null}

            {!off && !isRubric ? (
              <>
                <ChipRow>
                  {items.map((it, idx) => {
                    const x = d.items.find((i) => i.itemNo === it.itemNo);
                    const changed = Boolean(x && (x.marks !== null || x.rework || x.tags.length > 0));
                    const shown = x?.marks ?? it.marks;
                    // AS sheets: number as printed on this student's own page (1…n), not the paper's item no.
                    const printedNo = s.itemNos ? idx + 1 : it.itemNo;
                    return (
                      <Chip
                        key={it.itemNo}
                        label={`${bnNum(printedNo)}${changed ? ` · ${bnNum(shown)}${x?.rework ? " ↺" : ""}` : ""}`}
                        selected={open?.studentId === s.studentId && open.itemNo === it.itemNo}
                        onPress={() => setOpen(open?.studentId === s.studentId && open.itemNo === it.itemNo ? null : { studentId: s.studentId, itemNo: it.itemNo })}
                      />
                    );
                  })}
                </ChipRow>
                {open?.studentId === s.studentId
                  ? (() => {
                      const it = paper.items.find((i) => i.itemNo === open.itemNo)!;
                      const x = d.items.find((i) => i.itemNo === it.itemNo) ?? { itemNo: it.itemNo, marks: null, rework: false, tags: [] };
                      const shown = x.marks ?? it.marks;
                      return (
                        <View style={{ gap: space(1) }}>
                          <Muted>
                            {it.loCodes.join(", ")} · {it.questionTypeCode}
                            {it.textBn ? ` · ${it.textBn}` : ""}
                          </Muted>
                          <ChipRow>
                            {halfSteps(it.marks).map((m) => (
                              <Chip key={m} label={bnNum(m)} selected={shown === m} onPress={() => editItem(s.studentId, it.itemNo, (y) => ({ ...y, marks: m === it.marks ? null : m }))} />
                            ))}
                          </ChipRow>
                          <ChipRow>
                            <Chip label={STR.msRework} selected={x.rework} onPress={() => editItem(s.studentId, it.itemNo, (y) => ({ ...y, rework: !y.rework }))} />
                            {itemTags(it.questionTypeCode).map((t) => (
                              <Chip
                                key={t.code}
                                label={t.labelBn}
                                selected={x.tags.includes(t.code)}
                                onPress={() =>
                                  editItem(s.studentId, it.itemNo, (y) => ({
                                    ...y,
                                    tags: y.tags.includes(t.code) ? y.tags.filter((c) => c !== t.code) : [...y.tags, t.code],
                                  }))
                                }
                              />
                            ))}
                          </ChipRow>
                        </View>
                      );
                    })()
                  : null}
                <ChipRow>
                  <Chip label={STR.msWorkRework} selected={d.workRework} onPress={() => edit(s.studentId, (y) => ({ ...y, workRework: !y.workRework }))} />
                  {workTagList.map((t) => (
                    <Chip
                      key={t.code}
                      label={t.labelBn}
                      selected={d.workTags.includes(t.code)}
                      onPress={() => edit(s.studentId, (y) => ({ ...y, workTags: y.workTags.includes(t.code) ? y.workTags.filter((c) => c !== t.code) : [...y.workTags, t.code] }))}
                    />
                  ))}
                </ChipRow>
              </>
            ) : null}
          </Card>
        );
      })}

      <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
        <Button title={`${STR.msSave}${dirty.size ? ` (${bnNum(dirty.size)})` : ""}`} variant="secondary" onPress={() => void onSave()} loading={save.fetching} disabled={dirty.size === 0} />
        {!confirmed ? <Button title={STR.msConfirmAll} onPress={() => setAsking(true)} loading={confirm.fetching} /> : null}
      </View>

      <ConfirmSheet
        visible={asking}
        message={STR.msConfirmMsg}
        confirmLabel={STR.msConfirmAll}
        tone="primary"
        onCancel={() => setAsking(false)}
        onConfirm={() => void onConfirm()}
      />
    </Screen>
  );
}
