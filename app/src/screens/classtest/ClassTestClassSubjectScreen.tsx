/**
 * ClassTestClassSubjectScreen (CT-5 / J6, §9) — per-student progression + trend ↑/↓/→
 * for one (section × subject): latest vs previous percent (ABSENT excluded). Tap a
 * student → their full cross-subject profile. tracker:read + the section read-scope
 * (enforced server-side via the section param).
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { CLASS_TEST_CLASS_SUBJECT_QUERY } from "../../graphql/classTest";
import { Screen, Card, Body, Muted, Button, Badge, Loader, Notice } from "../../components/ui";
import { STR, ctTrendGlyph, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ClassTestStackParamList, "ClassTestClassSubject">;
type Nav = NativeStackNavigationProp<ClassTestStackParamList>;

export default function ClassTestClassSubjectScreen({ route }: Props): React.ReactElement {
  const { sectionId, subject, title } = route.params;
  const nav = useNavigation<Nav>();
  const [q] = useQuery({ query: CLASS_TEST_CLASS_SUBJECT_QUERY, variables: { sectionId, subject } });
  const data = q.data?.classTestClassSubjectAnalysis ?? null;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{title}</Body>
          <Muted>{STR.ctExamsTaken}: {bnNum(data?.examCount ?? 0)}</Muted>
        </Card>

        {q.error ? (
          <Notice message={friendlyError(q.error)} tone="danger" />
        ) : q.fetching ? (
          <Loader label={STR.loading} />
        ) : !data || data.students.length === 0 ? (
          <Card>
            <Muted>{STR.ctNoReports}</Muted>
          </Card>
        ) : (
          data.students.map((s) => (
            <Card key={s.studentId}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flexShrink: 1 }}>
                  <Body style={{ fontWeight: "700" }}>{s.studentName}</Body>
                  <Muted>
                    {STR.ctLatest} {s.latestPercent == null ? "—" : `${bnNum(s.latestPercent)}%`} · {STR.ctPrevious}{" "}
                    {s.previousPercent == null ? "—" : `${bnNum(s.previousPercent)}%`} · {STR.ctExamsTaken}{" "}
                    {bnNum(s.examsTaken)}
                  </Muted>
                </View>
                <Badge
                  text={`${ctTrendGlyph(s.trend)} ${s.latestPercent == null ? "" : bnNum(s.latestPercent) + "%"}`}
                  tone={s.trend === "up" ? "ok" : s.trend === "down" ? "danger" : "muted"}
                />
              </View>
              {/* SP-3: this drill now lands on the FULL profile with the class-test
                  panel open — marks alone spot a problem a term late. The CT-only
                  screen stays registered for any deep link that still points at it. */}
              <View style={{ marginTop: space(2) }}>
                <Button
                  title={STR.ctViewProfile}
                  variant="ghost"
                  onPress={() =>
                    nav.navigate("StudentProfile", {
                      studentId: s.studentId,
                      studentName: s.studentName,
                      initialPanel: "classTest",
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
