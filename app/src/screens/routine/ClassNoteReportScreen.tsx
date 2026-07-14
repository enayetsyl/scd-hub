/**
 * ClassNoteReportScreen (R-5 admin view) - Principal/Office roll-up for a date:
 * table-style submission grid with posted vs pending subjects, matching the
 * school admin reports feel from the reference screenshot.
 */
import React, { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { CLASS_NOTE_SUBMISSION_REPORT_QUERY, type ClassNoteSubmissionRowT } from "../../graphql/operations";
import type { RoutineStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Notice, Loader, Button, Select } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR, bnNum, routineSubjectLabel, getActiveLang, classLevelLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { dateKey } from "../../lib/dates";

const todayISO = (): string => dateKey();
const entryOptions = [
  { label: "10", value: "10" },
  { label: "25", value: "25" },
  { label: "50", value: "50" },
  { label: "100", value: "100" },
  { label: STR.all, value: "all" },
] as const;

type Props = NativeStackScreenProps<RoutineStackParamList, "ClassNoteReport">;
type EntryLimit = (typeof entryOptions)[number]["value"];

function rowTitle(row: ClassNoteSubmissionRowT): string {
  const lang = getActiveLang();
  if (lang === "en" && row.classLevel != null) return classLevelLabel(row.classLevel);
  return row.classNameBn ?? row.subjectGroupNameBn ?? STR.rtClassNote;
}

function rowSubtitle(row: ClassNoteSubmissionRowT): string | null {
  const lang = getActiveLang();
  return lang === "en" ? row.sectionCode ?? row.sectionNameBn ?? null : row.sectionNameBn ?? null;
}

function csvCell(value: string | number | null | undefined): string {
  const raw = value == null ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, header: string[], rows: string[][]): void {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\ufeff", body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function SubjectList({
  subjects,
  emptyLabel,
  tone,
}: {
  subjects: string[];
  emptyLabel: string;
  tone: "ok" | "warn";
}): React.ReactElement {
  if (subjects.length === 0) return <Muted>{emptyLabel}</Muted>;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
      {subjects.map((subject, index) => (
        <Badge key={`${subject}-${index}`} text={subject} tone={tone} />
      ))}
    </View>
  );
}

function SubjectCell({
  count,
  subjects,
  emptyLabel,
  tone,
}: {
  count: number;
  subjects: string[];
  emptyLabel: string;
  tone: "ok" | "warn";
}): React.ReactElement {
  return (
    <View style={{ gap: space(1) }}>
      <Badge text={`${tone === "ok" ? "✓" : "✗"} ${bnNum(count)}`} tone={tone} />
      <SubjectList subjects={subjects} emptyLabel={emptyLabel} tone={tone} />
    </View>
  );
}

export default function ClassNoteReportScreen({ navigation, route }: Props): React.ReactElement {
  const [date, setDate] = useState(route.params?.date ?? todayISO());
  const [reportQ] = useQuery({ query: CLASS_NOTE_SUBMISSION_REPORT_QUERY, variables: { date } });
  const [entryLimit, setEntryLimit] = useState<EntryLimit>("10");
  const [showTeacherMeta, setShowTeacherMeta] = useState(true);
  // Filters (all "" = no filter). Built client-side from the loaded rows.
  const [filterClass, setFilterClass] = useState<string>("");
  const [filterTeacher, setFilterTeacher] = useState<string>("");
  const [filterPosted, setFilterPosted] = useState<string>("");
  const [filterPending, setFilterPending] = useState<string>("");

  const rows = reportQ.data?.classNoteSubmissionReport ?? [];

  const allLabel = STR.all;
  const uniqSorted = (xs: string[]): string[] => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b));

  // Option lists derived from every loaded row (not the filtered subset).
  const classOptions = useMemo(
    () => [{ label: allLabel, value: "" }, ...uniqSorted(rows.map(rowTitle)).map((c) => ({ label: c, value: c }))],
    [rows, allLabel],
  );
  const teacherOptions = useMemo(
    () => [
      { label: allLabel, value: "" },
      ...uniqSorted(rows.map((r) => r.teacherName ?? "")).map((t) => ({ label: t, value: t })),
    ],
    [rows, allLabel],
  );
  const postedOptions = useMemo(
    () => [
      { label: allLabel, value: "" },
      ...uniqSorted(rows.flatMap((r) => r.publishedSubjects)).map((s) => ({ label: routineSubjectLabel(s), value: s })),
    ],
    [rows, allLabel],
  );
  const pendingOptions = useMemo(
    () => [
      { label: allLabel, value: "" },
      ...uniqSorted(rows.flatMap((r) => r.pendingSubjects)).map((s) => ({ label: routineSubjectLabel(s), value: s })),
    ],
    [rows, allLabel],
  );

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          (filterClass === "" || rowTitle(r) === filterClass) &&
          (filterTeacher === "" || (r.teacherName ?? "") === filterTeacher) &&
          (filterPosted === "" || r.publishedSubjects.includes(filterPosted)) &&
          (filterPending === "" || r.pendingSubjects.includes(filterPending)),
      ),
    [rows, filterClass, filterTeacher, filterPosted, filterPending],
  );

  const pendingTotal = filteredRows.reduce((sum, row) => sum + row.pendingCount, 0);
  const postedTotal = filteredRows.reduce((sum, row) => sum + row.publishedCount, 0);
  const visibleRows = entryLimit === "all" ? filteredRows : filteredRows.slice(0, Number(entryLimit));
  const canExport = Platform.OS === "web";
  const showTeacherColumns = showTeacherMeta;

  const columns: { key: string; label: string; width: number; align?: "center" | "left" | "right" }[] = [
    { key: "sl", label: "SL", width: 56, align: "center" as const },
    { key: "class", label: STR.rtClassGroup, width: 180 },
    { key: "section", label: STR.rtTableSection, width: 140 },
    ...(showTeacherColumns
      ? [
          { key: "teacherId", label: STR.rtTableTeacherId, width: 132 },
          { key: "teacherName", label: STR.rtNoteTeacher, width: 180 },
          { key: "contact", label: STR.rtTableSmsContact, width: 160 },
        ]
      : []),
    { key: "posted", label: STR.rtPostedSubjects, width: 260 },
    { key: "pending", label: STR.rtPendingSubjects, width: 260 },
  ] as const;
  const tableWidth = columns.reduce((sum, col) => sum + col.width, 0);

  function onPrint(): void {
    if (!canExport) return;
    window.print();
  }

  function onExcel(): void {
    if (!canExport) return;
    const header = [
      "SL",
      STR.rtClassGroup,
      STR.rtTableSection,
      ...(showTeacherColumns ? [STR.rtTableTeacherId, STR.rtNoteTeacher, STR.rtTableSmsContact] : []),
      STR.rtPostedSubjects,
      STR.rtPendingSubjects,
    ];
    const data = filteredRows.map((row, index) => [
      bnNum(index + 1),
      rowTitle(row),
      row.sectionCode ?? row.sectionNameBn ?? "—",
      ...(showTeacherColumns ? [row.teacherSchoolId ?? "—", row.teacherName ?? "—", row.teacherPhone ?? "—"] : []),
      row.publishedSubjects.map((subject) => routineSubjectLabel(subject)).join(" | ") || STR.rtNoPostedSubjects,
      row.pendingSubjects.map((subject) => routineSubjectLabel(subject)).join(" | ") || STR.rtNoPendingSubjects,
    ]);
    downloadCsv(`class-note-submissions-${date}.csv`, header, data);
  }

  function onReset(): void {
    setDate(todayISO());
    setEntryLimit("10");
    setShowTeacherMeta(true);
    setFilterClass("");
    setFilterTeacher("");
    setFilterPosted("");
    setFilterPending("");
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.rtNoteReportTitle}</Body>
          <Muted>{STR.rtNoteReportHint}</Muted>
          <DateField label={STR.attDate} value={date} onChange={setDate} />

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
            <Badge text={`${STR.rtPostedSubjects}: ${bnNum(postedTotal)}`} tone="ok" />
            <Badge text={`${STR.rtPendingSubjects}: ${bnNum(pendingTotal)}`} tone={pendingTotal > 0 ? "warn" : "ok"} />
            <Badge text={`${STR.rtTableShowing} ${bnNum(visibleRows.length)} ${STR.rtTableOf} ${bnNum(filteredRows.length)}`} tone="muted" />
          </View>

          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: space(2),
              marginTop: space(3),
              alignItems: "flex-end",
              justifyContent: "space-between",
            }}
          >
            <View style={{ minWidth: 180, flexGrow: 1 }}>
              <Select label={STR.rtShowEntries} value={entryLimit} options={[...entryOptions]} onChange={setEntryLimit} />
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), justifyContent: "flex-end" }}>
              <Button title={STR.rtTablePrint} variant="secondary" onPress={onPrint} disabled={!canExport} />
              <Button title={STR.rtTablePdf} variant="secondary" onPress={onPrint} disabled={!canExport} />
              <Button title={STR.rtTableExcel} variant="secondary" onPress={onExcel} disabled={!canExport} />
              <Button title={STR.rtTableColumns} variant={showTeacherColumns ? "primary" : "secondary"} onPress={() => setShowTeacherMeta((v) => !v)} />
              <Button title={STR.rtTableReset} variant="ghost" onPress={onReset} />
            </View>
          </View>

          {/* Filters — class / teacher / posted subject / pending subject (client-side). */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(3) }}>
            <View style={{ minWidth: 180, flexGrow: 1 }}>
              <Select label={STR.rtClassGroup} value={filterClass} options={classOptions} onChange={setFilterClass} />
            </View>
            <View style={{ minWidth: 180, flexGrow: 1 }}>
              <Select label={STR.rtNoteTeacher} value={filterTeacher} options={teacherOptions} onChange={setFilterTeacher} />
            </View>
            <View style={{ minWidth: 180, flexGrow: 1 }}>
              <Select label={STR.rtPostedSubjects} value={filterPosted} options={postedOptions} onChange={setFilterPosted} />
            </View>
            <View style={{ minWidth: 180, flexGrow: 1 }}>
              <Select label={STR.rtPendingSubjects} value={filterPending} options={pendingOptions} onChange={setFilterPending} />
            </View>
          </View>
        </Card>

        {reportQ.error ? <Notice message={friendlyError(reportQ.error)} tone="danger" /> : null}
        {reportQ.fetching ? <Loader label={STR.loading} /> : null}
        {filteredRows.length === 0 && !reportQ.fetching ? (
          <Notice message={rows.length === 0 ? STR.rtNoteReportEmpty : STR.empty} tone="ok" />
        ) : null}

        {filteredRows.length > 0 ? (
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View style={{ minWidth: tableWidth }}>
                <View style={{ flexDirection: "row", backgroundColor: "#4f9cf9" }}>
                  {columns.map((col) => (
                    <View
                      key={col.key}
                      style={{
                        width: col.width,
                        paddingVertical: space(2),
                        paddingHorizontal: space(2),
                        justifyContent: "center",
                        alignItems: col.align === "center" ? "center" : col.align === "right" ? "flex-end" : "flex-start",
                        borderRightWidth: 1,
                        borderRightColor: "rgba(255,255,255,0.18)",
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }} numberOfLines={1}>
                        {col.label}
                        <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 11 }}>  ▲▼</Text>
                      </Text>
                    </View>
                  ))}
                </View>

                {visibleRows.map((row, index) => {
                  const primary = rowTitle(row);
                  const secondary = rowSubtitle(row);
                  const title = secondary ? `${primary} · ${secondary}` : primary;
                  return (
                    <Pressable
                      key={`${row.groupType}:${row.groupId}:${row.teacherId ?? "none"}:${index}`}
                      onPress={() =>
                        navigation.navigate("DailyNote", {
                          groupType: row.groupType,
                          groupId: row.groupId,
                          title,
                          date,
                        })
                      }
                      style={({ pressed }) => [
                        {
                          flexDirection: "row",
                          backgroundColor: index % 2 === 0 ? "#eef5ff" : "#fff",
                          borderBottomWidth: 1,
                          borderBottomColor: "#dde7f5",
                        },
                        pressed ? { backgroundColor: "#dbeafe" } : null,
                      ]}
                    >
                      <View style={{ width: 56, padding: space(2), justifyContent: "center" }}>
                        <Text style={{ fontWeight: "700" }}>{bnNum(index + 1)}</Text>
                      </View>
                      <View style={{ width: 180, padding: space(2), justifyContent: "center" }}>
                        <Body style={{ fontWeight: "700" }}>{primary}</Body>
                      </View>
                      <View style={{ width: 140, padding: space(2), justifyContent: "center" }}>
                        <Muted>{secondary ?? "—"}</Muted>
                      </View>
                      {showTeacherColumns ? (
                        <>
                          <View style={{ width: 132, padding: space(2), justifyContent: "center" }}>
                            <Body style={{ fontWeight: "700" }}>{row.teacherSchoolId ?? "—"}</Body>
                          </View>
                          <View style={{ width: 180, padding: space(2), justifyContent: "center" }}>
                            <Body style={{ fontWeight: "700" }}>
                              {row.teacherName ?? "—"}
                            </Body>
                            <Muted>{row.teacherPhone ?? "—"}</Muted>
                          </View>
                          <View style={{ width: 160, padding: space(2), justifyContent: "center" }}>
                            <Muted>{row.teacherPhone ?? "—"}</Muted>
                          </View>
                        </>
                      ) : null}
                      <View style={{ width: 260, padding: space(2), justifyContent: "center" }}>
                        <SubjectCell
                          count={row.publishedCount}
                          subjects={row.publishedSubjects.map((subject) => routineSubjectLabel(subject))}
                          emptyLabel={STR.rtNoPostedSubjects}
                          tone="ok"
                        />
                      </View>
                      <View style={{ width: 260, padding: space(2), justifyContent: "center" }}>
                        <SubjectCell
                          count={row.pendingCount}
                          subjects={row.pendingSubjects.map((subject) => routineSubjectLabel(subject))}
                          emptyLabel={STR.rtNoPendingSubjects}
                          tone="warn"
                        />
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
