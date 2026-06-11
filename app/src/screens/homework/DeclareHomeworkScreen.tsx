/**
 * DeclareHomeworkScreen (§8.2) — a subject teacher declares one common sheet for
 * the class+subject+day: HW item with ≥1 TOP-tag, TIME_DECL, Q_COUNT, optional
 * Pool ref + revision flag. classLevel is derived from the selected class.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { HW_SUBJECTS } from "@scd/shared";
import { CLASSES_QUERY, DECLARE_HOMEWORK_ITEM } from "../../graphql/operations";
import type { HomeworkStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Field, Button, Chip, ChipRow, Notice, EmptyState } from "../../components/ui";
import { SectionBar } from "../../components/SectionBar";
import { STR, hwSubjectLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useSectionContext } from "../../state/SectionContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeworkStackParamList, "DeclareHomework">;

const today = (): string => new Date().toISOString().slice(0, 10);

export default function DeclareHomeworkScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const [subject, setSubject] = useState<string | null>(null);
  const [date, setDate] = useState(today());
  const [topTags, setTopTags] = useState("");
  const [timeDecl, setTimeDecl] = useState("20");
  const [qCount, setQCount] = useState("");
  const [poolRef, setPoolRef] = useState("");
  const [revItem, setRevItem] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, declare] = useMutation(DECLARE_HOMEWORK_ITEM);

  const [classesQ] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: selection.academicYearId ?? "" },
    pause: !selection.academicYearId,
  });
  const classLevel = classesQ.data?.classes.find((c) => c.id === selection.classId)?.level ?? null;

  async function onSubmit(): Promise<void> {
    setError(null);
    setOk(null);
    if (!subject) return setError(STR.hwSubject);
    if (classLevel == null) return setError("শ্রেণি স্তর পাওয়া যায়নি");
    const tags = topTags.split(",").map((t) => t.trim()).filter(Boolean);
    const q = parseInt(qCount, 10);
    if (!Number.isFinite(q)) return setError(STR.hwQCount);
    const td = timeDecl.trim() === "" ? undefined : parseInt(timeDecl, 10);

    setBusy(true);
    const res = await declare({
      academicYearId: selection.academicYearId!,
      classId: selection.classId!,
      classLevel,
      sectionId: selection.sectionId!,
      subject,
      dateGiven: date,
      topTags: tags,
      timeDecl: td,
      qCount: q,
      poolRef: poolRef.trim() || undefined,
      revItem,
    });
    setBusy(false);
    if (res.error || !res.data?.declareHomeworkItem) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(`${res.data.declareHomeworkItem.hwId} ${STR.hwDeclared}`);
    setTopTags("");
    setQCount("");
    setPoolRef("");
    setRevItem(false);
  }

  if (!hasSection) {
    return (
      <Screen>
        <SectionBar onChange={() => navigation.navigate("SectionPicker")} />
        <EmptyState message={STR.pickSection} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <SectionBar onChange={() => navigation.navigate("SectionPicker")} />
      </View>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: 6 }}>{STR.hwSubject}</Body>
          <ChipRow>
            {HW_SUBJECTS.map((s) => (
              <Chip key={s} label={hwSubjectLabel(s)} selected={subject === s} onPress={() => setSubject(s)} />
            ))}
          </ChipRow>
          {classLevel != null ? <Muted style={{ marginTop: 4 }}>C{bnNum(classLevel)}</Muted> : null}
        </Card>
        <Field label={STR.hwDate} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
        <Field label={STR.hwTopTags} value={topTags} onChangeText={setTopTags} placeholder={`TOP-${subject ?? "MATH"}-C${classLevel ?? 1}-01`} />
        <Field label={STR.hwTimeDecl} value={timeDecl} onChangeText={setTimeDecl} keyboardType="number-pad" />
        <Field label={STR.hwQCount} value={qCount} onChangeText={setQCount} keyboardType="number-pad" />
        <Field label={STR.hwPoolRef} value={poolRef} onChangeText={setPoolRef} placeholder={`QP-${subject ?? "MATH"}-C${classLevel ?? 1}-U01`} />
        <ChipRow>
          <Chip label={STR.hwRevItem} selected={revItem} onPress={() => setRevItem((v) => !v)} />
        </ChipRow>
        <View style={{ marginTop: space(3) }}>
          <Button title={STR.hwDeclare} onPress={onSubmit} loading={busy} disabled={busy} />
        </View>
      </ScrollView>
    </Screen>
  );
}
