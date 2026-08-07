/**
 * AssignmentScheduleScreen (AS-T1, D-#86) — the admin rotation editor
 * (Principal/Office, roster:manage). Term anchor + cadence weekdays + the
 * 4-week rotation entries. The sheet's Schedule tab values are entered HERE —
 * the xlsx itself is never imported (PRD AS-T1 seed note).
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { HW_SUBJECTS, DAYS_OF_WEEK, ROSTER_CLASS_LEVEL_MIN, ROSTER_CLASS_LEVEL_MAX } from "@scd/shared";
import {
  ACADEMIC_YEARS_QUERY,
  CLASSES_QUERY,
  TEACHERS_QUERY,
  AS_SCHEDULE_QUERY,
  UPSERT_AS_SCHEDULE,
  ADD_AS_SCHEDULE_ENTRY,
  REMOVE_AS_SCHEDULE_ENTRY,
  UPDATE_AS_SCHEDULE_ENTRY_TEACHER,
} from "../../graphql/operations";
import type { AssignmentStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Button, Field, Chip, ChipRow, Select, Loader, Notice } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { useReportFilterState } from "../../components/ReportFilters";
import { STR, bnNum, hwSubjectLabel, dayOfWeekLabel, classLevelLabel, getActiveLang } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AssignmentStackParamList, "AssignmentSchedule">;

/** Anchors may sit on school weekdays only (Sun–Thu, D-#86). */
const ANCHOR_DAYS = [0, 1, 2, 3, 4] as const;

/** D-#331: a cycle week = the Nth DELIVERY WEEK of each month (by the delivery
 *  Thursday); a month's 5th week wraps back to cycle 1 (D-#275). Shown so admins
 *  see cycle 1 also covers a 5th week and each month restarts at week 1. */
const cycleWeekMeaning = (w: number): string => {
  const base =
    getActiveLang() === "en"
      ? `Week ${w} of each month`
      : `প্রতি মাসের ${bnNum(w)} নম্বর সপ্তাহ`;
  const fifth = getActiveLang() === "en" ? " (and a 5th week)" : " (এবং ৫ম সপ্তাহ)";
  return w === 1 ? base + fifth : base;
};

export default function AssignmentScheduleScreen(_props: Props): React.ReactElement {
  const { confirmAction } = useConfirm();
  const toast = useToast();
  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const years = yearsQ.data?.academicYears ?? [];
  // The year was picked SILENTLY (current, else the first) — so an admin editing the
  // schedule could not see, let alone change, which year they were editing. Now it is an
  // explicit choice, defaulting to the current year (live-testing find).
  const [pickedYearId, setPickedYearId] = useState<string | null>(null);
  const defaultYear = years.find((y) => y.current) ?? years[0];
  const yearId = pickedYearId ?? defaultYear?.id ?? "";

  const [scheduleQ, refetchSchedule] = useQuery({
    query: AS_SCHEDULE_QUERY,
    variables: { academicYearId: yearId },
    pause: !yearId,
  });
  const schedule = scheduleQ.data?.assignmentSchedule ?? null;

  const [classesQ] = useQuery({ query: CLASSES_QUERY, variables: { academicYearId: yearId }, pause: !yearId });
  const classes = (classesQ.data?.classes ?? []).filter(
    (c) => c.active && c.level >= ROSTER_CLASS_LEVEL_MIN && c.level <= ROSTER_CLASS_LEVEL_MAX,
  );
  // `users` is gated user:manage — PRINCIPAL only. Office holds roster:manage and owns
  // this screen, so that query was denied for them and EVERY teacher name in the rotation
  // (and in the teacher filter) fell back to a raw ObjectId (owner report 2026-08-06).
  // `teachers` is the authenticated-staff name picker used everywhere else, and returns
  // exactly this set: active TEACHER accounts.
  const [teachersQ] = useQuery({ query: TEACHERS_QUERY });
  const teachers = teachersQ.data?.teachers ?? [];

  const [, upsert] = useMutation(UPSERT_AS_SCHEDULE);
  const [, addEntry] = useMutation(ADD_AS_SCHEDULE_ENTRY);
  const [, removeEntry] = useMutation(REMOVE_AS_SCHEDULE_ENTRY);
  const [, updateEntryTeacher] = useMutation(UPDATE_AS_SCHEDULE_ENTRY_TEACHER);
  // D-#328: per-entry teacher edit — the entry being edited + its picked teacher.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTeacherId, setEditTeacherId] = useState<string | null>(null);

  const [termStart, setTermStart] = useState<string | null>(null);
  const [deliveryDow, setDeliveryDow] = useState<number | null>(null);
  const [dueDow, setDueDow] = useState<number | null>(null);

  const [cycleWeek, setCycleWeek] = useState(1);
  const [classId, setClassId] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const termStartValue = termStart ?? (schedule ? schedule.termStartDate.slice(0, 10) : "");
  const deliveryValue = deliveryDow ?? schedule?.deliveryDayOfWeek ?? 4;
  const dueValue = dueDow ?? schedule?.dueDayOfWeek ?? 0;
  const selectedClass = classes.find((c) => c.id === classId) ?? null;

  async function onSave(): Promise<void> {
    setError(null);
    setOk(null);
    if (!termStartValue) return setError(STR.asTermStart);
    setBusy(true);
    const res = await upsert({
      academicYearId: yearId,
      termStartDate: termStartValue,
      deliveryDayOfWeek: deliveryValue,
      dueDayOfWeek: dueValue,
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.asScheduleSaved);
    refetchSchedule({ requestPolicy: "network-only" });
  }

  async function onAddEntry(): Promise<void> {
    setError(null);
    setOk(null);
    if (!selectedClass || !sectionId || !subject || !teacherId) return setError(STR.asFillAll);
    setBusy(true);
    const res = await addEntry({
      academicYearId: yearId,
      cycleWeek,
      classId: selectedClass.id,
      classLevel: selectedClass.level,
      sectionId,
      subject,
      teacherId,
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.asEntryAdded);
    refetchSchedule({ requestPolicy: "network-only" });
  }

  async function onRemove(entryId: string): Promise<void> {
    if (!(await confirmAction({ message: STR.asRemoveEntryConfirm, confirmLabel: STR.asRemoveEntry }))) return;
    setError(null);
    setOk(null);
    const res = await removeEntry({ academicYearId: yearId, entryId });
    if (res.error) return setError(friendlyError(res.error));
    toast.show(STR.asEntryRemoved, "ok");
    refetchSchedule({ requestPolicy: "network-only" });
  }

  function startEdit(entryId: string, currentTeacherId: string): void {
    setError(null);
    setOk(null);
    setEditingId(entryId);
    setEditTeacherId(currentTeacherId);
  }

  async function onEditSave(entryId: string): Promise<void> {
    if (!editTeacherId) return;
    setError(null);
    setOk(null);
    setBusy(true);
    const res = await updateEntryTeacher({ academicYearId: yearId, entryId, teacherId: editTeacherId });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.asTeacherChanged);
    setEditingId(null);
    setEditTeacherId(null);
    refetchSchedule({ requestPolicy: "network-only" });
  }

  const teacherName = (id: string): string => teachers.find((t) => t.id === id)?.name ?? id;
  const sectionName = (cId: string, sId: string): string => {
    const cls = classes.find((c) => c.id === cId);
    const sec = cls?.sections.find((s) => s.id === sId);
    return cls && sec ? `${cls.nameBn} ${sec.nameBn}` : sId;
  };

  // Owner request: filter the rotation list by class / teacher / subject so it's
  // easy to see who teaches what. Reuses the shared report filters (D-#309);
  // options come from the entries themselves.
  const allEntries = schedule?.entries ?? [];
  const { node: filterNode, match } = useReportFilterState({
    classLevels: allEntries.map((e) => e.classLevel),
    teachers: allEntries.map((e) => teacherName(e.teacherId)),
    subjects: allEntries.map((e) => e.subject),
  });
  const visibleEntries = allEntries.filter((e) => match(e.classLevel, teacherName(e.teacherId), e.subject));

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {yearsQ.fetching || scheduleQ.fetching ? (
          <Loader label={STR.loading} />
        ) : (
          <>
            {ok ? <Notice message={ok} tone="ok" /> : null}
            {error ? <Notice message={error} tone="danger" /> : null}

            <Card>
              <Body style={{ fontWeight: "700", marginBottom: 8 }}>{STR.asScheduleTitle}</Body>
              <Select
                label={STR.asAcademicYear}
                value={yearId || null}
                options={years.map((y) => ({
                  label: y.current ? `${y.label} (${STR.asCurrentYear})` : y.label,
                  value: y.id,
                }))}
                onChange={(v) => setPickedYearId(v)}
                placeholder={STR.asAcademicYear}
              />
              {years.length === 0 ? <Notice message={STR.asNoAcademicYear} tone="warn" /> : null}
              <DateField label={STR.asTermStart} value={termStartValue} onChange={setTermStart} />
              <Muted style={{ marginTop: 4 }}>{STR.asDeliveryDay}</Muted>
              <ChipRow>
                {ANCHOR_DAYS.map((d) => (
                  <Chip key={d} label={dayOfWeekLabel(DAYS_OF_WEEK[d])} selected={deliveryValue === d} onPress={() => setDeliveryDow(d)} />
                ))}
              </ChipRow>
              <Muted style={{ marginTop: 4 }}>{STR.asDueDay}</Muted>
              <ChipRow>
                {ANCHOR_DAYS.map((d) => (
                  <Chip key={d} label={dayOfWeekLabel(DAYS_OF_WEEK[d])} selected={dueValue === d} onPress={() => setDueDow(d)} />
                ))}
              </ChipRow>
              <View style={{ marginTop: 8 }}>
                <Button title={STR.asSaveSchedule} onPress={onSave} loading={busy} disabled={busy} />
              </View>
            </Card>

            {schedule ? (
              <>
                <Card>
                  <Body style={{ fontWeight: "700", marginBottom: 8 }}>{STR.asAddEntry}</Body>
                  <Muted>{STR.asCycleWeek}</Muted>
                  <ChipRow>
                    {[1, 2, 3, 4].map((w) => (
                      <Chip key={w} label={bnNum(w)} selected={cycleWeek === w} onPress={() => setCycleWeek(w)} />
                    ))}
                  </ChipRow>
                  <Select
                    label={STR.class}
                    value={classId}
                    options={classes.map((c) => ({ label: c.nameBn, value: c.id }))}
                    onChange={(v) => {
                      setClassId(v);
                      setSectionId(null);
                    }}
                    placeholder={STR.class}
                  />
                  {selectedClass ? (
                    <Select
                      label={STR.section}
                      value={sectionId}
                      options={selectedClass.sections.filter((s) => s.active).map((s) => ({ label: s.nameBn, value: s.id }))}
                      onChange={setSectionId}
                      placeholder={STR.section}
                    />
                  ) : null}
                  <Muted style={{ marginTop: 4 }}>{STR.subject}</Muted>
                  <ChipRow>
                    {HW_SUBJECTS.map((s) => (
                      <Chip key={s} label={hwSubjectLabel(s)} selected={subject === s} onPress={() => setSubject(s)} />
                    ))}
                  </ChipRow>
                  <Select
                    label={STR.asTeacher}
                    value={teacherId}
                    options={teachers.map((t) => ({ label: t.name, value: t.id }))}
                    onChange={setTeacherId}
                    placeholder={STR.asTeacher}
                    searchable
                  />
                  <View style={{ marginTop: 8 }}>
                    <Button title={STR.asAddEntry} onPress={onAddEntry} loading={busy} disabled={busy} />
                  </View>
                </Card>

                {allEntries.length > 0 ? <Card>{filterNode}</Card> : null}

                {[1, 2, 3, 4].map((w) => {
                  const entries = visibleEntries.filter((e) => e.cycleWeek === w);
                  return (
                    <Card key={w}>
                      <Body style={{ fontWeight: "700" }}>
                        {STR.asCycleWeek} {bnNum(w)}
                      </Body>
                      <Muted style={{ marginBottom: 4 }}>= {cycleWeekMeaning(w)}</Muted>
                      {entries.length === 0 ? (
                        <Muted>{STR.empty}</Muted>
                      ) : (
                        entries.map((e) => (
                          <View key={e.id} style={{ marginTop: 6 }}>
                            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                              <View style={{ flexShrink: 1 }}>
                                <Body>
                                  {sectionName(e.classId, e.sectionId)} — {hwSubjectLabel(e.subject)}
                                </Body>
                                <Muted>
                                  {classLevelLabel(e.classLevel)} · {teacherName(e.teacherId)}
                                </Muted>
                              </View>
                              <ChipRow>
                                <Chip label={STR.asEditEntry} onPress={() => startEdit(e.id, e.teacherId)} />
                                <Chip label={STR.asRemoveEntry} onPress={() => void onRemove(e.id)} />
                              </ChipRow>
                            </View>
                            {editingId === e.id ? (
                              <View style={{ marginTop: 6 }}>
                                <Select
                                  label={STR.asTeacher}
                                  value={editTeacherId}
                                  options={teachers.map((t) => ({ label: t.name, value: t.id }))}
                                  onChange={setEditTeacherId}
                                  placeholder={STR.asTeacher}
                                  searchable
                                />
                                <ChipRow>
                                  <Chip label={STR.save} onPress={() => void onEditSave(e.id)} />
                                  <Chip label={STR.cancel} onPress={() => { setEditingId(null); setEditTeacherId(null); }} />
                                </ChipRow>
                              </View>
                            ) : null}
                          </View>
                        ))
                      )}
                    </Card>
                  );
                })}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
