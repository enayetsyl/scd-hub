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
import { MY_VOCAB_ASSIGNMENTS_PAGE_QUERY } from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { Pager } from "../../components/Pager";
import { usePageState, PAGE_SIZE } from "../../lib/paging";
import { useAuth } from "../../auth/AuthContext";
import { STR, vocabProgramLabel, isoDateLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { VocabStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<VocabStackParamList>;

export default function VocabHomeScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const { role, can } = useAuth();
  const canAssign = can("vocab_test:assign");
  // Owner rule (2026-10-25): a link shows only when its screen opens — the word bank,
  // tests, class report and the caller's own duty list all read on vocab_test:view.
  const canView = can("vocab_test:view");
  // D-#761: one duty row per week, forever — page it on the server (newest week first).
  const [page, setPage] = usePageState();
  const [myQ, refetchMy] = useQuery({
    query: MY_VOCAB_ASSIGNMENTS_PAGE_QUERY,
    variables: { page, pageSize: PAGE_SIZE },
    pause: !canView,
  });
  const mine = myQ.data?.myVocabAssignmentsPage?.rows ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.vbHomeTitle}</Body>
          <View style={{ marginTop: space(2), gap: space(2) }}>
            {canView ? (
              <>
                <Button title={STR.vbWordBank} onPress={() => nav.navigate("VocabWordBank")} />
                <Button title={STR.vbTests} variant="secondary" onPress={() => nav.navigate("VocabTests")} />
                <Button title={STR.vbClassReportNav} variant="secondary" onPress={() => nav.navigate("VocabClassReport")} />
              </>
            ) : null}
            {canAssign ? (
              <Button title={STR.vbAssignmentNav} variant="secondary" onPress={() => nav.navigate("VocabAssignment")} />
            ) : null}
          </View>
        </Card>

        {canView ? (
          <Card>
          <Body style={{ fontWeight: "700" }}>{STR.vbMyAssignments}</Body>
          <QueryGate
            result={myQ}
            onRetry={() => refetchMy({ requestPolicy: "network-only" })}
            loaderLabel={STR.loading}
          >
            {mine.length === 0 ? (
              <Muted style={{ marginTop: space(2) }}>{STR.vbNoMyAssignments}</Muted>
            ) : (
              mine.map((a) => (
                <View key={a.id} style={{ marginTop: space(2) }}>
                  <Body>{vocabProgramLabel(a.program)}</Body>
                  <Muted>
                    {STR.vbWeekOf}: {isoDateLabel(a.weekOf)}
                  </Muted>
                </View>
              ))
            )}
            <Pager page={page} pageSize={PAGE_SIZE} total={myQ.data?.myVocabAssignmentsPage?.total ?? 0} onPage={setPage} />
          </QueryGate>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
