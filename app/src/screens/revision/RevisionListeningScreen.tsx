/**
 * RevisionListeningScreen (SR-6, D-#1172) — the listener's own students for a Saturday:
 * progress, then one row per student (বাকি / শোনা হয়েছে / অনুপস্থিত / পাঠানো হয়েছে) that
 * opens the marking screen. Shows the week's target per level above the list.
 */
import React, { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { MY_REVISION_LISTENING_QUERY, type RevisionListeningRowT } from "../../graphql/revision";
import { Screen, Card, Body, Muted, Badge, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { DateField } from "../../components/DateField";
import { STR, bnNum, hifzLevelLabel, revCategoryLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { RevisionStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RevisionStackParamList, "RevisionListening">;
type Nav = NativeStackNavigationProp<RevisionStackParamList>;

function rowState(r: RevisionListeningRowT): { text: string; tone: "brand" | "muted" | "warn" } {
  if (!r.entry) return { text: STR.revListenPending, tone: "warn" };
  if (r.entry.deliveredAt) return { text: STR.revListenSent, tone: "muted" };
  if (!r.entry.present) return { text: STR.revAbsent, tone: "muted" };
  return { text: STR.revListenDone, tone: "brand" };
}

export default function RevisionListeningScreen({ route }: Props): React.ReactElement {
  const nav = useNavigation<Nav>();
  const [date, setDate] = useState(route.params.date);
  const [q, refetch] = useQuery({ query: MY_REVISION_LISTENING_QUERY, variables: { date }, requestPolicy: "cache-and-network" });
  // Back from the marking screen → show its save.
  useFocusEffect(
    React.useCallback(() => {
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );
  const rows = q.data?.myRevisionListening ?? [];
  const done = rows.filter((r) => r.entry).length;

  // One target line per level among my students.
  const targets = new Map<string, RevisionListeningRowT["target"]>();
  for (const r of rows) if (!targets.has(r.level)) targets.set(r.level, r.target);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.revListenTitle}</Body>
          <DateField label={STR.revSaturdayDate} value={date} onChange={setDate} />
          {rows.length > 0 ? (
            <Muted style={{ marginTop: space(1) }}>
              {STR.revListenMine}: {bnNum(done)}/{bnNum(rows.length)} {STR.revListenFinished}
            </Muted>
          ) : null}
        </Card>

        <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
          {rows.length === 0 ? (
            <EmptyState message={STR.revListenNone} />
          ) : (
            <>
              <Card>
                <Body style={{ fontWeight: "700" }}>{STR.revListenGroupTarget}</Body>
                {[...targets.entries()].map(([level, t]) => (
                  <View key={level} style={{ marginTop: space(2) }}>
                    <Body style={{ fontWeight: "700" }}>{hifzLevelLabel(level)}</Body>
                    {t ? (
                      t.portions.map((p) => (
                        <Muted key={p.category}>
                          {revCategoryLabel(p.category)}: {p.rangeBn}
                        </Muted>
                      ))
                    ) : (
                      <Muted>{STR.revTargetMissing}</Muted>
                    )}
                  </View>
                ))}
              </Card>
              <Card>
                {rows.map((r) => {
                  const s = rowState(r);
                  return (
                    <Pressable
                      key={r.studentId}
                      accessibilityRole="button"
                      onPress={() => nav.navigate("ListenStudent", { studentId: r.studentId, date })}
                      style={{ flexDirection: "row", alignItems: "center", gap: space(2), paddingVertical: space(3) }}
                    >
                      <View style={{ flex: 1 }}>
                        <Body style={{ fontWeight: "700" }}>{r.studentName}</Body>
                        <Muted>
                          {hifzLevelLabel(r.level)} · {r.groupNameBn}
                        </Muted>
                      </View>
                      <Badge text={s.text} tone={s.tone} />
                    </Pressable>
                  );
                })}
              </Card>
            </>
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
