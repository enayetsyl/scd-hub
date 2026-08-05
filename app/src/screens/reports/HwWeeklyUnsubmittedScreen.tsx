/**
 * HwWeeklyUnsubmittedScreen (D-#453) — the staff twin of the Thursday guardian
 * digest: per-student weekly unsubmitted homework (subject, date, details,
 * chase count) + the digest-day heads-up, with a manual wa.me button per
 * student carrying the SAME rendered Bangla message login-enabled guardians
 * got in-app — the bridge to the ~129 contact-only families (ADR-003: the
 * send is always a human tap, never auto-dispatched).
 *
 * Cloned from ClassNoteReportScreen: the fixed "paper" palette (this grid is
 * the on-screen twin of the print/CSV export — the documented exception to
 * the no-hard-coded-hex rule), client-side filters, window.print() (web only).
 */
import React, { useMemo, useState } from "react";
import { Linking, Platform, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import {
  HOMEWORK_WEEKLY_UNSUBMITTED_QUERY,
  type HwWeeklyStudentRowT,
  type HwWeeklyUnsubmittedReportT,
} from "../../graphql/hwWeeklyDigest";
import type { ReportsStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Notice, Loader, Button, Select } from "../../components/ui";
import { STR, bnNum, subjectLabel, classLevelLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { dateKey } from "../../lib/dates";

type Props = NativeStackScreenProps<ReportsStackParamList, "HwWeeklyUnsubmitted">;

const entryOptions = [
  { label: "10", value: "10" },
  { label: "25", value: "25" },
  { label: "50", value: "50" },
  { label: STR.all, value: "all" },
] as const;
type EntryLimit = (typeof entryOptions)[number]["value"];

/** The Sunday of the week containing `key` (local; weeks are Sun–Sat). */
function sundayOf(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() - date.getDay());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

function shiftWeeks(sundayKey: string, weeks: number): string {
  const [y, m, d] = sundayKey.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, (d ?? 1) + weeks * 7);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

function csvCell(value: string | number | null | undefined): string {
  const raw = value == null ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, header: string[], rows: string[][]): void {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  // Leading BOM so Excel opens the Bangla CSV as UTF-8 (the ClassNoteReport pattern).
  const blob = new Blob(["﻿", body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** The report table's "paper" palette — see ClassNoteReportScreen's rationale. */
const REPORT = {
  headerBg: "#4f9cf9",
  headerText: "#fff",
  headerDivider: "rgba(255,255,255,0.18)",
  rowEven: "#eef5ff",
  rowOdd: "#fff",
  rowBorder: "#dde7f5",
  text: "#182420",
  textMuted: "#46554E",
} as const;

function openWa(waLink: string): void {
  if (Platform.OS === "web") window.open(waLink, "_blank");
  else void Linking.openURL(waLink);
}

export default function HwWeeklyUnsubmittedScreen({ route }: Props): React.ReactElement {
  const [weekStart, setWeekStart] = useState(sundayOf(route.params?.weekStart ?? dateKey()));
  const [entryLimit, setEntryLimit] = useState<EntryLimit>("all");
  const [filterSection, setFilterSection] = useState<string>("");
  const [filterSubject, setFilterSubject] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");

  const [reportQ] = useQuery<{ homeworkWeeklyUnsubmitted: HwWeeklyUnsubmittedReportT }>({
    query: HOMEWORK_WEEKLY_UNSUBMITTED_QUERY,
    variables: { weekStart },
    requestPolicy: "cache-and-network",
  });
  const report = reportQ.data?.homeworkWeeklyUnsubmitted ?? null;
  const rows = report?.students ?? [];

  const allLabel = STR.all;
  const sectionName = (r: HwWeeklyStudentRowT): string =>
    r.sectionNameBn ?? classLevelLabel(r.classLevel);

  const sectionOptions = useMemo(
    () => [
      { label: allLabel, value: "" },
      ...[...new Set(rows.map(sectionName))].sort((a, b) => a.localeCompare(b)).map((s) => ({ label: s, value: s })),
    ],
    [rows, allLabel],
  );
  const subjectOptions = useMemo(
    () => [
      { label: allLabel, value: "" },
      ...[...new Set(rows.flatMap((r) => r.unsubmitted.map((l) => l.subject)))]
        .sort()
        .map((s) => ({ label: subjectLabel(s), value: s })),
    ],
    [rows, allLabel],
  );
  const statusOptions = useMemo(
    () => [
      { label: allLabel, value: "" },
      { label: STR.hwwdHasUnsub, value: "unsub" },
      { label: STR.hwwdAllClear, value: "clear" },
    ],
    [allLabel],
  );

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          (filterSection === "" || sectionName(r) === filterSection) &&
          (filterSubject === "" || r.unsubmitted.some((l) => l.subject === filterSubject)) &&
          (filterStatus === "" ||
            (filterStatus === "unsub" ? r.unsubmitted.length > 0 : r.unsubmitted.length === 0)),
      ),
    [rows, filterSection, filterSubject, filterStatus],
  );
  const visibleRows = entryLimit === "all" ? filteredRows : filteredRows.slice(0, Number(entryLimit));
  const unsubTotal = filteredRows.reduce((sum, r) => sum + r.unsubmitted.length, 0);
  const canExport = Platform.OS === "web";

  const columns = [
    { key: "sl", label: "SL", width: 48 },
    { key: "section", label: STR.hwwdSection, width: 130 },
    { key: "student", label: STR.hwwdStudent, width: 190 },
    { key: "unsub", label: STR.hwwdUnsubCol, width: 340 },
    { key: "heads", label: STR.hwwdHeadsUpCol, width: 220 },
    { key: "phone", label: STR.hwwdPhone, width: 140 },
    { key: "wa", label: STR.hwwdWa, width: 150 },
  ] as const;
  const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);

  function onPrint(): void {
    if (canExport) window.print();
  }

  function onExcel(): void {
    if (!canExport) return;
    const header = ["SL", STR.hwwdSection, STR.hwwdStudent, STR.hwwdUnsubCol, STR.hwwdHeadsUpCol, STR.hwwdPhone];
    const data = filteredRows.map((r, i) => [
      bnNum(i + 1),
      sectionName(r),
      `${r.nameBn ?? r.name}${r.rollNumber ? ` (${r.rollNumber})` : ""}`,
      r.unsubmitted
        .map((l) => `${l.subjectLabelBn} ${l.dateKey}${l.description ? `: ${l.description}` : ""} [${l.stateLabelBn}${l.chaseCount ? ` ×${l.chaseCount}` : ""}]`)
        .join(" | ") || STR.hwwdNoUnsub,
      r.headsUp.map((l) => `${l.subjectLabelBn}${l.description ? `: ${l.description}` : ""}`).join(" | ") || "—",
      r.guardianPhone ?? "—",
    ]);
    downloadCsv(`hw-weekly-unsubmitted-${weekStart}.csv`, header, data);
  }

  function onReset(): void {
    setWeekStart(sundayOf(dateKey()));
    setEntryLimit("all");
    setFilterSection("");
    setFilterSubject("");
    setFilterStatus("");
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.hwwdTitle}</Body>
          <Muted>{STR.hwwdHint}</Muted>

          {/* Week stepper — the server snaps any key to its Sunday and reports
              the window the digest used (last open day of that week). */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2), alignItems: "center" }}>
            <Button title={`← ${STR.hwwdPrevWeek}`} variant="secondary" onPress={() => setWeekStart((w) => shiftWeeks(w, -1))} />
            <Badge
              text={report ? `${bnNum(report.unsubFromKey)} — ${bnNum(report.headsUpKey)}` : bnNum(weekStart)}
              tone="muted"
            />
            <Button title={`${STR.hwwdNextWeek} →`} variant="secondary" onPress={() => setWeekStart((w) => shiftWeeks(w, 1))} />
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
            <Badge text={`${STR.hwwdUnsubCol}: ${bnNum(unsubTotal)}`} tone={unsubTotal > 0 ? "warn" : "ok"} />
            <Badge
              text={`${STR.rtTableShowing} ${bnNum(visibleRows.length)} ${STR.rtTableOf} ${bnNum(filteredRows.length)}`}
              tone="muted"
            />
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(3), alignItems: "flex-end", justifyContent: "space-between" }}>
            <View style={{ minWidth: 160, flexGrow: 1 }}>
              <Select label={STR.rtShowEntries} value={entryLimit} options={[...entryOptions]} onChange={setEntryLimit} />
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), justifyContent: "flex-end" }}>
              <Button title={STR.rtTablePrint} variant="secondary" onPress={onPrint} disabled={!canExport} />
              <Button title={STR.rtTableExcel} variant="secondary" onPress={onExcel} disabled={!canExport} />
              <Button title={STR.rtTableReset} variant="ghost" onPress={onReset} />
            </View>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(3) }}>
            <View style={{ minWidth: 160, flexGrow: 1 }}>
              <Select label={STR.hwwdSection} value={filterSection} options={sectionOptions} onChange={setFilterSection} />
            </View>
            <View style={{ minWidth: 160, flexGrow: 1 }}>
              <Select label={STR.hwwdSubject} value={filterSubject} options={subjectOptions} onChange={setFilterSubject} />
            </View>
            <View style={{ minWidth: 160, flexGrow: 1 }}>
              <Select label={STR.hwwdStatus} value={filterStatus} options={statusOptions} onChange={setFilterStatus} />
            </View>
          </View>
        </Card>

        {reportQ.error ? <Notice message={friendlyError(reportQ.error)} tone="danger" /> : null}
        {reportQ.fetching && !report ? <Loader label={STR.loading} /> : null}
        {report && filteredRows.length === 0 && !reportQ.fetching ? (
          <Notice message={rows.length === 0 ? STR.hwwdEmpty : STR.empty} tone="ok" />
        ) : null}

        {filteredRows.length > 0 ? (
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View style={{ minWidth: tableWidth }}>
                <View style={{ flexDirection: "row", backgroundColor: REPORT.headerBg }}>
                  {columns.map((col) => (
                    <View
                      key={col.key}
                      style={{
                        width: col.width,
                        paddingVertical: space(2),
                        paddingHorizontal: space(2),
                        justifyContent: "center",
                        borderRightWidth: 1,
                        borderRightColor: REPORT.headerDivider,
                      }}
                    >
                      <Text style={{ color: REPORT.headerText, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>
                        {col.label}
                      </Text>
                    </View>
                  ))}
                </View>

                {visibleRows.map((r, index) => (
                  <View
                    key={r.studentId}
                    style={{
                      flexDirection: "row",
                      backgroundColor: index % 2 === 0 ? REPORT.rowEven : REPORT.rowOdd,
                      borderBottomWidth: 1,
                      borderBottomColor: REPORT.rowBorder,
                    }}
                  >
                    <View style={{ width: 48, padding: space(2), justifyContent: "center" }}>
                      <Text style={{ color: REPORT.text, fontWeight: "700" }}>{bnNum(index + 1)}</Text>
                    </View>
                    <View style={{ width: 130, padding: space(2), justifyContent: "center" }}>
                      <Muted style={{ color: REPORT.textMuted }}>{sectionName(r)}</Muted>
                    </View>
                    <View style={{ width: 190, padding: space(2), justifyContent: "center" }}>
                      <Body style={{ fontWeight: "700", color: REPORT.text }}>{r.nameBn ?? r.name}</Body>
                      {r.rollNumber ? (
                        <Muted style={{ color: REPORT.textMuted }}>{`${STR.hwwdRoll} ${bnNum(r.rollNumber)}`}</Muted>
                      ) : null}
                    </View>
                    <View style={{ width: 340, padding: space(2), justifyContent: "center", gap: space(1) }}>
                      {r.unsubmitted.length === 0 ? (
                        <Muted style={{ color: REPORT.textMuted }}>{STR.hwwdNoUnsub}</Muted>
                      ) : (
                        r.unsubmitted.map((l) => (
                          <Text key={`${l.hwItemId}`} style={{ color: REPORT.text, fontSize: 13 }}>
                            {`• ${l.subjectLabelBn} — ${bnNum(l.dateKey)}${l.description ? `: ${l.description}` : ""}`}
                            <Text style={{ color: REPORT.textMuted, fontSize: 12 }}>
                              {`  [${l.stateLabelBn}${l.chaseCount > 0 ? ` ×${bnNum(l.chaseCount)}` : ""}]`}
                            </Text>
                          </Text>
                        ))
                      )}
                    </View>
                    <View style={{ width: 220, padding: space(2), justifyContent: "center", gap: space(1) }}>
                      {r.headsUp.length === 0 ? (
                        <Muted style={{ color: REPORT.textMuted }}>—</Muted>
                      ) : (
                        r.headsUp.map((l) => (
                          <Text key={`${l.hwItemId}`} style={{ color: REPORT.text, fontSize: 13 }}>
                            {`• ${l.subjectLabelBn}${l.dueDateKey ? ` (${STR.hwwdDue} ${bnNum(l.dueDateKey)})` : ""}`}
                          </Text>
                        ))
                      )}
                    </View>
                    <View style={{ width: 140, padding: space(2), justifyContent: "center" }}>
                      <Muted style={{ color: REPORT.textMuted }}>{r.guardianPhone ?? STR.hwwdNoPhone}</Muted>
                    </View>
                    <View style={{ width: 150, padding: space(2), justifyContent: "center" }}>
                      {r.waLink ? (
                        <Button title={STR.hwwdWa} variant="secondary" onPress={() => openWa(r.waLink as string)} />
                      ) : (
                        <Muted style={{ color: REPORT.textMuted }}>{STR.hwwdNoPhone}</Muted>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
