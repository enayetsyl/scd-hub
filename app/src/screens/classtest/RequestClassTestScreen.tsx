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
import { HW_SUBJECTS } from "@scd/shared";
import {
  CREATE_CLASS_TEST_REQUEST,
  SUGGEST_CLASS_TEST_NUMBER_QUERY,
} from "../../graphql/classTest";
import { ASSESSMENT_SETS_QUERY } from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Field, Chip, Select } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { MoreOptions } from "../../components/MoreOptions";
import { ClassSectionSelect, type SectionPick } from "../../components/vocabPickers";
import { AcademicYearSelect } from "../../components/selects";
import { STR, hwSubjectLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { required } from "../../lib/validate";
import { useToast } from "../../state/ToastContext";
import { pickAndUploadClassTestPaper, FileUploadError } from "../../lib/files";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ClassTestStackParamList>;

export default function RequestClassTestScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const [yearId, setYearId] = useState("");
  const [section, setSection] = useState<SectionPick | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [source, setSource] = useState<"POOL_SET" | "UPLOADED_PAPER">("POOL_SET");
  const [setId, setSetId] = useState("");
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
  // R-Validate (UX-1): per-field errors; the toast names the first offending field.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const [, createReq] = useMutation(CREATE_CLASS_TEST_REQUEST);

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
      label: s.id,
      value: s.id,
      hint: `${bnNum(s.basketItems.length)} ${STR.questionsWord} · ${bnNum(s.totalMarks ?? 0)} ${STR.marks}`,
    }));

  // Auto-suggest the next test# once a section + subject are chosen (editable).
  const [suggestQ] = useQuery({
    query: SUGGEST_CLASS_TEST_NUMBER_QUERY,
    variables: { sectionId: section?.sectionId ?? "", subject: subject ?? "" },
    pause: !section || !subject,
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

  async function onUpload(): Promise<void> {
    try {
      const f = await pickAndUploadClassTestPaper();
      if (f) setPaper({ fileId: f.fileId, name: f.originalName });
    } catch (e) {
      toast.show(e instanceof FileUploadError ? e.message : STR.errGeneric, "danger");
    }
  }

  async function onSubmit(): Promise<void> {
    setFieldErrors({});
    const total = Number(totalMarks);
    const { firstErrorKey, errors } = required({
      section: { value: section, message: `${STR.section} — ${STR.fieldRequired}` },
      subject: { value: subject, message: `${STR.ctSubject} — ${STR.fieldRequired}` },
      examDate: { value: examDate.trim(), message: `${STR.ctExamDate} — ${STR.fieldRequired}` },
      totalMarks: {
        value: Number.isFinite(total) && total >= 1 ? total : null,
        message: `${STR.ctTotalMarks} — ${STR.fieldRequired}`,
      },
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
    const res = await createReq({
      sectionId: section!.sectionId,
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
    });
    setBusy(false);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    if (res.data) {
      toast.show(STR.ctRequestFiled, "ok");
      nav.navigate("ClassTestHome");
    }
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.ctNewRequest}</Body>
          <AcademicYearSelect value={yearId} onChange={setYearId} />
          {yearId ? <ClassSectionSelect academicYearId={yearId} value={section} onChange={setSection} /> : null}
          <Select
            label={STR.ctSubject}
            value={subject}
            options={(HW_SUBJECTS as readonly string[]).map((s) => ({ label: hwSubjectLabel(s), value: s }))}
            onChange={setSubject}
            placeholder={STR.ctPickSubject}
          />

          <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
            <Chip label={STR.ctSourcePoolSet} selected={source === "POOL_SET"} onPress={() => setSource("POOL_SET")} />
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
              <Button title={STR.ctUploadPaper} variant="secondary" onPress={onUpload} />
              {paper ? <Muted style={{ marginTop: space(1) }}>{STR.ctPaperUploaded}: {paper.name}</Muted> : null}
            </View>
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
            <Field label={STR.ctNotes} value={notes} onChangeText={setNotes} />
          </MoreOptions>

          <View style={{ marginTop: space(2) }}>
            <Button title={STR.ctSubmitRequest} onPress={onSubmit} loading={busy} disabled={busy} />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
