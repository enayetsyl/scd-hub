/**
 * ClassTestReportsScreen (CT-5 / J5/J6, tracker:read) — Reports Status for a chosen
 * scope: pick year → class/section (+ optional subject) → the per-exam status list
 * (submitted/pending/overdue + school-days late + state). Tap a row → its results;
 * with a subject chosen, open the Class×Subject analysis. A teacher is scoped to a
 * section they can read (server gate); Principal/Office are unscoped.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { HW_SUBJECTS } from "@scd/shared";
import { CLASS_TEST_REPORTS_STATUS_QUERY } from "../../graphql/classTest";
import { Screen, Card, Body, Muted, Button, Badge, Select, Loader, Notice } from "../../components/ui";
import { ClassSectionSelect, type SectionPick } from "../../components/vocabPickers";
import { AcademicYearSelect } from "../../components/selects";
import { STR, hwSubjectLabel, ctReportStateLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ClassTestStackParamList>;

const stateTone = (s: string): "ok" | "danger" | "brand" | "muted" =>
  s === "complete" ? "ok" : s === "overdue" ? "danger" : s === "in_progress" ? "brand" : "muted";

export default function ClassTestReportsScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const [yearId, setYearId] = useState("");
  const [section, setSection] = useState<SectionPick | null>(null);
  const [subject, setSubject] = useState<string | null>(null);

  const [rowsQ] = useQuery({
    query: CLASS_TEST_REPORTS_STATUS_QUERY,
    variables: { sectionId: section?.sectionId ?? null, subject: subject ?? null },
    pause: !section,
  });
  const rows = rowsQ.data?.classTestReportsStatus ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.ctReportsStatusNav}</Body>
          <AcademicYearSelect value={yearId} onChange={setYearId} />
          {yearId ? <ClassSectionSelect academicYearId={yearId} value={section} onChange={setSection} /> : null}
          <Select
            label={STR.ctSubject}
            value={subject}
            options={(HW_SUBJECTS as readonly string[]).map((s) => ({ label: hwSubjectLabel(s), value: s }))}
            onChange={setSubject}
            placeholder={STR.ctPickSubject}
          />
          {section && subject ? (
            <View style={{ marginTop: space(2) }}>
              <Button
                title={STR.ctClassSubjectNav}
                variant="secondary"
                onPress={() =>
                  nav.navigate("ClassTestClassSubject", {
                    sectionId: section.sectionId,
                    classId: section.classId,
                    subject,
                    title: `${section.sectionName} · ${hwSubjectLabel(subject)}`,
                  })
                }
              />
            </View>
          ) : null}
        </Card>

        {!section ? (
          <Card>
            <Muted>{STR.ctPickSubjectFirst}</Muted>
          </Card>
        ) : rowsQ.error ? (
          <Notice message={friendlyError(rowsQ.error)} tone="danger" />
        ) : rowsQ.fetching ? (
          <Loader label={STR.loading} />
        ) : rows.length === 0 ? (
          <Card>
            <Muted>{STR.ctNoReports}</Muted>
          </Card>
        ) : (
          rows.map((r) => (
            <Card key={r.testId}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flexShrink: 1 }}>
                  <Body style={{ fontWeight: "700" }}>
                    {hwSubjectLabel(r.subject)} · {STR.ctTestNumber} {bnNum(r.testNumber)}
                  </Body>
                  <Muted>
                    {r.ctId} · {new Date(r.examDate).toLocaleDateString()}
                  </Muted>
                </View>
                <Badge text={ctReportStateLabel(r.state)} tone={stateTone(r.state)} />
              </View>
              <Muted style={{ marginTop: space(1) }}>
                {STR.ctEntered} {bnNum(r.enteredCount)}/{bnNum(r.rosterCount)} · {STR.ctPending} {bnNum(r.pendingCount)}
                {r.overdue ? ` · ${STR.ctSchoolDaysLate} ${bnNum(r.schoolDaysLate)}` : ""}
              </Muted>
              <View style={{ marginTop: space(2) }}>
                <Button
                  title={STR.ctResultsTitle}
                  variant="ghost"
                  onPress={() =>
                    nav.navigate("ClassTestResults", {
                      testId: r.testId,
                      title: `${hwSubjectLabel(r.subject)} · ${STR.ctTestNumber} ${bnNum(r.testNumber)}`,
                    })
                  }
                />
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
