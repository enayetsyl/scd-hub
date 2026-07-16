/**
 * AssignmentLoadReportScreen (D-#329) — Principal/Office oversight: assignments
 * PLANNED (rotation cells) vs GIVEN (delivered items, all weeks; issued of those),
 * broken down by subject and by teacher. Year selector + two tables.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "urql";
import { ACADEMIC_YEARS_QUERY, ASSIGNMENT_LOAD_REPORT, type AssignmentLoadRowT } from "../../graphql/operations";
import { Screen, Body, Muted, Card, Select, Loader, EmptyState } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { space, useColors } from "../../theme";

function Table({ title, rows, subjectLabels }: { title: string; rows: AssignmentLoadRowT[]; subjectLabels: boolean }): React.ReactElement {
  const colors = useColors();
  const cell = { flex: 1, textAlign: "center" as const };
  return (
    <Card>
      <Body style={{ fontWeight: "700", marginBottom: 6 }}>{title}</Body>
      <View style={{ flexDirection: "row", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Muted style={{ flex: 2 }}>{subjectLabels ? STR.subject : STR.asTeacher}</Muted>
        <Muted style={cell}>{STR.alPlanned}</Muted>
        <Muted style={cell}>{STR.alDelivered}</Muted>
        <Muted style={cell}>{STR.alIssued}</Muted>
      </View>
      {rows.length === 0 ? (
        <Muted style={{ marginTop: 6 }}>{STR.empty}</Muted>
      ) : (
        rows.map((r) => (
          <View key={r.key} style={{ flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Body style={{ flex: 2 }}>{subjectLabels ? hwSubjectLabel(r.key) : r.label}</Body>
            <Body style={cell}>{bnNum(r.planned)}</Body>
            <Body style={cell}>{bnNum(r.delivered)}</Body>
            <Body style={cell}>{bnNum(r.issued)}</Body>
          </View>
        ))
      )}
    </Card>
  );
}

export default function AssignmentLoadReportScreen(): React.ReactElement {
  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const years = yearsQ.data?.academicYears ?? [];
  const [pickedYearId, setPickedYearId] = useState<string | null>(null);
  const defaultYear = years.find((y) => y.current) ?? years[0];
  const yearId = pickedYearId ?? defaultYear?.id ?? "";

  const [q] = useQuery({ query: ASSIGNMENT_LOAD_REPORT, variables: { academicYearId: yearId }, pause: !yearId });
  const report = q.data?.assignmentLoadReport ?? null;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.alReportTitle}</Body>
          <Muted>{STR.alReportSub}</Muted>
          <Select
            label={STR.asAcademicYear}
            value={yearId || null}
            options={years.map((y) => ({ label: y.current ? `${y.label} (${STR.asCurrentYear})` : y.label, value: y.id }))}
            onChange={(v) => setPickedYearId(v)}
            placeholder={STR.asAcademicYear}
          />
        </Card>

        {q.fetching && !report ? (
          <Loader label={STR.loading} />
        ) : !report ? (
          <EmptyState message={STR.empty} />
        ) : (
          <>
            <Table title={STR.alBySubject} rows={report.bySubject} subjectLabels />
            <Table title={STR.alByTeacher} rows={report.byTeacher} subjectLabels={false} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
