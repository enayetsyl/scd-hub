/**
 * StudentRevisionHistoryScreen (SR-1) — one student's revision entries, newest-first,
 * with per-juz detail. Read-only. tracker:read re-gated + row-scoped server-side.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { STUDENT_REVISION_HISTORY_QUERY, type RevisionEntryT } from "../../graphql/revision";
import { Screen, Card, Body, Muted, Badge, Notice, Loader, EmptyState } from "../../components/ui";
import { STR, bnNum, revCategoryLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { RevisionStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RevisionStackParamList, "StudentRevisionHistory">;

/** Sum of the four structured mistake counts on one juz record. */
function juzMistakeTotal(r: RevisionEntryT["juzRecords"][number]): number {
  return r.mistakes.harf + r.mistakes.ghunnah + r.mistakes.madd + r.mistakes.other;
}

export default function StudentRevisionHistoryScreen({ route }: Props): React.ReactElement {
  const { studentId, studentName } = route.params;
  const [histQ] = useQuery({ query: STUDENT_REVISION_HISTORY_QUERY, variables: { studentId } });
  const entries = [...(histQ.data?.studentRevisionHistory ?? [])].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{studentName}</Body>
          <Muted>{STR.revHistoryTitle}</Muted>
        </Card>
        {histQ.fetching ? (
          <Loader label={STR.loading} />
        ) : histQ.error ? (
          <Notice message={friendlyError(histQ.error)} tone="danger" />
        ) : entries.length === 0 ? (
          <EmptyState message={STR.revNoHistory} />
        ) : (
          entries.map((e) => (
            <Card key={e.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700" }}>{bnNum(e.date)}</Body>
                <Badge text={e.present ? STR.revPresent : STR.revAbsent} tone={e.present ? "brand" : "muted"} />
              </View>
              {e.present
                ? e.juzRecords.map((r, i) => (
                    <View key={i} style={{ marginTop: space(2) }}>
                      <Body>
                        {revCategoryLabel(r.category)} · {STR.revJuz} {bnNum(r.juz)} · {bnNum(r.amountJuz)}
                      </Body>
                      <Muted>
                        {STR.revTanbih} {bnNum(r.tanbih)} · {STR.revFath} {bnNum(r.fath)} · {STR.revTotalMistakes}{" "}
                        {bnNum(juzMistakeTotal(r))}
                      </Muted>
                      {r.note ? <Muted>{r.note}</Muted> : null}
                    </View>
                  ))
                : null}
              {e.teacherComment ? (
                <Muted style={{ marginTop: space(2) }}>
                  {STR.revComment}: {e.teacherComment}
                </Muted>
              ) : null}
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
