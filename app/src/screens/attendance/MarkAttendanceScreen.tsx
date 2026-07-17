/**
 * MarkAttendanceScreen (AT2.3, D-#63; unit-shaped by D-#278) — ABSENT-ONLY capture:
 * the marker taps the absent students; everyone else counts present. One record per
 * attendance UNIT per day; re-submitting the same day overwrites it (editable until
 * end of day, O2). The server enforces the marker gate + the FULL-day calendar.
 *
 * The unit is the caller's Quran group (Class 1–5) or their Nursery/KG section — but
 * the roster is always rendered under CLASS/SECTION headings, because a Quran group
 * mixes sections and the school reads attendance class-wise (D-#278).
 */
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  ATTENDANCE_UNIT_ROSTER,
  ATTENDANCE_UNIT_DAY,
  MARK_ATTENDANCE_UNIT,
  AMEND_ATTENDANCE_UNIT,
} from "../../graphql/operations";
import type { AttendanceStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Chip, ChipRow, Button, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { STR, bnNum, classLevelLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AttendanceStackParamList, "MarkAttendance">;

export default function MarkAttendanceScreen({ route }: Props): React.ReactElement {
  const { unitType, unitId, title, dateKey, amend } = route.params;
  const [absent, setAbsent] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const [rosterQ, refetchRoster] = useQuery({ query: ATTENDANCE_UNIT_ROSTER, variables: { unitType, unitId, dateKey } });
  const [dayQ, refetchDay] = useQuery({
    query: ATTENDANCE_UNIT_DAY,
    variables: { unitType, unitId, dateKey },
    requestPolicy: "network-only",
  });
  const [, mark] = useMutation(MARK_ATTENDANCE_UNIT);
  // D-#292: the Principal/Office path — any unit, today or a locked past day (audited).
  const [, amendMark] = useMutation(AMEND_ATTENDANCE_UNIT);

  const sections = rosterQ.data?.attendanceUnitRoster ?? [];
  const existing = dayQ.data?.attendanceUnitDay ?? null;
  const totalStudents = sections.reduce((n, s) => n + s.students.length, 0);

  // Prefill from the already-marked day (same-day edit, O2).
  useEffect(() => {
    if (existing) setAbsent(new Set(existing.absentStudentIds));
  }, [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(studentId: string): void {
    setAbsent((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  async function onSubmit(): Promise<void> {
    setBusy(true);
    const vars = { unitType, unitId, dateKey, absentStudentIds: [...absent] };
    const res = amend ? await amendMark(vars) : await mark(vars);
    setBusy(false);
    const day = amend
      ? (res.data as { amendAttendanceUnit?: unknown } | undefined)?.amendAttendanceUnit
      : (res.data as { markAttendanceUnit?: unknown } | undefined)?.markAttendanceUnit;
    if (res.error || !day) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.attSubmitted, "ok");
    refetchDay({ requestPolicy: "network-only" });
  }

  const presentCount = totalStudents - absent.size;

  return (
    <Screen scroll>
      <H2>{title}</H2>
      <Muted>{dateKey} · {STR.attTapAbsent}</Muted>

      {rosterQ.error ? (
        <ErrorBanner
          message={friendlyError(rosterQ.error)}
          onRetry={() => refetchRoster({ requestPolicy: "network-only" })}
        />
      ) : rosterQ.fetching ? (
        <Loader label={STR.loading} />
      ) : totalStudents === 0 ? (
        <EmptyState message={STR.empty} />
      ) : (
        <>
          <Card style={{ marginTop: space(3) }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Body>
                {STR.attPresentWord}: <Body style={{ fontWeight: "700" }}>{bnNum(presentCount)}</Body>
              </Body>
              <Body>
                {STR.attAbsentWord}: <Body style={{ fontWeight: "700" }}>{bnNum(absent.size)}</Body>
              </Body>
            </View>
            {existing ? <Muted style={{ marginTop: space(1) }}>✓ {STR.attMarked}</Muted> : null}
          </Card>

          {/* One card per class/section — a Quran group's roster still reads class-wise. */}
          {sections.map((section) => (
            <Card key={section.sectionId}>
              <Body style={{ fontWeight: "700", marginBottom: space(2) }}>
                {classLevelLabel(section.classLevel)}
                {section.sectionNameBn ? ` — ${section.sectionNameBn}` : ""}
                {" · "}
                {bnNum(section.students.length)} {STR.attStudentsWord}
              </Body>
              <ChipRow>
                {section.students.map((s) => (
                  <Chip
                    key={s.studentId}
                    label={`${s.nameBn || s.name}${absent.has(s.studentId) ? " ✗" : ""}`}
                    selected={!absent.has(s.studentId)}
                    onPress={() => toggle(s.studentId)}
                  />
                ))}
              </ChipRow>
            </Card>
          ))}

          <Button title={STR.attSubmit} onPress={onSubmit} loading={busy} />
          <View style={{ height: space(4) }} />
        </>
      )}
    </Screen>
  );
}
