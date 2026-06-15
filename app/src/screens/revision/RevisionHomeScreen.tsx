/**
 * RevisionHomeScreen (SR app surfaces) — the Saturday Qur'an-Hifz Revision tab hub.
 * Lists the teacher's `myRevisionGroups` and a Saturday date picker (a plain
 * YYYY-MM-DD text field, defaulted to the most recent Saturday). Tapping a group
 * opens its Saturday grid. Principal/Office also get a dashboard entry. Every action
 * is re-gated + row-scoped server-side — the server stays the gate.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { roleHasPermission } from "@scd/shared";
import { useQuery } from "urql";
import { MY_REVISION_GROUPS_QUERY } from "../../graphql/revision";
import { Screen, Card, Body, Muted, Button, Field, Badge, Loader, EmptyState } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum, classLevelLabel, genderLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { RevisionStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<RevisionStackParamList>;

/** The most recent Saturday on/before today, as YYYY-MM-DD. JS getDay(): Sat = 6. */
export function mostRecentSaturday(from: Date = new Date()): string {
  const d = new Date(from);
  const delta = (d.getDay() - 6 + 7) % 7; // days back to the last Saturday
  d.setDate(d.getDate() - delta);
  return d.toISOString().slice(0, 10);
}

export default function RevisionHomeScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const { role } = useAuth();
  const canManage = !!role && roleHasPermission(role, "roster:manage");
  const [date, setDate] = useState(mostRecentSaturday());

  const [groupsQ] = useQuery({ query: MY_REVISION_GROUPS_QUERY });
  const groups = groupsQ.data?.myRevisionGroups ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.revHomeTitle}</Body>
          <Field label={STR.revSaturdayDate} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
          {canManage ? (
            <View style={{ marginTop: space(2) }}>
              <Button
                title={STR.revDashTitle}
                variant="secondary"
                onPress={() => nav.navigate("RevisionDashboard", { date })}
              />
            </View>
          ) : null}
        </Card>

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.revGroups}</Body>
          {groupsQ.fetching ? (
            <Loader label={STR.loading} />
          ) : groups.length === 0 ? (
            <EmptyState message={STR.revNoGroups} />
          ) : (
            groups.map((g) => (
              <View key={g.id} style={{ marginTop: space(3) }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{g.nameBn}</Body>
                    <Muted>
                      {g.code} · {classLevelLabel(g.level)} · {genderLabel(g.gender)}
                    </Muted>
                  </View>
                  <Badge text={bnNum(g.level)} tone="muted" />
                </View>
                <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                  <Button
                    title={STR.revOpenGrid}
                    onPress={() =>
                      nav.navigate("GroupRevisionGrid", { groupId: g.id, code: g.code, nameBn: g.nameBn, date })
                    }
                    style={{ flexGrow: 1 }}
                  />
                  <Button
                    title={STR.revDeliverOne}
                    variant="secondary"
                    onPress={() =>
                      nav.navigate("DeliverRevision", { groupId: g.id, code: g.code, nameBn: g.nameBn, date })
                    }
                    style={{ flexGrow: 1 }}
                  />
                </View>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
