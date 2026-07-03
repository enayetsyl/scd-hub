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
import { HW_SUBJECTS, DAYS_OF_WEEK } from "@scd/shared";
import {
  ACADEMIC_YEARS_QUERY,
  CLASSES_QUERY,
  USERS_QUERY,
  AS_SCHEDULE_QUERY,
  UPSERT_AS_SCHEDULE,
  ADD_AS_SCHEDULE_ENTRY,
  REMOVE_AS_SCHEDULE_ENTRY,
} from "../../graphql/operations";
import type { AssignmentStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Button, Field, Chip, ChipRow, Select, Loader, Notice } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR, bnNum, hwSubjectLabel, dayOfWeekLabel, classLevelLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AssignmentStackParamList, "AssignmentSchedule">;

/** Anchors may sit on school weekdays only (Sun–Thu, D-#86). */
const ANCHOR_DAYS = [0, 1, 2, 3, 4] as const;

export default function AssignmentScheduleScreen(_props: Props): React.ReactElement {
  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const year = (yearsQ.data?.academicYears ?? []).find((y) => y.current) ?? yearsQ.data?.academicYears?.[0];
  const yearId = year?.id ?? "";

  const [scheduleQ, refetchSchedule] = useQuery({
    query: AS_SCHEDULE_QUERY,
    variables: { academicYearId: yearId },
    pause: !yearId,
  });
  const schedule = scheduleQ.data?.assignmentSchedule ?? null;

  const [classesQ] = useQuery({ query: CLASSES_QUERY, variables: { academicYearId: yearId }, pause: !yearId });
  const classes = (classesQ.data?.classes ?? []).filter((c) => c.active && c.level >= 1 && c.level <= 5);
  const [usersQ] = useQuery({ query: USERS_QUERY });
  const teachers = (usersQ.data?.users ?? []).filter((u) => u.active && u.role === "TEACHER");

  const [, upsert] = useMutation(UPSERT_AS_SCHEDULE);
  const [, addEntry] = useMutation(ADD_AS_SCHEDULE_ENTRY);
  const [, removeEntry] = useMutation(REMOVE_AS_SCHEDULE_ENTRY);

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
    setError(null);
    setOk(null);
    const res = await removeEntry({ academicYearId: yearId, entryId });
    if (res.error) return setError(friendlyError(res.error));
    refetchSchedule({ requestPolicy: "network-only" });
  }

  const teacherName = (id: string): string => teachers.find((t) => t.id === id)?.name ?? id;
  const sectionName = (cId: string, sId: string): string => {
    const cls = classes.find((c) => c.id === cId);
    const sec = cls?.sections.find((s) => s.id === sId);
    return cls && sec ? `${cls.nameBn} ${sec.nameBn}` : sId;
  };

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
                  />
                  <View style={{ marginTop: 8 }}>
                    <Button title={STR.asAddEntry} onPress={onAddEntry} loading={busy} disabled={busy} />
                  </View>
                </Card>

                {[1, 2, 3, 4].map((w) => {
                  const entries = schedule.entries.filter((e) => e.cycleWeek === w);
                  return (
                    <Card key={w}>
                      <Body style={{ fontWeight: "700", marginBottom: 4 }}>
                        {STR.asCycleWeek} {bnNum(w)}
                      </Body>
                      {entries.length === 0 ? (
                        <Muted>{STR.empty}</Muted>
                      ) : (
                        entries.map((e) => (
                          <View
                            key={e.id}
                            style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}
                          >
                            <View style={{ flexShrink: 1 }}>
                              <Body>
                                {sectionName(e.classId, e.sectionId)} — {hwSubjectLabel(e.subject)}
                              </Body>
                              <Muted>
                                {classLevelLabel(e.classLevel)} · {teacherName(e.teacherId)}
                              </Muted>
                            </View>
                            <Chip label={STR.asRemoveEntry} onPress={() => void onRemove(e.id)} />
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
