/**
 * RequestClassTestScreen (CT-5 / J1, tracker:write) — file a class-test print request.
 * Pick year → class/section → subject; choose the paper source (an assembled CT-set id,
 * or upload own paper via POST /files/classtest → questionFileId); enter exam date /
 * total / pass mark / test# (auto-suggested, editable) / deadline. createClassTestRequest
 * rides tracker:write + the server section verify — the Bangla deny surfaces inline.
 */
import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  HW_SUBJECTS,
  PRINT_COLOURS,
  PRINT_COLOUR_LABELS_EN,
  PRINT_SIDES,
  PRINT_SIDES_LABELS_EN,
} from "@scd/shared";
import {
  CREATE_CLASS_TEST_REQUEST,
  REGISTER_CLASS_TEST_OFFICIAL,
  SUGGEST_CLASS_TEST_NUMBER_QUERY,
} from "../../graphql/classTest";
import {
  ASSESSMENT_SETS_QUERY,
  ACADEMIC_YEARS_QUERY,
  TEACHERS_QUERY,
  SUBJECT_GROUPS_QUERY,
} from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Field, Chip, Select } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { MoreOptions } from "../../components/MoreOptions";
import { ClassSectionSelect, type SectionPick } from "../../components/vocabPickers";
import { STR, hwSubjectLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { required } from "../../lib/validate";
import { useToast } from "../../state/ToastContext";
import {
  pickAndUploadClassTestPaper,
  uploadClassTestPaperWebFile,
  FileUploadError,
  type UploadedFile,
} from "../../lib/files";
import { UploadDropZone } from "../../components/UploadDropZone";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ClassTestStackParamList>;

export default function RequestClassTestScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  // The academic year is NOT a question we ask the teacher — the admin already marked one
  // current, and a class test can only ever be filed against it. Picking it by hand was a
  // way to file against the wrong year, not a feature (live-testing find).
  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const years = yearsQ.data?.academicYears ?? [];
  const yearId = (years.find((y) => y.current) ?? years[0])?.id ?? "";

  const [section, setSection] = useState<SectionPick | null>(null);
  // D-#507: the exam's UNIT. A section (the default and the common case), or a
  // cross-class Arabic group — those groups mix students from 2–4 classes, so a
  // group exam is anchored on the group and its roster is the membership.
  const [unit, setUnit] = useState<"SECTION" | "GROUP">("SECTION");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [source, setSource] = useState<"POOL_SET" | "UPLOADED_PAPER">("POOL_SET");
  // D-#339: register as ALREADY official — no print request, no print questions.
  const [skipPrint, setSkipPrint] = useState(false);
  const [setId, setSetId] = useState("");
  // A class test IS a print job, so the Office needs the same two answers here as on any
  // other request: how to print it. Mandatory, nothing pre-selected.
  const [colour, setColour] = useState<string | null>(null);
  const [sides, setSides] = useState<string | null>(null);
  // D-#303: copies — a typed number, or one per student present on the EXAM day
  // (the class and use day are the test's own; the server derives both).
  const [copiesMode, setCopiesMode] = useState<"FIXED" | "CLASS_PRESENT">("FIXED");
  const [copies, setCopies] = useState("1");
  // UX-3: the happy path picks an assembled set from a list; the typed-ID field is
  // an advanced escape hatch for a set the list doesn't surface.
  const [manualSetEntry, setManualSetEntry] = useState(false);
  const [paper, setPaper] = useState<{ fileId: string; name: string } | null>(null);
  const [examDate, setExamDate] = useState("");
  const [totalMarks, setTotalMarks] = useState("");
  const [passMark, setPassMark] = useState("");
  const [testNumber, setTestNumber] = useState("");
  const [deadlineDays, setDeadlineDays] = useState("");
  const [notes, setNotes] = useState("");
  // The ACCOUNTABLE subject teacher. "" = let the routine decide (the default and
  // the common case); an explicit pick is how Principal/Office register an exam on
  // a teacher's behalf so it lands in THAT teacher's account and report row.
  const [teacherId, setTeacherId] = useState("");
  // R-Validate (UX-1): per-field errors; the toast names the first offending field.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const [, createReq] = useMutation(CREATE_CLASS_TEST_REQUEST);
  const [, registerOfficial] = useMutation(REGISTER_CLASS_TEST_OFFICIAL);

  // Teacher options for the "on behalf of" override (see the picker in More options).
  const [teachersQ] = useQuery({ query: TEACHERS_QUERY });

  // The caller's assembled sets for the chosen section — the pool-set picker source
  // (UX-3, R-Search). Filtered client-side to CT sets; a set is picked by id, never pasted.
  const [setsQ] = useQuery({
    query: ASSESSMENT_SETS_QUERY,
    variables: { sectionId: section?.sectionId ?? "", classId: section?.classId ?? "", status: "assembled" },
    pause: !section || source !== "POOL_SET",
  });
  const ctSetOptions = (setsQ.data?.assessmentSets ?? [])
    .filter((s) => s.setType === "CT")
    .map((s) => ({
      label: s.name || s.id,
      value: s.id,
      hint: `${bnNum(s.basketItems.length)} ${STR.questionsWord} · ${bnNum(s.totalMarks ?? 0)} ${STR.marks}`,
    }));

  // The Arabic groups, for the group anchor (D-#507). Only Arabic groups can carry a
  // class test: Quran is out of the homework/class-test subject axis entirely (D-#36).
  const [groupsQ] = useQuery({
    query: SUBJECT_GROUPS_QUERY,
    variables: { track: "arabic", includeInactive: false },
    pause: unit !== "GROUP",
  });
  const groupOptions = (groupsQ.data?.subjectGroups ?? []).map((g) => ({
    label: g.nameBn || g.code,
    value: g.id,
    hint: g.code,
  }));

  // Auto-suggest the next test# once the unit + subject are chosen (editable). A
  // group's Test # line is its own, so the anchor decides which line is read.
  const anchorReady = unit === "GROUP" ? !!groupId : !!section;
  const [suggestQ] = useQuery({
    query: SUGGEST_CLASS_TEST_NUMBER_QUERY,
    variables:
      unit === "GROUP"
        ? { subjectGroupId: groupId, sectionId: null, subject: subject ?? "" }
        : { sectionId: section?.sectionId ?? "", subjectGroupId: null, subject: subject ?? "" },
    pause: !anchorReady || !subject,
  });
  useEffect(() => {
    if (suggestQ.data?.suggestClassTestNumber != null && testNumber === "") {
      setTestNumber(String(suggestQ.data.suggestClassTestNumber));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestQ.data]);

  // UX-6 default: pass mark tracks ⌈total × 0.33⌉ until the teacher edits it
  // themselves (then their value wins — the field stays fully editable).
  const [passMarkTouched, setPassMarkTouched] = useState(false);
  useEffect(() => {
    const total = Number(totalMarks);
    if (!passMarkTouched && totalMarks.trim() !== "" && Number.isFinite(total) && total >= 1) {
      setPassMark(String(Math.ceil(total * 0.33)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalMarks, passMarkTouched]);

  // BUG-013: the Drive round-trip takes seconds — without a busy state and a
  // success toast the upload read as "nothing happened".
  const [uploadBusy, setUploadBusy] = useState(false);
  // One post-upload path for both entry points (pick button + web drop zone):
  // same busy state, same success toast, same FileUploadError handling.
  async function runUpload(upload: () => Promise<UploadedFile | null>): Promise<void> {
    if (uploadBusy) return;
    setUploadBusy(true);
    try {
      const f = await upload();
      if (f) {
        setPaper({ fileId: f.fileId, name: f.originalName });
        toast.show(`${STR.ctPaperUploaded}: ${f.originalName}`, "ok");
      }
    } catch (e) {
      toast.show(e instanceof FileUploadError ? e.message : STR.errGeneric, "danger");
    } finally {
      setUploadBusy(false);
    }
  }
  const onUpload = (): Promise<void> => runUpload(pickAndUploadClassTestPaper);
  // Single-paper flow: a multi-file drop takes the first file, extras are ignored.
  const onDropPaper = (files: File[]): Promise<void> =>
    runUpload(() => uploadClassTestPaperWebFile(files[0]));

  async function onSubmit(): Promise<void> {
    setFieldErrors({});
    const total = Number(totalMarks);
    const { firstErrorKey, errors } = required({
      // Exactly one anchor is required — whichever one the unit chip selected (D-#507).
      ...(unit === "GROUP"
        ? { subjectGroupId: { value: groupId, message: `${STR.ctArabicGroup} — ${STR.fieldRequired}` } }
        : { section: { value: section, message: `${STR.section} — ${STR.fieldRequired}` } }),
      subject: { value: subject, message: `${STR.ctSubject} — ${STR.fieldRequired}` },
      examDate: { value: examDate.trim(), message: `${STR.ctExamDate} — ${STR.fieldRequired}` },
      totalMarks: {
        value: Number.isFinite(total) && total >= 1 ? total : null,
        message: `${STR.ctTotalMarks} — ${STR.fieldRequired}`,
      },
      // Print questions only exist when this IS a print request (D-#339).
      ...(!skipPrint
        ? {
            colour: { value: colour, message: `${STR.prColour} — ${STR.fieldRequired}` },
            sides: { value: sides, message: `${STR.prSides} — ${STR.fieldRequired}` },
            ...(copiesMode === "FIXED"
              ? {
                  copies: {
                    value: Number.isInteger(Number(copies)) && Number(copies) >= 1 ? copies : null,
                    message: `${STR.prCopies} — ${STR.fieldRequired}`,
                  },
                }
              : {}),
          }
        : {}),
      ...(source === "POOL_SET"
        ? { setId: { value: setId.trim(), message: `${STR.ctSetId} — ${STR.fieldRequired}` } }
        : { paper: { value: paper, message: `${STR.ctUploadPaper} — ${STR.fieldRequired}` } }),
    });
    if (firstErrorKey) {
      setFieldErrors(errors);
      toast.show(errors[firstErrorKey], "danger");
      return;
    }
    setBusy(true);
    const common = {
      // EXACTLY ONE anchor reaches the server (D-#507) — it refuses both or neither.
      sectionId: unit === "GROUP" ? null : section!.sectionId,
      subjectGroupId: unit === "GROUP" ? groupId : null,
      subject: subject!,
      examDate: examDate.trim(),
      totalMarks: total,
      passMark: passMark.trim() ? Number(passMark) : null,
      source,
      setId: source === "POOL_SET" ? setId.trim() : null,
      questionFileId: source === "UPLOADED_PAPER" ? (paper?.fileId ?? null) : null,
      testNumber: testNumber.trim() ? Number(testNumber) : null,
      deadlineDays: deadlineDays.trim() ? Number(deadlineDays) : null,
      notes: notes.trim() || null,
      // Empty → the server reads the routine's subject teacher for this
      // section × subject; a pick overrides it (registering on someone's behalf).
      teacherId: teacherId || null,
    };
    // D-#339: the no-print register skips the queue entirely — born official.
    const res = skipPrint
      ? await registerOfficial(common)
      : await createReq({
          ...common,
          colour,
          sides,
          copies: copiesMode === "FIXED" ? Number(copies) : null,
          copiesMode,
        });
    setBusy(false);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    if (res.data) {
      toast.show(skipPrint ? STR.ctRegisteredOfficial : STR.ctRequestFiled, "ok");
      nav.navigate("ClassTestHome");
    }
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.ctNewRequest}</Body>
          {/* D-#507: which UNIT sat the exam. Arabic is taught both ways at this
              school — 12 section-shaped periods and 25 group-shaped ones — and a
              group exam cannot be filed under any one section, because its students
              come from several classes. */}
          <View style={{ flexDirection: "row", gap: space(2), marginBottom: space(2) }}>
            <Chip label={STR.ctUnitSection} selected={unit === "SECTION"} onPress={() => setUnit("SECTION")} />
            <Chip label={STR.ctUnitGroup} selected={unit === "GROUP"} onPress={() => setUnit("GROUP")} />
          </View>
          {unit === "GROUP" ? (
            <>
              <Select
                label={STR.ctArabicGroup}
                value={groupId}
                options={groupOptions}
                onChange={(v) => {
                  setGroupId(v);
                  // A group exam is an ARABIC exam by definition — nothing else is
                  // taught to these groups, so the subject is settled, not asked.
                  setSubject("ARABIC");
                  // ...and its paper is uploaded: pool sets belong to a class.
                  setSource("UPLOADED_PAPER");
                }}
                placeholder={groupsQ.fetching ? STR.loading : STR.ctPickArabicGroup}
                error={fieldErrors.subjectGroupId}
              />
              <Muted style={{ marginBottom: space(2) }}>{STR.ctGroupExamHelp}</Muted>
            </>
          ) : yearId ? (
            <ClassSectionSelect academicYearId={yearId} value={section} onChange={setSection} />
          ) : (
            // No current year = nothing can be filed. SAY so — a blank form with no
            // explanation is how this codebase has hidden config gaps before.
            <Muted>{yearsQ.fetching ? STR.loading : STR.noCurrentYear}</Muted>
          )}
          {unit === "SECTION" ? (
            <Select
              label={STR.ctSubject}
              value={subject}
              options={(HW_SUBJECTS as readonly string[]).map((s) => ({ label: hwSubjectLabel(s), value: s }))}
              onChange={setSubject}
              placeholder={STR.ctPickSubject}
            />
          ) : null}

          <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
            {/* A CT pool set is assembled for a section's class, so a cross-class
                group has none to pick (D-#507) — offering the chip would open a
                permanently empty list. The group path uploads its paper. */}
            {unit === "SECTION" ? (
              <Chip label={STR.ctSourcePoolSet} selected={source === "POOL_SET"} onPress={() => setSource("POOL_SET")} />
            ) : null}
            <Chip label={STR.ctSourceUpload} selected={source === "UPLOADED_PAPER"} onPress={() => setSource("UPLOADED_PAPER")} />
          </View>

          {source === "POOL_SET" ? (
            <>
              <Select
                label={STR.ctSetId}
                value={setId === "" ? null : setId}
                options={ctSetOptions}
                onChange={setSetId}
                placeholder={STR.ctPickSet}
                emptyText={STR.pickSetFirst}
                error={fieldErrors.setId}
                searchable
              />
              {!manualSetEntry ? (
                <Button title={STR.ctManualSetId} variant="ghost" onPress={() => setManualSetEntry(true)} />
              ) : (
                <Field label={STR.ctSetId} value={setId} onChangeText={setSetId} helper={STR.ctSetIdHint} error={fieldErrors.setId} />
              )}
            </>
          ) : (
            <View style={{ marginTop: space(2) }}>
              <UploadDropZone onFiles={(files) => void onDropPaper(files)} disabled={uploadBusy}>
                <Button
                  title={uploadBusy ? STR.saving : STR.ctUploadPaper}
                  variant="secondary"
                  onPress={onUpload}
                  loading={uploadBusy}
                />
              </UploadDropZone>
              {/* Attaching the wrong paper was previously unrecoverable — the only way out
                  was to abandon the form. */}
              {paper ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginTop: space(2) }}>
                  <Muted style={{ flex: 1 }}>
                    {STR.ctPaperUploaded}: {paper.name}
                  </Muted>
                  <Button title={STR.prRemove} variant="danger" onPress={() => setPaper(null)} />
                </View>
              ) : null}
            </View>
          )}

          {/* D-#339: register as already held/official — the print sections fold away. */}
          <View style={{ marginTop: space(3) }}>
            <Chip label={STR.ctSkipPrintToggle} selected={skipPrint} onPress={() => setSkipPrint(!skipPrint)} />
            {skipPrint ? <Muted style={{ marginTop: space(1) }}>{STR.ctSkipPrintHint}</Muted> : null}
          </View>

          {skipPrint ? null : (
          <>
          {/* How to print it — the same two answers every other print job carries. */}
          <View style={{ marginTop: space(3) }}>
            <Body style={{ fontWeight: "700" }}>{STR.prColour} *</Body>
            <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
              {PRINT_COLOURS.map((c) => (
                <Chip key={c} label={PRINT_COLOUR_LABELS_EN[c]} selected={colour === c} onPress={() => setColour(c)} />
              ))}
            </View>
            {fieldErrors.colour ? <Muted style={{ marginTop: space(1) }}>{fieldErrors.colour}</Muted> : null}
          </View>

          <View style={{ marginTop: space(3) }}>
            <Body style={{ fontWeight: "700" }}>{STR.prSides} *</Body>
            <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
              {PRINT_SIDES.map((sd) => (
                <Chip key={sd} label={PRINT_SIDES_LABELS_EN[sd]} selected={sides === sd} onPress={() => setSides(sd)} />
              ))}
            </View>
            {fieldErrors.sides ? <Muted style={{ marginTop: space(1) }}>{fieldErrors.sides}</Muted> : null}
          </View>

          {/* D-#303: copies — the same choice the print form offers; CLASS_PRESENT
              resolves from the EXAM day's attendance of this test's own class. */}
          <View style={{ marginTop: space(3) }}>
            <Body style={{ fontWeight: "700" }}>{STR.prCopies} *</Body>
            <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
              <Chip label={STR.prCopiesFixed} selected={copiesMode === "FIXED"} onPress={() => setCopiesMode("FIXED")} />
              <Chip
                label={STR.prCopiesClass}
                selected={copiesMode === "CLASS_PRESENT"}
                onPress={() => setCopiesMode("CLASS_PRESENT")}
              />
            </View>
            {copiesMode === "FIXED" ? (
              <Field
                label={STR.prCopies}
                value={copies}
                onChangeText={setCopies}
                keyboardType="number-pad"
                error={fieldErrors.copies}
              />
            ) : (
              <Muted style={{ marginTop: space(1) }}>{STR.ctCopiesClassHint}</Muted>
            )}
          </View>
          </>
          )}

          <DateField label={STR.ctExamDate} value={examDate} onChange={setExamDate} error={fieldErrors.examDate} />
          <Field label={STR.ctTotalMarks} value={totalMarks} onChangeText={setTotalMarks} keyboardType="number-pad" error={fieldErrors.totalMarks} />

          {/* UX-6: rarely-changed inputs fold away — pass mark (auto ⌈total×0.33⌉),
              test number (auto-suggested), deadline (server default 2 open days), notes.
              The happy path never opens this. */}
          <MoreOptions>
            <Field
              label={STR.ctPassMark}
              value={passMark}
              onChangeText={(t) => {
                setPassMarkTouched(true);
                setPassMark(t);
              }}
              keyboardType="number-pad"
              helper={STR.ctPassMarkHint}
            />
            <Field label={STR.ctTestNumber} value={testNumber} onChangeText={setTestNumber} keyboardType="number-pad" />
            <Field label={STR.ctDeadlineDays} value={deadlineDays} onChangeText={setDeadlineDays} keyboardType="number-pad" />
            {/* Whose exam this is. Default (empty) = the routine's subject teacher;
                pick a name to register on that teacher's behalf, so the exam shows
                under THEIR name and lands in THEIR account. */}
            <Select
              label={STR.ctSubjectTeacher}
              value={teacherId}
              options={[
                { label: STR.ctSubjectTeacherAuto, value: "" },
                ...(teachersQ.data?.teachers ?? []).map((t) => ({ label: t.name, value: t.id })),
              ]}
              onChange={(v) => setTeacherId(v ?? "")}
            />
            <Field label={STR.ctNotes} value={notes} onChangeText={setNotes} />
          </MoreOptions>

          <View style={{ marginTop: space(2) }}>
            <Button title={skipPrint ? STR.ctSkipPrintToggle : STR.ctSubmitRequest} onPress={onSubmit} loading={busy} disabled={busy} />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
