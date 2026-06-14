/**
 * VocabClassReportScreen (VC-5 / J5) — the class dashboard (tracker:read): per-test
 * summaries + a class roll-up + the class most-missed words (≥X% of the class, §9).
 * Pick a program + section to scope it. All DERIVED server-side (D-#85/#44).
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "urql";
import { VOCAB_CLASS_DASHBOARD_QUERY } from "../../graphql/operations";
import { Screen, Card, Body, Muted, Badge, Loader } from "../../components/ui";
import { ProgramSelect, ClassSectionSelect, type SectionPick } from "../../components/vocabPickers";
import { AcademicYearSelect } from "../../components/selects";
import { STR, bnNum, vocabProgramLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";

export default function VocabClassReportScreen(): React.ReactElement {
  const [yearId, setYearId] = useState("");
  const [program, setProgram] = useState<string | null>(null);
  const [section, setSection] = useState<SectionPick | null>(null);

  const [dashQ] = useQuery({
    query: VOCAB_CLASS_DASHBOARD_QUERY,
    variables: { sectionId: section?.sectionId ?? "", program: program ?? null },
    pause: !section,
  });
  const dash = dashQ.data?.vocabClassDashboard ?? null;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.vbClassReportTitle}</Body>
          <AcademicYearSelect value={yearId} onChange={setYearId} />
          <ProgramSelect value={program} onChange={setProgram} />
          {yearId ? <ClassSectionSelect academicYearId={yearId} value={section} onChange={setSection} /> : null}
        </Card>

        {!section ? null : dashQ.fetching ? (
          <Loader label={STR.loading} />
        ) : dash ? (
          <>
            <Card>
              <Body style={{ fontWeight: "700" }}>{section.sectionName}</Body>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3), marginTop: space(2) }}>
                <Muted>
                  {STR.vbPresentCount}: {bnNum(dash.rollup.presentCount)}
                </Muted>
                <Muted>
                  {STR.vbAbsentCount}: {bnNum(dash.rollup.absentCount)}
                </Muted>
                <Muted>
                  {STR.vbAvgScore}: {bnNum(dash.rollup.averageScore)}/{bnNum(dash.rollup.averageTotal)}
                </Muted>
              </View>
            </Card>

            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.vbPerTest}</Body>
              {dash.tests.length === 0 ? (
                <Muted style={{ marginTop: space(2) }}>{STR.vbNoTests}</Muted>
              ) : (
                dash.tests.map((e) => (
                  <View key={e.test.testId} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}>
                    <View style={{ flexShrink: 1 }}>
                      <Body>
                        {vocabProgramLabel(e.test.program)} · {e.test.label}
                      </Body>
                      <Muted>{new Date(e.test.testDate).toLocaleDateString()}</Muted>
                    </View>
                    <Muted>
                      {STR.vbAvgScore}: {bnNum(e.rollup.averageScore)}/{bnNum(e.rollup.averageTotal)}
                    </Muted>
                  </View>
                ))
              )}
            </Card>

            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.vbMostMissed}</Body>
              {dash.mostMissed.length === 0 ? (
                <Muted style={{ marginTop: space(2) }}>{STR.empty}</Muted>
              ) : (
                dash.mostMissed.map((w) => (
                  <View key={w.wordId} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}>
                    <Body style={{ flexShrink: 1 }}>
                      {w.headword} — {w.banglaMeaning}
                    </Body>
                    <Badge
                      text={`${bnNum(w.missedBy)} (${bnNum(Math.round(w.missedPct * 100))}%)`}
                      tone={w.flagged ? "warn" : "muted"}
                    />
                  </View>
                ))
              )}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
