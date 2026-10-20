/**
 * MasteryHomeScreen (M-0) — every class × subject that has a learning-outcome catalogue,
 * with its draft / locked / retired counts, and the way into the catalogue, the mark
 * table, import, tags and policy (docs/prd-mastery.md §7, mock A1/A2).
 *
 * The FIRST screen of the stack and the only one without params (the RN initial-route trap).
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { MASTERY_COVERAGE_QUERY, type MasteryCoverageRow } from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Loader, EmptyState, Notice } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, masteryClassLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryHome">;

export default function MasteryHomeScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const canManage = can("mastery:manage");
  const [{ data, fetching, error }] = useQuery({ query: MASTERY_COVERAGE_QUERY, requestPolicy: "cache-and-network" });
  const rows = (data?.masteryCoverage ?? []) as MasteryCoverageRow[];

  return (
    <Screen scroll>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        {canManage ? <Button title={STR.msImport} onPress={() => navigation.navigate("MasteryImport")} /> : null}
        <Button title={STR.msTags} variant="secondary" onPress={() => navigation.navigate("MasteryTags")} />
        <Button title={STR.msPolicy} variant="secondary" onPress={() => navigation.navigate("MasteryPolicy")} />
      </View>

      {error ? <Notice message={friendlyError(error)} tone="danger" /> : null}
      {fetching && rows.length === 0 ? <Loader /> : null}
      {!fetching && !error && rows.length === 0 ? <EmptyState message={STR.msNoCoverage} /> : null}

      {rows.map((r) => (
        <Card key={`${r.classToken}:${r.subject}`}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
            <Body style={{ fontWeight: "700" }}>
              {masteryClassLabel(r.classToken)} · {hwSubjectLabel(r.subject)}
            </Body>
            <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap" }}>
              {r.draftCount > 0 ? <Badge text={`${STR.msDraft} ${bnNum(r.draftCount)}`} tone="gold" /> : null}
              {r.lockedCount > 0 ? <Badge text={`${STR.msLocked} ${bnNum(r.lockedCount)}`} tone="ok" /> : null}
              {r.retiredCount > 0 ? <Badge text={`${STR.msRetired} ${bnNum(r.retiredCount)}`} tone="muted" /> : null}
            </View>
          </View>
          <Muted>
            {STR.msQuestionTypes}: {bnNum(r.questionTypeCount)}
          </Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
            <Button
              title={STR.msOutcomes}
              variant="secondary"
              onPress={() => navigation.navigate("MasteryCatalogue", { classToken: r.classToken, subject: r.subject })}
            />
            <Button
              title={STR.msMarks}
              variant="secondary"
              onPress={() => navigation.navigate("MasteryMarks", { classToken: r.classToken, subject: r.subject })}
            />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
