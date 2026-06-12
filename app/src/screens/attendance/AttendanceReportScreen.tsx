/**
 * AttendanceReportScreen (AT-5, §8) — the reporting surface for a date:
 *   • class-/section-wise absentee report (count + names + ROLL + ID — the
 *     external SMS sheet's replacement, AT2.5; leave-covered flagged)
 *   • unmarked-section log (who missed marking + the responsible marker)
 *   • absent-with-no-application over a range (AT3.2) — with inline
 *     leave-application recording (Office acts for the guardian, AT4.7/D-#66)
 *   • staff attendance summary over the same range (O4)
 * attendance:manage (Principal/Office).
 */
import React, { useState } from "react";
import { View, Linking } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation, useClient } from "urql";
import {
  ABSENTEE_REPORT,
  UNMARKED_SECTIONS,
  ABSENT_NO_APPLICATION,
  TEACHER_ATTENDANCE_SUMMARY,
  SUBMIT_LEAVE_APPLICATION,
  GUARDIAN_CHASE_LINK,
} from "../../graphql/operations";
import type { AttendanceStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Badge, Button, Field, Notice, Divider, Loader } from "../../components/ui";
import { STR, bnNum, classLevelLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AttendanceStackParamList, "AttendanceReport">;

const keyOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayKey = (): string => keyOf(new Date());
const daysAgoKey = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return keyOf(d);
};

export default function AttendanceReportScreen(_props: Props): React.ReactElement {
  const [dateKey, setDateKey] = useState(todayKey());
  const [fromKey, setFromKey] = useState(daysAgoKey(14));
  const [leaveFor, setLeaveFor] = useState<string | null>(null); // studentId
  const [leaveReason, setLeaveReason] = useState("");
  const [leaveFrom, setLeaveFrom] = useState(todayKey());
  const [leaveTo, setLeaveTo] = useState(todayKey());
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [reportQ, refetchReport] = useQuery({ query: ABSENTEE_REPORT, variables: { dateKey } });
  const [unmarkedQ, refetchUnmarked] = useQuery({ query: UNMARKED_SECTIONS, variables: { dateKey } });
  const [noAppQ, refetchNoApp] = useQuery({
    query: ABSENT_NO_APPLICATION,
    variables: { sectionId: null, fromKey, toKey: dateKey },
  });
  const [summaryQ] = useQuery({
    query: TEACHER_ATTENDANCE_SUMMARY,
    variables: { fromKey, toKey: dateKey },
  });
  const [, submitLeave] = useMutation(SUBMIT_LEAVE_APPLICATION);
  const client = useClient();

  const report = reportQ.data?.absenteeReport ?? [];
  const unmarked = unmarkedQ.data?.unmarkedSections ?? [];
  const noApp = noAppQ.data?.absentNoApplication ?? [];
  const summary = summaryQ.data?.teacherAttendanceSummary ?? [];

  async function onRecordLeave(studentId: string): Promise<void> {
    setError(null);
    setOk(null);
    setBusy(true);
    const res = await submitLeave({ studentId, fromKey: leaveFrom, toKey: leaveTo, reason: leaveReason });
    setBusy(false);
    if (res.error || !res.data?.submitLeaveApplication) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.attLeaveSaved);
    setLeaveFor(null);
    setLeaveReason("");
    refetchNoApp({ requestPolicy: "network-only" });
    refetchReport({ requestPolicy: "network-only" });
  }

  // AT4.7 — Office manual guardian chase: fetch the wa.me link, then open it.
  // WhatsApp stays a manual click (D-#65); the teacher never chases (O3).
  async function onChase(studentId: string): Promise<void> {
    setError(null);
    setOk(null);
    const res = await client
      .query(GUARDIAN_CHASE_LINK, { studentId }, { requestPolicy: "network-only" })
      .toPromise();
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    const url = res.data?.guardianChaseLink;
    if (!url) {
      setError(STR.attNoGuardianPhone);
      return;
    }
    void Linking.openURL(url);
  }

  const loading = reportQ.fetching || unmarkedQ.fetching;

  return (
    <Screen scroll>
      <Field label={STR.attDate} value={dateKey} onChangeText={setDateKey} placeholder="YYYY-MM-DD" />
      {error ? <Notice message={error} tone="danger" /> : null}
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {reportQ.error ? <Notice message={friendlyError(reportQ.error)} tone="danger" /> : null}
      {loading ? <Loader label={STR.loading} /> : null}

      {/* Absentee report (the external sheet's replacement) */}
      <H2>{STR.attReportTitle}</H2>
      {report.length === 0 && !loading ? <Muted>{STR.attNoAbsentees}</Muted> : null}
      {report.map((cls) => (
        <Card key={cls.classId}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700" }}>{classLevelLabel(cls.classLevel)}</Body>
            <Badge text={`${STR.attAbsentWord}: ${bnNum(cls.absentCount)}`} tone={cls.absentCount > 0 ? "warn" : "ok"} />
          </View>
          {cls.sections.map((sec) => (
            <View key={sec.sectionId} style={{ marginTop: space(2) }}>
              <Muted style={{ fontWeight: "700" }}>
                {sec.sectionNameBn || sec.sectionCode} · {bnNum(sec.absentCount)}
              </Muted>
              {sec.absentees.map((a) => (
                <View key={a.studentId} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 }}>
                  <Body style={{ flex: 1 }}>{a.nameBn || a.name}</Body>
                  <Muted>
                    {STR.attRoll}: {a.rollNumber ? bnNum(a.rollNumber) : "—"} · {STR.attIdNo}: {bnNum(a.schoolId)}
                    {a.leaveCovered ? " · ✓" : ""}
                  </Muted>
                </View>
              ))}
            </View>
          ))}
        </Card>
      ))}

      {/* Unmarked sections */}
      <Divider />
      <H2>{STR.attUnmarkedSections}</H2>
      {unmarked.length === 0 && !unmarkedQ.fetching ? <Notice message={STR.attAllMarked} tone="ok" /> : null}
      {unmarked.map((u) => (
        <Card key={u.sectionId}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700" }}>
              {classLevelLabel(u.classLevel)} — {u.sectionNameBn || u.sectionCode}
            </Body>
            <Muted>
              {STR.attMarkerWord}: {u.markerName ?? STR.attNoMarker}
            </Muted>
          </View>
        </Card>
      ))}

      {/* Absent & no application (range) + inline leave recording */}
      <Divider />
      <H2>{STR.attAbsentNoApp}</H2>
      <Field label={STR.attFrom} value={fromKey} onChangeText={setFromKey} placeholder="YYYY-MM-DD" />
      {noApp.length === 0 && !noAppQ.fetching ? <Muted>{STR.attNoneNoApp}</Muted> : null}
      {noApp.map((s) => (
        <Card key={s.studentId}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700", flex: 1 }}>{s.nameBn || s.name}</Body>
            <Muted>
              {STR.attRoll}: {s.rollNumber ? bnNum(s.rollNumber) : "—"} · {STR.attIdNo}: {bnNum(s.schoolId)}
            </Muted>
          </View>
          <Muted style={{ marginTop: 2 }}>{s.dateKeys.map(bnNum).join(" · ")}</Muted>
          {leaveFor === s.studentId ? (
            <View style={{ marginTop: space(2) }}>
              <Field label={STR.attLeaveFrom} value={leaveFrom} onChangeText={setLeaveFrom} placeholder="YYYY-MM-DD" />
              <Field label={STR.attLeaveTo} value={leaveTo} onChangeText={setLeaveTo} placeholder="YYYY-MM-DD" />
              <Field label={STR.attLeaveReason} value={leaveReason} onChangeText={setLeaveReason} multiline />
              <Button title={STR.attRecordLeave} onPress={() => onRecordLeave(s.studentId)} loading={busy} disabled={!leaveReason.trim()} />
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
              <Button title={STR.attRecordLeave} variant="ghost" onPress={() => setLeaveFor(s.studentId)} />
              <Button title={STR.attChaseWhatsApp} variant="ghost" onPress={() => onChase(s.studentId)} />
            </View>
          )}
        </Card>
      ))}

      {/* Staff summary over the range (O4) */}
      <Divider />
      <H2>{STR.attStaffSummary}</H2>
      {summary.map((st) => (
        <Card key={st.staffProfileId}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700", flex: 1 }}>{st.staffName}</Body>
            <Badge text={`${bnNum(st.presentPct)}%`} tone={st.presentPct >= 90 ? "ok" : st.presentPct >= 70 ? "warn" : "danger"} />
          </View>
          <Muted style={{ marginTop: 2 }}>
            {bnNum(st.days)} {STR.attDaysWord} · ✔ {bnNum(st.present)} · 𝓛 {bnNum(st.late)} · {STR.attAbsentWord} {bnNum(st.absent)}
          </Muted>
        </Card>
      ))}
      <View style={{ height: space(4) }} />
    </Screen>
  );
}
