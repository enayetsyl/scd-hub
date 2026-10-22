/**
 * Generate a Nursery/KG paper in final-exam style (D-#744–#747).
 *
 * Teacher or Office (owner 2026-10-16: both press Generate): pick class, subject and
 * kind; say how far the class has been taught; tick the মানবন্টন rows and counts;
 * preview natively; re-roll a "new version"; send THAT version to the Office queue.
 * The server regenerates from the same seed, so the print matches the preview.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  WORKSHEET_KIND_LABELS_BN,
  WORKSHEET_KIND_LABELS_EN,
  WORKSHEET_KINDS,
  WORKSHEET_ITEM_KIND_LABELS_BN,
  WORKSHEET_ITEM_KIND_LABELS_EN,
} from "@scd/shared";
import { ACADEMIC_YEARS_QUERY, CLASSES_QUERY } from "../../graphql/operations";
import {
  MY_WORKSHEETS_PAGE,
  SEND_WORKSHEET_TO_PRINT,
  WORKSHEET_PLAN,
  WORKSHEET_PREVIEW,
  WORKSHEET_TEACHERS,
  type WorksheetPresetRowT,
} from "../../graphql/worksheet";
import { Screen, H2, Body, Muted, Card, Button, Chip, ChipRow, Field, Select, Notice, Badge, Loader } from "../../components/ui";
import SendToPrintCard from "../../components/SendToPrintCard";
import { Pager } from "../../components/Pager";
import { usePageState } from "../../lib/paging";
import WorksheetPaper, { type WorksheetDocT } from "../../components/WorksheetPaper";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum, wsRangeTooLongLabel, classLevelLabel, routineSubjectLabel, isoDateLabel, getActiveLang } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openPdf, openPdfPost, PDF_SUPPORTED } from "../../lib/pdf";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";

const SUBJECTS = ["BAN", "ENG", "MATH", "ARABIC"] as const;
/** রওযাতুল আতফাল ১ in book order — mirrors server engine/sequences.ts ARABIC_LETTERS. */
const ARABIC_LETTERS = [
  "ا", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر", "ز", "س", "ش", "ص", "ض",
  "ط", "ظ", "ع", "غ", "ف", "ق", "ك", "ل", "م", "ن", "و", "ه", "ء", "ي",
];
const BAN_CONSONANTS = [
  "ক", "খ", "গ", "ঘ", "ঙ", "চ", "ছ", "জ", "ঝ", "ঞ", "ট", "ঠ", "ড", "ঢ", "ণ", "ত", "থ", "দ", "ধ", "ন",
  "প", "ফ", "ব", "ভ", "ম", "য", "র", "ল", "শ", "ষ", "স", "হ", "ড়", "ঢ়", "য়", "ৎ", "ং", "ঃ", "ঁ",
];
/** D-#761: the "made" card keeps its short look — ten papers a page. */
const MADE_PAGE_SIZE = 10;

const ENG_LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
const NUMBER_STOPS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

interface RangeT {
  from: string;
  to: string;
}

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const BAN_VOWELS = ["অ", "আ", "ই", "ঈ", "উ", "ঊ", "ঋ", "এ", "ঐ", "ও", "ঔ"];

/** The full sequence an axis walks — mirrors server engine/sequences.ts (display form). */
function axisOptions(axis: string | null): string[] {
  switch (axis) {
    case "BAN_VOWEL":
      return BAN_VOWELS;
    case "BAN_CONSONANT":
      return BAN_CONSONANTS;
    case "BAN_ALL":
      return [...BAN_VOWELS, ...BAN_CONSONANTS];
    case "ENG_UPPER":
      return ENG_LETTERS;
    case "ENG_LOWER":
      return ENG_LETTERS.map((l) => l.toLowerCase());
    case "NUM_BN":
      return Array.from({ length: 100 }, (_, i) => String(i + 1).replace(/\d/g, (d) => BN_DIGITS[Number(d)]));
    case "NUM_EN":
      return Array.from({ length: 100 }, (_, i) => String(i + 1));
    case "ARABIC":
      return ARABIC_LETTERS;
    default:
      return [];
  }
}

/** The parts of a row a teacher can bound — must match the engine's part order. */
function rangeParts(
  r: { kind: string; axis: string | null; setSize: number | null },
  count: number,
): Array<{ label: string; options: string[]; max?: number }> {
  const opts = axisOptions(r.axis);
  if (!opts.length) return [];
  const shownLabel = r.axis === "NUM_BN" || r.axis === "NUM_EN" ? STR.wsRangeNumbersShown : STR.wsRangeShown;
  switch (r.kind) {
    case "WRITE_SEQUENCE":
      if (r.axis === "BAN_ALL") {
        return [
          { label: STR.wsRangeVowels, options: BAN_VOWELS },
          { label: STR.wsRangeConsonants, options: BAN_CONSONANTS },
        ];
      }
      if (r.axis === "ENG_UPPER" || r.axis === "ENG_LOWER") {
        // Two sub-questions, like Bangla: capital letters, then small letters.
        return [
          { label: STR.wsRangeCapital, options: ENG_LETTERS },
          { label: STR.wsRangeSmall, options: ENG_LETTERS.map((l) => l.toLowerCase()) },
        ];
      }
      return [{ label: shownLabel, options: opts }];
    case "FILL_MISSING":
      return [{ label: shownLabel, options: opts }];
    case "REARRANGE": {
      const numeric = r.axis === "NUM_BN" || r.axis === "NUM_EN";
      const size = r.setSize ?? (numeric ? 10 : 5);
      const lines = count < size ? count : Math.max(1, Math.ceil(count / size));
      return Array.from({ length: Math.min(lines, 20) }, (_, i) => ({ label: `${STR.wsRangeLine} ${bnNum(i + 1)}`, options: opts, max: size }));
    }
    case "BEFORE":
    case "AFTER":
    case "BEFORE_AFTER":
      return [1, 2].map((n) => ({ label: `${STR.wsRangeColumn} ${bnNum(n)}`, options: opts }));
    default:
      return [];
  }
}

/** Every letter a subject's checkbox grid offers (Bangla: স্বর + ব্যঞ্জন; English: A–Z). */
function allLettersFor(subject: string): string[] {
  if (subject === "BAN") return [...BAN_VOWELS, ...BAN_CONSONANTS];
  if (subject === "ENG") return [...ENG_LETTERS];
  if (subject === "ARABIC") return [...ARABIC_LETTERS];
  return [];
}

const newSeed = (): number => Math.floor(Math.random() * 1_000_000_000);
const kindLabel = (k: string): string =>
  (getActiveLang() === "en" ? WORKSHEET_KIND_LABELS_EN : WORKSHEET_KIND_LABELS_BN)[k as keyof typeof WORKSHEET_KIND_LABELS_BN] ?? k;

const itemKindLabel = (k: string): string =>
  (getActiveLang() === "en" ? WORKSHEET_ITEM_KIND_LABELS_EN : WORKSHEET_ITEM_KIND_LABELS_BN)[
    k as keyof typeof WORKSHEET_ITEM_KIND_LABELS_BN
  ] ?? k;

export default function WorksheetGenerateScreen(): React.ReactElement {
  const { can } = useAuth();
  const colors = useColors();
  const isOffice = can("worksheets:edit_all"); // PM: make one for a teacher (was roster:manage)

  // --- class + subject ------------------------------------------------------
  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const yearId = yearsQ.data?.academicYears?.find((y) => y.current)?.id ?? yearsQ.data?.academicYears?.[0]?.id ?? null;
  const [classesQ] = useQuery({ query: CLASSES_QUERY, variables: { academicYearId: yearId ?? "" }, pause: !yearId });
  const classes = useMemo(
    () => (classesQ.data?.classes ?? []).filter((c) => c.active !== false && c.level <= 0).sort((a, b) => a.level - b.level),
    [classesQ.data],
  );
  const [classId, setClassId] = useState<string | null>(null);
  useEffect(() => {
    if (!classId && classes.length) setClassId(classes[0].id);
  }, [classes, classId]);
  const cls = classes.find((c) => c.id === classId) ?? null;
  const [subject, setSubject] = useState<(typeof SUBJECTS)[number]>("BAN");
  const [kind, setKind] = useState<string>("ASSIGNMENT");

  // --- plan ---------------------------------------------------------------
  const [planQ] = useQuery({
    query: WORKSHEET_PLAN,
    variables: { classId: classId ?? "", subject },
    pause: !classId,
    requestPolicy: "cache-and-network",
  });
  const plan = planQ.data?.worksheetPlan ?? null;

  // Picks: seq → count (0 = off). Re-seeded from the preset whenever plan/kind changes.
  const [picks, setPicks] = useState<Record<number, number>>({});
  useEffect(() => {
    if (!plan) return;
    const base: WorksheetPresetRowT[] =
      kind === "ASSIGNMENT"
        ? plan.assignmentPreset
        : kind === "CLASS_TEST"
          ? plan.classTestPreset
          : plan.rows.map((r) => ({ seq: r.seq, count: r.count }));
    setPicks(Object.fromEntries(base.map((p) => [p.seq, p.count])));
  }, [plan, kind]);

  // Owner 2026-10-16: one checkbox per letter instead of "taught up to" — any combination.
  // Starts with every letter ticked; a full set is sent as null (= the whole alphabet).
  const [taught, setTaught] = useState<Set<string>>(() => new Set(allLettersFor("BAN")));
  const [numberUpTo, setNumberUpTo] = useState<number>(50);
  useEffect(() => setTaught(new Set(allLettersFor(subject))), [subject]);
  const toggleLetter = (l: string): void =>
    setTaught((cur) => {
      const next = new Set(cur);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });
  const setMany = (letters: string[], on: boolean): void =>
    setTaught((cur) => {
      const next = new Set(cur);
      letters.forEach((l) => (on ? next.add(l) : next.delete(l)));
      return next;
    });
  const lettersVar = useMemo(() => {
    const all = allLettersFor(subject);
    if (subject === "MATH" || taught.size === 0 || all.every((l) => taught.has(l))) return null;
    return all.filter((l) => taught.has(l));
  }, [subject, taught]);
  const isFinal = kind === "FINAL";

  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [meta, setMeta] = useState("");
  const [seed, setSeed] = useState<number>(newSeed);
  const [showAnswers, setShowAnswers] = useState(false);
  const [forTeacherId, setForTeacherId] = useState<string>("");

  // Owner 2026-10-16: per part (alphabet half / line / column), where it starts and ends.
  // "" = automatic for that part. Never saved into a preset — this paper only.
  const [ranges, setRanges] = useState<Record<number, RangeT[]>>({});
  const [rangeOpen, setRangeOpen] = useState<Record<number, boolean>>({});
  useEffect(() => setRanges({}), [classId, subject, kind]);
  const setRange = (seq: number, k: number, patch: Partial<RangeT>): void =>
    setRanges((cur) => {
      const list = [...(cur[seq] ?? [])];
      list[k] = { ...(list[k] ?? { from: "", to: "" }), ...patch };
      return { ...cur, [seq]: list };
    });

  const rowsVar = useMemo(
    () =>
      Object.entries(picks)
        .filter(([, c]) => c > 0)
        .map(([seq, count]) => {
          const list = ranges[Number(seq)] ?? [];
          const used = list.some((r) => r && r.from && r.to);
          return {
            seq: Number(seq),
            count,
            ...(used ? { ranges: list.map((r) => r ?? { from: "", to: "" }) } : {}),
          };
        })
        .sort((a, b) => a.seq - b.seq),
    [picks, ranges],
  );

  const vars = useMemo(
    () => ({
      classId: classId ?? "",
      subject,
      kind,
      seed,
      rows: rowsVar,
      letterUpTo: null,
      letters: isFinal ? null : lettersVar,
      numberUpTo: isFinal || subject !== "MATH" ? null : numberUpTo,
      title: title.trim() || null,
      subtitle: subtitle.trim() || null,
      meta: meta.trim() || null,
    }),
    [classId, subject, kind, seed, rowsVar, lettersVar, numberUpTo, isFinal, title, subtitle, meta],
  );

  const [previewQ] = useQuery({
    query: WORKSHEET_PREVIEW,
    variables: vars,
    pause: !plan || plan.rows.length === 0 || rowsVar.length === 0,
  });
  const preview = previewQ.data?.worksheetPreview ?? null;
  const doc = useMemo<WorksheetDocT | null>(() => (preview ? (JSON.parse(preview.docJson) as WorksheetDocT) : null), [preview]);
  const pictureMap = useMemo(
    () => Object.fromEntries((preview?.pictures ?? []).map((p) => [p.id, p.dataUri])),
    [preview],
  );

  const [teachersQ] = useQuery({
    query: WORKSHEET_TEACHERS,
    variables: { classId: classId ?? "", subject },
    pause: !isOffice || !classId,
  });
  // D-#761: paged — the list used to stop at the newest 10 with no way to an older paper.
  const [madePage, setMadePage] = usePageState();
  const [mineQ, refetchMine] = useQuery({
    query: MY_WORKSHEETS_PAGE,
    variables: { page: madePage, pageSize: MADE_PAGE_SIZE },
  });
  const made = mineQ.data?.myWorksheetsPage?.rows ?? [];
  const [, sendToPrint] = useMutation(SEND_WORKSHEET_TO_PRINT);
  const [pdfErr, setPdfErr] = useState<string | null>(null);

  const total = plan
    ? plan.rows.reduce((s, r) => s + (picks[r.seq] ?? 0) * r.marksEach, 0)
    : 0;

  const setCount = (seq: number, c: number): void => setPicks((p) => ({ ...p, [seq]: Math.max(0, Math.min(50, c)) }));


  const openWs = async (id: string, answers: boolean): Promise<void> => {
    setPdfErr(null);
    try {
      await openPdf(`/pdf/worksheet/${id}${answers ? "?answers=1" : ""}`);
    } catch {
      setPdfErr(STR.errGeneric);
    }
  };

  // Owner 2026-10-17: the paper on screen as a PDF, without sending it to print.
  const [previewPdfErr, setPreviewPdfErr] = useState<string | null>(null);
  const [previewPdfBusy, setPreviewPdfBusy] = useState(false);
  const openPreviewPdf = async (answers: boolean): Promise<void> => {
    setPreviewPdfErr(null);
    setPreviewPdfBusy(true);
    try {
      await openPdfPost(`/pdf/worksheet/preview${answers ? "?answers=1" : ""}`, vars);
    } catch {
      setPreviewPdfErr(STR.errGeneric);
    } finally {
      setPreviewPdfBusy(false);
    }
  };

  return (
    <Screen scroll>
      <H2>{STR.wsTitle}</H2>
      <Muted style={{ marginBottom: space(3) }}>
        {STR.wsOnlyPrePrimary}
      </Muted>

      <Card>
        {isOffice ? (
          <Select
            label={STR.wsForTeacher}
            value={forTeacherId}
            onChange={setForTeacherId}
            options={[
              { value: "", label: STR.wsForMyself },
              ...(teachersQ.data?.worksheetTeachers ?? []).map((t) => ({ value: t.userId, label: t.name || t.userId })),
            ]}
          />
        ) : null}
        <Select
          label={STR.wsClass}
          value={classId}
          onChange={setClassId}
          options={classes.map((c) => ({ value: c.id, label: c.nameBn || classLevelLabel(c.level) }))}
        />
        <Body style={{ marginTop: space(2) }}>{STR.wsSubject}</Body>
        <ChipRow>
          {SUBJECTS.map((s) => (
            <Chip key={s} label={routineSubjectLabel(s)} selected={subject === s} onPress={() => setSubject(s)} />
          ))}
        </ChipRow>
        <Body style={{ marginTop: space(2) }}>{STR.wsKind}</Body>
        <ChipRow>
          {WORKSHEET_KINDS.map((k) => (
            <Chip key={k} label={kindLabel(k)} selected={kind === k} onPress={() => setKind(k)} />
          ))}
        </ChipRow>

        {isFinal ? (
          <Notice tone="info" message={STR.wsFinalScope} />
        ) : subject === "MATH" ? (
          <Select
            label={STR.wsNumberUpTo}
            value={String(numberUpTo)}
            onChange={(v) => setNumberUpTo(Number(v))}
            options={NUMBER_STOPS.map((n) => ({ value: String(n), label: `১–${bnNum(n)}` }))}
            helper={STR.wsScopeHint}
          />
        ) : (
          <View style={{ gap: space(2), marginTop: space(2) }}>
            <Body>{STR.wsTaughtLetters}</Body>
            {(subject === "BAN"
              ? [
                  { label: STR.wsRangeVowels, letters: BAN_VOWELS },
                  { label: STR.wsRangeConsonants, letters: BAN_CONSONANTS },
                ]
              : subject === "ARABIC"
                ? [{ label: STR.wsArabicLetters, letters: ARABIC_LETTERS }]
                : [{ label: STR.wsRangeCapital, letters: ENG_LETTERS }]
            ).map((g) => (
              <View key={g.label} style={{ gap: space(1) }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
                  <Muted>{g.label}</Muted>
                  <Button title={STR.wsTickAll} variant="ghost" onPress={() => setMany(g.letters, true)} />
                  <Button title={STR.wsTickNone} variant="ghost" onPress={() => setMany(g.letters, false)} />
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {g.letters.map((l) => {
                    const on = taught.has(l);
                    return (
                      <Pressable
                        key={l}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={l}
                        onPress={() => toggleLetter(l)}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 8,
                          borderWidth: 2,
                          borderColor: colors.primary,
                          backgroundColor: on ? colors.primary : colors.surface,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Body style={{ color: on ? colors.onPrimary : colors.textPrimary, fontSize: 18 }}>{l}</Body>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
            <Muted>{taught.size === 0 ? STR.wsTickSomething : STR.wsScopeHint}</Muted>
          </View>
        )}
      </Card>

      <Card>
        <H2>{STR.wsRows}</H2>
        <Muted style={{ marginBottom: space(2) }}>
          {STR.wsRowsHint}
          {plan?.examName ? ` · ${plan.examName}` : ""}
        </Muted>
        {planQ.fetching && !plan ? <Loader /> : null}
        {planQ.error ? <Notice tone="danger" message={friendlyError(planQ.error)} /> : null}
        {plan && plan.rows.length === 0 ? <Notice tone="warn" message={STR.wsNoRows} /> : null}
        {plan?.rows.map((r) => {
          const c = picks[r.seq] ?? 0;
          const on = c > 0;
          return (
            <View
              key={r.seq}
              style={{ flexDirection: "row", alignItems: "center", gap: space(2), paddingVertical: space(2), borderTopWidth: 1, borderColor: "#ECF2EE", flexWrap: "wrap" }}
            >
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => setCount(r.seq, on ? 0 : r.count)}
                style={{ flexDirection: "row", alignItems: "center", gap: space(2), flexGrow: 1, flexShrink: 1, flexBasis: 200, minHeight: 44 }}
              >
                {/* Drawn, not a ☑ glyph — the Bangla font renders ☑ and ☐ alike. */}
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    borderWidth: 2,
                    borderColor: colors.primary,
                    backgroundColor: on ? colors.primary : "transparent",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {on ? <Body style={{ color: colors.onPrimary, fontSize: 14, lineHeight: 18 }}>✓</Body> : null}
                </View>
                <Body style={{ flexShrink: 1 }}>{r.label}</Body>
                <Badge text={itemKindLabel(r.kind)} tone="muted" />
              </Pressable>
              {on ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: space(1) }}>
                  <Button title="−" variant="secondary" onPress={() => setCount(r.seq, c - 1)} />
                  <Body style={{ minWidth: 28, textAlign: "center" }}>{bnNum(c)}</Body>
                  <Button title="+" variant="secondary" onPress={() => setCount(r.seq, c + 1)} />
                  <Muted>
                    × {bnNum(r.marksEach)} = {bnNum(c * r.marksEach)}
                  </Muted>
                </View>
              ) : null}
              {on && rangeParts(r, c).length ? (
                <View style={{ width: "100%", gap: space(1) }}>
                  <Button
                    title={rangeOpen[r.seq] ? STR.wsRangeHide : STR.wsRangeEdit}
                    variant="ghost"
                    onPress={() => setRangeOpen((o) => ({ ...o, [r.seq]: !o[r.seq] }))}
                  />
                  {rangeOpen[r.seq] ? (
                    <>
                      <Muted>{STR.wsRangeHint}</Muted>
                      {rangeParts(r, c).map((part, k) => {
                        const cur = ranges[r.seq]?.[k] ?? { from: "", to: "" };
                        // The engine takes `max` letters in a row from a longer range (owner chose a
                        // warning over changing that, 2026-10-17).
                        const a = part.options.indexOf(cur.from);
                        const b = part.options.indexOf(cur.to);
                        const span = a >= 0 && b >= 0 ? Math.abs(b - a) + 1 : 0;
                        const tooLong = part.max != null && span > part.max;
                        const opts = [
                          { value: "", label: STR.wsRangeAuto },
                          ...part.options.map((o) => ({ value: o, label: o })),
                        ];
                        return (
                          <View key={k} style={{ flexDirection: "row", gap: space(2), alignItems: "flex-end", flexWrap: "wrap" }}>
                            <Body style={{ minWidth: 110, paddingBottom: space(3) }}>{part.label}</Body>
                            <View style={{ flexGrow: 1, flexBasis: 140 }}>
                              <Select
                                label={STR.wsRangeFrom}
                                value={cur.from}
                                onChange={(v) => setRange(r.seq, k, { from: v })}
                                options={opts}
                                searchable
                              />
                            </View>
                            <View style={{ flexGrow: 1, flexBasis: 140 }}>
                              <Select
                                label={STR.wsRangeTo}
                                value={cur.to}
                                onChange={(v) => setRange(r.seq, k, { to: v })}
                                options={opts}
                                searchable
                              />
                            </View>
                            {tooLong ? (
                              <View style={{ width: "100%" }}>
                                <Notice tone="warn" message={wsRangeTooLongLabel(part.max as number, span)} />
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                    </>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
        {plan && plan.rows.length ? (
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(2) }}>
            <Body>{STR.wsTotal}</Body>
            <Body>{bnNum(total)}</Body>
          </View>
        ) : null}
        {isFinal && plan ? (
          <Muted>
            {total === plan.finalTotal ? STR.wsFinalMatches : STR.wsFinalDiffers} ({bnNum(plan.finalTotal)})
          </Muted>
        ) : null}
      </Card>

      <Card>
        <Body>{STR.wsHeader}</Body>
        <Field label={STR.wsHeaderTitle} value={title} onChangeText={setTitle} />
        <Field label={STR.wsHeaderSub} value={subtitle} onChangeText={setSubtitle} />
        <Field label={STR.wsHeaderMeta} value={meta} onChangeText={setMeta} />
      </Card>

      <Card>
        <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap", marginBottom: space(2) }}>
          <Button title={`↻ ${STR.wsNewVersion}`} variant="secondary" onPress={() => setSeed(newSeed())} />
          <Button
            title={showAnswers ? STR.wsHideAnswers : STR.wsShowAnswers}
            variant="ghost"
            onPress={() => setShowAnswers((v) => !v)}
          />
          {PDF_SUPPORTED ? (
            <>
              <Button
                title={STR.wsPdfPreview}
                variant="secondary"
                disabled={!preview || previewQ.fetching || previewPdfBusy}
                onPress={() => void openPreviewPdf(false)}
              />
              <Button
                title={STR.wsPdfPreviewKey}
                variant="ghost"
                disabled={!preview || previewQ.fetching || previewPdfBusy}
                onPress={() => void openPreviewPdf(true)}
              />
            </>
          ) : null}
        </View>
        {previewPdfErr ? <Notice tone="danger" message={previewPdfErr} /> : null}
        <Muted style={{ marginBottom: space(2) }}>{STR.wsPreviewHint}</Muted>
        {previewQ.error ? <Notice tone="danger" message={friendlyError(previewQ.error)} /> : null}
        {(preview?.warnings ?? []).map((w, i) => (
          <Notice key={i} tone="warn" message={w} />
        ))}
        {cls && plan && rowsVar.length > 0 ? (
          <SendToPrintCard
            classLevel={cls.level}
            successMessage={STR.wsSentToPrint}
            disabled={!preview || previewQ.fetching}
            onSend={async (opts) => {
              const res = await sendToPrint({
                ...vars,
                colour: opts.colour,
                sides: opts.sides,
                copies: opts.copies,
                copiesMode: opts.copiesMode,
                copiesClassId: opts.copiesMode === "CLASS_PRESENT" ? classId : null,
                // The worksheet's own class decides the paper; the card only adds the section.
                sectionId: opts.classId === classId ? opts.sectionId : null,
                neededByKey: opts.neededByKey,
                forTeacherId: forTeacherId || null,
              });
              if (res.error || !res.data?.sendWorksheetToPrint) return friendlyError(res.error);
              // The new paper is the newest — back to page 1 so it is the one on screen.
              setMadePage(1);
              refetchMine({ requestPolicy: "network-only" });
              return null;
            }}
          />
        ) : null}
      </Card>

      <View style={{ marginBottom: space(3) }}>
        <Body style={{ marginBottom: space(2) }}>
          {STR.wsPreview} · {STR.wsVersion} {bnNum(seed % 1000)}
        </Body>
        {previewQ.fetching && !doc ? <Loader /> : null}
        {doc && preview ? (
          <ScrollView horizontal={Platform.OS !== "web"} contentContainerStyle={{ flexGrow: 1 }}>
            <View style={{ flex: 1, minWidth: 320 }}>
              <WorksheetPaper doc={doc} header={preview.header} pictures={pictureMap} showAnswers={showAnswers} />
            </View>
          </ScrollView>
        ) : null}
        {!classId ? <Muted>{STR.wsPickClassSubject}</Muted> : null}
      </View>

      <Card>
        <H2>{STR.wsMade}</H2>
        {pdfErr ? <Notice tone="danger" message={pdfErr} /> : null}
        {!PDF_SUPPORTED ? <Muted>{STR.wsPdfWebOnly}</Muted> : null}
        {made.length === 0 ? <Muted>{STR.wsMadeEmpty}</Muted> : null}
        {made.map((w) => (
          <View key={w.id} style={{ paddingVertical: space(2), borderTopWidth: 1, borderColor: "#ECF2EE", gap: space(1) }}>
            <Body>{w.title}</Body>
            <Muted>
              {isoDateLabel(w.createdAt)} · {STR.wsTotal} {bnNum(w.totalMarks)}
            </Muted>
            {PDF_SUPPORTED ? (
              <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                <Button title={STR.wsOpenPaper} variant="secondary" onPress={() => void openWs(w.id, false)} />
                <Button title={STR.wsOpenKey} variant="ghost" onPress={() => void openWs(w.id, true)} />
              </View>
            ) : null}
          </View>
        ))}
        <Pager
          page={madePage}
          pageSize={MADE_PAGE_SIZE}
          total={mineQ.data?.myWorksheetsPage?.total ?? 0}
          onPage={setMadePage}
        />
      </Card>
    </Screen>
  );
}
