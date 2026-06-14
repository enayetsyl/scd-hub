/**
 * VocabHomeScreen (VC-5) — the Vocabulary tab hub. Quick links to the word bank,
 * tests, weekly-tester assignment (admin), and the class report, plus the caller's
 * own weekly tester duty (myVocabAssignments). Every action is re-gated server-side;
 * admin-only links are hidden where the role can't perform them (let the server be
 * the gate, surface its Bangla deny).
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { roleHasPermission } from "@scd/shared";
import { MY_VOCAB_ASSIGNMENTS_QUERY } from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Loader } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { STR, vocabProgramLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { VocabStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<VocabStackParamList>;

export default function VocabHomeScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const { role } = useAuth();
  const canAssign = !!role && roleHasPermission(role, "roster:manage");
  const [myQ] = useQuery({ query: MY_VOCAB_ASSIGNMENTS_QUERY, variables: {} });
  const mine = myQ.data?.myVocabAssignments ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.vbHomeTitle}</Body>
          <View style={{ marginTop: space(2), gap: space(2) }}>
            <Button title={STR.vbWordBank} onPress={() => nav.navigate("VocabWordBank")} />
            <Button title={STR.vbTests} variant="secondary" onPress={() => nav.navigate("VocabTests")} />
            <Button title={STR.vbClassReportNav} variant="secondary" onPress={() => nav.navigate("VocabClassReport")} />
            {canAssign ? (
              <Button title={STR.vbAssignmentNav} variant="secondary" onPress={() => nav.navigate("VocabAssignment")} />
            ) : null}
          </View>
        </Card>

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.vbMyAssignments}</Body>
          {myQ.fetching ? (
            <Loader label={STR.loading} />
          ) : mine.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.vbNoMyAssignments}</Muted>
          ) : (
            mine.map((a) => (
              <View key={a.id} style={{ marginTop: space(2) }}>
                <Body>{vocabProgramLabel(a.program)}</Body>
                <Muted>
                  {STR.vbWeekOf}: {new Date(a.weekOf).toLocaleDateString()}
                </Muted>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
