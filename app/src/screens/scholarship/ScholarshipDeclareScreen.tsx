/**
 * ScholarshipDeclareScreen (SC-1) — declare a paper's structure.
 *
 * The app does not author the questions; this records the skeleton the marks hang off.
 * The running Σ is shown against the full marks at all times and the declare button
 * stays disabled until they match, so the server's refusal (D-#656) is never the first
 * time the teacher hears about it.
 *
 * Subjects are multi-select because প্রাথমিক বিজ্ঞান + বাংলাদেশ ও বিশ্বপরিচয় is ONE
 * paper of 50+50 (D-#664); each item then names which half it belongs to.
 */
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { DECLARE_SCHOLARSHIP_PAPER, SCHOLARSHIP_TOPICS_QUERY } from "../../graphql/scholarship";
import {
  Screen,
  Card,
  Body,
  Muted,
  Badge,
  Button,
  Chip,
  ChipRow,
  Field,
  Select,
  Notice,
  Divider,
} from "../../components/ui";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme";
import type { ScholarshipStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ScholarshipStackParamList, "ScholarshipDeclare">;
type Nav = NativeStackNavigationProp<ScholarshipStackParamList>;

const SUBJECTS = ["ENG", "BAN", "MATH", "SCI", "BGS"] as const;
const ITEM_TYPES = [
  "mcq",
  "short_answer",
  "true_false",
  "fill_blank",
  "matching",
  "descriptive",
  "creative",
  "oral",
  "practical",
  "other",
] as const;

type LessonKind = "POEM" | "PROSE" | null;

interface DraftItem {
  itemNo: number;
  /** The number PRINTED on the paper. Separate from itemNo because a paper that lists
   *  every alternative has more items than printed questions (D-#675). */
  questionNo: string;
  /** a / b / c / d, for a question that offers alternatives. */
  part: string;
  label: string;
  subject: string;
  topicCode: string;
  chapters: string;
  itemType: string;
  marks: string;
}

/** Half marks are legal (the English paper's item 10 is 0.5 × 10); work in halves so a
 *  ten-item sum lands on exactly 5 rather than 4.999999999999999. */
function sumMarks(values: number[]): number {
  return values.reduce((a, b) => a + Math.round(b * 2), 0) / 2;
}

export default function ScholarshipDeclareScreen({ route }: Props): React.ReactElement {
  const { sectionId, classLevel } = route.params;
  const nav = useNavigation<Nav>();
  const toast = useToast();

  const [subjects, setSubjects] = useState<string[]>(["ENG"]);
  const [name, setName] = useState("");
  const [paperDate, setPaperDate] = useState("");
  const [totalMarks, setTotalMarks] = useState("100");
  const [sourceNote, setSourceNote] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  /** বাংলা only: a poem lesson and a prose lesson cannot carry the same items. */
  const [lessonKind, setLessonKind] = useState<LessonKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [{ data: topicData }] = useQuery({
    query: SCHOLARSHIP_TOPICS_QUERY,
    variables: { classLevel, subject: null },
  });
  const [, declare] = useMutation(DECLARE_SCHOLARSHIP_PAPER);

  const allTopics = (topicData?.scholarshipTopics ?? []) as {
    code: string;
    labelBn: string;
    subject: string;
    marks: number | null;
  }[];

  const total = Number(totalMarks) || 0;
  const sum = useMemo(() => sumMarks(items.map((i) => Number(i.marks) || 0)), [items]);
  // Shown, never enforced (D-#675). A paper listing every alternative sums higher than
  // the sitting on purpose, so this is a hint, not a gate.
  const balanced = sum === total && total > 0;

  function toggleSubject(s: string): void {
    setSubjects((prev) => {
      const next = prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s];
      return next.length === 0 ? prev : next;
    });
  }

  /**
   * Choosing কবিতা / গদ্য adds and removes the two rows the lesson type decides.
   *
   * বাংলা item ৯ is an either/or — ৯(ক) কবিতার মূলভাব or ৯(খ) গদ্যাংশের মূলভাব — and
   * item ১ (কবিতা মুখস্থ লিখন) exists only where there is a poem. So a prose lesson can
   * never carry rows ১ and ১০, and a poem lesson can never carry row ১১.
   *
   * Why this is worth a control rather than a note: an item declared but never sat is
   * harmless ONLY while its mark box is left empty — a typed 0 lands as `earned 0 /
   * available 10` and reports 0% on কবিতা মুখস্থ, the one topic that can never be
   * refilled from a prose chapter. Removing the row makes that mistake impossible
   * instead of merely unlikely.
   *
   * Switching is symmetric: it drops what the new kind cannot carry AND puts back what
   * it can, at the row's own place in the catalogue order, so toggling twice is not a
   * one-way door.
   */
  function dropsFor(kind: LessonKind): readonly string[] {
    if (kind === "POEM") return ["MAIN-IDEA-PROSE"];
    if (kind === "PROSE") return ["POEM-RECALL", "MAIN-IDEA-POEM"];
    return [];
  }

  function keepsFor(kind: LessonKind): readonly string[] {
    if (kind === "POEM") return ["POEM-RECALL", "MAIN-IDEA-POEM"];
    if (kind === "PROSE") return ["MAIN-IDEA-PROSE"];
    return [];
  }

  function chooseLessonKind(kind: LessonKind): void {
    const next = kind === lessonKind ? null : kind;
    setLessonKind(next);
    if (!next) return;

    const banTopics = allTopics.filter((t) => t.subject === "BAN");
    const rank = (code: string): number => banTopics.findIndex((t) => t.code === code);

    setItems((prev) => {
      let rows = prev.filter(
        (it) => !dropsFor(next).some((sfx) => it.topicCode.endsWith(sfx)),
      );
      for (const sfx of keepsFor(next)) {
        if (rows.some((it) => it.topicCode.endsWith(sfx))) continue;
        const t = banTopics.find((x) => x.code.endsWith(sfx));
        if (!t) continue;
        const row: DraftItem = {
          itemNo: 0,
          questionNo: "",
          part: "",
          label: t.labelBn,
          subject: "BAN",
          topicCode: t.code,
          chapters: "",
          itemType: "short_answer",
          marks: t.marks != null ? String(t.marks) : "",
        };
        const at = rows.findIndex(
          (it) => it.subject === "BAN" && rank(it.topicCode) > rank(t.code),
        );
        rows = at === -1 ? [...rows, row] : [...rows.slice(0, at), row, ...rows.slice(at)];
      }
      // Dropping rows shifts every itemNo after the gap, and the mark-entry grid falls
      // back to itemNo when questionNo is empty — so শব্দার্থ would print as "১" while
      // the paper calls it ২. Stamp the catalogue position so the printed number survives
      // the removal (the whole point of numbering the papers 1–22).
      return rows.map((it, i) => ({
        ...it,
        itemNo: i + 1,
        questionNo:
          it.subject === "BAN" && rank(it.topicCode) >= 0
            ? String(rank(it.topicCode) + 1)
            : it.questionNo,
      }));
    });
  }

  function addItem(): void {
    setItems((prev) => [
      ...prev,
      {
        itemNo: prev.length + 1,
        questionNo: "",
        part: "",
        label: "",
        subject: subjects[0],
        topicCode: "",
        chapters: "",
        itemType: "short_answer",
        marks: "",
      },
    ]);
  }

  /**
   * Add ONE item per topic in the catalogue, prefilled from it.
   *
   * The catalogue is already the paper's shape — for C5 English its 24 rows ARE the 14
   * printed questions with their alternatives, in order, carrying the blueprint's marks
   * (D-#672). Typing that by hand is 24 dropdowns and 24 numbers, which is how a test
   * paper stops being worth declaring at all. Rows are appended, never replacing what is
   * already there, and every field stays editable — delete the parts you did not print.
   *
   * A chosen `lessonKind` filters here too, so "add all" on a গদ্য lesson never puts the
   * two কবিতা rows in to begin with.
   */
  function addAllTopics(): void {
    const rows = allTopics.filter(
      (t) => t.subject === subjects[0] && !dropsFor(lessonKind).some((sfx) => t.code.endsWith(sfx)),
    );
    // With no lessonKind the list is the whole catalogue, so itemNo already equals the
    // printed number and questionNo can stay empty. Once a kind has pruned it, the two
    // diverge and the catalogue position has to be written down.
    const catalogue = allTopics.filter((t) => t.subject === subjects[0]);
    setItems((prev) => [
      ...prev,
      ...rows.map((t, i) => ({
        itemNo: prev.length + i + 1,
        questionNo:
          lessonKind === null ? "" : String(catalogue.findIndex((x) => x.code === t.code) + 1),
        part: "",
        label: t.labelBn,
        subject: subjects[0],
        topicCode: t.code,
        chapters: "",
        itemType: "short_answer",
        marks: t.marks != null ? String(t.marks) : "",
      })),
    ]);
  }

  function patch(idx: number, key: keyof DraftItem, value: string): void {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));
  }

  function remove(idx: number): void {
    // Renumber so the printed item numbers stay 1..N with no gap — the mark-entry grid
    // reads these numbers as its columns.
    setItems((prev) => prev.filter((_, i) => i !== idx).map((it, i) => ({ ...it, itemNo: i + 1 })));
  }

  async function onDeclare(): Promise<void> {
    setBusy(true);
    setError(null);
    const res = await declare({
      sectionId,
      subjects,
      name: name.trim(),
      paperDate: paperDate.trim() || null,
      totalMarks: total,
      sourceNote: sourceNote.trim() || null,
      items: items.map((i) => ({
        itemNo: i.itemNo,
        questionNo: Number(i.questionNo) > 0 ? Number(i.questionNo) : null,
        part: i.part.trim() || null,
        label: i.label.trim(),
        subject: i.subject,
        topicCode: i.topicCode,
        chapters: i.chapters
          .split(/[,\s]+/)
          .map((c) => Number(c.trim()))
          .filter((n) => Number.isInteger(n) && n > 0),
        itemType: i.itemType,
        marks: Number(i.marks) || 0,
      })),
    });
    setBusy(false);
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    toast.show(STR.scDeclared);
    nav.goBack();
  }

  return (
    <Screen scroll>
      <Muted>{STR.scSubjects}</Muted>
      <ChipRow>
        {SUBJECTS.map((s) => (
          <Chip
            key={s}
            label={hwSubjectLabel(s)}
            selected={subjects.includes(s)}
            onPress={() => toggleSubject(s)}
          />
        ))}
      </ChipRow>

      {/* বাংলা only — no other subject has an item that depends on the lesson being a
          poem. Hidden rather than disabled so an English paper never shows a control
          that cannot apply to it. */}
      {subjects.includes("BAN") ? (
        <>
          <Muted>{STR.scLessonKind}</Muted>
          <ChipRow>
            <Chip
              label={STR.scLessonPoem}
              selected={lessonKind === "POEM"}
              onPress={() => chooseLessonKind("POEM")}
            />
            <Chip
              label={STR.scLessonProse}
              selected={lessonKind === "PROSE"}
              onPress={() => chooseLessonKind("PROSE")}
            />
          </ChipRow>
          <Muted>{STR.scLessonKindNote}</Muted>
        </>
      ) : null}

      <Field label={STR.scPaperName} value={name} onChangeText={setName} />
      <Field label={`${STR.scPaperDate} (YYYY-MM-DD)`} value={paperDate} onChangeText={setPaperDate} />
      <Field label={STR.scTotalMarks} value={totalMarks} onChangeText={setTotalMarks} keyboardType="number-pad" />
      <Field label={STR.scSourceNote} value={sourceNote} onChangeText={setSourceNote} />

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(3) }}>
        <Body style={{ fontWeight: "700" }}>{STR.scItems}</Body>
        <Badge text={`${bnNum(sum)} / ${bnNum(total)}`} tone={balanced ? "ok" : "info"} />
      </View>
      <Muted>{STR.scSumNote}</Muted>

      {items.length === 0 ? <Muted>{STR.scNoItems}</Muted> : null}

      {items.map((it, idx) => {
        // Only this item's own subject's topics — a topic from another subject is
        // refused by the server and would corrupt that subject's roll-up (D-#659).
        const options = allTopics
          .filter((t) => t.subject === it.subject)
          .map((t) => ({ value: t.code, label: t.labelBn }));
        return (
          <Card key={idx}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(3) }}>
              <Body style={{ fontWeight: "700" }}>{bnNum(it.itemNo)}</Body>
              <Button title={STR.scRemove} variant="ghost" onPress={() => remove(idx)} />
            </View>
            <View style={{ flexDirection: "row", gap: space(3) }}>
              <View style={{ flex: 1 }}>
                <Field
                  label={STR.scItemQuestionNo}
                  value={it.questionNo}
                  onChangeText={(v) => patch(idx, "questionNo", v)}
                  keyboardType="number-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field label={STR.scItemPart} value={it.part} onChangeText={(v) => patch(idx, "part", v)} />
              </View>
            </View>
            <Field label={STR.scItemLabel} value={it.label} onChangeText={(v) => patch(idx, "label", v)} />
            {subjects.length > 1 ? (
              <ChipRow>
                {subjects.map((s) => (
                  <Chip
                    key={s}
                    label={hwSubjectLabel(s)}
                    selected={it.subject === s}
                    onPress={() => {
                      patch(idx, "subject", s);
                      patch(idx, "topicCode", "");
                    }}
                  />
                ))}
              </ChipRow>
            ) : null}
            <Select
              label={STR.scItemTopic}
              value={it.topicCode}
              options={options}
              onChange={(v) => patch(idx, "topicCode", v)}
            />
            <Select
              label={STR.scItemType}
              value={it.itemType}
              options={ITEM_TYPES.map((t) => ({ value: t, label: t }))}
              onChange={(v) => patch(idx, "itemType", v)}
            />
            <Field
              label={STR.scItemChapters}
              value={it.chapters}
              onChangeText={(v) => patch(idx, "chapters", v)}
              keyboardType="number-pad"
            />
            <Field
              label={STR.scItemMarks}
              value={it.marks}
              onChangeText={(v) => patch(idx, "marks", v)}
              keyboardType="decimal-pad"
            />
          </Card>
        );
      })}

      <Button title={STR.scAddItem} variant="secondary" onPress={addItem} />
      <Button title={STR.scAddAllParts} variant="ghost" onPress={addAllTopics} />
      <Divider />
      {error ? <Notice message={error} tone="danger" /> : null}
      {/* NOTHING is mandatory but having at least one item (D-#675): no name, no
          per-item label, no topic, and no balanced total. A paper with no items at all
          cannot be marked, so that one stays. */}
      <Button
        title={STR.scDeclareAction}
        onPress={() => void onDeclare()}
        loading={busy}
        disabled={busy || items.length === 0}
      />
    </Screen>
  );
}
