/**
 * NewImprovementActionScreen (SP-2, docs/prd-student-progress.md §4.1, D-#735) — Office /
 * Principal set an action for ONE student or a WHOLE section in one subject, with a teacher
 * part and/or a guardian part over one schedule of school days.
 *
 * The "why" line and the teacher are prefilled from the server (`improvementSuggest`): the
 * last results + weakness note, and the section's routine teacher for the subject. Both
 * stay editable. A live preview shows exactly what the teacher and the guardian will see.
 */
import React from "react";
import { ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { HW_SUBJECTS, IMPROVEMENT_MAX_DAYS } from "@scd/shared";
import { ACADEMIC_YEARS_QUERY, CLASSES_QUERY, STUDENTS_QUERY, TEACHERS_QUERY } from "../../graphql/operations";
import { CREATE_IMPROVEMENT_ACTION, IMPROVEMENT_SUGGEST } from "../../graphql/improvement";
import { Screen, Card, Body, Muted, Button, Chip, ChipRow, Field, Select, Notice } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR, bnNum, classSectionLabel, subjectShortLabel } from "../../lib/labels";
import { pickableSections, isWholeClassSectionName } from "../../lib/sectionPicks";
import { friendlyError } from "../../lib/errors";
import { dateKey } from "../../lib/dates";
import { useColors } from "../../theme";
import { radius, space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ClassTestStackParamList, "NewImprovementAction">;
type Scope = "STUDENT" | "CLASS";
type Repeat = "EVERY_SCHOOL_DAY" | "SUBJECT_DAYS";

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }): React.ReactElement {
  return <Chip label={`${value ? "☑" : "☐"} ${label}`} selected={value} onPress={() => onChange(!value)} />;
}

function Preview({ who, title, task }: { who: string; title: string; task: string }): React.ReactElement {
  const c = useColors();
  return (
    <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: space(3), gap: 4, backgroundColor: c.surface }}>
      <Text style={{ fontSize: 12, fontWeight: "700", color: c.textSecondary }}>{who}</Text>
      <Text style={{ fontWeight: "700", color: c.textPrimary }}>{title}</Text>
      <Text style={{ color: c.textPrimary }}>{task || "…"}</Text>
      <Text style={{ fontSize: 12, color: c.textSecondary }}>
        {STR.impDay} {bnNum(1)}
      </Text>
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <Text style={{ backgroundColor: c.primary, color: c.onPrimary, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, fontWeight: "600" }}>{STR.impDoneToday}</Text>
        <Text style={{ borderWidth: 1, borderColor: c.border, color: c.textPrimary, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>{STR.impCouldntToday}</Text>
      </View>
    </View>
  );
}

export default function NewImprovementActionScreen({ route, navigation }: Props): React.ReactElement {
  const params = route.params ?? {};
  const [scope, setScope] = React.useState<Scope>(params.scope ?? (params.studentId ? "STUDENT" : "CLASS"));
  const [sectionId, setSectionId] = React.useState<string | null>(params.sectionId ?? null);
  const [studentId, setStudentId] = React.useState<string | null>(params.studentId ?? null);
  const [subject, setSubject] = React.useState<string | null>(params.subject ?? null);
  const [reason, setReason] = React.useState("");
  const [teacherOn, setTeacherOn] = React.useState(true);
  const [teacherUserId, setTeacherUserId] = React.useState<string | null>(null);
  const [teacherTask, setTeacherTask] = React.useState("");
  const [guardianOn, setGuardianOn] = React.useState(true);
  const [guardianTask, setGuardianTask] = React.useState("");
  const [repeat, setRepeat] = React.useState<Repeat>("EVERY_SCHOOL_DAY");
  const [days, setDays] = React.useState("20");
  const [startKey, setStartKey] = React.useState(dateKey());
  const [alertCT, setAlertCT] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);

  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const yearId = yearsQ.data?.academicYears?.find((y) => y.current)?.id ?? yearsQ.data?.academicYears?.[0]?.id ?? null;
  const [classesQ] = useQuery({ query: CLASSES_QUERY, variables: { academicYearId: yearId ?? "" }, pause: !yearId });
  const sectionOptions = React.useMemo(() => {
    const out: Array<{ label: string; value: string }> = [];
    for (const cl of [...(classesQ.data?.classes ?? [])].filter((x) => x.active).sort((a, b) => a.level - b.level)) {
      for (const s of pickableSections(cl.sections)) {
        out.push({ value: s.id, label: classSectionLabel(cl.level, isWholeClassSectionName(s.nameBn) ? null : s.nameBn) });
      }
    }
    return out;
  }, [classesQ.data]);
  const sectionLabel = sectionOptions.find((s) => s.value === sectionId)?.label ?? "";

  const [studentsQ] = useQuery({ query: STUDENTS_QUERY, variables: { sectionId: sectionId ?? "" }, pause: !sectionId || scope !== "STUDENT" });
  const studentOptions = (studentsQ.data?.studentsInSection ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }));
  const studentName = studentOptions.find((s) => s.value === studentId)?.label ?? params.studentName ?? "";

  const [teachersQ] = useQuery({ query: TEACHERS_QUERY });
  const teacherOptions = (teachersQ.data?.teachers ?? []).map((t) => ({ value: t.id, label: t.name }));

  // Prefill the why + teacher whenever the target changes; never over the user's own text.
  const touchedReason = React.useRef(false);
  const [suggestQ] = useQuery({
    query: IMPROVEMENT_SUGGEST,
    variables: { sectionId: sectionId ?? "", subject: subject ?? "", studentId: scope === "STUDENT" ? studentId : null },
    pause: !sectionId || !subject || (scope === "STUDENT" && !studentId),
    requestPolicy: "network-only",
  });
  React.useEffect(() => {
    const s = suggestQ.data?.improvementSuggest;
    if (!s) return;
    if (!touchedReason.current) setReason(s.reason);
    if (s.teacherUserId) setTeacherUserId((cur) => cur ?? s.teacherUserId);
  }, [suggestQ.data]);

  const [m, create] = useMutation(CREATE_IMPROVEMENT_ACTION);
  const daysN = Number(days);
  const ready =
    !!sectionId &&
    !!subject &&
    (scope === "CLASS" || !!studentId) &&
    (teacherOn || guardianOn) &&
    (!teacherOn || (!!teacherTask.trim() && !!teacherUserId)) &&
    (!guardianOn || !!guardianTask.trim()) &&
    Number.isInteger(daysN) &&
    daysN >= 1 &&
    daysN <= IMPROVEMENT_MAX_DAYS &&
    /^\d{4}-\d{2}-\d{2}$/.test(startKey);

  async function save(): Promise<void> {
    if (!ready || !sectionId || !subject) return;
    setErr(null);
    const res = await create({
      input: {
        scope,
        sectionId,
        studentId: scope === "STUDENT" ? studentId : null,
        subject,
        reason: reason.trim() || null,
        teacherTask: teacherOn ? teacherTask.trim() : null,
        teacherUserId: teacherOn ? teacherUserId : null,
        guardianTask: guardianOn ? guardianTask.trim() : null,
        startKey,
        days: daysN,
        repeat,
        alertClassTeacher: guardianOn ? alertCT : false,
      },
    });
    if (res.error) {
      setErr(friendlyError(res.error));
      return;
    }
    const id = res.data?.createImprovementAction.id;
    if (id) navigation.replace("ImprovementAction", { id });
  }

  const target = scope === "STUDENT" ? `${studentName} · ${sectionLabel}` : sectionLabel;
  const previewTitle = `${target}${subject ? ` · ${subjectShortLabel(subject)}` : ""}`;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700" }}>1 · {STR.impWho}</Body>
          <ChipRow>
            <Chip label={STR.impScopeStudent} selected={scope === "STUDENT"} onPress={() => setScope("STUDENT")} />
            <Chip label={STR.impScopeClass} selected={scope === "CLASS"} onPress={() => setScope("CLASS")} />
          </ChipRow>
          <Select
            label={STR.impSection}
            value={sectionId}
            options={sectionOptions}
            onChange={(v) => {
              setSectionId(v);
              setStudentId(null);
              setTeacherUserId(null);
            }}
          />
          {scope === "STUDENT" ? (
            <Select label={STR.impStudent} value={studentId} options={studentOptions} onChange={setStudentId} searchable />
          ) : null}
          <Text style={{ marginTop: space(2) }}>{STR.impSubject}</Text>
          <ChipRow>
            {(HW_SUBJECTS as readonly string[]).map((s) => (
              <Chip
                key={s}
                label={subjectShortLabel(s)}
                selected={subject === s}
                onPress={() => {
                  setSubject(s);
                  setTeacherUserId(null);
                }}
              />
            ))}
          </ChipRow>
          <Field
            label={STR.impWhy}
            value={reason}
            onChangeText={(t) => {
              touchedReason.current = true;
              setReason(t);
            }}
            multiline
          />
        </Card>

        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: space(2) }}>
            <Body style={{ fontWeight: "700" }}>2 · {STR.impTeacherPart}</Body>
            <Toggle label={STR.impIncludeTeacher} value={teacherOn} onChange={setTeacherOn} />
          </View>
          {teacherOn ? (
            <View>
              <Select label={STR.impDoneBy} value={teacherUserId} options={teacherOptions} onChange={setTeacherUserId} searchable placeholder={STR.impPickTeacher} />
              <Field label={STR.impTeacherTask} value={teacherTask} onChangeText={setTeacherTask} multiline />
            </View>
          ) : null}
        </Card>

        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: space(2) }}>
            <Body style={{ fontWeight: "700" }}>3 · {STR.impGuardianPart}</Body>
            <Toggle label={STR.impIncludeGuardian} value={guardianOn} onChange={setGuardianOn} />
          </View>
          {guardianOn ? (
            <View>
              <Muted>{scope === "STUDENT" ? STR.impGuardianToStudent : STR.impGuardianToClass}</Muted>
              <Field label={STR.impGuardianTask} value={guardianTask} onChangeText={setGuardianTask} multiline />
              <Toggle label={STR.impAlertCT} value={alertCT} onChange={setAlertCT} />
            </View>
          ) : null}
        </Card>

        <Card>
          <Body style={{ fontWeight: "700" }}>4 · {STR.impSchedule}</Body>
          <ChipRow>
            <Chip label={STR.impRepeatEvery} selected={repeat === "EVERY_SCHOOL_DAY"} onPress={() => setRepeat("EVERY_SCHOOL_DAY")} />
            <Chip label={STR.impRepeatSubject} selected={repeat === "SUBJECT_DAYS"} onPress={() => setRepeat("SUBJECT_DAYS")} />
          </ChipRow>
          <Field label={STR.impDays} value={days} onChangeText={setDays} keyboardType="number-pad" />
          <DateField label={STR.impStart} value={startKey} onChange={setStartKey} min={dateKey()} />
          <Muted>{STR.impCheckHow}</Muted>
        </Card>

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.impPreview}</Body>
          <View style={{ gap: space(2), marginTop: space(2) }}>
            {teacherOn ? <Preview who={STR.impTeacherPart} title={previewTitle} task={teacherTask} /> : null}
            {guardianOn ? <Preview who={STR.impGuardianPart} title={STR.impGuardianCardTitle} task={guardianTask} /> : null}
          </View>
        </Card>

        {err ? <Notice message={err} tone="danger" /> : null}
        <Button title={STR.impSave} onPress={() => void save()} disabled={!ready} loading={m.fetching} />
      </ScrollView>
    </Screen>
  );
}
