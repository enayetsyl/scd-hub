/**
 * SyllabusEditorScreen (SY-4) — Office writes one subject.
 *
 * TWO TABS, not one long form: the prose and the mark table are written at
 * different moments, and the table needs the screen's full width for its four
 * numeric columns.
 *
 * Σ = 100 is a LIVE badge, and submit stays disabled until the rows balance. The
 * check runs the same arithmetic the server runs (`validateMarkRows`) — expressed
 * here as a running total rather than duplicated as a second rule, so the button
 * can never say green while the server says no.
 *
 * The approver is NAMED FROM THE ROUTINE before sending, never picked from a free
 * list (D-#366): an approver who does not teach the subject makes the sign-off
 * meaningless.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  EXAM_SYLLABUS_DETAIL,
  EXAM_SYLLABUS_APPROVER,
  SAVE_EXAM_SYLLABUS,
  SUBMIT_EXAM_SYLLABUS,
  type SyllabusMarkRowT,
} from "../../graphql/examSyllabus";
import { TEACHERS_QUERY } from "../../graphql/operations";
import { DateField } from "../../components/DateField";
import type { SyllabusStackParamList } from "../../navigation/types";
import {
  Screen,
  Body,
  Muted,
  Card,
  Field,
  Button,
  Badge,
  Select,
  Notice,
  ErrorBanner,
  ChipRow,
  Chip,
} from "../../components/ui";
import { STR, bnNum, syllabusItemTypeLabel, examComponentLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useColors } from "../../theme";
import { space, typeScale } from "../../theme/tokens";
import { SYLLABUS_ITEM_TYPES, EXAM_COMPONENTS, SYLLABUS_FULL_MARKS } from "@scd/shared";

type Props = NativeStackScreenProps<SyllabusStackParamList, "SyllabusEditor">;

type Draft = SyllabusMarkRowT;

const emptyRow = (seq: number): Draft => ({
  seq,
  label: "",
  itemType: null,
  component: null,
  count: null,
  marksEach: null,
  total: 0,
});

/**
 * Narrow anything row-shaped down to exactly the input fields.
 *
 * `SyllabusMarkRowInput` has no `__typename`, and GraphQL rejects the WHOLE
 * mutation when an input object carries a field the type does not define. urql's
 * cacheExchange stamps `__typename` onto every object it returns, so a saved row
 * that is loaded back and saved again fails with:
 *
 *   Field "__typename" is not defined by type "SyllabusMarkRowInput"
 *
 * The first save of a NEW subject always worked, because those rows come from
 * emptyRow() and never touched the cache — which is why this survived testing.
 * Listing the fields explicitly means no future cache metadata can ride along.
 */
function toDraft(r: Draft): Draft {
  return {
    seq: r.seq,
    label: r.label,
    itemType: r.itemType,
    component: r.component,
    count: r.count,
    marksEach: r.marksEach,
    total: r.total,
  };
}

/** Digits only; empty string means "not given", which is NOT the same as zero. */
function num(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export default function SyllabusEditorScreen({ route, navigation }: Props): React.ReactElement {
  const colors = useColors();
  const { examId, classId, subject } = route.params;

  const [detailQ, refetchDetail] = useQuery({
    query: EXAM_SYLLABUS_DETAIL,
    variables: { examId, classId, subject },
  });
  const stored = detailQ.data?.examSyllabusDetail ?? null;

  const [tab, setTab] = useState<"body" | "marks">("body");
  const [bodyMd, setBodyMd] = useState("");
  const [rows, setRows] = useState<Draft[]>([]);
  const [questionTypes, setQuestionTypes] = useState<string[]>([]);
  const [examDateKey, setExamDateKey] = useState("");
  const [approverUserId, setApproverUserId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Hydrate once from the server row. Keyed on the row id so switching subjects
  // through the stack reloads rather than keeping the previous subject's text.
  useEffect(() => {
    if (!stored) return;
    setBodyMd(stored.bodyMd);
    // Rebuild each row FIELD BY FIELD rather than spreading the query result.
    // urql's cacheExchange stamps __typename onto every object it returns, and a
    // spread carries it into local state and then back out as mutation input.
    setRows(stored.marks.length ? stored.marks.map(toDraft) : [emptyRow(1)]);
    setQuestionTypes(stored.questionTypes);
    setExamDateKey(stored.examDateKey ?? "");
  }, [stored?.id, stored?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const [approverQ] = useQuery({
    query: EXAM_SYLLABUS_APPROVER,
    variables: { classId, subject },
  });
  const holders = approverQ.data?.examSyllabusApprover.holders ?? [];
  const defaultApprover = approverQ.data?.examSyllabusApprover.defaultUserId ?? null;

  const [teachersQ] = useQuery({ query: TEACHERS_QUERY });
  const teacherName = (id: string): string =>
    (teachersQ.data?.teachers ?? []).find((t) => t.id === id)?.name ?? id;

  useEffect(() => {
    if (approverUserId === null && defaultApprover) setApproverUserId(defaultApprover);
  }, [defaultApprover, approverUserId]);

  const [, save] = useMutation(SAVE_EXAM_SYLLABUS);
  const [, submit] = useMutation(SUBMIT_EXAM_SYLLABUS);

  const sum = useMemo(() => rows.reduce((a, r) => a + (r.total || 0), 0), [rows]);
  const balanced = sum === SYLLABUS_FULL_MARKS;

  function patch(i: number, next: Partial<Draft>): void {
    setRows((prev) =>
      prev.map((r, idx) => {
        if (idx !== i) return r;
        const merged = { ...r, ...next };
        // A question row's total is ALWAYS count × marksEach — it is never typed,
        // so the two can never disagree. A component row's total is typed directly.
        if (!merged.component && merged.count != null && merged.marksEach != null) {
          merged.total = merged.count * merged.marksEach;
        }
        return merged;
      }),
    );
    setSaved(false);
  }

  /**
   * Returns the saved row's id, or null when the save was refused.
   *
   * The id is RETURNED rather than read back off `stored` because `stored` is the
   * last query result held in this render's closure: right after a save it is
   * still the PREVIOUS value (null, for a subject being written for the first
   * time), and the refetch has not landed. Submitting off it silently did nothing.
   */
  async function onSave(): Promise<string | null> {
    setErr(null);
    const res = await save({
      examId,
      classId,
      subject,
      bodyMd,
      marks: rows.map((r, i) => ({ ...toDraft(r), seq: i + 1 })),
      questionTypes,
      examDateKey: examDateKey || null,
    });
    if (res.error) {
      setErr(friendlyError(res.error));
      return null;
    }
    setSaved(true);
    refetchDetail({ requestPolicy: "network-only" });
    return res.data?.saveExamSyllabus.id ?? stored?.id ?? null;
  }

  /**
   * Save, then send for sign-off — ONE press, including the very first time this
   * subject is written.
   *
   * A subject with no row yet is a placeholder whose `id` is null, so gating this
   * on `stored?.id` made the button permanently dead on exactly the case it exists
   * for: a fresh syllabus, balanced at 100, with an approver named, and the primary
   * action greyed out saying nothing. Save is what CREATES the row, so it has to
   * run first and hand its id straight over.
   */
  async function onSubmit(): Promise<void> {
    setErr(null);
    const id = await onSave();
    if (!id) return; // the save was refused; onSave has already surfaced why
    const res = await submit({ id, approverUserId });
    if (res.error) {
      setErr(friendlyError(res.error));
      return;
    }
    navigation.goBack();
  }

  return (
    <Screen scroll>
      {err ? <ErrorBanner message={err} /> : null}
      {saved ? <Notice message={STR.sySaved} tone="ok" /> : null}
      {stored?.sendBackReason ? (
        // The reason IS the instruction for what to change, so it sits at the top
        // rather than behind a tap.
        <Notice message={`${STR.sySendBack}: ${stored.sendBackReason}`} tone="warn" />
      ) : null}

      <View style={{ flexDirection: "row", gap: space(2), marginBottom: space(3) }}>
        {(["body", "marks"] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            accessibilityLabel={t === "body" ? STR.sySyllabus : STR.syMarks}
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: space(2),
              borderRadius: 8,
              backgroundColor: tab === t ? colors.primary : colors.surface,
              borderWidth: 1,
              borderColor: tab === t ? colors.primary : colors.border,
            }}
          >
            <Body style={{ color: tab === t ? colors.onPrimary : colors.textSecondary }}>
              {t === "body" ? STR.sySyllabus : STR.syMarks}
            </Body>
          </Pressable>
        ))}
      </View>

      {tab === "body" ? (
        <Card>
          <Field
            label={STR.sySyllabus}
            value={bodyMd}
            onChangeText={(v) => {
              setBodyMd(v);
              setSaved(false);
            }}
            multiline
          />
          {/* The date THIS subject is sat. It was labelled "পরীক্ষা" and typed as
              free text against a format hint — a label that named the wrong thing
              and a field that could hold anything. It is a date, so it gets the
              same picker every other date on the app uses. */}
          <DateField
            label={STR.syExamDate}
            value={examDateKey}
            onChange={(v) => {
              setExamDateKey(v);
              setSaved(false);
            }}
          />
          <Body style={{ ...typeScale.bodyStrong, marginTop: space(3) }}>{STR.syQuestionTypes}</Body>
          <ChipRow>
            {SYLLABUS_ITEM_TYPES.map((qt) => (
              <Chip
                key={qt}
                label={syllabusItemTypeLabel(qt)}
                selected={questionTypes.includes(qt)}
                onPress={() => {
                  setQuestionTypes((prev) =>
                    prev.includes(qt) ? prev.filter((x) => x !== qt) : [...prev, qt],
                  );
                  setSaved(false);
                }}
              />
            ))}
          </ChipRow>
        </Card>
      ) : (
        <Card>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: space(2),
            }}
          >
            <Body style={typeScale.bodyStrong}>{STR.syMarks}</Body>
            {/* The live badge. Green ONLY at exactly 100 — a running total that
                merely looks close is what a submit-time error would let through. */}
            <Badge
              tone={balanced ? "ok" : "warn"}
              text={balanced ? STR.syFullMarks : `${STR.sySumIs} ${bnNum(sum)}`}
            />
          </View>

          {rows.map((r, i) => (
            <View
              key={i}
              style={{
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                paddingBottom: space(3),
                marginBottom: space(3),
                gap: space(1),
              }}
            >
              <Field
                label={`${bnNum(i + 1)}. ${STR.syRowLabel}`}
                value={r.label}
                onChangeText={(v) => patch(i, { label: v })}
              />

              <Select
                label={STR.syComponentRow}
                value={r.component}
                options={[
                  { label: "—", value: "" as string },
                  ...EXAM_COMPONENTS.map((c) => ({ label: examComponentLabel(c), value: c as string })),
                ]}
                onChange={(v) =>
                  // Choosing a component CLEARS count/marksEach: the number comes
                  // from the exam paper, and typing it twice is how the syllabus
                  // and the report card start to disagree (D-#531).
                  patch(i, v ? { component: v, count: null, marksEach: null } : { component: null })
                }
              />

              {r.component ? (
                <Field
                  label={STR.syRowTotal}
                  value={r.total ? String(r.total) : ""}
                  onChangeText={(v) => patch(i, { total: num(v) ?? 0 })}
                  keyboardType="number-pad"
                />
              ) : (
                <View style={{ flexDirection: "row", gap: space(2) }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={STR.syCount}
                      value={r.count == null ? "" : String(r.count)}
                      onChangeText={(v) => patch(i, { count: num(v) })}
                      keyboardType="number-pad"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={STR.syMarksEach}
                      value={r.marksEach == null ? "" : String(r.marksEach)}
                      onChangeText={(v) => patch(i, { marksEach: num(v) })}
                      keyboardType="number-pad"
                    />
                  </View>
                  <View style={{ flex: 1, justifyContent: "flex-end", paddingBottom: space(3) }}>
                    <Muted>
                      {STR.syRowTotal} {bnNum(r.total || 0)}
                    </Muted>
                  </View>
                </View>
              )}

              <Select
                label={STR.syQuestionTypes}
                value={r.itemType}
                options={[
                  { label: "—", value: "" as string },
                  ...SYLLABUS_ITEM_TYPES.map((t) => ({
                    label: syllabusItemTypeLabel(t),
                    value: t as string,
                  })),
                ]}
                onChange={(v) => patch(i, { itemType: v || null })}
              />

              <Button
                title={STR.syRemoveRow}
                variant="ghost"
                onPress={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
              />
            </View>
          ))}

          <Button
            title={STR.syAddRow}
            variant="secondary"
            onPress={() => setRows((prev) => [...prev, emptyRow(prev.length + 1)])}
          />
        </Card>
      )}

      <Card>
        <Body style={typeScale.bodyStrong}>{STR.syApproverLabel}</Body>
        {holders.length === 0 ? (
          <Muted>{STR.syNoApprover}</Muted>
        ) : (
          <Select
            label={STR.syApproverFromRoutine}
            value={approverUserId}
            options={holders.map((h) => ({
              label: teacherName(h.userId),
              value: h.userId,
              hint: `${bnNum(h.periods)} ${STR.syPeriods}`,
            }))}
            onChange={setApproverUserId}
          />
        )}
      </Card>

      <View style={{ gap: space(2), marginTop: space(3) }}>
        <Button title={STR.sySave} variant="secondary" onPress={onSave} />
        <Button
          title={STR.sySubmitToTeacher}
          onPress={onSubmit}
          // Gated on the two things the CALLER can act on: the rows must balance,
          // and the routine must name someone to send it to. NOT on `stored?.id` —
          // a subject being written for the first time has no row yet, and save is
          // what creates it, so that condition made the button dead on precisely
          // the case it exists for.
          disabled={!balanced || holders.length === 0}
        />
        {/* Always say WHY it is disabled. A greyed primary action with no reason
            is the state this screen shipped in. */}
        {!balanced ? <Muted>{STR.syMustBe100}</Muted> : null}
        {balanced && holders.length === 0 ? <Muted>{STR.syNoApprover}</Muted> : null}
      </View>
    </Screen>
  );
}
