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
import { Screen, Card, Body, Muted, Button, Badge, Chip, ChipRow, Select, Loader, Notice } from "../../components/ui";
import { ClassSectionSelect, type SectionPick } from "../../components/vocabPickers";
import { AcademicYearSelect } from "../../components/selects";
import { STR, hwSubjectLabel, ctReportStateLabel, bnNum, isoDateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ClassTestStackParamList>;

const stateTone = (s: string): "ok" | "danger" | "brand" | "muted" =>
  s === "complete" ? "ok" : s === "overdue" ? "danger" : s === "in_progress" ? "brand" : "muted";

/** Entry-state chips (the sibling ClassTestReportScreen pattern) + the publish axis. */
const STATES = ["complete", "in_progress", "not_started", "overdue"] as const;
const PUBLISH_FILTERS = ["submitted", "published", "unpublished"] as const;

type RowLike = { state: string; submittedAt: string | null; publishedAt: string | null };
/** One predicate per chip — the publish axis rides submittedAt/publishedAt, not `state`. */
const matchesFilter = (r: RowLike, f: string): boolean =>
  f === "" ? true
  : f === "submitted" ? !!r.submittedAt
  : f === "published" ? !!r.publishedAt
  : f === "unpublished" ? !!r.submittedAt && !r.publishedAt
  : r.state === f;

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
  const allRows = rowsQ.data?.classTestReportsStatus ?? [];

  // Status filter chips (owner ask 2026-07-21): entry state + the publish axis.
  const [filter, setFilter] = useState<string>("");
  const rows = allRows.filter((r) => matchesFilter(r, filter));
  const countOf = (f: string): number => allRows.filter((r) => matchesFilter(r, f)).length;
  const filterLabel = (f: string): string =>
    f === "submitted" ? STR.ctFilterSubmitted
    : f === "published" ? STR.ctPublishedBadge
    : f === "unpublished" ? STR.ctUnpublishedBadge
    : ctReportStateLabel(f);

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

        {section && allRows.length > 0 ? (
          <Card>
            <ChipRow>
              <Chip
                label={`${STR.all} (${bnNum(allRows.length)})`}
                selected={filter === ""}
                onPress={() => setFilter("")}
              />
              {[...STATES, ...PUBLISH_FILTERS].map((f) => (
                <Chip
                  key={f}
                  label={`${filterLabel(f)} (${bnNum(countOf(f))})`}
                  selected={filter === f}
                  onPress={() => setFilter(filter === f ? "" : f)}
                />
              ))}
            </ChipRow>
          </Card>
        ) : null}

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
                    {r.ctId} · {isoDateLabel(r.examDate)}
                  </Muted>
                </View>
                {/* Published is the terminal state past complete — surface it as its own
                    badge (owner ask) so a released exam is distinct from a merely-complete one. */}
                <Badge
                  text={r.publishedAt ? STR.ctPublishedBadge : ctReportStateLabel(r.state)}
                  tone={r.publishedAt ? "ok" : stateTone(r.state)}
                />
              </View>
              <Muted style={{ marginTop: space(1) }}>
                {STR.ctEntered} {bnNum(r.enteredCount)}/{bnNum(r.rosterCount)} · {STR.ctPending} {bnNum(r.pendingCount)}
                {r.overdue ? ` · ${STR.ctSchoolDaysLate} ${bnNum(r.schoolDaysLate)}` : ""}
                {r.publishedAt ? ` · ${STR.ctPublishedBadge}` : r.submittedAt ? ` · ${STR.ctFilterSubmitted}` : ""}
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
