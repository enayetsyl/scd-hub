/**
 * BuildVocabTestScreen (VC-5 / J3) — create a test, then auto-lay its positions from
 * words selected per direction. Build rides tracker:write + the server operator gate
 * (the assigned/covering tester); the Bangla deny surfaces inline if the caller can't.
 *
 * Step 1: program + section (→ classLevel) + label + totalMarks + dictation half-miss
 *         + optional date → createVocabTest (draft).
 * Step 2: for each of the program's directions, pick words from the (program × class)
 *         bank → setVocabTestPositions (wholesale) → the test flips to ready.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { VOCAB_PROGRAM_DIRECTIONS, type VocabProgram } from "@scd/shared";
import {
  CREATE_VOCAB_TEST,
  SET_VOCAB_TEST_POSITIONS,
  VOCAB_WORDS_QUERY,
  type VocabTestT,
  type VocabPositionSelectionIn,
} from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Field, Chip, ChipRow, Loader, Notice } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { ProgramSelect, ClassSectionSelect, type SectionPick } from "../../components/vocabPickers";
import { AcademicYearSelect } from "../../components/selects";
import { STR, vocabProgramLabel, vocabDirectionLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { required } from "../../lib/validate";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme/tokens";
import type { VocabStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<VocabStackParamList>;

export default function BuildVocabTestScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  // Step 1 state
  const [yearId, setYearId] = useState("");
  const [program, setProgram] = useState<string | null>(null);
  const [section, setSection] = useState<SectionPick | null>(null);
  const [label, setLabel] = useState("");
  const [totalMarks, setTotalMarks] = useState("");
  const [halfMiss, setHalfMiss] = useState(false);
  const [testDate, setTestDate] = useState("");

  const [created, setCreated] = useState<VocabTestT | null>(null);
  // R-Validate (UX-1): per-field errors; the toast names the first offending field.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const [, createTest] = useMutation(CREATE_VOCAB_TEST);
  const [, setPositions] = useMutation(SET_VOCAB_TEST_POSITIONS);

  // Step 2: the word bank for the created test's (program × classLevel).
  const [wordsQ] = useQuery({
    query: VOCAB_WORDS_QUERY,
    variables: { program: created?.program ?? "", classLevel: created?.classLevel ?? 0, includeInactive: false },
    pause: !created,
  });
  const bank = wordsQ.data?.vocabWords ?? [];

  // Selected wordIds per direction.
  const [selByDir, setSelByDir] = useState<Record<string, string[]>>({});
  // UX-3: per-direction chip filter — narrows the RENDERED chips only; selections
  // made before filtering survive (they live in selByDir, not in the render set).
  const [filterByDir, setFilterByDir] = useState<Record<string, string>>({});
  const toggle = (dir: string, wordId: string): void =>
    setSelByDir((prev) => {
      const cur = prev[dir] ?? [];
      return { ...prev, [dir]: cur.includes(wordId) ? cur.filter((w) => w !== wordId) : [...cur, wordId] };
    });

  async function onCreate(): Promise<void> {
    setFieldErrors({});
    const marks = Number(totalMarks);
    const { firstErrorKey, errors } = required({
      program: { value: program, message: `${STR.vbProgram} — ${STR.fieldRequired}` },
      section: { value: section, message: `${STR.section} — ${STR.fieldRequired}` },
      label: { value: label.trim(), message: `${STR.vbLabel} — ${STR.fieldRequired}` },
      totalMarks: {
        value: Number.isFinite(marks) && marks >= 0 && totalMarks.trim() !== "" ? marks : null,
        message: `${STR.vbTotalMarks} — ${STR.fieldRequired}`,
      },
    });
    if (firstErrorKey) {
      setFieldErrors(errors);
      toast.show(errors[firstErrorKey], "danger");
      return;
    }
    setBusy(true);
    const res = await createTest({
      program: program!,
      sectionId: section!.sectionId,
      classLevel: section!.classLevel,
      label: label.trim(),
      totalMarks: marks,
      dictationHalfMissCounts: halfMiss,
      testDate: testDate.trim() || null,
    });
    setBusy(false);
    if (res.error) return toast.show(friendlyError(res.error), "danger");
    if (res.data) {
      setCreated(res.data.createVocabTest);
      toast.show(STR.vbTestCreated, "ok");
    }
  }

  async function onLayPositions(): Promise<void> {
    if (!created) return;
    const selections: VocabPositionSelectionIn[] = Object.entries(selByDir)
      .filter(([, ids]) => ids.length > 0)
      .map(([direction, wordIds]) => ({ direction, wordIds }));
    if (selections.length === 0) {
      toast.show(`${STR.vbSelectWordsForDir} — ${STR.fieldRequired}`, "danger");
      return;
    }
    setBusy(true);
    const res = await setPositions({ testId: created.id, selections });
    setBusy(false);
    if (res.error) return toast.show(friendlyError(res.error), "danger");
    toast.show(STR.vbPositionsSet, "ok");
  }

  const directions = created ? VOCAB_PROGRAM_DIRECTIONS[created.program as VocabProgram] : [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        {!created ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.vbNewTest}</Body>
            <AcademicYearSelect value={yearId} onChange={setYearId} />
            <ProgramSelect value={program} onChange={setProgram} />
            {yearId ? <ClassSectionSelect academicYearId={yearId} value={section} onChange={setSection} /> : null}
            <Field label={STR.vbLabel} value={label} onChangeText={setLabel} error={fieldErrors.label} />
            <Field label={STR.vbTotalMarks} value={totalMarks} onChangeText={setTotalMarks} keyboardType="number-pad" error={fieldErrors.totalMarks} />
            <View style={{ marginTop: space(1) }}>
              <Chip label={STR.vbHalfMiss} selected={halfMiss} onPress={() => setHalfMiss((h) => !h)} />
            </View>
            <DateField label={STR.vbTestDate} value={testDate} onChange={setTestDate} helper={STR.vbTestDateHint} />
            <View style={{ marginTop: space(2) }}>
              <Button title={STR.vbCreateTest} onPress={onCreate} loading={busy} disabled={busy} />
            </View>
          </Card>
        ) : (
          <>
            <Card>
              <Body style={{ fontWeight: "700" }}>
                {vocabProgramLabel(created.program)} · {created.label}
              </Body>
              <Muted>
                {STR.vbTotalMarks}: {bnNum(created.totalMarks)} · {STR.vbLayPositions}
              </Muted>
            </Card>

            {wordsQ.fetching ? (
              <Loader label={STR.loading} />
            ) : bank.length === 0 ? (
              <Card>
                <Muted>{STR.vbNoBankWords}</Muted>
                <View style={{ marginTop: space(2) }}>
                  <Button title={STR.vbWordBank} variant="secondary" onPress={() => nav.navigate("VocabWordBank")} />
                </View>
              </Card>
            ) : (
              directions.map((dir) => {
                const sel = selByDir[dir] ?? [];
                const filter = (filterByDir[dir] ?? "").trim().toLowerCase();
                const shown = filter === "" ? bank : bank.filter((w) => w.headword.toLowerCase().includes(filter));
                return (
                  <Card key={dir}>
                    <Body style={{ fontWeight: "700" }}>{vocabDirectionLabel(dir)}</Body>
                    <Muted style={{ marginBottom: space(1) }}>
                      {STR.vbSelectWordsForDir} · {STR.vbWordsSelected}: {bnNum(sel.length)} · {STR.vbWordsShown}:{" "}
                      {bnNum(shown.length)}
                    </Muted>
                    <Field
                      value={filterByDir[dir] ?? ""}
                      onChangeText={(t) => setFilterByDir((m) => ({ ...m, [dir]: t }))}
                      placeholder={STR.vbFilterWords}
                    />
                    <ChipRow>
                      {shown.map((w) => (
                        <Chip
                          key={w.id}
                          label={w.headword}
                          selected={sel.includes(w.id)}
                          onPress={() => toggle(dir, w.id)}
                        />
                      ))}
                    </ChipRow>
                  </Card>
                );
              })
            )}

            {bank.length > 0 ? (
              <Card>
                <Button title={STR.vbLayPositions} onPress={onLayPositions} loading={busy} disabled={busy} />
                <View style={{ marginTop: space(2) }}>
                  <Button
                    title={STR.vbMark}
                    variant="secondary"
                    onPress={() =>
                      nav.navigate("VocabMarkGrid", {
                        testId: created.id,
                        title: `${vocabProgramLabel(created.program)} · ${created.label}`,
                      })
                    }
                  />
                </View>
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
