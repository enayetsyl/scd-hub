/**
 * ClassTestHomeScreen (CT-5) — the Class Test tab hub. Role-aware quick links +
 * the caller's own class tests (myClassTests). Every action is re-gated server-side;
 * links the role can't perform are hidden (the server stays the gate — its Bangla
 * deny still surfaces if reached).
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { MY_CLASS_TESTS_QUERY } from "../../graphql/classTest";
import { Screen, Card, Body, Muted, Button, Badge } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { STR, hwSubjectLabel, classTestStatusLabel, bnNum, isoDateLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList, TabParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ClassTestStackParamList>;

export default function ClassTestHomeScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  // PQ-5: the print queue is a sibling TAB now, not a screen in this stack.
  const tabNav = useNavigation<NavigationProp<TabParamList>>();
  const { role, can } = useAuth();
  const canWrite = can("tracker:write");
  const canPrint = can("roster:manage");
  const isAdmin = role === "PRINCIPAL" || role === "OFFICE";

  const [myQ, refetchMy] = useQuery({ query: MY_CLASS_TESTS_QUERY, variables: {} });
  const mine = myQ.data?.myClassTests ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.ctHomeTitle}</Body>
          <View style={{ marginTop: space(2), gap: space(2) }}>
            {/* D-#339: Principal/Office also reach the form — the no-print register
                (server-gated: admin bypasses tracker:write there). */}
            {canWrite || isAdmin ? <Button title={STR.ctRequestNav} onPress={() => nav.navigate("RequestClassTest")} /> : null}
            {/* Owner ask 2026-07-20: office-produced question papers — teacher side + office queue. */}
            {canWrite ? (
              <Button title={STR.cqMyNav} variant="secondary" onPress={() => nav.navigate("MyCtQuestions")} />
            ) : null}
            {canPrint ? (
              <Button title={STR.cqQueueNav} variant="secondary" onPress={() => nav.navigate("CtQuestionQueue")} />
            ) : null}
            {/* PQ-5 (D-#281): class-test printing lives on the ONE print queue now. */}
            {canPrint ? (
              <Button
                title={STR.ctPrintQueueNav}
                variant="secondary"
                onPress={() => tabNav.navigate("PrintTab", { screen: "PrintHome" })}
              />
            ) : null}
            <Button title={STR.ctReportsNav} variant="secondary" onPress={() => nav.navigate("ClassTestReports")} />
            {isAdmin ? (
              <Button title={STR.ctDashboardNav} variant="secondary" onPress={() => nav.navigate("ClassTestDashboard")} />
            ) : null}
          </View>
        </Card>

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.ctMyTests}</Body>
          <QueryGate
            result={myQ}
            onRetry={() => refetchMy({ requestPolicy: "network-only" })}
            loaderLabel={STR.loading}
          >
          {mine.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.ctNoMyTests}</Muted>
          ) : (
            mine.map((t) => (
              <View key={t.id} style={{ marginTop: space(3) }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body style={{ fontWeight: "700" }}>
                      {hwSubjectLabel(t.subject)} · {STR.ctTestNumber} {bnNum(t.testNumber)}
                    </Body>
                    <Muted>
                      {t.ctId} · {isoDateLabel(t.examDate)}
                    </Muted>
                  </View>
                  <Badge
                    text={classTestStatusLabel(t.status)}
                    tone={t.status === "PRINTED" ? "ok" : t.status === "CANCELLED" ? "muted" : "brand"}
                  />
                </View>
                {t.status === "PRINTED" ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                    <Button
                      title={STR.ctViewResults}
                      variant="secondary"
                      onPress={() =>
                        nav.navigate("ClassTestResultsView", {
                          testId: t.id,
                          title: `${hwSubjectLabel(t.subject)} · ${STR.ctTestNumber} ${bnNum(t.testNumber)}`,
                        })
                      }
                    />
                    {canWrite ? (
                      <Button
                        title={STR.ctResultsTitle}
                        variant="secondary"
                        onPress={() =>
                          nav.navigate("ClassTestResults", {
                            testId: t.id,
                            title: `${hwSubjectLabel(t.subject)} · ${STR.ctTestNumber} ${bnNum(t.testNumber)}`,
                          })
                        }
                      />
                    ) : null}
                    {canWrite ? (
                      <Button
                        title={STR.ctPublishTitle}
                        variant="ghost"
                        onPress={() =>
                          nav.navigate("ClassTestPublish", {
                            testId: t.id,
                            title: `${hwSubjectLabel(t.subject)} · ${STR.ctTestNumber} ${bnNum(t.testNumber)}`,
                          })
                        }
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            ))
          )}
          </QueryGate>
        </Card>
      </ScrollView>
    </Screen>
  );
}
