/**
 * VocabTestsScreen (VC-5) — browse a (section × program)'s tests (tracker:read) and
 * jump to build / mark / report / messages. "New test" opens BuildVocabTest. Marking
 * + building are re-gated server-side (the assigned/covering tester); the buttons are
 * shown and the Bangla deny surfaces on the target screen if the caller can't act.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { VOCAB_TESTS_QUERY } from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Badge, Chip, Loader } from "../../components/ui";
import { ProgramSelect, ClassSectionSelect, type SectionPick } from "../../components/vocabPickers";
import { AcademicYearSelect } from "../../components/selects";
import { STR, vocabProgramLabel, vocabTestStatusLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { VocabStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<VocabStackParamList>;

export default function VocabTestsScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const [yearId, setYearId] = useState("");
  const [program, setProgram] = useState<string | null>(null);
  const [section, setSection] = useState<SectionPick | null>(null);

  const [testsQ] = useQuery({
    query: VOCAB_TESTS_QUERY,
    variables: { sectionId: section?.sectionId ?? null, program: program ?? null },
    pause: !section,
  });
  const tests = testsQ.data?.vocabTests ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.vbTests}</Body>
          <AcademicYearSelect value={yearId} onChange={setYearId} />
          <ProgramSelect value={program} onChange={setProgram} />
          {yearId ? <ClassSectionSelect academicYearId={yearId} value={section} onChange={setSection} /> : null}
          <View style={{ marginTop: space(2) }}>
            <Button title={STR.vbNewTest} onPress={() => nav.navigate("BuildVocabTest")} />
          </View>
        </Card>

        {section ? (
          <Card>
            {testsQ.fetching ? (
              <Loader label={STR.loading} />
            ) : tests.length === 0 ? (
              <Muted>{STR.vbNoTests}</Muted>
            ) : (
              tests.map((tst) => {
                const title = `${vocabProgramLabel(tst.program)} · ${tst.label}`;
                return (
                  <View key={tst.id} style={{ marginTop: space(3) }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <View style={{ flexShrink: 1 }}>
                        <Body style={{ fontWeight: "700" }}>{title}</Body>
                        <Muted>{new Date(tst.testDate).toLocaleDateString()}</Muted>
                      </View>
                      <Badge text={vocabTestStatusLabel(tst.status)} tone={tst.status === "marked" ? "ok" : "muted"} />
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                      <Chip label={STR.vbMark} onPress={() => nav.navigate("VocabMarkGrid", { testId: tst.id, title })} />
                      <Chip label={STR.vbReport} onPress={() => nav.navigate("VocabReport", { testId: tst.id, title })} />
                      <Chip label={STR.vbMessages} onPress={() => nav.navigate("VocabMessages", { testId: tst.id, title })} />
                    </View>
                  </View>
                );
              })
            )}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
